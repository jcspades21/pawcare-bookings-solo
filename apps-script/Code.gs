// =========================================================
// PawCare Bookings: Apps Script backend
//
// Deployed as a web app. Two requests:
//   GET  ?action=slots&date=YYYY-MM-DD -> booked times for that date
//   POST (JSON body, sent as text/plain) -> validates and saves a booking
//
// Bookings are stored as rows in the "Bookings" tab of the
// PawCare Bookings - Booking Log spreadsheet. Every check the
// browser does is repeated here, because anyone can call this
// URL directly without going through the form.
// =========================================================

var SHEET_ID = '1hcLXcIB93n-nK6VPrml1EljtvitaltMxVZ3qJLTLVzA';
var SHEET_NAME = 'Bookings';
var TIME_ZONE = 'Asia/Manila';
var COLUMN_COUNT = 15;

var MAX_BODY_LENGTH = 5000;
var MAX_DAYS_AHEAD = 365;
var BUFFER_MINUTES = 15;
var CLOSING_MINUTES = 17 * 60;

// Must match SLOT_TIMES and SERVICE_DURATIONS in script.js.
var SLOT_TIMES = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
];
var SERVICES = {
    bath: { label: 'Basic Bath & Dry', minutes: 30 },
    'full-groom': { label: 'Full Groom Package', minutes: 90 },
    'nail-trim': { label: 'Nail Trim & Ear Cleaning', minutes: 20 }
};
var PET_SIZES = ['small', 'medium', 'large'];
var ADDONS = {
    perfume: 'Pet Cologne',
    teeth: 'Teeth Brushing',
    deshed: 'De-shedding Treatment'
};

// Column positions in the Bookings tab (0-based).
var COL_DATE = 9;
var COL_TIME = 10;
var COL_SERVICE = 8;
var COL_STATUS = 13;
var COL_REQUEST_ID = 14;

// ---------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------
function doGet(e) {
    try {
        var params = (e && e.parameter) || {};

        if (params.action !== 'slots') {
            return fail('unknown_action', 'Unknown request.');
        }

        var date = String(params.date || '');
        if (!isRealDate(date)) {
            return fail('invalid_date', 'Please choose a valid date.');
        }

        return jsonOut({ ok: true, date: date, booked: getBookingsForDate(getSheet(), date) });
    } catch (err) {
        console.error(err);
        return fail('server_error', 'Something went wrong on our side. Please try again.');
    }
}

function doPost(e) {
    try {
        var body = (e && e.postData && e.postData.contents) || '';

        if (!body || body.length > MAX_BODY_LENGTH) {
            return fail('invalid_request', 'The booking request was empty or too large.');
        }

        var data;
        try {
            data = JSON.parse(body);
        } catch (parseErr) {
            return fail('invalid_request', 'The booking request could not be read.');
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return fail('invalid_request', 'The booking request could not be read.');
        }

        // Honeypot: real visitors never see or fill this field.
        if (data.website) {
            return fail('invalid_request', 'The booking request was rejected.');
        }

        var checked = validateBooking(data);
        if (checked.errors.length > 0) {
            return jsonOut({
                ok: false,
                error: 'invalid_fields',
                message: 'Please check these fields: ' + checked.errors.join(', ') + '.',
                fields: checked.errors
            });
        }

        return saveBooking(checked.booking);
    } catch (err) {
        console.error(err);
        return fail('server_error', 'Something went wrong on our side. Please try again.');
    }
}

// ---------------------------------------------------------
// Saving
// ---------------------------------------------------------
function saveBooking(booking) {
    // The lock makes two people submitting at the same moment take
    // turns, so the second one sees the first one's row.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
        return fail('busy', 'The booking system is busy. Please try again in a moment.');
    }

    try {
        var sheet = getSheet();

        // A retry after a timeout sends the same request ID. If that
        // request was already saved, return the same booking instead of
        // treating the visitor's own booking as a clash.
        var savedId = findBookingByRequestId(sheet, booking.requestId);
        if (savedId) {
            return jsonOut({ ok: true, bookingId: savedId, status: 'pending' });
        }

        var existing = getBookingsForDate(sheet, booking.date);

        if (overlapsAny(booking.time, booking.minutes, existing)) {
            return fail('slot_taken', 'Sorry, that time was just booked by someone else. Please pick another slot.');
        }

        var bookingId = makeBookingId(booking.date);
        var submittedAt = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
        var row = [
            bookingId,
            submittedAt,
            safeText(booking.ownerName),
            booking.email,
            booking.phone,
            safeText(booking.petName),
            safeText(booking.breed),
            booking.petSize,
            SERVICES[booking.service].label,
            booking.date,
            booking.time,
            booking.addons.map(function (key) { return ADDONS[key]; }).join(', '),
            safeText(booking.notes),
            'pending',
            booking.requestId
        ];

        // Plain text format first, so dates, times and +63 numbers are
        // stored exactly as typed instead of being converted.
        var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, COLUMN_COUNT);
        range.setNumberFormat('@');
        range.setValues([row]);
        SpreadsheetApp.flush();

        return jsonOut({ ok: true, bookingId: bookingId, status: 'pending' });
    } finally {
        lock.releaseLock();
    }
}

// ---------------------------------------------------------
// Validation
// ---------------------------------------------------------
function validateBooking(data) {
    var errors = [];
    var booking = {};

    booking.ownerName = cleanText(data.ownerName);
    if (booking.ownerName.length < 2 || booking.ownerName.length > 100) {
        errors.push('full name');
    }

    booking.email = cleanText(data.email).toLowerCase();
    if (booking.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) {
        errors.push('email address');
    }

    booking.phone = cleanText(data.phone);
    if (!/^\+63[0-9]{10}$/.test(booking.phone)) {
        errors.push('phone number');
    }

    booking.petName = cleanText(data.petName);
    if (booking.petName.length < 1 || booking.petName.length > 60) {
        errors.push('pet name');
    }

    booking.breed = cleanText(data.breed);
    if (booking.breed.length > 60) {
        errors.push('breed');
    }

    booking.petSize = cleanText(data.petSize);
    if (PET_SIZES.indexOf(booking.petSize) === -1) {
        errors.push('pet size');
    }

    booking.service = cleanText(data.service);
    var service = SERVICES.hasOwnProperty(booking.service) ? SERVICES[booking.service] : null;
    if (!service) {
        errors.push('service');
    }

    booking.date = cleanText(data.date);
    var today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
    if (!isRealDate(booking.date) || booking.date < today || booking.date > addDays(today, MAX_DAYS_AHEAD)) {
        errors.push('date');
    }

    booking.time = cleanText(data.time);
    booking.minutes = service ? service.minutes : 30;
    if (SLOT_TIMES.indexOf(booking.time) === -1 ||
        toMinutes(booking.time) + booking.minutes + BUFFER_MINUTES > CLOSING_MINUTES) {
        errors.push('time slot');
    } else if (booking.date === today) {
        var nowMinutes = toMinutes(Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm'));
        if (toMinutes(booking.time) <= nowMinutes) {
            errors.push('time slot');
        }
    }

    var addons = Array.isArray(data.addons) ? data.addons : [];
    booking.addons = [];
    addons.forEach(function (key) {
        if (typeof key === 'string' && ADDONS.hasOwnProperty(key) && booking.addons.indexOf(key) === -1) {
            booking.addons.push(key);
        } else if (errors.indexOf('add-ons') === -1) {
            errors.push('add-ons');
        }
    });

    booking.notes = cleanText(data.notes);
    if (booking.notes.length > 500) {
        errors.push('notes');
    }

    // Optional. Older clients without it still work, they just can't
    // be matched up on retry.
    booking.requestId = cleanText(data.requestId);
    if (booking.requestId && !/^[A-Za-z0-9-]{8,64}$/.test(booking.requestId)) {
        booking.requestId = '';
    }

    return { errors: errors, booking: booking };
}

// ---------------------------------------------------------
// Reading bookings back
// ---------------------------------------------------------
function getSheet() {
    return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

// Returns [{ time: '09:00', minutes: 30 }, ...] for active bookings on a date.
function getBookingsForDate(sheet, date) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
        return [];
    }

    var rows = sheet.getRange(2, 1, lastRow - 1, COLUMN_COUNT).getValues();
    var booked = [];

    rows.forEach(function (row) {
        var status = String(row[COL_STATUS]).toLowerCase();
        if (cellToText(row[COL_DATE], 'yyyy-MM-dd') !== date || status === 'cancelled') {
            return;
        }
        booked.push({
            time: cellToText(row[COL_TIME], 'HH:mm'),
            minutes: minutesForLabel(String(row[COL_SERVICE]))
        });
    });

    return booked;
}

function findBookingByRequestId(sheet, requestId) {
    var lastRow = sheet.getLastRow();
    if (!requestId || lastRow < 2) {
        return '';
    }

    var rows = sheet.getRange(2, 1, lastRow - 1, COLUMN_COUNT).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][COL_REQUEST_ID]) === requestId) {
            return String(rows[i][0]);
        }
    }
    return '';
}

function overlapsAny(time, minutes, bookings) {
    var start = toMinutes(time);
    var end = start + minutes + BUFFER_MINUTES;

    return bookings.some(function (b) {
        var otherStart = toMinutes(b.time);
        var otherEnd = otherStart + b.minutes + BUFFER_MINUTES;
        return start < otherEnd && otherStart < end;
    });
}

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
function minutesForLabel(label) {
    for (var key in SERVICES) {
        if (SERVICES[key].label === label) {
            return SERVICES[key].minutes;
        }
    }
    return 30;
}

function toMinutes(time24) {
    var parts = String(time24).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function isRealDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return false;
    }
    var parts = dateStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.getFullYear() === Number(parts[0]) &&
        d.getMonth() === Number(parts[1]) - 1 &&
        d.getDate() === Number(parts[2]);
}

function addDays(dateStr, days) {
    var parts = dateStr.split('-');
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days));
    return d.toISOString().slice(0, 10);
}

// If someone edits the sheet by hand, Sheets may turn a date or time
// back into a Date object. Convert it to text before comparing.
function cellToText(value, format) {
    if (value instanceof Date) {
        return Utilities.formatDate(value, TIME_ZONE, format);
    }
    return String(value).trim();
}

function cleanText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\s+/g, ' ').trim();
}

// Stops free-text fields from being read as a formula in the sheet.
function safeText(text) {
    return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function makeBookingId(date) {
    return 'PC-' + date.replace(/-/g, '') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
}

function fail(code, message) {
    return jsonOut({ ok: false, error: code, message: message });
}

function jsonOut(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

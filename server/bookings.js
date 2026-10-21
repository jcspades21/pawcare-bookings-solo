// =========================================================
// PawCare Bookings: booking rules and storage
//
// Used by server.js. Every check the browser does is repeated
// here, because anyone can send a request to the API directly
// without going through the form.
//
// Bookings are kept in a JSON file (data/bookings.json), so they
// are still there after the server restarts.
// =========================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var TIME_ZONE = 'Asia/Manila';
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

// ---------------------------------------------------------
// Storage
// ---------------------------------------------------------
function createStore(filePath) {
    function load() {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        var text = fs.readFileSync(filePath, 'utf8');
        return text.trim() ? JSON.parse(text) : [];
    }

    // Write to a temp file first, then rename it over the real one,
    // so a crash halfway through can't leave a broken file behind.
    function save(bookings) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        var tempPath = filePath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(bookings, null, 2));
        fs.renameSync(tempPath, filePath);
    }

    return { load: load, save: save };
}

// ---------------------------------------------------------
// Saving
// ---------------------------------------------------------

// Node runs one request handler at a time, and nothing in here
// waits on anything, so the check and the save happen together.
// Two people booking the same slot can't both get it.
function saveBooking(store, booking) {
    var bookings = store.load();

    // A retry after a timeout sends the same request ID. If that
    // request was already saved, return the same booking instead of
    // treating the visitor's own booking as a clash.
    if (booking.requestId) {
        var saved = bookings.find(function (b) {
            return b.requestId === booking.requestId;
        });
        if (saved) {
            return { status: 200, body: { ok: true, bookingId: saved.bookingId, status: saved.status } };
        }
    }

    if (overlapsAny(booking.time, booking.minutes, getBookingsForDate(bookings, booking.date))) {
        return fail(409, 'slot_taken', 'Sorry, that time was just booked by someone else. Please pick another slot.');
    }

    var record = {
        bookingId: makeBookingId(booking.date),
        submittedAt: manilaNow().stamp,
        ownerName: booking.ownerName,
        email: booking.email,
        phone: booking.phone,
        petName: booking.petName,
        breed: booking.breed,
        petSize: booking.petSize,
        service: booking.service,
        serviceLabel: SERVICES[booking.service].label,
        date: booking.date,
        time: booking.time,
        addons: booking.addons.map(function (key) { return ADDONS[key]; }),
        notes: booking.notes,
        status: 'pending',
        requestId: booking.requestId
    };

    bookings.push(record);
    store.save(bookings);

    return { status: 201, body: { ok: true, bookingId: record.bookingId, status: record.status } };
}

// ---------------------------------------------------------
// Validation
// ---------------------------------------------------------
function validateBooking(data) {
    var errors = [];
    var booking = {};
    var now = manilaNow();

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
    var service = Object.prototype.hasOwnProperty.call(SERVICES, booking.service) ? SERVICES[booking.service] : null;
    if (!service) {
        errors.push('service');
    }

    booking.date = cleanText(data.date);
    if (!isRealDate(booking.date) || booking.date < now.date || booking.date > addDays(now.date, MAX_DAYS_AHEAD)) {
        errors.push('date');
    }

    booking.time = cleanText(data.time);
    booking.minutes = service ? service.minutes : 30;
    if (SLOT_TIMES.indexOf(booking.time) === -1 ||
        toMinutes(booking.time) + booking.minutes + BUFFER_MINUTES > CLOSING_MINUTES) {
        errors.push('time slot');
    } else if (booking.date === now.date && toMinutes(booking.time) <= toMinutes(now.time)) {
        errors.push('time slot');
    }

    var addons = Array.isArray(data.addons) ? data.addons : [];
    booking.addons = [];
    addons.forEach(function (key) {
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(ADDONS, key) &&
            booking.addons.indexOf(key) === -1) {
            booking.addons.push(key);
        } else if (errors.indexOf('add-ons') === -1) {
            errors.push('add-ons');
        }
    });

    booking.notes = cleanText(data.notes);
    if (booking.notes.length > 500) {
        errors.push('notes');
    }

    // Optional. A request without one still works, it just can't be
    // matched up on retry.
    booking.requestId = cleanText(data.requestId);
    if (booking.requestId && !/^[A-Za-z0-9-]{8,64}$/.test(booking.requestId)) {
        booking.requestId = '';
    }

    return { errors: errors, booking: booking };
}

// ---------------------------------------------------------
// Reading bookings back
// ---------------------------------------------------------

// Returns [{ time: '09:00', minutes: 30 }, ...] for active bookings on a date.
function getBookingsForDate(bookings, date) {
    return bookings
        .filter(function (b) {
            return b.date === date && b.status !== 'cancelled';
        })
        .map(function (b) {
            var service = SERVICES[b.service];
            return { time: b.time, minutes: service ? service.minutes : 30 };
        });
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

// The shop is in Manila, so "today" and "now" use Manila time no
// matter where the server runs.
function manilaNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date()).forEach(function (p) {
        parts[p.type] = p.value;
    });

    var date = parts.year + '-' + parts.month + '-' + parts.day;
    var time = parts.hour + ':' + parts.minute;
    return { date: date, time: time, stamp: date + ' ' + time + ':' + parts.second };
}

function toMinutes(time24) {
    var parts = String(time24).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function isRealDate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return false;
    }
    var d = new Date(dateStr + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function cleanText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\s+/g, ' ').trim();
}

function makeBookingId(date) {
    return 'PC-' + date.replace(/-/g, '') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function fail(status, code, message) {
    return { status: status, body: { ok: false, error: code, message: message } };
}

module.exports = {
    createStore: createStore,
    validateBooking: validateBooking,
    saveBooking: saveBooking,
    getBookingsForDate: getBookingsForDate,
    isRealDate: isRealDate,
    manilaNow: manilaNow,
    addDays: addDays,
    fail: fail
};

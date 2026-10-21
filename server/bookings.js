// =========================================================
// PawCare Bookings: booking rules
//
// Every check the browser does is repeated here, because anyone can
// send a request to the API directly without going through the form.
// The shop's services and hours come from config.js.
// =========================================================

var config = require('./config');
var util = require('./util');

var CLOSING_MINUTES = util.toMinutes(config.closingTime);

// ---------------------------------------------------------
// Validation
// ---------------------------------------------------------
function validateBooking(data) {
    var errors = [];
    var booking = {};
    var now = util.manilaNow();

    booking.ownerName = util.cleanText(data.ownerName);
    if (booking.ownerName.length < 2 || booking.ownerName.length > 100) {
        errors.push('full name');
    }

    booking.email = util.cleanText(data.email).toLowerCase();
    if (!util.isEmail(booking.email)) {
        errors.push('email address');
    }

    booking.phone = util.cleanText(data.phone);
    if (!/^\+63[0-9]{10}$/.test(booking.phone)) {
        errors.push('phone number');
    }

    booking.petName = util.cleanText(data.petName);
    if (booking.petName.length < 1 || booking.petName.length > 60) {
        errors.push('pet name');
    }

    booking.breed = util.cleanText(data.breed);
    if (booking.breed.length > 60) {
        errors.push('breed');
    }

    booking.petSize = util.cleanText(data.petSize);
    if (config.petSizes.indexOf(booking.petSize) === -1) {
        errors.push('pet size');
    }

    booking.service = util.cleanText(data.service);
    var service = getService(booking.service);
    if (!service) {
        errors.push('service');
    }

    booking.date = util.cleanText(data.date);
    if (!util.isRealDate(booking.date) || booking.date < now.date ||
        booking.date > util.addDays(now.date, config.maxDaysAhead)) {
        errors.push('date');
    }

    booking.time = util.cleanText(data.time);
    booking.minutes = service ? service.minutes : 30;
    if (!fitsBeforeClosing(booking.time, booking.minutes)) {
        errors.push('time slot');
    } else if (booking.date === now.date && util.toMinutes(booking.time) <= util.toMinutes(now.time)) {
        errors.push('time slot');
    }

    var addons = Array.isArray(data.addons) ? data.addons : [];
    booking.addons = [];
    addons.forEach(function (key) {
        var known = typeof key === 'string' && Object.prototype.hasOwnProperty.call(config.addons, key);
        if (!known) {
            if (errors.indexOf('add-ons') === -1) {
                errors.push('add-ons');
            }
        } else if (booking.addons.indexOf(key) === -1) {
            // The same add-on twice is just ignored.
            booking.addons.push(key);
        }
    });

    booking.notes = util.cleanText(data.notes);
    if (booking.notes.length > 500) {
        errors.push('notes');
    }

    booking.requestId = util.cleanRequestId(data.requestId);

    return { errors: errors, booking: booking };
}

function getService(key) {
    return Object.prototype.hasOwnProperty.call(config.services, key) ? config.services[key] : null;
}

// The start time has to be one of the shop's slots, and the
// appointment plus its buffer has to end by closing time.
function fitsBeforeClosing(time, minutes) {
    return config.slotTimes.indexOf(time) !== -1 &&
        util.toMinutes(time) + minutes + config.bufferMinutes <= CLOSING_MINUTES;
}

// ---------------------------------------------------------
// Saving
// ---------------------------------------------------------

// Node runs one request handler at a time, and nothing in here waits
// on anything, so the check and the save happen together. Two people
// booking the same slot can't both get it.
function saveBooking(store, booking) {
    var records = store.all();

    // A retry after a timeout sends the same request ID. If that
    // request was already saved, return the same booking instead of
    // treating the visitor's own booking as a clash.
    if (booking.requestId) {
        var saved = records.find(function (b) {
            return b.requestId === booking.requestId;
        });
        if (saved) {
            return { status: 200, body: { ok: true, bookingId: saved.bookingId, status: saved.status } };
        }
    }

    if (overlapsAny(booking.time, booking.minutes, getBookingsForDate(records, booking.date))) {
        return util.fail(409, 'slot_taken', 'Sorry, that time was just booked by someone else. Please pick another slot.');
    }

    var record = store.add({
        bookingId: util.makeId('PC-' + booking.date.replace(/-/g, '')),
        submittedAt: util.manilaNow().stamp,
        ownerName: booking.ownerName,
        email: booking.email,
        phone: booking.phone,
        petName: booking.petName,
        breed: booking.breed,
        petSize: booking.petSize,
        service: booking.service,
        serviceLabel: config.services[booking.service].label,
        date: booking.date,
        time: booking.time,
        addons: booking.addons.map(function (key) { return config.addons[key]; }),
        notes: booking.notes,
        status: 'pending',
        requestId: booking.requestId
    });

    return { status: 201, body: { ok: true, bookingId: record.bookingId, status: record.status } };
}

// ---------------------------------------------------------
// Reading bookings back
// ---------------------------------------------------------

// Returns [{ time: '09:00', minutes: 30 }, ...] for active bookings on a date.
function getBookingsForDate(records, date) {
    return records
        .filter(function (b) {
            return b.date === date && b.status !== 'cancelled';
        })
        .map(function (b) {
            var service = getService(b.service);
            return { time: b.time, minutes: service ? service.minutes : 30 };
        });
}

function overlapsAny(time, minutes, bookings) {
    var start = util.toMinutes(time);
    var end = start + minutes + config.bufferMinutes;

    return bookings.some(function (b) {
        var otherStart = util.toMinutes(b.time);
        var otherEnd = otherStart + b.minutes + config.bufferMinutes;
        return start < otherEnd && otherStart < end;
    });
}

// "Find my booking". Needs both the booking ID and the email it was
// made with, and gives the same answer for a wrong ID or a wrong email,
// so it can't be used to check whether an ID exists.
function findBooking(store, bookingId, email) {
    var id = util.cleanText(bookingId).toUpperCase();
    var mail = util.cleanText(email).toLowerCase();

    var record = store.all().find(function (b) {
        return b.bookingId === id && b.email === mail;
    });

    if (!record) {
        return util.fail(404, 'not_found', "We couldn't find a booking with that ID and email. Check both and try again.");
    }

    return {
        status: 200,
        body: {
            ok: true,
            booking: {
                bookingId: record.bookingId,
                petName: record.petName,
                service: record.serviceLabel,
                date: record.date,
                time: record.time,
                addons: record.addons,
                status: record.status
            }
        }
    };
}

module.exports = {
    validateBooking: validateBooking,
    saveBooking: saveBooking,
    getBookingsForDate: getBookingsForDate,
    overlapsAny: overlapsAny,
    fitsBeforeClosing: fitsBeforeClosing,
    findBooking: findBooking
};

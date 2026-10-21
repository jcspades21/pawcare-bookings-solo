// =========================================================
// PawCare Bookings: Express server
//
// Serves the website and a small JSON API:
//   GET  /api/config                  -> services, slot times and hours
//   GET  /api/slots?date=YYYY-MM-DD   -> booked times for that date
//   POST /api/bookings                -> validates and saves a booking
//   GET  /api/bookings/:id?email=...  -> looks up one booking
//   POST /api/messages                -> saves a contact form message
//
// Start it with "npm start" and open http://localhost:3000
// =========================================================

var path = require('path');
var express = require('express');
var config = require('./config');
var util = require('./util');
var bookings = require('./bookings');
var messages = require('./messages');
var createStore = require('./store').createStore;
var rateLimit = require('./rateLimit');

var ROOT = path.join(__dirname, '..');

// options.dataDir:   folder for bookings.json and messages.json
// options.rateLimit: { max, windowMs } for write and lookup routes
function createApp(options) {
    var bookingStore = createStore(path.join(options.dataDir, 'bookings.json'));
    var messageStore = createStore(path.join(options.dataDir, 'messages.json'));
    var limit = rateLimit(options.rateLimit || { max: 20, windowMs: 60 * 1000 });

    var app = express();
    app.disable('x-powered-by');
    app.use(securityHeaders);

    // Bookings and messages are small. Anything bigger is rejected.
    app.use(express.json({ limit: '5kb' }));

    // -----------------------------------------------------
    // API
    // -----------------------------------------------------
    app.get('/api/config', function (req, res) {
        res.json({
            ok: true,
            slotTimes: config.slotTimes,
            closingTime: config.closingTime,
            bufferMinutes: config.bufferMinutes,
            maxDaysAhead: config.maxDaysAhead,
            services: config.services,
            addons: config.addons
        });
    });

    app.get('/api/slots', function (req, res) {
        var date = String(req.query.date || '');
        if (!util.isRealDate(date)) {
            return send(res, util.fail(400, 'invalid_date', 'Please choose a valid date.'));
        }
        res.json({ ok: true, date: date, booked: bookings.getBookingsForDate(bookingStore.all(), date) });
    });

    app.post('/api/bookings', limit, requireJsonObject, rejectSpam, function (req, res) {
        var checked = bookings.validateBooking(req.body);
        if (checked.errors.length > 0) {
            return send(res, invalidFields(checked.errors));
        }
        send(res, bookings.saveBooking(bookingStore, checked.booking));
    });

    app.get('/api/bookings/:id', limit, function (req, res) {
        send(res, bookings.findBooking(bookingStore, req.params.id, String(req.query.email || '')));
    });

    app.post('/api/messages', limit, requireJsonObject, rejectSpam, function (req, res) {
        var checked = messages.validateMessage(req.body);
        if (checked.errors.length > 0) {
            return send(res, invalidFields(checked.errors));
        }
        send(res, messages.saveMessage(messageStore, checked.message));
    });

    // Unknown API paths get a JSON reply, not the HTML 404 page.
    app.use('/api', function (req, res) {
        send(res, util.fail(404, 'not_found', 'Unknown request.'));
    });

    // -----------------------------------------------------
    // Website files
    // -----------------------------------------------------
    // Only the files the page needs. The data folder and the server
    // code are never sent to the browser.
    app.get('/', function (req, res) {
        res.sendFile(path.join(ROOT, 'index.html'));
    });
    app.get(['/index.html', '/style.css', '/script.js'], function (req, res) {
        res.sendFile(path.join(ROOT, req.path));
    });
    // Images rarely change, so browsers may keep them for a week.
    app.use('/images', express.static(path.join(ROOT, 'images'), { maxAge: '7d' }));

    // -----------------------------------------------------
    // Errors
    // -----------------------------------------------------
    app.use(function (err, req, res, next) {
        if (err.type === 'entity.too.large') {
            return send(res, util.fail(413, 'invalid_request', 'The request was too large.'));
        }
        if (err.type === 'entity.parse.failed') {
            return send(res, util.fail(400, 'invalid_request', 'The request could not be read.'));
        }
        console.error(err);
        send(res, util.fail(500, 'server_error', 'Something went wrong on our side. Please try again.'));
    });

    return app;
}

// ---------------------------------------------------------
// Middleware
// ---------------------------------------------------------
function securityHeaders(req, res, next) {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    next();
}

function requireJsonObject(req, res, next) {
    if (!req.is('application/json')) {
        return send(res, util.fail(415, 'invalid_request', 'The request could not be read.'));
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return send(res, util.fail(400, 'invalid_request', 'The request could not be read.'));
    }
    next();
}

// Honeypot: real visitors never see or fill the "website" field.
function rejectSpam(req, res, next) {
    if (req.body.website) {
        return send(res, util.fail(400, 'invalid_request', 'The request was rejected.'));
    }
    next();
}

function invalidFields(fields) {
    return {
        status: 400,
        body: {
            ok: false,
            error: 'invalid_fields',
            message: 'Please check these fields: ' + fields.join(', ') + '.',
            fields: fields
        }
    };
}

function send(res, result) {
    res.status(result.status).json(result.body);
}

module.exports = createApp;

if (require.main === module) {
    var port = process.env.PORT || 3000;
    var dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
    var app;

    try {
        app = createApp({ dataDir: dataDir });
    } catch (err) {
        console.error('Could not start: ' + err.message);
        process.exit(1);
    }

    app.listen(port, function () {
        console.log('PawCare Bookings running at http://localhost:' + port);
        console.log('Saving data in ' + dataDir);
    });
}

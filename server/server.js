// =========================================================
// PawCare Bookings: Express server
//
// Serves the website and a small JSON API:
//   GET  /api/slots?date=YYYY-MM-DD -> booked times for that date
//   POST /api/bookings              -> validates and saves a booking
//
// Start it with "npm start" and open http://localhost:3000
// =========================================================

var path = require('path');
var express = require('express');
var bookings = require('./bookings');

var ROOT = path.join(__dirname, '..');

function createApp(options) {
    var store = bookings.createStore(options.dataFile);
    var app = express();

    // Bookings are small. Anything bigger than this is rejected.
    app.use(express.json({ limit: '5kb' }));

    // -----------------------------------------------------
    // API
    // -----------------------------------------------------
    app.get('/api/slots', function (req, res) {
        var date = String(req.query.date || '');
        if (!bookings.isRealDate(date)) {
            return send(res, bookings.fail(400, 'invalid_date', 'Please choose a valid date.'));
        }

        var booked = bookings.getBookingsForDate(store.load(), date);
        res.json({ ok: true, date: date, booked: booked });
    });

    app.post('/api/bookings', function (req, res) {
        if (!req.is('application/json')) {
            return send(res, bookings.fail(415, 'invalid_request', 'The booking request could not be read.'));
        }

        var data = req.body;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return send(res, bookings.fail(400, 'invalid_request', 'The booking request could not be read.'));
        }

        // Honeypot: real visitors never see or fill this field.
        if (data.website) {
            return send(res, bookings.fail(400, 'invalid_request', 'The booking request was rejected.'));
        }

        var checked = bookings.validateBooking(data);
        if (checked.errors.length > 0) {
            return res.status(400).json({
                ok: false,
                error: 'invalid_fields',
                message: 'Please check these fields: ' + checked.errors.join(', ') + '.',
                fields: checked.errors
            });
        }

        send(res, bookings.saveBooking(store, checked.booking));
    });

    // Unknown API paths get a JSON reply, not the HTML 404 page.
    app.use('/api', function (req, res) {
        send(res, bookings.fail(404, 'not_found', 'Unknown request.'));
    });

    // -----------------------------------------------------
    // Website files
    // -----------------------------------------------------
    // Only the files the page needs. The data folder and the
    // server code are never sent to the browser.
    app.get('/', function (req, res) {
        res.sendFile(path.join(ROOT, 'index.html'));
    });
    app.get(['/index.html', '/style.css', '/script.js'], function (req, res) {
        res.sendFile(path.join(ROOT, req.path));
    });
    app.use('/images', express.static(path.join(ROOT, 'images')));

    // -----------------------------------------------------
    // Errors
    // -----------------------------------------------------
    app.use(function (err, req, res, next) {
        if (err.type === 'entity.too.large') {
            return send(res, bookings.fail(413, 'invalid_request', 'The booking request was too large.'));
        }
        if (err.type === 'entity.parse.failed') {
            return send(res, bookings.fail(400, 'invalid_request', 'The booking request could not be read.'));
        }
        console.error(err);
        send(res, bookings.fail(500, 'server_error', 'Something went wrong on our side. Please try again.'));
    });

    return app;
}

function send(res, result) {
    res.status(result.status).json(result.body);
}

module.exports = createApp;

if (require.main === module) {
    var port = process.env.PORT || 3000;
    var dataFile = process.env.BOOKINGS_FILE || path.join(ROOT, 'data', 'bookings.json');

    createApp({ dataFile: dataFile }).listen(port, function () {
        console.log('PawCare Bookings running at http://localhost:' + port);
        console.log('Saving bookings to ' + dataFile);
    });
}

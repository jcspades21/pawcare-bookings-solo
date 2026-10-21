// API tests for the Express backend. Run with: npm test
//
// Each run uses its own temporary data folder, so the real
// data/bookings.json is never touched.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');

var dataDir = h.makeDataDir();
var bookingsFile = path.join(dataDir, 'bookings.json');
var DATE = h.futureDate(7);
var YESTERDAY = h.futureDate(-1);
var app;

// A high limit here, so the rate limit doesn't get in the way of the
// other tests. It has its own test further down.
var OPTIONS = { dataDir: dataDir, rateLimit: { max: 1000, windowMs: 60000 } };

function request(method, urlPath, body, contentType) {
    var options = { method: method, headers: {} };
    if (body !== undefined) {
        options.headers['Content-Type'] = contentType || 'application/json';
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return fetch(app.baseUrl + urlPath, options).then(function (res) {
        return res.json().then(function (json) {
            return { status: res.status, body: json, headers: res.headers };
        });
    });
}

function book(change) {
    return request('POST', '/api/bookings', h.sampleBooking(change));
}

test.before(async function () {
    app = await h.startServer(OPTIONS);
});
test.after(function () {
    return app.stop();
});

// ---------------------------------------------------------
// Config
// ---------------------------------------------------------
test('config returns the shop rules the browser needs', async function () {
    var r = await request('GET', '/api/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.services['full-groom'].minutes, 90);
    assert.strictEqual(r.body.bufferMinutes, 15);
    assert.ok(r.body.slotTimes.indexOf('09:00') !== -1);
});

// ---------------------------------------------------------
// Bookings
// ---------------------------------------------------------
test('valid booking is saved and gets a booking ID', async function () {
    var r = await book();
    assert.strictEqual(r.status, 201);
    assert.match(r.body.bookingId, /^PC-\d{8}-[0-9A-F]{4}$/);

    var saved = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].email, 'juan@example.com');
    assert.strictEqual(saved[0].phone, '+639171234567');
    assert.deepStrictEqual(saved[0].addons, ['Teeth Brushing']);
    assert.strictEqual(saved[0].status, 'pending');
});

test('slots for the date include the saved booking', async function () {
    var r = await request('GET', '/api/slots?date=' + DATE);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.booked, [{ time: '09:00', minutes: 90 }]);
});

test('same slot is rejected', async function () {
    var r = await book({ service: 'nail-trim' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'slot_taken');
});

test('overlapping slot is rejected (90 min groom plus 15 min buffer)', async function () {
    assert.strictEqual((await book({ time: '10:00', service: 'bath' })).status, 409);
});

test('slot right after the buffer is accepted', async function () {
    assert.strictEqual((await book({ time: '11:00', service: 'bath' })).status, 201);
});

test('missing and invalid fields are rejected with the field names', async function () {
    var cases = [
        [{ ownerName: '' }, 'full name'],
        [{ email: 'not-an-email' }, 'email address'],
        [{ phone: '09171234567' }, 'phone number'],
        [{ petName: '' }, 'pet name'],
        [{ breed: 'x'.repeat(61) }, 'breed'],
        [{ petSize: 'huge' }, 'pet size'],
        [{ service: 'spa-day' }, 'service'],
        [{ service: 'constructor' }, 'service'],
        [{ date: YESTERDAY }, 'date'],
        [{ date: '2026-02-30' }, 'date'],
        [{ date: h.futureDate(400) }, 'date'],
        [{ time: '12:00' }, 'time slot'],
        [{ time: '16:30' }, 'time slot'],
        [{ addons: ['caviar'] }, 'add-ons'],
        [{ notes: 'x'.repeat(501) }, 'notes'],
        [{ ownerName: { x: 1 } }, 'full name']
    ];

    for (var i = 0; i < cases.length; i++) {
        var r = await book(cases[i][0]);
        assert.strictEqual(r.status, 400, JSON.stringify(cases[i][0]));
        assert.ok(r.body.fields.indexOf(cases[i][1]) !== -1, cases[i][1] + ' -> ' + r.body.message);
    }
});

test('several bad fields are all reported at once', async function () {
    var r = await book({ ownerName: '', phone: '123', petSize: '' });
    assert.deepStrictEqual(r.body.fields, ['full name', 'phone number', 'pet size']);
});

test('junk, wrong type, oversized and spam requests are rejected', async function () {
    assert.strictEqual((await request('POST', '/api/bookings', 'not json at all')).status, 400);
    assert.strictEqual((await request('POST', '/api/bookings', '[1,2,3]')).status, 400);
    assert.strictEqual((await request('POST', '/api/bookings', JSON.stringify(h.sampleBooking()), 'text/plain')).status, 415);
    assert.strictEqual((await book({ notes: 'x'.repeat(6000) })).status, 413);

    var spam = await book({ time: '14:00', website: 'http://spam.example' });
    assert.strictEqual(spam.status, 400);
    assert.strictEqual(spam.body.message, 'The request was rejected.');
});

test('bad slot query and unknown API paths return JSON errors', async function () {
    assert.strictEqual((await request('GET', '/api/slots?date=tomorrow')).status, 400);
    var r = await request('GET', '/api/nothing-here');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error, 'not_found');
});

test('retry with the same request ID returns the same booking', async function () {
    var first = await book({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0001' });
    var again = await book({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0001' });
    assert.strictEqual(first.status, 201);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.bookingId, first.body.bookingId);

    var other = await book({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0002' });
    assert.strictEqual(other.status, 409);
});

test('five requests for one slot at the same time: only one is saved', async function () {
    var requests = [];
    for (var i = 0; i < 5; i++) {
        requests.push(book({ time: '15:00', service: 'bath', petName: 'Racer ' + i }));
    }
    var results = await Promise.all(requests);
    assert.strictEqual(results.filter(function (r) { return r.status === 201; }).length, 1);
    assert.strictEqual(results.filter(function (r) { return r.status === 409; }).length, 4);
});

// ---------------------------------------------------------
// Find my booking
// ---------------------------------------------------------
test('a booking can be looked up with its ID and email', async function () {
    var made = await book({ date: h.futureDate(8), time: '09:30', service: 'bath' });
    var id = made.body.bookingId;

    var r = await request('GET', '/api/bookings/' + id.toLowerCase() + '?email=JUAN@example.com');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.booking.bookingId, id);
    assert.strictEqual(r.body.booking.time, '09:30');
    assert.strictEqual(r.body.booking.service, 'Basic Bath & Dry');
    // Contact details are never sent back.
    assert.strictEqual(r.body.booking.phone, undefined);
    assert.strictEqual(r.body.booking.email, undefined);

    var wrongEmail = await request('GET', '/api/bookings/' + id + '?email=someone@else.com');
    var wrongId = await request('GET', '/api/bookings/PC-20990101-0000?email=juan@example.com');
    assert.strictEqual(wrongEmail.status, 404);
    assert.strictEqual(wrongId.status, 404);
    // Same answer either way, so it doesn't reveal which IDs exist.
    assert.strictEqual(wrongEmail.body.message, wrongId.body.message);
});

// ---------------------------------------------------------
// Contact messages
// ---------------------------------------------------------
test('a contact message is saved with a reference ID', async function () {
    var r = await request('POST', '/api/messages', {
        name: 'Maria Santos',
        email: 'maria@example.com',
        contactMethod: 'phone',
        message: 'Do you groom cats?\nThanks!',
        website: ''
    });
    assert.strictEqual(r.status, 201);
    assert.match(r.body.messageId, /^MSG-\d{8}-[0-9A-F]{4}$/);

    var saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].message, 'Do you groom cats?\nThanks!');
    assert.strictEqual(saved[0].status, 'new');
});

test('bad contact messages are rejected with the field names', async function () {
    var r = await request('POST', '/api/messages', { name: 'M', email: 'nope', contactMethod: 'fax', message: '' });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body.fields, ['full name', 'email address', 'contact method', 'message']);

    var long = await request('POST', '/api/messages', { name: 'Maria', email: 'm@example.com', message: 'x'.repeat(501) });
    assert.deepStrictEqual(long.body.fields, ['message']);
});

test('a repeated contact message is only saved once', async function () {
    var msg = { name: 'Ana Cruz', email: 'ana@example.com', message: 'Hello', requestId: 'msg-retry-0001' };
    var first = await request('POST', '/api/messages', msg);
    var again = await request('POST', '/api/messages', msg);
    assert.strictEqual(again.body.messageId, first.body.messageId);
    var saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8'));
    assert.strictEqual(saved.length, 2);
});

// ---------------------------------------------------------
// Storage and restarts
// ---------------------------------------------------------
test('bookings are still there after the server restarts', async function () {
    var before = (await request('GET', '/api/slots?date=' + DATE)).body.booked;
    await app.stop();
    app = await h.startServer(OPTIONS);
    var after = (await request('GET', '/api/slots?date=' + DATE)).body.booked;
    assert.ok(after.length > 0);
    assert.deepStrictEqual(after, before);
});

test('a booking cancelled in the file frees its slot after a restart', async function () {
    await app.stop();
    var list = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));
    list[0].status = 'cancelled';
    fs.writeFileSync(bookingsFile, JSON.stringify(list));
    app = await h.startServer(OPTIONS);

    var times = (await request('GET', '/api/slots?date=' + DATE)).body.booked.map(function (b) { return b.time; });
    assert.ok(times.indexOf('09:00') === -1);
});

// ---------------------------------------------------------
// Protection
// ---------------------------------------------------------
test('too many requests from one visitor get a 429 with Retry-After', async function () {
    var limited = await h.startServer({ dataDir: h.makeDataDir(), rateLimit: { max: 3, windowMs: 60000 } });
    var statuses = [];
    for (var i = 0; i < 5; i++) {
        var res = await fetch(limited.baseUrl + '/api/bookings/PC-20990101-0000?email=a@b.co');
        statuses.push(res.status);
        if (res.status === 429) {
            assert.ok(Number(res.headers.get('retry-after')) > 0);
            assert.strictEqual((await res.json()).error, 'rate_limited');
        }
    }
    await limited.stop();
    assert.deepStrictEqual(statuses, [404, 404, 404, 429, 429]);
});

test('security headers are set and server details are hidden', async function () {
    var res = await fetch(app.baseUrl + '/');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
});

test('server code and data are not served to the browser', async function () {
    var paths = ['/data/bookings.json', '/data/messages.json', '/server/server.js', '/package.json', '/test/api.test.js'];
    for (var i = 0; i < paths.length; i++) {
        var res = await fetch(app.baseUrl + paths[i]);
        assert.strictEqual(res.status, 404, paths[i]);
    }
    assert.strictEqual((await fetch(app.baseUrl + '/script.js')).status, 200);
    var img = await fetch(app.baseUrl + '/images/bath-service.png');
    assert.strictEqual(img.status, 200);
    assert.match(img.headers.get('cache-control'), /max-age=604800/);
});

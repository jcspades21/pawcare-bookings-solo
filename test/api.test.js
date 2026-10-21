// API tests for the Express backend. Run with: npm test
//
// Each test run uses its own temporary bookings file, so the real
// data/bookings.json is never touched.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var createApp = require('../server/server');
var bookings = require('../server/bookings');

var dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pawcare-')), 'bookings.json');
var server;
var baseUrl;

// A date a week from now in Manila time, so tests never hit "today".
var DATE = bookings.addDays(bookings.manilaNow().date, 7);
var YESTERDAY = bookings.addDays(bookings.manilaNow().date, -1);

function startServer() {
    return new Promise(function (resolve) {
        server = createApp({ dataFile: dataFile }).listen(0, function () {
            baseUrl = 'http://localhost:' + server.address().port;
            resolve();
        });
    });
}

function stopServer() {
    return new Promise(function (resolve) {
        server.close(resolve);
    });
}

function booking(change) {
    return Object.assign({
        ownerName: 'Juan Dela Cruz',
        email: 'Juan@Example.com',
        phone: '+639171234567',
        petName: 'Bantay',
        breed: 'Aspin',
        petSize: 'medium',
        service: 'full-groom',
        date: DATE,
        time: '09:00',
        addons: ['teeth'],
        notes: 'Nervous around water',
        website: ''
    }, change || {});
}

function post(body, contentType) {
    return fetch(baseUrl + '/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    }).then(function (res) {
        return res.json().then(function (json) {
            return { status: res.status, body: json };
        });
    });
}

function getSlots(date) {
    return fetch(baseUrl + '/api/slots?date=' + date).then(function (res) {
        return res.json().then(function (json) {
            return { status: res.status, body: json };
        });
    });
}

test.before(startServer);
test.after(stopServer);

test('valid booking is saved and gets a booking ID', async function () {
    var r = await post(booking());
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.ok, true);
    assert.match(r.body.bookingId, /^PC-\d{8}-[0-9A-F]{4}$/);

    var saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].email, 'juan@example.com');
    assert.strictEqual(saved[0].phone, '+639171234567');
    assert.deepStrictEqual(saved[0].addons, ['Teeth Brushing']);
    assert.strictEqual(saved[0].status, 'pending');
});

test('slots for the date include the saved booking', async function () {
    var r = await getSlots(DATE);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.booked, [{ time: '09:00', minutes: 90 }]);
});

test('same slot is rejected', async function () {
    var r = await post(booking({ service: 'nail-trim' }));
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error, 'slot_taken');
});

test('overlapping slot is rejected (90 min groom plus 15 min buffer)', async function () {
    var r = await post(booking({ time: '10:00', service: 'bath' }));
    assert.strictEqual(r.status, 409);
});

test('slot right after the buffer is accepted', async function () {
    var r = await post(booking({ time: '11:00', service: 'bath' }));
    assert.strictEqual(r.status, 201);
});

test('missing and invalid fields are rejected with the field names', async function () {
    var cases = [
        [{ ownerName: '' }, 'full name'],
        [{ email: 'not-an-email' }, 'email address'],
        [{ phone: '09171234567' }, 'phone number'],
        [{ petName: '' }, 'pet name'],
        [{ petSize: 'huge' }, 'pet size'],
        [{ service: 'spa-day' }, 'service'],
        [{ date: YESTERDAY }, 'date'],
        [{ date: '2026-02-30' }, 'date'],
        [{ time: '12:00' }, 'time slot'],
        [{ time: '16:30' }, 'time slot'],
        [{ addons: ['caviar'] }, 'add-ons'],
        [{ notes: 'x'.repeat(501) }, 'notes'],
        [{ ownerName: { x: 1 } }, 'full name']
    ];

    for (var i = 0; i < cases.length; i++) {
        var r = await post(booking(cases[i][0]));
        assert.strictEqual(r.status, 400, JSON.stringify(cases[i][0]));
        assert.ok(r.body.fields.indexOf(cases[i][1]) !== -1, cases[i][1] + ' -> ' + r.body.message);
    }
});

test('junk, wrong type, oversized and spam requests are rejected', async function () {
    assert.strictEqual((await post('not json at all')).status, 400);
    assert.strictEqual((await post('[1,2,3]')).status, 400);
    assert.strictEqual((await post(JSON.stringify(booking()), 'text/plain')).status, 415);
    assert.strictEqual((await post(booking({ notes: 'x'.repeat(6000) }))).status, 413);

    var spam = await post(booking({ time: '14:00', website: 'http://spam.example' }));
    assert.strictEqual(spam.status, 400);
    assert.strictEqual(spam.body.message, 'The booking request was rejected.');
});

test('bad slot query and unknown API paths return JSON errors', async function () {
    assert.strictEqual((await getSlots('tomorrow')).status, 400);

    var res = await fetch(baseUrl + '/api/nothing-here');
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).error, 'not_found');
});

test('retry with the same request ID returns the same booking', async function () {
    var first = await post(booking({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0001' }));
    var again = await post(booking({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0001' }));
    assert.strictEqual(first.status, 201);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.bookingId, first.body.bookingId);

    var other = await post(booking({ time: '13:00', service: 'nail-trim', requestId: 'retry-test-0002' }));
    assert.strictEqual(other.status, 409);
});

test('five requests for one slot at the same time: only one is saved', async function () {
    var requests = [];
    for (var i = 0; i < 5; i++) {
        requests.push(post(booking({ time: '15:00', service: 'bath', petName: 'Racer ' + i })));
    }
    var results = await Promise.all(requests);
    var saved = results.filter(function (r) { return r.status === 201; });
    var taken = results.filter(function (r) { return r.status === 409; });
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(taken.length, 4);
});

test('cancelled bookings free up their slot', async function () {
    var list = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    list[0].status = 'cancelled';
    fs.writeFileSync(dataFile, JSON.stringify(list));

    var r = await getSlots(DATE);
    var times = r.body.booked.map(function (b) { return b.time; });
    assert.ok(times.indexOf('09:00') === -1);
});

test('bookings are still there after the server restarts', async function () {
    var before = (await getSlots(DATE)).body.booked;
    await stopServer();
    await startServer();
    var after = (await getSlots(DATE)).body.booked;
    assert.ok(after.length > 0);
    assert.deepStrictEqual(after, before);
});

test('server code and data are not served to the browser', async function () {
    var paths = ['/data/bookings.json', '/server/server.js', '/package.json'];
    for (var i = 0; i < paths.length; i++) {
        var res = await fetch(baseUrl + paths[i]);
        assert.strictEqual(res.status, 404, paths[i]);
    }
    assert.strictEqual((await fetch(baseUrl + '/')).status, 200);
    assert.strictEqual((await fetch(baseUrl + '/script.js')).status, 200);
});

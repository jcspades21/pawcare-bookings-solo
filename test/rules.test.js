// Unit tests for the booking rules and helpers, without a server.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var util = require('../server/util');
var bookings = require('../server/bookings');
var createStore = require('../server/store').createStore;

test('overlap check counts the 15-minute buffer on both bookings', function () {
    var booked = [{ time: '10:00', minutes: 30 }];  // busy 10:00 to 10:45 with buffer
    assert.strictEqual(bookings.overlapsAny('10:00', 30, booked), true);
    assert.strictEqual(bookings.overlapsAny('10:30', 30, booked), true);   // starts inside the buffer
    assert.strictEqual(bookings.overlapsAny('11:00', 30, booked), false);  // starts after it
    assert.strictEqual(bookings.overlapsAny('09:30', 20, booked), true);   // 9:30 + 20 + 15 runs to 10:05
    assert.strictEqual(bookings.overlapsAny('09:00', 30, booked), false);  // 9:00 + 30 + 15 ends 9:45
});

test('a booking ending exactly when the next starts does not overlap', function () {
    var booked = [{ time: '09:00', minutes: 45 }];  // busy until exactly 10:00
    assert.strictEqual(bookings.overlapsAny('10:00', 30, booked), false);
    assert.strictEqual(bookings.overlapsAny('09:30', 30, booked), true);
});

test('appointments must end, with buffer, by closing time', function () {
    assert.strictEqual(bookings.fitsBeforeClosing('16:00', 30), true);    // 16:45
    assert.strictEqual(bookings.fitsBeforeClosing('16:30', 30), false);   // 17:15
    assert.strictEqual(bookings.fitsBeforeClosing('15:00', 90), true);    // 16:45
    assert.strictEqual(bookings.fitsBeforeClosing('12:00', 20), false);   // lunch, not a slot
    assert.strictEqual(bookings.fitsBeforeClosing('9:00', 20), false);    // wrong format
});

test('dates must be real calendar days', function () {
    assert.strictEqual(util.isRealDate('2028-02-29'), true);
    assert.strictEqual(util.isRealDate('2027-02-29'), false);
    assert.strictEqual(util.isRealDate('2026-13-01'), false);
    assert.strictEqual(util.isRealDate('2026-1-01'), false);
    assert.strictEqual(util.isRealDate(''), false);
});

test('adding days works across months and years', function () {
    assert.strictEqual(util.addDays('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(util.addDays('2026-03-01', -1), '2026-02-28');
});

test('Manila time is used whatever the server time zone', function () {
    var now = util.manilaNow();
    var expected = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    assert.strictEqual(now.date, expected);
    assert.match(now.stamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('text fields are trimmed and non-strings count as empty', function () {
    assert.strictEqual(util.cleanText('  Juan   Dela  Cruz '), 'Juan Dela Cruz');
    assert.strictEqual(util.cleanText(42), '');
    assert.strictEqual(util.cleanText(null), '');
    assert.strictEqual(util.cleanRequestId('bad id!'), '');
    assert.strictEqual(util.cleanRequestId('c9ddb611-5753-493a'), 'c9ddb611-5753-493a');
});

test('validation cleans up a good booking', function () {
    var result = bookings.validateBooking(h.sampleBooking({ ownerName: '  Juan  Dela Cruz ', addons: ['teeth', 'teeth'] }));
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.booking.ownerName, 'Juan Dela Cruz');
    assert.strictEqual(result.booking.email, 'juan@example.com');
    assert.strictEqual(result.booking.minutes, 90);
    assert.deepStrictEqual(result.booking.addons, ['teeth']);
});

test('store keeps records across a reload and writes valid JSON', function () {
    var file = path.join(h.makeDataDir(), 'records.json');
    var store = createStore(file);
    store.add({ id: 1 });
    store.add({ id: 2 });
    assert.deepStrictEqual(createStore(file).all(), [{ id: 1 }, { id: 2 }]);
    assert.strictEqual(fs.existsSync(file + '.tmp'), false);
});

test('a broken data file stops the server with a clear message', function () {
    var dir = h.makeDataDir();
    var file = path.join(dir, 'bookings.json');
    fs.writeFileSync(file, '{ not json');
    assert.throws(function () { createStore(file); }, /is not valid JSON/);

    fs.writeFileSync(file, '{"a": 1}');
    assert.throws(function () { createStore(file); }, /should contain a JSON list/);

    fs.writeFileSync(file, '   ');
    assert.deepStrictEqual(createStore(file).all(), []);
});

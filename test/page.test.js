// Page tests: runs the real index.html and script.js in jsdom (a
// browser simulation) against the Express server, and clicks through
// the same steps a visitor would.

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;
var h = require('./helpers');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/, '');
var SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
var DATE = h.futureDate(10);
var dataDir = h.makeDataDir();
var app;

test.before(async function () {
    app = await h.startServer({ dataDir: dataDir, rateLimit: { max: 1000, windowMs: 60000 } });
});
test.after(function () {
    return app.stop();
});

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitFor(fn, ms) {
    var end = Date.now() + (ms || 10000);
    while (Date.now() < end) {
        if (fn()) return true;
        await sleep(25);
    }
    throw new Error('Timed out waiting for: ' + fn.toString());
}

// options.url: page address. options.beforeScript(window): runs before
// script.js, for example to put a saved draft in localStorage.
// options.fetch: replace fetch, for example to simulate the network down.
// Resolves once the page has started, like a real page load.
async function openPage(options) {
    options = options || {};
    var dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: options.url || app.baseUrl + '/' });
    var w = dom.window;
    var requests = [];

    w.fetch = options.fetch || function (url, opts) {
        var absolute = new URL(url, w.location.href).href;
        requests.push({ url: absolute, method: (opts && opts.method) || 'GET' });
        return fetch(absolute, opts);
    };
    w.AbortController = AbortController;
    w.Element.prototype.scrollIntoView = function () {};
    if (options.beforeScript) {
        options.beforeScript(w);
    }
    // jsdom fires DOMContentLoaded by itself right after this, so the
    // script's listener runs once, the same as in a real browser.
    var loaded = new Promise(function (resolve) {
        w.document.addEventListener('DOMContentLoaded', function () {
            setTimeout(resolve, 0);
        });
    });
    w.eval(SCRIPT);
    await loaded;

    var d = w.document;
    return {
        w: w,
        d: d,
        $: function (sel) { return d.querySelector(sel); },
        requests: requests,
        posts: function () {
            return requests.filter(function (r) { return r.method === 'POST'; });
        }
    };
}

function fillBooking(p, change) {
    change = change || {};
    var values = Object.assign({
        'owner-name': 'Juan Dela Cruz',
        'owner-email': 'juan@example.com',
        'owner-phone': '+639171234567',
        'pet-name': 'Choco',
        'pet-breed': 'Shih Tzu',
        'pet-notes': 'Nervous around water'
    }, change);
    Object.keys(values).forEach(function (id) {
        p.d.getElementById(id).value = values[id];
    });
    p.d.getElementById('size-small').checked = true;
    p.d.getElementById('addon-perfume').checked = true;
    setService(p, change.service || 'bath');
}

function setService(p, value) {
    var select = p.d.getElementById('service-type');
    select.value = value;
    select.dispatchEvent(new p.w.Event('change'));
}

function pickDate(p, date) {
    var input = p.d.getElementById('appointment-date');
    input.value = date;
    input.dispatchEvent(new p.w.Event('change'));
}

function slot(p, time) {
    return p.$('.slot-btn[data-time="' + time + '"]');
}

async function pickSlot(p, time) {
    await waitFor(function () { return slot(p, time); });
    slot(p, time).click();
}

function submitForm(p, id) {
    p.d.getElementById(id).dispatchEvent(new p.w.Event('submit', { cancelable: true }));
}

function visible(p, id) {
    return !p.d.getElementById(id).hidden;
}

function postBooking(change) {
    return fetch(app.baseUrl + '/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(h.sampleBooking(Object.assign({ date: DATE }, change)))
    }).then(function (r) { return r.json(); });
}

// ---------------------------------------------------------
// Booking flow
// ---------------------------------------------------------
test('slots load from the server with a loading message first', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    assert.match(p.$('#time-slot-list').textContent, /Checking open times/);
    assert.strictEqual(p.$('#time-slot-list').getAttribute('aria-busy'), 'true');
    await waitFor(function () { return slot(p, '09:00'); });
    assert.strictEqual(slot(p, '09:00').disabled, false);
    assert.strictEqual(p.$('#time-slot-list').getAttribute('aria-busy'), 'false');
});

test('the review step shows the details and sends nothing yet', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await pickSlot(p, '09:00');
    submitForm(p, 'booking-form');

    assert.ok(visible(p, 'booking-review'));
    assert.ok(!visible(p, 'booking-form'));
    assert.strictEqual(p.posts().length, 0);
    var review = p.$('#review-details').textContent;
    assert.match(review, /Juan Dela Cruz/);
    assert.match(review, /9:00 AM/);
    assert.match(review, /Pet Cologne/);
    assert.strictEqual(p.d.activeElement.id, 'review-heading');

    // Edit goes back with everything still filled in.
    p.$('#review-edit-btn').click();
    assert.ok(visible(p, 'booking-form'));
    assert.strictEqual(p.d.getElementById('owner-name').value, 'Juan Dela Cruz');
    assert.strictEqual(p.d.getElementById('appointment-time').value, '09:00');
});

test('confirming saves the booking and shows its ID', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await pickSlot(p, '09:00');
    submitForm(p, 'booking-form');
    // A quick double click must still send only one booking.
    p.$('#review-confirm-btn').click();
    p.$('#review-confirm-btn').click();

    var btn = p.$('#review-confirm-btn');
    assert.ok(btn.disabled);
    assert.match(btn.textContent, /Saving/);

    await waitFor(function () { return visible(p, 'booking-confirmation'); });
    assert.strictEqual(p.posts().length, 1);
    var details = p.$('#confirmation-details').textContent;
    var id = details.match(/PC-\d{8}-[0-9A-F]{4}/);
    assert.ok(id, details);
    assert.strictEqual(p.d.activeElement.id, 'confirmation-heading');
    // Find My Booking is filled in, ready for later.
    assert.strictEqual(p.d.getElementById('find-id').value, id[0]);
    assert.strictEqual(p.d.getElementById('find-email').value, 'juan@example.com');
});

test('a new visitor sees the booked slot and its buffer greyed out', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await waitFor(function () { return slot(p, '09:00'); });
    assert.ok(slot(p, '09:00').disabled);
    assert.match(slot(p, '09:00').getAttribute('aria-label'), /not available/);
    assert.ok(slot(p, '09:30').disabled);
    assert.ok(!slot(p, '10:00').disabled);
});

test('if someone else takes the slot, the visitor is sent back to pick another', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await pickSlot(p, '10:00');
    submitForm(p, 'booking-form');

    await postBooking({ service: 'bath', time: '10:00', ownerName: 'Other Client' });
    p.$('#review-confirm-btn').click();

    await waitFor(function () { return visible(p, 'booking-form') && visible(p, 'time-error'); });
    assert.match(p.$('#time-error').textContent, /just booked/);
    assert.strictEqual(p.d.activeElement.id, 'appointment-date');
    await waitFor(function () { return slot(p, '10:00') && slot(p, '10:00').disabled; });
    assert.strictEqual(p.d.getElementById('appointment-time').value, '');
});

test('fields the server rejects are flagged and focused', async function () {
    var p = await openPage();
    // The form doesn't limit breed length, but the server does.
    fillBooking(p, { 'pet-breed': 'x'.repeat(70) });
    pickDate(p, DATE);
    await pickSlot(p, '11:00');
    submitForm(p, 'booking-form');
    p.$('#review-confirm-btn').click();

    await waitFor(function () { return visible(p, 'booking-form') && visible(p, 'booking-error'); });
    assert.match(p.$('#booking-error').textContent, /breed/);
    assert.strictEqual(p.d.getElementById('pet-breed').getAttribute('aria-invalid'), 'true');
    assert.strictEqual(p.d.activeElement.id, 'pet-breed');

    // Typing in the field clears its flag.
    p.d.getElementById('pet-breed').dispatchEvent(new p.w.Event('input', { bubbles: true }));
    assert.strictEqual(p.d.getElementById('pet-breed').getAttribute('aria-invalid'), null);
});

test('bad input is stopped in the browser before anything is sent', async function () {
    var p = await openPage();
    fillBooking(p, { 'owner-phone': '0917' });
    submitForm(p, 'booking-form');
    await sleep(100);
    assert.ok(!visible(p, 'booking-review'));
    assert.ok(visible(p, 'time-error'));
    assert.strictEqual(p.posts().length, 0);
});

test('when the server is down, the visitor can retry from the review step', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await pickSlot(p, '13:00');
    submitForm(p, 'booking-form');

    p.w.API_BASE = 'http://localhost:1/api';
    p.$('#review-confirm-btn').click();
    await waitFor(function () { return visible(p, 'review-error'); });
    assert.match(p.$('#review-error').textContent, /Could not reach/);
    assert.strictEqual(p.$('#review-confirm-btn').textContent, 'Try Again');
    assert.ok(!p.$('#review-confirm-btn').disabled);

    // Server back: the same button finishes the booking.
    p.w.API_BASE = '/api';
    p.$('#review-confirm-btn').click();
    await waitFor(function () { return visible(p, 'booking-confirmation'); });
});

test('a slot list that fails to load offers a Try again button', async function () {
    var p = await openPage();
    p.w.API_BASE = 'http://localhost:1/api';
    pickDate(p, DATE);
    await waitFor(function () { return p.$('.slot-retry'); });
    p.w.API_BASE = '/api';
    p.$('.slot-retry').click();
    await waitFor(function () { return slot(p, '14:00'); });
});

test('a timed-out booking that was saved anyway is not booked twice on retry', async function () {
    var p = await openPage();
    fillBooking(p, { 'owner-name': 'Slow Network' });
    pickDate(p, DATE);
    await pickSlot(p, '14:00');
    submitForm(p, 'booking-form');

    p.w.REQUEST_TIMEOUT_MS = 1;
    p.$('#review-confirm-btn').click();
    await waitFor(function () { return visible(p, 'review-error'); });
    assert.match(p.$('#review-error').textContent, /took too long/);

    await sleep(300);
    p.w.REQUEST_TIMEOUT_MS = 15000;
    p.$('#review-confirm-btn').click();
    await waitFor(function () { return visible(p, 'booking-confirmation'); });

    var saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'bookings.json'), 'utf8'));
    var mine = saved.filter(function (b) { return b.ownerName === 'Slow Network'; });
    assert.strictEqual(mine.length, 1);
});

test('the GitHub Pages copy explains that booking needs the server', async function () {
    var p = await openPage({
        url: 'https://jcspades21.github.io/pawcare-bookings-solo/',
        fetch: function () { return Promise.reject(new TypeError('Failed to fetch')); }
    });
    pickDate(p, DATE);
    await waitFor(function () { return p.$('.slot-retry'); });
    assert.match(p.$('#time-slot-list').textContent, /Express server/);
});

// ---------------------------------------------------------
// Saved draft
// ---------------------------------------------------------
test('a half-filled form is restored after a refresh, and can be cleared', async function () {
    var p = await openPage();
    p.d.getElementById('owner-name').value = 'Draft Person';
    p.d.getElementById('owner-name').dispatchEvent(new p.w.Event('input', { bubbles: true }));
    var saved = p.w.localStorage.getItem('pawcare-booking-draft');
    assert.match(saved, /Draft Person/);

    // A new page with the same browser storage.
    var p2 = await openPage({ beforeScript: function (w) { w.localStorage.setItem('pawcare-booking-draft', saved); } });
    assert.strictEqual(p2.d.getElementById('owner-name').value, 'Draft Person');
    assert.ok(visible(p2, 'draft-status'));

    p2.$('#draft-clear-btn').click();
    assert.strictEqual(p2.d.getElementById('owner-name').value, '');
    assert.strictEqual(p2.w.localStorage.getItem('pawcare-booking-draft'), null);
    assert.ok(!visible(p2, 'draft-status'));
});

test('the draft is removed once the booking is saved', async function () {
    var p = await openPage();
    fillBooking(p);
    pickDate(p, DATE);
    await pickSlot(p, '15:00');
    assert.ok(p.w.localStorage.getItem('pawcare-booking-draft'));
    submitForm(p, 'booking-form');
    p.$('#review-confirm-btn').click();
    await waitFor(function () { return visible(p, 'booking-confirmation'); });
    assert.strictEqual(p.w.localStorage.getItem('pawcare-booking-draft'), null);
});

// ---------------------------------------------------------
// Find My Booking and Contact Us
// ---------------------------------------------------------
test('Find My Booking shows a booking for the right ID and email only', async function () {
    var made = await postBooking({ service: 'nail-trim', time: '16:00' });
    var p = await openPage();

    p.d.getElementById('find-id').value = made.bookingId.toLowerCase();
    p.d.getElementById('find-email').value = 'juan@example.com';
    submitForm(p, 'find-booking-form');
    await waitFor(function () { return visible(p, 'find-result'); });
    var details = p.$('#find-details').textContent;
    assert.match(details, new RegExp(made.bookingId));
    assert.match(details, /4:00 PM/);
    assert.match(details, /Pending/);

    p.d.getElementById('find-email').value = 'wrong@example.com';
    submitForm(p, 'find-booking-form');
    await waitFor(function () { return visible(p, 'find-error'); });
    assert.ok(!visible(p, 'find-result'));
    assert.match(p.$('#find-error').textContent, /couldn't find/);
});

test('the contact form sends the message and shows a reference', async function () {
    var p = await openPage();
    p.d.getElementById('contact-name').value = 'Maria Santos';
    p.d.getElementById('contact-email').value = 'maria@example.com';
    p.d.getElementById('contact-via-phone').checked = true;
    p.d.getElementById('contact-message').value = 'Do you groom cats?';
    submitForm(p, 'contact-form');

    var status = p.$('#contact-status');
    await waitFor(function () { return /Reference: MSG-/.test(status.textContent); });
    assert.strictEqual(p.d.getElementById('contact-message').value, '');
    assert.strictEqual(p.posts().length, 1);
});

// ---------------------------------------------------------
// Accessibility basics
// ---------------------------------------------------------
test('every visible form control has a label', async function () {
    var p = await openPage();
    var controls = p.d.querySelectorAll('input:not([type="hidden"]), select, textarea');
    controls.forEach(function (el) {
        if (el.closest('.hp-field')) {
            return;
        }
        var label = p.$('label[for="' + el.id + '"]');
        assert.ok(label && label.textContent.trim(), 'No label for #' + el.id);
    });
});

test('the page has a skip link and labelled navigation', async function () {
    var p = await openPage();
    var skip = p.$('.skip-link');
    assert.strictEqual(skip.getAttribute('href'), '#main');
    assert.ok(p.$('main#main'));
    p.d.querySelectorAll('nav').forEach(function (nav) {
        assert.ok(nav.getAttribute('aria-label'));
    });
});

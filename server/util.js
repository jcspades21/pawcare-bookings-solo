// =========================================================
// PawCare Bookings: small shared helpers
// =========================================================

var crypto = require('crypto');
var config = require('./config');

// The shop is in Manila, so "today" and "now" use Manila time no
// matter where the server runs.
function manilaNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', {
        timeZone: config.timeZone,
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

function isEmail(text) {
    return text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

// Trims and collapses whitespace. Anything that isn't a string counts
// as empty, so a field sent as a number or object fails validation.
function cleanText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\s+/g, ' ').trim();
}

// Optional ID the browser sends so a retry can be matched to the first try.
function cleanRequestId(value) {
    var id = cleanText(value);
    return /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '';
}

function makeId(prefix) {
    return prefix + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function fail(status, code, message) {
    return { status: status, body: { ok: false, error: code, message: message } };
}

module.exports = {
    manilaNow: manilaNow,
    toMinutes: toMinutes,
    isRealDate: isRealDate,
    addDays: addDays,
    isEmail: isEmail,
    cleanText: cleanText,
    cleanRequestId: cleanRequestId,
    makeId: makeId,
    fail: fail
};

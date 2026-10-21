// =========================================================
// PawCare Bookings: contact form messages
//
// Saves questions sent from the Contact Us form so the shop owner
// can read and answer them later.
// =========================================================

var config = require('./config');
var util = require('./util');

function validateMessage(data) {
    var errors = [];
    var message = {};

    message.name = util.cleanText(data.name);
    if (message.name.length < 2 || message.name.length > 100) {
        errors.push('full name');
    }

    message.email = util.cleanText(data.email).toLowerCase();
    if (!util.isEmail(message.email)) {
        errors.push('email address');
    }

    // Optional, but if it's sent it has to be one of the choices.
    message.contactMethod = util.cleanText(data.contactMethod);
    if (message.contactMethod && config.contactMethods.indexOf(message.contactMethod) === -1) {
        errors.push('contact method');
    }

    // Keep line breaks in the message, only trim the ends.
    message.text = typeof data.message === 'string' ? data.message.trim() : '';
    if (message.text.length < 1 || message.text.length > 500) {
        errors.push('message');
    }

    message.requestId = util.cleanRequestId(data.requestId);

    return { errors: errors, message: message };
}

function saveMessage(store, message) {
    if (message.requestId) {
        var saved = store.all().find(function (m) {
            return m.requestId === message.requestId;
        });
        if (saved) {
            return { status: 200, body: { ok: true, messageId: saved.messageId } };
        }
    }

    var record = store.add({
        messageId: util.makeId('MSG-' + util.manilaNow().date.replace(/-/g, '')),
        receivedAt: util.manilaNow().stamp,
        name: message.name,
        email: message.email,
        contactMethod: message.contactMethod,
        message: message.text,
        status: 'new',
        requestId: message.requestId
    });

    return { status: 201, body: { ok: true, messageId: record.messageId } };
}

module.exports = {
    validateMessage: validateMessage,
    saveMessage: saveMessage
};

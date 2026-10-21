// Shared setup for the API and page tests: starts the Express app on
// a free port with its own temporary data folder.

var fs = require('fs');
var os = require('os');
var path = require('path');
var createApp = require('../server/server');
var util = require('../server/util');

function makeDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pawcare-'));
}

function startServer(options) {
    return new Promise(function (resolve) {
        var server = createApp(options).listen(0, function () {
            resolve({
                server: server,
                baseUrl: 'http://localhost:' + server.address().port,
                stop: function () {
                    return new Promise(function (done) {
                        server.close(done);
                    });
                }
            });
        });
    });
}

// A date a week from now in Manila time, so tests never hit "today".
function futureDate(days) {
    return util.addDays(util.manilaNow().date, days || 7);
}

function sampleBooking(change) {
    return Object.assign({
        ownerName: 'Juan Dela Cruz',
        email: 'Juan@Example.com',
        phone: '+639171234567',
        petName: 'Bantay',
        breed: 'Aspin',
        petSize: 'medium',
        service: 'full-groom',
        date: futureDate(7),
        time: '09:00',
        addons: ['teeth'],
        notes: 'Nervous around water',
        website: ''
    }, change || {});
}

module.exports = {
    makeDataDir: makeDataDir,
    startServer: startServer,
    futureDate: futureDate,
    sampleBooking: sampleBooking
};

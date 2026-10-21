// =========================================================
// PawCare Bookings: JSON file storage
//
// Keeps a list of records in memory and writes it to a JSON file
// after every change, so reads are fast and the data is still there
// after the server restarts. Used for bookings and contact messages.
//
// Edit the JSON files only while the server is stopped. A running
// server keeps its own copy in memory and would overwrite the edit.
// =========================================================

var fs = require('fs');
var path = require('path');

function createStore(filePath) {
    var records = readFile(filePath);

    function all() {
        return records;
    }

    function add(record) {
        records.push(record);
        writeFile(filePath, records);
        return record;
    }

    return { all: all, add: add, filePath: filePath };
}

// Reads the file once at startup. A broken file stops the server with
// a clear message instead of quietly starting over with no data.
function readFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    var text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) {
        return [];
    }

    var data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(filePath + ' is not valid JSON (' + err.message + '). Fix or move the file, then start again.');
    }
    if (!Array.isArray(data)) {
        throw new Error(filePath + ' should contain a JSON list, like [].');
    }
    return data;
}

// Write to a temp file first, then rename it over the real one, so a
// crash halfway through can't leave a broken file behind.
function writeFile(filePath, records) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    var tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(records, null, 2));
    fs.renameSync(tempPath, filePath);
}

module.exports = { createStore: createStore };

// =========================================================
// PawCare Bookings: frontend behavior
//
// Three interactions, tied directly to High-priority items in
// the Workflow Worksheet's "Planned Interaction Areas":
//   1. Service Selection  -> syncs the service cards with the booking form
//   2. Time Slot Picker   -> loads booked times for a date from the backend
//   3. Booking Confirmation -> validates the form, saves it to the backend,
//                              then shows the booking ID
// Plus a small character counter on the Contact form's message field.
//
// The backend is a Google Apps Script web app (apps-script/Code.gs)
// that stores bookings in a Google Sheet. Requests are sent as
// text/plain so the browser does not need a CORS preflight, which
// Apps Script cannot answer.
// =========================================================

// Paste the web app URL from Apps Script > Deploy > Manage deployments.
var BOOKING_API_URL = 'https://script.google.com/macros/s/AKfycbyPsjHwXaJih6S5BWE-6MiRq-gW8_1f0xb6_LPEjkt-CCVBQv9fqZzdpGgusY1KwVI/exec';
var REQUEST_TIMEOUT_MS = 15000;

document.addEventListener('DOMContentLoaded', function () {
    initServiceSelection();
    initTimeSlotPicker();
    initBookingForm();
    initContactCharCounter();
    initContactForm();
});

// ---------------------------------------------------------
// Backend requests
// ---------------------------------------------------------

// Calls the Apps Script web app and resolves with its JSON reply.
// Rejects with a plain message the page can show to the visitor.
function callBookingApi(method, query, payload) {
    if (!BOOKING_API_URL) {
        return Promise.reject(new Error('Online booking is not set up yet. Please call the shop to book.'));
    }

    var controller = new AbortController();
    var timer = window.setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    var options = { method: method, signal: controller.signal };
    if (payload) {
        options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        options.body = JSON.stringify(payload);
    }

    return fetch(BOOKING_API_URL + (query || ''), options)
        .then(function (response) {
            if (!response.ok) {
                throw new Error('bad status');
            }
            return response.json();
        })
        .catch(function (err) {
            var message = err.name === 'AbortError'
                ? 'The booking system took too long to answer. Please try again.'
                : 'Could not reach the booking system. Check your connection and try again.';
            throw new Error(message);
        })
        .finally(function () {
            window.clearTimeout(timer);
        });
}

function toMinutes(time24) {
    var parts = time24.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ---------------------------------------------------------
// 1. Service Selection -> Booking Form sync
// ---------------------------------------------------------
function initServiceSelection() {
    var serviceSelect = document.getElementById('service-type');
    var statusEl = document.getElementById('service-select-status');
    var selectLinks = document.querySelectorAll('.select-service-link');

    function announceSelection() {
        var chosenOption = serviceSelect.options[serviceSelect.selectedIndex];
        statusEl.textContent = 'Selected service: ' + chosenOption.text;
    }

    // Respond to clicking "Select This Service" on a service card.
    selectLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            var serviceValue = link.dataset.service;
            serviceSelect.value = serviceValue;
            serviceSelect.dispatchEvent(new Event('change'));
            announceSelection();
        });
    });

    // Also keep the status text in sync if the visitor changes the
    // dropdown directly instead of using a card link.
    serviceSelect.addEventListener('change', announceSelection);
}

// ---------------------------------------------------------
// 2. Time Slot Picker
// ---------------------------------------------------------
function initTimeSlotPicker() {
    var dateInput = document.getElementById('appointment-date');
    var serviceSelect = document.getElementById('service-type');
    var slotList = document.getElementById('time-slot-list');
    var hiddenTimeInput = document.getElementById('appointment-time');
    var selectedTimeDisplay = document.getElementById('selected-time-display');
    var dateError = document.getElementById('date-error');
    var timeError = document.getElementById('time-error');

    // 30-minute slots, 9AM-5PM, with a 12:00-1:00 lunch break carved out.
    var SLOT_TIMES = [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ];
    var SERVICE_DURATIONS = {
        bath: 30,
        'full-groom': 90,
        'nail-trim': 20
    };

    function getTodayString() {
        var today = new Date();
        var month = String(today.getMonth() + 1).padStart(2, '0');
        var day = String(today.getDate()).padStart(2, '0');
        return today.getFullYear() + '-' + month + '-' + day;
    }

    function isAllowedDate(dateStr) {
        return dateStr && dateStr >= dateInput.min;
    }

    function getAvailableSlotTimes(serviceValue) {
        var duration = SERVICE_DURATIONS[serviceValue] || 30;
        var closingTime = 17 * 60;
        var bufferMinutes = 15;

        return SLOT_TIMES.filter(function (time) {
            var parts = time.split(':');
            var startMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            return startMinutes + duration + bufferMinutes <= closingTime;
        });
    }

    function formatTime12h(time24) {
        var parts = time24.split(':');
        var hour = parseInt(parts[0], 10);
        var minute = parts[1];
        var suffix = hour >= 12 ? 'PM' : 'AM';
        var hour12 = hour % 12 === 0 ? 12 : hour % 12;
        return hour12 + ':' + minute + ' ' + suffix;
    }

    // A slot is taken if the new appointment (plus the 15-minute
    // sanitation buffer) would overlap an existing one.
    function isSlotTaken(time, duration, bookings) {
        var start = toMinutes(time);
        var end = start + duration + 15;
        return bookings.some(function (b) {
            var otherStart = toMinutes(b.time);
            var otherEnd = otherStart + b.minutes + 15;
            return start < otherEnd && otherStart < end;
        });
    }

    // Slots earlier than the current time can't be booked for today.
    function isSlotPast(dateStr, time) {
        if (dateStr !== getTodayString()) {
            return false;
        }
        var now = new Date();
        return toMinutes(time) <= now.getHours() * 60 + now.getMinutes();
    }

    function clearSelection() {
        hiddenTimeInput.value = '';
        selectedTimeDisplay.textContent = '';
    }

    function showSlotMessage(text, withRetry) {
        slotList.innerHTML = '';
        var li = document.createElement('li');
        li.className = 'slot-placeholder';
        li.textContent = text;
        if (withRetry) {
            var retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'slot-retry';
            retry.textContent = 'Try again';
            retry.addEventListener('click', function () {
                renderSlots(dateInput.value);
            });
            li.appendChild(document.createTextNode(' '));
            li.appendChild(retry);
        }
        slotList.appendChild(li);
    }

    // Each load gets a number so a slow reply for an old date can't
    // overwrite the slots for the date the visitor picked last.
    var latestLoad = 0;

    // Bookings from the last successful load, reused when only the
    // service changes so we don't ask the backend again.
    var lastLoaded = null;

    function renderSlots(dateStr) {
        clearSelection();
        showSlotMessage('Checking open times...', false);

        var loadNumber = ++latestLoad;

        callBookingApi('GET', '?action=slots&date=' + encodeURIComponent(dateStr))
            .then(function (reply) {
                if (loadNumber !== latestLoad) {
                    return;
                }
                if (!reply.ok) {
                    showSlotMessage(reply.message || 'Could not load open times.', true);
                    return;
                }
                lastLoaded = { date: dateStr, bookings: reply.booked || [] };
                drawSlots(dateStr, lastLoaded.bookings);
            })
            .catch(function (err) {
                if (loadNumber === latestLoad) {
                    showSlotMessage(err.message, true);
                }
            });
    }

    function drawSlots(dateStr, bookings) {
        slotList.innerHTML = '';

        var duration = SERVICE_DURATIONS[serviceSelect.value] || 30;
        var availableSlotTimes = getAvailableSlotTimes(serviceSelect.value);

        availableSlotTimes.forEach(function (time) {
            var li = document.createElement('li');
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'slot-btn';
            button.textContent = formatTime12h(time);
            button.dataset.time = time;
            button.setAttribute('aria-pressed', 'false');

            var isBooked = isSlotTaken(time, duration, bookings) || isSlotPast(dateStr, time);

            if (isBooked) {
                button.classList.add('slot-booked');
                button.disabled = true;
                button.setAttribute('aria-label', formatTime12h(time) + ', not available');
            } else {
                button.addEventListener('click', function () {
                    var allButtons = slotList.querySelectorAll('.slot-btn');
                    allButtons.forEach(function (b) {
                        b.classList.remove('slot-selected');
                        b.setAttribute('aria-pressed', 'false');
                    });
                    button.classList.add('slot-selected');
                    button.setAttribute('aria-pressed', 'true');
                    hiddenTimeInput.value = time;
                    selectedTimeDisplay.textContent = 'Selected time: ' + formatTime12h(time);
                    timeError.hidden = true;
                });
            }

            li.appendChild(button);
            slotList.appendChild(li);
        });

        if (!slotList.querySelector('.slot-btn:not(:disabled)')) {
            showSlotMessage('No open times left on this date. Please pick another day.', false);
        }
    }

    dateInput.addEventListener('change', function () {
        var value = dateInput.value;

        // Ignore any load still in flight for the previous date.
        latestLoad++;

        if (!value) {
            slotList.innerHTML = '<li class="slot-placeholder">Select a date above to see open time slots.</li>';
            clearSelection();
            return;
        }

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var chosenDate = new Date(value + 'T00:00:00');

        // Condition: reject dates in the past before generating slots.
        if (!isAllowedDate(value) || chosenDate < today) {
            dateError.hidden = false;
            dateInput.setAttribute('aria-invalid', 'true');
            slotList.innerHTML = '<li class="slot-placeholder">Please choose today or a later date to see open time slots.</li>';
            clearSelection();
            return;
        }

        dateError.hidden = true;
        dateInput.removeAttribute('aria-invalid');
        renderSlots(value);
    });

    dateInput.min = getTodayString();
    serviceSelect.addEventListener('change', function () {
        if (!isAllowedDate(dateInput.value)) {
            return;
        }
        if (lastLoaded && lastLoaded.date === dateInput.value) {
            clearSelection();
            drawSlots(dateInput.value, lastLoaded.bookings);
        } else {
            renderSlots(dateInput.value);
        }
    });
}

// ---------------------------------------------------------
// 3. Booking Form validation + Confirmation Message
// ---------------------------------------------------------
function initBookingForm() {
    var form = document.querySelector('#book form');
    var petSizeRadios = form.querySelectorAll('input[name="pet-size"]');
    var petSizeError = document.getElementById('pet-size-error');
    var timeInput = document.getElementById('appointment-time');
    var timeError = document.getElementById('time-error');
    var confirmationBox = document.getElementById('booking-confirmation');
    var detailsList = document.getElementById('confirmation-details');
    var slotList = document.getElementById('time-slot-list');
    var selectedTimeDisplay = document.getElementById('selected-time-display');
    var bookAnotherBtn = document.getElementById('book-another-btn');
    var dateInput = document.getElementById('appointment-date');
    var dateError = document.getElementById('date-error');
    var submitBtn = form.querySelector('button[type="submit"]');
    var bookingError = document.getElementById('booking-error');
    var isSending = false;

    function formatTime12h(time24) {
        if (!time24) return '';
        var parts = time24.split(':');
        var hour = parseInt(parts[0], 10);
        var minute = parts[1];
        var suffix = hour >= 12 ? 'PM' : 'AM';
        var hour12 = hour % 12 === 0 ? 12 : hour % 12;
        return hour12 + ':' + minute + ' ' + suffix;
    }

    function addRow(label, value) {
        var dt = document.createElement('dt');
        dt.textContent = label;
        var dd = document.createElement('dd');
        dd.textContent = value;
        detailsList.appendChild(dt);
        detailsList.appendChild(dd);
    }

    function resetBookingState() {
        slotList.innerHTML = '<li class="slot-placeholder">Select a date above to see open time slots.</li>';
        selectedTimeDisplay.textContent = '';
        document.getElementById('service-select-status').textContent = '';
        petSizeError.hidden = true;
        timeError.hidden = true;
        dateError.hidden = true;
        bookingError.hidden = true;
        dateInput.removeAttribute('aria-invalid');
    }

    form.addEventListener('submit', function (event) {
        event.preventDefault();

        var isValid = true;

        // Native required/email/date validity for the standard fields.
        if (!form.checkValidity()) {
            form.reportValidity();
            isValid = false;
        }

        var chosenDate = new Date(dateInput.value + 'T00:00:00');
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!dateInput.value || dateInput.value < dateInput.min || chosenDate < today) {
            dateError.hidden = false;
            dateInput.setAttribute('aria-invalid', 'true');
            isValid = false;
        } else {
            dateError.hidden = true;
            dateInput.removeAttribute('aria-invalid');
        }

        // Custom condition: a radio group's required-ness isn't caught
        // reliably above in every browser, so check pet size explicitly.
        var sizeSelected = Array.prototype.some.call(petSizeRadios, function (radio) {
            return radio.checked;
        });
        if (!sizeSelected) {
            petSizeError.hidden = false;
            isValid = false;
        } else {
            petSizeError.hidden = true;
        }

        // Custom condition: a time slot must be chosen from the
        // generated list (there's no native input to validate this).
        if (!timeInput.value) {
            timeError.hidden = false;
            isValid = false;
        } else {
            timeError.hidden = true;
        }

        if (!isValid || isSending) {
            return;
        }

        sendBooking(buildBooking());
    });

    // Collects the form values in the shape apps-script/Code.gs expects.
    function buildBooking() {
        var addons = [];
        ['perfume', 'teeth', 'deshed'].forEach(function (key) {
            if (document.getElementById('addon-' + key).checked) {
                addons.push(key);
            }
        });

        return {
            ownerName: document.getElementById('owner-name').value,
            email: document.getElementById('owner-email').value,
            phone: document.getElementById('owner-phone').value,
            petName: document.getElementById('pet-name').value,
            breed: document.getElementById('pet-breed').value,
            petSize: form.querySelector('input[name="pet-size"]:checked').value,
            service: document.getElementById('service-type').value,
            date: dateInput.value,
            time: timeInput.value,
            addons: addons,
            notes: document.getElementById('pet-notes').value,
            website: document.getElementById('website').value
        };
    }

    function setSending(sending) {
        isSending = sending;
        submitBtn.disabled = sending;
        submitBtn.textContent = sending ? 'Saving your booking...' : 'Confirm Booking';
    }

    function showBookingError(message) {
        bookingError.textContent = message;
        bookingError.hidden = false;
    }

    function sendBooking(booking) {
        bookingError.hidden = true;
        setSending(true);

        callBookingApi('POST', '', booking)
            .then(function (reply) {
                if (!reply.ok) {
                    showBookingError(reply.message || 'Your booking could not be saved. Please try again.');
                    if (reply.error === 'slot_taken') {
                        // Reload the slots so the taken time shows as unavailable.
                        dateInput.dispatchEvent(new Event('change'));
                    }
                    return;
                }
                showConfirmation(booking, reply.bookingId);
            })
            .catch(function (err) {
                showBookingError(err.message);
            })
            .finally(function () {
                setSending(false);
            });
    }

    // Only runs after the backend says the booking row was saved.
    function showConfirmation(booking, bookingId) {
        var serviceSelect = document.getElementById('service-type');
        var serviceText = serviceSelect.options[serviceSelect.selectedIndex].text;

        detailsList.innerHTML = '';
        addRow('Booking ID', bookingId);
        addRow('Owner', booking.ownerName);
        addRow('Pet', booking.petName + ' (' + booking.petSize + ')');
        addRow('Service', serviceText);
        addRow('Date', booking.date);
        addRow('Time', formatTime12h(booking.time));

        form.hidden = true;
        confirmationBox.hidden = false;
        confirmationBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    bookAnotherBtn.addEventListener('click', function () {
        form.reset();
        resetBookingState();
        form.hidden = false;
        confirmationBox.hidden = true;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    form.addEventListener('reset', function () {
        resetBookingState();
    });
}

// ---------------------------------------------------------
// Contact form: live character counter
// ---------------------------------------------------------
function initContactCharCounter() {
    var textarea = document.getElementById('contact-message');
    var counter = document.getElementById('message-char-count');
    var MAX_LENGTH = 500;

    function updateCount() {
        counter.textContent = textarea.value.length + ' / ' + MAX_LENGTH + ' characters';
    }

    textarea.addEventListener('input', updateCount);
    textarea.form.addEventListener('reset', function () {
        window.setTimeout(updateCount, 0);
    });
    updateCount();
}

// Contact form: show a frontend-only submission confirmation.
function initContactForm() {
    var form = document.querySelector('#contact form');
    var status = document.getElementById('contact-status');

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        form.reset();
        status.textContent = 'Thanks for your message. We will get back to you soon.';
    });

    form.addEventListener('reset', function () {
        status.textContent = '';
    });
}

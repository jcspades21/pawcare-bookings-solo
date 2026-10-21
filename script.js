// =========================================================
// PawCare Bookings: frontend behavior
//
// Interactions, tied to the Workflow Worksheet's "Planned
// Interaction Areas":
//   1. Service Selection -> syncs the service cards with the booking form
//   2. Time Slot Picker  -> loads booked times for a date from the backend
//   3. Booking Form      -> checks the form, shows a review step, saves the
//                           booking, then shows the booking ID
//   4. Find My Booking   -> looks up a booking by ID and email
//   5. Contact Form      -> sends a message to the backend, with a
//                           live character counter
//
// The backend is an Express.js server (server/server.js) that also
// serves this page, so the API is on the same address at /api.
// =========================================================

var API_BASE = '/api';
var REQUEST_TIMEOUT_MS = 15000;

// The shop's rules. These defaults match server/config.js and are
// replaced by GET /api/config when the server answers, so the server
// stays the one place where services and hours are defined.
var SHOP = {
    slotTimes: [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ],
    closingMinutes: 17 * 60,
    bufferMinutes: 15,
    maxDaysAhead: 365,
    durations: { bath: 30, 'full-groom': 90, 'nail-trim': 20 }
};

document.addEventListener('DOMContentLoaded', function () {
    initServiceSelection();
    var slotPicker = initTimeSlotPicker();
    initBookingForm(slotPicker);
    initFindBooking();
    initContactCharCounter();
    initContactForm();
    loadShopConfig(slotPicker);
});

// ---------------------------------------------------------
// Backend requests
// ---------------------------------------------------------

// Calls the Express API and resolves with its JSON reply, including
// replies like { ok: false, error: 'slot_taken' } that come with an
// error status code. Rejects with a plain message the page can show
// when the server can't be reached at all.
function callApi(method, path, payload) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    var options = { method: method, signal: controller.signal };
    if (payload) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(payload);
    }

    return fetch(API_BASE + path, options)
        .then(function (response) {
            return response.json().then(function (reply) {
                if (!reply || typeof reply.ok !== 'boolean') {
                    throw new Error('unexpected reply');
                }
                return reply;
            });
        })
        .catch(function (err) {
            var message;
            if (err.name === 'AbortError') {
                message = 'The booking system took too long to answer. Please try again.';
            } else if (/\.github\.io$/.test(window.location.hostname)) {
                // GitHub Pages only hosts the static files, not the server.
                message = 'Online booking runs on the Express server. This GitHub Pages copy only shows the frontend.';
            } else {
                message = 'Could not reach the booking system. Check your connection and try again.';
            }
            throw new Error(message);
        })
        .finally(function () {
            window.clearTimeout(timer);
        });
}

function loadShopConfig(slotPicker) {
    callApi('GET', '/config')
        .then(function (reply) {
            if (!reply.ok) {
                return;
            }
            SHOP.slotTimes = reply.slotTimes;
            SHOP.closingMinutes = toMinutes(reply.closingTime);
            SHOP.bufferMinutes = reply.bufferMinutes;
            SHOP.maxDaysAhead = reply.maxDaysAhead;
            SHOP.durations = {};
            Object.keys(reply.services).forEach(function (key) {
                SHOP.durations[key] = reply.services[key].minutes;
            });
            slotPicker.refresh();
        })
        .catch(function () {
            // Keep the built-in defaults. The slot picker shows its own
            // message if the server is down.
        });
}

// A short ID that stays the same when the same form is sent again,
// so the server can tell a retry from a new request.
function makeRequestId() {
    if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
function toMinutes(time24) {
    var parts = time24.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatTime12h(time24) {
    if (!time24) return '';
    var parts = time24.split(':');
    var hour = parseInt(parts[0], 10);
    var minute = parts[1];
    var suffix = hour >= 12 ? 'PM' : 'AM';
    var hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return hour12 + ':' + minute + ' ' + suffix;
}

// Local date as YYYY-MM-DD, optionally a number of days from today.
function localDateString(daysFromToday) {
    var d = new Date();
    d.setDate(d.getDate() + (daysFromToday || 0));
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + month + '-' + day;
}

function fillDetails(list, rows) {
    list.innerHTML = '';
    rows.forEach(function (row) {
        var dt = document.createElement('dt');
        dt.textContent = row[0];
        var dd = document.createElement('dd');
        dd.textContent = row[1];
        list.appendChild(dt);
        list.appendChild(dd);
    });
}

// Moves keyboard and screen reader focus to an element and brings it
// into view, without the smooth scroll for people who turned motion off.
function moveFocusTo(el) {
    if (!el) {
        return;
    }
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
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

    function isAllowedDate(dateStr) {
        return dateStr && dateStr >= dateInput.min && dateStr <= dateInput.max;
    }

    // Start times where the service plus its buffer ends by closing time.
    function getAvailableSlotTimes(serviceValue) {
        var duration = SHOP.durations[serviceValue] || 30;
        return SHOP.slotTimes.filter(function (time) {
            return toMinutes(time) + duration + SHOP.bufferMinutes <= SHOP.closingMinutes;
        });
    }

    // A slot is taken if the new appointment (plus the sanitation
    // buffer) would overlap an existing one.
    function isSlotTaken(time, duration, bookings) {
        var start = toMinutes(time);
        var end = start + duration + SHOP.bufferMinutes;
        return bookings.some(function (b) {
            var otherStart = toMinutes(b.time);
            var otherEnd = otherStart + b.minutes + SHOP.bufferMinutes;
            return start < otherEnd && otherStart < end;
        });
    }

    // Slots earlier than the current time can't be booked for today.
    function isSlotPast(dateStr, time) {
        if (dateStr !== localDateString(0)) {
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

    // keepTime: try to keep the chosen slot selected after reloading.
    function renderSlots(dateStr, keepTime) {
        var wanted = keepTime ? hiddenTimeInput.value : '';
        clearSelection();
        showSlotMessage('Checking open times...', false);
        slotList.setAttribute('aria-busy', 'true');

        var loadNumber = ++latestLoad;

        callApi('GET', '/slots?date=' + encodeURIComponent(dateStr))
            .then(function (reply) {
                if (loadNumber !== latestLoad) {
                    return;
                }
                if (!reply.ok) {
                    showSlotMessage(reply.message || 'Could not load open times.', true);
                    return;
                }
                lastLoaded = { date: dateStr, bookings: reply.booked || [] };
                drawSlots(dateStr, lastLoaded.bookings, wanted);
            })
            .catch(function (err) {
                if (loadNumber === latestLoad) {
                    showSlotMessage(err.message, true);
                }
            })
            .finally(function () {
                if (loadNumber === latestLoad) {
                    slotList.setAttribute('aria-busy', 'false');
                }
            });
    }

    function selectSlot(button, time) {
        slotList.querySelectorAll('.slot-btn').forEach(function (b) {
            b.classList.remove('slot-selected');
            b.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('slot-selected');
        button.setAttribute('aria-pressed', 'true');
        hiddenTimeInput.value = time;
        selectedTimeDisplay.textContent = 'Selected time: ' + formatTime12h(time);
        timeError.hidden = true;
        slotList.removeAttribute('aria-invalid');
        hiddenTimeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function drawSlots(dateStr, bookings, wantedTime) {
        slotList.innerHTML = '';

        var duration = SHOP.durations[serviceSelect.value] || 30;

        getAvailableSlotTimes(serviceSelect.value).forEach(function (time) {
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
                    selectSlot(button, time);
                });
            }

            li.appendChild(button);
            slotList.appendChild(li);

            if (!isBooked && time === wantedTime) {
                selectSlot(button, time);
            }
        });

        if (!slotList.querySelector('.slot-btn:not(:disabled)')) {
            showSlotMessage('No open times left on this date. Please pick another day.', false);
        }
    }

    function onDateChange(keepTime) {
        var value = dateInput.value;

        // Ignore any load still in flight for the previous date.
        latestLoad++;

        if (!value) {
            slotList.innerHTML = '<li class="slot-placeholder">Select a date above to see open time slots.</li>';
            clearSelection();
            return;
        }

        // Condition: reject dates in the past, or too far ahead,
        // before asking for slots.
        if (!isAllowedDate(value)) {
            dateError.hidden = false;
            dateInput.setAttribute('aria-invalid', 'true');
            slotList.innerHTML = '<li class="slot-placeholder">Please choose a date from today up to a year ahead.</li>';
            clearSelection();
            return;
        }

        dateError.hidden = true;
        dateInput.removeAttribute('aria-invalid');
        renderSlots(value, keepTime);
    }

    function setDateLimits() {
        dateInput.min = localDateString(0);
        dateInput.max = localDateString(SHOP.maxDaysAhead);
    }

    dateInput.addEventListener('change', function () {
        onDateChange(false);
    });

    serviceSelect.addEventListener('change', function () {
        if (!isAllowedDate(dateInput.value)) {
            return;
        }
        if (lastLoaded && lastLoaded.date === dateInput.value) {
            clearSelection();
            drawSlots(dateInput.value, lastLoaded.bookings, '');
        } else {
            renderSlots(dateInput.value, false);
        }
    });

    setDateLimits();

    // Used by the booking form and the config loader.
    return {
        // Reload the slots for the current date (for example after
        // someone else took the chosen time), keeping the choice if
        // it is still free.
        reload: function (keepTime) {
            onDateChange(keepTime);
        },
        // The shop rules changed, so redraw with the new ones.
        refresh: function () {
            setDateLimits();
            if (dateInput.value) {
                onDateChange(true);
            }
        }
    };
}

// ---------------------------------------------------------
// 3. Booking Form: checks, review step, saving, confirmation
// ---------------------------------------------------------
function initBookingForm(slotPicker) {
    var form = document.getElementById('booking-form');
    var petSizeRadios = form.querySelectorAll('input[name="pet-size"]');
    var petSizeError = document.getElementById('pet-size-error');
    var timeInput = document.getElementById('appointment-time');
    var timeError = document.getElementById('time-error');
    var slotList = document.getElementById('time-slot-list');
    var selectedTimeDisplay = document.getElementById('selected-time-display');
    var dateInput = document.getElementById('appointment-date');
    var dateError = document.getElementById('date-error');
    var bookingError = document.getElementById('booking-error');

    var reviewBox = document.getElementById('booking-review');
    var reviewHeading = document.getElementById('review-heading');
    var reviewDetails = document.getElementById('review-details');
    var reviewError = document.getElementById('review-error');
    var confirmBtn = document.getElementById('review-confirm-btn');
    var editBtn = document.getElementById('review-edit-btn');

    var confirmationBox = document.getElementById('booking-confirmation');
    var confirmationHeading = document.getElementById('confirmation-heading');
    var detailsList = document.getElementById('confirmation-details');
    var bookAnotherBtn = document.getElementById('book-another-btn');

    var draftStatus = document.getElementById('draft-status');
    var draftClearBtn = document.getElementById('draft-clear-btn');

    var isSending = false;
    var reviewedBooking = null;

    // If a reply times out, the booking may still have been saved. A
    // retry of the same booking reuses its request ID, so the backend
    // returns the saved booking instead of a "slot taken" error.
    var pendingRequest = null;

    // Server field names (from server/bookings.js) -> the input to flag.
    var FIELD_INPUTS = {
        'full name': 'owner-name',
        'email address': 'owner-email',
        'phone number': 'owner-phone',
        'pet name': 'pet-name',
        'breed': 'pet-breed',
        'pet size': 'pet-size-group',
        'service': 'service-type',
        'date': 'appointment-date',
        'time slot': 'time-slot-list',
        'notes': 'pet-notes'
    };

    // ---- Checks before the review step ----
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        clearFieldFlags();

        var isValid = true;
        var firstProblem = null;

        // Native required/email/pattern checks for the standard fields.
        if (!form.checkValidity()) {
            form.reportValidity();
            isValid = false;
        }

        if (!dateInput.value || dateInput.value < dateInput.min || dateInput.value > dateInput.max) {
            dateError.hidden = false;
            dateInput.setAttribute('aria-invalid', 'true');
            isValid = false;
            firstProblem = firstProblem || dateInput;
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
            firstProblem = firstProblem || petSizeRadios[0];
        } else {
            petSizeError.hidden = true;
        }

        // Custom condition: a time slot must be chosen from the
        // generated list (there's no native input to validate this).
        if (!timeInput.value) {
            timeError.textContent = 'Please select an open time slot.';
            timeError.hidden = false;
            slotList.setAttribute('aria-invalid', 'true');
            isValid = false;
            firstProblem = firstProblem || slotList.querySelector('.slot-btn:not(:disabled)') || dateInput;
        } else {
            timeError.hidden = true;
        }

        // reportValidity already focused a native field if one failed.
        if (!isValid) {
            if (firstProblem && form.checkValidity()) {
                firstProblem.focus();
            }
            return;
        }

        showReview(buildBooking());
    });

    // Collects the form values in the shape server/bookings.js expects.
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

    function serviceName() {
        var serviceSelect = document.getElementById('service-type');
        return serviceSelect.options[serviceSelect.selectedIndex].text;
    }

    function addonNames(booking) {
        var names = booking.addons.map(function (key) {
            return document.querySelector('label[for="addon-' + key + '"]').textContent.trim();
        });
        return names.length ? names.join(', ') : 'None';
    }

    // ---- Review step ----
    function showReview(booking) {
        reviewedBooking = booking;
        fillDetails(reviewDetails, [
            ['Owner', booking.ownerName],
            ['Email', booking.email],
            ['Phone', booking.phone],
            ['Pet', booking.petName + ' (' + booking.petSize + ')' + (booking.breed ? ', ' + booking.breed : '')],
            ['Service', serviceName()],
            ['Date', booking.date],
            ['Time', formatTime12h(booking.time)],
            ['Add-ons', addonNames(booking)],
            ['Notes', booking.notes || 'None']
        ]);
        reviewError.hidden = true;
        bookingError.hidden = true;
        form.hidden = true;
        reviewBox.hidden = false;
        moveFocusTo(reviewHeading);
    }

    function backToForm(focusEl) {
        reviewBox.hidden = true;
        form.hidden = false;
        moveFocusTo(focusEl || form.querySelector('input, select, textarea'));
    }

    editBtn.addEventListener('click', function () {
        backToForm();
    });

    confirmBtn.addEventListener('click', function () {
        if (!isSending && reviewedBooking) {
            sendBooking(reviewedBooking);
        }
    });

    // ---- Saving ----
    function setSending(sending) {
        isSending = sending;
        confirmBtn.disabled = sending;
        editBtn.disabled = sending;
        if (sending) {
            confirmBtn.textContent = 'Saving your booking...';
        } else {
            confirmBtn.textContent = reviewError.hidden ? 'Confirm and Book' : 'Try Again';
        }
    }

    function sendBooking(booking) {
        var key = JSON.stringify(booking);
        if (!pendingRequest || pendingRequest.key !== key) {
            pendingRequest = { key: key, id: makeRequestId() };
        }
        var payload = Object.assign({}, booking, { requestId: pendingRequest.id });

        reviewError.hidden = true;
        setSending(true);

        callApi('POST', '/bookings', payload)
            .then(function (reply) {
                // The backend answered, so this request is finished either way.
                pendingRequest = null;

                if (reply.ok) {
                    showConfirmation(booking, reply.bookingId);
                } else if (reply.error === 'slot_taken') {
                    // Back to the form with fresh slots, and the message
                    // right under them, so the visitor can pick another time.
                    reviewBox.hidden = true;
                    form.hidden = false;
                    slotPicker.reload(false);
                    timeError.textContent = reply.message;
                    timeError.hidden = false;
                    slotList.setAttribute('aria-invalid', 'true');
                    moveFocusTo(dateInput);
                } else if (reply.error === 'invalid_fields') {
                    showFormError(reply.message, flagFields(reply.fields));
                } else {
                    // Rate limit or a server problem: stay on the review
                    // step so the visitor can simply try again.
                    showReviewError(reply.message || 'Your booking could not be saved. Please try again.');
                }
            })
            .catch(function (err) {
                // Timeout or no connection: stay on the review step. A
                // retry sends the same request ID, so it can't double book.
                showReviewError(err.message);
            })
            .finally(function () {
                setSending(false);
            });
    }

    // role="alert" makes screen readers read this out right away.
    function showReviewError(message) {
        reviewError.textContent = message;
        reviewError.hidden = false;
    }

    function showFormError(message, focusEl) {
        bookingError.textContent = message;
        bookingError.hidden = false;
        backToForm(focusEl);
    }

    // Marks the fields the server rejected and returns the first one.
    function flagFields(fields) {
        var first = null;
        (fields || []).forEach(function (name) {
            var el = document.getElementById(FIELD_INPUTS[name]);
            if (el) {
                el.setAttribute('aria-invalid', 'true');
                first = first || el;
            }
        });
        if (first && first.id === 'pet-size-group') {
            return petSizeRadios[0];
        }
        if (first && first.id === 'time-slot-list') {
            return first.querySelector('.slot-btn:not(:disabled)') || dateInput;
        }
        return first;
    }

    function clearFieldFlags() {
        form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
            el.removeAttribute('aria-invalid');
        });
    }

    // Once the visitor edits a flagged field, take the flag away.
    form.addEventListener('input', function (event) {
        event.target.removeAttribute('aria-invalid');
        var group = event.target.closest('[aria-invalid="true"]');
        if (group) {
            group.removeAttribute('aria-invalid');
        }
    });

    // Only runs after the backend says the booking was saved.
    function showConfirmation(booking, bookingId) {
        fillDetails(detailsList, [
            ['Booking ID', bookingId],
            ['Owner', booking.ownerName],
            ['Pet', booking.petName + ' (' + booking.petSize + ')'],
            ['Service', serviceName()],
            ['Date', booking.date],
            ['Time', formatTime12h(booking.time)]
        ]);

        // Ready for "Find My Booking" later.
        document.getElementById('find-id').value = bookingId;
        document.getElementById('find-email').value = booking.email;

        clearDraft();
        reviewedBooking = null;
        reviewBox.hidden = true;
        form.hidden = true;
        confirmationBox.hidden = false;
        moveFocusTo(confirmationHeading);
    }

    bookAnotherBtn.addEventListener('click', function () {
        form.reset();
        form.hidden = false;
        confirmationBox.hidden = true;
        moveFocusTo(document.getElementById('owner-name'));
    });

    form.addEventListener('reset', function () {
        slotList.innerHTML = '<li class="slot-placeholder">Select a date above to see open time slots.</li>';
        selectedTimeDisplay.textContent = '';
        document.getElementById('service-select-status').textContent = '';
        petSizeError.hidden = true;
        timeError.hidden = true;
        dateError.hidden = true;
        bookingError.hidden = true;
        clearFieldFlags();
        clearDraft();
    });

    // ---- Saved draft ----
    // The form is saved in this browser while the visitor types, so a
    // refresh or an accidental close doesn't lose it. It's removed as
    // soon as the booking is saved or the form is cleared.
    var DRAFT_KEY = 'pawcare-booking-draft';
    var DRAFT_FIELDS = ['owner-name', 'owner-email', 'owner-phone', 'pet-name', 'pet-breed', 'service-type', 'pet-notes'];
    var DRAFT_CHECKS = ['size-small', 'size-medium', 'size-large', 'addon-perfume', 'addon-teeth', 'addon-deshed'];

    function saveDraft() {
        var draft = { fields: {}, checks: {}, date: dateInput.value, time: timeInput.value };
        DRAFT_FIELDS.forEach(function (id) {
            draft.fields[id] = document.getElementById(id).value;
        });
        DRAFT_CHECKS.forEach(function (id) {
            draft.checks[id] = document.getElementById(id).checked;
        });
        try {
            window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        } catch (err) {
            // Storage can be blocked (private mode). The form still works.
        }
    }

    function clearDraft() {
        try {
            window.localStorage.removeItem(DRAFT_KEY);
        } catch (err) {
            // Nothing to clear.
        }
        draftStatus.hidden = true;
    }

    function restoreDraft() {
        var draft;
        try {
            draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
        } catch (err) {
            draft = null;
        }
        if (!draft || !draft.fields) {
            return;
        }

        var restoredSomething = false;
        DRAFT_FIELDS.forEach(function (id) {
            if (typeof draft.fields[id] === 'string' && draft.fields[id]) {
                document.getElementById(id).value = draft.fields[id];
                restoredSomething = true;
            }
        });
        DRAFT_CHECKS.forEach(function (id) {
            if (draft.checks && draft.checks[id]) {
                document.getElementById(id).checked = true;
                restoredSomething = true;
            }
        });
        // Only bring the date back if it can still be booked. The slot
        // list is loaded again, and the old time is kept if still free.
        if (draft.date && draft.date >= dateInput.min && draft.date <= dateInput.max) {
            dateInput.value = draft.date;
            timeInput.value = draft.time || '';
            slotPicker.reload(true);
        }

        if (restoredSomething) {
            draftStatus.hidden = false;
        }
    }

    draftClearBtn.addEventListener('click', function () {
        form.reset();
        moveFocusTo(document.getElementById('owner-name'));
    });

    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);

    restoreDraft();
}

// ---------------------------------------------------------
// 4. Find My Booking
// ---------------------------------------------------------
function initFindBooking() {
    var form = document.getElementById('find-booking-form');
    var errorEl = document.getElementById('find-error');
    var result = document.getElementById('find-result');
    var heading = document.getElementById('find-heading');
    var details = document.getElementById('find-details');
    var submitBtn = form.querySelector('button[type="submit"]');

    var STATUS_TEXT = {
        pending: 'Pending. The shop will confirm it with you.',
        confirmed: 'Confirmed',
        cancelled: 'Cancelled'
    };

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        var id = document.getElementById('find-id').value.trim().toUpperCase();
        var email = document.getElementById('find-email').value.trim();

        errorEl.hidden = true;
        result.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Looking it up...';

        callApi('GET', '/bookings/' + encodeURIComponent(id) + '?email=' + encodeURIComponent(email))
            .then(function (reply) {
                if (!reply.ok) {
                    showError(reply.message);
                    return;
                }
                var b = reply.booking;
                fillDetails(details, [
                    ['Booking ID', b.bookingId],
                    ['Status', STATUS_TEXT[b.status] || b.status],
                    ['Pet', b.petName],
                    ['Service', b.service],
                    ['Date', b.date],
                    ['Time', formatTime12h(b.time)],
                    ['Add-ons', b.addons.length ? b.addons.join(', ') : 'None']
                ]);
                result.hidden = false;
                heading.focus();
            })
            .catch(function (err) {
                showError(err.message);
            })
            .finally(function () {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Find Booking';
            });
    });

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
}

// ---------------------------------------------------------
// 5. Contact form: live character counter
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

// Contact form: sends the message to the backend so the shop can
// read and answer it later.
function initContactForm() {
    var form = document.getElementById('contact-form');
    var status = document.getElementById('contact-status');
    var errorEl = document.getElementById('contact-error');
    var submitBtn = form.querySelector('button[type="submit"]');
    var pendingRequest = null;

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        var method = form.querySelector('input[name="contact-method"]:checked');
        var message = {
            name: document.getElementById('contact-name').value,
            email: document.getElementById('contact-email').value,
            contactMethod: method ? method.value : '',
            message: document.getElementById('contact-message').value,
            website: document.getElementById('contact-website').value
        };

        var key = JSON.stringify(message);
        if (!pendingRequest || pendingRequest.key !== key) {
            pendingRequest = { key: key, id: makeRequestId() };
        }
        message.requestId = pendingRequest.id;

        status.textContent = '';
        errorEl.hidden = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        callApi('POST', '/messages', message)
            .then(function (reply) {
                pendingRequest = null;
                if (!reply.ok) {
                    showError(reply.message);
                    return;
                }
                // Reset first: the reset handler clears the status line.
                form.reset();
                status.textContent = 'Thanks, your message was sent. Reference: ' + reply.messageId +
                    '. We will get back to you soon.';
            })
            .catch(function (err) {
                showError(err.message);
            })
            .finally(function () {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Message';
            });
    });

    form.addEventListener('reset', function () {
        errorEl.hidden = true;
        status.textContent = '';
    });

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
}

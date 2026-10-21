# Roadmap

How the work on PawCare Bookings is ordered, what each step depends on, and
what comes next. The weekly log is in the Development Workflow Worksheet.

## How tasks are ordered

1. **Critical path first.** A task moves up if later work can't start without
   it. Saving bookings came before emails and reminders, because both read a
   saved booking.
2. **Risk early.** The parts most likely to go wrong (two people booking the
   same slot, retries after a timeout) were built and tested before the
   extras.
3. **One working step at a time.** Each step ends with something that runs
   and passes its tests, so a late step can be dropped without breaking the
   ones before it.
4. **Buffer before deadlines.** Each milestone keeps its last few days for
   testing and fixes only.

## Done

| Week | Step | Depends on | Why it came here |
|---|---|---|---|
| 2 | HTML structure for every section | none | Everything else is built on it |
| 3 | Review structure against the goals | 2 | Catch missing sections before styling |
| 4 | Booking form semantics, slot list and confirmation placeholders | 3 | The form is the main interaction |
| 5 | CSS layout, JavaScript slot picker and validation | 4 | Needs stable HTML to style and script |
| 6 | Backend-supported features analysis | 5 | Decide what the backend must do before building it |
| 7 | First backend (Apps Script and a Google Sheet) | 6 | Booking storage is on the critical path |
| 8 | Connect the form and slot picker to the backend | 7 | Real availability needs saved bookings |
| 9 | Move to Express.js, tests, review step, Find My Booking, contact messages, accessibility | 8 | Course uses Express. Testing found two bugs that were fixed. |

## Next

| Priority | Step | Depends on | Size | Notes |
|---|---|---|---|---|
| 1 (critical path) | Confirmation email after a booking is saved | Saved bookings (done) | 2 to 3 days | Needs an email service and a sender address. Send only after the save succeeds. |
| 2 | Reminder email the day before | Confirmation email (shares the email code) | 1 to 2 days | A daily job that reads tomorrow's bookings. |
| 3 | Shop owner page to view bookings and messages, and mark them confirmed or cancelled | Saved bookings and messages (done) | 3 days | Needs a login, so it comes after the emails. Replaces editing the JSON files by hand. |
| 4 | Host the server online | Owner page (so data can be managed without file access) | 1 to 2 days | Free hosts wipe files on restart, so storage moves to a small database first. |
| 5 | Google Calendar event per booking | Hosting (needs a server that is always on) | 2 days | Optional. The booking list may be enough for the shop. |
| Buffer | Testing and fixes | All of the above | 3 days | Kept free before the final deadline. |

## Out of scope

Client accounts, rescheduling by the client, several groomers or shops, and
online payment. These are too large for the course timeline and aren't
needed for the core booking flow.

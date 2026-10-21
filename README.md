# PawCare Bookings

A booking site for a pet grooming shop. Pet owners pick a service, choose an
open time slot, and send their details. An Express.js server checks the
booking, saves it, and gives the visitor a booking ID right away.

Built for MO-IT161 Web Systems and Technology.

## Developer
- Jan Carlos Mah (solo project)

## Run it

You need Node.js 18 or newer.

```bash
git clone https://github.com/jcspades21/pawcare-bookings-solo.git
cd pawcare-bookings-solo
npm install
npm start
```

Then open http://localhost:3000. Bookings are saved to `data/bookings.json`,
which is created on the first booking and kept when the server restarts.

On Windows PowerShell, if `npm` is blocked with "running scripts is disabled
on this system", use `npm.cmd install` and `npm.cmd start` instead.

To run the tests:

```bash
npm test
```

The GitHub Pages copy at https://jcspades21.github.io/pawcare-bookings-solo/
only hosts the frontend. GitHub Pages can't run an Express server, so
booking only works when you run the server yourself. The Pages copy says
this instead of failing silently.

## What works now

**Frontend (Milestone 1)**
- Semantic HTML for services, how booking works, the booking form, business
  hours, the contact form and the footer.
- Responsive CSS with reusable classes (`.btn`, `.form-group`,
  `.service-card`, slot picker states).
- JavaScript for service selection, the time slot picker, form validation,
  and a character counter on the contact form.

**Backend (Milestone 2)**
- Booking submission. The form sends the booking to `POST /api/bookings`.
  The server checks every field again, makes sure the slot is still free,
  saves the booking, and replies with a booking ID. The confirmation only
  shows after that reply.
- Real availability. The slot picker calls `GET /api/slots?date=...` to see
  which times are booked. A slot is greyed out if it would overlap an
  existing booking plus the 15-minute sanitation buffer.
- Double booking protection. The check and the save happen in one step, so
  two people sending the same slot at the same moment can't both get it.
- Safe retries. If a reply is slow and the visitor tries again, the same
  request ID is sent, so they get their saved booking back instead of a
  "slot taken" error.
- A hidden spam trap field, a 5 KB request limit, and JSON error replies with
  proper status codes (400, 409, 413, 415).

**Not built yet:** Google Calendar events, confirmation and reminder emails,
loading services from a file instead of the HTML, and saving contact form
messages. The contact form still only shows a message in the browser.

## How a booking moves through the app

1. The visitor picks a date. `script.js` calls `GET /api/slots?date=...`.
2. `server/server.js` reads `data/bookings.json` and returns the booked times
   for that date. The browser greys out any slot that would overlap them.
3. The visitor fills in the form and clicks Confirm Booking. The browser
   checks the fields, then sends the booking as JSON to
   `POST /api/bookings`.
4. `server/bookings.js` checks the fields again, makes sure the slot is still
   free, and adds the booking to `data/bookings.json`.
5. The server replies `201` with `{ ok: true, bookingId: "PC-..." }`, or with
   an error status and `{ ok: false, message: "..." }`. The page shows the
   confirmation or the message.

## API

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/slots?date=YYYY-MM-DD` | none | `200 { ok, date, booked: [{ time, minutes }] }` | `400` bad date |
| POST | `/api/bookings` | booking JSON | `201 { ok, bookingId, status }`, or `200` for a repeated request ID | `400` invalid fields, `409` slot taken, `413` too large, `415` not JSON |

## File structure

```
pawcare-bookings-solo/
├── index.html          # Page structure
├── style.css           # Styling and layout
├── script.js           # Frontend behavior and API calls
├── server/
│   ├── server.js       # Express app: API routes and static files
│   └── bookings.js     # Validation, slot rules and JSON file storage
├── test/
│   └── api.test.js     # API tests (npm test)
├── data/               # bookings.json lives here (not in git)
├── images/             # Banner and service images
├── package.json
├── AI_USE_LOG.md       # Record of AI use for this project
└── README.md
```

## Managing bookings

Open `data/bookings.json` while the server is stopped. To free up a slot,
change that booking's `"status"` to `"cancelled"`.

## Workflow documentation

Plans, priorities and weekly progress are tracked in the Browser-Based
Application Development Workflow Worksheet (Google Sheet), which is kept
outside this repo.

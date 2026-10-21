# PawCare Bookings

A booking site for a pet grooming shop. Pet owners pick a service, see which
times are really open, check their details, and book. An Express.js server
checks the booking, saves it, and gives the visitor a booking ID they can use
to look the booking up later. The contact form saves questions for the shop.

Built for MO-IT161 Web Systems and Technology.

![Tests](https://github.com/jcspades21/pawcare-bookings-solo/actions/workflows/test.yml/badge.svg)

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

Then open http://localhost:3000.

On Windows PowerShell, if `npm` is blocked with "running scripts is disabled
on this system", use `npm.cmd install` and `npm.cmd start` instead.

Bookings and messages are saved in the `data` folder (`bookings.json` and
`messages.json`). The files are created when they're first needed and are
kept when the server restarts. They hold visitors' contact details, so they
are left out of git.

The GitHub Pages copy at https://jcspades21.github.io/pawcare-bookings-solo/
only hosts the frontend. GitHub Pages can't run an Express server, so it says
that booking needs the server instead of failing silently.

## Features

**Booking**
- **Real availability.** The slot picker asks the server which times are
  taken on the chosen date. A slot is greyed out if it would overlap an
  existing booking plus the 15-minute sanitation buffer, or if it has
  already passed today.
- **Review before booking.** After the form passes its checks, the visitor
  sees every detail on a review step and confirms. Nothing is sent before
  that, and Edit Details goes back with everything still filled in.
- **Checks on both sides.** The browser checks the form first. The server
  checks every field again and reports all problems at once. The page then
  outlines each rejected field and moves the cursor to the first one.
- **No double bookings.** The availability check and the save happen in one
  step, so two people sending the same slot at the same moment can't both
  get it. The one who loses is sent back to the slot list, which reloads with
  that time greyed out.
- **Safe retries.** If a reply is slow or the connection drops, the review
  step offers Try Again. The retry sends the same request ID, so a booking
  that was saved anyway is returned instead of booked twice. A quick double
  click also sends only one booking.
- **Nothing lost on refresh.** The form is saved in the browser while the
  visitor types and filled back in if the page is reloaded. It's removed as
  soon as the booking is saved or the form is cleared.

**Find My Booking**
- Look up a booking with its ID and the email it was made with. A wrong ID
  and a wrong email get the same answer, so it can't be used to find out
  which IDs exist. Contact details are never sent back.

**Contact Us**
- Messages are saved on the server with a reference number, so the shop can
  read and answer them later.

**Accessibility**
- Skip link, labelled menus, a label on every form control, a visible focus
  outline for keyboard users, and focus moved to each new step (review,
  confirmation, errors) so screen reader users hear what changed.
- Loading states (`aria-busy`), live status messages and error alerts.
- No smooth scrolling for people who turned off motion in their system
  settings.

**Protection**
- Rate limit: 20 requests a minute per visitor on the booking, lookup and
  message routes (`429` with a `Retry-After` header).
- Hidden spam trap field on both forms, a 5 KB request size limit, and
  security headers (Content-Security-Policy, `X-Frame-Options`,
  `X-Content-Type-Options`).
- Only the page's own files are served. The `data` folder, the server code
  and `package.json` return 404.

**Not built yet:** Google Calendar events, confirmation and reminder emails,
and a page for the shop owner to manage bookings. See
[ROADMAP.md](ROADMAP.md) for the order these come in and why.

## How a booking moves through the app

1. The page loads the shop's rules (services, slot times, hours) from
   `GET /api/config`, so they're defined once on the server.
2. The visitor picks a date. `script.js` calls `GET /api/slots?date=...` and
   greys out any slot that would overlap a saved booking.
3. The visitor fills in the form and clicks Review Booking. The browser
   checks the fields and shows the review step.
4. Confirm and Book sends the booking as JSON to `POST /api/bookings`.
5. `server/bookings.js` checks every field again, makes sure the slot is
   still free, and adds the booking to `data/bookings.json`.
6. The server replies `201` with `{ ok: true, bookingId: "PC-..." }`, or an
   error status with `{ ok: false, message, fields }`. The page shows the
   confirmation, or sends the visitor to the right place to fix it.

## API

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/config` | `200` services, slot times, buffer, closing time | none |
| GET | `/api/slots?date=YYYY-MM-DD` | `200 { booked: [{ time, minutes }] }` | `400` bad date |
| POST | `/api/bookings` | `201 { bookingId, status }`, `200` for a repeated request ID | `400` invalid fields, `409` slot taken, `413` too large, `415` not JSON, `429` too many |
| GET | `/api/bookings/:id?email=...` | `200 { booking }` | `404` not found, `429` too many |
| POST | `/api/messages` | `201 { messageId }`, `200` for a repeated request ID | `400`, `413`, `415`, `429` |

Every reply is JSON with `ok: true` or `ok: false`. Error replies have a
`message` written for the visitor, and `fields` when specific fields were
rejected.

## Code structure

```
pawcare-bookings-solo/
├── index.html              # Page structure
├── style.css               # Styling, layout, focus and motion settings
├── script.js               # Frontend behavior and API calls
├── server/
│   ├── server.js           # Express app: routes, middleware, static files
│   ├── config.js           # Services, slot times, hours (one place to edit)
│   ├── bookings.js         # Booking rules: validation, overlaps, lookup
│   ├── messages.js         # Contact message rules
│   ├── store.js            # JSON file storage, cached in memory
│   ├── rateLimit.js        # Per-visitor request limit
│   └── util.js             # Shared helpers (Manila time, dates, text)
├── test/
│   ├── rules.test.js       # Unit tests for the rules and storage
│   ├── api.test.js         # API tests against a running server
│   ├── page.test.js        # The real page in jsdom, clicked through
│   └── helpers.js
├── .github/workflows/      # Runs the tests on every push
├── data/                   # bookings.json, messages.json (not in git)
├── ROADMAP.md              # Task order, dependencies, what's next
├── AI_USE_LOG.md           # Record of AI use for this project
└── README.md
```

To add a service or change the hours, edit `server/config.js` and restart.
The server's checks and the page's slot picker both pick up the change.

## Testing

```bash
npm test
```

48 tests, about 3 seconds:

- **Rules (10):** overlaps and the buffer, closing time, real dates, Manila
  time, text cleanup, storage, and a broken data file.
- **API (21):** every route, every field rule, several bad fields at once,
  junk and oversized requests, spam, retries, five requests for one slot at
  once, restarts, cancelled bookings, the rate limit, security headers, and
  files that must not be served.
- **Page (17):** the full booking flow in a simulated browser, including the
  review step, a double click, another visitor taking the slot, server field
  errors, the server going down and coming back, a timeout that was saved
  anyway, the saved draft, Find My Booking, the contact form, labels and the
  skip link.

GitHub Actions runs the same tests on Node.js 18, 20 and 22 for every push.

## Managing bookings

Stop the server, then open `data/bookings.json`. To free up a slot, change
that booking's `"status"` to `"cancelled"`. Messages in `data/messages.json`
start as `"new"`. The running server keeps the data in memory, so edits made
while it runs would be overwritten.

## Workflow documentation

Plans, priorities and weekly progress are tracked in the Browser-Based
Application Development Workflow Worksheet (Google Sheet), which is kept
outside this repo. [ROADMAP.md](ROADMAP.md) has the task order and
dependencies.

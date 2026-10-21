# PawCare Bookings

A browser-based booking app for a pet grooming shop. Pet owners pick a
service, choose an open time slot, and send their details. The booking is
saved to a Google Sheet and the visitor gets a booking ID right away.

Built for MO-IT161 Web Systems and Technology.

**Live site:** https://jcspades21.github.io/pawcare-bookings-solo/

## Developer
- Jan Carlos Mah (solo project)

## What works now

**Frontend (Milestone 1)**
- Semantic HTML for services, how booking works, the booking form, business
  hours, the contact form and the footer.
- Responsive CSS with reusable classes (`.btn`, `.form-group`,
  `.service-card`, slot picker states).
- JavaScript for service selection, the time slot picker, form validation,
  and a character counter on the contact form.

**Backend (Milestone 2, Homework 7)**
- Booking submission. The form sends the booking to a Google Apps Script web
  app. The script checks every field again, makes sure the slot is still
  free, saves one row to the Bookings sheet, and replies with a booking ID.
  The confirmation only shows after that reply.
- Real availability. The slot picker asks the backend which times are
  already booked on the chosen date. A slot is greyed out if it would overlap
  an existing booking plus the 15-minute sanitation buffer.
- Double booking protection. The script uses a lock, so two people
  submitting the same slot at the same moment can't both get it.
- Safe retries. If the reply is slow and the visitor tries again, the same
  request ID is sent, so they get their saved booking back instead of a
  "slot taken" error.
- A hidden spam trap field and size limits on requests.

**Not built yet:** Google Calendar events, confirmation and reminder emails,
loading services from a Services Sheet, and saving contact form messages.
The contact form still only shows a message in the browser.

## How a booking moves through the app

1. The visitor picks a date. `script.js` sends
   `GET ?action=slots&date=...` to the web app.
2. `Code.gs` reads the Bookings sheet and returns the booked times for that
   date. The browser greys out any slot that would overlap them.
3. The visitor fills in the form and clicks Confirm Booking. The browser
   checks the fields, then sends the booking as JSON in a POST request. It
   uses `text/plain` so the browser skips the CORS preflight, which Apps
   Script can't answer.
4. `Code.gs` checks the fields again, locks the script, makes sure the slot
   is still free, and writes the row.
5. The script replies with `{ ok: true, bookingId: "PC-..." }`, or with
   `ok: false` and a message. The page shows the confirmation or the error.

## File structure

```
pawcare-bookings-solo/
├── index.html          # Page structure
├── style.css           # Styling and layout
├── script.js           # Frontend behavior and backend requests
├── apps-script/
│   └── Code.gs         # Apps Script web app (copy of the deployed code)
├── images/             # Banner and service images
├── AI_USE_LOG.md       # Record of AI use for this project
└── README.md
```

## Backend setup

The backend runs on Google Apps Script, so there's no server to host.

1. Make a Google Sheet with a tab named `Bookings` and these headers in row
   1: Booking ID, Submitted At (Asia/Manila), Owner Name, Email, Phone, Pet
   Name, Breed, Pet Size, Service, Date, Time Slot, Add-ons, Notes, Status,
   Request ID. Set columns A to O to Plain text, so dates and +63 numbers
   aren't converted.
2. In the sheet, open **Extensions > Apps Script** and paste in
   `apps-script/Code.gs`. Change `SHEET_ID` to your sheet's ID.
3. Click **Deploy > New deployment > Web app**. Set Execute as **Me** and
   Who has access **Anyone**, then authorize it.
4. Copy the `/exec` URL into `BOOKING_API_URL` at the top of `script.js`.

After changing `Code.gs`, use **Deploy > Manage deployments > Edit > New
version**. That keeps the same URL.

To free up a slot, change that booking's Status to `cancelled` in the sheet.

## Running locally

No build step. Clone the repo and serve the folder:

```bash
git clone https://github.com/jcspades21/pawcare-bookings-solo.git
cd pawcare-bookings-solo
python3 -m http.server 8000
```

Then open http://localhost:8000. Bookings made locally still go to the real
sheet, since the web app URL is the same.

## GitHub Pages

The site deploys from the `main` branch, `/ (root)` folder. You can check this
under **Settings > Pages**.

## Workflow documentation

Plans, priorities and weekly progress are tracked in the Browser-Based
Application Development Workflow Worksheet (Google Sheet), which is kept
outside this repo.

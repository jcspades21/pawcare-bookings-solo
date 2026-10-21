# AI Use Log

Tool used: Claude (Claude Code, model Claude Opus 5.5), with Google Sheets
and Google Drive connectors.

| Date | What I asked for | What the AI produced | How it was checked |
|---|---|---|---|
| 2026-10-21 | Fill in the Homework 6 "Backend-Supported Features" tab using my feature list and answers. | Checked each feature status against `index.html`, `script.js` and the README, then wrote the 13 table rows and the three answers into the worksheet. | Statuses compared with the code before writing. The tab was read back cell by cell afterwards. |
| 2026-10-21 | Move the project to a new solo repo. | Copied the full commit history to `pawcare-bookings-solo` and updated the README to list only me. | I created the empty repo myself. Compared the commit on GitHub with the local copy after the push. |
| 2026-10-21 | A better prompt for Homework 7, then the full implementation. | `apps-script/Code.gs` (validation, double booking check with a lock, saving rows, returning booked slots), the backend calls in `script.js`, a spam trap field and error states in `index.html` and `style.css`, and the Bookings sheet. | See the tests below. I deployed the web app myself. |
| 2026-10-21 | Testing. | A Node test that runs `Code.gs` with fake Apps Script services (31 checks), live requests to the deployed web app, and a jsdom test that runs the real page script against the live backend (16 checks). | Every check passed. The page test found a real bug: a booking that timed out in the browser had still been saved, so a retry failed as "slot taken". That was fixed with a request ID that stays the same on retry. |
| 2026-10-21 | README, this log, and the Development Workflow Worksheet (Weeks 5 to 9 and the other answer cells), written in my voice. | Updated `README.md`, this file, and the worksheet cells. | The worksheet was read back after writing. |

## Notes

- All the code came from AI. I deployed the Apps Script web app, created the
  GitHub repo, and turned on GitHub Pages myself.
- The test bookings in the Bookings sheet start with "TEST" and are marked
  `cancelled`, so they don't block any slots.

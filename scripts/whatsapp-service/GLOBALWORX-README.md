# GlobalWorx Auto-Accept & Alert Lifecycle System

This document explains the full automated alert lifecycle — from incoming Gmail alert emails through GlobalWorx acceptance to automatic resolution marking. This feature was previously built and deleted; this is a rebuild from scratch.

---

## Overview

When a GlobalWorx service alert email arrives in Gmail, the system can now handle the entire lifecycle automatically:

```
Gmail Alert Email
    |
    v
[1] Fetch & Parse ──> Alert appears in Alert Panel / Alert Log
    |
    v
[2] Auto-Accept ──> Puppeteer clicks through GlobalWorx acceptance form (headless)
    |                Gmail label: "Processed"
    v
[3] Auto-Done ──> Store visited after alert date? Mark resolved
    |              Gmail label: "GLOBAL WORKS/Done"
    v
[4] Auto-Completed ──> Done alert older than 48 hours? Archive it
                        Gmail label: "GLOBAL WORKS/Completed"
```

---

## Architecture

### Backend (Node.js + Express + Puppeteer)

Located in `scripts/whatsapp-service/`:

| File | Purpose |
|------|---------|
| `server.js` | Express server on port 3001, routes for WhatsApp + GlobalWorx |
| `globalworx.js` | Puppeteer module that opens GlobalWorx acceptance URLs and clicks through the form |

**API Endpoints:**

- `GET /api/globalworx/status` — Check if Puppeteer/Chrome is available
- `POST /api/globalworx/accept` — Accept a single alert (`{ url, refNumber }`)
- `POST /api/globalworx/accept-batch` — Accept multiple alerts in sequence

### Frontend (React)

| File | Purpose |
|------|---------|
| `src/services/globalworxService.js` | HTTP client that calls the backend endpoints |
| `src/services/gmailAlertService.js` | Gmail API integration — fetches alert emails, manages labels |
| `src/context/AppContext.jsx` | Orchestration — `fetchGmailAlerts()`, `autoAcceptAlerts()`, `markResolvedAlertsDone()`, `markDoneAlertsCompleted()` |
| `src/components/AlertPanel.jsx` | UI — Auto-Check toggle button, 15-minute polling timer |
| `src/components/AlertLog.jsx` | UI — Full alert list, status badges, manual Auto-Clear button |

---

## How Each Stage Works

### Stage 1: Fetch & Parse Gmail Alerts

**Trigger:** Manual "Fetch" button or Auto-Check timer (every 15 min)

**Code:** `AppContext.jsx` → `fetchGmailAlerts()`

1. Calls `gmailAlertService.fetchAlertEmails(afterDate)` which queries Gmail API for emails matching the alert subject pattern
2. Parses subject lines to extract: store number, ref number (ADUSA-XXXXXXX), alert type
3. Reads Gmail labels on each email to set flags: `globalworxAccepted`, `globalworxDone`, `globalworxCompleted`
4. Extracts the GlobalWorx acceptance URL from the email body (`acceptanceUrl`)
5. Matches each alert to a store in the store database using store number
6. Merges with existing alerts (dedupes by refNumber), prunes alerts older than 30 days
7. Labels all fetched messages with `Map Tracker/Logged` in Gmail

### Stage 2: Auto-Accept via GlobalWorx (Puppeteer)

**Trigger:** Called automatically after `fetchGmailAlerts()` during Auto-Check, or manually via "Accept All" button

**Code:** `AppContext.jsx` → `autoAcceptAlerts()` → `globalworxService.acceptAlerts()` → backend `globalworx.js`

1. Filters alerts that have an `acceptanceUrl` but are NOT yet accepted/done/completed
2. Sends the batch to the backend Express server (`POST /api/globalworx/accept-batch`)
3. Backend launches headless Chrome via Puppeteer and processes each alert sequentially:

   **For each alert URL:**
   - **Strategy 1 (Accept):** Finds and clicks the "Accept Here" button (CSS selectors → XPath fallback)
   - **Strategy 2 (Resolution Time):** Sets the resolution dropdown to "within 48 hours" (uses `indexOf` for compatibility with older JS environments on the GlobalWorx page)
   - **Strategy 3 (Submit):** Finds and clicks the "Accept Issue" submit button

4. After all accepts complete, labels successful emails as `Processed` in Gmail via `labelAlertsProcessed()`

**Important notes on the Puppeteer implementation:**
- Runs in headless mode (`headless: 'new'`) — no visible browser window
- Uses a 6-second initial wait after page load for Sencha/jQuery Mobile apps to finish rendering
- Falls back from CSS selectors to XPath to text search for maximum resilience
- The Strategy 2 resolution dropdown code uses `indexOf` instead of `includes` because the GlobalWorx page's JS environment has broken String.prototype.includes polyfills
- All `page.evaluate()` code uses `var` and classic for-loops instead of ES6 to avoid compatibility issues

### Stage 3: Auto-Mark Resolved as "Done"

**Trigger:** Runs automatically after every `fetchGmailAlerts()` call and after `syncFromGithub()` (store data refresh)

**Code:** `AppContext.jsx` → `markResolvedAlertsDone()`

**Logic:**
For each alert that has an `emailId` and is NOT already `globalworxDone`:

1. Find the matching store
2. Get the store's best "last visit" date from three sources:
   - `store.lastSaleDate` — from imported transaction data
   - `store.lastVisited` — static store field
   - `visitHistory[storeId]` — dynamic visit log from proximity tracking
3. Take the most recent of all three
4. **If that date >= the alert's `dateReceived`** → the store was visited after the alert → mark as resolved
5. Apply the `GLOBAL WORKS/Done` Gmail label via batch modify API

This is the key connection between **store visit/sale data** and **alert resolution**. When a driver visits a store (recorded via GPS proximity or data import), any outstanding alerts for that store automatically get marked as Done.

### Stage 4: Auto-Mark Completed (48h+ Done alerts)

**Trigger:** Runs automatically after `markResolvedAlertsDone()` in the same fetch cycle

**Code:** `AppContext.jsx` → `markDoneAlertsCompleted()`

**Logic:**
For each alert that is `globalworxDone` but NOT yet `globalworxCompleted`:

1. Check if the alert's `dateReceived` is more than 48 hours ago
2. If yes → apply the `GLOBAL WORKS/Completed` Gmail label
3. Completed alerts are hidden from the main alert view (archived)

This can also be triggered manually via the "Auto-Clear" button in AlertLog.

---

## Gmail Labels

The system uses four Gmail labels to track alert lifecycle:

| Label | Purpose | Applied by |
|-------|---------|-----------|
| `Map Tracker/Logged` | Alert email was fetched and parsed | `fetchGmailAlerts()` |
| `Processed` | Alert was accepted on GlobalWorx | `autoAcceptAlerts()` |
| `GLOBAL WORKS/Done` | Store was visited after alert date | `markResolvedAlertsDone()` |
| `GLOBAL WORKS/Completed` | Alert archived (done + 48h elapsed) | `markDoneAlertsCompleted()` |

Labels are auto-created if they don't exist (except Done/Completed which must exist in Gmail).

---

## Auto-Check Timer (AlertPanel)

The "Auto" toggle button on the Alert Panel enables a 15-minute polling cycle:

```
[Toggle ON] → Run immediately → Set 15-min interval
                                    |
                                    v
                              fetchGmailAlerts()
                                    |
                                    v
                              autoAcceptAlerts()
                                    |
                                    v
                              markResolvedAlertsDone()
                                    |
                                    v
                              markDoneAlertsCompleted()
                                    |
                                    v
                              Wait 15 minutes → repeat
```

- State persists in `localStorage` (`gw_auto_check`) so it survives page refreshes
- Shows countdown: "Next in 12m", "Checking..."
- Requires Gmail to be connected

---

## Running the Backend

```bash
cd scripts/whatsapp-service
npm install
node server.js
```

The Vite dev server proxies `/api/*` requests to `localhost:3001` (configured in `vite.config.js`).

Make sure Chrome/Chromium is available for Puppeteer. On first run, Puppeteer downloads Chromium automatically.

---

## Debugging

- **Console logs:** All stages log with prefixes `[GW]`, `[Gmail]`, `[Alerts]`, `[AutoAccept]` for easy filtering.
- Each acceptance logs which CSS selector or XPath matched, and whether the resolution dropdown was set successfully.

---

## Why This Was Rebuilt

The original implementation was deleted. This rebuild addresses the same workflow but with improvements:

1. **Headless browser** — no visible Chrome window, runs silently in background
2. **Resilient element finding** — CSS → XPath → text search fallback chains
3. **ES5-compatible evaluate code** — `var`, `indexOf`, for-loops instead of ES6 to handle GlobalWorx's older JS environment
4. **Automatic full lifecycle** — previously only auto-accept existed; now Done and Completed stages are also automated
5. **Lightweight** — no screenshots or disk writes, console logging only

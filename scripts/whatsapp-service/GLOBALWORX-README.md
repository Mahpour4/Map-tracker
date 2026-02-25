# GlobalWorx Auto-Accept & Alert Lifecycle System

This document explains the full automated alert lifecycle — from incoming Gmail alert emails through GlobalWorx acceptance, completion, and data scraping for PDF reports.

---

## Overview

When a GlobalWorx service alert email arrives in Gmail, the system handles the entire lifecycle automatically:

```
Gmail Alert Email
    |
    v
[1] Fetch & Parse ──> Alert appears in Alert Panel / Alert Log
    |
    v
[2] Auto-Accept ──> Puppeteer clicks "Accept Here" + "Accept Issue" on GlobalWorx
    |                Gmail label: "Processed"
    |                Scrapes: Created By, Alert Type, Reason, Location
    v
[3] Auto-Done ──> Store visited after alert date? Mark resolved
    |              Gmail label: "GLOBAL WORKS/Done"
    v
[4] Auto-Complete ──> Click "Complete Here" on GlobalWorx (with geolocation grant)
    |                  Post-click verification: confirms button is gone
    |                  Gmail label: "GLOBAL WORKS/Completed"
    v
[5] PDF Report ──> Route PDF includes scraped GW details per alert
                    (Created By, Reason, Items, Location)
```

---

## Architecture

### Backend (Node.js + Express + Puppeteer)

Located in `scripts/whatsapp-service/`:

| File | Purpose |
|------|---------|
| `server.js` | Express server on port 3001, routes for WhatsApp + GlobalWorx |
| `globalworx.js` | Puppeteer module — accepts, completes, scrapes alert details from GlobalWorx |

**API Endpoints:**

- `GET /api/globalworx/status` — Check if Puppeteer/Chrome is available
- `POST /api/globalworx/accept` — Accept a single alert (`{ url, refNumber }`)
- `POST /api/globalworx/accept-batch` — Accept multiple alerts in sequence
- `POST /api/globalworx/complete-batch` — Complete multiple alerts (click "Complete Here")
- `POST /api/globalworx/scrape-batch` — Scrape alert details without clicking (for PDF backfill)

### Frontend (React)

| File | Purpose |
|------|---------|
| `src/services/globalworxService.js` | HTTP client that calls the backend endpoints |
| `src/services/gmailAlertService.js` | Gmail API integration — fetches alert emails, manages labels (including Error label) |
| `src/context/AppContext.jsx` | Orchestration — `fetchGmailAlerts()`, `autoAcceptAlerts()`, `markResolvedAlertsDone()`, `autoCompleteAlerts()` |
| `src/components/AlertPanel.jsx` | UI — Auto-Check toggle button, 15-minute polling timer |
| `src/components/AlertLog.jsx` | UI — Full alert list, status badges, manual Auto-Clear button, PDF report generation |

---

## How Each Stage Works

### Stage 1: Fetch & Parse Gmail Alerts

**Trigger:** Manual "Fetch" button or Auto-Check timer (every 15 min)

**Code:** `AppContext.jsx` → `fetchGmailAlerts()`

1. Calls `gmailAlertService.fetchAlertEmails(afterDate)` which queries Gmail API for emails matching the alert subject pattern
2. Parses subject lines to extract: store number, ref number (ADUSA-XXXXXXX), alert type
3. Reads Gmail labels on each email to set flags: `globalworxAccepted`, `globalworxDone`, `globalworxCompleted`, `globalworxError`
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
   - **Scrape details** — Extracts Created By, Alert Type, Reason (items + location), store info from the page
   - **Strategy 1 (Accept):** Finds and clicks the "Accept Here" button (`input.accept-btn`)
   - **Strategy 2 (Resolution Time):** Sets the resolution dropdown to "within 48 hours"
   - **Strategy 3 (Submit):** Finds and clicks the "Accept Issue" submit button (`input.si-accept-confirm`)

   **Edge cases:**
   - "Complete Here" showing instead → alert already accepted → returns `success: true, alreadyAccepted`
   - Neither button found → alert already completed/expired → returns `success: true, alreadyCompleted`

4. After all accepts complete, labels successful emails as `Processed` in Gmail
5. Stores scraped `gwCreatedBy`, `gwAlertType`, `gwReason` on each alert object

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

### Stage 4: Auto-Complete via GlobalWorx (Puppeteer)

**Trigger:** Runs automatically after `markResolvedAlertsDone()`, or manually via "Auto-Clear" button in AlertLog

**Code:** `AppContext.jsx` → `autoCompleteAlerts()` → `globalworxService.completeAlerts()` → backend `globalworx.js`

**Eligibility:** `globalworxDone` + has `acceptanceUrl` + NOT `globalworxCompleted` + NOT `globalworxError`

**Concurrency guard:** Only one completion batch runs at a time (`_completingInProgress` flag)

**For each alert URL:**

1. Navigate to the GlobalWorx acceptance URL via Puppeteer (headless)
2. **Scrape alert details** from the page (same as accept flow)
3. Look for "Complete Here" button (`input.timelog-btn`)
4. **Click with 3 fallback strategies + post-click verification:**

   | Attempt | Method | Why |
   |---------|--------|-----|
   | 1 | Puppeteer native `.click()` | Real mouse events (mousedown/mouseup/click) |
   | 2 | `el.onclick.call(el, event)` | Direct onclick handler invocation — works with inline `onclick="..."` attributes |
   | 3 | `schedList.checkout(btn.form, btn)` | Call the GlobalWorx JS function directly |

5. **Post-click verification:** After each attempt, re-checks if the button is still on the page
6. Only returns `success: true` when the button is confirmed gone

**Geolocation handling:**
GlobalWorx's "Complete Here" calls `schedList.checkout()` which internally requests `navigator.geolocation.getCurrentPosition()`. The browser grants geolocation permission via `overridePermissions('https://adusa.goglobalworx.com', ['geolocation'])` + fake coordinates. Without this, the "Requesting Geolocation..." overlay hangs forever.

**Result processing:**

| Result | Action |
|--------|--------|
| `success: true` | Apply `GLOBAL WORKS/Completed` Gmail label |
| `success: true, alreadyCompleted` | Apply `GLOBAL WORKS/Completed` label (no buttons = expired/done) |
| `notAccepted: true` | Strip Done/Completed labels (alert was never accepted) |
| `clickFailed: true` | Retry next cycle; after 2 failures → apply `GLOBAL WORKS/Error` label |

### Stage 5: PDF Route Report

**Trigger:** "PDF" button per route in AlertLog

**Code:** `AlertLog.jsx` → `generateRoutePDF()`

**Auto-Scrape on PDF Generation:**

Before building the PDF, `generateRoutePDF()` checks if any alerts are missing GlobalWorx details (`gwCreatedBy`). If so, it calls the scrape-batch endpoint to backfill the data:

1. Filters alerts that have an `acceptanceUrl` but no `gwCreatedBy`
2. Sends the batch to `POST /api/globalworx/scrape-batch`
3. Backend launches Puppeteer, navigates to each URL, scrapes details (read-only — no button clicking)
4. Stores `gwCreatedBy`, `gwAlertType`, `gwReason` on each alert object
5. Proceeds to build the PDF with the now-populated Details column

This ensures alerts accepted before the scraping feature was added (pre-v2.19.0) still get full details in the PDF report.

Each route PDF includes a table with columns:

| Column | Source |
|--------|--------|
| # | Row number |
| Store | Store name + address from alert data |
| **Details** | **Created By, Alert Type, Reason (items + location) — scraped from GlobalWorx** |
| Last Svc | Days since last visit + scheduled day |
| Status | Open / Resolved |
| Response | Resolution time + monthly alert count |
| Image | Alert image from Gmail |

The Details column shows data like:
```
Excessive out of stocks
By: Creamer, Stephanie
Ad items: 2
Non Ad items: 0
Total items: 2
Location: Shelf/In aisle
```

### Scrape-Only Flow (Backfill)

**Trigger:** Called automatically by PDF generation, or available via API

**Code:** `globalworxService.js` → `scrapeAlertDetails()` → backend `globalworx.js` → `scrapeBatch()`

**Purpose:** Navigate to GlobalWorx alert pages and extract details without clicking any buttons. Used to backfill `gwCreatedBy`, `gwAlertType`, and `gwReason` for alerts processed before scraping was implemented.

**For each alert URL:**

1. Launch Puppeteer (headless), navigate to the GlobalWorx acceptance URL
2. Extract data from the page DOM:
   - **Alert Type** — from `.event-detail-data` paired with "Alert Type" label
   - **Created By** — from `.event-detail-data` paired with "Created By" label
   - **Reason** — from `.event-detail-data` paired with "Reason" label (includes items + location)
   - Store name, vendor, status, address, phone (additional metadata)
3. Return `{ alertDetails: { details: { ... } } }` for each alert
4. No buttons are clicked — purely read-only operation

---

## Gmail Labels

The system uses five Gmail labels to track alert lifecycle:

| Label | Purpose | Applied by |
|-------|---------|-----------|
| `Map Tracker/Logged` | Alert email was fetched and parsed | `fetchGmailAlerts()` |
| `Processed` | Alert was accepted on GlobalWorx | `autoAcceptAlerts()` |
| `GLOBAL WORKS/Done` | Store was visited after alert date | `markResolvedAlertsDone()` |
| `GLOBAL WORKS/Completed` | Alert closed on GlobalWorx (verified) | `autoCompleteAlerts()` |
| `GLOBAL WORKS/Error` | Complete click failed after 2 retries | `autoCompleteAlerts()` |

Labels are auto-created if they don't exist (except Done which must exist in Gmail).

---

## Alert Data Fields (CSV Persistence)

Alerts are persisted to CSV with these columns:

| Field | Source |
|-------|--------|
| RefNumber | Parsed from email subject (ADUSA-XXXXXXX) |
| EmailID | Gmail message ID |
| StoreID, StoreNumber, StoreName, City | Matched from store database |
| Vendor, Company | Parsed from email subject |
| RouteNumber | From store database |
| DateReceived | Email date header |
| **GwCreatedBy** | **Scraped from GlobalWorx page** |
| **GwAlertType** | **Scraped from GlobalWorx page** |
| **GwReason** | **Scraped from GlobalWorx page (includes items + location)** |

---

## Debug & Troubleshooting

### Debug Screenshots

Every GlobalWorx page interaction saves a screenshot + HTML dump to `scripts/whatsapp-service/gw-debug/`:

```
ADUSA-8917047_complete-page-loaded_2026-02-24T23-53-17.png
ADUSA-8917047_after-complete-attempt1-failed_2026-02-24T23-53-23.png
ADUSA-8917047_after-complete-verified_2026-02-24T23-53-26.png
```

Stages captured: `accept-page-loaded`, `accept-not-found`, `after-accept-submit`, `complete-page-loaded`, `after-complete-attempt1-failed`, `after-complete-attempt2-failed`, `after-complete-verified`, `after-complete-all-attempts-failed`, `complete-not-found`, `complete-error`

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[GW]` | Puppeteer backend (globalworx.js) |
| `[Gmail]` | Gmail API operations |
| `[Alerts]` | Alert lifecycle orchestration (AppContext) |
| `[AutoAccept]` | Accept flow results |

### Button Inventory

Each page load logs all buttons on the GlobalWorx page with their tag, type, value, class, and visibility. Key buttons:

| Button | Class | Purpose |
|--------|-------|---------|
| `Accept Here` | `accept-btn` | Accept the alert (Strategy 1) |
| `Accept Issue` | `si-accept-confirm` | Submit the acceptance form (Strategy 3) |
| `Complete Here` | `timelog-btn` | Complete/close the alert |
| `Accept` | `vf-form-button vf-primary` | **DO NOT CLICK** — navigates to dashboard |

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Requesting Geolocation..." hangs | Geolocation permission not granted | `overridePermissions` + `setGeolocation` (already implemented) |
| Button found but click doesn't register | Inline `onclick` not triggered by DOM click | Attempt 2: `el.onclick.call()` (already implemented) |
| Completed label applied but button not pressed | No post-click verification | Verification checks button is gone (already implemented) |
| Alert retries forever | Neither button found = `success: false` | Returns `alreadyCompleted: true` (already fixed) |
| Duplicate concurrent batches | Multiple triggers call `autoCompleteAlerts` | `_completingInProgress` concurrency guard |

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
                                    |  (scrapes GW details)
                                    v
                              markResolvedAlertsDone()
                                    |
                                    v
                              autoCompleteAlerts()
                                    |  (verifies clicks, retries failures)
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

## Implementation Notes

- **Headless browser** — runs in `headless: 'new'` mode (no visible Chrome window)
- **Resilient element finding** — CSS → XPath → text search fallback chains
- **ES5-compatible evaluate code** — `var`, `indexOf`, for-loops instead of ES6 to handle GlobalWorx's older JS environment
- **CSS selector specificity** — Only matches exact button classes (`accept-btn`, `timelog-btn`, `si-accept-confirm`). Broad wildcards like `input[value*="Accept"]` match wrong elements (dashboard filters, navigation buttons)
- **Geolocation override** — Required for Complete flow; granted to `https://adusa.goglobalworx.com`
- **Retry with Error label** — Click failures retry up to 2 cycles before applying `GLOBAL WORKS/Error` label and excluding from future attempts

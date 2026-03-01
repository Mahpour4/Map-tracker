/**
 * Google Sheets Service — uses Google Sheets API v4 with OAuth2
 *
 * Setup required:
 * 1. Create a Google Cloud project at https://console.cloud.google.com
 * 2. Enable the Google Sheets API
 * 3. Create OAuth 2.0 Client ID (Web application type)
 * 4. Add your app's origin to Authorized JavaScript origins
 * 5. Paste the Client ID and Spreadsheet ID in the app settings
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
// Column mapping (0-indexed) matching the sheet structure:
// C=Description, D=price, E=Bags/case, F-K=hidden formula cols, M=Cases(visible)
const CASES_COL = 12; // Column M (0-indexed = 12)
const DESC_COL = 2;   // Column C (0-indexed = 2)

const STORAGE_KEYS = {
  clientId: 'google_sheets_client_id',
  spreadsheetId: 'google_sheets_spreadsheet_id',
  legacyUrl: 'google_sheets_webapp_url',
};

// Defaults so workers don't need to enter these manually
const DEFAULTS = {
  clientId: '187494534953-bld1lk3dg5280fu0g11d8qjtup2culnu.apps.googleusercontent.com',
  spreadsheetId: '1p1Wxrx9DvH1TReUiri_NG5lM5z4xArQFOnJa5YJtnBk',
};

let gapiInited = false;
let gisInited = false;
let tokenClient = null;
let currentResolve = null;
let currentReject = null;

// ---- Config helpers ----

export function getGoogleClientId() {
  return localStorage.getItem(STORAGE_KEYS.clientId) || DEFAULTS.clientId;
}
export function setGoogleClientId(val) {
  localStorage.setItem(STORAGE_KEYS.clientId, val.trim());
}
export function getSpreadsheetId() {
  return localStorage.getItem(STORAGE_KEYS.spreadsheetId) || DEFAULTS.spreadsheetId;
}
export function setSpreadsheetId(val) {
  localStorage.setItem(STORAGE_KEYS.spreadsheetId, val.trim());
}

// Legacy compat — keep old Apps Script URL accessors
export function getGoogleSheetsUrl() {
  return localStorage.getItem(STORAGE_KEYS.legacyUrl) || '';
}
export function setGoogleSheetsUrl(url) {
  localStorage.setItem(STORAGE_KEYS.legacyUrl, url.trim());
}

export function isGoogleSheetsConfigured() {
  return !!(getGoogleClientId() && getSpreadsheetId());
}

// ---- GAPI + GIS initialization ----

function waitForGapi() {
  return new Promise((resolve) => {
    if (window.gapi) return resolve();
    const check = setInterval(() => {
      if (window.gapi) { clearInterval(check); resolve(); }
    }, 100);
  });
}

function waitForGis() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(check); resolve(); }
    }, 100);
  });
}

async function initGapi() {
  if (gapiInited) return;
  await waitForGapi();
  await new Promise((resolve, reject) => {
    window.gapi.load('client', { callback: resolve, onerror: reject });
  });
  await window.gapi.client.init({});
  await window.gapi.client.load(DISCOVERY_DOC);
  gapiInited = true;
}

async function initGis() {
  if (gisInited) return;
  await waitForGis();
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Google Client ID not configured');
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        if (currentReject) currentReject(new Error(resp.error));
      } else {
        // Persist token to localStorage so it survives page refresh
        const tokenData = {
          access_token: resp.access_token,
          token_type: resp.token_type,
          expires_in: resp.expires_in,
          scope: resp.scope,
          saved_at: Date.now(),
        };
        localStorage.setItem('google_oauth_token', JSON.stringify(tokenData));
        if (currentResolve) currentResolve(resp);
      }
      currentResolve = null;
      currentReject = null;
    },
  });
  gisInited = true;
}

/** Restore a saved token from localStorage if still valid */
function restoreSavedToken() {
  try {
    const saved = localStorage.getItem('google_oauth_token');
    if (!saved) return false;
    const tokenData = JSON.parse(saved);
    const elapsed = (Date.now() - tokenData.saved_at) / 1000;
    // Token typically expires in 3600s, allow 5 min buffer
    if (elapsed < (tokenData.expires_in || 3600) - 300) {
      window.gapi.client.setToken({
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
      });
      return true;
    }
    // Token expired — don't remove, ensureAuth will silently refresh
    return false;
  } catch {
    return false;
  }
}

/** Ensure we have a valid access token (prompts consent if needed) */
async function ensureAuth() {
  await initGapi();
  // Try restoring saved token first
  if (restoreSavedToken()) return;
  await initGis();
  // Check if we already have a valid token in memory
  const token = window.gapi.client.getToken();
  if (token && token.access_token) return;
  // Request token — try silent first, then consent popup
  return new Promise((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

/** Explicit sign-in (for setup flow — shows consent popup) */
export async function authenticate() {
  await initGapi();
  await initGis();
  return new Promise((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/** Sign out / revoke token */
export function signOut() {
  const token = window.gapi.client.getToken();
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token);
    window.gapi.client.setToken(null);
  }
  localStorage.removeItem('google_oauth_token');
  gisInited = false;
  tokenClient = null;
}

/** Check if user has ever signed in (has a token saved, even if expired — ensureAuth will refresh it) */
export function isSignedIn() {
  if (window.gapi?.client?.getToken()?.access_token) return true;
  // Check localStorage — if they ever signed in, we can silently refresh
  return !!localStorage.getItem('google_oauth_token');
}

// ---- Tab name builder ----

/** Build the tab name that matches the Google Sheet convention: "route name M/DD/YY" */
export function buildTabName(routeNumber, name, dateStr) {
  const parts = dateStr.split('-');
  let datePart = dateStr;
  if (parts.length === 3) {
    const month = parseInt(parts[1], 10);
    const day = parts[2];
    const year = parts[0].slice(-2);
    datePart = `${month}/${day}/${year}`;
  }
  if (name) {
    return routeNumber ? `${routeNumber} ${name} ${datePart}` : `${name} ${datePart}`;
  }
  return `${routeNumber} ${datePart}`;
}

// ---- Sheets API operations ----

/** List all sheet tabs (excluding the template) */
export async function listSheetTabs() {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  console.log('[Sheets] Listing tabs for spreadsheet:', spreadsheetId);

  let response;
  try {
    response = await window.gapi.client.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title,sheets.properties.sheetId',
    });
  } catch (err) {
    console.error('[Sheets] API error:', err);
    const msg = err?.result?.error?.message || err?.message || JSON.stringify(err);
    throw new Error('Google Sheets API error: ' + msg);
  }

  console.log('[Sheets] Response:', JSON.stringify(response.result));

  const tabs = (response.result.sheets || [])
    .map(s => s.properties.title);
  const tabsWithIds = (response.result.sheets || [])
    .map(s => ({ title: s.properties.title, sheetId: s.properties.sheetId }));

  console.log('[Sheets] Found tabs:', tabs);
  return { success: true, tabs, tabsWithIds };
}

/** Rename a sheet tab */
export async function renameSheetTab(sheetId, newName) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  await window.gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId, title: newName },
          fields: 'title',
        },
      }],
    },
  });
  return { success: true, newName };
}

/** Build a URL to open the Google Sheet at a specific tab */
export function getSheetTabUrl(sheetId) {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

/** Build a URL to open the Google Sheet (no API needed — works for shared users) */
export function getSpreadsheetUrl() {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Check if a spreadsheet ID is configured (no client ID required) */
export function hasSpreadsheetId() {
  return !!getSpreadsheetId();
}

/** Read an order from a specific sheet tab */
export async function getOrderFromSheet(tabName) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const response = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = response.result.values || [];
  const items = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const desc = String(row[DESC_COL] || '').trim();
    const casesVal = row[CASES_COL];

    // Extract SKU from description (format: "000040 - 1.49 Dr Orig Ch")
    const skuMatch = desc.match(/^(\d{3,7})/);
    if (!skuMatch) continue;

    const sku = skuMatch[1];
    const cases = parseFloat(casesVal) || 0;
    const units = parseFloat(row[6]) || 0;   // Column G
    const gross = parseFloat(row[7]) || 0;   // Column H
    const net = parseFloat(row[10]) || 0;    // Column K

    if (cases > 0) {
      items.push({ sku, cases, units, gross, net, row: r + 1 });
    }
  }

  return { success: true, tab: tabName, items };
}

/** Read ALL SKUs with current case values from a sheet tab (including empty/zero) */
export async function readSheetCases(tabName) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const response = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = response.result.values || [];
  const skuCases = {}; // sku → current case count on sheet

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const desc = String(row[DESC_COL] || '').trim();
    const skuMatch = desc.match(/^(\d{3,7})/);
    if (!skuMatch) continue;
    const casesVal = parseFloat(row[CASES_COL]) || 0;
    skuCases[skuMatch[1]] = casesVal;
  }

  return skuCases;
}

const TEMPLATE_TAB = 'Template';

/** Copy the template tab and rename it */
async function copyTemplateTab(spreadsheetId, tabName) {
  const meta = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const templateSheet = (meta.result.sheets || []).find(
    s => s.properties.title === TEMPLATE_TAB
  );
  if (!templateSheet) throw new Error(`Template tab not found: "${TEMPLATE_TAB}". Create a tab with this exact name in your Google Sheet.`);

  // Copy the template
  const copyResponse = await window.gapi.client.sheets.spreadsheets.sheets.copyTo({
    spreadsheetId,
    sheetId: templateSheet.properties.sheetId,
    resource: { destinationSpreadsheetId: spreadsheetId },
  });

  const newSheetId = copyResponse.result.sheetId;

  // Rename the copied sheet
  await window.gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: newSheetId, title: tabName },
          fields: 'title',
        },
      }],
    },
  });

  return newSheetId;
}

/** Create a template copy for a route/driver/date. Returns { success, tabName } or { success:false, error } */
export async function createTemplateCopy(routeNumber, driverName, dateStr) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const tabName = buildTabName(routeNumber, driverName, dateStr);

  // Check if tab already exists
  const meta = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const existingTabs = (meta.result.sheets || []).map(s => s.properties.title);

  if (existingTabs.includes(tabName)) {
    return { success: true, tabName, alreadyExists: true };
  }

  await copyTemplateTab(spreadsheetId, tabName);

  // Write header: C1 = "route - driver", E1 = date, P3-P8 = invoice/load labels
  const headerUpdates = [];
  const driverLabel = [routeNumber, driverName].filter(Boolean).join(' - ');
  if (driverLabel) {
    headerUpdates.push({ range: `'${tabName}'!C1`, values: [[driverLabel]] });
  }
  if (dateStr) {
    const parts = dateStr.split('-');
    const formatted = parts.length === 3 ? `${parseInt(parts[1],10)}/${parts[2]}/${parts[0].slice(-2)}` : dateStr;
    headerUpdates.push({ range: `'${tabName}'!E1`, values: [[formatted]] });
  }
  // Always write labels so they're visible immediately after template copy
  headerUpdates.push({ range: `'${tabName}'!P3`, values: [['Invoice #:  ']] });
  headerUpdates.push({ range: `'${tabName}'!P4`, values: [['WH Cases:  ']] });
  headerUpdates.push({ range: `'${tabName}'!P5`, values: [['WH Amount:  ']] });
  headerUpdates.push({ range: `'${tabName}'!P6`, values: [['Load #:  ']] });
  headerUpdates.push({ range: `'${tabName}'!P7`, values: [['DRV Cases:  ']] });
  headerUpdates.push({ range: `'${tabName}'!P8`, values: [['DRV Amount:  ']] });
  await window.gapi.client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: { valueInputOption: 'RAW', data: headerUpdates },
  });

  return { success: true, tabName, alreadyExists: false };
}

/** Push an order to Google Sheets (copies template if tab doesn't exist, writes cases to column M) */
export async function pushOrderToSheet(order) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const datePart = buildTabName(order.routeNumber, order.name, order.date);
  const tabName = order.tabName || datePart;

  // Check if tab exists
  const meta = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const existingTabs = (meta.result.sheets || []).map(s => s.properties.title);

  if (!existingTabs.includes(tabName)) {
    await copyTemplateTab(spreadsheetId, tabName);
  }

  // Read the tab to find SKU → row mapping from column C
  const dataResponse = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const data = dataResponse.result.values || [];
  const skuRowMap = {}; // sku → row index (0-based)

  for (let r = 0; r < data.length; r++) {
    const desc = String(data[r][DESC_COL] || '').trim();
    const skuMatch = desc.match(/^(\d{3,7})/);
    if (skuMatch) {
      skuRowMap[skuMatch[1]] = r;
    }
  }

  // Write cases to column M for matching SKUs
  const items = order.items || [];
  let written = 0;
  const notFound = [];
  const updateData = [];

  for (const item of items) {
    const rowIdx = skuRowMap[item.sku];
    if (rowIdx !== undefined) {
      const cellRange = `'${tabName}'!M${rowIdx + 1}`;
      updateData.push({ range: cellRange, values: [[item.cases]] });
      written++;
    } else {
      notFound.push(item.sku);
    }
  }

  if (updateData.length > 0) {
    await window.gapi.client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updateData,
      },
    });
  }

  // Write header: C1 = "route# - driver name", E1 = date, A2 = invoice info, A3 = load info
  const headerUpdates = [];
  const driverLabel = [order.routeNumber, order.name].filter(Boolean).join(' - ');
  if (driverLabel) {
    headerUpdates.push({ range: `'${tabName}'!C1`, values: [[driverLabel]] });
  }
  if (order.date) {
    const parts = order.date.split('-');
    if (parts.length === 3) {
      const dateFmt = `${parseInt(parts[1], 10)}/${parts[2]}/${parts[0].slice(-2)}`;
      headerUpdates.push({ range: `'${tabName}'!E1`, values: [[dateFmt]] });
    }
  }

  // Invoice / Load metadata — column P rows 3-8, always written so labels are visible
  const fmtAmt = (v) => v ? `$${parseFloat(v).toFixed(2)}` : '';
  headerUpdates.push({ range: `'${tabName}'!P3`, values: [[`Invoice #:  ${order.invoiceNumber || ''}`]] });
  headerUpdates.push({ range: `'${tabName}'!P4`, values: [[`WH Cases:  ${order.invoiceCases || ''}`]] });
  headerUpdates.push({ range: `'${tabName}'!P5`, values: [[`WH Amount:  ${fmtAmt(order.invoiceAmount)}`]] });
  headerUpdates.push({ range: `'${tabName}'!P6`, values: [[`Load #:  ${order.loadNumber || ''}`]] });
  headerUpdates.push({ range: `'${tabName}'!P7`, values: [[`DRV Cases:  ${order.loadCases || ''}`]] });
  headerUpdates.push({ range: `'${tabName}'!P8`, values: [[`DRV Amount:  ${fmtAmt(order.loadAmount)}`]] });

  if (headerUpdates.length > 0) {
    await window.gapi.client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: headerUpdates,
      },
    });
  }

  return { success: true, tab: tabName, written, notFound, total: items.length };
}

/**
 * Create or overwrite a "Route {N} Summary" sheet tab with one row per order for that route.
 * Columns: Date | Invoice # | WH Cases | WH Amount | Load # | DRV Cases | DRV Amount
 * Ends with a totals row.
 */
export async function updateRouteSummarySheet(routeNumber, driverName, routeOrders) {
  await ensureAuth();
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Spreadsheet ID not configured');

  const summaryTabName = `Route ${routeNumber} Summary`;

  // Ensure the tab exists (create blank if not)
  const meta = await window.gapi.client.sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const existing = (meta.result.sheets || []).find(s => s.properties.title === summaryTabName);
  if (!existing) {
    await window.gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{ addSheet: { properties: { title: summaryTabName } } }],
      },
    });
  }

  // Sort orders by date ascending
  const sorted = [...routeOrders].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${parseInt(m, 10)}/${parseInt(d, 10)}/${y ? y.slice(-2) : ''}`;
  };
  const fmtMoney = (v) => (v != null && v !== '') ? `$${parseFloat(v).toFixed(2)}` : '';

  // Build rows: title, blank, header, data rows, blank, totals
  const rows = [
    [`Route ${routeNumber}${driverName ? ` — ${driverName}` : ''} | Order History`],
    [],
    ['Date', 'Invoice #', 'WH Cases', 'WH Amount', 'Load #', 'DRV Cases', 'DRV Amount'],
  ];

  sorted.forEach(o => {
    rows.push([
      fmtDate(o.date),
      o.invoiceNumber || '',
      (o.invoiceCases != null && o.invoiceCases !== '') ? String(o.invoiceCases) : '',
      fmtMoney(o.invoiceAmount),
      o.loadNumber || '',
      (o.loadCases != null && o.loadCases !== '') ? String(o.loadCases) : '',
      fmtMoney(o.loadAmount),
    ]);
  });

  const totalInvCases = sorted.reduce((s, o) => s + (parseFloat(o.invoiceCases) || 0), 0);
  const totalInvAmt   = sorted.reduce((s, o) => s + (parseFloat(o.invoiceAmount) || 0), 0);
  const totalLdCases  = sorted.reduce((s, o) => s + (parseFloat(o.loadCases) || 0), 0);
  const totalLdAmt    = sorted.reduce((s, o) => s + (parseFloat(o.loadAmount) || 0), 0);

  rows.push([]);
  rows.push([
    'TOTAL', '',
    totalInvCases > 0 ? String(totalInvCases) : '',
    totalInvAmt   > 0 ? fmtMoney(totalInvAmt) : '',
    '',
    totalLdCases  > 0 ? String(totalLdCases) : '',
    totalLdAmt    > 0 ? fmtMoney(totalLdAmt) : '',
  ]);

  // Clear then write
  await window.gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${summaryTabName}'`,
  });
  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${summaryTabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows },
  });

  return { success: true, tabName: summaryTabName, orderCount: sorted.length };
}


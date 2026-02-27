/**
 * Google Sheets Sync Service
 * Communicates with the Apps Script Web App deployed on the warehouse order spreadsheet.
 */

const STORAGE_KEY = 'google_sheets_webapp_url';

export function getGoogleSheetsUrl() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function setGoogleSheetsUrl(url) {
  localStorage.setItem(STORAGE_KEY, url.trim());
}

export function isGoogleSheetsConfigured() {
  return !!getGoogleSheetsUrl();
}

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

/** List all sheet tabs (excluding the template) */
export async function listSheetTabs() {
  const url = getGoogleSheetsUrl();
  if (!url) throw new Error('Google Sheets URL not configured');

  const res = await fetch(`${url}?action=listTabs`);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  return res.json();
}

/** Read an order from a specific sheet tab */
export async function getOrderFromSheet(tabName) {
  const url = getGoogleSheetsUrl();
  if (!url) throw new Error('Google Sheets URL not configured');

  const res = await fetch(`${url}?action=getOrder&tab=${encodeURIComponent(tabName)}`);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  return res.json();
}

/** Push an order to Google Sheets (creates tab from template if needed) */
export async function pushOrderToSheet(order) {
  const url = getGoogleSheetsUrl();
  if (!url) throw new Error('Google Sheets URL not configured');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // Apps Script needs text/plain for CORS
    body: JSON.stringify({
      action: 'submitOrder',
      routeNumber: order.routeNumber,
      date: order.date,
      name: order.name || '',
      tabName: order.tabName || '',
      items: (order.items || []).map(i => ({ sku: i.sku, cases: i.cases })),
    }),
  });

  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  return res.json();
}

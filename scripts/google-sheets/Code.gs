/**
 * Warehouse Orders — Google Apps Script
 *
 * Deploy: Extensions → Apps Script → Deploy → Web App
 *   Execute as: Me
 *   Access: Anyone
 *
 * Paste the deployed URL into the Map Tracker app's Orders page settings.
 */

const TEMPLATE_TAB = 'Forma to copy dont delete';

// Column mapping (1-indexed) based on the CSV structure:
// A=row#, B=TYPE, C=Description, D=price, E=Bags/case, F=Cases, G=Units, H=Gross$, I=Discount$, J=Promo$, K=Net$
const CASES_COL = 6;  // Column F = Cases ordered
const DESC_COL = 3;   // Column C = Description (has SKU)
const UNITS_COL = 7;  // Column G = Units (formula)
const GROSS_COL = 8;  // Column H = Gross $ (formula)
const NET_COL = 11;   // Column K = Net $ (formula)

function doGet(e) {
  try {
    const action = e.parameter.action || 'listTabs';

    if (action === 'listTabs') {
      // List all sheet tabs (excluding the template)
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = ss.getSheets();
      const tabs = sheets
        .map(s => s.getName())
        .filter(n => n !== TEMPLATE_TAB);
      return jsonResponse({ success: true, tabs: tabs });
    }

    if (action === 'getOrder') {
      // Read order data from a specific tab
      const tabName = e.parameter.tab;
      if (!tabName) return jsonResponse({ success: false, error: 'Missing tab parameter' });

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) return jsonResponse({ success: false, error: 'Tab not found: ' + tabName });

      const data = sheet.getDataRange().getValues();
      const items = [];

      for (let r = 0; r < data.length; r++) {
        const row = data[r];
        const desc = String(row[DESC_COL - 1] || '').trim();
        const casesVal = row[CASES_COL - 1];

        // Extract SKU from description (format: "000040 - 1.49 Dr Orig Ch" or "027124 - .50 W Pln Chips")
        const skuMatch = desc.match(/^(\d{3,7})/);
        if (!skuMatch) continue;

        const sku = skuMatch[1];
        const cases = parseFloat(casesVal) || 0;
        const units = parseFloat(row[UNITS_COL - 1]) || 0;
        const gross = parseFloat(row[GROSS_COL - 1]) || 0;
        const net = parseFloat(row[NET_COL - 1]) || 0;

        if (cases > 0) {
          items.push({ sku: sku, cases: cases, units: units, gross: gross, net: net, row: r + 1 });
        }
      }

      return jsonResponse({ success: true, tab: tabName, items: items });
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'submitOrder') {
      const routeNumber = body.routeNumber;
      const date = body.date; // YYYY-MM-DD
      const items = body.items || []; // [{ sku, cases }]
      const name = body.name || '';
      const datePart = formatDate(date);
      const tabName = body.tabName || (
        name
          ? (routeNumber ? routeNumber + ' ' + name + ' ' + datePart : name + ' ' + datePart)
          : (routeNumber + ' ' + datePart)
      );

      const ss = SpreadsheetApp.getActiveSpreadsheet();

      // Check if tab already exists
      let sheet = ss.getSheetByName(tabName);

      if (!sheet) {
        // Copy template tab
        const template = ss.getSheetByName(TEMPLATE_TAB);
        if (!template) return jsonResponse({ success: false, error: 'Template tab not found: ' + TEMPLATE_TAB });

        sheet = template.copyTo(ss);
        sheet.setName(tabName);
      }

      // Read all descriptions to find SKU row mapping
      const data = sheet.getDataRange().getValues();
      const skuRowMap = {}; // sku -> row number (1-indexed)

      for (let r = 0; r < data.length; r++) {
        const desc = String(data[r][DESC_COL - 1] || '').trim();
        const skuMatch = desc.match(/^(\d{3,7})/);
        if (skuMatch) {
          skuRowMap[skuMatch[1]] = r + 1;
        }
      }

      // Write case counts
      let written = 0;
      let notFound = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const row = skuRowMap[item.sku];
        if (row) {
          sheet.getRange(row, CASES_COL).setValue(item.cases);
          written++;
        } else {
          notFound.push(item.sku);
        }
      }

      // Write the name/date header if row 1 has a name field
      if (body.name) {
        sheet.getRange(1, 1).setValue(body.name);
      }
      if (date) {
        sheet.getRange(1, 5).setValue(formatDate(date));
      }

      return jsonResponse({
        success: true,
        tab: tabName,
        written: written,
        notFound: notFound,
        total: items.length
      });
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function formatDate(dateStr) {
  // YYYY-MM-DD → M/DD/YY (matches existing tab naming: "2/26/26")
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    var month = parseInt(parts[1], 10);
    var day = parts[2];
    var year = parts[0].slice(-2);
    return month + '/' + day + '/' + year;
  }
  return dateStr;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

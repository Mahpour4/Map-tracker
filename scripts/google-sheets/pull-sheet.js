#!/usr/bin/env node
/**
 * pull-sheet.js — One-time pull of warehouse orders from Google Sheets
 *
 * Uses the same OAuth credentials as sync-orders.js.
 * First run will open a browser for auth, then saves token for reuse.
 *
 * Usage:
 *   node pull-sheet.js                    # pull all order tabs
 *   node pull-sheet.js --dry-run          # preview without writing
 *   node pull-sheet.js --tab "206 eastern shore 2/26/26"  # one tab only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import http from 'http';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1p1Wxrx9DvH1TReUiri_NG5lM5z4xArQFOnJa5YJtnBk';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'src', 'data', 'warehouseOrders.json');

// Column indices (0-based) matching the sheet template
const DESC_COL = 2;   // Column C — Description (contains SKU)
const CASES_COL = 5;  // Column F — Cases ordered
const UNITS_COL = 6;  // Column G — Units
const GROSS_COL = 7;  // Column H — Gross $
const NET_COL = 10;   // Column K — Net $
const META_COL = 15;  // Column P — Invoice/load metadata

// Tabs to skip
const SKIP_TABS = new Set([
  'Forma to copy dont delete',
  'Template',
]);

// ── Product Catalog ─────────────────────────────────────────────────
let PRODUCT_CATALOG = [];
try {
  const catalogPath = path.join(__dirname, '..', '..', 'src', 'data', 'productCatalog.js');
  const catalogSrc = fs.readFileSync(catalogPath, 'utf-8');
  const match = catalogSrc.match(/export const PRODUCT_CATALOG\s*=\s*(\[[\s\S]*?\n\];)/);
  if (match) {
    PRODUCT_CATALOG = new Function('return ' + match[1])();
  }
} catch (e) {
  console.warn('⚠ Could not load product catalog:', e.message);
}
const catalogBySku = Object.fromEntries(PRODUCT_CATALOG.map(p => [p.sku, p]));

// ── Auth (same as sync-orders.js) ───────────────────────────────────
async function authorize() {
  let creds;
  if (fs.existsSync(CREDENTIALS_PATH)) {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  } else {
    console.error('❌ Missing credentials.json — copy your OAuth client secret to:');
    console.error('   ' + CREDENTIALS_PATH);
    process.exit(1);
  }

  const { client_id, client_secret } = creds.web || creds.installed || {};
  const redirect_uri = 'http://localhost:3333/oauth2callback';
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2.setCredentials(token);
    if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
      try {
        const { credentials } = await oauth2.refreshAccessToken();
        oauth2.setCredentials(credentials);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
        console.log('🔄 Token refreshed');
      } catch (e) {
        console.log('⚠ Token refresh failed, re-authenticating...');
        return await getNewToken(oauth2);
      }
    }
    return oauth2;
  }
  return await getNewToken(oauth2);
}

function getNewToken(oauth2) {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    console.log('\n🔑 Authorize this app by visiting:\n');
    console.log('   ' + authUrl + '\n');

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:3333');
      const code = url.searchParams.get('code');
      if (!code) { res.end('No code received'); return; }
      try {
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        res.end('✅ Authorized! You can close this tab.');
        console.log('✅ Token saved to', TOKEN_PATH);
        server.close();
        resolve(oauth2);
      } catch (err) {
        res.end('Error: ' + err.message);
        server.close();
        reject(err);
      }
    });
    server.listen(3333, () => console.log('   Waiting for authorization...'));
  });
}

// ── Parse tab name ──────────────────────────────────────────────────
function parseTabName(tabName) {
  const dateMatch = tabName.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/);
  if (!dateMatch) return null;
  const month = dateMatch[1].padStart(2, '0');
  const day = dateMatch[2].padStart(2, '0');
  let year = dateMatch[3];
  if (year.length === 2) year = '20' + year;
  const date = `${year}-${month}-${day}`;
  const prefix = tabName.slice(0, dateMatch.index).trim();
  const parts = prefix.split(/\s+/);
  const routeNumber = /^\d+$/.test(parts[0]) ? parts[0] : '';
  const name = routeNumber ? parts.slice(1).join(' ') : prefix;
  return { routeNumber, name, date, tabName };
}

// ── Parse sheet data into an order ──────────────────────────────────
function parseSheetData(rows, tabMeta) {
  const items = [];

  const parsePCell = (val) => {
    if (val == null) return '';
    const s = String(val).trim();
    const m = s.match(/:\s*(.*)$/);
    return m ? m[1].trim() : '';
  };
  const invoiceNumber = rows[2] ? parsePCell(rows[2][META_COL]) : '';
  const invoiceCases  = rows[3] ? parsePCell(rows[3][META_COL]) : '';
  const invoiceAmount = rows[4] ? parsePCell(rows[4][META_COL])?.replace(/^\$/, '') : '';
  const loadNumber    = rows[5] ? parsePCell(rows[5][META_COL]) : '';
  const loadCases     = rows[6] ? parsePCell(rows[6][META_COL]) : '';
  const loadAmount    = rows[7] ? parsePCell(rows[7][META_COL])?.replace(/^\$/, '') : '';

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const desc = String(row[DESC_COL] || '').trim();
    const skuMatch = desc.match(/^(\d{3,7})/);
    if (!skuMatch) continue;

    const sku = skuMatch[1];
    const cases = parseFloat(row[CASES_COL]) || 0;
    const unitCount = parseFloat(row[UNITS_COL]) || 0;
    const gross = parseFloat(row[GROSS_COL]) || 0;

    if (cases <= 0) continue;

    const cat = catalogBySku[sku];
    const upc = cat?.upc || 0;
    const price = cat?.price || 0;
    const category = cat?.category || '';
    const descClean = cat?.desc || desc.replace(/^\d+\s*-\s*/, '').trim();
    const computedUnits = upc > 0 ? cases * upc : unitCount;

    items.push({
      lineId: randomUUID(),
      sku,
      category,
      desc: descClean,
      cases,
      orderUnits: 0,
      upc,
      price,
      units: computedUnits,
      gross: gross || computedUnits * price,
    });
  }

  const totalCases = items.reduce((s, i) => s + i.cases, 0);
  const totalUnits = items.reduce((s, i) => s + i.units, 0);
  const totalGross = items.reduce((s, i) => s + i.gross, 0);

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    routeNumber: tabMeta.routeNumber,
    date: tabMeta.date,
    name: tabMeta.name,
    invoiceNumber, invoiceCases, invoiceAmount,
    loadNumber, loadCases, loadAmount,
    status: 'synced',
    source: 'sheet-sync',
    sheetTab: tabMeta.tabName,
    items,
    totals: { totalCases, totalUnits, totalGross },
  };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleTabIdx = args.indexOf('--tab');
  const singleTab = singleTabIdx >= 0 ? args[singleTabIdx + 1] : null;

  const auth = await authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Get all tabs
  console.log('\n📋 Fetching sheet tabs...');
  const { data: meta } = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });
  const allTabs = meta.sheets.map(s => s.properties.title);
  console.log(`   Found ${allTabs.length} tabs`);

  // 2. Filter to order tabs
  const orderTabs = allTabs.filter(t => {
    if (SKIP_TABS.has(t)) return false;
    if (t.toLowerCase().includes('summary')) return false;
    if (t.toLowerCase().includes('template')) return false;
    if (singleTab && t !== singleTab) return false;
    return parseTabName(t) !== null;
  });
  console.log(`   ${orderTabs.length} order tabs to process\n`);

  // 3. Load existing to preserve IDs
  let existing = { orders: [], lastSyncedAt: null };
  if (fs.existsSync(OUTPUT_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')); } catch (e) {}
  }
  const existingByTab = {};
  (existing.orders || []).forEach(o => {
    if (o.sheetTab) existingByTab[o.sheetTab] = o;
  });

  // 4. Pull each tab
  const orders = [];
  for (const tab of orderTabs) {
    const tabMeta = parseTabName(tab);
    if (!tabMeta) continue;

    process.stdout.write(`   📥 ${tab} ... `);
    try {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab}'`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const rows = data.values || [];
      const order = parseSheetData(rows, tabMeta);

      // Preserve existing IDs
      const prev = existingByTab[tab];
      if (prev) {
        order.id = prev.id;
        order.createdAt = prev.createdAt;
        const prevLineIds = {};
        (prev.items || []).forEach(i => { if (i.lineId) prevLineIds[i.sku] = i.lineId; });
        order.items = order.items.map(i => ({
          ...i,
          lineId: prevLineIds[i.sku] || i.lineId,
        }));
      }

      orders.push(order);
      console.log(`${order.items.length} items, ${order.totals.totalCases} cases`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  // 5. Merge with app-created orders
  const appOrders = (existing.orders || []).filter(o => o.source !== 'sheet-sync');
  const mergedOrders = [...appOrders, ...orders];

  const output = {
    orders: mergedOrders,
    lastSyncedAt: new Date().toISOString(),
  };

  // 6. Summary
  console.log('\n────────────────────────────────────────');
  console.log(`  Sheet orders:  ${orders.length}`);
  console.log(`  App orders:    ${appOrders.length} (preserved)`);
  console.log(`  Total:         ${mergedOrders.length}`);
  console.log(`  Total cases:   ${mergedOrders.reduce((s, o) => s + (o.totals?.totalCases || 0), 0)}`);
  console.log(`  Total units:   ${mergedOrders.reduce((s, o) => s + (o.totals?.totalUnits || 0), 0)}`);
  console.log('────────────────────────────────────────\n');

  if (dryRun) {
    console.log('🔍 Dry run — not writing. Orders:');
    mergedOrders.forEach(o => {
      console.log(`   ${o.sheetTab || o.id} — ${o.items.length} items, ${o.totals?.totalCases} cases [${o.source}]`);
    });
  } else {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`✅ Written to ${OUTPUT_PATH}`);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});

const fs = require('fs');
const files = [
  'dao-transactions-20260222 (9).txt',
  'dao-transactions-20260222 (10).txt',
  'dao-transactions-20260222 (11).txt',
  'jan scrape.txt',
];
let raw = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    console.log(f + ':', d.length, 'rows');
    raw = raw.concat(d);
  } catch(e) { console.log(f + ': not found, skipping'); }
}
console.log('Combined raw rows:', raw.length);

// Dedup all rows: group by ID+route+docType, prefer Invoice over Delivery
const seen = new Map();
for (const row of raw) {
  if (!row.id) {
    // Rows without ID (Settle, etc.) — dedup by route+docType+date
    const key = 'noid|' + row.route + '|' + row.docType + '|' + row.docDate;
    if (!seen.has(key)) seen.set(key, row);
    continue;
  }
  // For rows with ID: key by ID+route+docType (but merge Invoice/Delivery)
  const isInvDel = row.docType === 'Invoice' || row.docType === 'Delivery';
  const key = row.id + '|' + row.route + '|' + (isInvDel ? 'INV' : row.docType);
  if (seen.has(key)) {
    const existing = seen.get(key);
    // Prefer Invoice over Delivery
    if (row.docType === 'Invoice' && existing.docType === 'Delivery') {
      seen.set(key, row);
    }
  } else {
    seen.set(key, row);
  }
}
const data = [...seen.values()];
console.log('After dedup:', data.length, '(removed', raw.length - data.length, 'duplicates)');

// Date range - parse MM/DD/YYYY hh:mmAM/PM format
function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[4]);
  if (m[6].toUpperCase() === 'PM' && h < 12) h += 12;
  if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
  return new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]), h, parseInt(m[5]));
}
const dates = data.map(r => parseDate(r.docDate)).filter(d => d).sort((a, b) => a - b);
console.log('First date:', dates[0]?.toLocaleDateString());
console.log('Last date:', dates[dates.length - 1]?.toLocaleDateString());

// Doc types
const types = {};
data.forEach(r => { types[r.docType] = (types[r.docType] || 0) + 1; });
console.log('\nDoc types:', JSON.stringify(types, null, 2));

// Non-void invoices
const invoices = data.filter(r => r.docType === 'Invoice' && r['void'] !== 'True');
console.log('\nNon-void invoices:', invoices.length);
const voids = data.filter(r => r['void'] === 'True');
console.log('Voided rows:', voids.length);

// Per-route breakdown
const routeMap = {};
const SUB_ROUTE = { '206': '210' };
for (const row of data) {
  let rt = row.route ? row.route.slice(-3) : '???';
  if (rt.startsWith('0')) rt = rt.slice(1); // 099 -> 99
  if (SUB_ROUTE[rt]) rt = SUB_ROUTE[rt]; // merge 206->210
  if (!routeMap[rt]) routeMap[rt] = { invoices: 0, loads: 0, gross: 0, credits: 0, loadAmt: 0, stores: new Set(), allRows: 0 };
  routeMap[rt].allRows++;

  if (row.docType === 'Invoice' && row['void'] !== 'True') {
    routeMap[rt].invoices++;
    if (row.amount >= 0) routeMap[rt].gross += row.amount;
    else routeMap[rt].credits += row.amount;
    if (row.custNum) routeMap[rt].stores.add(row.custNum);
  }
  // Only count Load (not Route Order — they share the same ID and amount)
  if (row.docType === 'Load') {
    routeMap[rt].loads++;
    routeMap[rt].loadAmt += row.amount || 0;
  }
}

console.log('\n=== PER-ROUTE BREAKDOWN ===');
console.log('Route | Invoices | Gross | Credits | Revenue | Loads | Load$ | Stores');
let totalGross = 0, totalCredits = 0, totalLoadAmt = 0;
const STORAGE = new Set(['211']);
for (const rt of Object.keys(routeMap).sort()) {
  const r = routeMap[rt];
  const revenue = r.gross + r.credits;
  console.log(`Rt ${rt.padStart(3)} | ${String(r.invoices).padStart(8)} | $${r.gross.toFixed(2).padStart(10)} | $${r.credits.toFixed(2).padStart(9)} | $${revenue.toFixed(2).padStart(10)} | ${String(r.loads).padStart(5)} | $${r.loadAmt.toFixed(2).padStart(10)} | ${r.stores.size}`);
  if (rt !== '99') {
    totalGross += r.gross;
    totalCredits += r.credits;
    if (!STORAGE.has(rt)) totalLoadAmt += r.loadAmt;
  }
}

const totalRevenue = totalGross + totalCredits;
const trueProfit = totalRevenue - totalLoadAmt;
const trueMargin = totalGross > 0 ? (trueProfit / totalGross * 100) : 0;

console.log('\n=== COMPANY TOTALS (excl Rt 99) ===');
console.log('Gross Sales:', '$' + totalGross.toFixed(2));
console.log('Credits:', '$' + totalCredits.toFixed(2));
console.log('Revenue (Net Sales):', '$' + totalRevenue.toFixed(2));
console.log('Load Total (excl storage):', '$' + totalLoadAmt.toFixed(2));
console.log('True Profit:', '$' + trueProfit.toFixed(2));
console.log('True Margin:', trueMargin.toFixed(1) + '%');

// Route 200 special check (cash route, no promos)
if (routeMap['200']) {
  const r200 = routeMap['200'];
  console.log('\n=== ROUTE 200 CHECK (cash, no promos) ===');
  console.log('Our Revenue:', '$' + (r200.gross + r200.credits).toFixed(2));
  console.log('Jan Gross Sales PDF Net:', '$19,953.45');
  console.log('Coverage:', ((r200.gross + r200.credits) / 19953.45 * 100).toFixed(1) + '%');
}

// Duplicate check
const idCounts = {};
data.filter(r => r.id).forEach(r => { idCounts[r.id] = (idCounts[r.id] || 0) + 1; });
const dupes = Object.values(idCounts).filter(c => c > 1).length;
console.log('\nDuplicate IDs:', dupes);

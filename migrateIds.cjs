#!/usr/bin/env node
/**
 * migrateIds.cjs — One-time migration to replace old store IDs with new standardized IDs.
 * Updates both stores.csv (ID + Store Number columns) and visitHistory.js (keys).
 */

const fs = require('fs');
const path = require('path');

const STORES_CSV = path.join(__dirname, 'src', 'data', 'stores.csv');
const VISIT_HISTORY = path.join(__dirname, 'src', 'data', 'visitHistory.js');

// Confirmed old → new ID mappings from 2/10 and 2/11 feed data
const idMapping = {
  // Old numeric IDs → FLW/RDW/CASH/MTW/SFW
  '84':   { newId: 'FLW00656', storeNum: '00656' },
  '85':   { newId: 'FLW01319', storeNum: '01319' },
  '88':   { newId: 'FLW01184', storeNum: '01184' },
  '89':   { newId: 'FLW02547', storeNum: '02547' },
  '91':   { newId: 'FLW01405', storeNum: '01405' },
  '104':  { newId: 'RDW00040', storeNum: 'RDW00040' },
  '107':  { newId: 'FLW01664', storeNum: '01664' },
  '113':  { newId: 'CASH0343', storeNum: 'CASH0343' },
  '116':  { newId: 'MTW06425', storeNum: 'MTW06425' },
  '118':  { newId: 'FLW02630', storeNum: '02630' },
  '140':  { newId: 'FLW01412', storeNum: '01412' },
  '02342': { newId: 'SFW02342', storeNum: 'SFW02342' },

  // Old DE-prefix Food Lion IDs → FLW
  'DE-875-DE-18':  { newId: 'FLW00875', storeNum: '00875' },
  'DE-1206-DE-22': { newId: 'FLW01206', storeNum: '01206' },
  'DE-1294-DE-25': { newId: 'FLW01294', storeNum: '01294' },
  'DE-1385-DE-29': { newId: 'FLW01385', storeNum: '01385' },
  'DE-1419-DE-30': { newId: 'FLW01419', storeNum: '01419' },
  'DE-2561':       { newId: 'FLW02561', storeNum: '02561' },
  'DE-800-DE-16':  { newId: 'FLW00800', storeNum: '00800' },
  'DE-879-DE-17':  { newId: 'FLW00879', storeNum: '00879' },
  'DE-1153-DE-19': { newId: 'FLW01153', storeNum: '01153' },
  'DE-1211-DE-23': { newId: 'FLW01211', storeNum: '01211' },
  'DE-1458-DE-61': { newId: 'FLW01458', storeNum: '01458' },
  'DE-1560-DE-32': { newId: 'FLW01560', storeNum: '01560' },
  'DE-2224-DE-35': { newId: 'FLW02224', storeNum: '02224' },
  'DE-2688-DE-42': { newId: 'FLW02688', storeNum: '02688' },

  // Old DE-CASH/DE-DE prefix IDs → RDW/AMW
  'DE-DE-58':      { newId: 'RDW00058', storeNum: 'RDW00058' },
  'DE-CASH-DE-13': { newId: 'RDW00013', storeNum: 'RDW00013' },
  'DE-CASH-DE-15': { newId: 'RDW00057', storeNum: 'RDW00057' },
  'DE-CASH-DE-16': { newId: 'RDW00044', storeNum: 'RDW00044' },
  'DE-DE-896':     { newId: 'AMW00896', storeNum: 'AMW00896' },
};

// ── Parse CSV line (handles quoted fields) ──────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

// ── Update stores.csv ───────────────────────────────────────────────────────
console.log('=== Updating stores.csv ===\n');

const csvText = fs.readFileSync(STORES_CSV, 'utf8');
const csvLines = csvText.trim().split('\n');
const header = csvLines[0];
const dataLines = csvLines.slice(1);

let csvUpdates = 0;
const updatedDataLines = dataLines.map(line => {
  const fields = parseCSVLine(line);
  const oldId = fields[0];

  if (idMapping[oldId]) {
    const { newId, storeNum } = idMapping[oldId];
    fields[0] = newId;       // Update ID column
    fields[1] = storeNum;    // Update Store Number column
    console.log(`  CSV: ${oldId} → ${newId} (${fields[2]})`);
    csvUpdates++;
    return fields.join(',');
  }
  return line;
});

const finalCsv = [header, ...updatedDataLines].join('\n') + '\n';
fs.writeFileSync(STORES_CSV, finalCsv);
console.log(`\nUpdated ${csvUpdates} store IDs in stores.csv\n`);

// ── Update visitHistory.js ──────────────────────────────────────────────────
console.log('=== Updating visitHistory.js ===\n');

const vhText = fs.readFileSync(VISIT_HISTORY, 'utf8');

// Parse existing visit history
const history = {};
const regex = /'([^']+)':\s*\[([^\]]*)\]/g;
let m;
while ((m = regex.exec(vhText)) !== null) {
  history[m[1]] = m[2].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
}

// Apply ID migrations (merge dates if new ID already has entries)
let vhUpdates = 0;
const merged = [];

Object.keys(idMapping).forEach(oldId => {
  if (history[oldId]) {
    const { newId } = idMapping[oldId];
    const oldDates = history[oldId];
    const existingDates = history[newId] || [];
    const allDates = [...new Set([...existingDates, ...oldDates])].sort();

    history[newId] = allDates;
    delete history[oldId];

    if (existingDates.length > 0) {
      merged.push(`  VH: ${oldId} → ${newId} (merged: ${allDates.join(', ')})`);
    } else {
      console.log(`  VH: ${oldId} → ${newId} (${allDates.join(', ')})`);
    }
    vhUpdates++;
  }
});

// Also handle the orphaned '134' entry (old Food Lion 1442 duplicate) → merge into FLW01442
if (history['134']) {
  const oldDates = history['134'];
  const existing = history['FLW01442'] || [];
  history['FLW01442'] = [...new Set([...existing, ...oldDates])].sort();
  delete history['134'];
  merged.push(`  VH: 134 → FLW01442 (merged: ${history['FLW01442'].join(', ')})`);
  vhUpdates++;
}

if (merged.length > 0) {
  console.log('\nMerged entries (new ID already had dates):');
  merged.forEach(m => console.log(m));
}

// Write updated visit history
const entries = Object.entries(history).sort(([a], [b]) => a.localeCompare(b));
const lines = [
  '// Visit history data - maps store ID to array of visit dates (YYYY-MM-DD)',
  '// Updated when new visit data is processed',
  'const visitHistory = {',
];
entries.forEach(([id, dates]) => {
  const sorted = [...new Set(dates)].sort();
  lines.push(`  '${id}': [${sorted.map(d => `'${d}'`).join(', ')}],`);
});
lines.push('};', '', 'export default visitHistory;', '');
fs.writeFileSync(VISIT_HISTORY, lines.join('\n'));

console.log(`\nUpdated ${vhUpdates} store IDs in visitHistory.js`);
console.log('\nDone!');

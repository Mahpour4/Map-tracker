const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// MIGRATION MAP
// ═══════════════════════════════════════════════════════════════

// Group 1: Old IDs that HAVE a new-format duplicate → remove old, keep new, merge visits
const REMOVE_OLD = {
  '126':  'FLW01423',
  '129':  'FLW00950',
  '131':  'FLW02193',
  '133':  'FLW01238',
  '135':  'FLW01162',
  '138':  'FLW01465',
  '105':  'FLW01413',
  '96':   'FLW02560',
  '97':   'FLW02559',
  '1216': 'FLW01216',
  '40':   'WGW00040',
  '67':   'WGW00056',
  '02692': 'SFW02692',
  'Wal-2': 'WAW01736',
  'CASH-DE-5': 'IND20001',
  '136':  '54',  // Both old-format; 136 is dup of 54 (same Wegmans Frederick). 54 gets renamed below.
};

// Group 2: Old IDs that need renaming (no duplicate exists)
const RENAME = {
  // Food Lion — store number from col 2
  '103':  { newId: 'FLW01547', storeNum: 'FLW01547', name: 'Food Lion 1547' },
  '117':  { newId: 'FLW01363', storeNum: 'FLW01363', name: 'Food Lion 1363' },
  '130':  { newId: 'FLW02587', storeNum: 'FLW02587', name: 'Food Lion 2587' },
  '139':  { newId: 'FLW02611', storeNum: 'FLW02611', name: 'Food Lion 2611' },
  '94':   { newId: 'FLW01653', storeNum: 'FLW01653', name: 'Food Lion 1653' },

  // Wegmans
  '07':   { newId: 'WGW00007', storeNum: 'WGW00007', name: 'Wegmans 07' },
  '14':   { newId: 'WGW00014', storeNum: 'WGW00014', name: 'Wegmans 14' },
  '42':   { newId: 'WGW00042', storeNum: 'WGW00042', name: 'Wegmans 42' },
  '44':   { newId: 'WGW00044', storeNum: 'WGW00044', name: 'Wegmans 44' },
  '47':   { newId: 'WGW00047', storeNum: 'WGW00047', name: 'Wegmans 47' },
  '54':   { newId: 'WGW00054', storeNum: 'WGW00054', name: 'Wegmans 54' },
  '90':   { newId: 'WGW00041', storeNum: 'WGW00041', name: 'Wegmans 41' },
  '102':  { newId: 'WGW00053', storeNum: 'WGW00053', name: 'Wegmans 53' },

  // Shoppers
  '02353': { newId: 'SFW02353', storeNum: 'SFW02353', name: 'Shoppers 2353' },
  '02379': { newId: 'SFW02379', storeNum: 'SFW02379', name: 'Shoppers 2379' },
  '02650': { newId: 'SFW02650', storeNum: 'SFW02650', name: 'Shoppers 2650' },
  '07540': { newId: 'SFW07540', storeNum: 'SFW07540', name: 'Shoppers 7540' },
  '93':    { newId: 'SFW07533', storeNum: 'SFW07533', name: 'Shoppers 7533' },
  '110':   { newId: 'SFW07568', storeNum: 'SFW07568', name: 'Shoppers 7568' },
  '111':   { newId: 'SFW07573', storeNum: 'SFW07573', name: 'Shoppers 7573' },
  '68':    { newId: 'SFW00068', storeNum: 'SFW00068', name: 'Shoppers Germantown' },
  '79':    { newId: 'SFW00079', storeNum: 'SFW00079', name: 'Shoppers Forestville' },
  '80':    { newId: 'SFW00080', storeNum: 'SFW00080', name: 'Shoppers Capitol Heights' },
  '64':    { newId: 'SFW07573M', storeNum: 'SFW07573M', name: 'Shoppers Fort Meade' },

  // ShopRite
  '106':  { newId: 'SRW00542', storeNum: 'SRW00542', name: 'ShopRite 542' },
  '119':  { newId: 'SRW00548', storeNum: 'SRW00548', name: 'ShopRite 548' },
  '120':  { newId: 'SRW00551', storeNum: 'SRW00551', name: 'ShopRite 551' },
  '121':  { newId: 'SRW00549', storeNum: 'SRW00549', name: 'ShopRite 549' },
  '122':  { newId: 'SRW00547', storeNum: 'SRW00547', name: 'ShopRite 547' },
  '123':  { newId: 'SRW00545', storeNum: 'SRW00545', name: 'ShopRite 545' },
  '124':  { newId: 'SRW00555', storeNum: 'SRW00555', name: 'ShopRite 555' },
  '563':  { newId: 'SRW00563', storeNum: 'SRW00563', name: 'ShopRite 563' },

  // Weis / Redners
  '66':   { newId: 'WMW00287', storeNum: 'WMW00287', name: 'Weis 287' },
  '95':   { newId: 'RDW00096', storeNum: 'RDW00096', name: 'Redners 96' },
  'Redner-54': { newId: 'RDW00054', storeNum: 'RDW00054', name: 'Redners 54' },

  // Walmart
  '108':  { newId: 'WAW00108', storeNum: 'WAW00108', name: 'Walmart Cockeysville' },
  '137':  { newId: 'WAW02551', storeNum: 'WAW02551', name: 'Walmart 2551' },
  '98':   { newId: 'WAW00098', storeNum: 'WAW00098', name: 'Walmart Glen Burnie' },

  // Giant/Martins
  '132':  { newId: 'GTW00132', storeNum: 'GTW00132', name: 'Giant 132' },

  // Geresbecks
  '101':  { newId: 'GBW00001', storeNum: 'GBW00001', name: 'Geresbecks G-1' },
  '92':   { newId: 'GBW00002', storeNum: 'GBW00002', name: 'Geresbecks Baltimore' },
  'g-3':  { newId: 'GBW00003', storeNum: 'GBW00003', name: 'Geresbecks Pasadena' },

  // Military
  '61':   { newId: 'CMW05167', storeNum: 'CMW05167', name: 'HQCNEL Annapolis' },

  // Independent / Cash
  '112':  { newId: 'IND00201', storeNum: 'IND00201', name: 'Lucky 7 EZ Mart' },
  '114':  { newId: 'IND00202', storeNum: 'IND00202', name: 'Almonte Market' },
  '115':  { newId: 'IND00203', storeNum: 'IND00203', name: 'H&P' },
  'NB-01': { newId: 'IND00204', storeNum: 'IND00204', name: 'Nothing Better LLC' },
  'cash-de-101': { newId: 'IND00205', storeNum: 'IND00205', name: 'Nothing Better LLC Cash' },
  'S121': { newId: 'MISC0121', storeNum: 'MISC0121', name: 'Salisbury Storage' },
};

// ═══════════════════════════════════════════════════════════════
// STEP 1: Migrate stores.csv
// ═══════════════════════════════════════════════════════════════
const csvPath = path.join(__dirname, 'src', 'data', 'stores.csv');
const csvRaw = fs.readFileSync(csvPath, 'utf-8');
const lines = csvRaw.split('\n');
const header = lines[0];
const outputLines = [header];

let removed = 0;
let renamed = 0;
const removedIds = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = line.split(',');
  const id = cols[0];

  // Check if this old ID should be removed (has new-format duplicate)
  if (REMOVE_OLD[id] !== undefined) {
    removed++;
    removedIds.push(id);
    console.log(`  Removed: ${id} (duplicate of ${REMOVE_OLD[id]})`);
    continue;
  }

  // Check if this old ID should be renamed
  if (RENAME[id]) {
    const map = RENAME[id];
    cols[0] = map.newId;
    cols[1] = map.storeNum;
    cols[2] = map.name;
    renamed++;
    console.log(`  Renamed: ${id} → ${map.newId} (${map.name})`);
    outputLines.push(cols.join(','));
    continue;
  }

  // Keep as-is
  outputLines.push(line);
}

// Also update region data for new-format entries that had "Unassigned"
// The old entries often had proper region data, so let's copy it to new entries
// Build a map of old entry regions
const oldRegionData = {};
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = line.split(',');
  const id = cols[0];
  if (REMOVE_OLD[id] !== undefined) {
    const newId = REMOVE_OLD[id];
    if (cols[9] && cols[9] !== 'Unassigned') {
      oldRegionData[newId] = { region: cols[9], territory: cols[10], subTerritory: cols[11] };
    }
  }
}

// Apply region data to new-format entries that are Unassigned
const finalLines = [outputLines[0]];
for (let i = 1; i < outputLines.length; i++) {
  const cols = outputLines[i].split(',');
  const id = cols[0];
  if (oldRegionData[id] && (!cols[9] || cols[9] === 'Unassigned')) {
    cols[9] = oldRegionData[id].region;
    cols[10] = oldRegionData[id].territory;
    cols[11] = oldRegionData[id].subTerritory;
    console.log(`  Region fix: ${id} → ${cols[9]}`);
  }
  finalLines.push(cols.join(','));
}

fs.writeFileSync(csvPath, finalLines.join('\n') + '\n');
console.log(`\nStores.csv: ${removed} removed, ${renamed} renamed, ${finalLines.length - 1} total stores`);

// ═══════════════════════════════════════════════════════════════
// STEP 2: Migrate visitHistory.js
// ═══════════════════════════════════════════════════════════════
const vhPath = path.join(__dirname, 'src', 'data', 'visitHistory.js');
const vhRaw = fs.readFileSync(vhPath, 'utf-8');

// Parse all entries
const entries = {};
const entryRegex = /'([^']+)':\s*\[([^\]]*)\]/g;
let match;
const vhBody = vhRaw.match(/const visitHistory = \{([\s\S]*?)\};/);
if (!vhBody) { console.error('Cannot parse visitHistory.js'); process.exit(1); }

while ((match = entryRegex.exec(vhBody[1])) !== null) {
  const id = match[1];
  const dates = match[2].split(',').map(d => d.trim().replace(/'/g, '')).filter(Boolean);
  entries[id] = dates;
}

let vhRemoved = 0;
let vhRenamed = 0;
let vhMerged = 0;

// Process removals (merge old dates into new entry)
for (const [oldId, newId] of Object.entries(REMOVE_OLD)) {
  if (!entries[oldId]) continue;
  const oldDates = entries[oldId];
  if (entries[newId]) {
    const merged = [...new Set([...entries[newId], ...oldDates])].sort();
    entries[newId] = merged;
    vhMerged++;
    console.log(`  VH merged: ${oldId} → ${newId} (${merged.length} dates)`);
  } else {
    entries[newId] = oldDates;
    console.log(`  VH moved: ${oldId} → ${newId}`);
  }
  delete entries[oldId];
  vhRemoved++;
}

// Process renames
for (const [oldId, map] of Object.entries(RENAME)) {
  if (!entries[oldId]) continue;
  const oldDates = entries[oldId];
  if (entries[map.newId]) {
    const merged = [...new Set([...entries[map.newId], ...oldDates])].sort();
    entries[map.newId] = merged;
    console.log(`  VH merged: ${oldId} → ${map.newId} (${merged.length} dates)`);
  } else {
    entries[map.newId] = oldDates;
    console.log(`  VH renamed: ${oldId} → ${map.newId}`);
  }
  delete entries[oldId];
  vhRenamed++;
}

// Write back
const sortedKeys = Object.keys(entries).sort();
let vhOutput = `// Visit history data - maps store ID to array of visit dates (YYYY-MM-DD)\n`;
vhOutput += `// Updated when new visit data is processed\n`;
vhOutput += `const visitHistory = {\n`;
for (const key of sortedKeys) {
  const dates = entries[key].map(d => `'${d}'`).join(', ');
  vhOutput += `  '${key}': [${dates}],\n`;
}
vhOutput += `};\n\nexport default visitHistory;\n`;

fs.writeFileSync(vhPath, vhOutput);
console.log(`\nVisitHistory: ${vhRemoved} removed/merged, ${vhRenamed} renamed, ${sortedKeys.length} total entries`);
console.log('\nMigration complete!');

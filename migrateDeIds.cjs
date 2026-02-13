const fs = require('fs');
const path = require('path');

// === Migration Map: oldId → { newId, routeOverride (optional) } ===
const MIGRATION_MAP = {
  // Food Lion (12)
  'DE-246-DE-11':  { newId: 'FLW00246', storeNum: 'FLW00246', name: 'Food Lion 246', route: '206' },
  'DE-397-DE-12':  { newId: 'FLW00397', storeNum: 'FLW00397', name: 'Food Lion 397', route: '206' },
  'DE-658-DE-14':  { newId: 'FLW00658', storeNum: 'FLW00658', name: 'Food Lion 658', route: '206' },
  'DE-698-DE-15':  { newId: 'FLW00698', storeNum: 'FLW00698', name: 'Food Lion 698' },
  'DE-1158-DE-20': { newId: 'FLW01158', storeNum: 'FLW01158', name: 'Food Lion 1158' },
  'DE-1268-DE-24': { newId: 'FLW01268', storeNum: 'FLW01268', name: 'Food Lion 1268' },
  'DE-1297-DE-26': { newId: 'FLW01297', storeNum: 'FLW01297', name: 'Food Lion 1297' },
  'DE-1313-DE-27': { newId: 'FLW01313', storeNum: 'FLW01313', name: 'Food Lion 1313' },
  'DE-2117-DE-33': { newId: 'FLW02117', storeNum: 'FLW02117', name: 'Food Lion 2117' },
  'DE-2123-DE-34': { newId: 'FLW02123', storeNum: 'FLW02123', name: 'Food Lion 2123' },
  'DE-2521-DE-38': { newId: 'FLW02521', storeNum: 'FLW02521', name: 'Food Lion 2521' },
  'DE-2614-DE-41': { newId: 'FLW02614', storeNum: 'FLW02614', name: 'Food Lion 2614', route: '206' },

  // DE-DE- stores (10) — brand prefix
  'DE-DE-18':   { newId: 'RDW00018', storeNum: 'RDW00018', name: 'Redners 18' },
  'DE-DE-2522': { newId: 'FLW02522', storeNum: 'FLW02522', name: 'Food Lion 2522' },
  'DE-DE-272':  { newId: 'WMW00272', storeNum: 'WMW00272', name: 'Weis Market 272' },
  'DE-DE-2836': { newId: 'AMW02836', storeNum: 'AMW02836', name: 'Acme 2836' },
  'DE-DE-293':  { newId: 'AMW00293', storeNum: 'AMW00293', name: 'Acme 293' },
  'DE-DE-3816': { newId: 'AMW03816', storeNum: 'AMW03816', name: 'Acme 3816' },
  'DE-DE-3841': { newId: 'AMW03841', storeNum: 'AMW03841', name: 'Acme 3841' },
  'DE-DE-49':   { newId: 'RDW00049', storeNum: 'RDW00049', name: 'Redners 49' },
  'DE-DE-820':  { newId: 'AMW00820', storeNum: 'AMW00820', name: 'Acme 820' },
  'DE-DE-821':  { newId: 'AMW00821', storeNum: 'AMW00821', name: 'Acme 821' },

  // DE-CASH- stores (11) — brand or IND prefix
  'DE-CASH-DE-1':  { newId: 'IND00101', storeNum: 'IND00101', name: '21st Street' },
  'DE-CASH-DE-2':  { newId: 'AMW02679', storeNum: 'AMW02679', name: 'Acme 2679' },
  'DE-CASH-DE-3':  { newId: 'IND00102', storeNum: 'IND00102', name: 'Exxon' },
  'DE-CASH-DE-6':  { newId: 'IND20000', storeNum: 'IND20000', name: "G&E Hocker's", route: '206' },
  'DE-CASH-DE-8':  { newId: 'IND00103', storeNum: 'IND00103', name: 'Linkwood Market' },
  'DE-CASH-DE-9':  { newId: 'IND00104', storeNum: 'IND00104', name: 'Montego Bay Supermarket' },
  'DE-CASH-DE-10': { newId: 'IND00105', storeNum: 'IND00105', name: 'OC Convenience' },
  'DE-CASH-DE-11': { newId: 'IND00106', storeNum: 'IND00106', name: 'OC Dollar Plus' },
  'DE-CASH-DE-12': { newId: 'IND00107', storeNum: 'IND00107', name: 'Ocean Exxon' },
  'DE-CASH-DE-14': { newId: 'RDW00056', storeNum: 'RDW00056', name: 'Redners 56' },
  'DE-CASH-DE-17': { newId: 'IND00108', storeNum: 'IND00108', name: 'Seaside Deli' },
};

// Build set of new IDs for duplicate detection
const newIdSet = new Set(Object.values(MIGRATION_MAP).map(m => m.newId));

// ============================================================
// STEP 1: Migrate stores.csv
// ============================================================
const csvPath = path.join(__dirname, 'src', 'data', 'stores.csv');
const csvRaw = fs.readFileSync(csvPath, 'utf-8');
const lines = csvRaw.split('\n');
const header = lines[0];

let migrated = 0;
let duplicatesRemoved = 0;
let routeChanges = 0;
const outputLines = [header];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = line.split(',');
  const id = cols[0];

  // Check if this is a DE- format row that needs migration
  if (MIGRATION_MAP[id]) {
    const map = MIGRATION_MAP[id];
    cols[0] = map.newId;          // ID
    cols[1] = map.storeNum;       // Store Number
    cols[2] = map.name;           // Store Name
    if (map.route) {
      cols[7] = map.route;        // Route Number
      cols[8] = `Route ${map.route} Driver`; // Driver
      routeChanges++;
    }
    outputLines.push(cols.join(','));
    migrated++;
    console.log(`  Migrated: ${id} → ${map.newId}${map.route ? ` (route → ${map.route})` : ''}`);
    continue;
  }

  // Check if this is a duplicate new-format entry (from Data Import, has empty lat/lng)
  if (newIdSet.has(id)) {
    const lat = cols[12] ? cols[12].trim() : '';
    const lng = cols[13] ? cols[13].trim() : '';
    if (!lat && !lng) {
      // This is a duplicate with no coordinates — remove it
      duplicatesRemoved++;
      console.log(`  Removed duplicate: ${id} (empty coords)`);
      continue;
    }
  }

  // Keep the row as-is
  outputLines.push(line);
}

fs.writeFileSync(csvPath, outputLines.join('\n') + '\n');
console.log(`\nStores.csv migration complete:`);
console.log(`  ${migrated} IDs migrated`);
console.log(`  ${duplicatesRemoved} duplicates removed`);
console.log(`  ${routeChanges} route changes applied`);
console.log(`  Total stores: ${outputLines.length - 1}`);

// ============================================================
// STEP 2: Migrate visitHistory.js
// ============================================================
const vhPath = path.join(__dirname, 'src', 'data', 'visitHistory.js');
const vhRaw = fs.readFileSync(vhPath, 'utf-8');

// Parse the visit history object
const vhMatch = vhRaw.match(/const visitHistory = \{([\s\S]*?)\};/);
if (!vhMatch) {
  console.error('Could not parse visitHistory.js');
  process.exit(1);
}

// Extract all entries
const entries = {};
const entryRegex = /'([^']+)':\s*\[([^\]]*)\]/g;
let match;
while ((match = entryRegex.exec(vhMatch[1])) !== null) {
  const storeId = match[1];
  const dates = match[2].split(',').map(d => d.trim().replace(/'/g, '')).filter(Boolean);
  entries[storeId] = dates;
}

console.log(`\nVisit history: ${Object.keys(entries).length} total entries`);

// Migrate DE- entries
let vhMigrated = 0;
let vhMerged = 0;
const oldIds = Object.keys(MIGRATION_MAP);

for (const oldId of oldIds) {
  if (!entries[oldId]) continue; // No visit history for this old ID

  const newId = MIGRATION_MAP[oldId].newId;
  const oldDates = entries[oldId];

  if (entries[newId]) {
    // Merge: combine dates from old and new, deduplicate, sort
    const merged = [...new Set([...entries[newId], ...oldDates])].sort();
    entries[newId] = merged;
    vhMerged++;
    console.log(`  Merged: ${oldId} → ${newId} (${oldDates.length} + ${entries[newId].length - oldDates.length} dates → ${merged.length} unique)`);
  } else {
    // Simple rename
    entries[newId] = oldDates;
    console.log(`  Renamed: ${oldId} → ${newId} (${oldDates.length} dates)`);
  }

  delete entries[oldId];
  vhMigrated++;
}

// Rebuild visitHistory.js sorted by key
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
console.log(`\nVisit history migration complete:`);
console.log(`  ${vhMigrated} entries migrated (${vhMerged} merged)`);
console.log(`  ${sortedKeys.length} total entries`);

console.log('\n✓ Migration complete!');

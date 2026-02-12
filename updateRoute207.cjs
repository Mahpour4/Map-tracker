const fs = require('fs');

// Route 207 feed data
const feed = [
  { newId: 'FLW02547', lastSale: '02/10/2026' },
  { newId: 'FLW02566', lastSale: '02/05/2026' },
  { newId: 'MISC0207', lastSale: '' },
  { newId: 'SFW02342', lastSale: '02/10/2026' },
  { newId: 'SFW02377', lastSale: '02/12/2026' },
  { newId: 'SFW02383', lastSale: '05/02/2025' },
  { newId: 'SFW02618', lastSale: '09/30/2025' },
  { newId: 'WAW01985', lastSale: '04/22/2025' },
  { newId: 'WAW03490', lastSale: '01/16/2026' },
  { newId: 'WAW05129', lastSale: '' },
  { newId: 'WGW00040', lastSale: '09/16/2025' },
  { newId: 'WGW00056', lastSale: '12/06/2025' },
  { newId: 'WMW00276', lastSale: '02/12/2026' },
  { newId: 'WMW00278', lastSale: '11/13/2025' },
  { newId: 'CASH0543', lastSale: '11/12/2025' },
  { newId: 'CMW00001', lastSale: '01/05/2026' },
  { newId: 'CMW05119', lastSale: '02/10/2026' },
  { newId: 'CMW05222', lastSale: '01/20/2026' },
  { newId: 'CMW05241', lastSale: '02/12/2026' },
  { newId: 'CMW5024', lastSale: '' },
  { newId: 'FLW00656', lastSale: '02/11/2026' },
  { newId: 'FLW01184', lastSale: '02/10/2026' },
  { newId: 'FLW01316', lastSale: '02/12/2026' },
  { newId: 'FLW01319', lastSale: '02/11/2026' },
  { newId: 'FLW01414', lastSale: '02/09/2026' },
  { newId: 'FLW01474', lastSale: '02/09/2026' },
  { newId: 'FLW01662', lastSale: '02/05/2026' },
  { newId: 'FLW02501', lastSale: '02/05/2026' },
  { newId: 'FLW02517', lastSale: '01/30/2026' },
];

// Map old IDs → new IDs (for stores that have old-format IDs in stores.csv)
const idMigrations = {
  '74': 'FLW02566',      // Food Lion 2566
  '02377': 'SFW02377',   // Shoppers 2377
  '02383': 'SFW02383',   // Shoppers 2383
  '71': 'WGW00040',      // Wegmans 40
  '73': 'WMW00276',      // Weis 276
  '87': 'WMW00278',      // Weis Market 278
  '86': 'FLW01316',      // Food Lion 1316
  '75': 'FLW01662',      // Food Lion 1662
  '65': 'FLW02501',      // Food Lion 2501
  '62': 'FLW02517',      // Food Lion 2517
};

// Store number mapping for ID migrations (for updating Store Number column)
const storeNumbers = {
  'FLW02566': '02566',
  'SFW02377': '02377',
  'SFW02383': '02383',
  'WGW00040': '00040',
  'WMW00276': '00276',
  'WMW00278': '00278',
  'FLW01316': '01316',
  'FLW01662': '01662',
  'FLW02501': '02501',
  'FLW02517': '02517',
};

function parseLastSale(dateStr) {
  if (!dateStr) return '';
  const [m, d, y] = dateStr.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ---- Process stores.csv ----
const csvPath = 'src/data/stores.csv';
const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
const header = lines[0];

let updated = 0;
let idUpdated = 0;
let dateUpdated = 0;
const newStoreIds = [];

// Build a lookup: newId → feed entry
const feedMap = {};
feed.forEach(f => { feedMap[f.newId] = f; });

// Build a lookup: oldId → newId
const oldToNew = {};
Object.entries(idMigrations).forEach(([oldId, newId]) => { oldToNew[oldId] = newId; });

// Track which feed IDs we found
const foundIds = new Set();

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cols = lines[i].split(',');
  const currentId = cols[0];

  // Check if this store needs ID migration
  if (oldToNew[currentId]) {
    const newId = oldToNew[currentId];
    const oldId = currentId;
    console.log(`ID migration: ${oldId} → ${newId}`);
    cols[0] = newId;
    cols[1] = storeNumbers[newId] || cols[1];
    idUpdated++;
    foundIds.add(newId);

    // Also update last sale if available
    const feedEntry = feedMap[newId];
    if (feedEntry && feedEntry.lastSale) {
      const ymd = parseLastSale(feedEntry.lastSale);
      cols[cols.length - 1] = ymd;
      dateUpdated++;
    }
    lines[i] = cols.join(',');
    continue;
  }

  // Check if this store is in the feed (already has correct ID)
  if (feedMap[currentId]) {
    foundIds.add(currentId);
    const feedEntry = feedMap[currentId];
    if (feedEntry.lastSale) {
      const ymd = parseLastSale(feedEntry.lastSale);
      const currentLast = cols[cols.length - 1].trim();
      const currentYmd = currentLast ? currentLast.split('T')[0].split(' ')[0] : '';
      if (ymd !== currentYmd) {
        cols[cols.length - 1] = ymd;
        lines[i] = cols.join(',');
        dateUpdated++;
        console.log(`Date update: ${currentId} ${currentYmd || '(none)'} → ${ymd}`);
      }
    }
  }
}

// Check for feed stores not found in CSV (truly new)
feed.forEach(f => {
  if (!foundIds.has(f.newId)) {
    newStoreIds.push(f.newId);
  }
});

fs.writeFileSync(csvPath, lines.join('\n'));

console.log(`\n--- stores.csv summary ---`);
console.log(`ID migrations: ${idUpdated}`);
console.log(`Date updates: ${dateUpdated}`);
console.log(`New stores not in CSV: ${newStoreIds.join(', ') || 'none'}`);

// ---- Process visitHistory.js ----
const vhPath = 'src/data/visitHistory.js';
let vhContent = fs.readFileSync(vhPath, 'utf8');

// Extract the object
const startMatch = vhContent.indexOf('{');
const endMatch = vhContent.lastIndexOf('}');
const objStr = vhContent.substring(startMatch, endMatch + 1);

// Parse existing entries
const entries = {};
const entryRegex = /'([^']+)'\s*:\s*\[([^\]]*)\]/g;
let match;
while ((match = entryRegex.exec(objStr)) !== null) {
  const id = match[1];
  const dates = match[2] ? match[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
  entries[id] = dates;
}

// Migrate old IDs in visit history
Object.entries(idMigrations).forEach(([oldId, newId]) => {
  if (entries[oldId]) {
    const oldDates = entries[oldId];
    if (!entries[newId]) entries[newId] = [];
    oldDates.forEach(d => {
      if (!entries[newId].includes(d)) entries[newId].push(d);
    });
    entries[newId].sort();
    delete entries[oldId];
    console.log(`Visit history migrated: ${oldId} → ${newId} (${oldDates.length} dates)`);
  }
});

// Add new visit dates from feed
let vhUpdated = 0;
feed.forEach(f => {
  if (!f.lastSale) return;
  const ymd = parseLastSale(f.lastSale);
  if (!ymd) return;
  if (!entries[f.newId]) entries[f.newId] = [];
  if (!entries[f.newId].includes(ymd)) {
    entries[f.newId].push(ymd);
    entries[f.newId].sort();
    vhUpdated++;
    console.log(`Visit history add: ${f.newId} += ${ymd}`);
  }
});

// Rebuild visitHistory.js
const sortedIds = Object.keys(entries).sort();
let newVh = `// Visit history data - maps store ID to array of visit dates (YYYY-MM-DD)
// Updated when new visit data is processed
const visitHistory = {\n`;
sortedIds.forEach((id, i) => {
  const dates = entries[id].map(d => `'${d}'`).join(', ');
  newVh += `  '${id}': [${dates}]${i < sortedIds.length - 1 ? ',' : ''}\n`;
});
newVh += `};\n\nexport default visitHistory;\n`;

fs.writeFileSync(vhPath, newVh);
console.log(`\nVisit history entries updated: ${vhUpdated}`);
console.log('Done!');

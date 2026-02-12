const fs = require('fs');
const path = require('path');

// Route 208 feed data
const feed = [
  { id: 'CASH0002', name: '24/7 Supermart', addr: '329 S Marlyn Ave', city: 'Essex', state: 'MD', zip: '21221', lastSale: '09/18/2025', active: true },
  { id: 'CASH0004', name: '5th St Food Market', addr: '439 E Patapsco Ave', city: 'Baltimore', state: 'MD', zip: '21225', lastSale: '08/22/2024', active: true },
  { id: 'CASH0006', name: '7 Mart', addr: '1417 E Fayette St', city: 'Baltimore', state: 'MD', zip: '21231', lastSale: '08/05/2025', active: true },
  { id: 'CASH0012', name: 'A&E Corner Store', addr: '2221 E Baltimore St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '09/08/2025', active: true },
  { id: 'CASH0039', name: 'Big Apple', addr: '3133 W North Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '02/06/2026', active: true },
  { id: 'CASH0055', name: 'Brooklyn Mini Mart', addr: '4109 Frederik Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '10/16/2024', active: true },
  { id: 'CASH0056', name: "Brother's Mart", addr: '3806 S Hanover St', city: 'Baltimore', state: 'MD', zip: '21225', lastSale: '07/14/2025', active: true },
  { id: 'CASH0058', name: "Cabrera's Deli", addr: '2649 Chesterfield Ave', city: 'Baltimore', state: 'MD', zip: '21213', lastSale: '09/01/2025', active: true },
  { id: 'CASH0068', name: 'Cha Cha Food Mart', addr: '1601 North Wolfe St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '10/16/2024', active: true },
  { id: 'CASH0077', name: 'Crispy Crunchy', addr: '400 S Broadway', city: 'Baltimore', state: 'MD', zip: '', lastSale: '08/05/2025', active: true },
  { id: 'CASH0083', name: 'Customer First Mini Mart', addr: '2900 East Monument St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '07/08/2025', active: true },
  { id: 'CASH0100', name: 'E. Monument 3001', addr: '3001 E Monument St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '08/25/2025', active: true },
  { id: 'CASH0113', name: 'Express Grocery', addr: '2029 E North Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '08/14/2025', active: true },
  { id: 'CASH0115', name: 'Express Supermarket', addr: '630 Poplar Rd', city: 'Baltimore', state: 'MD', zip: '21216', lastSale: '11/13/2025', active: true },
  { id: 'CASH0148', name: 'Fine Fair Food Mart', addr: '501 West Lexinton St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '05/27/2025', active: true },
  { id: 'CASH0157', name: 'Food Ways Market', addr: '6929 Holabird Ave', city: 'Dundalk', state: 'MD', zip: '21222', lastSale: '10/09/2024', active: true },
  { id: 'CASH0158', name: 'Food Xpress', addr: '2901 Hartford', city: 'Baltimore', state: 'MD', zip: '', lastSale: '08/29/2025', active: true },
  { id: 'CASH0159', name: 'Four Brothers', addr: '3123 Elmora Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '06/25/2025', active: true },
  { id: 'CASH0169', name: 'Garrison Deli', addr: '', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/13/2024', active: false },
  { id: 'CASH0178', name: 'Green Mart 33', addr: '3308 Greenmount', city: 'Baltimore', state: 'MD', zip: '', lastSale: '07/11/2025', active: true },
  { id: 'CASH0185', name: 'Grocery Dollar Mart', addr: '3215 Greenmount Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '07/11/2025', active: true },
  { id: 'CASH0192', name: 'Hanover Market', addr: '3570 Hanover St', city: 'Baltimore', state: 'MD', zip: '21225', lastSale: '02/02/2026', active: true },
  { id: 'CASH0194', name: 'Harbor Carry Out', addr: '413 E Baltimore St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '06/12/2025', active: true },
  { id: 'CASH0199', name: 'Hi-Mart', addr: '1051 Greenmount Ave', city: 'Baltimore', state: 'MD', zip: '21202', lastSale: '09/22/2025', active: true },
  { id: 'CASH0201', name: 'India Grocery Store', addr: '2900 Huntington Ave', city: 'Baltimore', state: 'MD', zip: '21211', lastSale: '05/16/2025', active: true },
  { id: 'CASH0205', name: 'Jamilys Market', addr: '300 S Calhoun St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/25/2025', active: true },
  { id: 'CASH0208', name: "Jimmy's Snacks", addr: '1328 W Lanvale St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/06/2025', active: true },
  { id: 'CASH0213', name: 'Jr Food Market Westwood', addr: '1938 Westwood', city: 'Baltimore', state: 'MD', zip: '', lastSale: '02/10/2025', active: true },
  { id: 'CASH0214', name: 'Jr Grocery Store Greenmou', addr: '2603 Greenmount Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/06/2024', active: true },
  { id: 'CASH0226', name: 'L & S Food Market', addr: '4601 Garrison Blvd', city: 'Baltimore', state: 'MD', zip: '21215', lastSale: '08/06/2024', active: true },
  { id: 'CASH0254', name: 'Marathon Mulberry', addr: '427 W Mulberry St', city: 'Baltimore', state: 'MD', zip: '21201', lastSale: '02/05/2026', active: true },
  { id: 'CASH0269', name: 'Milton Grocery', addr: '540 N Milton Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/14/2024', active: true },
  { id: 'CASH0275', name: 'Mo Grocery Store', addr: '700 N Kenwood', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/22/2025', active: true },
  { id: 'CASH0277', name: 'Moe Grocery Store', addr: '5460 Park Heights Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '10/30/2025', active: true },
  { id: 'CASH0280', name: 'Montfort Grocery Stores', addr: '847 N Montfortd Ave', city: 'Baltimore', state: 'MD', zip: '21205', lastSale: '11/13/2025', active: true },
  { id: 'CASH0282', name: 'Garrison Grocery', addr: '4703 Garrison Blvd', city: 'Baltimore', state: 'MD', zip: '21215', lastSale: '09/30/2025', active: true },
  { id: 'CASH0287', name: 'Natural Deli', addr: '413 East Baltimore St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '04/16/2025', active: true },
  { id: 'CASH0298', name: 'One Stop Deli And Grocery', addr: '1300 N Caroline St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '10/06/2025', active: true },
  { id: 'CASH0318', name: 'Lexington Deli Mart', addr: '329 Lexington St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '02/03/2026', active: true },
  { id: 'CASH0322', name: 'Quick Mart Lexington', addr: '329 W Lexington St', city: 'Baltimore', state: 'MD', zip: '21201', lastSale: '07/18/2025', active: true },
  { id: 'CASH0325', name: 'Rany', addr: '1500 North Washington St', city: 'Baltimore', state: 'MD', zip: '21213', lastSale: '09/11/2024', active: true },
  { id: 'CASH0330', name: 'Reyes Deli Grocery', addr: '801 Bentelou St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '11/06/2025', active: true },
  { id: 'CASH0339', name: 'Rossiter Grocery', addr: '5001 York Rd', city: 'Baltimore', state: 'MD', zip: '21212', lastSale: '02/04/2026', active: true },
  { id: 'CASH0366', name: 'Soda Pop Shop', addr: '4420 Pennington Ave', city: 'Curtis Bay', state: 'MD', zip: '21226', lastSale: '08/22/2024', active: true },
  { id: 'CASH0367', name: 'Spot Mart', addr: '400 S Payson St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '12/03/2024', active: true },
  { id: 'CASH0391', name: 'Torres Deli And Grocery', addr: '401 Furrow St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '02/02/2026', active: true },
  { id: 'CASH0395', name: 'Three Brothers Deli Market', addr: '535 N Glover St', city: 'Baltimore', state: 'MD', zip: '', lastSale: '07/25/2025', active: true },
  { id: 'CASH0400', name: 'USA Market', addr: '3505 Pelham Ave', city: 'Baltimore', state: 'MD', zip: '', lastSale: '03/28/2025', active: true },
  { id: 'CASH0411', name: 'Y And K Market', addr: '2201 Harford Rd', city: 'Baltimore', state: 'MD', zip: '21218', lastSale: '08/15/2025', active: true },
  { id: 'CASH0430', name: 'Nisha Deli and Grocery', addr: '1701 Westwood Ave', city: 'Baltimore', state: 'MD', zip: '21217', lastSale: '11/06/2025', active: true },
  { id: 'CASH0458', name: 'York Rd Mini Mart', addr: '5307 York Rd', city: 'Baltimore', state: 'MD', zip: '21212', lastSale: '10/07/2024', active: true },
  { id: 'CASH0459', name: 'Brothers Convenience Store', addr: '3358 Greenmount Ave', city: 'Baltimore', state: 'MD', zip: '21218', lastSale: '06/19/2025', active: true },
  { id: 'CASH0505', name: 'Queen of Sheba', addr: '2445 North Charles St.', city: 'Baltimore', state: 'MD', zip: '21218', lastSale: '09/29/2025', active: true },
  { id: 'CASH0507', name: 'A1 Grocery', addr: '620 N. Eutaw', city: 'Baltimore', state: 'MD', zip: '21201', lastSale: '02/06/2026', active: true },
  { id: 'CASH0518', name: 'Grocery La Bonita', addr: '600 N. Highland Ave', city: 'Baltimore', state: 'MD', zip: '21205', lastSale: '08/27/2025', active: true },
  { id: 'CASH0528', name: 'Exxon Station', addr: '5913 York Rd', city: 'Baltimore', state: 'MD', zip: '21212', lastSale: '08/04/2025', active: true },
  { id: 'CASH0529', name: 'Highland Town Mini Mart', addr: '100 S. Conkling St', city: 'Baltimore', state: 'MD', zip: '21224', lastSale: '08/27/2025', active: true },
  { id: 'CASH0536', name: 'Luckies Store and Deli', addr: '7713 Baltimore Annapolis Blvd', city: 'Glen Burnie', state: 'MD', zip: '21060', lastSale: '02/06/2026', active: true },
  { id: 'CASH0544', name: 'Maple Lawn Market', addr: '8181 Maple Lawn Blvd', city: 'Fulton', state: 'MD', zip: '20759', lastSale: '11/10/2025', active: true },
  { id: 'FLW01661', name: 'Food Lion 1661', addr: '845 ROCKVILLE PIKE', city: 'Rockville', state: 'MD', zip: '20852', lastSale: '02/12/2026', active: true },
  { id: 'WGW00016', name: 'Wegmans 016', addr: '11620 MONUMENT DRIVE', city: 'Fairfax', state: 'VA', zip: '22030', lastSale: '', active: true },
  { id: 'WGW00060', name: 'Wegmans 060', addr: '1413 SOUTH MAIN CHAPEL WAY', city: 'Gambrills', state: 'MD', zip: '21054', lastSale: '08/15/2025', active: true },
];

// ID mappings for existing stores
const idMappings = {
  '69': 'FLW01661',  // Food Lion 1661, Rockville - Route 108
  '16': 'WGW00016',  // Wegmans 016, Fairfax - Route 0
  '60': 'WGW00060',  // Wegmans 060, Gambrills - Route 0
};

function parseLastSale(dateStr) {
  if (!dateStr) return '';
  const [m, d, y] = dateStr.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Read current stores.csv
const csvPath = path.join(__dirname, 'src', 'data', 'stores.csv');
let csv = fs.readFileSync(csvPath, 'utf-8');
let lines = csv.split('\n');
const header = lines[0];

// Default coords for Baltimore area
const defaultLat = '39.2904';
const defaultLng = '-76.6122';

// City-specific approximate coords
const cityCoords = {
  'Essex': [39.3093, -76.4748],
  'Dundalk': [39.2506, -76.5225],
  'Curtis Bay': [39.2259, -76.5829],
  'Glen Burnie': [39.1626, -76.6247],
  'Fulton': [39.1523, -76.9230],
  'Rockville': [39.084, -77.1528],
  'Fairfax': [38.8462, -77.3064],
  'Gambrills': [39.0671, -76.6654],
  'Baltimore': [39.2904, -76.6122],
};

// Track changes
const report = {
  newStores: [],
  movedStores: [],
  idChanges: [],
};

// 1. Update existing stores (change ID + route)
for (const [oldId, newId] of Object.entries(idMappings)) {
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = lines[i].split(',');
    if (cols[0] === oldId) {
      const feedEntry = feed.find(f => f.id === newId);
      const oldRoute = cols[7];
      cols[0] = newId;  // Update ID
      cols[1] = newId;  // Update Store Number
      cols[7] = '208';  // Route
      cols[8] = 'Route 208 Driver';
      cols[9] = 'Baltimore City';
      cols[10] = 'Baltimore City';
      cols[11] = 'Baltimore City';
      // Update lastVisited if feed has a newer date
      if (feedEntry && feedEntry.lastSale) {
        const feedDate = parseLastSale(feedEntry.lastSale);
        const currentDate = cols[14] || '';
        if (!currentDate || feedDate > currentDate.split(' ')[0]) {
          cols[14] = feedDate;
        }
      }
      lines[i] = cols.join(',');
      report.movedStores.push({ oldId, newId, name: feedEntry.name, from: `Route ${oldRoute}`, to: 'Route 208' });
      report.idChanges.push({ oldId, newId });
      console.log(`  Updated: ${oldId} → ${newId} (Route ${oldRoute} → 208)`);
      break;
    }
  }
}

// 2. Check which CASH stores already exist
const existingIds = new Set();
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const id = lines[i].split(',')[0];
  existingIds.add(id);
}

// 3. Add new CASH stores
const cashStores = feed.filter(f => f.id.startsWith('CASH'));
let added = 0;
let skipped = 0;

for (const s of cashStores) {
  if (existingIds.has(s.id)) {
    console.log(`  Skipped (exists): ${s.id} - ${s.name}`);
    skipped++;
    continue;
  }

  const coords = cityCoords[s.city] || cityCoords['Baltimore'];
  const lat = coords[0];
  const lng = coords[1];
  const lastVisited = s.lastSale ? parseLastSale(s.lastSale) : '';

  const line = [
    s.id, s.id, s.name, s.addr, s.city, s.state, s.zip,
    '208', 'Route 208 Driver',
    'Baltimore City', 'Baltimore City', 'Baltimore City',
    lat, lng, lastVisited
  ].join(',');

  lines.push(line);
  report.newStores.push({ id: s.id, name: s.name, city: s.city, lastSale: s.lastSale, active: s.active });
  added++;
}

// Write updated CSV
fs.writeFileSync(csvPath, lines.filter(l => l !== '').join('\n') + '\n', 'utf-8');
console.log(`\nStores CSV updated: ${added} added, ${skipped} skipped, ${report.movedStores.length} moved`);

// 4. Update visitHistory.js
const vhPath = path.join(__dirname, 'src', 'data', 'visitHistory.js');
let vhContent = fs.readFileSync(vhPath, 'utf-8');

// Migrate old IDs
for (const { oldId, newId } of report.idChanges) {
  const oldKey = `'${oldId}'`;
  const newKey = `'${newId}'`;
  if (vhContent.includes(oldKey)) {
    vhContent = vhContent.replace(oldKey, newKey);
    console.log(`  visitHistory: ${oldId} → ${newId}`);
  }
}

// Add lastSale dates for new CASH stores that have recent dates
const newEntries = [];
for (const s of cashStores) {
  if (existingIds.has(s.id)) continue;
  if (!s.lastSale) continue;
  const ymd = parseLastSale(s.lastSale);
  if (ymd >= '2025-01-01') {  // Only add somewhat recent dates
    newEntries.push(`  '${s.id}': ['${ymd}']`);
  }
}

// Also add FLW01661 date if needed
const flw1661Date = parseLastSale('02/12/2026');
if (!vhContent.includes("'FLW01661'") && !vhContent.includes("'69'")) {
  newEntries.push(`  'FLW01661': ['${flw1661Date}']`);
} else if (vhContent.includes("'69'")) {
  // Already migrated above
  // Check if we need to add the new date
  const match = vhContent.match(/'FLW01661': \[([^\]]+)\]/);
  if (match && !match[1].includes(flw1661Date)) {
    const dates = match[1];
    vhContent = vhContent.replace(
      `'FLW01661': [${dates}]`,
      `'FLW01661': [${dates}, '${flw1661Date}']`
    );
  }
}

// Insert new entries before the closing };
if (newEntries.length > 0) {
  const sorted = newEntries.sort();
  vhContent = vhContent.replace('};', sorted.join(',\n') + ',\n};');
}

fs.writeFileSync(vhPath, vhContent, 'utf-8');
console.log(`visitHistory updated: ${newEntries.length} new entries, ${report.idChanges.length} ID migrations`);

// Print report
console.log('\n=== ROUTE 208 REPORT ===');
console.log(`\nNew CASH stores added: ${report.newStores.length}`);
console.log(`Existing stores moved to 208: ${report.movedStores.length}`);
console.log(`ID changes: ${report.idChanges.length}`);
console.log(`\nMoved stores:`);
report.movedStores.forEach(s => console.log(`  ${s.oldId} → ${s.newId} (${s.name}) ${s.from} → ${s.to}`));
console.log(`\nInactive stores: ${report.newStores.filter(s => !s.active).map(s => `${s.id} (${s.name})`).join(', ') || 'none'}`);
console.log(`\nTotal Route 208 stores: ${report.newStores.length + report.movedStores.length}`);

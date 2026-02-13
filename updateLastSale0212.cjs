const fs = require('fs');

const LAST_SALE_DATE = '2026-02-12';

// Feed data with pre-parsed addresses for accuracy
const feed = [
  { id: 'AMW00849', name: 'ACME 0849', route: '210', street: '711 Washington Ave', city: 'Chestertown', state: 'MD', zip: '21620' },
  { id: 'BGW00025', name: 'B GREEN CASH & CARRY 25', route: '203', street: '1300 S Monroe St', city: 'Baltimore', state: 'MD', zip: '21230' },
  { id: 'CASH0064', name: 'Carrol Patterson', route: '204', street: '4101 Patterson Ave', city: 'Baltimore', state: 'MD', zip: '21215' },
  { id: 'CASH0131', name: 'Exxon Pimlico', route: '204', street: '5509 Parkheights Ave', city: 'Baltimore', state: 'MD', zip: '21215' },
  { id: 'CASH0170', name: 'Garrison Deli And Grocery', route: '203', street: '2109 Garrison Blvd', city: 'Baltimore', state: 'MD', zip: '' },
  { id: 'CASH0236', name: 'Liberty Food Mart', route: '203', street: '3900 Fredrick Ave', city: 'Baltimore', state: 'MD', zip: '' },
  { id: 'CASH0257', name: 'Mariquita Deli Grocery', route: '204', street: '200 N Monroe St', city: 'Baltimore', state: 'MD', zip: '21223' },
  { id: 'CASH0297', name: 'One Stop Calhoun Street', route: '204', street: '1702 N Calhoun St', city: 'Baltimore', state: 'MD', zip: '' },
  { id: 'CASH0374', name: 'Sunnys Food Market', route: '204', street: '1739 N Payson St', city: 'Baltimore', state: 'MD', zip: '' },
  { id: 'CASH0430', name: 'Nisha Deli and Grocery', route: '208', street: '1701 Westwood Ave', city: 'Baltimore', state: 'MD', zip: '21217' },
  { id: 'CASH0504', name: 'Whitelock City Food Market', route: '203', street: '705 Whitelock St', city: 'Baltimore', state: 'MD', zip: '21217' },
  { id: 'CASH0546', name: 'Cherry Hill Mart', route: '203', street: '661 Cherry Hill Rd', city: 'Baltimore', state: 'MD', zip: '21225' },
  { id: 'CMW05241', name: 'Bolling commissary', route: '207', street: '185 Chappie James Blvd', city: 'Washington', state: 'DC', zip: '20032' },
  { id: 'FLW00246', name: 'FOOD LION 0246', route: '206', street: '11801 Coastal Hwy', city: 'Ocean City', state: 'MD', zip: '21842' },
  { id: 'FLW00397', name: 'FOOD LION 0397', route: '206', street: '9936 Stephen Decatur Hwy', city: 'Ocean City', state: 'MD', zip: '21842' },
  { id: 'FLW00658', name: 'FOOD LION 0658', route: '206', street: '10126 Old Ocean City Blvd', city: 'Berlin', state: 'MD', zip: '21811' },
  { id: 'FLW00698', name: 'FOOD LION 0698', route: '210', street: '840 S 5th St', city: 'Denton', state: 'MD', zip: '21629' },
  { id: 'FLW01161', name: 'FOOD LION 1161', route: '209', street: '46081 Briarcroft Plz', city: 'Sterling', state: 'VA', zip: '20164' },
  { id: 'FLW01185', name: 'FOOD LION 1185', route: '209', street: '720 S King St', city: 'Leesburg', state: 'VA', zip: '20175' },
  { id: 'FLW01268', name: 'FOOD LION 1268', route: '206', street: '232 Tilghman Rd', city: 'Salisbury', state: 'MD', zip: '21804' },
  { id: 'FLW01297', name: 'FOOD LION 1297', route: '210', street: '3344 Hayman Dr', city: 'Federalsburg', state: 'MD', zip: '21632' },
  { id: 'FLW01316', name: 'FOOD LION 1316', route: '207', street: '2960 Marshall Hall Rd', city: 'Bryans Road', state: 'MD', zip: '20616' },
  { id: 'FLW01337', name: 'FOOD LION 1337', route: '209', street: '20789 Great Falls Plz', city: 'Sterling', state: 'VA', zip: '20165' },
  { id: 'FLW01363', name: 'FOOD LION 1363', route: '214', street: '2500 W Pulaski Hwy', city: 'North East', state: 'MD', zip: '21901' },
  { id: 'FLW01413', name: 'FOOD LION 1413', route: '204', street: '8635 Walther Blvd', city: 'Nottingham', state: 'MD', zip: '21236' },
  { id: 'FLW01661', name: 'FOOD LION 1661', route: '208', street: '845 Rockville Pike', city: 'Rockville', state: 'MD', zip: '20852' },
  { id: 'FLW02117', name: 'FOOD LION 2117', route: '210', street: '31810 River Rd', city: 'Millington', state: 'MD', zip: '21651' },
  { id: 'FLW02123', name: 'FOOD LION 2123', route: '206', street: '37468 Lion Dr', city: 'Selbyville', state: 'DE', zip: '19975' },
  { id: 'FLW02521', name: 'FOOD LION 2521', route: '210', street: '9537 Bridgeville Center Rd', city: 'Bridgeville', state: 'DE', zip: '19933' },
  { id: 'FLW02522', name: 'FOOD LION 2522', route: '210', street: '2466 Centreville Rd', city: 'Centreville', state: 'MD', zip: '21617' },
  { id: 'FLW02559', name: 'FOOD LION 2559', route: '204', street: '7069 Baltimore Annapolis Blvd', city: 'Glen Burnie', state: 'MD', zip: '21061' },
  { id: 'FLW02560', name: 'FOOD LION 2560', route: '204', street: '7514 N Point Rd', city: 'Edgemere', state: 'MD', zip: '21219' },
  { id: 'FLW02614', name: 'FOOD LION 2614', route: '206', street: '11007 Manklin Creek Rd', city: 'Berlin', state: 'MD', zip: '21811' },
  { id: 'IND00025', name: 'Cococcinos', route: '203', street: '2831 Smith Ave', city: 'Baltimore', state: 'MD', zip: '21209' },
  { id: 'IND20000', name: "G&E Hocker's", route: '206', street: '695 Bethany Loop', city: 'Bethany Beach', state: 'DE', zip: '19930' },
  { id: 'MISC0204', name: 'Misc Cash 204', route: '204', street: '', city: '', state: '', zip: '' },
  { id: 'MTW06078', name: 'MARTINS 6078', route: '201', street: '1950 S Pleasant Valley Rd', city: 'Winchester', state: 'VA', zip: '22601' },
  { id: 'MTW06107', name: 'MARTINS 6107', route: '201', street: '901 Foxcroft Ave', city: 'Martinsburg', state: 'WV', zip: '25401' },
  { id: 'MTW06282', name: 'MARTINS 6282', route: '201', street: '409 South St', city: 'Front Royal', state: 'VA', zip: '22630' },
  { id: 'MTW06283', name: 'MARTINS 6283', route: '201', street: '400 Gateway Dr', city: 'Winchester', state: 'VA', zip: '22603' },
  { id: 'MTW06295', name: 'MARTINS 6295', route: '201', street: '240 Elizabeth Drive', city: 'Stephens City', state: 'VA', zip: '22655' },
  { id: 'MTW06299', name: 'MARTINS 6299', route: '201', street: '200 Rivendell Ct', city: 'Winchester', state: 'VA', zip: '22603' },
  { id: 'MTW06558', name: 'MARTINS 6558', route: '201', street: '409 N McNeil Rd', city: 'Berryville', state: 'VA', zip: '22611' },
  { id: 'RDW00049', name: 'REDNERS MARKET 49', route: '210', street: '17 Washington Sq', city: 'Chestertown', state: 'MD', zip: '21620' },
  { id: 'RDW00096', name: 'REDNERS MARKET 96', route: '204', street: '7938 Eastern Ave', city: 'Baltimore', state: 'MD', zip: '21224' },
  { id: 'SFW02377', name: 'SHOPPERS FOOD WHSE 2377', route: '207', street: '2950 Donnell Dr', city: 'Forestville', state: 'MD', zip: '20747' },
  { id: 'SRW00548', name: 'SHOP RITE 548', route: '214', street: '949 Beards Hill Road', city: 'Aberdeen', state: 'MD', zip: '21001' },
  { id: 'WMW00084', name: 'WEIS MARKETS 084', route: '204', street: '7200 Holabird Ave', city: 'Dundalk', state: 'MD', zip: '21222' },
  { id: 'WMW00276', name: 'WEIS MARKETS 276', route: '207', street: '15789 Livingston Rd', city: 'Accokeek', state: 'MD', zip: '20607' },
];

// City-to-region mapping for new stores
const cityRegion = {
  'Baltimore': { region: 'Baltimore City', territory: 'Baltimore City', sub: 'Baltimore City' },
  'Chestertown': { region: 'Eastern Shore Maryland', territory: 'Chestertown', sub: 'Upper Shore' },
  'Ocean City': { region: 'Eastern Shore Maryland', territory: 'Ocean City', sub: 'Ocean City & Coastal' },
  'Berlin': { region: 'Eastern Shore Maryland', territory: 'Berlin', sub: 'Ocean City & Coastal' },
  'Denton': { region: 'Eastern Shore Maryland', territory: 'Denton', sub: 'Upper Shore' },
  'Sterling': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'Leesburg': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'Salisbury': { region: 'Eastern Shore Maryland', territory: 'Salisbury', sub: 'Lower Shore' },
  'Federalsburg': { region: 'Eastern Shore Maryland', territory: 'Federalsburg', sub: 'Mid Shore' },
  'Bryans Road': { region: "Charles County", territory: "Charles County", sub: "Charles County" },
  'North East': { region: 'Cecil County', territory: 'Cecil County', sub: 'Cecil County' },
  'Nottingham': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'Rockville': { region: 'Montgomery County', territory: 'Montgomery County', sub: 'Montgomery County' },
  'Millington': { region: 'Eastern Shore Maryland', territory: 'Millington', sub: 'Upper Shore' },
  'Selbyville': { region: 'Eastern Shore Delaware', territory: 'Selbyville', sub: 'Coastal Delaware' },
  'Bridgeville': { region: 'Eastern Shore Delaware', territory: 'Bridgeville', sub: 'Central Delaware' },
  'Centreville': { region: 'Eastern Shore Maryland', territory: 'Centerville', sub: 'Upper Shore' },
  'Glen Burnie': { region: 'Anne Arundel County', territory: 'Anne Arundel County', sub: 'Anne Arundel County' },
  'Edgemere': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'Bethany Beach': { region: 'Eastern Shore Delaware', territory: 'Bethany Beach', sub: 'Coastal Delaware' },
  'Aberdeen': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'Dundalk': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
};

function getRegionInfo(city) {
  return cityRegion[city] || { region: '', territory: '', sub: '' };
}

// ---- Process stores.csv ----
const csvPath = 'src/data/stores.csv';
const lines = fs.readFileSync(csvPath, 'utf8').split('\n');

// First, remove the 27 badly-parsed new stores from previous run
// They were appended at the end. Find and remove them.
const feedIds = new Set(feed.map(f => f.id));
const cleanLines = [];
const removedBadNew = new Set();
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].trim()) { cleanLines.push(lines[i]); continue; }
  if (i === 0) { cleanLines.push(lines[i]); continue; }
  const cols = lines[i].split(',');
  const id = cols[0];
  // Check if this was a new store added in previous bad run (has empty lat/lng and is in our feed)
  if (feedIds.has(id) && cols[12] === '' && cols[13] === '') {
    removedBadNew.add(id);
    continue; // Skip - we'll re-add with correct data
  }
  cleanLines.push(lines[i]);
}

if (removedBadNew.size > 0) {
  console.log(`Removed ${removedBadNew.size} badly-parsed stores from previous run`);
}

const feedMap = {};
feed.forEach(f => { feedMap[f.id] = f; });

const existingIds = new Set();
let dateUpdated = 0;
let alreadyCurrent = 0;

for (let i = 1; i < cleanLines.length; i++) {
  if (!cleanLines[i].trim()) continue;
  const cols = cleanLines[i].split(',');
  const currentId = cols[0];
  existingIds.add(currentId);

  if (feedMap[currentId]) {
    const currentLast = cols[cols.length - 1].trim();
    const currentYmd = currentLast ? currentLast.split('T')[0].split(' ')[0] : '';
    if (LAST_SALE_DATE !== currentYmd) {
      cols[cols.length - 1] = LAST_SALE_DATE;
      cleanLines[i] = cols.join(',');
      dateUpdated++;
      console.log(`Date update: ${currentId} ${currentYmd || '(none)'} → ${LAST_SALE_DATE}`);
    } else {
      alreadyCurrent++;
      console.log(`Already current: ${currentId} = ${LAST_SALE_DATE}`);
    }
  }
}

// Add new stores with properly parsed addresses
let newStores = 0;
feed.forEach(f => {
  if (existingIds.has(f.id)) return;
  const region = getRegionInfo(f.city);

  // CSV: ID,Store Number,Store Name,Address,City,State,Zip Code,Route Number,Driver,Region,Territory,Sub-Territory,Latitude,Longitude,Last Visited
  const row = [
    f.id,
    f.id,
    f.name,
    f.street,
    f.city,
    f.state,
    f.zip,
    f.route,
    `Route ${f.route} Driver`,
    region.region,
    region.territory,
    region.sub,
    '', // Latitude - filled by cityCoords at runtime
    '', // Longitude
    LAST_SALE_DATE,
  ].join(',');

  cleanLines.push(row);
  newStores++;
  console.log(`New store: ${f.id} — ${f.name} (${f.city}, ${f.state}) Route ${f.route}`);
});

fs.writeFileSync(csvPath, cleanLines.join('\n'));
console.log(`\n--- stores.csv summary ---`);
console.log(`Date updates: ${dateUpdated}`);
console.log(`Already current: ${alreadyCurrent}`);
console.log(`New stores added: ${newStores}`);
console.log(`Bad entries cleaned: ${removedBadNew.size}`);
console.log(`Total in feed: ${feed.length}`);

// ---- Process visitHistory.js ----
const vhPath = 'src/data/visitHistory.js';
let vhContent = fs.readFileSync(vhPath, 'utf8');

const startMatch = vhContent.indexOf('{');
const endMatch = vhContent.lastIndexOf('}');
const objStr = vhContent.substring(startMatch, endMatch + 1);

const entries = {};
const entryRegex = /'([^']+)'\s*:\s*\[([^\]]*)\]/g;
let match;
while ((match = entryRegex.exec(objStr)) !== null) {
  const id = match[1];
  const dates = match[2] ? match[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
  entries[id] = dates;
}

let vhUpdated = 0;
let vhExists = 0;
feed.forEach(f => {
  if (!entries[f.id]) entries[f.id] = [];
  if (!entries[f.id].includes(LAST_SALE_DATE)) {
    entries[f.id].push(LAST_SALE_DATE);
    entries[f.id].sort();
    vhUpdated++;
  } else {
    vhExists++;
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
console.log(`\n--- visitHistory.js summary ---`);
console.log(`New entries: ${vhUpdated}`);
console.log(`Already existed: ${vhExists}`);
console.log('\nDone!');

#!/usr/bin/env node
/**
 * processFeed.cjs — Process store visit CSV feed: update dates, replace old IDs, update routes, add new stores.
 *
 * Usage: node processFeed.cjs <csv-file> <date-YYYY-MM-DD>
 */

const fs = require('fs');
const path = require('path');

const STORES_CSV = path.join(__dirname, 'src', 'data', 'stores.csv');
const VISIT_HISTORY = path.join(__dirname, 'src', 'data', 'visitHistory.js');

// ── Helpers ────────────────────────────────────────────────────────────────
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

function normalizeDate(d) {
  if (!d) return null;
  const s = d.trim();
  if (!s) return null;
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.split(' ')[0];
  return s;
}

function extractNumber(id) {
  const m = id.match(/[A-Z]+-?0*(\d+)/i);
  return m ? m[1] : null;
}

function readVisitHistory() {
  if (!fs.existsSync(VISIT_HISTORY)) return {};
  const text = fs.readFileSync(VISIT_HISTORY, 'utf8');
  const entries = {};
  const regex = /'([^']+)':\s*\[([^\]]*)\]/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    entries[m[1]] = m[2].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
  }
  return entries;
}

function writeVisitHistory(history) {
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
}

// Route → region/territory mapping
const routeRegions = {
  '200': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 200 Driver' },
  '201': { region: 'Maryland Western', territory: 'Maryland Western', subTerritory: 'Maryland Western', driver: 'Route 201 Driver' },
  '203': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 203 Driver' },
  '204': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 204 Driver' },
  '206': { region: 'Eastern Shore Maryland', territory: 'Salisbury', subTerritory: 'Salisbury', driver: 'Route 206 Driver' },
  '207': { region: 'Southern Maryland', territory: 'Southern Maryland', subTerritory: 'Southern Maryland', driver: 'Route 207 Driver' },
  '209': { region: 'Northern Virginia', territory: 'Northern Virginia', subTerritory: 'Northern Virginia', driver: 'Route 209 Driver' },
  '210': { region: 'Delaware', territory: 'Dover', subTerritory: 'Dover', driver: 'Route 210 Driver' },
  '211': { region: 'Baltimore County', territory: 'Baltimore County', subTerritory: 'Baltimore County', driver: 'Route 211 Driver' },
  '214': { region: 'Harford County', territory: 'Harford County', subTerritory: 'Harford County', driver: 'Route 214 Driver' },
};

// Parse address from input format
function parseInputAddress(raw) {
  const s = (raw || '').trim();
  if (!s) return { address: '', city: '', state: '', zip: '' };
  const zipMatch = s.match(/(\d{5}(-\d{4})?)\s*$/);
  const zip = zipMatch ? zipMatch[1] : '';
  const noZip = zip ? s.slice(0, s.lastIndexOf(zip)).trim() : s;
  const stateMatch = noZip.match(/\b(MD|VA|DE|WV|DC)\.?\s*$/i);
  const state = stateMatch ? stateMatch[1].replace('.', '').toUpperCase() : 'MD';
  const noState = stateMatch ? noZip.slice(0, stateMatch.index).trim() : noZip;
  const cities = ['Baltimore', 'Salisbury', 'Dover', 'Frederick', 'Waldorf', 'Hagerstown',
    'Annapolis', 'Columbia', 'Rockville', 'Germantown', 'Bowie', 'Laurel',
    'Glen Burnie', 'Cockeysville', 'Randallstown', 'Pasadena', 'Essex',
    'Edgemere', 'Parkville', 'Timonium', 'Bel Air', 'Aberdeen', 'Joppa',
    'Perryville', 'Rising Sun', 'Westminster', 'Taneytown', 'Finksburg',
    'Eldersburg', 'Mt Airy', 'Mount Airy', 'Woodbine', 'Nottingham',
    'Middle River', 'Pikesville', 'Owings Mills', 'Hunt Valley',
    'Charlotte Hall', 'Leonardtown', 'La Plata', 'Bryans Road',
    'Milford', 'Camden', 'Smyrna', 'Middletown', 'Delmar', 'Seaford',
    'Georgetown', 'Lewes', 'Milton', 'Millsboro', 'Selbyville', 'Bridgeville',
    'Ocean City', 'Berlin', 'Cambridge', 'Easton', 'Denton', 'Federalsburg',
    'Princess Anne', 'Fruitland', 'Crisfield', 'Chestertown', 'Centerville',
    'Stevensville', 'Millington', 'Onley', 'Exmore', 'Cape Charles', 'Oak Hall',
    'Warrenton', 'Bealeton', 'Manassas', 'Woodbridge', 'Dumfries', 'Sterling',
    'Herndon', 'Lorton', 'Leesburg', 'Marshall', 'Lake Ridge', 'Dale City',
    'Winchester', 'Stephens City', 'Front Royal', 'Berryville',
    'Martinsburg', 'Charles Town', 'Shepherdstown', 'Hedgesville',
    'Falling Waters', 'Inwood', 'Hancock', 'Smithsburg', 'Thurmont',
    'Clinton', 'Largo', 'Forestville', 'Capitol Heights', 'Landover',
    'Hyattsville', 'College Park', 'Upper Marlboro', 'Lanham',
    'Odenton', 'Hanover', 'Fort Meade', 'Fort Myer', 'Fort Belvoir',
    'Quantico', 'JB Andrews', 'Bolling AFB', 'Patuxent River',
    'Ocean View', 'Bethany Beach', 'Linkwood', 'North East',
    'Edgewood', 'Belcamp', 'Forest Hill', 'Cardiff', 'Abingdon',
    'Woodstock', 'Strasburg', 'Berkeley', 'Silver Spring',
    'Havre De Grace', 'New Market', 'Accokeek', 'Harrington',
    'Scaggsville', 'Elkridge', 'Landover Hills', 'Maryland City', 'Tysons',
    'Gainesville'];
  let city = 'Baltimore';
  let address = noState;
  for (const c of cities.sort((a, b) => b.length - a.length)) {
    const idx = noState.toUpperCase().lastIndexOf(c.toUpperCase());
    if (idx > 0) { city = c; address = noState.slice(0, idx).trim(); break; }
  }
  return { address, city, state, zip };
}

// ── Main ───────────────────────────────────────────────────────────────────
const inputFile = process.argv[2];
if (!inputFile) { console.error('Usage: node processFeed.cjs <csv-file>'); process.exit(1); }

const inputText = fs.readFileSync(inputFile, 'utf8');
const inputLines = inputText.trim().split('\n');
const dataStart = inputLines[0].match(/Store Id/i) ? 1 : 0;

const inputRecords = [];
for (let i = dataStart; i < inputLines.length; i++) {
  const fields = parseCSVLine(inputLines[i]);
  const storeId = (fields[1] || '').trim();
  const name = (fields[2] || '').trim();
  const route = (fields[4] || '').trim();
  const rawAddress = (fields[7] || '').trim();
  const lastSale = normalizeDate((fields[8] || '').trim());
  if (!storeId) continue;
  inputRecords.push({ storeId, name, route, rawAddress, lastSale });
}

console.log(`\nParsed ${inputRecords.length} input records\n`);

// Read stores CSV
const csvText = fs.readFileSync(STORES_CSV, 'utf8');
const csvLines = csvText.trim().split('\n');
const header = csvLines[0];
const storeLines = csvLines.slice(1).filter(l => l.trim());

// Build lookups
const idMap = {};
const storeNumMap = {};
storeLines.forEach((line, idx) => {
  const f = parseCSVLine(line);
  idMap[f[0]] = idx;
  if (f[1]) storeNumMap[f[1]] = idx;
});

const visitHistory = readVisitHistory();
const newStoreLines = [];
let updateCount = 0;
let idReplaceCount = 0;

function addToHistory(id, date) {
  if (!date) return;
  if (!visitHistory[id]) visitHistory[id] = [];
  if (!visitHistory[id].includes(date)) visitHistory[id].push(date);
}

inputRecords.forEach(rec => {
  const { storeId, name, route, rawAddress, lastSale } = rec;
  let matchIdx = null;
  let matchId = null;

  // 1. Exact ID match
  if (idMap[storeId] !== undefined) {
    matchIdx = idMap[storeId];
    matchId = storeId;
  }

  // 2. Store number match
  if (matchIdx === null && storeNumMap[storeId] !== undefined) {
    matchIdx = storeNumMap[storeId];
    matchId = parseCSVLine(storeLines[matchIdx])[0];
  }

  // 3. Extract numeric part
  if (matchIdx === null) {
    const num = extractNumber(storeId);
    if (num) {
      if (storeNumMap[num] !== undefined) {
        matchIdx = storeNumMap[num];
        matchId = parseCSVLine(storeLines[matchIdx])[0];
      }
      if (matchIdx === null) {
        const padded = num.padStart(5, '0');
        if (storeNumMap[padded] !== undefined) {
          matchIdx = storeNumMap[padded];
          matchId = parseCSVLine(storeLines[matchIdx])[0];
        }
      }
      // Also try matching store number patterns like "DE-2555" by checking the numeric part
      if (matchIdx === null) {
        for (const [sn, idx] of Object.entries(storeNumMap)) {
          const snNum = sn.replace(/^[A-Z]+-?/i, '').replace(/^0+/, '');
          if (snNum === num) {
            matchIdx = idx;
            matchId = parseCSVLine(storeLines[matchIdx])[0];
            break;
          }
        }
      }
    }
  }

  if (matchIdx !== null) {
    const fields = parseCSVLine(storeLines[matchIdx]);
    while (fields.length < 15) fields.push('');

    // Check if ID needs replacement (old → new)
    const needsIdReplace = matchId !== storeId;
    const oldId = matchId;

    if (needsIdReplace) {
      // Determine store number format based on prefix
      let newStoreNum;
      if (storeId.startsWith('FLW') || storeId.startsWith('SRW')) {
        newStoreNum = storeId.replace(/^[A-Z]+/, ''); // e.g., 00490
      } else {
        newStoreNum = storeId; // Use full ID as store number
      }
      fields[0] = storeId;
      fields[1] = newStoreNum;
      console.log(`  ID Replace: ${oldId} → ${storeId} (${fields[2]})`);
      idReplaceCount++;

      // Migrate visit history from old ID to new ID
      if (visitHistory[oldId]) {
        const oldDates = visitHistory[oldId];
        const existingDates = visitHistory[storeId] || [];
        visitHistory[storeId] = [...new Set([...existingDates, ...oldDates])].sort();
        delete visitHistory[oldId];
      }
    }

    // Update route if different
    const currentRoute = fields[7];
    if (route && route !== currentRoute && route !== '0') {
      const rInfo = routeRegions[route];
      if (rInfo) {
        console.log(`  Route change: ${fields[0]} (${fields[2]}) — Route ${currentRoute} → ${route}`);
        fields[7] = route;
        fields[8] = rInfo.driver;
        fields[9] = rInfo.region;
        fields[10] = rInfo.territory;
        fields[11] = rInfo.subTerritory;
      }
    }

    // Update date
    if (lastSale) {
      const oldDate = normalizeDate(fields[14]);
      if (oldDate) addToHistory(storeId, oldDate);
      fields[14] = lastSale;
      addToHistory(storeId, lastSale);
      updateCount++;
      if (!needsIdReplace) {
        console.log(`  Updated: ${storeId} (${fields[2]}) — ${oldDate || 'empty'} → ${lastSale}`);
      }
    }

    storeLines[matchIdx] = fields.join(',');
  } else {
    // New store
    const parsed = parseInputAddress(rawAddress);
    const rInfo = routeRegions[route] || { region: 'Unassigned', territory: 'Unassigned', subTerritory: 'Unassigned', driver: `Route ${route} Driver` };
    const line = [storeId, storeId, name, parsed.address, parsed.city, parsed.state, parsed.zip,
      route, rInfo.driver, rInfo.region, rInfo.territory, rInfo.subTerritory, '', '', lastSale || ''].join(',');
    newStoreLines.push(line);
    addToHistory(storeId, lastSale);
    console.log(`  Added new: ${storeId} (${name}) — Route ${route}`);
  }
});

// Write CSV
const finalLines = [header, ...storeLines, ...newStoreLines];
fs.writeFileSync(STORES_CSV, finalLines.join('\n') + '\n');
console.log(`\nUpdated ${updateCount} stores, replaced ${idReplaceCount} IDs, added ${newStoreLines.length} new stores`);

// Write visit history
writeVisitHistory(visitHistory);
console.log('Visit history updated. Done!');

#!/usr/bin/env node
/**
 * processVisits.cjs — Reusable script for processing store visit CSV feeds.
 *
 * Usage:
 *   node processVisits.cjs <csv-file>
 *
 * Input CSV format (same format pasted from the route system):
 *   Index,Store Id,Name,Type,Route/Jobber,...,Last Sale,...
 *
 * What it does:
 *   1. Matches input stores to existing stores.csv entries (by ID, store number, or name)
 *   2. Updates lastVisited dates in stores.csv
 *   3. Adds new stores that don't exist yet
 *   4. Appends visit dates to visitHistory.js
 *   5. Reports unmatched stores for manual review
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
  // MM/DD/YYYY → YYYY-MM-DD
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  // Already YYYY-MM-DD
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.split(' ')[0];
  return s;
}

// Extract numeric store number from ID like FLW01184 → "1184", AMW00896 → "896"
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

// Route → region/territory mapping for new stores
const routeRegions = {
  '200': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 200 Driver' },
  '201': { region: 'Maryland Western', territory: 'Maryland Western', subTerritory: 'Maryland Western', driver: 'Route 201 Driver' },
  '203': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 203 Driver' },
  '204': { region: 'Baltimore City', territory: 'Baltimore City', subTerritory: 'Baltimore City', driver: 'Route 204 Driver' },
  '206': { region: 'Eastern Shore Maryland', territory: 'Salisbury', subTerritory: 'Salisbury', driver: 'Route 206 Driver' },
  '207': { region: 'Southern Maryland', territory: 'Southern Maryland', subTerritory: 'Southern Maryland', driver: 'Route 207 Driver' },
  '209': { region: 'Northern Virginia', territory: 'Northern Virginia', subTerritory: 'Northern Virginia', driver: 'Route 209 Driver' },
  '210': { region: 'Delaware', territory: 'Dover', subTerritory: 'Dover', driver: 'Route 210 Driver' },
  '214': { region: 'Harford County', territory: 'Harford County', subTerritory: 'Harford County', driver: 'Route 214 Driver' },
};

// ── Parse address from input format ────────────────────────────────────────
function parseInputAddress(raw) {
  // Format: "3201 W North Ave Baltimore MD." or "751 S SALISBURY BLVD SALISBURY MD. 21801"
  const s = (raw || '').trim();
  if (!s) return { address: '', city: '', state: '', zip: '' };

  // Try to extract zip at end
  const zipMatch = s.match(/(\d{5}(-\d{4})?)\s*$/);
  const zip = zipMatch ? zipMatch[1] : '';
  const noZip = zip ? s.slice(0, s.lastIndexOf(zip)).trim() : s;

  // Try to extract state (MD., VA., DE., WV., DC.)
  const stateMatch = noZip.match(/\b(MD|VA|DE|WV|DC)\.?\s*$/i);
  const state = stateMatch ? stateMatch[1].replace('.', '').toUpperCase() : 'MD';
  const noState = stateMatch ? noZip.slice(0, stateMatch.index).trim() : noZip;

  // Last word(s) before state = city, rest = address
  // Common pattern: "3201 W North Ave Baltimore"
  // Try splitting on known city names or take last 1-2 words
  const words = noState.split(/\s+/);
  let city = 'Baltimore'; // default
  let address = noState;

  // Known cities to look for
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
    'Havre De Grace', 'New Market', 'Accokeek'];

  for (const c of cities.sort((a, b) => b.length - a.length)) {
    const idx = noState.toUpperCase().lastIndexOf(c.toUpperCase());
    if (idx > 0) {
      city = c;
      address = noState.slice(0, idx).trim();
      break;
    }
  }

  return { address, city, state, zip };
}

// ── Main ───────────────────────────────────────────────────────────────────
const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node processVisits.cjs <csv-file>');
  process.exit(1);
}

const inputText = fs.readFileSync(inputFile, 'utf8');
const inputLines = inputText.trim().split('\n');

// Skip header line
const dataStart = inputLines[0].match(/Store Id/i) ? 1 : 0;

// Parse input records
const inputRecords = [];
for (let i = dataStart; i < inputLines.length; i++) {
  const fields = parseCSVLine(inputLines[i]);
  // Fields: Index, Store Id, Name, Type, Route/Jobber, Statement Chain ID, External ID, Address, Last Sale, HHC, Active
  const storeId = (fields[1] || '').trim();
  const name = (fields[2] || '').trim();
  const route = (fields[4] || '').trim();
  const rawAddress = (fields[7] || '').trim();
  const lastSale = normalizeDate((fields[8] || '').trim());
  if (!storeId) continue;
  inputRecords.push({ storeId, name, route, rawAddress, lastSale });
}

console.log(`\nParsed ${inputRecords.length} input records\n`);

// Read stores CSV and build lookups
const csvText = fs.readFileSync(STORES_CSV, 'utf8');
const csvLines = csvText.trim().split('\n');
const header = csvLines[0];
const storeLines = csvLines.slice(1).filter(l => l.trim());

// Build lookup maps
const idMap = {};          // CSV ID → line index
const storeNumMap = {};    // Store Number → line index
const nameAddrMap = {};    // "name|city" → line index

storeLines.forEach((line, idx) => {
  const f = parseCSVLine(line);
  const id = f[0];
  const storeNum = f[1];
  const name = (f[2] || '').toLowerCase();
  const city = (f[4] || '').toLowerCase();
  idMap[id] = idx;
  if (storeNum) storeNumMap[storeNum] = idx;
  if (name && city) nameAddrMap[`${name}|${city}`] = idx;
});

// Process each input record
const visitHistory = readVisitHistory();
const updatedIndices = new Set();
const newStoreLines = [];
const unmatched = [];
let updateCount = 0;

function addToHistory(id, date) {
  if (!date) return;
  if (!visitHistory[id]) visitHistory[id] = [];
  if (!visitHistory[id].includes(date)) visitHistory[id].push(date);
}

inputRecords.forEach(rec => {
  const { storeId, name, route, rawAddress, lastSale } = rec;

  // Try to find existing store
  let matchIdx = null;
  let matchId = null;

  // 1. Exact ID match
  if (idMap[storeId] !== undefined) {
    matchIdx = idMap[storeId];
    matchId = storeId;
  }

  // 2. Match by store number
  if (matchIdx === null && storeNumMap[storeId] !== undefined) {
    matchIdx = storeNumMap[storeId];
    matchId = parseCSVLine(storeLines[matchIdx])[0];
  }

  // 3. Extract numeric part and match store number
  if (matchIdx === null) {
    const num = extractNumber(storeId);
    if (num) {
      if (storeNumMap[num] !== undefined) {
        matchIdx = storeNumMap[num];
        matchId = parseCSVLine(storeLines[matchIdx])[0];
      }
      // Try with leading zeros
      const padded = num.padStart(5, '0');
      if (matchIdx === null && storeNumMap[padded] !== undefined) {
        matchIdx = storeNumMap[padded];
        matchId = parseCSVLine(storeLines[matchIdx])[0];
      }
    }
  }

  // 4. Match by name + city
  if (matchIdx === null) {
    const parsed = parseInputAddress(rawAddress);
    const key = `${name.toLowerCase()}|${parsed.city.toLowerCase()}`;
    if (nameAddrMap[key] !== undefined) {
      matchIdx = nameAddrMap[key];
      matchId = parseCSVLine(storeLines[matchIdx])[0];
    }
  }

  if (matchIdx !== null && lastSale) {
    // Update existing store
    const fields = parseCSVLine(storeLines[matchIdx]);
    while (fields.length < 15) fields.push('');
    const oldDate = normalizeDate(fields[14]);
    if (oldDate) addToHistory(matchId, oldDate);
    fields[14] = lastSale;
    storeLines[matchIdx] = fields.join(',');
    updatedIndices.add(matchIdx);
    addToHistory(matchId, lastSale);
    updateCount++;
    console.log(`  Updated: ${matchId} (${fields[2]}) — ${oldDate || 'empty'} → ${lastSale}`);
  } else if (matchIdx === null) {
    // New store - build CSV line
    const parsed = parseInputAddress(rawAddress);
    const rInfo = routeRegions[route] || { region: 'Unassigned', territory: 'Unassigned', subTerritory: 'Unassigned', driver: `Route ${route} Driver` };
    const line = [storeId, storeId, name, parsed.address, parsed.city, parsed.state, parsed.zip,
      route, rInfo.driver, rInfo.region, rInfo.territory, rInfo.subTerritory, '', '', lastSale || ''].join(',');
    newStoreLines.push(line);
    addToHistory(storeId, lastSale);
    console.log(`  Added new: ${storeId} (${name}) — Route ${route}`);
  }
});

// Rebuild and write CSV
const finalLines = [header, ...storeLines, ...newStoreLines];
fs.writeFileSync(STORES_CSV, finalLines.join('\n') + '\n');
console.log(`\nUpdated ${updateCount} stores, added ${newStoreLines.length} new stores`);

if (unmatched.length > 0) {
  console.log(`\n⚠ Unmatched stores (need manual review):`);
  unmatched.forEach(r => console.log(`  ${r.storeId} - ${r.name}`));
}

writeVisitHistory(visitHistory);
console.log('Done!');

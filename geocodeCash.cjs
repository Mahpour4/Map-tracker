#!/usr/bin/env node
/**
 * geocodeCash.cjs — One-time script to fix CASH route 200 store coordinates.
 *
 * Uses zip-code-level coordinates (neighborhood precision) instead of the
 * city-center spiral offsets that scattered Baltimore stores 30+ miles away.
 *
 * For each zip code group, stores get a tight spiral (0.0008 degree ~90m)
 * to avoid pin overlap while staying within the correct neighborhood.
 *
 * Usage: node geocodeCash.cjs
 */

const fs = require('fs');
const path = require('path');

const STORES_CSV = path.join(__dirname, 'src', 'data', 'stores.csv');

// ── Zip Code → Neighborhood Coordinates ──────────────────────────────────────
// Center points for each zip code, based on USPS zip code centroids.
// Baltimore City zips map to specific neighborhoods rather than one city center.

const ZIP_COORDS = {
  // Baltimore City neighborhoods
  '21201': [39.2935, -76.6205],  // Downtown/Mt Vernon
  '21202': [39.2966, -76.6074],  // Inner Harbor/Downtown East
  '21205': [39.2981, -76.5887],  // East Baltimore/Middle East
  '21206': [39.3375, -76.5552],  // Northeast/Overlea/Frankford
  '21207': [39.3140, -76.6830],  // Gwynns Falls/Liberty Heights
  '21208': [39.3765, -76.7310],  // Pikesville
  '21209': [39.3517, -76.6540],  // Roland Park/Mt Washington
  '21210': [39.3475, -76.6350],  // Roland Park
  '21211': [39.3284, -76.6370],  // Hampden/Remington
  '21212': [39.3583, -76.6093],  // Homeland/Govans/York Road
  '21213': [39.3113, -76.5776],  // Clifton Park/Belair-Edison
  '21214': [39.3500, -76.5650],  // Hamilton/Lauraville
  '21215': [39.3425, -76.6693],  // Park Heights/Pimlico/NW
  '21216': [39.3095, -76.6558],  // Mondawmin/Rosemont/West
  '21217': [39.3078, -76.6358],  // Sandtown/Penn North/Upton
  '21218': [39.3260, -76.6038],  // Waverly/Greenmount/Charles Village
  '21220': [39.3375, -76.4475],  // Middle River
  '21221': [39.3095, -76.4698],  // Essex
  '21222': [39.2557, -76.5275],  // Dundalk
  '21223': [39.2830, -76.6445],  // Pigtown/SW Baltimore/Union Square
  '21224': [39.2825, -76.5615],  // Canton/Highlandtown/Southeast
  '21225': [39.2350, -76.6050],  // Brooklyn/Curtis Bay
  '21226': [39.2100, -76.5700],  // Curtis Bay/Hawkins Point
  '21227': [39.2310, -76.6793],  // Arbutus/Lansdowne/Halethorpe
  '21228': [39.2720, -76.7360],  // Catonsville
  '21229': [39.2858, -76.6815],  // Irvington/Beechfield/SW
  '21230': [39.2692, -76.6195],  // Federal Hill/Locust Point/South
  '21231': [39.2870, -76.5925],  // Fells Point/Harbor East
  '21233': [39.2940, -76.6505],  // West Baltimore/Poppleton
  '21234': [39.3847, -76.5399],  // Parkville/Carney
  '21236': [39.3947, -76.5199],  // Nottingham/White Marsh
  '21237': [39.3460, -76.4990],  // Rosedale
  '21239': [39.3590, -76.5780],  // Northwood/Lauraville
  '21244': [39.3191, -76.7275],  // Windsor Mill/Woodlawn
  '21287': [39.2983, -76.5927],  // Johns Hopkins Medical area
  '21129': [39.2940, -76.7060],  // Franklintown/Gwynns Falls

  // Baltimore County / surrounding
  '21030': [39.4812, -76.6438],  // Cockeysville
  '21061': [39.1626, -76.6247],  // Glen Burnie
  '21117': [39.4199, -76.7806],  // Owings Mills
  '21133': [39.3620, -76.7510],  // Randallstown
  '21136': [39.4350, -76.7900],  // Reisterstown

  // Howard County
  '21045': [39.2070, -76.8450],  // Columbia (west)
  '21046': [39.1930, -76.8180],  // Columbia (east)

  // Anne Arundel County
  '21225': [39.2350, -76.6050],  // Brooklyn
  '21076': [39.1720, -76.7240],  // Hanover

  // Prince George's County
  '20708': [39.0993, -76.8483],  // Laurel
  '20781': [38.9510, -76.9400],  // Hyattsville (south)
  '20782': [38.9700, -76.9580],  // Hyattsville (north)
  '20783': [39.0050, -76.9780],  // Adelphi
  '20735': [38.7649, -76.8984],  // Clinton
  '20743': [38.8851, -76.9158],  // Capitol Heights

  // Montgomery County
  '20850': [39.0840, -77.1528],  // Rockville
  '20851': [39.0780, -77.1260],  // Rockville (south)

  // Eastern Shore
  '21842': [38.3365, -75.0849],  // Ocean City
  '21811': [38.3226, -75.2177],  // Berlin
  '21613': [38.5634, -76.0789],  // Cambridge
  '21835': [38.5360, -75.9444],  // Linkwood
  '21620': [39.2088, -76.0669],  // Chestertown

  // DC
  '20011': [38.9560, -77.0200],  // Washington DC (NW)

  // Virginia
  '22303': [38.7900, -77.0800],  // Alexandria
  '22305': [38.8300, -77.0600],  // Alexandria (north)

  // Delaware
  '19933': [38.7426, -75.6044],  // Bridgeville
};

// City-level fallbacks for stores with no zip or unknown zip
const CITY_COORDS = {
  'BALTIMORE': [39.2904, -76.6122],
  'DUNDALK': [39.2507, -76.5225],
  'ESSEX': [39.3095, -76.4698],
  'GLEN BURNIE': [39.1626, -76.6247],
  'PARKVILLE': [39.3847, -76.5399],
  'PIKESVILLE': [39.3743, -76.7225],
  'COLUMBIA': [39.2037, -76.8610],
  'NOTTINGHAM': [39.3947, -76.5199],
  'CATONSVILLE': [39.2720, -76.7360],
  'OWINGS MILLS': [39.4199, -76.7806],
  'COCKEYSVILLE': [39.4812, -76.6438],
  'LAUREL': [39.0993, -76.8483],
  'HYATTSVILLE': [38.9559, -76.9453],
  'ROCKVILLE': [39.0840, -77.1528],
  'OCEAN CITY': [38.3365, -75.0849],
  'BERLIN': [38.3226, -75.2177],
  'CAMBRIDGE': [38.5634, -76.0789],
  'LINKWOOD': [38.5360, -75.9444],
  'CHESTERTOWN': [39.2088, -76.0669],
  'WASHINGTON': [38.9072, -77.0369],
  'ALEXANDRIA': [38.8048, -77.0469],
  'BRIDGEVILLE': [38.7426, -75.6044],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (inQuotes) {
      if (line[i] === '"') inQuotes = false;
      else current += line[i];
    } else {
      if (line[i] === '"') inQuotes = true;
      else if (line[i] === ',') { result.push(current); current = ''; }
      else current += line[i];
    }
  }
  result.push(current);
  return result;
}

// Reconstruct a CSV line, preserving quoted fields from the original
function reconstructLine(origLine, fields) {
  const parts = [];
  let inQuotes = false;
  let fieldIdx = 0;
  let start = 0;

  for (let i = 0; i <= origLine.length; i++) {
    const ch = origLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    if ((!inQuotes && ch === ',') || i === origLine.length) {
      const origPart = origLine.substring(start, i);
      // Use updated field value for lat/lng columns, keep original formatting for others
      if (fieldIdx === 12 || fieldIdx === 13) {
        parts.push(fields[fieldIdx]);
      } else {
        parts.push(origPart);
      }
      fieldIdx++;
      start = i + 1;
    }
  }
  return parts.join(',');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const csvContent = fs.readFileSync(STORES_CSV, 'utf-8');
  const lines = csvContent.split('\n');
  const header = lines[0];

  // First pass: group CASH route 200 stores by zip (or city)
  const storesByGroup = {};
  const storeIndices = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);
    const id = fields[0] || '';
    const route = (fields[7] || '').trim();

    if (!id.startsWith('CASH') || route !== '200') continue;

    const zip = (fields[6] || '').trim();
    const city = (fields[4] || '').trim().toUpperCase();

    // Determine group key: prefer zip, fallback to city
    let groupKey = zip || `CITY:${city}`;
    storeIndices.push(i);

    if (!storesByGroup[groupKey]) storesByGroup[groupKey] = [];
    storesByGroup[groupKey].push(i);
  }

  // Second pass: assign coordinates
  const updatedLines = [...lines];
  let updated = 0;
  let noMatch = 0;
  const failedStores = [];

  for (const [groupKey, indices] of Object.entries(storesByGroup)) {
    // Look up base coordinates for this group
    let baseCoords = null;

    if (groupKey.startsWith('CITY:')) {
      const city = groupKey.substring(5);
      baseCoords = CITY_COORDS[city] || null;
    } else {
      baseCoords = ZIP_COORDS[groupKey] || null;
      // If zip not found, try city fallback
      if (!baseCoords && indices.length > 0) {
        const fields = parseCSVLine(lines[indices[0]]);
        const city = (fields[4] || '').trim().toUpperCase();
        baseCoords = CITY_COORDS[city] || null;
      }
    }

    if (!baseCoords) {
      // Can't geocode - keep existing
      for (const idx of indices) {
        const fields = parseCSVLine(lines[idx]);
        failedStores.push(`  ${fields[0]}: ${fields[3]}, ${fields[4]} ${fields[5]} ${fields[6]}`);
      }
      noMatch += indices.length;
      continue;
    }

    // Assign coordinates with tight spiral offset (0.0008 degree ~90m per step)
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      const fields = parseCSVLine(lines[idx]);

      const offset = j * 0.0008;
      const angle = (j * 137.5 * Math.PI) / 180; // golden angle spiral
      const lat = (baseCoords[0] + offset * Math.cos(angle)).toFixed(4);
      const lng = (baseCoords[1] + offset * Math.sin(angle)).toFixed(4);

      fields[12] = lat;
      fields[13] = lng;

      updatedLines[idx] = reconstructLine(lines[idx], fields);
      updated++;

      console.log(`  ${fields[0]} (${groupKey}): ${lat}, ${lng}  — ${fields[3]}, ${fields[4]}`);
    }
  }

  // Write updated CSV
  fs.writeFileSync(STORES_CSV, updatedLines.join('\n'));

  console.log('\n════════════════════════════════════════');
  console.log(`Total CASH route 200 stores: ${updated + noMatch}`);
  console.log(`Updated (zip/city-level):    ${updated}`);
  console.log(`No coords found:             ${noMatch}`);
  if (failedStores.length > 0) {
    console.log(`\nStores with no matching zip or city:`);
    failedStores.forEach(s => console.log(s));
  }
  console.log('════════════════════════════════════════');
  console.log('stores.csv updated.');
}

main();

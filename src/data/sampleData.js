import storesCsv from './stores.csv?raw';
import cityCoords from './cityCoords';

// ── CSV Parser (handles quoted fields with commas) ──────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = (values[i] || '').trim();
    });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Geocode a store row ─────────────────────────────────────────────────────
let coordCounter = {};

function geocode(row) {
  const lat = parseFloat(row.Latitude);
  const lng = parseFloat(row.Longitude);
  if (lat && lng && Math.abs(lat) > 1 && Math.abs(lng) > 1) {
    return [lat, lng];
  }

  const city = (row.City || '').toUpperCase().trim();
  const state = normalizeState(row.State);
  const key = `${city}, ${state}`;
  const coords = cityCoords[key];

  if (coords) {
    const countKey = key;
    coordCounter[countKey] = (coordCounter[countKey] || 0) + 1;
    const offset = (coordCounter[countKey] - 1) * 0.003;
    const angle = (coordCounter[countKey] * 137.5 * Math.PI) / 180;
    return [
      coords[0] + offset * Math.cos(angle),
      coords[1] + offset * Math.sin(angle),
    ];
  }

  return null;
}

function normalizeState(state) {
  const s = (state || '').trim().toUpperCase();
  const map = {
    MARYLAND: 'MD',
    VIRGINIA: 'VA',
    DELAWARE: 'DE',
    'WEST VIRGINIA': 'WV',
    DC: 'DC',
  };
  return map[s] || s;
}

// ── Zone colors ─────────────────────────────────────────────────────────────
const zoneColors = {
  'Anne Arundel County': '#3b82f6',
  'Baltimore City': '#ef4444',
  'Baltimore County': '#f97316',
  'Carroll County': '#84cc16',
  'Cecil County': '#06b6d4',
  'Delaware': '#8b5cf6',
  'Eastern Shore Maryland': '#14b8a6',
  'Frederick County': '#f59e0b',
  'Harford County': '#6366f1',
  'Howard County': '#ec4899',
  'Maryland Central': '#a855f7',
  'Maryland Western': '#78716c',
  'Montgomery County': '#0ea5e9',
  'Northern Virginia': '#22c55e',
  "Prince George's County": '#e11d48',
  'Southern Maryland': '#d946ef',
  'Virginia Eastern Shore': '#0d9488',
  'Virginia Northern': '#7c3aed',
  'Washington DC': '#dc2626',
  'West Virginia': '#ca8a04',
  'West Virginia Eastern Panhandle': '#b45309',
  'Unassigned': '#9ca3af',
};

// ── Eastern Shore subsection groupings ──────────────────────────────────────
const easternShoreSubsections = {
  'Chestertown': 'Upper Shore',
  'Centerville': 'Upper Shore',
  'Millington': 'Upper Shore',
  'Stevensville': 'Upper Shore',
  'Denton': 'Upper Shore',
  'Easton': 'Mid Shore',
  'Cambridge': 'Mid Shore',
  'Federalsburg': 'Mid Shore',
  'MD': 'Mid Shore',
  'Salisbury': 'Lower Shore',
  'SALISBURY': 'Lower Shore',
  'Fruitland': 'Lower Shore',
  'Princess Anne': 'Lower Shore',
  'Crisfield': 'Lower Shore',
  'Ocean City': 'Ocean City & Coastal',
  'Berlin': 'Ocean City & Coastal',
  'BERLIN': 'Ocean City & Coastal',
  'Dover': 'Dover Area',
};

const easternShoreSubColors = {
  'Upper Shore': '#0f766e',
  'Mid Shore': '#14b8a6',
  'Lower Shore': '#2dd4bf',
  'Ocean City & Coastal': '#5eead4',
  'Dover Area': '#99f6e4',
};

function detectStoreType(name, id) {
  const n = (name || '').toLowerCase();
  if ((id || '').startsWith('CMW') || n.includes('comm ') || n.includes('commissary')) return 'military';
  if (n.includes('walmart')) return 'walmart';
  if (n.includes('wegmans')) return 'wegmans';
  if (n.includes('food lion')) return 'food-lion';
  if (n.includes('shoppers')) return 'shoppers';
  if (n.includes('shoprite') || n.includes('shop rite')) return 'shoprite';
  if (n.includes('giant') || n.includes('martin')) return 'giant-martins';
  if (n.includes('weis')) return 'weis';
  if (n.includes('redner')) return 'redners';
  if (n.includes('acme')) return 'acme';
  if (n.includes('geresbeck')) return 'geresbecks';
  return 'other';
}

// ── Old ID → New ID migration map (applied at parse time) ─────────────────
const OLD_ID_MAP = {
  // Food Lion
  '103':'FLW01547','117':'FLW01363','130':'FLW02587','139':'FLW02611','94':'FLW01653',
  '105':'FLW01413','126':'FLW01423','129':'FLW00950','131':'FLW02193','133':'FLW01238',
  '135':'FLW01162','138':'FLW01465','96':'FLW02560','97':'FLW02559','1216':'FLW01216',
  // Wegmans
  '07':'WGW00007','14':'WGW00014','42':'WGW00042','44':'WGW00044','47':'WGW00047',
  '54':'WGW00054','90':'WGW00041','102':'WGW00053','40':'WGW00040','67':'WGW00056',
  '136':'WGW00054',
  // Shoppers
  '02353':'SFW02353','02379':'SFW02379','02650':'SFW02650','07540':'SFW07540',
  '93':'SFW07533','110':'SFW07568','111':'SFW07573','68':'SFW00068','79':'SFW00079',
  '80':'SFW00080','64':'SFW07573M','02692':'SFW02692',
  // ShopRite
  '106':'SRW00542','119':'SRW00548','120':'SRW00551','121':'SRW00549',
  '122':'SRW00547','123':'SRW00545','124':'SRW00555','563':'SRW00563',
  // Weis / Redners
  '66':'WMW00287','95':'RDW00096','Redner-54':'RDW00054',
  // Walmart
  '108':'WAW00108','137':'WAW02551','98':'WAW00098','Wal-2':'WAW01736',
  // Giant / Geresbecks / Military
  '132':'GTW00132','101':'GBW00001','92':'GBW00002','g-3':'GBW00003','61':'CMW05167',
  // Independent / Misc
  '112':'IND00201','114':'IND00202','115':'IND00203','NB-01':'IND00204',
  'cash-de-101':'IND00205','CASH-DE-5':'IND20001','S121':'MISC0121',
  // Old DE- format
  'DE-246-DE-11':'FLW00246','DE-397-DE-12':'FLW00397','DE-658-DE-14':'FLW00658',
  'DE-698-DE-15':'FLW00698','DE-1158-DE-20':'FLW01158','DE-1268-DE-24':'FLW01268',
  'DE-1297-DE-26':'FLW01297','DE-1313-DE-27':'FLW01313','DE-2117-DE-33':'FLW02117',
  'DE-2123-DE-34':'FLW02123','DE-2521-DE-38':'FLW02521','DE-2614-DE-41':'FLW02614',
  'DE-DE-18':'RDW00018','DE-DE-2522':'FLW02522','DE-DE-272':'WMW00272',
  'DE-DE-2836':'AMW02836','DE-DE-293':'AMW00293','DE-DE-3816':'AMW03816',
  'DE-DE-3841':'AMW03841','DE-DE-49':'RDW00049','DE-DE-820':'AMW00820','DE-DE-821':'AMW00821',
  'DE-CASH-DE-1':'IND00101','DE-CASH-DE-2':'AMW02679','DE-CASH-DE-3':'IND00102',
  'DE-CASH-DE-6':'IND20000','DE-CASH-DE-8':'IND00103','DE-CASH-DE-9':'IND00104',
  'DE-CASH-DE-10':'IND00105','DE-CASH-DE-11':'IND00106','DE-CASH-DE-12':'IND00107',
  'DE-CASH-DE-14':'RDW00056','DE-CASH-DE-17':'IND00108',
};
const NEW_ID_SET = new Set(Object.values(OLD_ID_MAP));

// Migrate old ID and deduplicate: if both old and new-format rows exist, keep the one with data
function migrateAndDedup(rows) {
  const seen = {};
  const result = [];
  for (const row of rows) {
    const rawId = row.ID || row['Store Number'];
    const newId = OLD_ID_MAP[rawId];
    if (newId) {
      row.ID = newId;
      row['Store Number'] = newId;
      // Update name if it looks generic
      const name = (row['Store Name'] || '').toLowerCase();
      if (!name && newId) row['Store Name'] = newId;
    }
    const id = row.ID || row['Store Number'];
    if (seen[id]) {
      // Keep the one with more recent lastVisited or with coordinates
      const prev = seen[id];
      const prevDate = prev['Last Visited'] || '';
      const curDate = row['Last Visited'] || '';
      if (curDate > prevDate) {
        // Current row is newer — replace, but keep coords from prev if current is missing
        if (!row.Latitude && prev.Latitude) { row.Latitude = prev.Latitude; row.Longitude = prev.Longitude; }
        if ((!row.Region || row.Region === 'Unassigned') && prev.Region && prev.Region !== 'Unassigned') {
          row.Region = prev.Region; row.Territory = prev.Territory; row['Sub-Territory'] = prev['Sub-Territory'];
        }
        seen[id] = row;
      } else {
        // Previous row is newer or same — keep prev, but copy coords/region if missing
        if (!prev.Latitude && row.Latitude) { prev.Latitude = row.Latitude; prev.Longitude = row.Longitude; }
        if ((!prev.Region || prev.Region === 'Unassigned') && row.Region && row.Region !== 'Unassigned') {
          prev.Region = row.Region; prev.Territory = row.Territory; prev['Sub-Territory'] = row['Sub-Territory'];
        }
      }
      continue;
    }
    seen[id] = row;
    result.push(row);
  }
  // Replace with deduped rows (seen values in original order)
  const dedupResult = [];
  const added = new Set();
  for (const row of result) {
    const id = row.ID || row['Store Number'];
    if (added.has(id)) continue;
    added.add(id);
    dedupResult.push(seen[id]);
  }
  return dedupResult;
}

// ── Process all store data ──────────────────────────────────────────────────
const rawRows = migrateAndDedup(parseCSV(storesCsv));
coordCounter = {};

export const sampleStores = rawRows
  .map((row) => {
    const coords = geocode(row);
    if (!coords) return null;

    return {
      id: row.ID || row['Store Number'],
      storeNumber: row['Store Number'],
      name: row['Store Name'],
      address: row.Address,
      city: row.City,
      state: normalizeState(row.State),
      zip: row['Zip Code'],
      lat: coords[0],
      lng: coords[1],
      routeNumber: row['Route Number'],
      driver: row.Driver,
      region: row.Region || 'Unassigned',
      territory: row.Territory || 'Unassigned',
      subTerritory: row['Sub-Territory'] || 'Unassigned',
      lastSaleDate: row['Last Sale'] || null,
      lastVisited: row['Last Visited'] || null,
      type: detectStoreType(row['Store Name'], row.ID),
      zoneId: null,
      subZoneId: null,
    };
  })
  .filter(Boolean);

// ── Build zones from Region data ────────────────────────────────────────────
function buildZonesFromStores(stores) {
  const regionMap = {};

  stores.forEach((store) => {
    const region = store.region;
    if (!regionMap[region]) {
      regionMap[region] = { stores: [], territories: {} };
    }
    regionMap[region].stores.push(store);

    const territory = store.territory;

    // For Eastern Shore Maryland, group territories into subsections
    if (region === 'Eastern Shore Maryland') {
      const subsection = easternShoreSubsections[territory] || 'Lower Shore';
      store._subsection = subsection;
      if (!regionMap[region].territories[subsection]) {
        regionMap[region].territories[subsection] = [];
      }
      regionMap[region].territories[subsection].push(store);
    } else if (territory && territory !== region && territory !== 'Unassigned') {
      if (!regionMap[region].territories[territory]) {
        regionMap[region].territories[territory] = [];
      }
      regionMap[region].territories[territory].push(store);
    }
  });

  const zones = [];

  Object.entries(regionMap).forEach(([regionName, data]) => {
    const bounds = computeBounds(data.stores);
    if (!bounds) return;

    const color = zoneColors[regionName] || '#6b7280';
    const subZones = [];

    Object.entries(data.territories).forEach(([terrName, terrStores]) => {
      const subBounds = computeBounds(terrStores);
      if (!subBounds) return;

      // Use specific colors for Eastern Shore subsections
      const subColor = regionName === 'Eastern Shore Maryland'
        ? (easternShoreSubColors[terrName] || adjustColor(color, 40))
        : adjustColor(color, 40);

      subZones.push({
        id: `sz-${regionName}-${terrName}`.replace(/[^a-zA-Z0-9-]/g, '_'),
        name: terrName,
        color: subColor,
        bounds: subBounds,
        storeCount: terrStores.length,
      });
    });

    zones.push({
      id: `zone-${regionName}`.replace(/[^a-zA-Z0-9-]/g, '_'),
      name: regionName,
      color,
      bounds,
      subZones,
      storeCount: data.stores.length,
    });
  });

  return zones;
}

function computeBounds(stores) {
  if (stores.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  stores.forEach((s) => {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  });

  const latPad = Math.max((maxLat - minLat) * 0.1, 0.01);
  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.01);

  return [
    [maxLat + latPad, minLng - lngPad],
    [maxLat + latPad, maxLng + lngPad],
    [minLat - latPad, maxLng + lngPad],
    [minLat - latPad, minLng - lngPad],
  ];
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ── Build & export ──────────────────────────────────────────────────────────
export const sampleZones = buildZonesFromStores(sampleStores);

// ── Exported helpers for GitHub sync ────────────────────────────────────────
export function processStoresFromCsv(csvText) {
  const rows = migrateAndDedup(parseCSV(csvText));
  coordCounter = {};
  const stores = rows
    .map((row) => {
      const coords = geocode(row);
      if (!coords) return null;
      return {
        id: row.ID || row['Store Number'],
        storeNumber: row['Store Number'],
        name: row['Store Name'],
        address: row.Address,
        city: row.City,
        state: normalizeState(row.State),
        zip: row['Zip Code'],
        lat: coords[0],
        lng: coords[1],
        routeNumber: row['Route Number'],
        driver: row.Driver,
        region: row.Region || 'Unassigned',
        territory: row.Territory || 'Unassigned',
        subTerritory: row['Sub-Territory'] || 'Unassigned',
        lastSaleDate: row['Last Sale'] || null,
        lastVisited: row['Last Visited'] || null,
        type: detectStoreType(row['Store Name'], row.ID),
        zoneId: null,
        subZoneId: null,
      };
    })
    .filter(Boolean);

  const zones = buildZonesFromStores(stores);
  stores.forEach((store) => {
    const zone = zones.find((z) => z.name === store.region);
    if (zone) {
      store.zoneId = zone.id;
      if (store.region === 'Eastern Shore Maryland') {
        const subsection = easternShoreSubsections[store.territory] || 'Lower Shore';
        const subZone = zone.subZones.find((sz) => sz.name === subsection);
        if (subZone) store.subZoneId = subZone.id;
      } else {
        const subZone = zone.subZones.find((sz) => sz.name === store.territory);
        if (subZone) store.subZoneId = subZone.id;
      }
    }
  });

  return { stores, zones };
}

const CSV_HEADER = 'ID,Store Number,Store Name,Address,City,State,Zip Code,Route Number,Driver,Region,Territory,Sub-Territory,Latitude,Longitude,Last Sale,Last Visited,Dormant';

function isDormantForCsv(store) {
  // Use the most recent of lastSaleDate or lastVisited
  const latest = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop();
  if (!latest) return true;
  const raw = latest.split('T')[0];
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - d) / (1000 * 60 * 60 * 24)) >= 90;
}

function escapeCsvField(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function storesToCsv(stores) {
  const lines = [CSV_HEADER];
  stores.forEach((s) => {
    lines.push([
      escapeCsvField(s.id),
      escapeCsvField(s.storeNumber),
      escapeCsvField(s.name),
      escapeCsvField(s.address),
      escapeCsvField(s.city),
      escapeCsvField(s.state),
      escapeCsvField(s.zip),
      escapeCsvField(s.routeNumber),
      escapeCsvField(s.driver),
      escapeCsvField(s.region),
      escapeCsvField(s.territory),
      escapeCsvField(s.subTerritory),
      escapeCsvField(s.lat),
      escapeCsvField(s.lng),
      escapeCsvField(s.lastSaleDate || ''),
      escapeCsvField(s.lastVisited || ''),
      escapeCsvField(isDormantForCsv(s) ? 'Yes' : 'No'),
    ].join(','));
  });
  return lines.join('\n') + '\n';
}

// Assign stores to zones by region matching
sampleStores.forEach((store) => {
  const zone = sampleZones.find((z) => z.name === store.region);
  if (zone) {
    store.zoneId = zone.id;

    // For Eastern Shore, match by subsection grouping
    if (store.region === 'Eastern Shore Maryland') {
      const subsection = store._subsection || easternShoreSubsections[store.territory] || 'Lower Shore';
      const subZone = zone.subZones.find((sz) => sz.name === subsection);
      if (subZone) {
        store.subZoneId = subZone.id;
      }
    } else {
      const subZone = zone.subZones.find((sz) => sz.name === store.territory);
      if (subZone) {
        store.subZoneId = subZone.id;
      }
    }
  }
});

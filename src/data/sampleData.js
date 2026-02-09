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

function detectStoreType(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('walmart')) return 'walmart';
  if (n.includes('wegmans')) return 'wegmans';
  if (n.includes('food lion')) return 'food-lion';
  if (n.includes('shoppers') || n.includes('shop rite')) return 'shoppers';
  if (n.includes('giant') || n.includes('martin')) return 'giant-martins';
  if (n.includes('weis')) return 'weis';
  if (n.includes('redner')) return 'redners';
  if (n.includes('acme')) return 'acme';
  if (n.includes('geresbeck')) return 'geresbecks';
  return 'other';
}

// ── Process all store data ──────────────────────────────────────────────────
const rawRows = parseCSV(storesCsv);
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
      lastVisited: row['Last Visited'] || null,
      type: detectStoreType(row['Store Name']),
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
  const rows = parseCSV(csvText);
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
        lastVisited: row['Last Visited'] || null,
        type: detectStoreType(row['Store Name']),
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

const CSV_HEADER = 'ID,Store Number,Store Name,Address,City,State,Zip Code,Route Number,Driver,Region,Territory,Sub-Territory,Latitude,Longitude,Last Visited';

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
      escapeCsvField(s.lastVisited || ''),
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

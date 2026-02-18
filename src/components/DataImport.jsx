import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import cityCoords from '../data/cityCoords';
import { batchGeocode, geocodeAddress } from '../utils/geocodeAddress';

// Known city names from cityCoords for address parsing
const KNOWN_CITIES = Object.keys(cityCoords).map(k => {
  const [city] = k.split(', ');
  return city;
});

// Geocode using cityCoords with spiral offset for multiple stores in same city
const geocodeCounter = {};
function geocodeCity(city, state) {
  if (!city) return { lat: 0, lng: 0 };
  const key = `${city.toUpperCase()}, ${state.toUpperCase()}`;
  const coords = cityCoords[key];
  if (!coords) return { lat: 0, lng: 0 };

  geocodeCounter[key] = (geocodeCounter[key] || 0) + 1;
  const offset = (geocodeCounter[key] - 1) * 0.003;
  const angle = (geocodeCounter[key] * 137.5 * Math.PI) / 180;
  return {
    lat: coords[0] + offset * Math.cos(angle),
    lng: coords[1] + offset * Math.sin(angle),
  };
}

// City-to-region mapping
const cityRegionMap = {
  'BALTIMORE': { region: 'Baltimore City', territory: 'Baltimore City', sub: 'Baltimore City' },
  'CHESTERTOWN': { region: 'Eastern Shore Maryland', territory: 'Chestertown', sub: 'Upper Shore' },
  'OCEAN CITY': { region: 'Eastern Shore Maryland', territory: 'Ocean City', sub: 'Ocean City & Coastal' },
  'BERLIN': { region: 'Eastern Shore Maryland', territory: 'Berlin', sub: 'Ocean City & Coastal' },
  'DENTON': { region: 'Eastern Shore Maryland', territory: 'Denton', sub: 'Upper Shore' },
  'STERLING': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'LEESBURG': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'SALISBURY': { region: 'Eastern Shore Maryland', territory: 'Salisbury', sub: 'Lower Shore' },
  'FEDERALSBURG': { region: 'Eastern Shore Maryland', territory: 'Federalsburg', sub: 'Mid Shore' },
  'BRYANS ROAD': { region: "Charles County", territory: "Charles County", sub: "Charles County" },
  'NORTH EAST': { region: 'Cecil County', territory: 'Cecil County', sub: 'Cecil County' },
  'NOTTINGHAM': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'ROCKVILLE': { region: 'Montgomery County', territory: 'Montgomery County', sub: 'Montgomery County' },
  'MILLINGTON': { region: 'Eastern Shore Maryland', territory: 'Millington', sub: 'Upper Shore' },
  'SELBYVILLE': { region: 'Eastern Shore Delaware', territory: 'Selbyville', sub: 'Coastal Delaware' },
  'BRIDGEVILLE': { region: 'Eastern Shore Delaware', territory: 'Bridgeville', sub: 'Central Delaware' },
  'CENTREVILLE': { region: 'Eastern Shore Maryland', territory: 'Centerville', sub: 'Upper Shore' },
  'GLEN BURNIE': { region: 'Anne Arundel County', territory: 'Anne Arundel County', sub: 'Anne Arundel County' },
  'EDGEMERE': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'BETHANY BEACH': { region: 'Eastern Shore Delaware', territory: 'Bethany Beach', sub: 'Coastal Delaware' },
  'ABERDEEN': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'DUNDALK': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'WINCHESTER': { region: 'Shenandoah Valley', territory: 'Winchester', sub: 'Winchester' },
  'MARTINSBURG': { region: 'Eastern Panhandle WV', territory: 'Martinsburg', sub: 'Martinsburg' },
  'FRONT ROYAL': { region: 'Shenandoah Valley', territory: 'Front Royal', sub: 'Front Royal' },
  'STEPHENS CITY': { region: 'Shenandoah Valley', territory: 'Winchester', sub: 'Winchester' },
  'BERRYVILLE': { region: 'Shenandoah Valley', territory: 'Berryville', sub: 'Berryville' },
  'FORESTVILLE': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'ACCOKEEK': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'WASHINGTON': { region: 'Washington DC', territory: 'Washington DC', sub: 'Washington DC' },
  'CLINTON': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'LARGO': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'BOWIE': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'LAUREL': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'ESSEX': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'PIKESVILLE': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'TOWSON': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'ELKTON': { region: 'Cecil County', territory: 'Cecil County', sub: 'Cecil County' },
  'BEL AIR': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'HAVRE DE GRACE': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'COLUMBIA': { region: 'Howard County', territory: 'Howard County', sub: 'Howard County' },
  'ELLICOTT CITY': { region: 'Howard County', territory: 'Howard County', sub: 'Howard County' },
  'FREDERICK': { region: 'Frederick County', territory: 'Frederick County', sub: 'Frederick County' },
  'EASTON': { region: 'Eastern Shore Maryland', territory: 'Easton', sub: 'Mid Shore' },
  'CAMBRIDGE': { region: 'Eastern Shore Maryland', territory: 'Cambridge', sub: 'Mid Shore' },
  'DOVER': { region: 'Eastern Shore Delaware', territory: 'Dover', sub: 'Dover Area' },
  'DUMFRIES': { region: 'Northern Virginia', territory: 'Prince William County', sub: 'Prince William County' },
  'MANASSAS': { region: 'Northern Virginia', territory: 'Prince William County', sub: 'Prince William County' },
  'WALDORF': { region: 'Charles County', territory: 'Charles County', sub: 'Charles County' },
  'LA PLATA': { region: 'Charles County', territory: 'Charles County', sub: 'Charles County' },
  'HANCOCK': { region: 'Western Maryland', territory: 'Hancock', sub: 'Hancock' },
};

function getRegionInfo(city) {
  return cityRegionMap[city.toUpperCase()] || { region: 'Unassigned', territory: 'Unassigned', sub: 'Unassigned' };
}

/** Parse Python-format stores list into JS objects */
function parsePythonFeed(text) {
  const stores = [];
  // Match each dict: {'key': 'value', ...}
  const dictRegex = /\{([^}]+)\}/g;
  let match;

  while ((match = dictRegex.exec(text)) !== null) {
    const dictStr = match[1];
    const store = {};

    // Match key-value pairs: 'Key': 'Value' or 'Key': None or 'Key': True/False or 'Key': 123
    const kvRegex = /'([^']+)'\s*:\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|None|True|False)/g;
    let kv;

    while ((kv = kvRegex.exec(dictStr)) !== null) {
      const key = kv[1];
      const val = kv[2] !== undefined ? kv[2] : kv[3] !== undefined ? kv[3] : kv[4] !== undefined ? parseFloat(kv[4]) : null;

      // Map to True/False
      const rawAfterColon = dictStr.substring(kv.index + kv[1].length + 4).trimStart();
      if (rawAfterColon.startsWith('True')) store[key] = true;
      else if (rawAfterColon.startsWith('False')) store[key] = false;
      else if (rawAfterColon.startsWith('None')) store[key] = null;
      else store[key] = val;
    }

    if (store['Store Id']) {
      stores.push(store);
    }
  }

  return stores;
}

/** Parse combined address into components */
function parseAddress(raw) {
  if (!raw || raw === ', .' || raw.trim().length < 3) {
    return { street: '', city: '', state: '', zip: '' };
  }

  // Extract state and zip: look for ", STATE. ZIP" pattern
  const stateMatch = raw.match(/,\s*([A-Za-z\s]+?)\.\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (!stateMatch) return { street: raw, city: '', state: '', zip: '' };

  let state = stateMatch[1].trim();
  if (state.toLowerCase() === 'maryland') state = 'MD';
  const zip = (stateMatch[2] || '').trim();

  // Everything before ", STATE." is street + city
  const beforeState = raw.substring(0, stateMatch.index).trim();

  // Try to find a known city at the end of beforeState
  const upperBefore = beforeState.toUpperCase();
  let foundCity = '';
  let street = beforeState;

  // Sort cities by length (longest first) to match multi-word cities first
  const sortedCities = [...KNOWN_CITIES].sort((a, b) => b.length - a.length);

  for (const city of sortedCities) {
    if (upperBefore.endsWith(city)) {
      const idx = upperBefore.lastIndexOf(city);
      // Make sure there's a space or start before the city name
      if (idx === 0 || beforeState[idx - 1] === ' ') {
        foundCity = beforeState.substring(idx);
        street = beforeState.substring(0, idx).trim();
        break;
      }
    }
  }

  // If no known city found, try the last word(s) before state
  if (!foundCity) {
    // Try last 2 words then last 1 word
    const words = beforeState.split(/\s+/);
    if (words.length >= 2) {
      const lastTwo = words.slice(-2).join(' ');
      if (cityRegionMap[lastTwo.toUpperCase()]) {
        foundCity = lastTwo;
        street = words.slice(0, -2).join(' ');
      }
    }
    if (!foundCity && words.length >= 1) {
      foundCity = words[words.length - 1];
      street = words.slice(0, -1).join(' ');
    }
  }

  return { street, city: foundCity, state, zip };
}

/** Convert MM/DD/YYYY to YYYY-MM-DD */
function parseLastSale(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function detectStoreType(name, id) {
  const n = (name || '').toLowerCase();
  if ((id || '').startsWith('CMW') || n.includes('commissary')) return 'military';
  if (n.includes('food lion')) return 'food-lion';
  if (n.includes('shoppers') || n.includes('shop rite')) return 'shoppers';
  if (n.includes('giant') || n.includes('martin')) return 'giant-martins';
  if (n.includes('weis')) return 'weis';
  if (n.includes('redner')) return 'redners';
  if (n.includes('acme')) return 'acme';
  return 'other';
}

export default function DataImport() {
  const { state, bulkImportStores, addImportEntry, bulkRecordVisits } = useApp();
  const { stores, importLog } = state;

  const [rawInput, setRawInput] = useState('');
  const [parsed, setParsed] = useState(null);
  const [applied, setApplied] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState(null); // id of expanded log entry

  // Re-geocode state
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState('');
  const [geocodeResult, setGeocodeResult] = useState(null);

  // Store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  async function handleParse() {
    setApplied(false);
    const feedStores = parsePythonFeed(rawInput);

    if (feedStores.length === 0) {
      setParsed({ error: 'No stores found. Make sure the data is in the Python dict format.' });
      return;
    }

    const updates = [];
    const additions = [];
    const skipped = [];

    for (const fs of feedStores) {
      const id = fs['Store Id'];
      const name = fs['Name'] || '';
      const route = String(fs['Route/Jobber'] || '');
      const lastSale = parseLastSale(fs['Last Sale'] || '');
      const address = fs['Address'] || '';
      const existing = storeMap[id];

      if (existing) {
        // Update existing store
        const changes = {};
        if (lastSale && lastSale > (existing.lastSaleDate || '')) {
          changes.lastSaleDate = lastSale;
        }
        if (Object.keys(changes).length > 0) {
          updates.push({ id, ...changes, _displayName: existing.name });
        } else {
          skipped.push({ id, name: existing.name, reason: 'Already current' });
        }
      } else {
        // New store - try address-level geocoding first, fall back to city
        const addr = parseAddress(address);
        const region = getRegionInfo(addr.city);
        let coords = await geocodeAddress(addr.street, addr.city, addr.state, addr.zip);
        if (!coords) coords = geocodeCity(addr.city, addr.state);
        additions.push({
          id,
          storeNumber: id,
          name,
          address: addr.street,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          routeNumber: route,
          driver: `Route ${route} Driver`,
          region: region.region,
          territory: region.territory,
          subTerritory: region.sub,
          lat: coords.lat,
          lng: coords.lng,
          lastSaleDate: lastSale || null,
          lastVisited: null,
          type: detectStoreType(name, id),
          zoneId: null,
          subZoneId: null,
        });
      }
    }

    setParsed({ updates, additions, skipped, total: feedStores.length });
  }

  function handleApply() {
    if (!parsed || parsed.error) return;
    bulkImportStores(parsed.updates, parsed.additions);

    // Build import log entry
    const logStores = [
      ...parsed.updates.map(u => ({ id: u.id, name: u._displayName || u.id, date: u.lastSaleDate, type: 'update' })),
      ...parsed.additions.map(a => ({ id: a.id, name: a.name, date: a.lastSaleDate, type: 'new' })),
    ];
    addImportEntry({
      totalInFeed: parsed.total,
      updatedCount: parsed.updates.length,
      addedCount: parsed.additions.length,
      skippedCount: parsed.skipped.length,
      stores: logStores,
    });

    setApplied(true);
  }

  function handleClear() {
    setRawInput('');
    setParsed(null);
    setApplied(false);
  }

  const handleRegeocode = useCallback(async () => {
    setGeocoding(true);
    setGeocodeResult(null);
    setGeocodeProgress('Starting...');

    try {
      const updates = await batchGeocode(stores, (i, total) => {
        setGeocodeProgress(`Geocoding ${i} / ${total}...`);
      }, 200);

      if (updates.length > 0) {
        bulkImportStores(updates.map(u => ({ id: u.id, lat: u.lat, lng: u.lng })), []);
      }

      setGeocodeResult({
        total: stores.length,
        updated: updates.length,
        stores: updates,
      });
    } catch (err) {
      setGeocodeResult({ error: err.message });
    } finally {
      setGeocoding(false);
      setGeocodeProgress('');
    }
  }, [stores, bulkImportStores]);

  return (
    <div className="data-import-page">
      <div className="data-import-header">
        <h2>Data Import</h2>
        <p className="data-import-desc">
          Paste Python-format store feed data to update last sale dates and add new stores.
        </p>
      </div>

      {/* Re-geocode Section */}
      <div className="data-import-geocode-section">
        <h3>Re-geocode Store Coordinates</h3>
        <p className="data-import-desc" style={{ margin: '4px 0 10px' }}>
          Fix stores with inaccurate lat/lng by looking up their actual address.
          Uses OpenStreetMap (free). Takes ~1 second per store due to rate limits.
          {stores.length > 0 && ` (${stores.length} stores)`}
        </p>
        <div className="data-import-actions">
          <button
            className="btn btn-primary"
            onClick={handleRegeocode}
            disabled={geocoding || stores.length === 0}
          >
            {geocoding ? geocodeProgress : 'Re-geocode All Stores'}
          </button>
        </div>
        {geocodeResult && !geocodeResult.error && (
          <div className="data-import-success" style={{ marginTop: 8 }}>
            Done! {geocodeResult.updated} of {geocodeResult.total} stores had coordinates
            updated (moved &gt;200m from previous position).
            {geocodeResult.updated > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {geocodeResult.stores.map(s => {
                  const orig = stores.find(st => st.id === s.id);
                  return (
                    <li key={s.id}>
                      {orig?.name || s.id}: {orig?.lat?.toFixed(4)},{orig?.lng?.toFixed(4)} → {s.lat.toFixed(4)},{s.lng.toFixed(4)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {geocodeResult?.error && (
          <div className="data-import-error" style={{ marginTop: 8 }}>
            Geocoding failed: {geocodeResult.error}
          </div>
        )}
      </div>

      <div className="data-import-input-section">
        <textarea
          className="data-import-textarea"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={`Paste Python store data here, e.g.:\n\nstores = [\n    {'Store Id': 'FLW00246', 'Name': 'FOOD LION 0246', 'Route/Jobber': 206, 'Address': '11801 COASTAL HWY OCEAN CITY, MD. 21842', 'Last Sale': '02/12/2026', ...},\n    ...\n]`}
          rows={10}
          disabled={applied}
        />
        <div className="data-import-actions">
          <button
            className="btn btn-primary"
            onClick={handleParse}
            disabled={!rawInput.trim() || applied}
          >
            Parse Data
          </button>
          {parsed && !parsed.error && !applied && (
            <button className="btn btn-success" onClick={handleApply}>
              Apply {parsed.updates.length + parsed.additions.length} Changes
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      {/* Parse error */}
      {parsed?.error && (
        <div className="data-import-error">{parsed.error}</div>
      )}

      {/* Applied success */}
      {applied && (
        <div className="data-import-success">
          Import complete! {parsed.updates.length} stores updated, {parsed.additions.length} new stores added.
          Changes will auto-sync to GitHub.
        </div>
      )}

      {/* Preview results */}
      {parsed && !parsed.error && (
        <div className="data-import-preview">
          <div className="data-import-summary">
            <div className="import-stat">
              <span className="import-stat-val">{parsed.total}</span>
              <span className="import-stat-label">Total in feed</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#3b82f6' }}>{parsed.updates.length}</span>
              <span className="import-stat-label">Updates</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#22c55e' }}>{parsed.additions.length}</span>
              <span className="import-stat-label">New stores</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#9ca3af' }}>{parsed.skipped.length}</span>
              <span className="import-stat-label">Skipped</span>
            </div>
          </div>

          {/* Updates table */}
          {parsed.updates.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title">Date Updates ({parsed.updates.length})</h3>
              <div className="import-table">
                <div className="import-table-header">
                  <span className="import-col-id">Store ID</span>
                  <span className="import-col-name">Name</span>
                  <span className="import-col-date">New Date</span>
                </div>
                {parsed.updates.map(u => (
                  <div key={u.id} className="import-table-row">
                    <span className="import-col-id">{u.id}</span>
                    <span className="import-col-name">{u._displayName}</span>
                    <span className="import-col-date">{u.lastSaleDate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New stores table */}
          {parsed.additions.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title">New Stores ({parsed.additions.length})</h3>
              <div className="import-table">
                <div className="import-table-header">
                  <span className="import-col-id">Store ID</span>
                  <span className="import-col-name">Name</span>
                  <span className="import-col-city">City</span>
                  <span className="import-col-route">Route</span>
                  <span className="import-col-date">Last Sale</span>
                </div>
                {parsed.additions.map(a => (
                  <div key={a.id} className="import-table-row import-row-new">
                    <span className="import-col-id">{a.id}</span>
                    <span className="import-col-name">{a.name}</span>
                    <span className="import-col-city">{a.city}, {a.state}</span>
                    <span className="import-col-route">{a.routeNumber}</span>
                    <span className="import-col-date">{a.lastSaleDate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped table */}
          {parsed.skipped.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title import-section-muted">Skipped ({parsed.skipped.length})</h3>
              <div className="import-table">
                {parsed.skipped.map(s => (
                  <div key={s.id} className="import-table-row import-row-skipped">
                    <span className="import-col-id">{s.id}</span>
                    <span className="import-col-name">{s.name}</span>
                    <span className="import-col-date">{s.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import History */}
      {importLog.length > 0 && (
        <div className="di-log-section">
          <h3 className="di-log-title">Import History ({importLog.length})</h3>
          <div className="di-log-list">
            {importLog.map((entry, idx) => {
              const isExpanded = expandedEntry === entry.id || (expandedEntry === null && idx === 0);
              const ts = new Date(entry.timestamp);
              const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const lastStore = entry.stores?.length > 0 ? entry.stores[entry.stores.length - 1] : null;

              return (
                <div key={entry.id} className="di-log-entry">
                  <div
                    className="di-log-entry-header"
                    onClick={() => setExpandedEntry(isExpanded ? '__none__' : entry.id)}
                  >
                    <div className="di-log-entry-left">
                      <span className={`al-chevron ${isExpanded ? 'expanded' : ''}`}>&#9654;</span>
                      <span className="di-log-entry-date">{dateStr} {timeStr}</span>
                    </div>
                    <div className="di-log-entry-pills">
                      {entry.updatedCount > 0 && <span className="di-log-pill blue">{entry.updatedCount} updated</span>}
                      {entry.addedCount > 0 && <span className="di-log-pill green">{entry.addedCount} new</span>}
                      {entry.skippedCount > 0 && <span className="di-log-pill gray">{entry.skippedCount} skipped</span>}
                      <span className="di-log-pill outline">{entry.totalInFeed} in feed</span>
                    </div>
                  </div>
                  {isExpanded && entry.stores && (
                    <div className="di-log-entry-body">
                      {lastStore && (
                        <div className="di-log-last-banner">
                          Last entry: <strong>{lastStore.name}</strong> ({lastStore.id}) — {lastStore.date}
                        </div>
                      )}
                      <table className="di-log-table">
                        <thead>
                          <tr>
                            <th>Store ID</th>
                            <th>Name</th>
                            <th>Date</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.stores.map((s, si) => (
                            <tr key={s.id + si} className={si === entry.stores.length - 1 ? 'di-log-last-row' : ''}>
                              <td className="di-log-cell-id">{s.id}</td>
                              <td>{s.name}</td>
                              <td>{s.date}</td>
                              <td>
                                <span className={`di-log-type ${s.type}`}>
                                  {s.type === 'new' ? 'New' : 'Update'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

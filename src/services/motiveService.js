// Motive (formerly KeepTruckin) Fleet API Service
//
// In development, requests go through the Vite proxy (/api/motive -> api.gomotive.com)
// to bypass CORS. In production, set a custom base URL or CORS proxy.
const TOKEN_KEY = 'motive_api_key';
const BASE_URL_KEY = 'motive_base_url';
const CORS_PROXY_KEY = 'motive_cors_proxy';

// Use Vite dev proxy by default to avoid CORS issues
const DEFAULT_BASE = '/api/motive';

// Clear stale direct-API URLs from localStorage (leftover from before proxy was added)
const storedUrl = localStorage.getItem('motive_base_url') || '';
if (storedUrl.includes('api.gomotive.com') || storedUrl.includes('api.keeptruckin.com')) {
  localStorage.removeItem('motive_base_url');
}

// ---- Credential management ----

export function getMotiveApiKey() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setMotiveApiKey(key) {
  localStorage.setItem(TOKEN_KEY, key.trim());
}

export function clearMotiveApiKey() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getMotiveBaseUrl() {
  return localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE;
}

export function setMotiveBaseUrl(url) {
  if (url && url.trim() && url.trim() !== DEFAULT_BASE) {
    localStorage.setItem(BASE_URL_KEY, url.trim());
  } else {
    localStorage.removeItem(BASE_URL_KEY);
  }
}

export function getCorsProxy() {
  return localStorage.getItem(CORS_PROXY_KEY) || '';
}

export function setCorsProxy(proxy) {
  if (proxy && proxy.trim()) {
    localStorage.setItem(CORS_PROXY_KEY, proxy.trim());
  } else {
    localStorage.removeItem(CORS_PROXY_KEY);
  }
}

export function isMotiveConnected() {
  return !!getMotiveApiKey();
}

// ---- API fetch wrapper ----
// path should include the version, e.g. '/v1/vehicles' or '/v2/vehicle_locations'

async function motiveFetch(path, params = {}) {
  const apiKey = getMotiveApiKey();
  if (!apiKey) throw new Error('Motive API key not configured');

  const baseUrl = getMotiveBaseUrl();
  const isRelative = baseUrl.startsWith('/');

  let fetchUrl;
  if (isRelative) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) searchParams.set(k, String(v));
    });
    const qs = searchParams.toString();
    fetchUrl = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  } else {
    const fullUrl = new URL(`${baseUrl}${path}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
    });
    fetchUrl = fullUrl.toString();

    const proxy = getCorsProxy();
    if (proxy) {
      fetchUrl = `${proxy}${encodeURIComponent(fetchUrl)}`;
    }
  }

  console.log('[Motive] Fetching:', fetchUrl);
  const res = await fetch(fetchUrl, {
    headers: {
      'X-Api-Key': apiKey,
      'Accept': 'application/json',
    },
  });

  console.log('[Motive] Response:', res.status, res.statusText);

  if (!res.ok) {
    const body = await res.text();
    console.error('[Motive] Error body:', body);
    if (res.status === 401) {
      throw new Error('Invalid Motive API key or unauthorized');
    }
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (_) { /* not JSON */ }
    throw new Error(parsed.error_message || parsed.message || `Motive API error: ${res.status} — ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ---- Paginated fetch helper ----

async function fetchAllPages(path, dataKey, params = {}) {
  const allItems = [];
  let pageNo = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await motiveFetch(path, { ...params, page_no: pageNo, per_page: 25 });
    const items = data[dataKey] || [];
    allItems.push(...items);

    // Pagination can be nested under data.pagination OR at the top level (per_page, total, page_no)
    const pagination = data.pagination || data;
    const perPage = pagination.per_page || 25;
    const total = pagination.total || 0;
    console.log(`[Motive] Page ${pageNo}: ${items.length} ${dataKey} (total: ${total})`);

    if (items.length === 0) {
      hasMore = false;
    } else {
      const totalPages = pagination.total_pages || Math.ceil(total / perPage);
      if (pageNo >= totalPages) {
        hasMore = false;
      }
    }
    pageNo++;
  }

  console.log(`[Motive] Total fetched: ${allItems.length} ${dataKey}`);
  return allItems;
}

// ---- Public API functions ----

export async function fetchVehicles() {
  const raw = await fetchAllPages('/v1/vehicles', 'vehicles');
  console.log('[Motive] Raw vehicles (' + raw.length + ' items):', raw.slice(0, 2));
  return raw.map(v => v.vehicle || v);
}

export async function fetchVehicleLocations() {
  // Use v3 endpoint — returns vehicle_state, kph, city/state fields
  // Response: { vehicles: [{ vehicle: { id, vin, current_location: { lat, lon, vehicle_state, kph, city, state, ... } } }] }
  const raw = await fetchAllPages('/v3/vehicle_locations', 'vehicles');
  console.log('[Motive] Raw v3 vehicles with locations (' + raw.length + ' items)');
  if (raw.length > 0) {
    console.log('[Motive] Sample item [0]:', JSON.stringify(raw[0], null, 2));
  }

  const mapped = raw.map(vl => {
    const vehicle = vl.vehicle || vl;
    const loc = vehicle.current_location || {};
    const driver = vehicle.current_driver || {};

    // v3 uses kph for speed — convert to mph
    const speedMph = loc.kph != null ? parseFloat(loc.kph) * 0.621371 : null;

    // v3 uses vehicle_state ("on"/"off") instead of type
    const engineStatus = loc.vehicle_state || null;

    // v3 has city/state and current_location (string) for address
    const description = typeof loc.current_location === 'string'
      ? loc.current_location
      : [loc.city, loc.state].filter(Boolean).join(', ');

    return {
      id: vehicle.id,
      number: vehicle.number,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      licensePlate: vehicle.license_plate_number || null,
      lat: loc.lat != null ? parseFloat(loc.lat) : null,
      lng: loc.lon != null ? parseFloat(loc.lon) : null,
      speed: speedMph,
      bearing: loc.bearing != null ? parseFloat(loc.bearing) : null,
      engineStatus,
      locatedAt: loc.located_at || null,
      description,
      driverName: driver.first_name ? `${driver.first_name} ${driver.last_name || ''}`.trim() : null,
      driverStatus: driver.status || null,
    };
  });

  console.log('[Motive] Parsed locations:', mapped.map(m => ({
    id: m.id, num: m.number, vin: m.vin, plate: m.licensePlate,
    lat: m.lat, lng: m.lng, engine: m.engineStatus, driver: m.driverName,
  })));
  return mapped;
}

export async function testMotiveConnection() {
  try {
    await motiveFetch('/v1/vehicles', { per_page: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
    console.log(`[Motive] Page ${pageNo}: ${items.length} ${dataKey}`, data.pagination);

    const pagination = data.pagination;
    if (!pagination || items.length === 0) {
      hasMore = false;
    } else {
      // Motive returns 'total' (item count), not 'total_pages'
      const totalPages = pagination.total_pages || Math.ceil((pagination.total || 0) / (pagination.per_page || 25));
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
  // Use the same endpoint as the Motive SDK's fetchAListOfAllTheVehiclesAndTheirLocations
  const raw = await fetchAllPages('/v1/vehicle_locations', 'vehicle_locations');
  console.log('[Motive] Raw vehicle_locations (' + raw.length + ' items)');
  // Log the full first item so we can see the exact API response structure
  if (raw.length > 0) {
    console.log('[Motive] Sample item [0]:', JSON.stringify(raw[0], null, 2));
  }

  const mapped = raw.map(vl => {
    // Handle possible nesting: { vehicle_location: { vehicle: {}, ... } } or flat
    const entry = vl.vehicle_location || vl;
    const vehicle = entry.vehicle || {};
    const driver = entry.current_driver || entry.driver || {};
    const loc = entry.last_known_location || entry;

    return {
      id: vehicle.id || entry.id,
      number: vehicle.number || entry.number,
      vin: vehicle.vin || entry.vin,
      licensePlate: vehicle.license_plate_number || entry.license_plate_number || null,
      lat: loc.lat != null ? parseFloat(loc.lat) : null,
      lng: (loc.lon != null || loc.lng != null) ? parseFloat(loc.lon || loc.lng) : null,
      speed: loc.speed != null ? parseFloat(loc.speed) : null,
      bearing: loc.bearing != null ? parseFloat(loc.bearing) : null,
      engineStatus: loc.engine_status || (loc.type === 'vehicle_moving' ? 'on' : loc.type === 'vehicle_stopped' ? 'off' : null),
      locatedAt: loc.located_at || null,
      description: loc.description || '',
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

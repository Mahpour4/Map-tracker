// Motive (formerly KeepTruckin) Fleet API Service
//
// In development, requests go through the Vite proxy (/api/motive -> api.gomotive.com)
// to bypass CORS. In production, set a custom base URL or CORS proxy.
const TOKEN_KEY = 'motive_api_key';
const BASE_URL_KEY = 'motive_base_url';
const CORS_PROXY_KEY = 'motive_cors_proxy';

// Use Vite dev proxy by default to avoid CORS issues
const DEFAULT_BASE_URL = '/api/motive/v1';

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
  return localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE_URL;
}

export function setMotiveBaseUrl(url) {
  if (url && url.trim() && url.trim() !== DEFAULT_BASE_URL) {
    localStorage.setItem(BASE_URL_KEY, url.trim());
  } else {
    // Use default proxy path
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

async function motiveFetch(path, params = {}) {
  const apiKey = getMotiveApiKey();
  if (!apiKey) throw new Error('Motive API key not configured');

  const baseUrl = getMotiveBaseUrl();
  const isRelative = baseUrl.startsWith('/');

  // Build URL - relative paths (proxy) use string concat, absolute use URL constructor
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

    // Apply CORS proxy if configured (only for absolute URLs)
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

    const pagination = data.pagination;
    if (!pagination || pageNo >= (pagination.total_pages || 1) || items.length === 0) {
      hasMore = false;
    }
    pageNo++;
  }

  return allItems;
}

// ---- Public API functions ----

export async function fetchVehicles() {
  const raw = await fetchAllPages('/vehicles', 'vehicles');
  console.log('[Motive] Raw vehicles response (' + raw.length + ' items):', raw.slice(0, 2));
  return raw.map(v => v.vehicle || v);
}

export async function fetchVehicleLocations() {
  const raw = await fetchAllPages('/vehicle_locations', 'vehicle_locations');
  console.log('[Motive] Raw vehicle_locations (' + raw.length + ' items):', raw.slice(0, 2));
  const mapped = raw.map(vl => {
    const vehicle = vl.vehicle || {};
    const loc = vl.last_known_location || vl.current_location || {};
    return {
      id: vehicle.id,
      number: vehicle.number,
      vin: vehicle.vin,
      licensePlate: vehicle.license_plate_number,
      lat: loc.lat ? parseFloat(loc.lat) : null,
      lng: loc.lon ? parseFloat(loc.lon) : null,
      speed: loc.speed != null ? parseFloat(loc.speed) : null,
      bearing: loc.bearing != null ? parseFloat(loc.bearing) : null,
      engineStatus: loc.engine_status || null,
      locatedAt: loc.located_at || null,
      description: loc.description || '',
    };
  });
  console.log('[Motive] Parsed locations:', mapped.map(m => ({ vin: m.vin, plate: m.licensePlate, lat: m.lat })));
  return mapped;
}

export async function fetchDrivers() {
  const raw = await fetchAllPages('/drivers', 'drivers');
  console.log('[Motive] Raw drivers (' + raw.length + ' items):', raw.slice(0, 2));
  return raw.map(d => d.driver || d);
}

export async function testMotiveConnection() {
  try {
    await motiveFetch('/vehicles', { per_page: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

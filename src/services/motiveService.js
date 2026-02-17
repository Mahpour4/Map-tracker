// Motive (formerly KeepTruckin) Fleet API Service
const TOKEN_KEY = 'motive_api_key';
const BASE_URL_KEY = 'motive_base_url';
const CORS_PROXY_KEY = 'motive_cors_proxy';
const DEFAULT_BASE_URL = 'https://api.gomotive.com/v1';

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
  localStorage.setItem(BASE_URL_KEY, url.trim());
}

export function getCorsProxy() {
  return localStorage.getItem(CORS_PROXY_KEY) || '';
}

export function setCorsProxy(proxy) {
  if (proxy.trim()) {
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
  const fullUrl = new URL(`${baseUrl}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      fullUrl.searchParams.set(k, String(v));
    }
  });

  let fetchUrl = fullUrl.toString();
  const proxy = getCorsProxy();
  if (proxy) {
    fetchUrl = `${proxy}${encodeURIComponent(fetchUrl)}`;
  }

  const res = await fetch(fetchUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (res.status === 401) {
    throw new Error('Invalid Motive API key or unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_message || `Motive API error: ${res.status}`);
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
  const vehicles = await fetchAllPages('/vehicles', 'vehicles');
  return vehicles.map(v => v.vehicle || v);
}

export async function fetchVehicleLocations() {
  const locations = await fetchAllPages('/vehicle_locations', 'vehicle_locations');
  return locations.map(vl => {
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
}

export async function fetchDrivers() {
  const drivers = await fetchAllPages('/drivers', 'drivers');
  return drivers.map(d => d.driver || d);
}

export async function testMotiveConnection() {
  try {
    await motiveFetch('/vehicles', { per_page: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

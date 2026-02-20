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

  // Helper: append params supporting arrays (e.g. vehicle_ids[] = [1,2,3])
  function applyParams(searchParams, params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) {
        v.forEach(item => searchParams.append(k, String(item)));
      } else {
        searchParams.set(k, String(v));
      }
    });
  }

  let fetchUrl;
  if (isRelative) {
    const searchParams = new URLSearchParams();
    applyParams(searchParams, params);
    const qs = searchParams.toString();
    fetchUrl = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  } else {
    const fullUrl = new URL(`${baseUrl}${path}`);
    applyParams(fullUrl.searchParams, params);
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
  // Motive SDK: fetchAListOfAllTheVehiclesAndTheirLocations
  // GET /v3/vehicle_locations → { vehicles: [{ vehicle: { ..., current_location: {...}, current_driver: {...} } }] }
  const raw = await fetchAllPages('/v3/vehicle_locations', 'vehicles');
  console.log('[Motive] Raw v3 vehicles with locations (' + raw.length + ' items)');
  if (raw.length > 0) {
    console.log('[Motive] Sample item [0]:', JSON.stringify(raw[0], null, 2));
  }

  const mapped = raw.map(vl => {
    const vehicle = vl.vehicle || vl;
    const loc = vehicle.current_location || {};
    const driver = vehicle.current_driver || {};

    // Handle both v1-style (speed in mph, type) and v3-list-style (kph, vehicle_state)
    let speed = null;
    if (loc.speed != null) speed = parseFloat(loc.speed);            // v1/v3-detail: mph
    else if (loc.kph != null) speed = parseFloat(loc.kph) * 0.621371; // v3-list: kph→mph

    // Engine: v3-list uses vehicle_state ("on"/"off"), v1 uses type ("vehicle_moving"/"vehicle_stopped")
    let engineStatus = null;
    if (loc.vehicle_state) engineStatus = loc.vehicle_state;
    else if (loc.type === 'vehicle_moving') engineStatus = 'on';
    else if (loc.type === 'vehicle_stopped') engineStatus = 'off';
    else if (loc.type) engineStatus = loc.type;

    // Location text: v1 has description, v3-list has city/state/current_location (string)
    let description = loc.description || '';
    if (!description && typeof loc.current_location === 'string') description = loc.current_location;
    if (!description) description = [loc.city, loc.state].filter(Boolean).join(', ');

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
      speed,
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

/**
 * Fetch location history for a single vehicle over a date range.
 * GET /v3/vehicle_locations/:id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&updated_after=...
 * Returns array of location breadcrumbs sorted by time.
 */
export async function fetchVehicleLocationHistory(motiveId, startDate, endDate) {
  if (!motiveId) throw new Error('Vehicle Motive ID is required');
  // updated_after is required by the API — use start of the start_date
  const updatedAfter = `${startDate}T00:00:00Z`;
  const raw = await fetchAllPages(
    `/v3/vehicle_locations/${motiveId}`,
    'vehicle_locations',
    { start_date: startDate, end_date: endDate, updated_after: updatedAfter }
  );
  console.log(`[Motive] Location history for vehicle ${motiveId}: ${raw.length} breadcrumbs`);
  if (raw.length > 0) {
    console.log(`[Motive] Raw breadcrumb sample [0]:`, JSON.stringify(raw[0], null, 2));
    console.log(`[Motive] Raw breadcrumb keys [0]:`, Object.keys(raw[0]));
  }
  // v3 detail endpoint may wrap items: { vehicle_location: { lat, lon, located_at, ... } }
  return raw.map(item => {
    const loc = item.vehicle_location || item;
    return {
      lat: loc.lat != null ? parseFloat(loc.lat) : null,
      lng: loc.lon != null ? parseFloat(loc.lon) : null,
      time: loc.located_at || null,
      speed: loc.speed != null ? parseFloat(loc.speed) : null,
      description: loc.description || '',
      type: loc.type || null,
    };
  }).filter(loc => loc.lat != null && loc.lng != null && loc.time)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Fetch driving periods for vehicles over a date range.
 * GET /v1/driving_periods
 * Returns driving segments with origin/destination coords, driver info, duration, and distance.
 *
 * @param {Object} opts
 * @param {string[]} [opts.vehicleIds] - Motive vehicle IDs to filter by
 * @param {string} [opts.startDate] - YYYY-MM-DD (default: 7 days ago)
 * @param {string} [opts.endDate] - YYYY-MM-DD (default: today)
 * @param {string} [opts.status] - 'in_progress', 'complete', 'interrupted'
 * @returns {Array} Parsed driving periods
 */
export async function fetchDrivingPeriods(opts = {}) {
  const params = { per_page: 25 };
  if (opts.startDate) params.start_date = opts.startDate;
  if (opts.endDate) params.end_date = opts.endDate;
  if (opts.status) params.status = opts.status;

  // vehicle_ids[] as repeated query params (now handled natively by motiveFetch)
  if (opts.vehicleIds && opts.vehicleIds.length > 0) {
    params['vehicle_ids[]'] = opts.vehicleIds;
  }

  const raw = await fetchAllPages('/v1/driving_periods', 'driving_periods', params);
  console.log(`[Motive] Driving periods: ${raw.length} total`);

  return raw.map(dp => {
    const period = dp.driving_period || dp;
    const driver = period.driver || {};
    const vehicle = period.vehicle || {};

    return {
      id: period.id,
      startTime: period.start_time || null,
      endTime: period.end_time || null,
      duration: period.duration || 0,
      distance: period.distance ? parseFloat(period.distance) : 0,
      status: period.status || null,
      type: period.type || null,
      originLat: period.origin_lat != null ? parseFloat(period.origin_lat) : null,
      originLng: period.origin_lon != null ? parseFloat(period.origin_lon) : null,
      origin: period.origin || '',
      destinationLat: period.destination_lat != null ? parseFloat(period.destination_lat) : null,
      destinationLng: period.destination_lon != null ? parseFloat(period.destination_lon) : null,
      destination: period.destination || '',
      driverName: driver.first_name ? `${driver.first_name} ${driver.last_name || ''}`.trim() : null,
      driverId: driver.id || null,
      vehicleId: vehicle.id || null,
      vehicleNumber: vehicle.number || null,
      vehicleVin: vehicle.vin || null,
      startKm: period.start_kilometers || 0,
      endKm: period.end_kilometers || 0,
    };
  });
}

// ---- Motive Card API functions ----

/**
 * Fetch all Motive cards (card → driver/vehicle assignments).
 * GET /motive_card/v1/cards
 * Returns array of cards with entity assignment info.
 */
export async function fetchMotiveCards() {
  const raw = await fetchAllPages('/motive_card/v1/cards', 'cards');
  console.log(`[Motive] Cards: ${raw.length} total`);
  return raw.map(item => {
    const card = item.card || item;
    const assigned = card.assigned_to || {};
    return {
      cardId: card.id,
      last4: card.last_four_digits || card.last_four || card.last4 || '',
      status: card.status || null,
      entityType: assigned.entity_type || null,   // 'driver' | 'vehicle'
      entityId: assigned.entity_id || null,
      entityName: assigned.entity_name || null,
    };
  });
}

/**
 * Fetch card transactions (fuel purchases) over a date range.
 * GET /motive_card/v2/transactions
 * Note: uses page_number (not page_no) for pagination.
 */
export async function fetchCardTransactions(opts = {}) {
  const allItems = [];
  let pageNumber = 1;
  let hasMore = true;
  const perPage = 25;

  const params = {
    per_page: perPage,
    sort_direction: 'desc',
  };
  if (opts.startDate) params.start_date = opts.startDate;
  if (opts.endDate) params.end_date = opts.endDate;
  if (opts.status) params.status = opts.status;

  while (hasMore) {
    const data = await motiveFetch('/motive_card/v2/transactions', { ...params, page_number: pageNumber });
    const items = data.transactions || data.data || [];
    allItems.push(...items);

    const pagination = data.pagination || data;
    const total = pagination.total || 0;
    const totalPages = pagination.total_pages || Math.ceil(total / perPage);
    console.log(`[Motive] Card Transactions page ${pageNumber}: ${items.length} items (total: ${total})`);

    if (items.length === 0 || pageNumber >= totalPages) {
      hasMore = false;
    }
    pageNumber++;
  }

  // Deduplicate by transaction ID (API returns duplicates across pages)
  const uniqueMap = new Map();
  allItems.forEach(item => {
    const tx = item.transaction || item;
    if (tx.id && !uniqueMap.has(tx.id)) uniqueMap.set(tx.id, item);
  });
  const dedupedItems = [...uniqueMap.values()];
  console.log(`[Motive] Total card transactions fetched: ${dedupedItems.length} unique (${allItems.length} raw, ${allItems.length - dedupedItems.length} duplicates removed)`);

  return dedupedItems.map(item => {
    const tx = item.transaction || item;
    const meta = tx.pre_transaction_metadata || {};
    const orderItems = tx.order_items || [];

    // Sum fuel from order_items
    let totalGallons = 0;
    let totalAmount = 0;
    let fuelType = null;
    let pricePerGallon = null;

    let rebateAmount = 0;
    orderItems.forEach(oi => {
      const qty       = parseFloat(oi.quantity || 0);
      const unitPrice = parseFloat(oi.unit_price || 0);
      const lineTotal = parseFloat(oi.gross_amount || 0);   // actual API field
      if (qty > 0) totalGallons += qty;
      if (lineTotal > 0) totalAmount += lineTotal;
      rebateAmount += parseFloat(oi.rebate_amount || 0);
      if (!fuelType && oi.product_type) fuelType = oi.product_type;
      if (!pricePerGallon && unitPrice > 0) pricePerGallon = unitPrice;
    });

    // Pending transactions have empty order_items — fall back to top-level total
    if (totalAmount === 0 && tx.total_amount != null) totalAmount = parseFloat(tx.total_amount);
    if (rebateAmount === 0 && tx.total_rebate != null) rebateAmount = parseFloat(tx.total_rebate);

    const merchantInfo = tx.merchant_info || {};
    const odomRaw  = meta.odometer_reading != null ? parseFloat(meta.odometer_reading) : null;
    const odomUnit = meta.odometer_unit || 'mi';   // 'mi' or 'km'

    return {
      id: tx.id,
      cardId: tx.card_id || null,
      vehicleId: tx.vehicle_id != null ? String(tx.vehicle_id) : null,
      driverId: tx.driver_id || null,
      last4: tx.last_four_digits || '',
      merchantName: merchantInfo.name || tx.merchant_name || '',
      merchantCity: merchantInfo.city || tx.merchant_city || '',
      merchantState: (merchantInfo.state || tx.merchant_state || '').trim(),
      transactedAt: tx.transaction_time || tx.transacted_at || null,
      status: tx.transaction_status || tx.status || null,
      totalAmount,
      totalGallons,
      fuelType,
      pricePerGallon,
      odometerRaw: odomRaw,
      odometerUnit: odomUnit,
      rebateAmount,
      declined: (tx.transaction_status || tx.status) === 'declined' || !!tx.decline_reason,
    };
  });
}

export async function testMotiveConnection() {
  try {
    await motiveFetch('/v1/vehicles', { per_page: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

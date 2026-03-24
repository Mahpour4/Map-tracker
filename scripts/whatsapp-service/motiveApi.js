/**
 * Server-side Motive API client + OSRM routing for truck ETA.
 */
const https = require('https');

// Route → VIN lookup (from src/data/fleetData.js)
const FLEET = {
  '198': { vin: 'JALC4W169K7009926', model: '2019 ISUZU NPR HD' },
  '199': { vin: '1FTBW3X84RKB07820', model: '2024 FORD TRANSIT' },
  '200': { vin: 'JALC4W169G7003583', model: '2016 ISUZU NPR HD' },
  '201': { vin: '1FDBF6P86RKB32747', model: '2024 FORD TRANSIT' },
  '203': { vin: 'JALC4W163G7003949', model: '2016 ISUZU NPR HD' },
  '204': { vin: '1FDBF6P88RKB33138', model: '2024 FORD TRANSIT' },
  '206': { vin: 'JALC4W164G7001773', model: '2016 ISUZU NPR HD' },
  '207': { vin: '1FDBF6P84RKB46372', model: '2024 FORD TRANSIT' },
  '208': { vin: 'JALC4W167G7003596', model: '2016 ISUZU NPR HD' },
  '209': { vin: '1FDBF6P8XRKB46859', model: '2024 FORD TRANSIT' },
  '210': { vin: '1FDBF6P84RKB55153', model: '2024 FORD TRANSIT' },
  '211': { vin: 'JALC4W168H7001647', model: '2017 ISUZU NPR HD' },
};

// ── HTTPS JSON helper ─────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ── Motive API ────────────────────────────────────────────────────────────────

async function fetchVehicleLocations(apiKey) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `https://api.gomotive.com/v3/vehicle_locations?per_page=100&page_no=${page}`;
    const json = await httpsGet(url, { 'X-Api-Key': apiKey, 'Accept': 'application/json' });
    const items = json.vehicles || [];
    if (items.length === 0) break;

    for (const vl of items) {
      const v = vl.vehicle || vl;
      const loc = v.current_location || {};
      const driver = v.current_driver || {};

      let speed = null;
      if (loc.speed != null) speed = parseFloat(loc.speed);
      else if (loc.kph != null) speed = parseFloat(loc.kph) * 0.621371;

      let description = loc.description || '';
      if (!description && typeof loc.current_location === 'string') description = loc.current_location;
      if (!description) description = [loc.city, loc.state].filter(Boolean).join(', ');

      all.push({
        vin: v.vin || '',
        lat: loc.lat != null ? parseFloat(loc.lat) : null,
        lng: loc.lon != null ? parseFloat(loc.lon) : null,
        speed,
        description,
        driverName: driver.first_name ? `${driver.first_name} ${driver.last_name || ''}`.trim() : null,
        locatedAt: loc.located_at || null,
        engineStatus: loc.vehicle_state || null,
      });
    }

    if (!json.pagination || page >= (json.pagination.total_pages || 1)) break;
    page++;
  }
  return all;
}

// ── OSRM routing (free, no API key) ──────────────────────────────────────────

async function getOsrmRoute(fromLat, fromLng, toLat, toLng) {
  // OSRM expects lng,lat order
  const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
  const json = await httpsGet(url);
  if (!json.routes || json.routes.length === 0) return null;
  const route = json.routes[0];
  return {
    distanceMeters: route.distance,   // meters
    distanceMiles: (route.distance / 1609.34).toFixed(1),
    durationSeconds: route.duration,  // seconds
    durationText: formatDuration(route.duration),
  };
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── Main entry: get route truck ETA ──────────────────────────────────────────

async function getRouteETA(apiKey, routeNumber, destLat, destLng) {
  const fleet = FLEET[routeNumber];
  if (!fleet) return { error: `No vehicle assigned to Route ${routeNumber}` };
  if (!apiKey) return { error: 'Motive API key not configured' };

  const vehicles = await fetchVehicleLocations(apiKey);
  const vehicle = vehicles.find(v => v.vin === fleet.vin);
  if (!vehicle) return { error: `Vehicle for Route ${routeNumber} not found in Motive` };
  if (vehicle.lat == null || vehicle.lng == null) return { error: 'Vehicle location unavailable' };

  let route = null;
  try {
    route = await getOsrmRoute(vehicle.lat, vehicle.lng, destLat, destLng);
  } catch (e) {
    console.error('[MotiveApi] OSRM error:', e.message);
  }

  return {
    routeNumber,
    model: fleet.model,
    description: vehicle.description || 'Unknown location',
    driverName: vehicle.driverName,
    speed: vehicle.speed,
    engineStatus: vehicle.engineStatus,
    locatedAt: vehicle.locatedAt,
    lat: vehicle.lat,
    lng: vehicle.lng,
    route, // { distanceMiles, durationText } or null
  };
}

module.exports = { getRouteETA, FLEET };

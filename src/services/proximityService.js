import { haversineDistance } from '../utils/geoUtils';

// Chain stores get 250m (~820ft) radius; independent/cash stores get 50m (~165ft)
const CHAIN_TYPES = new Set([
  'food-lion', 'shoppers', 'wegmans', 'walmart', 'giant-martins',
  'weis', 'redners', 'acme', 'geresbecks', 'military',
]);
const CHAIN_RADIUS_M = 250;
const INDEPENDENT_RADIUS_M = 50;
const WAREHOUSE_RADIUS_M = 250;
const MIN_DWELL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get the proximity radius for a store based on its type.
 */
export function getProximityRadius(storeType) {
  if (!storeType) return INDEPENDENT_RADIUS_M;
  return CHAIN_TYPES.has(storeType.toLowerCase()) ? CHAIN_RADIUS_M : INDEPENDENT_RADIUS_M;
}

/**
 * Analyze a vehicle's location history breadcrumbs to find dwell-based visits.
 *
 * A "visit" is when the vehicle stays within the proximity radius of a known
 * location for >= 10 minutes (not necessarily continuous, just total time
 * within radius during a contiguous period).
 *
 * @param {Array} breadcrumbs - Sorted by time: [{ lat, lng, time, speed, description }]
 * @param {Array} stores - Store list with lat, lng, type, routeNumber
 * @param {Array} warehouses - Warehouse list with lat, lng
 * @param {string} vehicleRouteNumber - The route number assigned to this vehicle
 * @returns {Array} Detected visits: [{ type, locationId, locationName, lat, lng, arrivalTime, departureTime, dwellMinutes }]
 */
export function analyzeLocationHistory(breadcrumbs, stores, warehouses, vehicleRouteNumber) {
  if (!breadcrumbs || breadcrumbs.length === 0) return [];

  // Only check stores on this vehicle's assigned route
  const routeStores = stores.filter(s => {
    if (!s.routeNumber || !vehicleRouteNumber) return false;
    return String(s.routeNumber) === String(vehicleRouteNumber);
  });

  // Build a list of all known locations to check against
  const locations = [];

  routeStores.forEach(s => {
    if (s.lat == null || s.lng == null) return;
    if (s._fallbackCoords) return; // skip imprecise coordinates
    locations.push({
      type: 'store',
      id: s.id,
      name: s.name || `Store ${s.storeNumber || s.id}`,
      lat: s.lat,
      lng: s.lng,
      radius: getProximityRadius(s.type),
    });
  });

  warehouses.forEach(wh => {
    if (wh.lat == null || wh.lng == null) return;
    locations.push({
      type: 'warehouse',
      id: wh.id,
      name: wh.name,
      lat: wh.lat,
      lng: wh.lng,
      radius: WAREHOUSE_RADIUS_M,
    });
  });

  if (locations.length === 0) return [];

  // For each breadcrumb, find which location (if any) it's near
  const visits = [];
  let currentLocation = null;
  let arrivalTime = null;
  let lastInRangeTime = null;

  for (const bc of breadcrumbs) {
    let nearestLoc = null;
    let nearestDist = Infinity;

    for (const loc of locations) {
      const dist = haversineDistance(bc.lat, bc.lng, loc.lat, loc.lng);
      if (dist <= loc.radius && dist < nearestDist) {
        nearestLoc = loc;
        nearestDist = dist;
      }
    }

    const bcTime = new Date(bc.time).getTime();

    if (nearestLoc) {
      if (!currentLocation || currentLocation.id !== nearestLoc.id) {
        // Entering a new location — finalize the previous one if dwell was long enough
        if (currentLocation && lastInRangeTime && arrivalTime) {
          const dwell = lastInRangeTime - arrivalTime;
          if (dwell >= MIN_DWELL_MS) {
            visits.push({
              type: currentLocation.type,
              locationId: currentLocation.id,
              locationName: currentLocation.name,
              lat: currentLocation.lat,
              lng: currentLocation.lng,
              arrivalTime: new Date(arrivalTime).toISOString(),
              departureTime: new Date(lastInRangeTime).toISOString(),
              dwellMinutes: Math.round(dwell / 60000),
            });
          }
        }
        // Start tracking the new location
        currentLocation = nearestLoc;
        arrivalTime = bcTime;
        lastInRangeTime = bcTime;
      } else {
        // Still at the same location
        lastInRangeTime = bcTime;
      }
    } else {
      // Left any known location — finalize if dwell was long enough
      if (currentLocation && lastInRangeTime && arrivalTime) {
        const dwell = lastInRangeTime - arrivalTime;
        if (dwell >= MIN_DWELL_MS) {
          visits.push({
            type: currentLocation.type,
            locationId: currentLocation.id,
            locationName: currentLocation.name,
            lat: currentLocation.lat,
            lng: currentLocation.lng,
            arrivalTime: new Date(arrivalTime).toISOString(),
            departureTime: new Date(lastInRangeTime).toISOString(),
            dwellMinutes: Math.round(dwell / 60000),
          });
        }
      }
      currentLocation = null;
      arrivalTime = null;
      lastInRangeTime = null;
    }
  }

  // Finalize the last location if still in range
  if (currentLocation && lastInRangeTime && arrivalTime) {
    const dwell = lastInRangeTime - arrivalTime;
    if (dwell >= MIN_DWELL_MS) {
      visits.push({
        type: currentLocation.type,
        locationId: currentLocation.id,
        locationName: currentLocation.name,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        arrivalTime: new Date(arrivalTime).toISOString(),
        departureTime: new Date(lastInRangeTime).toISOString(),
        dwellMinutes: Math.round(dwell / 60000),
      });
    }
  }

  return visits;
}

/**
 * Real-time proximity snapshot (used during live polling).
 * Simpler version: checks current position against route stores + warehouses.
 * No dwell time required — just flags which vehicles are currently near a location.
 */
export function detectCurrentProximity(vehicles, stores, warehouses) {
  const results = [];

  for (const v of vehicles) {
    if (v.lat == null || v.lng == null) continue;
    const routeNumber = v.routeNumber;

    // Check route-matched stores
    for (const store of stores) {
      if (store.lat == null || store.lng == null) continue;
      if (store._fallbackCoords) continue;
      if (String(store.routeNumber) !== String(routeNumber)) continue;

      const radius = getProximityRadius(store.type);
      const dist = haversineDistance(v.lat, v.lng, store.lat, store.lng);
      if (dist <= radius) {
        results.push({
          vehicleId: v.vehicleId,
          vehicleVin: v.vin,
          type: 'store',
          locationId: store.id,
          locationName: store.name || `Store ${store.storeNumber || store.id}`,
          lat: store.lat,
          lng: store.lng,
          distance: Math.round(dist),
          time: new Date().toISOString(),
        });
        break; // one store per vehicle
      }
    }

    // Check all warehouses (not route-restricted)
    for (const wh of warehouses) {
      if (wh.lat == null || wh.lng == null) continue;
      const dist = haversineDistance(v.lat, v.lng, wh.lat, wh.lng);
      if (dist <= WAREHOUSE_RADIUS_M) {
        results.push({
          vehicleId: v.vehicleId,
          vehicleVin: v.vin,
          type: 'warehouse',
          locationId: wh.id,
          locationName: wh.name,
          lat: wh.lat,
          lng: wh.lng,
          distance: Math.round(dist),
          time: new Date().toISOString(),
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Deduplicate: filter out visits already logged today for this vehicle+location combo.
 */
export function filterNewVisits(visits, travelLog) {
  const today = localDateStr();
  const todayLog = travelLog[today] || {};

  return visits.filter(visit => {
    const vehicleEntries = todayLog[visit.vehicleVin] || [];
    return !vehicleEntries.some(e => e.locationId === visit.locationId);
  });
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

import { haversineDistance } from '../utils/geoUtils';

// Chain stores get 805m (~0.5 mi) radius; independent/cash stores get 200m (~650ft)
const CHAIN_TYPES = new Set([
  'food-lion', 'shoppers', 'shoprite', 'wegmans', 'walmart', 'giant-martins',
  'weis', 'redners', 'acme', 'geresbecks', 'military',
]);
const CHAIN_RADIUS_M = 805;
const INDEPENDENT_RADIUS_M = 400;
const WAREHOUSE_RADIUS_M = 500;
const CUSTOM_LOCATION_RADIUS_M = 500;
const MIN_DWELL_MS = 5 * 60 * 1000; // 5 minutes

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
 * location for >= 5 minutes (not necessarily continuous, just total time
 * within radius during a contiguous period).
 *
 * @param {Array} breadcrumbs - Sorted by time: [{ lat, lng, time, speed, description }]
 * @param {Array} stores - Store list with lat, lng, type, routeNumber
 * @param {Array} warehouses - Warehouse list with lat, lng
 * @param {string} vehicleRouteNumber - The route number assigned to this vehicle
 * @param {Array} [customLocations] - Custom locations (gas stations, storage, etc.) with lat, lng, type
 * @returns {Array} Detected visits: [{ type, locationId, locationName, lat, lng, arrivalTime, departureTime, dwellMinutes }]
 */
export function analyzeLocationHistory(breadcrumbs, stores, warehouses, vehicleRouteNumber, customLocations = []) {
  if (!breadcrumbs || breadcrumbs.length === 0) return [];

  // Debug: show what we're comparing
  const sampleRouteNumbers = [...new Set(stores.map(s => s.routeNumber).filter(Boolean))].slice(0, 10);
  console.log(`[Proximity] Vehicle route: "${vehicleRouteNumber}" | Store route numbers sample: [${sampleRouteNumbers.join(', ')}] | Total stores: ${stores.length}`);

  // Only check stores on this vehicle's assigned route
  const routeStores = stores.filter(s => {
    if (!s.routeNumber || !vehicleRouteNumber) return false;
    return String(s.routeNumber).trim() === String(vehicleRouteNumber).trim();
  });

  console.log(`[Proximity] Route ${vehicleRouteNumber}: ${routeStores.length} stores matched out of ${stores.length} total`);

  // Build a list of all known locations to check against
  const locations = [];

  routeStores.forEach(s => {
    if (s.lat == null || s.lng == null) return;
    // Skip fallback coords only if explicitly flagged (currently not used)
    if (s._fallbackCoords) return;
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

  // Custom locations (gas stations, storage, meeting points, driver homes, etc.)
  customLocations.forEach(cl => {
    if (cl.lat == null || cl.lng == null) return;
    locations.push({
      type: cl.type || 'custom',
      id: cl.id,
      name: cl.name,
      lat: cl.lat,
      lng: cl.lng,
      radius: CUSTOM_LOCATION_RADIUS_M,
    });
  });

  const customCount = customLocations.filter(cl => cl.lat != null && cl.lng != null).length;
  console.log(`[Proximity] Route ${vehicleRouteNumber}: ${locations.length} locations to check (${locations.filter(l => l.type === 'store').length} stores, ${locations.filter(l => l.type === 'warehouse').length} warehouses, ${customCount} custom)`);
  if (locations.length === 0) return [];

  // Track closest approach for diagnostics
  let globalMinDist = Infinity;
  let globalMinLoc = null;

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
      if (dist < globalMinDist) {
        globalMinDist = dist;
        globalMinLoc = loc;
      }
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

  // Diagnostic: log closest approach
  if (globalMinLoc) {
    console.log(`[Proximity] Route ${vehicleRouteNumber}: closest approach = ${Math.round(globalMinDist)}m to "${globalMinLoc.name}" (radius: ${globalMinLoc.radius}m). ${visits.length} visits found.`);
  }

  return visits;
}

// Street type abbreviation map for address normalization
const STREET_ABBREVS = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd',
  drive: 'dr', lane: 'ln', court: 'ct', place: 'pl',
  circle: 'cir', highway: 'hwy', parkway: 'pkwy', way: 'wy',
};

function normalizeAddr(str) {
  if (!str) return '';
  let s = str.toLowerCase().split(',')[0]; // only street portion before city
  Object.entries(STREET_ABBREVS).forEach(([long, short]) => {
    s = s.replace(new RegExp(`\\b${long}\\b`, 'g'), short);
  });
  return s.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Backup address-string matching for driving period destinations.
 * Used when lat/lng proximity matching fails or coordinates are missing.
 *
 * @param {string} destinationStr - Motive driving period destination address
 * @param {Array} routeStores - Stores already filtered to the vehicle's route
 * @returns {{ store: Object, confidence: 'high'|'low' } | null}
 */
export function findAddressMatch(destinationStr, routeStores) {
  if (!destinationStr) return null;
  const normDest = normalizeAddr(destinationStr);
  const destParts = normDest.split(' ');
  const destNum = /^\d+$/.test(destParts[0]) ? destParts[0] : null;
  const destStreet = (destNum ? destParts.slice(1) : destParts).join(' ');

  let lowMatch = null;

  for (const store of routeStores) {
    if (!store.address) continue;
    const normStore = normalizeAddr(store.address);
    const storeParts = normStore.split(' ');
    const storeNum = /^\d+$/.test(storeParts[0]) ? storeParts[0] : null;
    const storeStreet = (storeNum ? storeParts.slice(1) : storeParts).join(' ');

    if (!destStreet || !storeStreet) continue;

    const destWords = destStreet.split(' ').filter(w => w.length > 2);
    const storeWords = storeStreet.split(' ').filter(w => w.length > 2);
    const overlap = destWords.filter(w => storeWords.includes(w));
    const streetMatches = overlap.length >= Math.min(2, Math.min(destWords.length, storeWords.length));

    if (destNum && storeNum && destNum === storeNum && streetMatches) {
      return { store, confidence: 'high' };
    }

    if (streetMatches && !lowMatch) {
      lowMatch = store;
    }
  }

  return lowMatch ? { store: lowMatch, confidence: 'low' } : null;
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

import { haversineDistance } from '../utils/geoUtils';

const PROXIMITY_RADIUS_M = 300; // ~1000 feet
const MAX_SPEED_MPH = 10;

/**
 * Check all vehicles against known locations (stores + warehouses).
 * Returns an array of detected visits:
 *   { vehicleId, vehicleVin, type: 'store'|'warehouse', locationId, locationName, lat, lng, time }
 *
 * Only includes vehicles that are slow/stopped (speed < MAX_SPEED_MPH) and
 * within PROXIMITY_RADIUS_M of a known location.
 */
export function detectProximityVisits(vehicles, stores, warehouses) {
  const visits = [];
  const now = new Date().toISOString();

  for (const v of vehicles) {
    // Must have GPS coordinates
    if (v.lat == null || v.lng == null) continue;

    // Speed filter: only when slow or stopped
    if (v.speed != null && v.speed > MAX_SPEED_MPH) continue;

    // Check against stores
    for (const store of stores) {
      if (store.lat == null || store.lng == null) continue;
      // Skip stores with obviously imprecise coordinates (city-level fallback)
      if (store._fallbackCoords) continue;

      const dist = haversineDistance(v.lat, v.lng, store.lat, store.lng);
      if (dist <= PROXIMITY_RADIUS_M) {
        visits.push({
          vehicleId: v.vehicleId,
          vehicleVin: v.vin,
          type: 'store',
          locationId: store.id,
          locationName: store.name || `Store ${store.storeNumber || store.id}`,
          lat: store.lat,
          lng: store.lng,
          distance: Math.round(dist),
          time: now,
        });
        break; // one store match per vehicle per poll is enough
      }
    }

    // Check against warehouses
    for (const wh of warehouses) {
      if (wh.lat == null || wh.lng == null) continue;

      const dist = haversineDistance(v.lat, v.lng, wh.lat, wh.lng);
      if (dist <= PROXIMITY_RADIUS_M) {
        visits.push({
          vehicleId: v.vehicleId,
          vehicleVin: v.vin,
          type: 'warehouse',
          locationId: wh.id,
          locationName: wh.name,
          lat: wh.lat,
          lng: wh.lng,
          distance: Math.round(dist),
          time: now,
        });
        break;
      }
    }
  }

  return visits;
}

/**
 * Deduplicate: filter out visits that have already been logged today for this vehicle+location combo.
 * travelLog format: { "YYYY-MM-DD": { "vehicleVin": [ { locationId, time, ... } ] } }
 */
export function filterNewVisits(visits, travelLog) {
  const today = localDateStr();
  const todayLog = travelLog[today] || {};

  return visits.filter(visit => {
    const vehicleEntries = todayLog[visit.vehicleVin] || [];
    // Already logged this location today for this vehicle?
    return !vehicleEntries.some(e => e.locationId === visit.locationId);
  });
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

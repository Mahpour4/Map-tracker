/**
 * Check if a point [lat, lng] is inside a polygon defined by bounds [[lat, lng], ...]
 * Uses ray-casting algorithm.
 */
export function isPointInPolygon(point, polygon) {
  const [y, x] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Auto-assign stores to zones/subzones based on their location.
 */
export function autoAssignStores(stores, zones) {
  return stores.map((store) => {
    const point = [store.lat, store.lng];
    let assignedZoneId = null;
    let assignedSubZoneId = null;

    for (const zone of zones) {
      if (isPointInPolygon(point, zone.bounds)) {
        assignedZoneId = zone.id;

        for (const subZone of zone.subZones) {
          if (isPointInPolygon(point, subZone.bounds)) {
            assignedSubZoneId = subZone.id;
            break;
          }
        }
        break;
      }
    }

    return {
      ...store,
      zoneId: assignedZoneId,
      subZoneId: assignedSubZoneId,
    };
  });
}

/**
 * Calculate the distance in meters between two lat/lng points using the Haversine formula.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Get the center point of a polygon.
 */
export function getPolygonCenter(bounds) {
  const latSum = bounds.reduce((sum, p) => sum + p[0], 0);
  const lngSum = bounds.reduce((sum, p) => sum + p[1], 0);
  return [latSum / bounds.length, lngSum / bounds.length];
}

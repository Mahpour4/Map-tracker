const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Geocode a street address via OpenStreetMap Nominatim (free, no API key).
 * Returns { lat, lng } or null if not found.
 */
export async function geocodeAddress(address, city, state, zip) {
  const q = [address, city, state, zip].filter(Boolean).join(', ');
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    countrycodes: 'us',
  })}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MapTrackerApp/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

/**
 * Batch-geocode an array of stores. Respects Nominatim 1-req/sec rate limit.
 * Calls onProgress(index, total) after each store.
 * Returns array of { id, lat, lng } for stores whose coords changed by > thresholdM.
 */
export async function batchGeocode(stores, onProgress, thresholdM = 500) {
  const { haversineDistance } = await import('./geoUtils');
  const updates = [];

  for (let i = 0; i < stores.length; i++) {
    const s = stores[i];
    if (onProgress) onProgress(i + 1, stores.length);

    const result = await geocodeAddress(s.address, s.city, s.state, s.zip);
    if (result) {
      const dist = (s.lat && s.lng)
        ? haversineDistance(s.lat, s.lng, result.lat, result.lng)
        : Infinity;
      if (dist > thresholdM) {
        updates.push({ id: s.id, lat: result.lat, lng: result.lng });
      }
    }

    // Respect rate limit (1 req/sec)
    if (i < stores.length - 1) await delay(1100);
  }

  return updates;
}

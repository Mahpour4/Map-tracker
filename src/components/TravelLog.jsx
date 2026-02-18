import { useState, useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import { fetchVehicleLocationHistory, fetchDrivingPeriods, isMotiveConnected } from '../services/motiveService';
import { analyzeLocationHistory } from '../services/proximityService';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Valid coords: must be in roughly US east coast range, not 0,0
function isValidCoord(lat, lng) {
  return lat != null && lng != null && Math.abs(lat) > 1 && Math.abs(lng) > 1;
}

// Clean garbled arrow encoding from old saved entries
function cleanLocationName(name) {
  if (!name) return name;
  // Match any run of 3+ characters in the Latin Extended / C1 Controls range
  // which is where garbled multi-byte UTF-8 arrows end up
  return name
    .replace(/\s*[\u00C0-\u00FF\u0080-\u009F]{3,}\s*/g, ' \u2192 ')
    .replace(/\s*\u2192\s*/g, ' \u2192 ')
    .trim();
}

// Auto-fit map bounds to points
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40] });
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [points, map]);
  return null;
}

// Create numbered marker icon
function createStopIcon(type, index) {
  const colors = { store: '#22c55e', warehouse: '#f59e0b', driving: '#3b82f6' };
  const color = colors[type] || '#6b7280';
  return L.divIcon({
    className: 'tl-map-marker',
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);">${index}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function TravelLog() {
  const { state, logTravelEntries, bulkRecordVisits } = useApp();
  const { travelLog, vehicleLocations, fleetVehicles, stores, warehouses } = state;

  const today = localDateStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);
  const [matchingEntry, setMatchingEntry] = useState(null);
  const [matchSearch, setMatchSearch] = useState('');

  // Get all dates that have log entries, sorted descending
  const availableDates = useMemo(() => {
    const dates = Object.keys(travelLog).sort().reverse();
    if (!dates.includes(today)) dates.unshift(today);
    return dates;
  }, [travelLog, today]);

  // Get vehicle list for filter
  const vehicleList = useMemo(() => {
    const source = vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles;
    return source.map(v => ({
      vin: v.vin,
      vehicleId: v.vehicleId,
      routeNumber: v.routeNumber || null,
      motiveId: v.motiveId || v.id || null,
      label: `Rt ${v.routeNumber || '?'} - ${v.vehicleId} (${v.vin?.slice(-6) || '?'})`,
    }));
  }, [vehicleLocations, fleetVehicles]);

  // Get entries for selected date, filtered by vehicle
  const dayEntries = useMemo(() => {
    const dayLog = travelLog[selectedDate] || {};
    const entries = [];

    Object.entries(dayLog).forEach(([vin, stops]) => {
      if (selectedVehicle !== 'all' && vin !== selectedVehicle) return;
      const vehicle = vehicleList.find(v => v.vin === vin);
      stops.forEach(stop => {
        entries.push({
          ...stop,
          vehicleVin: vin,
          vehicleLabel: vehicle?.label || vin,
          vehicleId: vehicle?.vehicleId || '',
        });
      });
    });

    entries.sort((a, b) => (a.arrivalTime || a.time || '').localeCompare(b.arrivalTime || b.time || ''));
    return entries;
  }, [travelLog, selectedDate, selectedVehicle, vehicleList]);

  // Summary stats — NOW FILTERED by selected vehicle
  const stats = useMemo(() => {
    const dayLog = travelLog[selectedDate] || {};
    let vehicleCount = 0;
    let storeVisits = 0;
    let warehouseVisits = 0;
    let drivingSegments = 0;
    Object.entries(dayLog).forEach(([vin, stops]) => {
      if (selectedVehicle !== 'all' && vin !== selectedVehicle) return;
      vehicleCount++;
      stops.forEach(s => {
        if (s.type === 'store') storeVisits++;
        else if (s.type === 'warehouse') warehouseVisits++;
        else if (s.type === 'driving') drivingSegments++;
      });
    });
    return { vehicleCount, storeVisits, warehouseVisits, drivingSegments, total: storeVisits + warehouseVisits };
  }, [travelLog, selectedDate, selectedVehicle]);

  // Map-eligible entries (valid coordinates only, no 0,0)
  const mapEntries = useMemo(() => {
    return dayEntries.filter(e => isValidCoord(e.lat, e.lng));
  }, [dayEntries]);

  const mapPoints = useMemo(() => {
    return mapEntries.map(e => [e.lat, e.lng]);
  }, [mapEntries]);

  // ---- Process Day ----
  const handleProcessDay = useCallback(async () => {
    if (!isMotiveConnected()) {
      setProcessStatus({ message: 'Motive API not connected. Go to Fleet Tracker to connect.', type: 'error' });
      return;
    }

    const allWithMotive = vehicleList.filter(v => v.motiveId);
    const vehiclesWithMotiveId = selectedVehicle === 'all'
      ? allWithMotive
      : allWithMotive.filter(v => v.vin === selectedVehicle);
    if (vehiclesWithMotiveId.length === 0) {
      setProcessStatus({ message: 'No vehicles with Motive IDs found. Refresh Fleet Tracker first to get vehicle data.', type: 'error' });
      return;
    }

    setProcessing(true);
    const label = selectedVehicle === 'all'
      ? `${vehiclesWithMotiveId.length} vehicles`
      : vehiclesWithMotiveId[0]?.label || 'selected vehicle';
    setProcessStatus({ message: `Processing ${label} for ${selectedDate}...`, type: 'info' });

    let totalVisits = 0;
    let drivingCount = 0;
    let processedCount = 0;
    const errors = [];

    // Log stores info once for debugging
    console.log(`[TravelLog] Stores in context: ${stores.length}, sample routeNumbers:`, [...new Set(stores.slice(0, 20).map(s => s.routeNumber))]);

    // Fetch ALL driving periods for the date in one call (no vehicle filter —
    // the Motive API silently returns empty when vehicle_ids[] is passed).
    let allDrivingPeriods = [];
    try {
      allDrivingPeriods = await fetchDrivingPeriods({
        startDate: selectedDate,
        endDate: selectedDate,
      });
      console.log(`[TravelLog] Fetched ${allDrivingPeriods.length} total driving periods for ${selectedDate}`);
    } catch (err) {
      console.error('[TravelLog] Error fetching driving periods:', err);
      errors.push(`Driving periods: ${err.message}`);
    }

    for (const vehicle of vehiclesWithMotiveId) {
      try {
        setProcessStatus({
          message: `Processing ${vehicle.label} (${processedCount + 1}/${vehiclesWithMotiveId.length})...`,
          type: 'info',
        });

        // Fetch breadcrumbs for this vehicle
        let breadcrumbs = [];
        try {
          breadcrumbs = await fetchVehicleLocationHistory(vehicle.motiveId, selectedDate, selectedDate);
        } catch (err) {
          console.error(`[TravelLog] Breadcrumb error for ${vehicle.label}:`, err);
          errors.push(`${vehicle.label} breadcrumbs: ${err.message}`);
        }

        // Filter driving periods for this vehicle by motiveId or VIN
        const periods = allDrivingPeriods.filter(dp =>
          String(dp.vehicleId) === String(vehicle.motiveId) ||
          (dp.vehicleVin && dp.vehicleVin === vehicle.vin)
        );

        console.log(`[TravelLog] ${vehicle.label}: ${breadcrumbs.length} breadcrumbs, ${periods.length} driving periods (motiveId=${vehicle.motiveId}, vin=${vehicle.vin})`);

        // Store visits from breadcrumbs
        if (breadcrumbs.length > 0) {
          const visits = analyzeLocationHistory(breadcrumbs, stores, warehouses, vehicle.routeNumber);
          console.log(`[TravelLog] ${vehicle.label}: ${visits.length} visits detected`);

          if (visits.length > 0) {
            const travelEntries = visits.map(v => ({
              vehicleVin: vehicle.vin,
              vehicleId: vehicle.vehicleId,
              type: v.type,
              locationId: v.locationId,
              locationName: v.locationName,
              lat: v.lat,
              lng: v.lng,
              time: v.arrivalTime,
              arrivalTime: v.arrivalTime,
              departureTime: v.departureTime,
              dwellMinutes: v.dwellMinutes,
            }));

            logTravelEntries(travelEntries);

            const storeVisitEntries = visits
              .filter(v => v.type === 'store')
              .map(v => ({ storeId: v.locationId, date: selectedDate }));
            if (storeVisitEntries.length > 0) {
              bulkRecordVisits(storeVisitEntries);
            }

            totalVisits += visits.length;
          }
        }

        // Driving periods for this vehicle
        if (periods.length > 0) {
          const drivingEntries = periods.map(dp => ({
            vehicleVin: vehicle.vin,
            vehicleId: vehicle.vehicleId,
            type: 'driving',
            locationId: `driving-${dp.id}`,
            locationName: `${dp.origin || 'Unknown'} \u2192 ${dp.destination || 'Unknown'}`,
            lat: dp.originLat,
            lng: dp.originLng,
            time: dp.startTime,
            arrivalTime: dp.startTime,
            departureTime: dp.endTime,
            dwellMinutes: Math.round((dp.duration || 0) / 60),
            distance: dp.distance,
            driverName: dp.driverName,
            destinationLat: dp.destinationLat,
            destinationLng: dp.destinationLng,
            destination: dp.destination || '',
          }));

          logTravelEntries(drivingEntries);
          drivingCount += drivingEntries.length;
        }
      } catch (err) {
        console.error(`[TravelLog] Error processing ${vehicle.label}:`, err);
        errors.push(`${vehicle.label}: ${err.message}`);
      }

      processedCount++;

      if (processedCount < vehiclesWithMotiveId.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setProcessing(false);

    if (errors.length > 0) {
      setProcessStatus({
        message: `Done. ${totalVisits} visits + ${drivingCount} driving segments across ${processedCount - errors.length} vehicles. ${errors.length} errors: ${errors.join('; ')}`,
        type: 'error',
      });
    } else {
      setProcessStatus({
        message: `Done! ${totalVisits} visits + ${drivingCount} driving segments across ${processedCount} vehicles for ${selectedDate}.`,
        type: 'success',
      });
    }
  }, [vehicleList, selectedVehicle, selectedDate, stores, warehouses, logTravelEntries, bulkRecordVisits]);

  // --- Manual store matching ---
  const matchCandidates = useMemo(() => {
    if (!matchingEntry) return [];
    const vehicle = vehicleList.find(v => v.vin === matchingEntry.vehicleVin);
    const routeNum = vehicle?.routeNumber;
    // Filter to route-matched stores
    let candidates = stores.filter(s =>
      routeNum && String(s.routeNumber).trim() === String(routeNum).trim()
    );
    // Text search filter
    if (matchSearch.trim()) {
      const q = matchSearch.toLowerCase();
      candidates = candidates.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q) ||
        (s.id || '').toLowerCase().includes(q)
      );
    }
    // Sort by address similarity to the destination text
    const dest = (matchingEntry.destination || '').toLowerCase();
    if (dest) {
      candidates = candidates.slice().sort((a, b) => {
        const aAddr = (a.address || '').toLowerCase();
        const bAddr = (b.address || '').toLowerCase();
        // Prioritize stores whose address shares a common prefix with destination
        const aMatch = dest.includes(aAddr.split(' ')[0]) || aAddr.includes(dest.split(',')[0].split(' ')[0]);
        const bMatch = dest.includes(bAddr.split(' ')[0]) || bAddr.includes(dest.split(',')[0].split(' ')[0]);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    return candidates;
  }, [matchingEntry, matchSearch, stores, vehicleList]);

  const handleMatchStore = useCallback((store) => {
    if (!matchingEntry) return;
    // Create a store visit entry
    logTravelEntries([{
      vehicleVin: matchingEntry.vehicleVin,
      vehicleId: matchingEntry.vehicleId,
      type: 'store',
      locationId: store.id,
      locationName: store.name,
      lat: store.lat,
      lng: store.lng,
      time: matchingEntry.departureTime || matchingEntry.arrivalTime || matchingEntry.time,
      arrivalTime: matchingEntry.departureTime || matchingEntry.arrivalTime,
      departureTime: matchingEntry.departureTime,
      dwellMinutes: null,
    }]);
    // Record the visit in visit history
    bulkRecordVisits([{ storeId: store.id, date: selectedDate }]);
    setMatchingEntry(null);
    setMatchSearch('');
  }, [matchingEntry, selectedDate, logTravelEntries, bulkRecordVisits]);

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h2>Travel Log</h2>
        <p className="tl-desc">
          Pull location history from Motive and detect store visits
          (10+ min dwell). Chain: 805m (~½ mi), Independent: 200m radius. Route-matched stores only.
        </p>
      </div>

      {/* Filters + Process Day */}
      <div className="tl-filters">
        <div className="tl-filter">
          <label>Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            max={today}
          />
        </div>
        <div className="tl-filter">
          <label>Vehicle</label>
          <select value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}>
            <option value="all">All Vehicles</option>
            {vehicleList.map(v => (
              <option key={v.vin} value={v.vin}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="tl-filter tl-filter-action">
          <label>&nbsp;</label>
          <button
            className="btn btn-primary"
            onClick={handleProcessDay}
            disabled={processing}
          >
            {processing ? 'Processing...' : `Process ${selectedDate === today ? 'Today' : selectedDate}`}
          </button>
        </div>
      </div>

      {/* Process status */}
      {processStatus && (
        <div className={`tl-status tl-status-${processStatus.type}`}>
          {processStatus.message}
        </div>
      )}

      {/* Stats */}
      <div className="tl-stats">
        <span className="tl-stat">{stats.vehicleCount} <span>Vehicles</span></span>
        <span className="tl-stat blue">{stats.storeVisits} <span>Store Visits</span></span>
        <span className="tl-stat orange">{stats.warehouseVisits} <span>Warehouse</span></span>
        <span className="tl-stat green">{stats.drivingSegments} <span>Driving</span></span>
        <span className="tl-stat">{stats.total} <span>Total Stops</span></span>
      </div>

      {/* Map */}
      {mapPoints.length > 0 && (
        <div className="tl-map-container">
          <MapContainer
            center={[39.3, -76.6]}
            zoom={10}
            style={{ height: '350px', width: '100%', borderRadius: '8px' }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={mapPoints} />
            {mapEntries.map((entry, i) => (
              <Marker
                key={`${entry.vehicleVin}-${entry.locationId}-${i}`}
                position={[entry.lat, entry.lng]}
                icon={createStopIcon(entry.type, i + 1)}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong>#{i + 1} {cleanLocationName(entry.locationName)}</strong><br />
                    <span style={{ textTransform: 'capitalize' }}>{entry.type}</span>
                    {entry.dwellMinutes != null && ` \u2022 ${entry.dwellMinutes} min`}
                    {entry.distance > 0 && ` \u2022 ${entry.distance} mi`}
                    {selectedVehicle === 'all' && entry.vehicleId && (
                      <><br /><em>{entry.vehicleId}</em></>
                    )}
                    {entry.arrivalTime && (
                      <><br />{new Date(entry.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {entry.departureTime && ` - ${new Date(entry.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* Timeline with index */}
      <div className="tl-timeline-scroll">
        <div className="tl-timeline">
          {dayEntries.length === 0 ? (
            <div className="tl-empty">
              {selectedDate === today
                ? 'No stops logged yet today. Click "Process Today" to pull location history from Motive and detect visits.'
                : `No travel log entries for ${selectedDate}. Click "Process ${selectedDate}" to analyze that day's data.`}
            </div>
          ) : (
            dayEntries.map((entry, i) => (
              <div key={`${entry.vehicleVin}-${entry.locationId}-${i}`} className={`tl-entry tl-${entry.type}`}>
                <div className="tl-entry-index">{i + 1}</div>
                <div className="tl-entry-time">
                  {entry.arrivalTime
                    ? new Date(entry.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : entry.time
                      ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '--:--'}
                </div>
                <div className="tl-entry-dot" />
                <div className="tl-entry-content">
                  <div className="tl-entry-name">
                    {entry.type === 'driving' ? (() => {
                      const parts = cleanLocationName(entry.locationName).split(' \u2192 ');
                      const origin = parts[0] || 'Unknown';
                      const dest = parts[1] || 'Unknown';
                      const originQ = (entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(origin);
                      const destQ = (entry.destinationLat && entry.destinationLng) ? `${entry.destinationLat},${entry.destinationLng}` : encodeURIComponent(dest);
                      return (
                        <>
                          <a href={`https://www.google.com/maps/search/?api=1&query=${originQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">{origin}</a>
                          {' \u2192 '}
                          <a href={`https://www.google.com/maps/search/?api=1&query=${destQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">{dest}</a>
                        </>
                      );
                    })() : (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${(entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(entry.locationName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tl-map-link"
                      >
                        {cleanLocationName(entry.locationName)}
                      </a>
                    )}
                  </div>
                  <div className="tl-entry-meta">
                    <span className={`tl-type-badge ${entry.type}`}>{entry.type}</span>
                    {selectedVehicle === 'all' && (
                      <span className="tl-entry-vehicle">{entry.vehicleId || entry.vehicleVin?.slice(-6)}</span>
                    )}
                    {entry.dwellMinutes != null && (
                      <span className="tl-entry-dwell">{entry.dwellMinutes} min</span>
                    )}
                    {entry.type === 'driving' && entry.distance > 0 && (
                      <span className="tl-entry-distance">{entry.distance} mi</span>
                    )}
                    {entry.type === 'driving' && entry.driverName && (
                      <span className="tl-entry-driver">{entry.driverName}</span>
                    )}
                    {entry.departureTime && entry.arrivalTime && (
                      <span className="tl-entry-timerange">
                        {new Date(entry.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(entry.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {entry.type === 'driving' && (
                      <button
                        className="tl-match-btn"
                        onClick={(e) => { e.stopPropagation(); setMatchingEntry(entry); setMatchSearch(''); }}
                      >
                        Match Store
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Manual Store Match Popup */}
      {matchingEntry && (
        <div className="tl-match-overlay" onClick={() => setMatchingEntry(null)}>
          <div className="tl-match-popup" onClick={e => e.stopPropagation()}>
            <div className="tl-match-header">
              <h3>Match to Store</h3>
              <button className="tl-match-close" onClick={() => setMatchingEntry(null)}>&times;</button>
            </div>
            <div className="tl-match-dest">
              <span className="tl-match-label">Motive Destination:</span>
              <span className="tl-match-addr">{matchingEntry.destination || matchingEntry.locationName?.split('\u2192')[1]?.trim() || 'Unknown'}</span>
            </div>
            <input
              className="tl-match-search"
              type="text"
              placeholder="Search stores by name, address, or ID..."
              value={matchSearch}
              onChange={e => setMatchSearch(e.target.value)}
              autoFocus
            />
            <div className="tl-match-list">
              {matchCandidates.length === 0 ? (
                <div className="tl-match-empty">No matching stores found for this route</div>
              ) : (
                matchCandidates.map(store => (
                  <div
                    key={store.id}
                    className="tl-match-item"
                    onClick={() => handleMatchStore(store)}
                  >
                    <div className="tl-match-store-name">{store.name}</div>
                    <div className="tl-match-store-addr">
                      {store.address}{store.city ? `, ${store.city}` : ''}{store.state ? `, ${store.state}` : ''} {store.zip || ''}
                    </div>
                    <div className="tl-match-store-id">{store.id}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

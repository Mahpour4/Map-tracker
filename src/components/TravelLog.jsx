import { useState, useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import { fetchVehicleLocationHistory, fetchDrivingPeriods, isMotiveConnected } from '../services/motiveService';
import { analyzeLocationHistory } from '../services/proximityService';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  // Map points from entries with coordinates
  const mapPoints = useMemo(() => {
    return dayEntries
      .filter(e => e.lat != null && e.lng != null)
      .map(e => [e.lat, e.lng]);
  }, [dayEntries]);

  // ---- Process Day ----
  const handleProcessDay = useCallback(async () => {
    if (!isMotiveConnected()) {
      setProcessStatus({ message: 'Motive API not connected. Go to Fleet Tracker to connect.', type: 'error' });
      return;
    }

    const vehiclesWithMotiveId = vehicleList.filter(v => v.motiveId);
    if (vehiclesWithMotiveId.length === 0) {
      setProcessStatus({ message: 'No vehicles with Motive IDs found. Refresh Fleet Tracker first to get vehicle data.', type: 'error' });
      return;
    }

    setProcessing(true);
    setProcessStatus({ message: `Processing ${vehiclesWithMotiveId.length} vehicles for ${selectedDate}...`, type: 'info' });

    let totalVisits = 0;
    let processedCount = 0;
    const errors = [];

    // Log stores info once for debugging
    console.log(`[TravelLog] Stores in context: ${stores.length}, sample routeNumbers:`, [...new Set(stores.slice(0, 20).map(s => s.routeNumber))]);

    for (const vehicle of vehiclesWithMotiveId) {
      try {
        setProcessStatus({
          message: `Processing ${vehicle.label} (${processedCount + 1}/${vehiclesWithMotiveId.length})...`,
          type: 'info',
        });

        const breadcrumbs = await fetchVehicleLocationHistory(
          vehicle.motiveId,
          selectedDate,
          selectedDate
        );

        console.log(`[TravelLog] ${vehicle.label}: ${breadcrumbs.length} breadcrumbs`);

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
      } catch (err) {
        console.error(`[TravelLog] Error processing ${vehicle.label}:`, err);
        errors.push(`${vehicle.label}: ${err.message}`);
      }

      processedCount++;

      if (processedCount < vehiclesWithMotiveId.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Fetch driving periods
    let drivingCount = 0;
    try {
      setProcessStatus({ message: 'Fetching driving periods...', type: 'info' });
      const motiveIds = vehiclesWithMotiveId.map(v => String(v.motiveId));
      const periods = await fetchDrivingPeriods({
        vehicleIds: motiveIds,
        startDate: selectedDate,
        endDate: selectedDate,
        status: 'complete',
      });

      if (periods.length > 0) {
        const drivingEntries = periods.map(dp => {
          const matchedVehicle = vehiclesWithMotiveId.find(v =>
            String(v.motiveId) === String(dp.vehicleId) ||
            (v.vin && dp.vehicleVin && v.vin.toUpperCase() === dp.vehicleVin.toUpperCase())
          );
          return {
            vehicleVin: matchedVehicle?.vin || dp.vehicleVin || '',
            vehicleId: matchedVehicle?.vehicleId || dp.vehicleNumber || '',
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
          };
        }).filter(e => e.vehicleVin);

        if (drivingEntries.length > 0) {
          logTravelEntries(drivingEntries);
          drivingCount = drivingEntries.length;
        }
      }
    } catch (err) {
      console.error('[TravelLog] Error fetching driving periods:', err);
      errors.push(`Driving periods: ${err.message}`);
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
  }, [vehicleList, selectedDate, stores, warehouses, logTravelEntries, bulkRecordVisits]);

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h2>Travel Log</h2>
        <p className="tl-desc">
          Pull location history from Motive and detect store visits
          (10+ min dwell). Chain: 500m, Independent: 200m radius. Route-matched stores only.
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
            {dayEntries.filter(e => e.lat != null && e.lng != null).map((entry, i) => (
              <Marker
                key={`${entry.vehicleVin}-${entry.locationId}-${i}`}
                position={[entry.lat, entry.lng]}
                icon={createStopIcon(entry.type, i + 1)}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong>#{i + 1} {entry.locationName}</strong><br />
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
                  <div className="tl-entry-name">{entry.locationName}</div>
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
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

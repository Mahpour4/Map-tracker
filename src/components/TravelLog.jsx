import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchVehicleLocationHistory, isMotiveConnected } from '../services/motiveService';
import { analyzeLocationHistory } from '../services/proximityService';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TravelLog() {
  const { state, logTravelEntries, bulkRecordVisits } = useApp();
  const { travelLog, vehicleLocations, fleetVehicles, stores, warehouses } = state;

  const today = localDateStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null); // { message, type: 'success'|'error'|'info' }

  // Get all dates that have log entries, sorted descending
  const availableDates = useMemo(() => {
    const dates = Object.keys(travelLog).sort().reverse();
    if (!dates.includes(today)) dates.unshift(today);
    return dates;
  }, [travelLog, today]);

  // Get vehicle list for filter — use merged data when available
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

  // Get entries for selected date, optionally filtered by vehicle
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

    // Sort chronologically by arrivalTime or time
    entries.sort((a, b) => (a.arrivalTime || a.time || '').localeCompare(b.arrivalTime || b.time || ''));
    return entries;
  }, [travelLog, selectedDate, selectedVehicle, vehicleList]);

  // Summary stats
  const stats = useMemo(() => {
    const dayLog = travelLog[selectedDate] || {};
    const vehicleCount = Object.keys(dayLog).length;
    let storeVisits = 0;
    let warehouseVisits = 0;
    Object.values(dayLog).forEach(stops => {
      stops.forEach(s => {
        if (s.type === 'store') storeVisits++;
        if (s.type === 'warehouse') warehouseVisits++;
      });
    });
    return { vehicleCount, storeVisits, warehouseVisits, total: storeVisits + warehouseVisits };
  }, [travelLog, selectedDate]);

  // ---- Process Day: pull location history for all vehicles and analyze ----
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

    // Process vehicles sequentially (API limit: 10 simultaneous)
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
          console.log(`[TravelLog] ${vehicle.label}: ${visits.length} visits detected (10min+ dwell)`);

          if (visits.length > 0) {
            // Convert to travel log entries format
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

            // Also log store visits to visitHistory for compliance
            const storeVisits = visits
              .filter(v => v.type === 'store')
              .map(v => ({ storeId: v.locationId, date: selectedDate }));
            if (storeVisits.length > 0) {
              bulkRecordVisits(storeVisits);
            }

            totalVisits += visits.length;
          }
        }
      } catch (err) {
        console.error(`[TravelLog] Error processing ${vehicle.label}:`, err);
        errors.push(`${vehicle.label}: ${err.message}`);
      }

      processedCount++;

      // Small delay between API calls to respect rate limits
      if (processedCount < vehiclesWithMotiveId.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    setProcessing(false);

    if (errors.length > 0) {
      setProcessStatus({
        message: `Done. ${totalVisits} visits found across ${processedCount - errors.length} vehicles. ${errors.length} errors: ${errors.join('; ')}`,
        type: 'error',
      });
    } else {
      setProcessStatus({
        message: `Done! ${totalVisits} visits found across ${processedCount} vehicles for ${selectedDate}.`,
        type: 'success',
      });
    }
  }, [vehicleList, selectedDate, stores, warehouses, logTravelEntries, bulkRecordVisits]);

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h2>Travel Log</h2>
        <p className="tl-desc">
          Pull a truck's daily location history from Motive and automatically detect store visits
          (10+ minute dwell within range). Chain stores: 250m radius. Independent/cash: 50m. Only route-matched stores are checked.
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
        <span className="tl-stat">{stats.total} <span>Total Stops</span></span>
      </div>

      {/* Timeline */}
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
                    <span className="tl-entry-vehicle">Truck {entry.vehicleId || entry.vehicleVin?.slice(-6)}</span>
                  )}
                  {entry.dwellMinutes != null && (
                    <span className="tl-entry-dwell">{entry.dwellMinutes} min</span>
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
  );
}

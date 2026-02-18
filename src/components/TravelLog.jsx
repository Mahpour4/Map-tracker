import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TravelLog() {
  const { state } = useApp();
  const { travelLog, vehicleLocations, fleetVehicles } = state;

  const today = localDateStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedVehicle, setSelectedVehicle] = useState('all');

  // Get all dates that have log entries, sorted descending
  const availableDates = useMemo(() => {
    const dates = Object.keys(travelLog).sort().reverse();
    // Always include today even if no entries yet
    if (!dates.includes(today)) dates.unshift(today);
    return dates;
  }, [travelLog, today]);

  // Get vehicle list for filter
  const vehicleList = useMemo(() => {
    const source = vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles;
    return source.map(v => ({ vin: v.vin, label: `${v.vehicleId} (${v.vin?.slice(-6) || '?'})` }));
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
        });
      });
    });

    // Sort chronologically
    entries.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
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

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h2>Travel Log</h2>
        <p className="tl-desc">
          Automatically logged when trucks are within ~1000ft of a known store or warehouse while stopped or moving slowly.
        </p>
      </div>

      {/* Filters */}
      <div className="tl-filters">
        <div className="tl-filter">
          <label>Date</label>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}>
            {availableDates.map(d => (
              <option key={d} value={d}>
                {d === today ? `Today (${d})` : d}
              </option>
            ))}
          </select>
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
      </div>

      {/* Stats */}
      <div className="tl-stats">
        <span className="tl-stat">{stats.vehicleCount} <span>Vehicles Active</span></span>
        <span className="tl-stat blue">{stats.storeVisits} <span>Store Visits</span></span>
        <span className="tl-stat orange">{stats.warehouseVisits} <span>Warehouse</span></span>
        <span className="tl-stat">{stats.total} <span>Total Stops</span></span>
      </div>

      {/* Timeline */}
      <div className="tl-timeline">
        {dayEntries.length === 0 ? (
          <div className="tl-empty">
            {selectedDate === today
              ? 'No stops logged yet today. Visits are recorded automatically when the fleet tracker is active and auto-visit is enabled.'
              : `No travel log entries for ${selectedDate}.`}
          </div>
        ) : (
          dayEntries.map((entry, i) => (
            <div key={`${entry.vehicleVin}-${entry.locationId}-${i}`} className={`tl-entry tl-${entry.type}`}>
              <div className="tl-entry-time">
                {entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </div>
              <div className="tl-entry-dot" />
              <div className="tl-entry-content">
                <div className="tl-entry-name">{entry.locationName}</div>
                <div className="tl-entry-meta">
                  <span className={`tl-type-badge ${entry.type}`}>{entry.type}</span>
                  {selectedVehicle === 'all' && (
                    <span className="tl-entry-vehicle">{entry.vehicleLabel}</span>
                  )}
                  {entry.distance != null && (
                    <span className="tl-entry-dist">{entry.distance}m away</span>
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

import { useState, useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { v4 as uuidv4 } from 'uuid';
import { useApp } from '../context/AppContext';
import { fetchVehicleLocationHistory, fetchDrivingPeriods, isMotiveConnected } from '../services/motiveService';
import { analyzeLocationHistory } from '../services/proximityService';
import { haversineDistance } from '../utils/geoUtils';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Valid coords: must be in roughly US east coast range, not 0,0
function isValidCoord(lat, lng) {
  return lat != null && lng != null && Math.abs(lat) > 1 && Math.abs(lng) > 1;
}

// Clean garbled arrow encoding and garbage characters from location names
function cleanLocationName(name) {
  if (!name) return name;
  return name
    .replace(/\s*[\u00C0-\u00FF\u0080-\u009F]{3,}\s*/g, ' \u2192 ')
    .replace(/\s*\u2192\s*/g, ' \u2192 ')
    .trim();
}

// Check if a location string is garbage/meaningless (single special chars, empty, etc.)
function isGarbageLocation(str) {
  if (!str) return true;
  const cleaned = str.trim();
  if (!cleaned || cleaned.length <= 2) {
    // Single or double chars that aren't real addresses (e.g. "¢", "Â")
    return !/^[a-zA-Z0-9]/.test(cleaned);
  }
  return false;
}

// Custom location type labels
const CUSTOM_TYPE_LABELS = {
  'gas-station': 'Gas Station',
  'storage': 'Storage',
  'meeting-point': 'Meeting Point',
  'driver-home': 'Driver Home',
  'other': 'Other',
};

// Colors for entry types (used in map markers and badges)
const TYPE_COLORS = {
  store: '#22c55e',
  warehouse: '#f59e0b',
  driving: '#3b82f6',
  'gas-station': '#ef4444',
  'storage': '#8b5cf6',
  'meeting-point': '#06b6d4',
  'driver-home': '#ec4899',
  other: '#6b7280',
  custom: '#6b7280',
};

function getTypeColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.custom;
}

function isCustomType(type) {
  return type in CUSTOM_TYPE_LABELS;
}

function getTypeLabel(type) {
  if (type === 'store') return 'store';
  if (type === 'warehouse') return 'warehouse';
  if (type === 'driving') return 'driving';
  return CUSTOM_TYPE_LABELS[type] || type;
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
  const color = getTypeColor(type);
  return L.divIcon({
    className: 'tl-map-marker',
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);">${index}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function TravelLog() {
  const { state, logTravelEntries, manualMatchEntries, unmatchEntry, bulkRecordVisits, setAddressOverride, addCustomLocation, updateCustomLocation, deleteCustomLocation } = useApp();
  const { travelLog, vehicleLocations, fleetVehicles, stores, warehouses, addressOverrides, customLocations } = state;

  const today = localDateStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);
  const [matchingEntry, setMatchingEntry] = useState(null);
  const [matchSearch, setMatchSearch] = useState('');
  const [matchTab, setMatchTab] = useState('stores'); // stores | custom | create
  // Raw data popup
  const [rawData, setRawData] = useState(null); // { breadcrumbs: {vin: [...], ...}, drivingPeriods: [...] }
  const [showRawData, setShowRawData] = useState(false);
  const [rawDataTab, setRawDataTab] = useState('driving'); // driving | breadcrumbs
  // Per-row raw data
  const [expandedRawIndex, setExpandedRawIndex] = useState(null);
  // Edit custom location
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', type: '', address: '' });
  // Create custom location form
  const [newLocName, setNewLocName] = useState('');
  const [newLocType, setNewLocType] = useState('gas-station');

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

  // Summary stats
  const stats = useMemo(() => {
    const dayLog = travelLog[selectedDate] || {};
    let vehicleCount = 0;
    let storeVisits = 0;
    let warehouseVisits = 0;
    let drivingSegments = 0;
    let customVisits = 0;
    Object.entries(dayLog).forEach(([vin, stops]) => {
      if (selectedVehicle !== 'all' && vin !== selectedVehicle) return;
      vehicleCount++;
      stops.forEach(s => {
        if (s.type === 'store') storeVisits++;
        else if (s.type === 'warehouse') warehouseVisits++;
        else if (s.type === 'driving') drivingSegments++;
        else customVisits++;
      });
    });
    return { vehicleCount, storeVisits, warehouseVisits, drivingSegments, customVisits, total: storeVisits + warehouseVisits + customVisits };
  }, [travelLog, selectedDate, selectedVehicle]);

  // Map-eligible entries
  const mapEntries = useMemo(() => dayEntries.filter(e => isValidCoord(e.lat, e.lng)), [dayEntries]);
  const mapPoints = useMemo(() => mapEntries.map(e => [e.lat, e.lng]), [mapEntries]);

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

    // Collect raw data for debug popup
    const rawBreadcrumbs = {};
    let rawDrivingPeriods = [];

    console.log(`[TravelLog] Stores in context: ${stores.length}, sample routeNumbers:`, [...new Set(stores.slice(0, 20).map(s => s.routeNumber))]);

    // Fetch ALL driving periods for the date
    let allDrivingPeriods = [];
    try {
      allDrivingPeriods = await fetchDrivingPeriods({
        startDate: selectedDate,
        endDate: selectedDate,
      });
      rawDrivingPeriods = allDrivingPeriods;
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

        // Fetch breadcrumbs
        let breadcrumbs = [];
        try {
          breadcrumbs = await fetchVehicleLocationHistory(vehicle.motiveId, selectedDate, selectedDate);
          rawBreadcrumbs[vehicle.vin] = breadcrumbs;
        } catch (err) {
          console.error(`[TravelLog] Breadcrumb error for ${vehicle.label}:`, err);
          errors.push(`${vehicle.label} breadcrumbs: ${err.message}`);
        }

        // Filter driving periods for this vehicle
        const periods = allDrivingPeriods.filter(dp =>
          String(dp.vehicleId) === String(vehicle.motiveId) ||
          (dp.vehicleVin && dp.vehicleVin === vehicle.vin)
        );

        console.log(`[TravelLog] ${vehicle.label}: ${breadcrumbs.length} breadcrumbs, ${periods.length} driving periods`);

        // Proximity-based visits from breadcrumbs (now includes custom locations)
        if (breadcrumbs.length > 0) {
          const visits = analyzeLocationHistory(breadcrumbs, stores, warehouses, vehicle.routeNumber, customLocations);
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

        // Driving periods
        if (periods.length > 0) {
          const drivingEntries = periods.map(dp => ({
            vehicleVin: vehicle.vin,
            vehicleId: vehicle.vehicleId,
            type: 'driving',
            locationId: `driving-${dp.id}`,
            locationName: `${isGarbageLocation(dp.origin) ? 'Unknown' : dp.origin} \u2192 ${isGarbageLocation(dp.destination) ? 'Unknown' : dp.destination}`,
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
            destination: isGarbageLocation(dp.destination) ? '' : dp.destination,
          }));

          logTravelEntries(drivingEntries);
          drivingCount += drivingEntries.length;

          // Auto-match driving segments using saved address overrides
          const overrideVisits = [];
          const overrideVisitRecords = [];
          for (const dp of drivingEntries) {
            const dest = (dp.destination || '').trim();
            if (!dest || !addressOverrides[dest]) continue;
            const overrideId = addressOverrides[dest];
            // Check stores, then warehouses, then custom locations
            const store = stores.find(s => s.id === overrideId);
            const wh = !store ? warehouses.find(w => w.id === overrideId) : null;
            const custom = !store && !wh ? customLocations.find(cl => cl.id === overrideId) : null;
            const matched = store || wh || custom;
            if (!matched) continue;
            overrideVisits.push({
              vehicleVin: vehicle.vin,
              vehicleId: vehicle.vehicleId,
              type: store ? 'store' : wh ? 'warehouse' : (custom.type || 'custom'),
              locationId: matched.id,
              locationName: matched.name,
              lat: matched.lat,
              lng: matched.lng,
              time: dp.departureTime || dp.arrivalTime || dp.time,
              arrivalTime: dp.departureTime || dp.arrivalTime,
              departureTime: dp.departureTime,
              dwellMinutes: null,
            });
            if (store) {
              overrideVisitRecords.push({ storeId: store.id, date: selectedDate });
            }
          }
          if (overrideVisits.length > 0) {
            logTravelEntries(overrideVisits);
            if (overrideVisitRecords.length > 0) bulkRecordVisits(overrideVisitRecords);
            totalVisits += overrideVisits.length;
            console.log(`[TravelLog] ${vehicle.label}: ${overrideVisits.length} auto-matched from address overrides`);
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

    // Save raw data for debug popup
    setRawData({ breadcrumbs: rawBreadcrumbs, drivingPeriods: rawDrivingPeriods });

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
  }, [vehicleList, selectedVehicle, selectedDate, stores, warehouses, customLocations, addressOverrides, logTravelEntries, bulkRecordVisits]);

  // --- Manual matching ---
  const matchCandidates = useMemo(() => {
    if (!matchingEntry) return [];
    const vehicle = vehicleList.find(v => v.vin === matchingEntry.vehicleVin);
    const routeNum = vehicle?.routeNumber;
    let candidates = stores.filter(s =>
      routeNum && String(s.routeNumber).trim() === String(routeNum).trim()
    );
    if (matchSearch.trim()) {
      const q = matchSearch.toLowerCase();
      candidates = candidates.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.address || '').toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q) ||
        (s.id || '').toLowerCase().includes(q)
      );
    }
    const dest = (matchingEntry.destination || '').toLowerCase();
    if (dest) {
      candidates = candidates.slice().sort((a, b) => {
        const aAddr = (a.address || '').toLowerCase();
        const bAddr = (b.address || '').toLowerCase();
        const aMatch = dest.includes(aAddr.split(' ')[0]) || aAddr.includes(dest.split(',')[0].split(' ')[0]);
        const bMatch = dest.includes(bAddr.split(' ')[0]) || bAddr.includes(dest.split(',')[0].split(' ')[0]);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    }
    return candidates;
  }, [matchingEntry, matchSearch, stores, vehicleList]);

  // Custom location candidates for match popup
  const customMatchCandidates = useMemo(() => {
    if (!matchingEntry) return [];
    let candidates = [...customLocations];
    if (matchSearch.trim()) {
      const q = matchSearch.toLowerCase();
      candidates = candidates.filter(cl =>
        (cl.name || '').toLowerCase().includes(q) ||
        (cl.address || '').toLowerCase().includes(q) ||
        (cl.type || '').toLowerCase().includes(q)
      );
    }
    return candidates;
  }, [matchingEntry, matchSearch, customLocations]);

  // Propagate a match to all other driving entries with the same destination address OR within 1/8 mile
  const PROPAGATE_RADIUS_M = 201; // 1/8 mile in meters
  const propagateMatchToSameDestination = useCallback((matchedEntry, matchedLocation, locationType) => {
    const dest = (matchedEntry.destination || '').trim();
    const destLat = matchedEntry.destinationLat || matchedEntry.lat;
    const destLng = matchedEntry.destinationLng || matchedEntry.lng;
    if (!dest && !destLat) return;
    const nearbyEntries = dayEntries.filter(e => {
      if (e.type !== 'driving' || e.locationId === matchedEntry.locationId) return false;
      // Exact address match
      if (dest && (e.destination || '').trim() === dest) return true;
      // Coordinate proximity match (1/8 mile)
      const eLat = e.destinationLat || e.lat;
      const eLng = e.destinationLng || e.lng;
      if (destLat && destLng && eLat && eLng) {
        return haversineDistance(destLat, destLng, eLat, eLng) <= PROPAGATE_RADIUS_M;
      }
      return false;
    });
    if (nearbyEntries.length === 0) return;
    console.log(`[TravelLog] Propagating match to ${nearbyEntries.length} nearby entries (address + ${PROPAGATE_RADIUS_M}m radius)`);
    const updates = nearbyEntries.map(e => ({
      vehicleVin: e.vehicleVin,
      date: selectedDate,
      oldLocationId: e.locationId,
      newEntry: {
        type: locationType,
        locationId: matchedLocation.id,
        locationName: matchedLocation.name,
        lat: matchedLocation.lat,
        lng: matchedLocation.lng,
      },
    }));
    manualMatchEntries(updates);
    if (locationType === 'store') {
      bulkRecordVisits(updates.map(() => ({ storeId: matchedLocation.id, date: selectedDate })));
    }
  }, [dayEntries, manualMatchEntries, bulkRecordVisits, selectedDate]);

  const handleMatchStore = useCallback((store) => {
    if (!matchingEntry) return;
    console.log(`[TravelLog] Manual match: "${matchingEntry.locationName}" → store "${store.name}" (${store.id})`);
    manualMatchEntries([{
      vehicleVin: matchingEntry.vehicleVin,
      date: selectedDate,
      oldLocationId: matchingEntry.locationId,
      newEntry: {
        type: 'store',
        locationId: store.id,
        locationName: store.name,
        lat: store.lat,
        lng: store.lng,
      },
    }]);
    bulkRecordVisits([{ storeId: store.id, date: selectedDate }]);
    const dest = (matchingEntry.destination || '').trim();
    if (dest) setAddressOverride(dest, store.id);
    propagateMatchToSameDestination(matchingEntry, store, 'store');
    setMatchingEntry(null);
    setMatchSearch('');
  }, [matchingEntry, selectedDate, manualMatchEntries, bulkRecordVisits, setAddressOverride, propagateMatchToSameDestination]);

  const handleMatchCustomLocation = useCallback((cl) => {
    if (!matchingEntry) return;
    console.log(`[TravelLog] Manual match: "${matchingEntry.locationName}" → custom "${cl.name}" (${cl.type || 'custom'})`);
    manualMatchEntries([{
      vehicleVin: matchingEntry.vehicleVin,
      date: selectedDate,
      oldLocationId: matchingEntry.locationId,
      newEntry: {
        type: cl.type || 'custom',
        locationId: cl.id,
        locationName: cl.name,
        lat: cl.lat,
        lng: cl.lng,
      },
    }]);
    const dest = (matchingEntry.destination || '').trim();
    if (dest) setAddressOverride(dest, cl.id);
    propagateMatchToSameDestination(matchingEntry, cl, cl.type || 'custom');
    setMatchingEntry(null);
    setMatchSearch('');
  }, [matchingEntry, selectedDate, manualMatchEntries, setAddressOverride, propagateMatchToSameDestination]);

  const handleCreateAndMatch = useCallback(() => {
    if (!matchingEntry || !newLocName.trim()) return;
    const dest = (matchingEntry.destination || '').trim();
    const id = uuidv4();
    const newLoc = {
      id,
      name: newLocName.trim(),
      type: newLocType,
      address: dest,
      lat: matchingEntry.destinationLat || matchingEntry.lat,
      lng: matchingEntry.destinationLng || matchingEntry.lng,
    };
    console.log(`[TravelLog] Create & match: "${matchingEntry.locationName}" → new "${newLoc.name}" (${newLocType})`);
    addCustomLocation(newLoc);
    manualMatchEntries([{
      vehicleVin: matchingEntry.vehicleVin,
      date: selectedDate,
      oldLocationId: matchingEntry.locationId,
      newEntry: {
        type: newLocType,
        locationId: id,
        locationName: newLocName.trim(),
        lat: newLoc.lat,
        lng: newLoc.lng,
      },
    }]);
    if (dest) setAddressOverride(dest, id);
    propagateMatchToSameDestination(matchingEntry, newLoc, newLocType);
    setMatchingEntry(null);
    setMatchSearch('');
    setNewLocName('');
    setNewLocType('gas-station');
  }, [matchingEntry, selectedDate, newLocName, newLocType, addCustomLocation, manualMatchEntries, setAddressOverride, propagateMatchToSameDestination]);

  // Raw data total breadcrumb count
  const rawBreadcrumbCount = useMemo(() => {
    if (!rawData?.breadcrumbs) return 0;
    return Object.values(rawData.breadcrumbs).reduce((sum, arr) => sum + arr.length, 0);
  }, [rawData]);

  return (
    <div className="tl-page">
      <div className="tl-header">
        <h2>Travel Log</h2>
        <p className="tl-desc">
          Pull location history from Motive and detect store visits
          (15+ min dwell). Chain: 805m (~½ mi), Independent: 200m radius. Route-matched stores only.
        </p>
      </div>

      {/* Filters + Process Day + Raw Data */}
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary"
              onClick={handleProcessDay}
              disabled={processing}
            >
              {processing ? 'Processing...' : `Process ${selectedDate === today ? 'Today' : selectedDate}`}
            </button>
            {rawData && (
              <button
                className="btn btn-outline tl-raw-btn"
                onClick={() => setShowRawData(true)}
                title="View raw API data from Motive"
              >
                Raw Data
              </button>
            )}
          </div>
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
        {stats.customVisits > 0 && (
          <span className="tl-stat purple">{stats.customVisits} <span>Custom</span></span>
        )}
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
                    <span style={{ textTransform: 'capitalize' }}>{getTypeLabel(entry.type)}</span>
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

      {/* Timeline */}
      <div className="tl-timeline-scroll">
        <div className="tl-timeline">
          {dayEntries.length === 0 ? (
            <div className="tl-empty">
              {selectedDate === today
                ? 'No stops logged yet today. Click "Process Today" to pull location history from Motive and detect visits.'
                : `No travel log entries for ${selectedDate}. Click "Process ${selectedDate}" to analyze that day's data.`}
            </div>
          ) : (
            dayEntries.map((entry, i) => {
              // Resolve whether this entry's locationId points to a live location
              const liveCl = entry.locationId ? customLocations.find(c => c.id === entry.locationId) : null;
              const liveStore = entry.type === 'store' && entry.locationId ? stores.find(s => s.id === entry.locationId) : null;
              const liveWh = entry.type === 'warehouse' && entry.locationId ? warehouses.find(w => w.id === entry.locationId) : null;
              const isResolved = !!(liveCl || liveStore || liveWh);
              // Treat as unmatched if non-driving entry lost its association
              const effectivelyUnmatched = entry.type !== 'driving' && !isResolved;

              return (
              <div key={`${entry.vehicleVin}-${entry.locationId}-${i}`} className={`tl-entry tl-${effectivelyUnmatched ? 'driving' : entry.type}`}>
                <div className="tl-entry-index">{i + 1}</div>
                <div className="tl-entry-time">
                  {entry.arrivalTime
                    ? new Date(entry.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : entry.time
                      ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '--:--'}
                </div>
                <div className="tl-entry-dot" style={!['store','warehouse','driving'].includes(entry.type) || effectivelyUnmatched ? { background: effectivelyUnmatched ? undefined : getTypeColor(entry.type) } : undefined} />
                <div className="tl-entry-content">
                  <div className="tl-entry-name">
                    {entry.type === 'driving' ? (() => {
                      const parts = cleanLocationName(entry.locationName).split(' \u2192 ');
                      const origin = isGarbageLocation(parts[0]) ? 'Unknown' : parts[0];
                      const dest = isGarbageLocation(parts[1]) ? 'Unknown' : parts[1];
                      const originQ = (entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(origin);
                      const destQ = (entry.destinationLat && entry.destinationLng) ? `${entry.destinationLat},${entry.destinationLng}` : encodeURIComponent(dest);
                      return (
                        <>
                          <a href={`https://www.google.com/maps/search/?api=1&query=${originQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">{origin}</a>
                          {' \u2192 '}
                          <a href={`https://www.google.com/maps/search/?api=1&query=${destQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">{dest}</a>
                        </>
                      );
                    })() : (() => {
                      const displayName = isResolved
                        ? (liveCl?.name || liveWh?.name || liveStore?.name)
                        : (entry.destination || cleanLocationName(entry.locationName) || (entry.lat && entry.lng ? `${entry.lat}, ${entry.lng}` : 'Unknown'));
                      const storeAddr = liveStore ? [liveStore.address, liveStore.city, liveStore.state].filter(Boolean).join(', ') : '';
                      const addr = isResolved
                        ? (entry.destination || liveCl?.address || storeAddr || liveWh?.address || '')
                        : '';
                      return (
                        <>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${(entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(displayName)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tl-map-link"
                          >
                            {displayName}{addr ? `: ${addr}` : ''}
                          </a>
                        </>
                      );
                    })()}
                  </div>
                  <div className="tl-entry-meta">
                    <span
                      className={`tl-type-badge ${effectivelyUnmatched ? 'driving' : entry.type}`}
                      style={!effectivelyUnmatched && !['store','warehouse','driving'].includes(entry.type) ? { background: getTypeColor(entry.type), color: '#fff' } : undefined}
                    >
                      {effectivelyUnmatched ? 'Unmatched' : getTypeLabel(entry.type)}
                    </span>
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
                    {(entry.type === 'driving' || effectivelyUnmatched) && (
                      <button
                        className="tl-match-btn"
                        onClick={(e) => { e.stopPropagation(); setMatchingEntry(entry); setMatchSearch(''); setMatchTab('stores'); }}
                      >
                        Match Location
                      </button>
                    )}
                    {entry.locationId && liveCl && (
                      <>
                        <button
                          className="tl-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditForm({ name: liveCl.name, type: liveCl.type, address: liveCl.address || '' });
                            setEditingLocationId(liveCl.id);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="tl-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete custom location "${liveCl.name}"?`)) {
                              deleteCustomLocation(liveCl.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {isResolved && entry.type !== 'driving' && (
                      <button
                        className="tl-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const matchedName = liveCl?.name || liveStore?.name || liveWh?.name || entry.locationName;
                          if (window.confirm(`Unmatch "${matchedName}" from this entry? It will revert to showing the raw address.`)) {
                            unmatchEntry(entry.vehicleVin, selectedDate, entry.locationId);
                          }
                        }}
                      >
                        Unmatch
                      </button>
                    )}
                    <button
                      className="tl-raw-toggle-btn"
                      onClick={(e) => { e.stopPropagation(); setExpandedRawIndex(expandedRawIndex === i ? null : i); }}
                      title="View raw entry data"
                    >
                      {'{'}...{'}'}
                    </button>
                  </div>
                  {expandedRawIndex === i && (
                    <pre className="tl-entry-raw">{JSON.stringify(entry, null, 2)}</pre>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>

      {/* ---- Raw Data Modal ---- */}
      {showRawData && rawData && (
        <div className="tl-match-overlay" onClick={() => setShowRawData(false)}>
          <div className="tl-raw-popup" onClick={e => e.stopPropagation()}>
            <div className="tl-match-header">
              <h3>Raw Motive API Data</h3>
              <button className="tl-match-close" onClick={() => setShowRawData(false)}>&times;</button>
            </div>
            <div className="tl-raw-tabs">
              <button
                className={`tl-raw-tab ${rawDataTab === 'driving' ? 'active' : ''}`}
                onClick={() => setRawDataTab('driving')}
              >
                Driving Periods ({rawData.drivingPeriods?.length || 0})
              </button>
              <button
                className={`tl-raw-tab ${rawDataTab === 'breadcrumbs' ? 'active' : ''}`}
                onClick={() => setRawDataTab('breadcrumbs')}
              >
                Breadcrumbs ({rawBreadcrumbCount})
              </button>
            </div>
            <div className="tl-raw-content">
              <pre>{JSON.stringify(
                rawDataTab === 'driving' ? rawData.drivingPeriods : rawData.breadcrumbs,
                null, 2
              )}</pre>
            </div>
          </div>
        </div>
      )}

      {/* ---- Match Location Popup ---- */}
      {matchingEntry && (
        <div className="tl-match-overlay" onClick={() => setMatchingEntry(null)}>
          <div className="tl-match-popup" onClick={e => e.stopPropagation()}>
            <div className="tl-match-header">
              <h3>Match to Location</h3>
              <button className="tl-match-close" onClick={() => setMatchingEntry(null)}>&times;</button>
            </div>
            <div className="tl-match-dest">
              <span className="tl-match-label">Motive Destination:</span>
              <span className="tl-match-addr">{matchingEntry.destination || matchingEntry.locationName?.split('\u2192')[1]?.trim() || 'Unknown'}</span>
              {addressOverrides[(matchingEntry.destination || '').trim()] && (() => {
                const savedId = addressOverrides[(matchingEntry.destination || '').trim()];
                const savedStore = stores.find(s => s.id === savedId);
                const savedWh = !savedStore ? warehouses.find(w => w.id === savedId) : null;
                const savedCustom = !savedStore && !savedWh ? customLocations.find(cl => cl.id === savedId) : null;
                const savedName = savedStore?.name || savedWh?.name || savedCustom?.name || 'Unknown';
                return <span className="tl-match-saved">Saved match: {savedName}</span>;
              })()}
            </div>

            {/* Tabs: Stores | Custom Locations | Create New */}
            <div className="tl-match-tabs">
              <button className={`tl-match-tab ${matchTab === 'stores' ? 'active' : ''}`} onClick={() => setMatchTab('stores')}>
                Stores ({matchCandidates.length})
              </button>
              <button className={`tl-match-tab ${matchTab === 'custom' ? 'active' : ''}`} onClick={() => setMatchTab('custom')}>
                Custom ({customMatchCandidates.length})
              </button>
              <button className={`tl-match-tab ${matchTab === 'create' ? 'active' : ''}`} onClick={() => setMatchTab('create')}>
                + New
              </button>
            </div>

            {matchTab !== 'create' && (
              <input
                className="tl-match-search"
                type="text"
                placeholder={matchTab === 'stores' ? 'Search stores by name, address, or ID...' : 'Search custom locations...'}
                value={matchSearch}
                onChange={e => setMatchSearch(e.target.value)}
                autoFocus
              />
            )}

            <div className="tl-match-list">
              {matchTab === 'stores' && (
                matchCandidates.length === 0 ? (
                  <div className="tl-match-empty">No matching stores found for this route</div>
                ) : (
                  matchCandidates.map(store => (
                    <div key={store.id} className="tl-match-item" onClick={() => handleMatchStore(store)}>
                      <div className="tl-match-store-name">{store.name}</div>
                      <div className="tl-match-store-addr">
                        {store.address}{store.city ? `, ${store.city}` : ''}{store.state ? `, ${store.state}` : ''} {store.zip || ''}
                      </div>
                      <div className="tl-match-store-id">{store.id}</div>
                    </div>
                  ))
                )
              )}

              {matchTab === 'custom' && (
                customMatchCandidates.length === 0 ? (
                  <div className="tl-match-empty">No custom locations saved yet. Use the "+ New" tab to create one.</div>
                ) : (
                  customMatchCandidates.map(cl => (
                    <div key={cl.id} className="tl-match-item" onClick={() => handleMatchCustomLocation(cl)}>
                      <div className="tl-match-store-name">{cl.name}</div>
                      <div className="tl-match-store-addr">
                        <span className="tl-match-cl-type" style={{ background: getTypeColor(cl.type) }}>{getTypeLabel(cl.type)}</span>
                        {cl.address && ` ${cl.address}`}
                      </div>
                    </div>
                  ))
                )
              )}

              {matchTab === 'create' && (
                <div className="tl-create-form">
                  <div className="tl-create-field">
                    <label>Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Shell Gas Station Pulaski Hwy"
                      value={newLocName}
                      onChange={e => setNewLocName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="tl-create-field">
                    <label>Type</label>
                    <select value={newLocType} onChange={e => setNewLocType(e.target.value)}>
                      <option value="gas-station">Gas Station</option>
                      <option value="storage">Storage Unit</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="meeting-point">Meeting Point</option>
                      <option value="driver-home">Driver Home</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="tl-create-field">
                    <label>Address (from destination)</label>
                    <input type="text" value={matchingEntry.destination || ''} readOnly className="tl-create-readonly" />
                  </div>
                  <div className="tl-create-field">
                    <label>Coordinates</label>
                    <input
                      type="text"
                      value={`${matchingEntry.destinationLat || matchingEntry.lat || '?'}, ${matchingEntry.destinationLng || matchingEntry.lng || '?'}`}
                      readOnly
                      className="tl-create-readonly"
                    />
                  </div>
                  <button
                    className="btn btn-primary tl-create-btn"
                    onClick={handleCreateAndMatch}
                    disabled={!newLocName.trim()}
                  >
                    Create & Match
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Edit Custom Location Modal ---- */}
      {editingLocationId && (
        <div className="tl-match-overlay" onClick={() => setEditingLocationId(null)}>
          <div className="tl-match-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="tl-match-header">
              <h3>Edit Custom Location</h3>
              <button className="tl-match-close" onClick={() => setEditingLocationId(null)}>&times;</button>
            </div>
            <div style={{ padding: '0 20px 20px' }}>
              <div className="tl-create-form">
                <div className="tl-create-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="tl-create-field">
                  <label>Type</label>
                  <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="gas-station">Gas Station</option>
                    <option value="storage">Storage Unit</option>
                    <option value="warehouse">Warehouse</option>
                    <option value="meeting-point">Meeting Point</option>
                    <option value="driver-home">Driver Home</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="tl-create-field">
                  <label>Address</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <button
                  className="btn btn-primary tl-create-btn"
                  onClick={() => {
                    updateCustomLocation({
                      id: editingLocationId,
                      name: editForm.name.trim(),
                      type: editForm.type,
                      address: editForm.address.trim(),
                    });
                    setEditingLocationId(null);
                  }}
                  disabled={!editForm.name.trim()}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

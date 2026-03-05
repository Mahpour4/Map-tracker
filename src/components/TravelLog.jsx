import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { v4 as uuidv4 } from 'uuid';
import { useApp } from '../context/AppContext';
import { fetchVehicleLocationHistory, fetchDrivingPeriods, fetchCardTransactions, fetchVehicles, isMotiveConnected } from '../services/motiveService';
import { analyzeLocationHistory, findAddressMatch } from '../services/proximityService';
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

// Fly to a specific store on search
function FlyToStore({ store }) {
  const map = useMap();
  useEffect(() => {
    if (store && store.lat && store.lng) {
      map.flyTo([store.lat, store.lng], 15, { duration: 1 });
    }
  }, [store, map]);
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
  const { state, logTravelEntries, manualMatchEntries, unmatchEntry, bulkRecordVisits, setAddressOverride, removeAddressOverride, addCustomLocation, updateCustomLocation, deleteCustomLocation } = useApp();
  const { travelLog, vehicleLocations, fleetVehicles, stores, warehouses, addressOverrides, customLocations } = state;

  const today = localDateStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedSpan, setSelectedSpan] = useState('day'); // 'day' | 'week' | '2week' | 'month'
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState(null);
  const [matchingEntry, setMatchingEntry] = useState(null);
  const [matchSearch, setMatchSearch] = useState('');
  const [matchTab, setMatchTab] = useState('stores'); // stores | custom | create
  const [matchingField, setMatchingField] = useState('dest'); // 'origin' | 'dest'
  // Dismissed suggestion keys: Set of "${locationId}-origin" or "${locationId}-dest"
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set());
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
  // Panel visibility toggles
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [showDrivingPeriods, setShowDrivingPeriods] = useState(true);
  // Per-panel map point toggles
  const [breadcrumbsOnMap, setBreadcrumbsOnMap] = useState(true);
  const [drivingOnMap, setDrivingOnMap] = useState(true);
  // Fuel data for selected date
  // Fuel trip data: per-route, last fill-up details with miles since previous fill
  const [fuelData, setFuelData] = useState({}); // { [routeNumber]: [{ date, cost, gallons, merchant, last4, cardId }] }
  const [unmappedCards, setUnmappedCards] = useState([]); // [{ last4, cardId, txCount, totalAmount }]
  const [showCardMapping, setShowCardMapping] = useState(false);
  const [cardMapVersion, setCardMapVersion] = useState(0); // bump to re-fetch fuel data after mapping changes
  // Right panel mode
  const [rightPanelMode, setRightPanelMode] = useState('data'); // 'data' | 'search'
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [selectedSearchStore, setSelectedSearchStore] = useState(null);

  // Get all dates that have log entries, sorted descending
  const availableDates = useMemo(() => {
    const dates = Object.keys(travelLog).sort().reverse();
    if (!dates.includes(today)) dates.unshift(today);
    return dates;
  }, [travelLog, today]);

  // Compute the list of dates in the current span (ending on selectedDate)
  const spanDates = useMemo(() => {
    if (selectedSpan === 'day') return [selectedDate];
    const spanDays = selectedSpan === 'week' ? 7 : selectedSpan === '2week' ? 14 : 30;
    const dates = [];
    const end = new Date(selectedDate + 'T00:00:00');
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      dates.push(localDateStr(d));
    }
    return dates;
  }, [selectedDate, selectedSpan]);

  // Fetch all fuel transactions (30 days) grouped by route
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d30ago = new Date(); d30ago.setDate(d30ago.getDate() - 30);
        const [txs, motiveVehicles] = await Promise.all([
          fetchCardTransactions({ startDate: localDateStr(d30ago), endDate: today }),
          fetchVehicles(),
        ]);
        if (cancelled) return;

        // Build route mapping
        const vinRouteMap = {};
        (fleetVehicles || []).forEach(v => { if (v.vin && v.routeNumber) vinRouteMap[v.vin] = String(v.routeNumber); });
        const motiveIdRouteMap = {};
        motiveVehicles.forEach(v => {
          const route = vinRouteMap[v.vin];
          if (route && v.id) motiveIdRouteMap[String(v.id)] = route;
        });
        let cardRouteMap = {};
        try { cardRouteMap = JSON.parse(localStorage.getItem('fuel_card_route_map') || '{}'); } catch {}

        // Group transactions by route with date, sorted newest first
        const byRoute = {};
        const unmapped = {}; // keyed by last4
        txs.forEach(tx => {
          if (tx.declined) return;
          let route = null;
          if (tx.cardId && cardRouteMap[tx.cardId]) route = String(cardRouteMap[tx.cardId]);
          else if (tx.vehicleId && motiveIdRouteMap[tx.vehicleId]) route = motiveIdRouteMap[tx.vehicleId];
          if (!route) {
            // Track unmapped card
            const key = tx.last4 || tx.cardId || 'unknown';
            if (!unmapped[key]) unmapped[key] = { last4: tx.last4 || '', cardId: tx.cardId || null, txCount: 0, totalAmount: 0, totalGallons: 0 };
            unmapped[key].txCount++;
            unmapped[key].totalAmount += tx.totalAmount || 0;
            unmapped[key].totalGallons += tx.totalGallons || 0;
            return;
          }
          if (!byRoute[route]) byRoute[route] = [];
          byRoute[route].push({
            date: tx.transactedAt ? tx.transactedAt.split('T')[0] : null,
            cost: tx.totalAmount,
            gallons: tx.totalGallons,
            merchant: tx.merchantName,
            last4: tx.last4 || '',
            cardId: tx.cardId || null,
          });
        });
        // Sort each route's transactions newest first
        Object.values(byRoute).forEach(arr => arr.sort((a, b) => (b.date || '').localeCompare(a.date || '')));

        if (!cancelled) {
          setFuelData(byRoute);
          setUnmappedCards(Object.values(unmapped).sort((a, b) => b.totalAmount - a.totalAmount));
        }
      } catch (err) {
        console.warn('Fuel data fetch failed:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [fleetVehicles, today, cardMapVersion]);

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
    const entries = [];

    spanDates.forEach(dateKey => {
      const dayLog = travelLog[dateKey] || {};
      Object.entries(dayLog).forEach(([vin, stops]) => {
        if (selectedVehicle !== 'all' && vin !== selectedVehicle) return;
        const vehicle = vehicleList.find(v => v.vin === vin);
        stops.forEach(stop => {
          entries.push({
            ...stop,
            dateKey,
            vehicleVin: vin,
            vehicleLabel: vehicle?.label || vin,
            vehicleId: vehicle?.vehicleId || '',
          });
        });
      });
    });

    entries.sort((a, b) => {
      const da = a.dateKey || '', db = b.dateKey || '';
      if (da !== db) return db.localeCompare(da); // newest date first
      return (a.arrivalTime || a.time || '').localeCompare(b.arrivalTime || b.time || '');
    });
    return entries;
  }, [travelLog, spanDates, selectedVehicle, vehicleList]);

  // Split dayEntries into the two source datasets
  const breadcrumbEntries = useMemo(() => dayEntries.filter(e => e.type !== 'driving'), [dayEntries]);
  const drivingEntries = useMemo(() => dayEntries.filter(e => e.type === 'driving'), [dayEntries]);

  // Summary stats (across entire span)
  const stats = useMemo(() => {
    let storeVisits = 0;
    let warehouseVisits = 0;
    let drivingSegments = 0;
    let customVisits = 0;
    let totalMiles = 0;
    const vinSet = new Set();

    spanDates.forEach(dateKey => {
      const dayLog = travelLog[dateKey] || {};
      Object.entries(dayLog).forEach(([vin, stops]) => {
        if (selectedVehicle !== 'all' && vin !== selectedVehicle) return;
        vinSet.add(vin);
        stops.forEach(s => {
          if (s.type === 'store') storeVisits++;
          else if (s.type === 'warehouse') warehouseVisits++;
          else if (s.type === 'driving') { drivingSegments++; totalMiles += (s.distance || 0); }
          else customVisits++;
        });
      });
    });

    // Fuel data — aggregate based on span
    let fuel = null;
    const spanDateSet = new Set(spanDates);
    const processedRoutes = new Set();

    if (selectedSpan === 'day' && vinSet.size === 1) {
      // Single vehicle on single day: show per-fill-up detail
      const vin = [...vinSet][0];
      const vehicle = vehicleList.find(v => v.vin === vin);
      const route = vehicle?.routeNumber ? String(vehicle.routeNumber) : null;
      if (route && fuelData[route]) {
        const routeTxs = fuelData[route];
        const lastFill = routeTxs[0];
        const prevFill = routeTxs.length > 1 ? routeTxs[1] : null;
        let milesBetween = 0;
        if (prevFill?.date && lastFill?.date) {
          const startD = new Date(prevFill.date + 'T00:00:00');
          const endD = new Date(lastFill.date + 'T00:00:00');
          for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            const dk = localDateStr(d);
            const entries = ((travelLog || {})[dk] || {})[vin] || [];
            entries.forEach(e => { if (e.type === 'driving') milesBetween += (e.distance || 0); });
          }
        }
        fuel = {
          mode: 'trip',
          lastCost: lastFill.cost,
          lastGallons: lastFill.gallons,
          lastDate: lastFill.date,
          lastMerchant: lastFill.merchant,
          prevDate: prevFill?.date || null,
          milesBetween,
          mpg: milesBetween > 0 && lastFill.gallons > 0 ? milesBetween / lastFill.gallons : null,
          costPerMile: milesBetween > 0 && lastFill.cost > 0 ? lastFill.cost / milesBetween : null,
        };
      }
    } else {
      // Multiple vehicles or multi-day span: sum ALL routes' transactions
      let totalCost = 0, totalGallons = 0, fillCount = 0;
      vinSet.forEach(vin => {
        const vehicle = vehicleList.find(v => v.vin === vin);
        const route = vehicle?.routeNumber ? String(vehicle.routeNumber) : null;
        if (!route || !fuelData[route] || processedRoutes.has(route)) return;
        processedRoutes.add(route);
        fuelData[route].forEach(tx => {
          if (tx.date && spanDateSet.has(tx.date)) {
            totalCost += tx.cost;
            totalGallons += tx.gallons;
            fillCount++;
          }
        });
      });
      if (fillCount > 0) {
        fuel = {
          mode: 'span',
          totalCost,
          totalGallons,
          fillCount,
          mpg: totalMiles > 0 && totalGallons > 0 ? totalMiles / totalGallons : null,
          costPerMile: totalMiles > 0 && totalCost > 0 ? totalCost / totalMiles : null,
        };
      }
    }

    return { vehicleCount: vinSet.size, storeVisits, warehouseVisits, drivingSegments, customVisits, total: storeVisits + warehouseVisits + customVisits, totalMiles, fuel, daysInSpan: spanDates.length };
  }, [travelLog, spanDates, selectedSpan, selectedVehicle, fuelData, vehicleList]);

  // Map-eligible entries — respects both panel visibility and per-panel map toggles
  const mapEntries = useMemo(() => {
    let visible = [];
    if (showBreadcrumbs && breadcrumbsOnMap) visible = visible.concat(breadcrumbEntries);
    if (showDrivingPeriods && drivingOnMap) visible = visible.concat(drivingEntries);
    visible.sort((a, b) => (a.arrivalTime || a.time || '').localeCompare(b.arrivalTime || b.time || ''));
    return visible.filter(e => isValidCoord(e.lat, e.lng));
  }, [showBreadcrumbs, showDrivingPeriods, breadcrumbsOnMap, drivingOnMap, breadcrumbEntries, drivingEntries]);
  const mapPoints = useMemo(() => mapEntries.map(e => [e.lat, e.lng]), [mapEntries]);

  // Store search results
  const storeSearchResults = useMemo(() => {
    if (!storeSearchQuery || storeSearchQuery.trim().length < 2) return [];
    const q = storeSearchQuery.toLowerCase().trim();
    return stores.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.id || '').toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q) ||
      (s.address || '').toLowerCase().includes(q) ||
      String(s.routeNumber || '').includes(q)
    ).slice(0, 50);
  }, [stores, storeSearchQuery]);

  // Visit history for selected search store
  // Group visits by date — one row per day (earliest arrive, latest depart, total dwell)
  const selectedStoreVisits = useMemo(() => {
    if (!selectedSearchStore) return [];
    const storeId = selectedSearchStore.id;
    const byDate = {}; // { "2026-03-04": { date, arrive, depart, dwell, vehicle } }
    Object.entries(travelLog || {}).forEach(([dateKey, vehicles]) => {
      Object.entries(vehicles || {}).forEach(([vin, entries]) => {
        (entries || []).forEach(entry => {
          if (entry.locationId === storeId && entry.type !== 'driving') {
            const vehicle = vehicleList.find(v => v.vin === vin);
            const key = dateKey + '-' + vin;
            if (!byDate[key]) {
              byDate[key] = {
                date: dateKey,
                arrivalTime: entry.arrivalTime || entry.time,
                departureTime: entry.departureTime,
                dwellMinutes: entry.dwellMinutes || 0,
                vehicle: vehicle?.label || vin,
              };
            } else {
              const cur = byDate[key];
              const arrive = entry.arrivalTime || entry.time;
              if (arrive && (!cur.arrivalTime || arrive < cur.arrivalTime)) cur.arrivalTime = arrive;
              if (entry.departureTime && (!cur.departureTime || entry.departureTime > cur.departureTime)) cur.departureTime = entry.departureTime;
              cur.dwellMinutes += entry.dwellMinutes || 0;
            }
          }
        });
      });
    });
    return Object.values(byDate)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }, [selectedSearchStore, travelLog, vehicleList]);

  // Purple marker icon for searched store
  const searchStoreIcon = useMemo(() => L.divIcon({
    className: 'tl-map-marker',
    html: '<div style="background:#8b5cf6;color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);">\u2605</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  }), []);

  // Reactively compute address-match suggestions for all unmatched driving entries
  const suggestions = useMemo(() => {
    const result = new Map();
    dayEntries.forEach(entry => {
      if (entry.type !== 'driving') return;
      const vehicle = vehicleList.find(v => v.vin === entry.vehicleVin);
      const routeStores = stores.filter(s =>
        vehicle?.routeNumber && String(s.routeNumber).trim() === String(vehicle.routeNumber).trim()
      );
      const dest = (entry.destination || '').trim();
      const origin = (entry.origin || '').trim();
      const suggestionEntry = {};

      if (dest && !addressOverrides[dest] && !dismissedSuggestions.has(`${entry.locationId}-dest`)) {
        const m = findAddressMatch(dest, routeStores);
        if (m?.confidence === 'low') suggestionEntry.dest = m.store;
      }
      if (origin && !addressOverrides[origin] && !dismissedSuggestions.has(`${entry.locationId}-origin`)) {
        const m = findAddressMatch(origin, routeStores);
        if (m?.confidence === 'low') suggestionEntry.origin = m.store;
      }
      if (Object.keys(suggestionEntry).length > 0) result.set(entry.locationId, suggestionEntry);
    });
    return result;
  }, [dayEntries, stores, vehicleList, addressOverrides, dismissedSuggestions]);

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
            origin: isGarbageLocation(dp.origin) ? '' : dp.origin,
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

          // Backup: address-string matching for unmatched driving period destinations
          const routeStores = stores.filter(s =>
            vehicle.routeNumber && String(s.routeNumber).trim() === String(vehicle.routeNumber).trim()
          );
          const addrAutoMatches = [];
          const addrAutoVisitRecords = [];

          for (const dp of drivingEntries) {
            const dest = (dp.destination || '').trim();
            const origin = (dp.origin || '').trim();

            // Destination matching (high confidence only — low confidence shown via reactive suggestions)
            if (dest && !addressOverrides[dest]) {
              const destMatch = findAddressMatch(dest, routeStores);
              if (destMatch?.confidence === 'high') {
                addrAutoMatches.push({
                  vehicleVin: vehicle.vin,
                  date: selectedDate,
                  oldLocationId: dp.locationId,
                  newEntry: {
                    type: 'store',
                    locationId: destMatch.store.id,
                    locationName: destMatch.store.name,
                    lat: destMatch.store.lat,
                    lng: destMatch.store.lng,
                  },
                });
                addrAutoVisitRecords.push({ storeId: destMatch.store.id, date: selectedDate });
                setAddressOverride(dest, destMatch.store.id);
                console.log(`[TravelLog] ${vehicle.label}: address match (high) dest "${dest}" → "${destMatch.store.name}"`);
              }
            }

            // Origin matching (high confidence only)
            if (origin && !addressOverrides[origin]) {
              const originMatch = findAddressMatch(origin, routeStores);
              if (originMatch?.confidence === 'high') {
                logTravelEntries([{
                  vehicleVin: vehicle.vin,
                  vehicleId: vehicle.vehicleId,
                  type: 'store',
                  locationId: originMatch.store.id,
                  locationName: originMatch.store.name,
                  lat: originMatch.store.lat,
                  lng: originMatch.store.lng,
                  time: dp.arrivalTime,
                  arrivalTime: dp.arrivalTime,
                  departureTime: dp.arrivalTime,
                  dwellMinutes: null,
                }]);
                addrAutoVisitRecords.push({ storeId: originMatch.store.id, date: selectedDate });
                setAddressOverride(origin, originMatch.store.id);
                totalVisits++;
                console.log(`[TravelLog] ${vehicle.label}: address match (high) origin "${origin}" → "${originMatch.store.name}"`);
              }
            }
          }

          if (addrAutoMatches.length > 0) {
            manualMatchEntries(addrAutoMatches);
            if (addrAutoVisitRecords.length > 0) bulkRecordVisits(addrAutoVisitRecords);
            totalVisits += addrAutoMatches.length;
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
  }, [vehicleList, selectedVehicle, selectedDate, stores, warehouses, customLocations, addressOverrides, logTravelEntries, bulkRecordVisits, manualMatchEntries, setAddressOverride]);

  // --- Manual matching ---
  const matchCandidates = useMemo(() => {
    if (!matchingEntry) return [];
    const vehicle = vehicleList.find(v => v.vin === matchingEntry.vehicleVin);
    const routeNum = vehicle?.routeNumber;
    // Always search ALL stores (same source as sidebar) — route-matched float to top
    let candidates = [...stores];
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
    candidates = candidates.slice().sort((a, b) => {
      const aRoute = routeNum && String(a.routeNumber).trim() === String(routeNum).trim();
      const bRoute = routeNum && String(b.routeNumber).trim() === String(routeNum).trim();
      if (aRoute && !bRoute) return -1;
      if (!aRoute && bRoute) return 1;
      if (dest) {
        const aAddr = (a.address || '').toLowerCase();
        const bAddr = (b.address || '').toLowerCase();
        const aMatch = dest.includes(aAddr.split(' ')[0]) || aAddr.includes(dest.split(',')[0].split(' ')[0]);
        const bMatch = dest.includes(bAddr.split(' ')[0]) || bAddr.includes(dest.split(',')[0].split(' ')[0]);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
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

  const handleAcceptSuggestion = useCallback((entry, store) => {
    manualMatchEntries([{
      vehicleVin: entry.vehicleVin,
      date: selectedDate,
      oldLocationId: entry.locationId,
      newEntry: {
        type: 'store',
        locationId: store.id,
        locationName: store.name,
        lat: store.lat,
        lng: store.lng,
      },
    }]);
    bulkRecordVisits([{ storeId: store.id, date: selectedDate }]);
    const dest = (entry.destination || '').trim();
    if (dest) setAddressOverride(dest, store.id);
    propagateMatchToSameDestination(entry, store, 'store');
    setDismissedSuggestions(prev => new Set([...prev, `${entry.locationId}-dest`]));
  }, [selectedDate, manualMatchEntries, bulkRecordVisits, setAddressOverride, propagateMatchToSameDestination]);

  const handleAcceptOriginSuggestion = useCallback((entry, store) => {
    logTravelEntries([{
      vehicleVin: entry.vehicleVin,
      vehicleId: entry.vehicleId,
      type: 'store',
      locationId: store.id,
      locationName: store.name,
      lat: store.lat,
      lng: store.lng,
      time: entry.arrivalTime,
      arrivalTime: entry.arrivalTime,
      departureTime: entry.arrivalTime,
      dwellMinutes: null,
    }]);
    bulkRecordVisits([{ storeId: store.id, date: selectedDate }]);
    const originAddr = (entry.origin || '').trim();
    if (originAddr) setAddressOverride(originAddr, store.id);
    setDismissedSuggestions(prev => new Set([...prev, `${entry.locationId}-origin`]));
  }, [selectedDate, logTravelEntries, bulkRecordVisits, setAddressOverride]);

  const handleDismissSuggestion = useCallback((locationId, type) => {
    setDismissedSuggestions(prev => new Set([...prev, `${locationId}-${type}`]));
  }, []);

  const handleMatchStore = useCallback((store) => {
    if (!matchingEntry) return;
    console.log(`[TravelLog] Manual match (${matchingField}): "${matchingEntry.locationName}" → store "${store.name}" (${store.id})`);
    if (matchingField === 'origin') {
      // Origin match: log a new store visit at arrival time
      logTravelEntries([{
        vehicleVin: matchingEntry.vehicleVin,
        vehicleId: matchingEntry.vehicleId,
        type: 'store',
        locationId: store.id,
        locationName: store.name,
        lat: store.lat,
        lng: store.lng,
        time: matchingEntry.arrivalTime,
        arrivalTime: matchingEntry.arrivalTime,
        departureTime: matchingEntry.arrivalTime,
        dwellMinutes: null,
      }]);
      bulkRecordVisits([{ storeId: store.id, date: selectedDate }]);
      const originAddr = (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || '').trim();
      if (originAddr) setAddressOverride(originAddr, store.id);
    } else {
      // Dest match: replace the driving entry
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
    }
    setMatchingEntry(null);
    setMatchSearch('');
  }, [matchingEntry, matchingField, selectedDate, manualMatchEntries, logTravelEntries, bulkRecordVisits, setAddressOverride, propagateMatchToSameDestination]);

  const handleMatchCustomLocation = useCallback((cl) => {
    if (!matchingEntry) return;
    console.log(`[TravelLog] Manual match (${matchingField}): "${matchingEntry.locationName}" → custom "${cl.name}" (${cl.type || 'custom'})`);
    if (matchingField === 'origin') {
      logTravelEntries([{
        vehicleVin: matchingEntry.vehicleVin,
        vehicleId: matchingEntry.vehicleId,
        type: cl.type || 'custom',
        locationId: cl.id,
        locationName: cl.name,
        lat: cl.lat,
        lng: cl.lng,
        time: matchingEntry.arrivalTime,
        arrivalTime: matchingEntry.arrivalTime,
        departureTime: matchingEntry.arrivalTime,
        dwellMinutes: null,
      }]);
      const originAddr = (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || '').trim();
      if (originAddr) setAddressOverride(originAddr, cl.id);
    } else {
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
    }
    setMatchingEntry(null);
    setMatchSearch('');
  }, [matchingEntry, matchingField, selectedDate, manualMatchEntries, logTravelEntries, setAddressOverride, propagateMatchToSameDestination]);

  const handleCreateAndMatch = useCallback(() => {
    if (!matchingEntry || !newLocName.trim()) return;
    const isOrigin = matchingField === 'origin';
    const addr = isOrigin
      ? (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || '').trim()
      : (matchingEntry.destination || '').trim();
    const lat = isOrigin ? matchingEntry.lat : (matchingEntry.destinationLat || matchingEntry.lat);
    const lng = isOrigin ? matchingEntry.lng : (matchingEntry.destinationLng || matchingEntry.lng);
    const id = uuidv4();
    const newLoc = { id, name: newLocName.trim(), type: newLocType, address: addr, lat, lng };
    console.log(`[TravelLog] Create & match (${matchingField}): "${matchingEntry.locationName}" → new "${newLoc.name}" (${newLocType})`);
    addCustomLocation(newLoc);
    if (isOrigin) {
      logTravelEntries([{
        vehicleVin: matchingEntry.vehicleVin,
        vehicleId: matchingEntry.vehicleId,
        type: newLocType,
        locationId: id,
        locationName: newLocName.trim(),
        lat, lng,
        time: matchingEntry.arrivalTime,
        arrivalTime: matchingEntry.arrivalTime,
        departureTime: matchingEntry.arrivalTime,
        dwellMinutes: null,
      }]);
    } else {
      manualMatchEntries([{
        vehicleVin: matchingEntry.vehicleVin,
        date: selectedDate,
        oldLocationId: matchingEntry.locationId,
        newEntry: { type: newLocType, locationId: id, locationName: newLocName.trim(), lat, lng },
      }]);
      propagateMatchToSameDestination(matchingEntry, newLoc, newLocType);
    }
    if (addr) setAddressOverride(addr, id);
    setMatchingEntry(null);
    setMatchSearch('');
    setNewLocName('');
    setNewLocType('gas-station');
  }, [matchingEntry, matchingField, selectedDate, newLocName, newLocType, addCustomLocation, manualMatchEntries, logTravelEntries, setAddressOverride, propagateMatchToSameDestination]);

  // Raw data total breadcrumb count
  const rawBreadcrumbCount = useMemo(() => {
    if (!rawData?.breadcrumbs) return 0;
    return Object.values(rawData.breadcrumbs).reduce((sum, arr) => sum + arr.length, 0);
  }, [rawData]);

  // Renders a single timeline entry card (shared by both panels)
  const renderEntry = (entry, i) => {
    const liveCl = entry.locationId ? customLocations.find(c => c.id === entry.locationId) : null;
    const liveStore = entry.type === 'store' && entry.locationId ? stores.find(s => s.id === entry.locationId) : null;
    const liveWh = entry.type === 'warehouse' && entry.locationId ? warehouses.find(w => w.id === entry.locationId) : null;
    const isResolved = !!(liveCl || liveStore || liveWh);
    const effectivelyUnmatched = entry.type !== 'driving' && !isResolved;
    const rawKey = entry.locationId || `${entry.vehicleVin}-${i}`;

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
              const originText = (entry.origin || cleanLocationName(entry.locationName || '').split(' \u2192 ')[0] || '').trim();
              const destText = (entry.destination || '').trim();
              // Resolve via address overrides for immediate visual feedback after matching
              const resolveId = (addr) => addr ? addressOverrides[addr] : null;
              const resolveLocation = (id) => {
                if (!id) return null;
                const cl = customLocations.find(c => c.id === id);
                if (cl) return { name: cl.name, addr: cl.address || '' };
                const st = stores.find(s => s.id === id);
                if (st) return { name: st.name, addr: [st.address, st.city, st.state].filter(Boolean).join(', ') };
                const wh = warehouses.find(w => w.id === id);
                if (wh) return { name: wh.name, addr: wh.address || '' };
                return null;
              };
              const originResolved = resolveLocation(resolveId(originText));
              const destResolved = resolveLocation(resolveId(destText));
              return (
                <div className="tl-driving-endpoints">
                  <div className="tl-driving-row">
                    <span className="tl-driving-label">Start:</span>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${originQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">
                      {originResolved ? `${originResolved.name}${originResolved.addr ? ': ' + originResolved.addr : ''}` : origin}
                    </a>
                    {originResolved
                      ? <button className="tl-driving-matched" onClick={(e) => { e.stopPropagation(); removeAddressOverride(originText); }}>✓ Matched</button>
                      : !isGarbageLocation(originText) && (
                          <button className="tl-match-btn" onClick={(e) => { e.stopPropagation(); setMatchingEntry(entry); setMatchingField('origin'); setMatchSearch(''); setMatchTab('stores'); }}>Match Start</button>
                        )
                    }
                  </div>
                  <div className="tl-driving-row">
                    <span className="tl-driving-label">End:</span>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${destQ}`} target="_blank" rel="noopener noreferrer" className="tl-map-link">
                      {destResolved ? `${destResolved.name}${destResolved.addr ? ': ' + destResolved.addr : ''}` : dest}
                    </a>
                    {destResolved
                      ? <button className="tl-driving-matched" onClick={(e) => { e.stopPropagation(); removeAddressOverride(destText); }}>✓ Matched</button>
                      : <button className="tl-match-btn" onClick={(e) => { e.stopPropagation(); setMatchingEntry(entry); setMatchingField('dest'); setMatchSearch(''); setMatchTab('stores'); }}>Match End</button>
                    }
                  </div>
                </div>
              );
            })() : (() => {
              const displayName = isResolved
                ? (liveCl?.name || liveWh?.name || liveStore?.name)
                : (entry.destination || cleanLocationName(entry.locationName) || (entry.lat && entry.lng ? `${entry.lat}, ${entry.lng}` : 'Unknown'));
              const storeAddr = liveStore ? [liveStore.address, liveStore.city, liveStore.state].filter(Boolean).join(', ') : '';
              const addr = isResolved
                ? ((entry.destination || '').trim() || liveCl?.address || storeAddr || liveWh?.address || '')
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
            {(entry.type === 'driving' || effectivelyUnmatched) && suggestions.has(entry.locationId) && (() => {
              const { origin: originSug, dest: destSug } = suggestions.get(entry.locationId);
              return (
                <>
                  {originSug && (
                    <span className="tl-suggestion-badge">
                      Origin: {originSug.name}
                      <button className="tl-suggest-accept" title="Accept" onClick={(e) => { e.stopPropagation(); handleAcceptOriginSuggestion(entry, originSug); }}>✓</button>
                      <button className="tl-suggest-dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); handleDismissSuggestion(entry.locationId, 'origin'); }}>✗</button>
                    </span>
                  )}
                  {destSug && (
                    <span className="tl-suggestion-badge">
                      Dest: {destSug.name}
                      <button className="tl-suggest-accept" title="Accept" onClick={(e) => { e.stopPropagation(); handleAcceptSuggestion(entry, destSug); }}>✓</button>
                      <button className="tl-suggest-dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); handleDismissSuggestion(entry.locationId, 'dest'); }}>✗</button>
                    </span>
                  )}
                </>
              );
            })()}
            {effectivelyUnmatched && (
              <button
                className="tl-match-btn"
                onClick={(e) => { e.stopPropagation(); setMatchingEntry(entry); setMatchingField('dest'); setMatchSearch(''); setMatchTab('stores'); }}
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
              onClick={(e) => { e.stopPropagation(); setExpandedRawIndex(expandedRawIndex === rawKey ? null : rawKey); }}
              title="View raw entry data"
            >
              {'{'}...{'}'}
            </button>
          </div>
          {expandedRawIndex === rawKey && (
            <pre className="tl-entry-raw">{JSON.stringify(entry, null, 2)}</pre>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="tl-page">
      {/* Row 1: Title + Stats | Date + Span */}
      <div className="tl-top-bar">
        <div className="tl-top-left">
          <h2>Travel Log</h2>
          <div className="tl-badges">
            {stats.vehicleCount > 0 && <span className="tl-badge" title={`${stats.vehicleCount} vehicle${stats.vehicleCount !== 1 ? 's' : ''}`}>{stats.vehicleCount} vehicles</span>}
            <span className="tl-badge blue" title={`${stats.storeVisits} store visits`}>{stats.storeVisits} stores</span>
            <span className="tl-badge orange" title={`${stats.warehouseVisits} warehouse stops`}>{stats.warehouseVisits} wh</span>
            <span className="tl-badge" title={`${stats.drivingSegments} driving segments`}>{stats.drivingSegments} drives</span>
            {stats.totalMiles > 0 && <span className="tl-badge" title={`${stats.totalMiles.toFixed(1)} miles driven`}>{stats.totalMiles.toFixed(0)} mi</span>}
            {stats.fuel?.mpg && <span className="tl-badge green" title={`${stats.fuel.mpg.toFixed(1)} miles per gallon`}>{stats.fuel.mpg.toFixed(1)} mpg</span>}
            {unmappedCards.length > 0 && (
              <span className="tl-badge red" style={{ cursor: 'pointer' }} onClick={() => setShowCardMapping(!showCardMapping)} title={`${unmappedCards.length} unmapped fuel card(s)`}>
                {unmappedCards.length} unmapped
              </span>
            )}
          </div>
        </div>
        <div className="tl-top-right">
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} max={today} />
          <div className="tl-span-btns">
            <button className={`tl-span-btn${selectedSpan === 'day' ? ' active' : ''}`} onClick={() => setSelectedSpan('day')}>Day</button>
            <button className={`tl-span-btn${selectedSpan === 'week' ? ' active' : ''}`} onClick={() => setSelectedSpan('week')}>7d</button>
            <button className={`tl-span-btn${selectedSpan === '2week' ? ' active' : ''}`} onClick={() => setSelectedSpan('2week')}>14d</button>
            <button className={`tl-span-btn${selectedSpan === 'month' ? ' active' : ''}`} onClick={() => setSelectedSpan('month')}>30d</button>
          </div>
        </div>
      </div>

      {/* Row 2: Vehicle + Actions | Filters + Mode Toggle */}
      <div className="tl-filter-bar">
        <div className="tl-filter-left">
          <select value={selectedVehicle} onChange={e => setSelectedVehicle(e.target.value)}>
            <option value="all">All Vehicles</option>
            {vehicleList.map(v => (
              <option key={v.vin} value={v.vin}>{v.label}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={handleProcessDay} disabled={processing}>
            {processing ? 'Processing...' : `Process ${selectedDate === today ? 'Today' : selectedDate}`}
          </button>
          {rawData && (
            <button className="btn btn-outline tl-raw-btn" onClick={() => setShowRawData(true)} title="View raw API data from Motive">Raw Data</button>
          )}
        </div>
        <div className="tl-filter-right">
          <button className={`tl-filter-chip${showBreadcrumbs ? ' active' : ''}`} onClick={() => setShowBreadcrumbs(b => !b)}>
            Breadcrumbs ({breadcrumbEntries.length})
          </button>
          <button className={`tl-filter-chip${showDrivingPeriods ? ' active' : ''}`} onClick={() => setShowDrivingPeriods(b => !b)}>
            Driving ({drivingEntries.length})
          </button>
          <div className="tl-mode-toggle">
            <button className={`tl-mode-btn${rightPanelMode === 'data' ? ' active' : ''}`} onClick={() => setRightPanelMode('data')}>Data</button>
            <button className={`tl-mode-btn${rightPanelMode === 'search' ? ' active' : ''}`} onClick={() => { setRightPanelMode('search'); setSelectedSearchStore(null); }}>Search</button>
          </div>
        </div>
      </div>

      {/* Process status */}
      {processStatus && (
        <div className={`tl-status tl-status-${processStatus.type}`}>
          {processStatus.message}
        </div>
      )}

      {/* Card-to-Route Mapping Panel */}
      {showCardMapping && unmappedCards.length > 0 && (
        <div className="tl-card-mapping">
          <div className="tl-card-mapping-header">
            <h4>Map Fuel Cards to Routes</h4>
            <span className="tl-card-mapping-subtitle">
              {unmappedCards.length} card{unmappedCards.length !== 1 ? 's' : ''} with ${unmappedCards.reduce((s, c) => s + c.totalAmount, 0).toFixed(2)} in untracked fuel spend
            </span>
            <button className="tl-card-mapping-close" onClick={() => setShowCardMapping(false)}>&times;</button>
          </div>
          <div className="tl-card-mapping-list">
            {unmappedCards.map(card => (
              <div key={card.last4 || card.cardId} className="tl-card-mapping-row">
                <div className="tl-card-mapping-info">
                  <span className="tl-card-mapping-num">****{card.last4 || '????'}</span>
                  <span className="tl-card-mapping-stats">
                    {card.txCount} txn{card.txCount !== 1 ? 's' : ''} &middot; ${card.totalAmount.toFixed(2)} &middot; {card.totalGallons.toFixed(1)} gal
                  </span>
                </div>
                <select
                  className="tl-card-mapping-select"
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value || !card.cardId) return;
                    const map = JSON.parse(localStorage.getItem('fuel_card_route_map') || '{}');
                    map[card.cardId] = e.target.value;
                    localStorage.setItem('fuel_card_route_map', JSON.stringify(map));
                    setCardMapVersion(v => v + 1); // triggers re-fetch
                  }}
                >
                  <option value="">Assign to route...</option>
                  {[...new Set(vehicleList.map(v => v.routeNumber).filter(Boolean))].sort((a, b) => Number(a) - Number(b)).map(r => (
                    <option key={r} value={r}>Route {r}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body: Map left + Panels right */}
      <div className="tl-body">
        <div className="tl-map-sidebar">
          <MapContainer
            center={[39.3, -76.6]}
            zoom={10}
            style={{ height: '100%', width: '100%', borderRadius: '8px' }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={mapPoints} />
            {selectedSearchStore && <FlyToStore store={selectedSearchStore} />}
            {selectedSearchStore && selectedSearchStore.lat && selectedSearchStore.lng && (
              <Marker position={[selectedSearchStore.lat, selectedSearchStore.lng]} icon={searchStoreIcon}>
                <Popup><strong>{selectedSearchStore.name}</strong><br />{[selectedSearchStore.address, selectedSearchStore.city, selectedSearchStore.state].filter(Boolean).join(', ')}</Popup>
              </Marker>
            )}
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
        <div className="tl-right-panel">
        {rightPanelMode === 'data' ? (<>
        {showBreadcrumbs && (
          <div className="tl-panel tl-panel-breadcrumbs">
            <div className="tl-panel-header">
              <span>Breadcrumb Visits</span>
              <div className="tl-panel-header-actions">
                <span className="tl-panel-count">{breadcrumbEntries.length} stops</span>
                <button
                  className={`tl-map-toggle-btn${breadcrumbsOnMap ? ' active' : ''}`}
                  onClick={() => setBreadcrumbsOnMap(b => !b)}
                  title={breadcrumbsOnMap ? 'Hide on map' : 'Show on map'}
                >
                  {breadcrumbsOnMap ? '📍 Map On' : '📍 Map Off'}
                </button>
              </div>
            </div>
            <div className="tl-panel-scroll">
              {breadcrumbEntries.length === 0
                ? <div className="tl-empty" style={{ marginLeft: 0 }}>No breadcrumb visits for this day / vehicle.</div>
                : (
                  <table className="tl-bc-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Arrive</th>
                        <th>Depart</th>
                        <th>Dwell</th>
                        <th>Location</th>
                        <th>Type</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {breadcrumbEntries.map((entry, i) => {
                        const liveCl = entry.locationId ? customLocations.find(c => c.id === entry.locationId) : null;
                        const liveStore = entry.type === 'store' && entry.locationId ? stores.find(s => s.id === entry.locationId) : null;
                        const liveWh = entry.type === 'warehouse' && entry.locationId ? warehouses.find(w => w.id === entry.locationId) : null;
                        const isResolved = !!(liveCl || liveStore || liveWh);
                        const effectivelyUnmatched = entry.type !== 'driving' && !isResolved;
                        const displayName = isResolved
                          ? (liveCl?.name || liveWh?.name || liveStore?.name)
                          : (entry.destination || cleanLocationName(entry.locationName) || (entry.lat && entry.lng ? `${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)}` : 'Unknown'));
                        const storeAddr = liveStore ? [liveStore.address, liveStore.city, liveStore.state].filter(Boolean).join(', ') : '';
                        const addr = isResolved ? ((entry.destination || '').trim() || liveCl?.address || storeAddr || liveWh?.address || '') : '';
                        const fmtTime = (t) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
                        const arriveTime = fmtTime(entry.arrivalTime || entry.time);
                        const departTime = fmtTime(entry.departureTime);
                        const typeLabel = effectivelyUnmatched ? 'Unmatched' : getTypeLabel(entry.type);
                        const typeClass = effectivelyUnmatched ? 'driving' : entry.type;
                        const rawKey = entry.locationId || `${entry.vehicleVin}-${i}`;
                        const mapQuery = (entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(displayName);

                        return (
                          <React.Fragment key={`${entry.vehicleVin}-${entry.locationId}-${i}`}>
                            <tr className={`tl-bc-row tl-bc-${typeClass}`}>
                              <td className="tl-bc-num">{i + 1}</td>
                              <td className="tl-bc-time">{arriveTime}</td>
                              <td className="tl-bc-time">{departTime}</td>
                              <td className="tl-bc-dwell">{entry.dwellMinutes != null ? `${entry.dwellMinutes}m` : '-'}</td>
                              <td className="tl-bc-loc">
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="tl-bc-loc-link"
                                >
                                  {displayName}
                                </a>
                                {addr && <span className="tl-bc-addr">{addr}</span>}
                              </td>
                              <td>
                                <span
                                  className={`tl-type-badge ${typeClass}`}
                                  style={!effectivelyUnmatched && !['store','warehouse','driving'].includes(entry.type) ? { background: getTypeColor(entry.type), color: '#fff' } : undefined}
                                >
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="tl-bc-actions">
                                {effectivelyUnmatched && (
                                  <button className="tl-match-btn" onClick={() => { setMatchingEntry(entry); setMatchingField('dest'); setMatchSearch(''); setMatchTab('stores'); }}>Match</button>
                                )}
                                {isResolved && entry.type !== 'driving' && (
                                  <button className="tl-delete-btn" onClick={() => {
                                    const matchedName = liveCl?.name || liveStore?.name || liveWh?.name || entry.locationName;
                                    if (window.confirm(`Unmatch "${matchedName}"?`)) unmatchEntry(entry.vehicleVin, selectedDate, entry.locationId);
                                  }}>Unmatch</button>
                                )}
                                {entry.locationId && liveCl && (
                                  <>
                                    <button className="tl-edit-btn" onClick={() => { setEditForm({ name: liveCl.name, type: liveCl.type, address: liveCl.address || '' }); setEditingLocationId(liveCl.id); }}>Edit</button>
                                    <button className="tl-delete-btn" onClick={() => { if (window.confirm(`Delete "${liveCl.name}"?`)) deleteCustomLocation(liveCl.id); }}>Delete</button>
                                  </>
                                )}
                                <button className="tl-raw-toggle-btn" onClick={() => setExpandedRawIndex(expandedRawIndex === rawKey ? null : rawKey)} title="Raw data">{'{'}...{'}'}</button>
                              </td>
                            </tr>
                            {expandedRawIndex === rawKey && (
                              <tr><td colSpan="7"><pre className="tl-entry-raw">{JSON.stringify(entry, null, 2)}</pre></td></tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        )}
        {showDrivingPeriods && (
          <div className="tl-panel tl-panel-driving">
            <div className="tl-panel-header">
              <span>Driving Periods</span>
              <div className="tl-panel-header-actions">
                <span className="tl-panel-count">{drivingEntries.length} segments</span>
                <button
                  className={`tl-map-toggle-btn${drivingOnMap ? ' active' : ''}`}
                  onClick={() => setDrivingOnMap(b => !b)}
                  title={drivingOnMap ? 'Hide on map' : 'Show on map'}
                >
                  {drivingOnMap ? '📍 Map On' : '📍 Map Off'}
                </button>
              </div>
            </div>
            <div className="tl-panel-scroll">
              {drivingEntries.length === 0
                ? <div className="tl-empty" style={{ marginLeft: 0 }}>No driving periods for this day / vehicle.</div>
                : (
                  <table className="tl-bc-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Start</th>
                        <th>Duration</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Dist</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivingEntries.map((entry, i) => {
                        const fmtTime = (t) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
                        const startTime = fmtTime(entry.arrivalTime || entry.time);
                        const parts = cleanLocationName(entry.locationName || '').split(' \u2192 ');
                        const rawOrigin = isGarbageLocation(parts[0]) ? 'Unknown' : parts[0];
                        const rawDest = isGarbageLocation(parts[1]) ? 'Unknown' : parts[1];
                        const originText = (entry.origin || rawOrigin || '').trim();
                        const destText = (entry.destination || rawDest || '').trim();
                        const originQ = (entry.lat && entry.lng) ? `${entry.lat},${entry.lng}` : encodeURIComponent(rawOrigin);
                        const destQ = (entry.destinationLat && entry.destinationLng) ? `${entry.destinationLat},${entry.destinationLng}` : encodeURIComponent(rawDest);
                        const resolveId = (addr) => addr ? addressOverrides[addr] : null;
                        const resolveLocation = (id) => {
                          if (!id) return null;
                          const cl = customLocations.find(c => c.id === id);
                          if (cl) return { name: cl.name, addr: cl.address || '' };
                          const st = stores.find(s => s.id === id);
                          if (st) return { name: st.name, addr: [st.address, st.city, st.state].filter(Boolean).join(', ') };
                          const wh = warehouses.find(w => w.id === id);
                          if (wh) return { name: wh.name, addr: wh.address || '' };
                          return null;
                        };
                        const originResolved = resolveLocation(resolveId(originText));
                        const destResolved = resolveLocation(resolveId(destText));
                        const rawKey = entry.locationId || `${entry.vehicleVin}-dp-${i}`;
                        const hasSuggestion = suggestions.has(entry.locationId);
                        const sug = hasSuggestion ? suggestions.get(entry.locationId) : null;

                        return (
                          <React.Fragment key={`dp-${entry.vehicleVin}-${i}`}>
                            <tr className="tl-bc-row tl-bc-driving">
                              <td className="tl-bc-num">{i + 1}</td>
                              <td className="tl-bc-time">{startTime}</td>
                              <td className="tl-bc-dwell">{entry.dwellMinutes != null ? `${entry.dwellMinutes}m` : '-'}</td>
                              <td className="tl-bc-loc">
                                <a href={`https://www.google.com/maps/search/?api=1&query=${originQ}`} target="_blank" rel="noopener noreferrer" className="tl-bc-loc-link">
                                  {originResolved ? originResolved.name : rawOrigin}
                                </a>
                                {originResolved
                                  ? <button className="tl-driving-matched" onClick={() => removeAddressOverride(originText)}>Matched</button>
                                  : !isGarbageLocation(originText) && <button className="tl-match-btn" onClick={() => { setMatchingEntry(entry); setMatchingField('origin'); setMatchSearch(''); setMatchTab('stores'); }}>Match</button>
                                }
                              </td>
                              <td className="tl-bc-loc">
                                <a href={`https://www.google.com/maps/search/?api=1&query=${destQ}`} target="_blank" rel="noopener noreferrer" className="tl-bc-loc-link">
                                  {destResolved ? destResolved.name : rawDest}
                                </a>
                                {destResolved
                                  ? <button className="tl-driving-matched" onClick={() => removeAddressOverride(destText)}>Matched</button>
                                  : <button className="tl-match-btn" onClick={() => { setMatchingEntry(entry); setMatchingField('dest'); setMatchSearch(''); setMatchTab('stores'); }}>Match</button>
                                }
                                {sug?.dest && (
                                  <span className="tl-suggestion-badge">
                                    {sug.dest.name}
                                    <button className="tl-suggest-accept" title="Accept" onClick={() => handleAcceptSuggestion(entry, sug.dest)}>&#10003;</button>
                                    <button className="tl-suggest-dismiss" title="Dismiss" onClick={() => handleDismissSuggestion(entry.locationId, 'dest')}>&#10007;</button>
                                  </span>
                                )}
                              </td>
                              <td className="tl-bc-dist">{entry.distance > 0 ? `${entry.distance} mi` : '-'}</td>
                              <td className="tl-bc-actions">
                                <button className="tl-raw-toggle-btn" onClick={() => setExpandedRawIndex(expandedRawIndex === rawKey ? null : rawKey)} title="Raw data">{'{'}...{'}'}</button>
                              </td>
                            </tr>
                            {expandedRawIndex === rawKey && (
                              <tr><td colSpan="7"><pre className="tl-entry-raw">{JSON.stringify(entry, null, 2)}</pre></td></tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        )}
        {!showBreadcrumbs && !showDrivingPeriods && (
          <div className="tl-empty" style={{ flex: 1 }}>Both panels are hidden — use the toggles above to show data.</div>
        )}
        </>) : (
          <div className="tl-search-panel">
            <div className="tl-search-input-wrap">
              <input
                className="tl-search-input"
                type="text"
                placeholder="Search stores by name, ID, city, or route..."
                value={storeSearchQuery}
                onChange={e => { setStoreSearchQuery(e.target.value); setSelectedSearchStore(null); }}
              />
            </div>
            {!selectedSearchStore ? (
              <div className="tl-search-results">
                {storeSearchResults.map(store => (
                  <div key={store.id} className="tl-search-item" onClick={() => setSelectedSearchStore(store)}>
                    <div className="tl-search-name">{store.name}</div>
                    <div className="tl-search-addr">{[store.address, store.city, store.state].filter(Boolean).join(', ')}</div>
                    <span className="tl-search-route">Route {store.routeNumber || '?'}</span>
                  </div>
                ))}
                {storeSearchQuery.length >= 2 && storeSearchResults.length === 0 && (
                  <div className="tl-search-empty">No stores match &ldquo;{storeSearchQuery}&rdquo;</div>
                )}
                {storeSearchQuery.length < 2 && (
                  <div className="tl-search-empty">Type at least 2 characters to search</div>
                )}
              </div>
            ) : (
              <div className="tl-search-detail">
                <div className="tl-search-store-header">
                  <button className="tl-search-back" onClick={() => setSelectedSearchStore(null)}>&larr; Back</button>
                  <h4>{selectedSearchStore.name}</h4>
                  <span className="tl-search-store-meta">
                    {[selectedSearchStore.address, selectedSearchStore.city, selectedSearchStore.state].filter(Boolean).join(', ')} &middot; Route {selectedSearchStore.routeNumber || '?'}
                  </span>
                </div>
                <div className="tl-search-visits-count">{selectedStoreVisits.length} visit{selectedStoreVisits.length !== 1 ? 's' : ''} found</div>
                {selectedStoreVisits.length > 0 ? (
                  <table className="tl-bc-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Arrive</th>
                        <th>Depart</th>
                        <th>Dwell</th>
                        <th>Vehicle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStoreVisits.map((v, i) => (
                        <tr key={i} className="tl-bc-row tl-bc-store">
                          <td>{v.date}</td>
                          <td className="tl-bc-time">{v.arrivalTime ? new Date(v.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
                          <td className="tl-bc-time">{v.departureTime ? new Date(v.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</td>
                          <td className="tl-bc-dwell">{v.dwellMinutes != null ? `${v.dwellMinutes}m` : '-'}</td>
                          <td>{v.vehicle}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="tl-search-empty">No recorded visits for this store.</div>
                )}
                {/* Mini calendar showing visit dates */}
                {(() => {
                  const visitDates = new Set(selectedStoreVisits.map(v => v.date));
                  // Show current month calendar
                  const now = new Date();
                  const year = now.getFullYear();
                  const month = now.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const prevMonth = month === 0 ? 11 : month - 1;
                  const prevYear = month === 0 ? year - 1 : year;
                  const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
                  const prevFirstDay = new Date(prevYear, prevMonth, 1).getDay();
                  const prevDaysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
                  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                  const pad = n => String(n).padStart(2, '0');
                  const renderMonth = (y, m, dInM, fDay) => {
                    const cells = [];
                    for (let i = 0; i < fDay; i++) cells.push(<td key={`e${i}`} className="tl-cal-empty"></td>);
                    for (let d = 1; d <= dInM; d++) {
                      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
                      const isVisit = visitDates.has(ds);
                      const isToday = ds === localDateStr();
                      cells.push(
                        <td key={d} className={`tl-cal-day${isVisit ? ' visit' : ''}${isToday ? ' today' : ''}`}>
                          {d}
                        </td>
                      );
                    }
                    const rows = [];
                    for (let i = 0; i < cells.length; i += 7) rows.push(<tr key={i}>{cells.slice(i, i + 7)}</tr>);
                    return rows;
                  };
                  return (
                    <div className="tl-cal-wrap">
                      <div className="tl-cal-box">
                        <div className="tl-cal-title">{monthNames[prevMonth]} {prevYear}</div>
                        <table className="tl-cal-table">
                          <thead><tr>{'SMTWTFS'.split('').map((d,i) => <th key={i}>{d}</th>)}</tr></thead>
                          <tbody>{renderMonth(prevYear, prevMonth, prevDaysInMonth, prevFirstDay)}</tbody>
                        </table>
                      </div>
                      <div className="tl-cal-box">
                        <div className="tl-cal-title">{monthNames[month]} {year}</div>
                        <table className="tl-cal-table">
                          <thead><tr>{'SMTWTFS'.split('').map((d,i) => <th key={i}>{d}</th>)}</tr></thead>
                          <tbody>{renderMonth(year, month, daysInMonth, firstDay)}</tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
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
              <span className="tl-match-label">Motive {matchingField === 'origin' ? 'Origin' : 'Destination'}:</span>
              <span className="tl-match-addr">
                {matchingField === 'origin'
                  ? (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || 'Unknown')
                  : (matchingEntry.destination || matchingEntry.locationName?.split('\u2192')[1]?.trim() || 'Unknown')}
              </span>
              {(() => {
                const addr = matchingField === 'origin'
                  ? (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || '').trim()
                  : (matchingEntry.destination || '').trim();
                if (!addr || !addressOverrides[addr]) return null;
                const savedId = addressOverrides[addr];
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
                    <label>Address (from {matchingField === 'origin' ? 'origin' : 'destination'})</label>
                    <input
                      type="text"
                      value={matchingField === 'origin'
                        ? (matchingEntry.origin || cleanLocationName(matchingEntry.locationName || '').split(' \u2192 ')[0] || '')
                        : (matchingEntry.destination || '')}
                      readOnly
                      className="tl-create-readonly"
                    />
                  </div>
                  <div className="tl-create-field">
                    <label>Coordinates</label>
                    <input
                      type="text"
                      value={matchingField === 'origin'
                        ? `${matchingEntry.lat || '?'}, ${matchingEntry.lng || '?'}`
                        : `${matchingEntry.destinationLat || matchingEntry.lat || '?'}, ${matchingEntry.destinationLng || matchingEntry.lng || '?'}`}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  Tooltip,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import { sendWhatsAppAlert, sendWhatsAppAlertWithImage, getWhatsAppStatus } from '../services/whatsappService';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const typeColors = {
  'food-lion': '#ef4444',
  'shoppers': '#3b82f6',
  'shoprite': '#0ea5e9',
  'wegmans': '#8b5cf6',
  'walmart': '#f59e0b',
  'giant-martins': '#f97316',
  'weis': '#06b6d4',
  'redners': '#ec4899',
  'acme': '#22c55e',
  'geresbecks': '#14b8a6',
  'military': '#4f46e5',
  'other': '#6b7280',
};

const typeLabels = {
  'food-lion': 'Food Lion',
  'shoppers': 'Shoppers',
  'shoprite': 'ShopRite',
  'wegmans': 'Wegmans',
  'walmart': 'Walmart',
  'giant-martins': 'Giant/Martins',
  'weis': 'Weis',
  'redners': 'Redners',
  'acme': 'Acme',
  'geresbecks': 'Geresbecks',
  'military': 'Military',
  'other': 'Other',
};

const recencyTiers = [
  { label: '0-7 days', color: '#22c55e', maxDays: 7, pulse: null },
  { label: '8-10 days', color: '#3b82f6', maxDays: 10, pulse: null },
  { label: '11-15 days', color: '#eab308', maxDays: 15, pulse: 'pulse-slow' },
  { label: '16-30 days', color: '#f97316', maxDays: 30, pulse: 'pulse-medium' },
  { label: '31-89 days', color: '#ef4444', maxDays: 89, pulse: 'pulse-fast' },
  { label: 'Dormant (90+ days)', color: '#6b7280', maxDays: Infinity, pulse: null },
];
const neverVisitedTier = { label: 'Never visited', color: '#9ca3af', pulse: null };

// Return the most recent of lastSaleDate and lastVisited
function getLatestDate(store) {
  return [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
}

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const raw = lastVisited.split('T')[0];
  const visited = new Date(raw + 'T00:00:00');
  if (isNaN(visited.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - visited) / (1000 * 60 * 60 * 24));
}

function getRecencyTier(lastVisited) {
  const days = getDaysSinceVisit(lastVisited);
  if (days === null) return neverVisitedTier;
  for (const tier of recencyTiers) {
    if (days <= tier.maxDays) return tier;
  }
  return recencyTiers[recencyTiers.length - 1];
}

function createStoreIcon(type, isSelected, visitMode, lastVisited, activePulseTiers, missed) {
  const baseColor = missed
    ? '#ef4444'
    : visitMode
      ? getRecencyTier(lastVisited).color
      : (typeColors[type] || typeColors.other);
  const size = isSelected ? 14 : 10;
  const border = isSelected ? '3px solid #1e3a5f' : '2px solid #000';
  const blinkClass = isSelected ? 'marker-blink' : '';
  const tier = visitMode ? getRecencyTier(lastVisited) : null;
  const pulseClass = (visitMode && tier && tier.pulse && activePulseTiers && activePulseTiers.has(tier.label)) ? tier.pulse : '';
  const pulseRing = pulseClass
    ? `<div class="${pulseClass}" style="
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: ${size + 16}px;
        height: ${size + 16}px;
        border-radius: 50%;
        border: 2px solid ${baseColor};
        pointer-events: none;
      "></div>`
    : '';

  return L.divIcon({
    className: `custom-marker ${blinkClass}`,
    html: `<div style="position:relative; display:flex; align-items:center; justify-content:center; width:${size + 20}px; height:${size + 20}px;">
      ${pulseRing}
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${baseColor};
        border-radius: 50%;
        border: ${border};
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        position: relative;
        z-index: 2;
      "></div>
    </div>`,
    iconSize: [size + 20, size + 20],
    iconAnchor: [(size + 20) / 2, (size + 20) / 2],
  });
}

const alertExclaimIcon = L.divIcon({
  className: 'alert-exclaim-marker',
  html: '<div class="map-alert-exclaim">!</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 32],
});
const alertExclaimPulseIcon = L.divIcon({
  className: 'alert-exclaim-marker',
  html: '<div class="map-alert-exclaim map-alert-pulse">!</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 32],
});

// Truck icon for fleet vehicle overlay (diamond shape to distinguish from store circles)
function createTruckOverlayIcon(engineStatus) {
  const color = engineStatus === 'on' ? '#22c55e' : engineStatus === 'off' ? '#ef4444' : '#9ca3af';
  return L.divIcon({
    className: 'fleet-overlay-marker',
    html: `<div style="
      width: 12px; height: 12px;
      background: ${color};
      border-radius: 3px;
      border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      transform: rotate(45deg);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Never';
  const raw = dateStr.split('T')[0];
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) return 'Never';
  const formatted = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const days = getDaysSinceVisit(dateStr);
  if (days === null) return formatted;
  if (days === 0) return `${formatted} (today)`;
  if (days === 1) return `${formatted} (1 day ago)`;
  return `${formatted} (${days} days ago)`;
}

export default function MapView() {
  const { state, selectStore, selectZone, selectSubZone, setMapView, setSearch, setFilterRegion, setFilterType, setFilterRoute, updateStore, recordVisit, toggleVehiclesOnMap, loadAlertImage } = useApp();
  const { stores, zones, selectedStore, selectedZone, selectedSubZone, mapCenter, mapZoom, searchTerm, filterRegion, filterType, filterRoute, vehicleLocations, showVehiclesOnMap, alerts, alertImages } = state;

  // Build set of store IDs that have at least one truly open alert
  // Excludes completed and done alerts — map only shows unresolved
  const storesWithOpenAlerts = useMemo(() => {
    const set = new Set();
    if (!alerts || alerts.length === 0) return set;
    const storeById = {};
    stores.forEach(s => { storeById[s.id] = s; });
    alerts.forEach(a => {
      if (!a.dateReceived) return;
      // Map only shows truly open alerts
      if (a.globalworxCompleted || a.globalworxDone) return;
      const store = a.storeId
        ? storeById[a.storeId]
        : stores.find(s => s.storeNumber === a.storeNumber);
      if (!store) return;
      const lastVisited = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
      if (!lastVisited) { set.add(store.id); return; }
      const visitDate = lastVisited.split('T')[0].split(' ')[0];
      if (visitDate < a.dateReceived) set.add(store.id);
    });
    return set;
  }, [alerts, stores]);

  const [hiddenZones, setHiddenZones] = useState(new Set());
  const [visitMode, setVisitMode] = useState(true);
  const [legendFilter, setLegendFilter] = useState(new Set()); // Set of active tier labels (inclusion)
  const [hiddenTiers, setHiddenTiers] = useState(new Set(['Dormant (90+ days)', 'Never visited'])); // exclusion filter
  const [zonesOff, setZonesOff] = useState(true); // default: zones hidden
  const [showAlerts, setShowAlerts] = useState(false); // toggle alert markers on map (off by default)
  const [pulseTiers, setPulseTiers] = useState(new Set()); // which tiers pulse on alert markers (all off by default)
  const [hideCash, setHideCash] = useState(true);
  const [hideChain, setHideChain] = useState(false);
  const [salesDayFilter, setSalesDayFilter] = useState(new Set()); // 'today' | 'yesterday'
  const zonesInitialized = useRef(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [copiedRouteFlash, setCopiedRouteFlash] = useState(null);
  const [copiedPopupId, setCopiedPopupId] = useState(null);
  const [staleCollapsed, setStaleCollapsed] = useState(false);
  const [popupEditId, setPopupEditId] = useState(null);
  const [popupEditDate, setPopupEditDate] = useState('');
  const popupDateRef = useRef(null);
  const [waSending, setWaSending] = useState(null); // store.id while sending
  const [waSent, setWaSent] = useState(null); // store.id after sent
  const [waSentTo, setWaSentTo] = useState(null); // group name after sent

  // Check WhatsApp status on mount
  const waStatusRef = useRef('offline');
  useEffect(() => {
    getWhatsAppStatus().then(r => { waStatusRef.current = r.status; }).catch(() => {});
  }, []);

  // Get alerts for a specific store
  const getStoreAlerts = useCallback((storeId) => {
    if (!alerts || alerts.length === 0) return [];
    return alerts.filter(a => a.storeId === storeId);
  }, [alerts]);

  // Hide all zones on first load (zones default off)
  useEffect(() => {
    if (!zonesInitialized.current && zones.length > 0) {
      zonesInitialized.current = true;
      setHiddenZones(new Set(zones.filter(z => z.name !== 'Unassigned').map(z => z.id)));
    }
  }, [zones]);

  // Auto-deselect store after 10 seconds of blinking
  const blinkTimer = useRef(null);
  useEffect(() => {
    if (blinkTimer.current) clearTimeout(blinkTimer.current);
    if (selectedStore) {
      blinkTimer.current = setTimeout(() => selectStore(null), 10000);
    }
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current); };
  }, [selectedStore, selectStore]);

  // Available routes for popup assign dropdown
  const routes = useMemo(() => {
    const set = new Set(stores.map((s) => s.routeNumber).filter((r) => r && r !== '0'));
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [stores]);

  function hideZone(zoneId) {
    setHiddenZones((prev) => {
      const next = new Set(prev);
      next.add(zoneId);
      return next;
    });
  }

  function showZone(zoneId) {
    setHiddenZones((prev) => {
      const next = new Set(prev);
      next.delete(zoneId);
      if (next.size === 0) setZonesOff(false);
      return next;
    });
  }

  function showAllZones() {
    setHiddenZones(new Set());
    setZonesOff(false);
  }

  function hideAllZones() {
    const allZoneIds = new Set(zones.filter(z => z.name !== 'Unassigned').map(z => z.id));
    setHiddenZones(allZoneIds);
    setZonesOff(true);
  }

  function toggleAllZones() {
    if (zonesOff) {
      showAllZones();
    } else {
      hideAllZones();
    }
  }

  const hasActiveFilters = searchTerm || filterRegion !== 'all' || filterType !== 'all' || filterRoute !== 'all' || selectedStore || selectedZone || selectedSubZone || hiddenZones.size > 0;

  function resetAll() {
    setSearch('');
    setFilterRegion('all');
    setFilterType('all');
    setFilterRoute('all');
    selectStore(null);
    selectZone(null);
    selectSubZone(null);
    // Restore default view state
    setVisitMode(true);
    setLegendFilter(new Set());
    setHideCash(true);
    setHideChain(false);
    setStaleCollapsed(false);
    hideAllZones();
    setMapView([39.0, -76.8], 8);
  }

  // Today / yesterday date strings for sales day filter
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const yesterdayStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const thisWeekRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 7);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(start), end: fmt(now) };
  }, []);

  // Filter stores to match sidebar filters
  const filteredStores = useMemo(() => {
    let result = stores;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          s.city.toLowerCase().includes(term) ||
          s.address.toLowerCase().includes(term) ||
          (s.storeNumber || '').toLowerCase().includes(term)
      );
    }

    if (filterRegion !== 'all') {
      result = result.filter((s) => s.region === filterRegion);
    }

    if (filterType !== 'all') {
      result = result.filter((s) => s.type === filterType);
    }

    if (filterRoute !== 'all') {
      if (filterRoute === 'MIL') {
        result = result.filter((s) => s.id.startsWith('CMW'));
      } else {
        result = result.filter((s) => s.routeNumber === filterRoute);
      }
    }

    if (hideCash) {
      result = result.filter((s) => s.type !== 'other');
    }

    if (hideChain) {
      result = result.filter((s) => s.type === 'other' || s.type === 'military');
    }

    // Legend tier filter (only active when visitMode is on and at least one tier is checked)
    if (visitMode && legendFilter.size > 0) {
      result = result.filter((s) => {
        const days = getDaysSinceVisit(getLatestDate(s));
        if (days === null) return legendFilter.has(neverVisitedTier.label);
        for (let idx = 0; idx < recencyTiers.length; idx++) {
          const tier = recencyTiers[idx];
          const prevMax = recencyTiers[idx - 1]?.maxDays ?? -1;
          if (days > prevMax && days <= tier.maxDays) return legendFilter.has(tier.label);
        }
        return false;
      });
    }

    // Hidden tiers exclusion filter (hides dormant/never visited by default; always applies when no route selected, or when a sales day filter is active)
    if (visitMode && hiddenTiers.size > 0 && (filterRoute === 'all' || salesDayFilter.size > 0)) {
      result = result.filter((s) => {
        const days = getDaysSinceVisit(getLatestDate(s));
        if (days === null) return !hiddenTiers.has(neverVisitedTier.label);
        for (let idx = 0; idx < recencyTiers.length; idx++) {
          const tier = recencyTiers[idx];
          const prevMax = recencyTiers[idx - 1]?.maxDays ?? -1;
          if (days > prevMax && days <= tier.maxDays) return !hiddenTiers.has(tier.label);
        }
        return true;
      });
    }

    // Sales day filter: only show stores with sale/visit on selected day(s)
    // For "this-week": keep unvisited Food Lion, Redner, Martins, ShopRite and tag them red
    const missedChainTypes = new Set(['food-lion', 'redners', 'giant-martins', 'shoprite']);
    if (salesDayFilter.size > 0) {
      const allowedDates = new Set();
      if (salesDayFilter.has('today')) allowedDates.add(todayStr);
      if (salesDayFilter.has('yesterday')) allowedDates.add(yesterdayStr);
      const checkWeek = salesDayFilter.has('this-week');
      result = result.filter(s => {
        const sale = s.lastSaleDate ? s.lastSaleDate.split('T')[0].split(' ')[0] : null;
        const visit = s.lastVisited ? s.lastVisited.split('T')[0].split(' ')[0] : null;
        let matched = false;
        if (allowedDates.size > 0 && ((sale && allowedDates.has(sale)) || (visit && allowedDates.has(visit)))) matched = true;
        if (!matched && checkWeek) {
          if (sale && sale >= thisWeekRange.start && sale <= thisWeekRange.end) matched = true;
          if (visit && visit >= thisWeekRange.start && visit <= thisWeekRange.end) matched = true;
        }
        if (matched) {
          s._missedThisWeek = false;
          return true;
        }
        // Keep unvisited stores for key chains, mark them as missed
        if (checkWeek && missedChainTypes.has(s.type)) {
          s._missedThisWeek = true;
          return true;
        }
        return false;
      });
    }

    return result;
  }, [stores, searchTerm, filterRegion, filterType, filterRoute, hideCash, hideChain, visitMode, legendFilter, hiddenTiers, salesDayFilter, todayStr, yesterdayStr, thisWeekRange]);

  // Sort zones alphabetically and assign numbers (matching sidebar)
  const numberedZones = useMemo(() => {
    const sorted = [...zones].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.map((z, i) => ({ ...z, zoneNumber: i + 1 }));
  }, [zones]);

  // Store count per zone (from filtered stores)
  const storeCountByZone = useMemo(() => {
    const counts = {};
    filteredStores.forEach((s) => {
      if (s.zoneId) {
        counts[s.zoneId] = (counts[s.zoneId] || 0) + 1;
      }
    });
    return counts;
  }, [filteredStores]);

  const visibleZones = useMemo(() => {
    let result = numberedZones.filter((z) => z.name !== 'Unassigned');

    // Filter out manually hidden zones
    if (hiddenZones.size > 0) {
      result = result.filter((z) => !hiddenZones.has(z.id));
    }

    // When any filter is active, only show zones that contain matching stores
    const hasFilter = searchTerm || filterRegion !== 'all' || filterType !== 'all' || filterRoute !== 'all';
    if (hasFilter) {
      const zoneIdsWithStores = new Set(
        filteredStores.map((s) => s.zoneId).filter(Boolean)
      );
      result = result.filter((z) => zoneIdsWithStores.has(z.id));
    }

    return result;
  }, [numberedZones, hiddenZones, searchTerm, filterRegion, filterType, filterRoute, filteredStores]);

  // Hidden zones list for the reopen panel
  const hiddenZonesList = useMemo(() => {
    if (hiddenZones.size === 0) return [];
    return numberedZones.filter((z) => hiddenZones.has(z.id));
  }, [numberedZones, hiddenZones]);

  // Stale stores: >7 days since visit, or all stores matching checked legend tiers
  const staleStores = useMemo(() => {
    const hasStaleFilter = visitMode && legendFilter.size > 0 && !legendFilter.has('0-7 days');
    const onlyCurrentSelected = visitMode && legendFilter.size > 0 && [...legendFilter].every(l => l === '0-7 days');
    if (onlyCurrentSelected) return [];
    // Show when visitMode is on OR a specific route is selected OR a legend tier is active
    if (!visitMode && filterRoute === 'all' && !hasStaleFilter) return [];
    const source = hasStaleFilter
      ? filteredStores
      : filteredStores.filter((s) => {
          const d = getDaysSinceVisit(getLatestDate(s));
          return d !== null && d > 7;
        });
    return source
      .map((s) => ({ ...s, daysSince: getDaysSinceVisit(getLatestDate(s)) }))
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));
  }, [filteredStores, filterRoute, visitMode, legendFilter]);

  // Group stale stores by route for the panel
  const staleByRoute = useMemo(() => {
    const grouped = {};
    staleStores.forEach(s => {
      const route = s.routeNumber && s.routeNumber !== '0' ? s.routeNumber : 'Unassigned';
      if (!grouped[route]) grouped[route] = [];
      grouped[route].push(s);
    });
    return Object.entries(grouped).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [staleStores]);

  // Sales activity summary: visited vs total by route when a sales day filter is active
  const salesSummaryByRoute = useMemo(() => {
    if (salesDayFilter.size === 0) return null;
    const allowedDates = new Set();
    if (salesDayFilter.has('today')) allowedDates.add(todayStr);
    if (salesDayFilter.has('yesterday')) allowedDates.add(yesterdayStr);
    const checkWeek = salesDayFilter.has('this-week');
    const byRoute = {};
    // Use all stores (not filtered by salesDayFilter) but respect other filters
    let base = stores;
    if (filterRegion !== 'all') base = base.filter(s => s.region === filterRegion);
    if (filterType !== 'all') base = base.filter(s => s.type === filterType);
    if (filterRoute !== 'all') {
      if (filterRoute === 'MIL') base = base.filter(s => s.id.startsWith('CMW'));
      else base = base.filter(s => s.routeNumber === filterRoute);
    }
    if (hideCash) base = base.filter(s => s.type !== 'other');
    if (hideChain) base = base.filter(s => s.type === 'other' || s.type === 'military');
    base.forEach(s => {
      const route = s.routeNumber && s.routeNumber !== '0' ? s.routeNumber : 'Unassigned';
      if (!byRoute[route]) byRoute[route] = { total: 0, visited: 0 };
      byRoute[route].total++;
      const sale = s.lastSaleDate ? s.lastSaleDate.split('T')[0].split(' ')[0] : null;
      const visit = s.lastVisited ? s.lastVisited.split('T')[0].split(' ')[0] : null;
      let matched = false;
      if (allowedDates.size > 0 && ((sale && allowedDates.has(sale)) || (visit && allowedDates.has(visit)))) matched = true;
      if (!matched && checkWeek) {
        if (sale && sale >= thisWeekRange.start && sale <= thisWeekRange.end) matched = true;
        if (visit && visit >= thisWeekRange.start && visit <= thisWeekRange.end) matched = true;
      }
      if (matched) byRoute[route].visited++;
    });
    return Object.entries(byRoute).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [salesDayFilter, stores, filterRegion, filterType, filterRoute, hideCash, hideChain, todayStr, yesterdayStr, thisWeekRange]);

  const copyStaleMessage = useCallback(() => {
    if (staleStores.length === 0) return;
    const typeLabel = filterType !== 'all'
      ? ` (${typeLabels[filterType] || filterType})`
      : '';
    const routeLabel = filterRoute === 'MIL' ? 'Military' : `Route ${filterRoute}`;
    let msg = `${routeLabel}${typeLabel} - ${staleStores.length} store${staleStores.length === 1 ? '' : 's'} out of date\n`;
    staleStores.forEach((s, i) => {
      const sale = s.lastSaleDate ? formatDate(s.lastSaleDate).split(' (')[0] : null;
      const visit = s.lastVisited ? formatDate(s.lastVisited).split(' (')[0] : null;
      const dateStr = [sale ? `Sale: ${sale}` : null, visit ? `Visit: ${visit}` : null].filter(Boolean).join(' / ') || 'Never';
      const daysText = s.daysSince === null ? 'Never visited' : `${s.daysSince} days`;
      const routeInfo = filterRoute === 'MIL' && s.routeNumber ? ` (Rt ${s.routeNumber})` : '';
      msg += `${i + 1}. ${s.id}, ${s.name}${routeInfo}, ${s.city}, ${dateStr}, ${daysText}\n`;
    });
    msg += `Please visit before the end of this week`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    });
  }, [staleStores, filterRoute, filterType]);

  const copyRouteWhatsApp = useCallback((routeNumber, routeStoresList) => {
    const routeLabel = routeNumber === 'Unassigned' ? 'Unassigned Stores' : `Route ${routeNumber}`;
    let msg = `${routeLabel} — ${routeStoresList.length} store${routeStoresList.length === 1 ? '' : 's'} out of date\n`;
    routeStoresList.forEach((s, i) => {
      const sale = s.lastSaleDate ? formatDate(s.lastSaleDate).split(' (')[0] : null;
      const visit = s.lastVisited ? formatDate(s.lastVisited).split(' (')[0] : null;
      const dateStr = [sale ? `Sale: ${sale}` : null, visit ? `Visit: ${visit}` : null].filter(Boolean).join(' / ') || 'Never';
      const daysText = s.daysSince === null ? 'Never visited' : `${s.daysSince} days`;
      msg += `${i + 1}. ${s.id}, ${s.name}, ${s.city}, ${dateStr}, ${daysText}\n`;
    });
    msg += `Please visit before the end of this week`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopiedRouteFlash(routeNumber);
      setTimeout(() => setCopiedRouteFlash(null), 2000);
    });
  }, []);

  const copyStoreAlert = useCallback((store) => {
    const sale = store.lastSaleDate ? formatDate(store.lastSaleDate).split(' (')[0] : null;
    const visit = store.lastVisited ? formatDate(store.lastVisited).split(' (')[0] : null;
    const lastService = [sale ? `Sale: ${sale}` : null, visit ? `Visit: ${visit}` : null].filter(Boolean).join(' / ') || 'Never';
    const msg = `🚨 *ALERT - Service Required*\n\nStore: ${store.name}\nStore #: ${store.id}\nAddress: ${store.address}, ${store.city}, ${store.state} ${store.zip}\nLast Service: ${lastService}\n\n⚠️ This store needs to be serviced.`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopiedPopupId(store.id);
      setTimeout(() => setCopiedPopupId(null), 2000);
    });
  }, []);

  // Send alert to route's WhatsApp group
  const sendStoreAlert = useCallback(async (store) => {
    const storeAlerts = getStoreAlerts(store.id);
    if (storeAlerts.length === 0) return;
    const routeNum = store.routeNumber;
    const groupMap = JSON.parse(localStorage.getItem('wa_route_group_map') || '{}');
    const groupId = groupMap[routeNum];
    if (!groupId) {
      copyStoreAlert(store);
      return;
    }
    setWaSending(store.id);
    try {
      const alert = storeAlerts[0];
      const sale = store.lastSaleDate ? formatDate(store.lastSaleDate).split(' (')[0] : null;
      const visit = store.lastVisited ? formatDate(store.lastVisited).split(' (')[0] : null;
      const lastService = [sale ? `Sale: ${sale}` : null, visit ? `Visit: ${visit}` : null].filter(Boolean).join(' / ') || 'Never';
      const alertData = {
        route: routeNum || 'N/A',
        type: alert.vendor || 'Alert',
        store: `${store.name} #${store.id}`,
        message: `${store.city} — Last Service: ${lastService}`,
        timestamp: alert.dateReceived || new Date().toISOString().split('T')[0],
      };

      // Try to fetch and send with image
      let sentWithImage = false;
      if (alert.emailId) {
        try {
          // Use cached image or fetch fresh — loadAlertImage returns the result directly
          let img = alertImages[alert.emailId];
          if (!img?.dataUri) {
            img = await loadAlertImage(alert.emailId);
          }
          if (img?.dataUri && !img.error) {
            await sendWhatsAppAlertWithImage(groupId, alertData, img.dataUri, img.mimeType || 'image/jpeg');
            sentWithImage = true;
          }
        } catch (_) {}
      }
      // Fallback to text-only
      if (!sentWithImage) {
        await sendWhatsAppAlert(groupId, alertData);
      }
      // Look up group name for the "sent to" popup
      const nameMap = JSON.parse(localStorage.getItem('wa_route_group_names') || '{}');
      const groupName = nameMap[routeNum] || `Route ${routeNum} group`;
      setWaSent(store.id);
      setWaSentTo(groupName);
      setTimeout(() => { setWaSent(null); setWaSentTo(null); }, 3500);
    } catch (e) {
      copyStoreAlert(store);
    } finally {
      setWaSending(null);
    }
  }, [getStoreAlerts, copyStoreAlert, alertImages, loadAlertImage]);

  const openPopupEdit = useCallback((storeId) => {
    setPopupEditId(storeId);
    setPopupEditDate(new Date().toISOString().split('T')[0]);
    setTimeout(() => {
      try { popupDateRef.current?.showPicker(); } catch (_) {}
    }, 50);
  }, []);

  const handlePopupVisit = useCallback((storeId) => {
    if (!popupEditDate) return;
    const ymd = popupEditDate.split('T')[0].split(' ')[0];
    if (!ymd) return;
    recordVisit(storeId, ymd);
    setPopupEditId(null);
    setPopupEditDate('');
  }, [popupEditDate, recordVisit]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {hasActiveFilters && (
        <button className="map-clear-btn" onClick={resetAll}>
          Clear Filters &amp; Reset
        </button>
      )}

      {/* Hidden zones reopen panel (hidden when bulk toggle is off) */}
      {hiddenZonesList.length > 0 && !zonesOff && (
        <div className={`hidden-zones-panel ${filterRoute !== 'all' && staleStores.length > 0 ? 'shifted-right' : ''}`}>
          <div className="hidden-zones-header">
            <span>Hidden Zones ({hiddenZonesList.length})</span>
            <button className="btn btn-xs" onClick={showAllZones}>Show All</button>
          </div>
          {hiddenZonesList.map((z) => (
            <div key={z.id} className="hidden-zone-item" onClick={() => showZone(z.id)}>
              <span className="zone-number-badge small" style={{ background: z.color, border: `2px solid ${z.color}` }}>{z.zoneNumber}</span>
              <span>{z.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Left panels container — stacks stale panel and sales card vertically */}
      <div className="left-panels-container">
      {/* Stale Stores Panel */}
      {(() => {
        const hasStaleFilter = visitMode && legendFilter.size > 0 && ![...legendFilter].every(l => l === '0-7 days');
        const showPanel = staleStores.length > 0 && (visitMode || filterRoute !== 'all' || hasStaleFilter);
        if (!showPanel) return null;
        const tierLabel = hasStaleFilter ? [...legendFilter].filter(l => l !== '0-7 days').join(', ') : null;
        const title = tierLabel ? `${tierLabel}` : `Stale Stores`;
        return (
        <div className={`stale-panel ${staleCollapsed ? 'collapsed' : ''}`}>
          <div className="stale-panel-header" onClick={() => setStaleCollapsed(!staleCollapsed)}>
            <span className="stale-panel-title">
              {title}{filterType !== 'all' && ` (${typeLabels[filterType] || filterType})`}
            </span>
            <div className="stale-panel-header-right">
              <span className="stale-panel-count">{staleStores.length}</span>
              <button
                className="stale-copy-all-btn"
                title="Copy all routes to clipboard"
                onClick={(e) => { e.stopPropagation(); copyStaleMessage(); }}
              >
                {copiedFlash ? '✓' : '📋'}
              </button>
              <span className="stale-panel-chevron">{staleCollapsed ? '\u25BC' : '\u25B2'}</span>
            </div>
          </div>
          {!staleCollapsed && (
            <div className="stale-panel-list">
              {staleByRoute.map(([routeNum, routeStores]) => (
                <div key={routeNum} className="stale-route-group">
                  <div className="stale-route-header">
                    <span className="stale-route-label">
                      {routeNum === 'Unassigned' ? 'Unassigned' : `Route ${routeNum}`}
                    </span>
                    <span className="stale-route-count">{routeStores.length}</span>
                    <button
                      className={`stale-route-wa-btn${copiedRouteFlash === routeNum ? ' copied' : ''}`}
                      title={`Copy Route ${routeNum} WhatsApp message`}
                      onClick={() => copyRouteWhatsApp(routeNum, routeStores)}
                    >
                      {copiedRouteFlash === routeNum ? '✓ Copied' : '📲 WhatsApp'}
                    </button>
                  </div>
                  {routeStores.map((s, i) => (
                    <div
                      key={s.id}
                      className={`stale-panel-item ${selectedStore === s.id ? 'active' : ''}`}
                      onClick={() => {
                        selectStore(s.id);
                        setMapView([s.lat, s.lng], 14);
                      }}
                    >
                      <div className="stale-item-name"><span className="stale-item-index">{i + 1}.</span> {s.id} — {s.name}</div>
                      <div className="stale-item-detail">
                        {s.city}
                        <span className="stale-item-days" style={{ color: getRecencyTier(getLatestDate(s)).color }}>
                          {s.daysSince === null ? 'Never' : `${s.daysSince}d ago`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}

      {/* Sales Activity Summary Card */}
      {salesSummaryByRoute && salesSummaryByRoute.length > 0 && (
        <div className="sales-activity-card">
          <div className="sales-activity-title">
            {salesDayFilter.has('this-week') ? 'This Week' : salesDayFilter.has('today') ? 'Today' : 'Yesterday'} — by Route
          </div>
          {salesSummaryByRoute.map(([route, { total, visited }]) => (
            <div key={route} className="sales-activity-row">
              <span className="sales-activity-route">Route {route}</span>
              <span className={`sales-activity-count${visited === total ? ' complete' : visited === 0 ? ' none' : ''}`}>
                {visited}/{total}
              </span>
            </div>
          ))}
          <div className="sales-activity-row sales-activity-total">
            <span className="sales-activity-route">Total</span>
            <span className="sales-activity-count">
              {salesSummaryByRoute.reduce((s, [, r]) => s + r.visited, 0)}/{salesSummaryByRoute.reduce((s, [, r]) => s + r.total, 0)}
            </span>
          </div>
        </div>
      )}
      </div>

      {/* Copied flash */}
      {copiedFlash && (
        <div className="copied-flash">Message copied to clipboard</div>
      )}

      {/* Visit Status Toggle + Zone Toggle */}
      <div className="visit-mode-toggle">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={visitMode}
            onChange={(e) => {
              setVisitMode(e.target.checked);
              if (!e.target.checked) setLegendFilter(new Set());
              if (e.target.checked) hideAllZones();
            }}
          />
          <span className="toggle-slider"></span>
          <span className="toggle-text">Visit Status</span>
        </label>
        <button
          className={`zone-toggle-btn ${zonesOff ? 'zones-hidden' : ''}`}
          onClick={toggleAllZones}
          title={zonesOff ? 'Show all zones' : 'Hide all zones'}
        >
          {zonesOff ? 'Show Zones' : 'Hide Zones'}
        </button>
        {visitMode && (
          <button
            className={`zone-toggle-btn ${hideCash ? 'zones-hidden' : ''}`}
            onClick={() => setHideCash(!hideCash)}
            title={hideCash ? 'Show cash stops' : 'Hide cash stops from visit status'}
          >
            {hideCash ? 'Show Cash' : 'Hide Cash'}
          </button>
        )}
        <button
          className={`zone-toggle-btn ${hideChain ? 'zones-hidden' : ''}`}
          onClick={() => setHideChain(c => !c)}
          title={hideChain ? 'Show chain stores' : 'Hide chain stores (Walmart, Wegmans, Food Lion, etc.)'}
        >
          {hideChain ? 'Show Chain' : 'Hide Chain'}
        </button>
        {filterRoute !== 'all' && staleStores.length > 0 && (
          <button
            className={`zone-toggle-btn stale-toggle-btn ${staleCollapsed ? 'zones-hidden' : ''}`}
            onClick={() => setStaleCollapsed(!staleCollapsed)}
            title={staleCollapsed ? 'Show stale stores panel' : 'Hide stale stores panel'}
          >
            {staleCollapsed ? `Show Stale (${staleStores.length})` : 'Hide Stale'}
          </button>
        )}
        {vehicleLocations.length > 0 && (
          <button
            className={`zone-toggle-btn ${showVehiclesOnMap ? '' : 'zones-hidden'}`}
            onClick={toggleVehiclesOnMap}
            title={showVehiclesOnMap ? 'Hide fleet vehicles' : 'Show fleet vehicles on map'}
          >
            {showVehiclesOnMap ? 'Hide Fleet' : 'Show Fleet'}
          </button>
        )}
      </div>

      {/* Legend - switches between store types and visit recency */}
      <div className="map-legend">
        {visitMode ? (
          <>
            <div className="legend-title">
              Visit Recency
              {(legendFilter.size > 0 || hiddenTiers.size !== 2 || !hiddenTiers.has('Dormant (90+ days)') || !hiddenTiers.has('Never visited') || salesDayFilter.size > 0 || pulseTiers.size > 0) && (
                <button className="legend-clear-btn" onClick={() => { setLegendFilter(new Set()); setHiddenTiers(new Set(['Dormant (90+ days)', 'Never visited'])); setSalesDayFilter(new Set()); setPulseTiers(new Set()); }} title="Reset to defaults">Reset</button>
              )}
            </div>
            {[...recencyTiers, neverVisitedTier].map((tier) => {
              const isActive = legendFilter.has(tier.label);
              const isHidden = hiddenTiers.has(tier.label);
              const toggle = () => {
                if (isHidden) {
                  // Unhide first
                  setHiddenTiers(prev => { const next = new Set(prev); next.delete(tier.label); return next; });
                } else if (isActive) {
                  // Uncheck inclusion filter
                  setLegendFilter(prev => { const next = new Set(prev); next.delete(tier.label); return next; });
                } else if (legendFilter.size > 0) {
                  // Add to inclusion filter
                  setLegendFilter(prev => { const next = new Set(prev); next.add(tier.label); return next; });
                } else {
                  // No inclusion filter active — hide this tier
                  setHiddenTiers(prev => { const next = new Set(prev); next.add(tier.label); return next; });
                }
              };
              return (
                <label
                  key={tier.label}
                  className={`legend-item legend-item-clickable${isActive ? ' legend-item-active' : ''}${isHidden ? ' legend-item-hidden' : ''}`}
                  title={isHidden ? 'Hidden — click to show' : isActive ? 'Uncheck to remove filter' : `Click to ${legendFilter.size > 0 ? 'filter' : 'hide'}: ${tier.label}`}
                >
                  <input
                    type="checkbox"
                    className="legend-checkbox"
                    checked={isActive || (!isHidden && legendFilter.size === 0)}
                    onChange={toggle}
                  />
                  <span className={`legend-dot ${pulseTiers.has(tier.label) && tier.pulse ? tier.pulse : ''}`} style={{ background: tier.color, opacity: isHidden ? 0.3 : 1 }} />
                  <span style={{ opacity: isHidden ? 0.4 : 1 }}>{tier.label}</span>
                </label>
              );
            })}
            <hr className="legend-divider" />
            <label
              className={`legend-item legend-item-clickable${showAlerts ? ' legend-item-active' : ''}`}
              title={showAlerts ? `${storesWithOpenAlerts.size} open alerts — click to hide` : `${storesWithOpenAlerts.size} open alerts — click to show`}
            >
              <input
                type="checkbox"
                className="legend-checkbox"
                checked={showAlerts}
                onChange={() => setShowAlerts(prev => !prev)}
              />
              <span className="legend-alert-icon">!</span>
              <span>Alerts {storesWithOpenAlerts.size > 0 ? `(${storesWithOpenAlerts.size})` : ''}</span>
            </label>
            {showAlerts && (
              <div className="legend-pulse-control">
                <span className="legend-pulse-label">Pulse on:</span>
                {recencyTiers.map(tier => (
                  <label key={tier.label} className={`legend-pulse-option${pulseTiers.has(tier.label) ? ' active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={pulseTiers.has(tier.label)}
                      onChange={() => setPulseTiers(prev => {
                        const next = new Set(prev);
                        next.has(tier.label) ? next.delete(tier.label) : next.add(tier.label);
                        return next;
                      })}
                    />
                    <span className="legend-dot" style={{ background: tier.color, width: 8, height: 8 }} />
                    {tier.label}
                  </label>
                ))}
              </div>
            )}
            <hr className="legend-divider" />
            <div className="legend-title">Sales Activity</div>
            {['today', 'yesterday', 'this-week'].map(day => {
              const isActive = salesDayFilter.has(day);
              const label = day === 'today' ? 'Today' : day === 'yesterday' ? 'Yesterday' : 'This Week';
              const dotColor = day === 'today' ? '#22c55e' : day === 'yesterday' ? '#3b82f6' : '#8b5cf6';
              return (
                <label
                  key={day}
                  className={`legend-item legend-item-clickable${isActive ? ' legend-item-active' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="legend-checkbox"
                    checked={isActive}
                    onChange={() => setSalesDayFilter(prev => {
                      const next = new Set(prev);
                      isActive ? next.delete(day) : next.add(day);
                      return next;
                    })}
                  />
                  <span className="legend-dot" style={{ background: dotColor }} />
                  <span>{label}</span>
                </label>
              );
            })}
          </>
        ) : (
          <>
            <div className="legend-title">Store Types</div>
            {Object.entries(typeColors).map(([type, color]) => (
              <div key={type} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />
                <span>{typeLabels[type] || type}</span>
              </div>
            ))}
          </>
        )}
      </div>

    <MapContainer
      center={mapCenter}
      zoom={mapZoom}
      className="map-container"
      style={{ height: '100%', width: '100%' }}
    >
      <MapUpdater center={mapCenter} zoom={mapZoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Render zone polygons */}
      {visibleZones.map((zone) => (
        <Polygon
          key={zone.id}
          positions={zone.bounds}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: selectedZone === zone.id ? 0.45 : 0.25,
            weight: selectedZone === zone.id ? 3 : 2,
            dashArray: selectedZone === zone.id ? null : '8 4',
          }}
          eventHandlers={{
            click: (e) => {
              selectZone(selectedZone === zone.id ? null : zone.id);
              if (selectedZone !== zone.id) {
                const map = e.target._map;
                map.fitBounds(zone.bounds, { padding: [50, 50] });
              }
            },
            mouseover: (e) => {
              e.target.setStyle({ fillOpacity: selectedZone === zone.id ? 0.55 : 0.4 });
            },
            mouseout: (e) => {
              e.target.setStyle({ fillOpacity: selectedZone === zone.id ? 0.45 : 0.25 });
            },
          }}
        >
          <Tooltip
            permanent
            interactive
            direction="center"
            className="zone-label"
            offset={[0, 0]}
          >
            <span
              className="zone-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                hideZone(zone.id);
              }}
            >&times;</span>
            <span className="zone-number-badge" style={{ background: zone.color, border: `2px solid ${zone.color}` }}>{zone.zoneNumber}</span>
            <span className="zone-name-label">{zone.name} ({storeCountByZone[zone.id] || 0})</span>
          </Tooltip>
        </Polygon>
      ))}

      {/* Render sub-zone polygons */}
      {visibleZones.map((zone) =>
        zone.subZones.map((subZone) => (
          <Polygon
            key={subZone.id}
            positions={subZone.bounds}
            pathOptions={{
              color: subZone.color,
              fillColor: subZone.color,
              fillOpacity: selectedSubZone === subZone.id ? 0.5 : 0.3,
              weight: selectedSubZone === subZone.id ? 3 : 2,
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                selectZone(zone.id);
                selectSubZone(subZone.id);
                const map = e.target._map;
                map.fitBounds(subZone.bounds, { padding: [50, 50] });
              },
              mouseover: (e) => {
                e.target.setStyle({ fillOpacity: selectedSubZone === subZone.id ? 0.6 : 0.45 });
              },
              mouseout: (e) => {
                e.target.setStyle({ fillOpacity: selectedSubZone === subZone.id ? 0.5 : 0.3 });
              },
            }}
          >
            <Tooltip direction="center" className="subzone-label">
              {subZone.name}
            </Tooltip>
          </Polygon>
        ))
      )}

      {/* Render store markers (filtered to match sidebar) */}
      {(showAlerts ? filteredStores.filter(s => storesWithOpenAlerts.has(s.id)) : filteredStores).map((store) => (
        <Marker
          key={store.id}
          position={[store.lat, store.lng]}
          icon={createStoreIcon(store.type, selectedStore === store.id, visitMode, getLatestDate(store), pulseTiers, store._missedThisWeek)}
          eventHandlers={{
            click: () => {
              if (selectedStore === store.id) {
                setMapView([store.lat, store.lng], 16);
              } else {
                selectStore(store.id);
              }
            },
          }}
        >
          <Popup>
            <div className="store-popup">
              <strong>{store.name}</strong>
              <br />
              <span className="popup-address">
                {store.address}, {store.city}, {store.state} {store.zip}
              </span>
              <br />
              <span
                className="popup-type"
                style={{
                  background: (typeColors[store.type] || '#6b7280') + '20',
                  color: typeColors[store.type] || '#6b7280',
                }}
              >
                {store.type}
              </span>
              {store.region && store.region !== 'Unassigned' && (
                <>
                  <br />
                  <span className="popup-zone">Region: {store.region}</span>
                </>
              )}
              {store.routeNumber && (
                <>
                  <br />
                  <span className="popup-zone">Route: {store.routeNumber}</span>
                </>
              )}
              <br />
              <span
                className="popup-zone popup-visit-clickable"
                onClick={() => popupEditId === store.id ? setPopupEditId(null) : openPopupEdit(store.id)}
                title="Click to add visit date"
              >
                {store.lastSaleDate ? `Sale: ${formatDate(store.lastSaleDate)}` : ''}
                {store.lastSaleDate && store.lastVisited ? ' / ' : ''}
                {store.lastVisited ? `Visit: ${formatDate(store.lastVisited)}` : ''}
                {!store.lastSaleDate && !store.lastVisited ? 'No date' : ''}
              </span>
              {popupEditId === store.id && (
                <div className="popup-visit-edit">
                  <input
                    ref={popupDateRef}
                    type="date"
                    className="popup-visit-date-input"
                    value={popupEditDate}
                    onChange={(e) => setPopupEditDate(e.target.value)}
                  />
                  <button className="popup-visit-save-btn" onClick={() => handlePopupVisit(store.id)} disabled={!popupEditDate}>Save</button>
                  <button className="popup-visit-cancel-btn" onClick={() => setPopupEditId(null)}>&times;</button>
                </div>
              )}
              <br />
              <span
                className="popup-visit-badge"
                style={{
                  background: getRecencyTier(getLatestDate(store)).color + '20',
                  color: getRecencyTier(getLatestDate(store)).color,
                  borderColor: getRecencyTier(getLatestDate(store)).color,
                }}
              >
                {getRecencyTier(getLatestDate(store)).label}
              </span>
              <div className="popup-actions">
                <button
                  className="btn btn-xs store-alert-btn"
                  onClick={() => sendStoreAlert(store)}
                  disabled={waSending === store.id}
                  title="Send alert to route's WhatsApp group"
                >
                  {waSent === store.id ? `Sent to ${waSentTo}` : waSending === store.id ? 'Sending...' : 'Alert'}
                </button>
                {store.routeNumber && store.routeNumber !== '0' ? (
                  <button
                    className="btn btn-xs btn-warning"
                    onClick={() => updateStore({ id: store.id, routeNumber: '0' })}
                  >
                    Unassign Route
                  </button>
                ) : (
                  <select
                    className="popup-route-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        updateStore({ id: store.id, routeNumber: e.target.value });
                      }
                    }}
                  >
                    <option value="">Assign route...</option>
                    {routes.map((r) => (
                      <option key={r} value={r}>Route {r}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Fleet vehicle overlay markers */}
      {showVehiclesOnMap && vehicleLocations
        .filter(v => v.lat && v.lng)
        .map(v => (
          <Marker
            key={`fleet-${v.vin}`}
            position={[v.lat, v.lng]}
            icon={createTruckOverlayIcon(v.engineStatus)}
          >
            <Popup>
              <div className="store-popup">
                <strong>{v.vehicleId}</strong>
                <br />
                <span className="popup-address">{v.licensePlate}</span>
                <br />
                {v.driverName && (
                  <>
                    <span className="popup-zone">Driver: {v.driverName}</span>
                    <br />
                  </>
                )}
                <span className="popup-zone">
                  Speed: {v.speed != null ? `${v.speed} mph` : 'N/A'}
                </span>
                <br />
                <span
                  className="popup-type"
                  style={{
                    background: v.engineStatus === 'on' ? '#22c55e20' : '#ef444420',
                    color: v.engineStatus === 'on' ? '#22c55e' : '#ef4444',
                  }}
                >
                  Engine: {v.engineStatus || 'Unknown'}
                </span>
                {v.description && (
                  <>
                    <br />
                    <span className="popup-zone">{v.description}</span>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      {/* Alert exclamation markers — one per store with an open alert */}
      {showAlerts && filteredStores
        .filter(store => storesWithOpenAlerts.has(store.id))
        .map(store => {
          const days = getDaysSinceVisit(getLatestDate(store));
          const tier = days !== null ? recencyTiers.find(t => days <= t.maxDays) : null;
          const shouldPulse = tier && pulseTiers.has(tier.label);
          return (
            <Marker
              key={`alert-${store.id}`}
              position={[store.lat, store.lng]}
              icon={shouldPulse ? alertExclaimPulseIcon : alertExclaimIcon}
              interactive={false}
              zIndexOffset={1000}
            />
          );
        })}
    </MapContainer>
    </div>
  );
}

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
import visitHistoryData from '../data/visitHistory';

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
  { label: '30+ days', color: '#ef4444', maxDays: Infinity, pulse: 'pulse-fast' },
];
const neverVisitedTier = { label: 'Never visited', color: '#9ca3af', pulse: 'pulse-fast' };

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const visited = new Date(lastVisited);
  if (isNaN(visited.getTime())) return null;
  const now = new Date();
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

function createStoreIcon(type, isSelected, visitMode, lastVisited) {
  const baseColor = visitMode
    ? getRecencyTier(lastVisited).color
    : (typeColors[type] || typeColors.other);
  const size = isSelected ? 14 : 10;
  const border = isSelected ? '3px solid #1e3a5f' : '2px solid #fff';
  const blinkClass = isSelected ? 'marker-blink' : '';
  const tier = visitMode ? getRecencyTier(lastVisited) : null;
  const pulseClass = (visitMode && tier && tier.pulse) ? tier.pulse : '';
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

function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
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
  const { state, selectStore, selectZone, selectSubZone, setMapView, setSearch, setFilterRegion, setFilterType, setFilterRoute, updateStore } = useApp();
  const { stores, zones, selectedStore, selectedZone, selectedSubZone, mapCenter, mapZoom, searchTerm, filterRegion, filterType, filterRoute } = state;

  const [hiddenZones, setHiddenZones] = useState(new Set());
  const [visitMode, setVisitMode] = useState(false);
  const [zonesOff, setZonesOff] = useState(false);
  const [hideCash, setHideCash] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [staleCollapsed, setStaleCollapsed] = useState(false);
  const [popupEditId, setPopupEditId] = useState(null);
  const [popupEditDate, setPopupEditDate] = useState('');
  const popupDateRef = useRef(null);

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
    setHiddenZones(new Set());
    setZonesOff(false);
    setMapView([39.0, -76.8], 8);
  }

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

    return result;
  }, [stores, searchTerm, filterRegion, filterType, filterRoute, hideCash]);

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

  // Stale stores: >7 days since visit (only when route filter active)
  const staleStores = useMemo(() => {
    if (filterRoute === 'all') return [];
    return filteredStores
      .map((s) => {
        const days = getDaysSinceVisit(s.lastVisited);
        return { ...s, daysSince: days };
      })
      .filter((s) => s.daysSince === null || s.daysSince > 7)
      .sort((a, b) => {
        if (a.daysSince === null && b.daysSince === null) return 0;
        if (a.daysSince === null) return -1;
        if (b.daysSince === null) return 1;
        return b.daysSince - a.daysSince;
      });
  }, [filteredStores, filterRoute]);

  const copyStaleMessage = useCallback(() => {
    if (staleStores.length === 0) return;
    const typeLabel = filterType !== 'all'
      ? ` (${typeLabels[filterType] || filterType})`
      : '';
    const routeLabel = filterRoute === 'MIL' ? 'Military' : `Route ${filterRoute}`;
    let msg = `${routeLabel}${typeLabel} - ${staleStores.length} store${staleStores.length === 1 ? '' : 's'} out of date\n`;
    staleStores.forEach((s, i) => {
      const lastVisit = s.lastVisited ? formatDate(s.lastVisited).split(' (')[0] : 'Never';
      const daysText = s.daysSince === null ? 'Never visited' : `${s.daysSince} days`;
      const routeInfo = filterRoute === 'MIL' && s.routeNumber ? ` (Rt ${s.routeNumber})` : '';
      msg += `${i + 1}. ${s.id}, ${s.name}${routeInfo}, ${s.city}, Last visit: ${lastVisit}, ${daysText}\n`;
    });
    msg += `Please visit before the end of this week`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    });
  }, [staleStores, filterRoute, filterType]);

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
    if (!visitHistoryData[storeId]) visitHistoryData[storeId] = [];
    if (!visitHistoryData[storeId].includes(ymd)) {
      visitHistoryData[storeId].push(ymd);
      visitHistoryData[storeId].sort();
    }
    const store = stores.find((s) => s.id === storeId);
    if (store) {
      const allDates = visitHistoryData[storeId].slice().sort();
      const newest = allDates[allDates.length - 1];
      updateStore({ ...store, lastVisited: newest });
    }
    setPopupEditId(null);
    setPopupEditDate('');
  }, [popupEditDate, stores, updateStore]);

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

      {/* Stale Stores Panel */}
      {filterRoute !== 'all' && staleStores.length > 0 && (
        <div className={`stale-panel ${staleCollapsed ? 'collapsed' : ''}`}>
          <div className="stale-panel-header" onClick={() => setStaleCollapsed(!staleCollapsed)}>
            <span className="stale-panel-title">
              Stale Stores — {filterRoute === 'MIL' ? 'Military' : `Route ${filterRoute}`}
              {filterType !== 'all' && ` (${typeLabels[filterType] || filterType})`}
            </span>
            <div className="stale-panel-header-right">
              <span className="stale-panel-count">{staleStores.length}</span>
              <span className="stale-panel-chevron">{staleCollapsed ? '\u25BC' : '\u25B2'}</span>
            </div>
          </div>
          {!staleCollapsed && (
            <>
              <div className="stale-panel-list">
                {staleStores.map((s, i) => (
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
                      <span className="stale-item-days" style={{ color: getRecencyTier(s.lastVisited).color }}>
                        {s.daysSince === null ? 'Never' : `${s.daysSince}d ago`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="stale-panel-copy" onClick={copyStaleMessage}>
                Copy WhatsApp Message
              </button>
            </>
          )}
        </div>
      )}

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
        {filterRoute !== 'all' && staleStores.length > 0 && (
          <button
            className={`zone-toggle-btn stale-toggle-btn ${staleCollapsed ? 'zones-hidden' : ''}`}
            onClick={() => setStaleCollapsed(!staleCollapsed)}
            title={staleCollapsed ? 'Show stale stores panel' : 'Hide stale stores panel'}
          >
            {staleCollapsed ? `Show Stale (${staleStores.length})` : 'Hide Stale'}
          </button>
        )}
      </div>

      {/* Legend - switches between store types and visit recency */}
      <div className="map-legend">
        {visitMode ? (
          <>
            <div className="legend-title">Visit Recency</div>
            {recencyTiers.map((tier) => (
              <div key={tier.label} className="legend-item">
                <span className={`legend-dot ${tier.pulse || ''}`} style={{ background: tier.color }} />
                <span>{tier.label}</span>
              </div>
            ))}
            <div className="legend-item">
              <span className={`legend-dot ${neverVisitedTier.pulse}`} style={{ background: neverVisitedTier.color }} />
              <span>{neverVisitedTier.label}</span>
            </div>
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
      {filteredStores.map((store) => (
        <Marker
          key={store.id}
          position={[store.lat, store.lng]}
          icon={createStoreIcon(store.type, selectedStore === store.id, visitMode, store.lastVisited)}
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
                Last visited: {formatDate(store.lastVisited)}
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
                  background: getRecencyTier(store.lastVisited).color + '20',
                  color: getRecencyTier(store.lastVisited).color,
                  borderColor: getRecencyTier(store.lastVisited).color,
                }}
              >
                {getRecencyTier(store.lastVisited).label}
              </span>
              <div className="popup-actions">
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
    </MapContainer>
    </div>
  );
}

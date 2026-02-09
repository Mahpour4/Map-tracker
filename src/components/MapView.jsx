import { useEffect, useMemo, useRef, useState } from 'react';
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
  'other': 'Other',
};

function createStoreIcon(type, isSelected) {
  const color = typeColors[type] || typeColors.other;
  const size = isSelected ? 14 : 10;
  const border = isSelected ? '3px solid #1e3a5f' : '2px solid #fff';
  const blinkClass = isSelected ? 'marker-blink' : '';

  return L.divIcon({
    className: `custom-marker ${blinkClass}`,
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: 50%;
      border: ${border};
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
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
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function MapView() {
  const { state, selectStore, selectZone, selectSubZone, setMapView, setSearch, setFilterRegion, setFilterType, setFilterRoute, updateStore } = useApp();
  const { stores, zones, selectedStore, selectedZone, selectedSubZone, mapCenter, mapZoom, searchTerm, filterRegion, filterType, filterRoute } = state;

  const [hiddenZones, setHiddenZones] = useState(new Set());

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
      return next;
    });
  }

  function showAllZones() {
    setHiddenZones(new Set());
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
      result = result.filter((s) => s.routeNumber === filterRoute);
    }

    return result;
  }, [stores, searchTerm, filterRegion, filterType, filterRoute]);

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

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {hasActiveFilters && (
        <button className="map-clear-btn" onClick={resetAll}>
          Clear Filters &amp; Reset
        </button>
      )}

      {/* Hidden zones reopen panel */}
      {hiddenZonesList.length > 0 && (
        <div className="hidden-zones-panel">
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

      {/* Store type color legend */}
      <div className="map-legend">
        <div className="legend-title">Store Types</div>
        {Object.entries(typeColors).map(([type, color]) => (
          <div key={type} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            <span>{typeLabels[type] || type}</span>
          </div>
        ))}
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
          icon={createStoreIcon(store.type, selectedStore === store.id)}
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
              <span className="popup-zone">
                Last visited: {formatDate(store.lastVisited)}
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

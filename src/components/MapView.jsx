import { useEffect, useMemo } from 'react';
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
  const { state, selectStore, selectZone, selectSubZone, setMapView, setSearch, setFilterRegion, setFilterType } = useApp();
  const { stores, zones, selectedStore, selectedZone, selectedSubZone, mapCenter, mapZoom, searchTerm, filterRegion, filterType } = state;

  const hasActiveFilters = searchTerm || filterRegion !== 'all' || filterType !== 'all' || selectedStore || selectedZone || selectedSubZone;

  function resetAll() {
    setSearch('');
    setFilterRegion('all');
    setFilterType('all');
    selectStore(null);
    selectZone(null);
    selectSubZone(null);
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

    return result;
  }, [stores, searchTerm, filterRegion, filterType]);

  // Sort zones alphabetically and assign numbers (matching sidebar)
  const numberedZones = useMemo(() => {
    const sorted = [...zones].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.map((z, i) => ({ ...z, zoneNumber: i + 1 }));
  }, [zones]);

  const visibleZones = useMemo(() => {
    if (selectedZone) {
      return numberedZones.filter((z) => z.id === selectedZone);
    }
    return numberedZones.filter((z) => z.name !== 'Unassigned');
  }, [numberedZones, selectedZone]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {hasActiveFilters && (
        <button className="map-clear-btn" onClick={resetAll}>
          Clear Filters &amp; Reset
        </button>
      )}
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
            click: () => selectZone(zone.id),
          }}
        >
          <Tooltip permanent direction="center" className="zone-label">
            <span className="zone-number-badge">{zone.zoneNumber}</span> {zone.name}
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
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
    </div>
  );
}

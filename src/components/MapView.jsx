import { useEffect } from 'react';
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
import { getPolygonCenter } from '../utils/geoUtils';

// Fix default marker icon issue with webpack/vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function createStoreIcon(type, isSelected) {
  const colors = {
    supermarket: '#ef4444',
    grocery: '#22c55e',
    convenience: '#f59e0b',
  };
  const color = colors[type] || '#6b7280';
  const size = isSelected ? 14 : 10;
  const border = isSelected ? '3px solid #1e3a5f' : '2px solid #fff';

  return L.divIcon({
    className: 'custom-marker',
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

export default function MapView() {
  const { state, selectStore, selectZone, selectSubZone } = useApp();
  const { stores, zones, selectedStore, selectedZone, selectedSubZone, mapCenter, mapZoom } = state;

  return (
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

      {/* Render zones */}
      {zones.map((zone) => (
        <Polygon
          key={zone.id}
          positions={zone.bounds}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: selectedZone === zone.id ? 0.3 : 0.1,
            weight: selectedZone === zone.id ? 3 : 2,
            dashArray: selectedZone === zone.id ? null : '5 5',
          }}
          eventHandlers={{
            click: () => selectZone(zone.id),
          }}
        >
          <Tooltip permanent direction="center" className="zone-label">
            {zone.name}
          </Tooltip>
        </Polygon>
      ))}

      {/* Render sub-zones */}
      {zones.map((zone) =>
        zone.subZones.map((subZone) => (
          <Polygon
            key={subZone.id}
            positions={subZone.bounds}
            pathOptions={{
              color: subZone.color,
              fillColor: subZone.color,
              fillOpacity: selectedSubZone === subZone.id ? 0.4 : 0.15,
              weight: selectedSubZone === subZone.id ? 3 : 1,
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

      {/* Render store markers */}
      {stores.map((store) => (
        <Marker
          key={store.id}
          position={[store.lat, store.lng]}
          icon={createStoreIcon(store.type, selectedStore === store.id)}
          eventHandlers={{
            click: () => selectStore(store.id),
          }}
        >
          <Popup>
            <div className="store-popup">
              <strong>{store.name}</strong>
              <br />
              <span className="popup-address">{store.address}</span>
              <br />
              <span
                className="popup-type"
                style={{
                  background:
                    store.type === 'supermarket'
                      ? '#fee2e2'
                      : store.type === 'grocery'
                      ? '#dcfce7'
                      : '#fef3c7',
                  color:
                    store.type === 'supermarket'
                      ? '#991b1b'
                      : store.type === 'grocery'
                      ? '#166534'
                      : '#92400e',
                }}
              >
                {store.type}
              </span>
              {store.zoneId && (
                <>
                  <br />
                  <span className="popup-zone">
                    Zone: {zones.find((z) => z.id === store.zoneId)?.name || 'Unknown'}
                  </span>
                </>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

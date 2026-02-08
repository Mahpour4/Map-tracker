import { useState } from 'react';
import { useApp } from '../context/AppContext';

function getPolygonCenter(bounds) {
  const latSum = bounds.reduce((sum, p) => sum + p[0], 0);
  const lngSum = bounds.reduce((sum, p) => sum + p[1], 0);
  return [latSum / bounds.length, lngSum / bounds.length];
}

function SubZoneCard({ subZone, zone }) {
  const { selectSubZone, setMapView, state } = useApp();
  const isSelected = state.selectedSubZone === subZone.id;
  const storesInSubZone = state.stores.filter((s) => s.subZoneId === subZone.id);

  return (
    <div
      className={`subzone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        selectSubZone(subZone.id);
        setMapView(getPolygonCenter(subZone.bounds), 12);
      }}
    >
      <div className="subzone-header">
        <div className="color-dot" style={{ background: subZone.color }} />
        <span className="subzone-name">{subZone.name}</span>
        <span className="count-badge small">{storesInSubZone.length}</span>
      </div>
    </div>
  );
}

function ZoneCard({ zone, zoneNumber }) {
  const { selectZone, selectStore, setMapView, state } = useApp();
  const [expanded, setExpanded] = useState(false);
  const isSelected = state.selectedZone === zone.id;
  const storesInZone = state.stores.filter((s) => s.zoneId === zone.id);

  return (
    <div className={`zone-card ${isSelected ? 'selected' : ''}`}>
      <div
        className="zone-card-header"
        onClick={() => {
          selectZone(zone.id);
          setMapView(getPolygonCenter(zone.bounds), 10);
        }}
      >
        <div className="zone-title-row">
          <span className="zone-number" style={{ background: zone.color }}>{zoneNumber}</span>
          <h4>{zone.name}</h4>
        </div>
        <div className="zone-meta">
          <span className="count-badge">{storesInZone.length} stores</span>
          {zone.subZones.length > 0 && (
            <span className="count-badge">{zone.subZones.length} sub-zones</span>
          )}
        </div>
      </div>

      <div className="zone-card-actions">
        <button
          className="btn btn-xs btn-secondary"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="subzone-list">
          {zone.subZones.length === 0 ? (
            <p className="empty-text">No sub-zones</p>
          ) : (
            zone.subZones.map((sz) => (
              <SubZoneCard key={sz.id} subZone={sz} zone={zone} />
            ))
          )}
          {storesInZone.length > 0 && (
            <div className="zone-stores-summary">
              <h5>Stores in this zone ({storesInZone.length}):</h5>
              <ul>
                {storesInZone.map((s, i) => (
                  <li
                    key={s.id}
                    className={`zone-store-item ${state.selectedStore === s.id ? 'active' : ''}`}
                    onClick={() => selectStore(s.id)}
                  >
                    <span className="store-index">{i + 1}.</span> {s.name}
                    <span className="store-city-inline"> - {s.city}, {s.state}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ZonePanel() {
  const { state, selectZone, setMapView } = useApp();
  const { zones, selectedZone } = state;

  const totalSubZones = zones.reduce((sum, z) => sum + z.subZones.length, 0);
  const sortedZones = [...zones].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="zone-panel">
      <div className="panel-header">
        <h3>Zones & Regions</h3>
        <span className="count-badge">
          {zones.length} zones
        </span>
      </div>

      {selectedZone && (
        <button
          className="btn btn-secondary btn-sm clear-zone-btn"
          onClick={() => {
            selectZone(null);
            setMapView([39.0, -76.8], 8);
          }}
        >
          Clear selection (show all)
        </button>
      )}

      <div className="zone-stats">
        <div className="stat-item">
          <span className="stat-value">{zones.length}</span>
          <span className="stat-label">Regions</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{totalSubZones}</span>
          <span className="stat-label">Sub-zones</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{state.stores.length}</span>
          <span className="stat-label">Total stores</span>
        </div>
      </div>

      <div className="zone-list">
        {sortedZones.map((zone, index) => (
          <ZoneCard key={zone.id} zone={zone} zoneNumber={index + 1} />
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getPolygonCenter } from '../utils/geoUtils';

const ZONE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function parseBounds(text) {
  try {
    const lines = text.trim().split('\n');
    return lines.map((line) => {
      const [lat, lng] = line.split(',').map((s) => parseFloat(s.trim()));
      if (isNaN(lat) || isNaN(lng)) throw new Error('Invalid coordinate');
      return [lat, lng];
    });
  } catch {
    return null;
  }
}

function boundsToText(bounds) {
  return bounds.map(([lat, lng]) => `${lat}, ${lng}`).join('\n');
}

function ZoneForm({ onSubmit, initial, onCancel, isSubZone }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    color: initial?.color || ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)],
    boundsText: initial?.bounds ? boundsToText(initial.bounds) : '',
  });
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name) {
      setError('Name is required');
      return;
    }
    const bounds = parseBounds(form.boundsText);
    if (!bounds || bounds.length < 3) {
      setError('Enter at least 3 coordinates (lat, lng per line)');
      return;
    }
    setError('');
    onSubmit({ name: form.name, color: form.color, bounds });
  };

  return (
    <form onSubmit={handleSubmit} className="zone-form">
      <input
        type="text"
        placeholder={isSubZone ? 'Sub-zone name' : 'Zone name'}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      <div className="form-row">
        <label>Color:</label>
        <div className="color-picker">
          {ZONE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${form.color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
      </div>
      <textarea
        placeholder="Coordinates (one per line)&#10;lat, lng&#10;34.10, -118.40&#10;34.10, -118.20&#10;34.00, -118.20"
        value={form.boundsText}
        onChange={(e) => setForm({ ...form, boundsText: e.target.value })}
        rows={5}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {initial ? 'Update' : isSubZone ? 'Add Sub-zone' : 'Add Zone'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function SubZoneCard({ subZone, zone }) {
  const { deleteSubZone, updateSubZone, selectSubZone, setMapView, state } =
    useApp();
  const [editing, setEditing] = useState(false);
  const isSelected = state.selectedSubZone === subZone.id;

  const storesInSubZone = state.stores.filter(
    (s) => s.subZoneId === subZone.id
  );

  if (editing) {
    return (
      <div className="subzone-card">
        <ZoneForm
          initial={subZone}
          isSubZone
          onSubmit={(updated) => {
            updateSubZone(zone.id, { ...subZone, ...updated });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={`subzone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        selectSubZone(subZone.id);
        setMapView(getPolygonCenter(subZone.bounds), 14);
      }}
    >
      <div className="subzone-header">
        <div
          className="color-dot"
          style={{ background: subZone.color }}
        />
        <span className="subzone-name">{subZone.name}</span>
        <span className="count-badge small">{storesInSubZone.length} stores</span>
      </div>
      <div className="subzone-actions">
        <button
          className="btn btn-xs btn-secondary"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          className="btn btn-xs btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            deleteSubZone(zone.id, subZone.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ZoneCard({ zone }) {
  const { deleteZone, updateZone, selectZone, addSubZone, setMapView, state } =
    useApp();
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isSelected = state.selectedZone === zone.id;

  const storesInZone = state.stores.filter((s) => s.zoneId === zone.id);

  if (editing) {
    return (
      <div className={`zone-card ${isSelected ? 'selected' : ''}`}>
        <ZoneForm
          initial={zone}
          onSubmit={(updated) => {
            updateZone({ ...zone, ...updated });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`zone-card ${isSelected ? 'selected' : ''}`}>
      <div
        className="zone-card-header"
        onClick={() => {
          selectZone(zone.id);
          setMapView(getPolygonCenter(zone.bounds), 13);
        }}
      >
        <div className="zone-title-row">
          <div className="color-dot" style={{ background: zone.color }} />
          <h4>{zone.name}</h4>
        </div>
        <div className="zone-meta">
          <span className="count-badge">{storesInZone.length} stores</span>
          <span className="count-badge">{zone.subZones.length} sub-zones</span>
        </div>
      </div>

      <div className="zone-card-actions">
        <button
          className="btn btn-xs btn-secondary"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button
          className="btn btn-xs btn-secondary"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
        <button
          className="btn btn-xs btn-primary"
          onClick={() => setAddingSub(!addingSub)}
        >
          + Sub-zone
        </button>
        <button
          className="btn btn-xs btn-danger"
          onClick={() => deleteZone(zone.id)}
        >
          Delete
        </button>
      </div>

      {addingSub && (
        <div className="subzone-form-wrapper">
          <ZoneForm
            isSubZone
            onSubmit={(subZone) => {
              addSubZone(zone.id, subZone);
              setAddingSub(false);
            }}
            onCancel={() => setAddingSub(false)}
          />
        </div>
      )}

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
              <h5>Stores in zone:</h5>
              <ul>
                {storesInZone.map((s) => (
                  <li key={s.id}>{s.name}</li>
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
  const { state, addZone } = useApp();
  const { zones } = state;
  const [showForm, setShowForm] = useState(false);

  const totalSubZones = zones.reduce((sum, z) => sum + z.subZones.length, 0);

  return (
    <div className="zone-panel">
      <div className="panel-header">
        <h3>Zones</h3>
        <span className="count-badge">
          {zones.length} zones, {totalSubZones} sub-zones
        </span>
      </div>

      <button
        className="btn btn-primary add-zone-btn"
        onClick={() => setShowForm(!showForm)}
      >
        {showForm ? 'Cancel' : '+ Add Zone'}
      </button>

      {showForm && (
        <ZoneForm
          onSubmit={(zone) => {
            addZone(zone);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="zone-list">
        {zones.length === 0 ? (
          <p className="empty-text">No zones defined</p>
        ) : (
          zones.map((zone) => <ZoneCard key={zone.id} zone={zone} />)
        )}
      </div>
    </div>
  );
}

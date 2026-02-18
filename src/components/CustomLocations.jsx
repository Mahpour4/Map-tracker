import { useState, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { reverseGeocode } from '../utils/geocodeAddress';

const CUSTOM_TYPE_LABELS = {
  'gas-station': 'Gas Station',
  'storage': 'Storage',
  'warehouse': 'Warehouse',
  'meeting-point': 'Meeting Point',
  'driver-home': 'Driver Home',
  'other': 'Other',
};

const TYPE_COLORS = {
  'gas-station': '#ef4444',
  'storage': '#8b5cf6',
  'warehouse': '#f59e0b',
  'meeting-point': '#06b6d4',
  'driver-home': '#ec4899',
  'other': '#6b7280',
};

function isValidCoord(lat, lng) {
  return lat != null && lng != null && Math.abs(lat) > 1 && Math.abs(lng) > 1;
}

export default function CustomLocations() {
  const { state, addCustomLocation, updateCustomLocation, deleteCustomLocation } = useApp();
  const { customLocations } = state;

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'gas-station', address: '', lat: '', lng: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [lookingUp, setLookingUp] = useState(false);
  const lookupRef = useRef(0);

  const doReverseLookup = useCallback(async (lat, lng) => {
    const id = ++lookupRef.current;
    setLookingUp(true);
    try {
      const addr = await reverseGeocode(parseFloat(lat), parseFloat(lng));
      if (id === lookupRef.current && addr) {
        setForm(f => f.address ? f : { ...f, address: addr });
      }
    } finally {
      if (id === lookupRef.current) setLookingUp(false);
    }
  }, []);

  const filteredLocations = useMemo(() => {
    let result = customLocations;
    if (filterType !== 'all') {
      result = result.filter(cl => cl.type === filterType);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(cl =>
        (cl.name || '').toLowerCase().includes(q) ||
        (cl.address || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [customLocations, filterType, searchTerm]);

  function handleAdd() {
    setEditing('new');
    setForm({ name: '', type: 'gas-station', address: '', lat: '', lng: '' });
  }

  function handleEdit(loc) {
    setEditing(loc.id);
    setForm({
      name: loc.name,
      type: loc.type || 'other',
      address: loc.address || '',
      lat: String(loc.lat || ''),
      lng: String(loc.lng || ''),
    });
    if (!loc.address && loc.lat && loc.lng) {
      doReverseLookup(loc.lat, loc.lng);
    }
  }

  function handleSave() {
    if (!form.name.trim()) return;

    if (editing === 'new') {
      const lat = parseFloat(form.lat);
      const lng = parseFloat(form.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      addCustomLocation({
        name: form.name.trim(),
        type: form.type,
        address: form.address.trim(),
        lat,
        lng,
      });
    } else {
      updateCustomLocation({
        id: editing,
        name: form.name.trim(),
        type: form.type,
        address: form.address.trim(),
      });
    }
    setEditing(null);
    setForm({ name: '', type: 'gas-station', address: '', lat: '', lng: '' });
  }

  function handleDelete(loc) {
    if (window.confirm(`Delete custom location "${loc.name}"?`)) {
      deleteCustomLocation(loc.id);
    }
  }

  function handleCancel() {
    setEditing(null);
    setForm({ name: '', type: 'gas-station', address: '', lat: '', lng: '' });
  }

  return (
    <div className="cl-page">
      <div className="cl-header">
        <h2>Custom Locations</h2>
        <p className="cl-desc">
          Manage custom locations used by the travel log proximity detection system.
          Gas stations, meeting points, driver homes, and other frequently visited spots.
        </p>
      </div>

      <div className="cl-filters">
        <input
          className="cl-search"
          type="text"
          placeholder="Search by name or address..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <select
          className="cl-type-filter"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All Types ({customLocations.length})</option>
          {Object.entries(CUSTOM_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="cl-list">
        {filteredLocations.length === 0 && editing !== 'new' && (
          <div className="cl-empty">
            {customLocations.length === 0
              ? 'No custom locations yet. Click "+ Add Location" to create one, or use Travel Log to create locations from GPS data.'
              : 'No locations match your filters.'}
          </div>
        )}

        {filteredLocations.map(loc => (
          <div key={loc.id} className={`cl-card ${editing === loc.id ? 'editing' : ''}`}>
            {editing === loc.id ? (
              <div className="cl-form">
                <input
                  className="cl-input"
                  placeholder="Name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
                <select
                  className="cl-input"
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value })}
                >
                  {Object.entries(CUSTOM_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <input
                  className="cl-input"
                  placeholder={lookingUp ? 'Looking up address...' : 'Address (optional)'}
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                />
                <div className="cl-coords-readonly">
                  Coordinates: {loc.lat?.toFixed(5)}, {loc.lng?.toFixed(5)}
                </div>
                <div className="cl-form-actions">
                  <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={!form.name.trim()}>Save</button>
                  <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="cl-card-info">
                  <div className="cl-card-name">
                    <span className="cl-type-dot" style={{ background: TYPE_COLORS[loc.type] || '#6b7280' }} />
                    <strong>{loc.name}</strong>
                    <span className="cl-type-badge" style={{ background: TYPE_COLORS[loc.type] || '#6b7280' }}>
                      {CUSTOM_TYPE_LABELS[loc.type] || loc.type}
                    </span>
                  </div>
                  {loc.address && <span className="cl-address">{loc.address}</span>}
                  {isValidCoord(loc.lat, loc.lng) && (
                    <span className="cl-coords-display">
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </span>
                  )}
                </div>
                <div className="cl-card-actions">
                  <button className="btn btn-sm" onClick={() => handleEdit(loc)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(loc)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}

        {editing === 'new' && (
          <div className="cl-card editing">
            <div className="cl-form">
              <input
                className="cl-input"
                placeholder="Name (e.g. Shell Gas Station)"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
              <select
                className="cl-input"
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
              >
                {Object.entries(CUSTOM_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <input
                className="cl-input"
                placeholder={lookingUp ? 'Looking up address...' : 'Address (optional — auto-fills from coordinates)'}
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
              <div className="cl-coords">
                <input
                  className="cl-input cl-coord"
                  placeholder="Latitude"
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={e => setForm({ ...form, lat: e.target.value })}
                  onBlur={() => {
                    if (form.lat && form.lng && !form.address) doReverseLookup(form.lat, form.lng);
                  }}
                />
                <input
                  className="cl-input cl-coord"
                  placeholder="Longitude"
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={e => setForm({ ...form, lng: e.target.value })}
                  onBlur={() => {
                    if (form.lat && form.lng && !form.address) doReverseLookup(form.lat, form.lng);
                  }}
                />
              </div>
              <div className="cl-form-actions">
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={!form.name.trim()}>Save</button>
                <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {editing !== 'new' && (
        <button className="btn btn-primary cl-add-btn" onClick={handleAdd}>
          + Add Location
        </button>
      )}
    </div>
  );
}

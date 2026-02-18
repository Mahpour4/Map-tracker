import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useApp } from '../context/AppContext';

export default function WarehouseSettings() {
  const { state, setWarehouses } = useApp();
  const { warehouses } = state;

  const [editing, setEditing] = useState(null); // id or 'new'
  const [form, setForm] = useState({ name: '', address: '', lat: '', lng: '' });

  function handleAdd() {
    setEditing('new');
    setForm({ name: '', address: '', lat: '', lng: '' });
  }

  function handleEdit(wh) {
    setEditing(wh.id);
    setForm({ name: wh.name, address: wh.address || '', lat: String(wh.lat), lng: String(wh.lng) });
  }

  function handleSave() {
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    if (!form.name.trim() || isNaN(lat) || isNaN(lng)) return;

    if (editing === 'new') {
      setWarehouses([...warehouses, { id: uuidv4(), name: form.name.trim(), address: form.address.trim(), lat, lng }]);
    } else {
      setWarehouses(warehouses.map(wh =>
        wh.id === editing ? { ...wh, name: form.name.trim(), address: form.address.trim(), lat, lng } : wh
      ));
    }
    setEditing(null);
    setForm({ name: '', address: '', lat: '', lng: '' });
  }

  function handleDelete(id) {
    setWarehouses(warehouses.filter(wh => wh.id !== id));
  }

  function handleCancel() {
    setEditing(null);
    setForm({ name: '', address: '', lat: '', lng: '' });
  }

  return (
    <div className="wh-page">
      <div className="wh-header">
        <h2>Warehouse / Home Base Locations</h2>
        <p className="wh-desc">
          These locations are used by the auto-visit system. When a truck is within ~1000ft and moving slowly,
          the travel log will record it as a warehouse stop.
        </p>
      </div>

      <div className="wh-list">
        {warehouses.length === 0 && !editing && (
          <div className="wh-empty">
            No warehouse locations configured. Click "Add Location" to get started.
          </div>
        )}

        {warehouses.map(wh => (
          <div key={wh.id} className={`wh-card ${editing === wh.id ? 'editing' : ''}`}>
            {editing === wh.id ? (
              <div className="wh-form">
                <input
                  className="wh-input"
                  placeholder="Name (e.g. Main Warehouse)"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
                <input
                  className="wh-input"
                  placeholder="Address (optional)"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                />
                <div className="wh-coords">
                  <input
                    className="wh-input wh-coord"
                    placeholder="Latitude"
                    type="number"
                    step="any"
                    value={form.lat}
                    onChange={e => setForm({ ...form, lat: e.target.value })}
                  />
                  <input
                    className="wh-input wh-coord"
                    placeholder="Longitude"
                    type="number"
                    step="any"
                    value={form.lng}
                    onChange={e => setForm({ ...form, lng: e.target.value })}
                  />
                </div>
                <div className="wh-form-actions">
                  <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
                  <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="wh-card-info">
                  <strong>{wh.name}</strong>
                  {wh.address && <span className="wh-address">{wh.address}</span>}
                  <span className="wh-coords-display">
                    {wh.lat.toFixed(5)}, {wh.lng.toFixed(5)}
                  </span>
                </div>
                <div className="wh-card-actions">
                  <button className="btn btn-sm" onClick={() => handleEdit(wh)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(wh.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}

        {editing === 'new' && (
          <div className="wh-card editing">
            <div className="wh-form">
              <input
                className="wh-input"
                placeholder="Name (e.g. Main Warehouse)"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
              <input
                className="wh-input"
                placeholder="Address (optional)"
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
              <div className="wh-coords">
                <input
                  className="wh-input wh-coord"
                  placeholder="Latitude"
                  type="number"
                  step="any"
                  value={form.lat}
                  onChange={e => setForm({ ...form, lat: e.target.value })}
                />
                <input
                  className="wh-input wh-coord"
                  placeholder="Longitude"
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={e => setForm({ ...form, lng: e.target.value })}
                />
              </div>
              <div className="wh-form-actions">
                <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
                <button className="btn btn-sm" onClick={handleCancel}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {editing !== 'new' && (
        <button className="btn btn-primary wh-add-btn" onClick={handleAdd}>
          + Add Location
        </button>
      )}
    </div>
  );
}

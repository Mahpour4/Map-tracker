import { useState } from 'react';
import { useApp } from '../context/AppContext';

const STORE_TYPES = ['supermarket', 'grocery', 'convenience'];

function StoreForm({ onSubmit, initial, onCancel }) {
  const [form, setForm] = useState(
    initial || {
      name: '',
      address: '',
      lat: '',
      lng: '',
      type: 'grocery',
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.lat || !form.lng) return;
    onSubmit({
      ...form,
      lat: parseFloat(form.lat),
      lng: parseFloat(form.lng),
    });
    if (!initial) {
      setForm({ name: '', address: '', lat: '', lng: '', type: 'grocery' });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="store-form">
      <input
        type="text"
        placeholder="Store name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      <input
        type="text"
        placeholder="Address"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <div className="form-row">
        <input
          type="number"
          step="any"
          placeholder="Latitude"
          value={form.lat}
          onChange={(e) => setForm({ ...form, lat: e.target.value })}
          required
        />
        <input
          type="number"
          step="any"
          placeholder="Longitude"
          value={form.lng}
          onChange={(e) => setForm({ ...form, lng: e.target.value })}
          required
        />
      </div>
      <select
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value })}
      >
        {STORE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {initial ? 'Update' : 'Add Store'}
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

function StoreCard({ store, zones }) {
  const { selectStore, deleteStore, updateStore, setMapView, state } = useApp();
  const [editing, setEditing] = useState(false);
  const isSelected = state.selectedStore === store.id;

  const zone = zones.find((z) => z.id === store.zoneId);
  const subZone = zone?.subZones.find((sz) => sz.id === store.subZoneId);

  const typeColors = {
    supermarket: { bg: '#fee2e2', text: '#991b1b' },
    grocery: { bg: '#dcfce7', text: '#166534' },
    convenience: { bg: '#fef3c7', text: '#92400e' },
  };
  const typeColor = typeColors[store.type] || { bg: '#f3f4f6', text: '#374151' };

  if (editing) {
    return (
      <div className={`store-card ${isSelected ? 'selected' : ''}`}>
        <StoreForm
          initial={store}
          onSubmit={(updated) => {
            updateStore({ ...store, ...updated });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={`store-card ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        selectStore(store.id);
        setMapView([store.lat, store.lng], 15);
      }}
    >
      <div className="store-card-header">
        <h4>{store.name}</h4>
        <span
          className="store-type-badge"
          style={{ background: typeColor.bg, color: typeColor.text }}
        >
          {store.type}
        </span>
      </div>
      {store.address && <p className="store-address">{store.address}</p>}
      <p className="store-coords">
        {store.lat.toFixed(4)}, {store.lng.toFixed(4)}
      </p>
      <div className="store-zone-info">
        {zone ? (
          <span className="zone-badge" style={{ borderColor: zone.color }}>
            {zone.name}
            {subZone && ` > ${subZone.name}`}
          </span>
        ) : (
          <span className="zone-badge unassigned">Unassigned</span>
        )}
      </div>
      <div className="store-card-actions">
        <button
          className="btn btn-sm btn-secondary"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            deleteStore(store.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function StorePanel() {
  const { state, addStore } = useApp();
  const { stores, zones } = state;
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');

  const filteredStores =
    filter === 'all'
      ? stores
      : filter === 'unassigned'
      ? stores.filter((s) => !s.zoneId)
      : stores.filter((s) => s.type === filter);

  const storeCount = stores.length;
  const assignedCount = stores.filter((s) => s.zoneId).length;

  return (
    <div className="store-panel">
      <div className="panel-header">
        <h3>Stores</h3>
        <span className="count-badge">
          {assignedCount}/{storeCount} assigned
        </span>
      </div>

      <div className="panel-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All stores</option>
          <option value="unassigned">Unassigned</option>
          {STORE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showForm && (
        <StoreForm
          onSubmit={(store) => {
            addStore(store);
            setShowForm(false);
          }}
        />
      )}

      <div className="store-list">
        {filteredStores.length === 0 ? (
          <p className="empty-text">No stores found</p>
        ) : (
          filteredStores.map((store) => (
            <StoreCard key={store.id} store={store} zones={zones} />
          ))
        )}
      </div>
    </div>
  );
}

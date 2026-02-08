import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

const STORE_TYPES = [
  'food-lion', 'shoppers', 'wegmans', 'walmart', 'giant-martins',
  'weis', 'redners', 'acme', 'geresbecks', 'other',
];

const typeLabels = {
  'food-lion': 'Food Lion',
  'shoppers': 'Shoppers/ShopRite',
  'wegmans': 'Wegmans',
  'walmart': 'Walmart',
  'giant-martins': 'Giant/Martins',
  'weis': 'Weis',
  'redners': 'Redners',
  'acme': 'Acme',
  'geresbecks': 'Geresbecks',
  'other': 'Other',
};

const typeColors = {
  'food-lion': { bg: '#fee2e2', text: '#991b1b' },
  'shoppers': { bg: '#dbeafe', text: '#1e40af' },
  'wegmans': { bg: '#ede9fe', text: '#5b21b6' },
  'walmart': { bg: '#fef3c7', text: '#92400e' },
  'giant-martins': { bg: '#ffedd5', text: '#9a3412' },
  'weis': { bg: '#cffafe', text: '#155e75' },
  'redners': { bg: '#fce7f3', text: '#9d174d' },
  'acme': { bg: '#dcfce7', text: '#166534' },
  'geresbecks': { bg: '#ccfbf1', text: '#115e59' },
  'other': { bg: '#f3f4f6', text: '#374151' },
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StoreCard({ store, index }) {
  const { selectStore, deleteStore, setMapView, state } = useApp();
  const isSelected = state.selectedStore === store.id;
  const tc = typeColors[store.type] || typeColors.other;

  const zone = state.zones.find((z) => z.id === store.zoneId);

  return (
    <div
      className={`store-card ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        selectStore(store.id);
      }}
    >
      <div className="store-card-header">
        <h4><span className="store-index">{index}.</span> {store.name}</h4>
        <span
          className="store-type-badge"
          style={{ background: tc.bg, color: tc.text }}
        >
          {typeLabels[store.type] || store.type}
        </span>
      </div>

      <p className="store-address">
        {store.address}, {store.city}, {store.state} {store.zip}
      </p>

      <div className="store-meta-row">
        {store.storeNumber && (
          <span className="meta-tag">#{store.storeNumber}</span>
        )}
        {store.routeNumber && store.routeNumber !== '0' && (
          <span className="meta-tag">Route {store.routeNumber}</span>
        )}
        {store.driver && (
          <span className="meta-tag">{store.driver}</span>
        )}
      </div>

      <div className="store-zone-info">
        {zone && zone.name !== 'Unassigned' ? (
          <span className="zone-badge" style={{ borderColor: zone.color, color: zone.color }}>
            {zone.name}
          </span>
        ) : (
          <span className="zone-badge unassigned">Unassigned</span>
        )}
        {store.lastVisited && (
          <span className="last-visited">
            Visited {formatDate(store.lastVisited)}
          </span>
        )}
      </div>

      <div className="store-card-actions">
        <button
          className="btn btn-sm btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            deleteStore(store.id);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export default function StorePanel() {
  const { state, setSearch, setFilterRegion, setFilterType } = useApp();
  const { stores, zones, searchTerm, filterRegion, filterType } = state;
  const [showAdd, setShowAdd] = useState(false);

  const regions = useMemo(() => {
    const set = new Set(stores.map((s) => s.region));
    return Array.from(set).sort();
  }, [stores]);

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

  const assignedCount = stores.filter((s) => s.zoneId && s.region !== 'Unassigned').length;

  return (
    <div className="store-panel">
      <div className="panel-header">
        <h3>Stores</h3>
        <span className="count-badge">
          {assignedCount}/{stores.length} assigned
        </span>
      </div>

      <input
        type="text"
        placeholder="Search stores by name, city, address..."
        value={searchTerm}
        onChange={(e) => setSearch(e.target.value)}
        className="search-input"
      />

      <div className="panel-filters">
        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
          <option value="all">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="all">All types</option>
          {STORE_TYPES.map((t) => (
            <option key={t} value={t}>{typeLabels[t]}</option>
          ))}
        </select>
      </div>

      <div className="results-count">
        Showing {filteredStores.length} of {stores.length} stores
      </div>

      <div className="store-list">
        {filteredStores.length === 0 ? (
          <p className="empty-text">No stores match your filters</p>
        ) : (
          filteredStores.map((store, i) => (
            <StoreCard key={store.id} store={store} index={i + 1} />
          ))
        )}
      </div>
    </div>
  );
}

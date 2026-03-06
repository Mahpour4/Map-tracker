import { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

const STORE_TYPES = [
  'food-lion', 'shoppers', 'shoprite', 'wegmans', 'walmart', 'giant-martins',
  'weis', 'redners', 'acme', 'geresbecks', 'military', 'other',
];

const typeLabels = {
  'food-lion': 'Food Lion',
  'shoppers': 'Shoppers',
  'shoprite': 'ShopRite',
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

const typeColors = {
  'food-lion': { bg: '#fee2e2', text: '#991b1b' },
  'shoppers': { bg: '#dbeafe', text: '#1e40af' },
  'shoprite': { bg: '#e0f2fe', text: '#075985' },
  'wegmans': { bg: '#ede9fe', text: '#5b21b6' },
  'walmart': { bg: '#fef3c7', text: '#92400e' },
  'giant-martins': { bg: '#ffedd5', text: '#9a3412' },
  'weis': { bg: '#cffafe', text: '#155e75' },
  'redners': { bg: '#fce7f3', text: '#9d174d' },
  'acme': { bg: '#dcfce7', text: '#166534' },
  'geresbecks': { bg: '#ccfbf1', text: '#115e59' },
  'military': { bg: '#e0e7ff', text: '#3730a3' },
  'other': { bg: '#f3f4f6', text: '#374151' },
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  const raw = dateStr.split('T')[0];
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StoreCard({ store, index, routes, scrollRef }) {
  const { selectStore, deleteStore, updateStore, setMapView, state, recordVisit } = useApp();
  const isSelected = state.selectedStore === store.id;
  const tc = typeColors[store.type] || typeColors.other;
  const isUnassignedRoute = !store.routeNumber || store.routeNumber === '0';
  const [editingVisit, setEditingVisit] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [copied, setCopied] = useState(false);
  const visitDateRef = useRef(null);
  const cardRef = useRef(null);

  // Auto-scroll into view when selected externally
  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isSelected]);

  const zone = state.zones.find((z) => z.id === store.zoneId);

  const copyAlert = (e) => {
    e.stopPropagation();
    const sale = store.lastSaleDate ? formatDate(store.lastSaleDate) : null;
    const visit = store.lastVisited ? formatDate(store.lastVisited) : null;
    const lastService = [sale ? `Sale: ${sale}` : null, visit ? `Visit: ${visit}` : null].filter(Boolean).join(' / ') || 'Never';
    const msg = `🚨 *ALERT - Service Required*\n\nStore: ${store.name}\nStore #: ${store.id}\nAddress: ${store.address}, ${store.city}, ${store.state} ${store.zip}\nLast Service: ${lastService}\n\n⚠️ This store needs to be serviced.`;
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openVisitEdit = (e) => {
    e.stopPropagation();
    setEditingVisit(true);
    setVisitDate(new Date().toISOString().split('T')[0]);
    setTimeout(() => {
      try { visitDateRef.current?.showPicker(); } catch (_) {}
    }, 50);
  };

  const saveVisit = (e) => {
    e.stopPropagation();
    if (!visitDate) return;
    const ymd = visitDate.split('T')[0].split(' ')[0];
    if (!ymd) return;
    recordVisit(store.id, ymd);
    setEditingVisit(false);
    setVisitDate('');
  };

  const cancelVisitEdit = (e) => {
    e.stopPropagation();
    setEditingVisit(false);
    setVisitDate('');
  };

  return (
    <div
      ref={cardRef}
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
        <span
          className="last-visited last-visited-clickable"
          onClick={openVisitEdit}
          title="Click to edit visit date"
        >
          {store.lastSaleDate ? `Sale: ${formatDate(store.lastSaleDate)}` : ''}
          {store.lastSaleDate && store.lastVisited ? ' / ' : ''}
          {store.lastVisited ? `Visit: ${formatDate(store.lastVisited)}` : ''}
          {!store.lastSaleDate && !store.lastVisited ? 'No date' : ''}
        </span>
      </div>
      {editingVisit && (
        <div className="store-visit-edit" onClick={(e) => e.stopPropagation()}>
          <input
            ref={visitDateRef}
            type="date"
            className="store-visit-date-input"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
          <button className="store-visit-save-btn" onClick={saveVisit} disabled={!visitDate}>Save</button>
          <button className="store-visit-cancel-btn" onClick={cancelVisitEdit}>&times;</button>
        </div>
      )}

      <div className="store-card-actions">
        <button
          className="btn btn-sm store-alert-btn"
          onClick={copyAlert}
          title="Copy WhatsApp alert to clipboard"
        >
          {copied ? 'Copied!' : 'Alert'}
        </button>
        {isUnassignedRoute ? (
          <select
            className="route-assign-select"
            value=""
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (e.target.value) {
                updateStore({ id: store.id, routeNumber: e.target.value });
              }
            }}
          >
            <option value="">Assign to route...</option>
            {routes.map((r) => (
              <option key={r} value={r}>Route {r}</option>
            ))}
          </select>
        ) : (
          <button
            className="btn btn-sm btn-warning"
            onClick={(e) => {
              e.stopPropagation();
              updateStore({ id: store.id, routeNumber: '0' });
            }}
          >
            Unassign
          </button>
        )}
        <button
          className="btn btn-sm btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            const pwd = prompt('Enter password to remove this store:');
            if (pwd === '1234') {
              deleteStore(store.id);
            } else if (pwd !== null) {
              alert('Incorrect password');
            }
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export default function StorePanel() {
  const { state, setSearch, setFilterRegion, setFilterType, setFilterRoute } = useApp();
  const { stores, zones, searchTerm, filterRegion, filterType, filterRoute } = state;
  const [showAdd, setShowAdd] = useState(false);

  const regions = useMemo(() => {
    const set = new Set(stores.map((s) => s.region));
    return Array.from(set).sort();
  }, [stores]);

  const routes = useMemo(() => {
    const set = new Set(stores.map((s) => s.routeNumber).filter((r) => r && r !== '0'));
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
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

    if (filterRoute !== 'all') {
      if (filterRoute === '0') {
        result = result.filter((s) => !s.routeNumber || s.routeNumber === '0');
      } else if (filterRoute === 'MIL') {
        result = result.filter((s) => s.id.startsWith('CMW'));
      } else {
        result = result.filter((s) => s.routeNumber === filterRoute);
      }
    }

    return result;
  }, [stores, searchTerm, filterRegion, filterType, filterRoute]);

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
        <select value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)}>
          <option value="all">All routes</option>
          <option value="0">Unassigned</option>
          <option value="MIL">Military (All)</option>
          {routes.map((r) => (
            <option key={r} value={r}>Route {r}</option>
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
            <StoreCard key={store.id} store={store} index={i + 1} routes={routes} />
          ))
        )}
      </div>
    </div>
  );
}

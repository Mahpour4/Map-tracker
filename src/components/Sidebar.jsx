import { useApp } from '../context/AppContext';
import StorePanel from './StorePanel';
import ZonePanel from './ZonePanel';

export default function Sidebar() {
  const { state, setSidebarTab } = useApp();
  const { sidebarTab } = state;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Map Tracker</h2>
      </div>
      <div className="sidebar-tabs">
        <button
          className={`tab-btn ${sidebarTab === 'stores' ? 'active' : ''}`}
          onClick={() => setSidebarTab('stores')}
        >
          Stores
        </button>
        <button
          className={`tab-btn ${sidebarTab === 'zones' ? 'active' : ''}`}
          onClick={() => setSidebarTab('zones')}
        >
          Zones
        </button>
      </div>
      <div className="sidebar-content">
        {sidebarTab === 'stores' ? <StorePanel /> : <ZonePanel />}
      </div>
    </aside>
  );
}

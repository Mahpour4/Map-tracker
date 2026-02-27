import { useState, Component, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { version } from '../package.json';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import RouteLeaderboard from './components/RouteLeaderboard';
import VisitHistory from './components/VisitHistory';
import RouteSchedule from './components/RouteSchedule';
import DataImport from './components/DataImport';
import AlertLog from './components/AlertLog';
import AlertAnalytics from './components/AlertAnalytics';
import FleetTracker from './components/FleetTracker';
import FuelTracker from './components/FuelTracker';
import DriverDashboard from './components/DriverDashboard';
import TravelLog from './components/TravelLog';
import WarehouseSettings from './components/WarehouseSettings';
import CustomLocations from './components/CustomLocations';
import Transactions from './components/Transactions';
import WarehouseOrders from './components/WarehouseOrders';
import './App.css';

// ── Global error boundary ─────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[App] Render error caught by ErrorBoundary:', error);
    console.error('[App] Component stack:', info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#c00' }}>Something went wrong</h2>
          <pre style={{ color: '#333', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12 }}>
            Dismiss and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Global unhandled error / rejection logging ────────────────────────────────
function useGlobalErrorLogging() {
  useEffect(() => {
    const onError = (event) => {
      console.error('[App] Unhandled error:', event.message, '|', event.filename, 'line', event.lineno);
    };
    const onUnhandledRejection = (event) => {
      console.error('[App] Unhandled promise rejection:', event.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);
}

const NAV_GROUPS = [
  {
    id: 'fleet',
    label: 'Fleet',
    items: [
      { id: 'fleet', label: 'Fleet Tracker' },
      { id: 'fuel', label: 'Fuel Tracker' },
      { id: 'travelLog', label: 'Travel Log' },
    ],
  },
  {
    id: 'routes',
    label: 'Routes',
    items: [
      { id: 'map', label: 'Map View' },
      { id: 'schedule', label: 'Route Schedule' },
      { id: 'leaderboard', label: 'Route Leaderboard' },
      { id: 'drivers', label: 'Driver Dashboard' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'warehouseOrders', label: 'Orders' },
      { id: 'transactions', label: 'Transactions' },
      { id: 'import', label: 'Data Import' },
      { id: 'alerts', label: 'Alert Log' },
      { id: 'visits', label: 'Visit History' },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    items: [
      { id: 'warehouses', label: 'Warehouses' },
      { id: 'customLocations', label: 'Custom Locations' },
    ],
  },
];

function getActiveGroup(page) {
  return NAV_GROUPS.find(g => g.items.some(i => i.id === page || (page === 'alertAnalytics' && i.id === 'alerts')))?.id || null;
}

function AppContent() {
  useGlobalErrorLogging();
  const { state, setPage } = useApp();
  const page = state.currentPage;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openGroup, setOpenGroup] = useState(() => getActiveGroup(state.currentPage));

  const nav = (target) => {
    setPage(target);
    setMenuOpen(false);
  };

  const toggleGroup = (groupId) => {
    setOpenGroup(prev => prev === groupId ? null : groupId);
  };

  return (
    <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar />
      <main className="map-wrapper">
        <header className="page-nav">
          {/* Brand — far left */}
          <div className="page-nav-brand">
            <svg className="page-nav-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            <span className="page-nav-brand-name">Map Tracker</span>
          </div>

          {/* Nav links — center */}
          <nav className={`page-nav-links${menuOpen ? ' open' : ''}`} aria-label="Main navigation">
            {/* Pinned top-level tabs */}
            <button className={`page-nav-btn${page === 'map' ? ' active' : ''}`} onClick={() => nav('map')}>Map</button>
            <button className={`page-nav-btn${page === 'warehouseOrders' ? ' active' : ''}`} onClick={() => nav('warehouseOrders')}>Orders</button>
            <button className={`page-nav-btn${page === 'alerts' || page === 'alertAnalytics' ? ' active' : ''}`} onClick={() => nav('alerts')}>Alerts</button>
            <span className="page-nav-divider" />
            {/* Group dropdowns */}
            {NAV_GROUPS.map(group => {
              const isGroupActive = group.items.some(i => i.id === page || (page === 'alertAnalytics' && i.id === 'alerts'));
              const isOpen = openGroup === group.id;
              return (
                <button
                  key={group.id}
                  className={`page-nav-btn page-nav-group-btn${isGroupActive ? ' active' : ''}${isOpen ? ' open' : ''}`}
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                >
                  {group.label}
                  <svg className="page-nav-group-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="2 4 6 8 10 4" />
                  </svg>
                </button>
              );
            })}
          </nav>

          {/* Sub-nav row — slides down when a group is open */}
          {NAV_GROUPS.map(group => (
            <div key={group.id} className={`page-nav-subnav${openGroup === group.id ? ' open' : ''}`} aria-hidden={openGroup !== group.id}>
              {group.items.map(item => (
                <button
                  key={item.id}
                  className={`page-nav-subnav-btn${(page === item.id || (page === 'alertAnalytics' && item.id === 'alerts')) ? ' active' : ''}`}
                  onClick={() => { nav(item.id); setOpenGroup(null); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          {/* Actions — far right */}
          <div className="page-nav-actions">
            <button
              className="page-nav-sidebar-toggle"
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
                  <polyline points="13 8 17 12 13 16" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
                  <polyline points="15 8 11 12 15 16" />
                </svg>
              )}
            </button>
            <button className="page-nav-profile" title="User profile" aria-label="User profile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
            <button
              className={`page-nav-hamburger${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Toggle navigation menu"
              aria-expanded={menuOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </header>
        {page === 'map' && <MapView />}
        {page === 'leaderboard' && <RouteLeaderboard />}
        {page === 'drivers' && <DriverDashboard />}
        {page === 'visits' && <VisitHistory />}
        {page === 'schedule' && <RouteSchedule />}
        {page === 'import' && <DataImport />}
        {page === 'alerts' && <AlertLog />}
        {page === 'alertAnalytics' && <AlertAnalytics />}
        {page === 'fleet' && <FleetTracker />}
        {page === 'fuel' && <FuelTracker />}
        {page === 'transactions' && <Transactions />}
        {page === 'warehouseOrders' && <WarehouseOrders />}
        {page === 'travelLog' && <TravelLog />}
        {page === 'warehouses' && <WarehouseSettings />}
        {page === 'customLocations' && <CustomLocations />}
        <div className="app-version">v{version}</div>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;

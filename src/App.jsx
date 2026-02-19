import { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
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
import './App.css';

function AppContent() {
  const { state, setPage } = useApp();
  const page = state.currentPage;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const nav = (target) => { setPage(target); setMenuOpen(false); };

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
            <button className={`page-nav-btn ${page === 'map' ? 'active' : ''}`} onClick={() => nav('map')}>Map View</button>
            <button className={`page-nav-btn ${page === 'leaderboard' ? 'active' : ''}`} onClick={() => nav('leaderboard')}>Route Leaderboard</button>
            <button className={`page-nav-btn ${page === 'drivers' ? 'active' : ''}`} onClick={() => nav('drivers')}>Driver Dashboard</button>
            <button className={`page-nav-btn ${page === 'visits' ? 'active' : ''}`} onClick={() => nav('visits')}>Visit History</button>
            <button className={`page-nav-btn ${page === 'schedule' ? 'active' : ''}`} onClick={() => nav('schedule')}>Route Schedule</button>
            <button className={`page-nav-btn ${page === 'import' ? 'active' : ''}`} onClick={() => nav('import')}>Data Import</button>
            <button className={`page-nav-btn ${page === 'alerts' || page === 'alertAnalytics' ? 'active' : ''}`} onClick={() => nav('alerts')}>Alert Log</button>
            <button className={`page-nav-btn ${page === 'fleet' ? 'active' : ''}`} onClick={() => nav('fleet')}>Fleet Tracker</button>
            <button className={`page-nav-btn ${page === 'fuel' ? 'active' : ''}`} onClick={() => nav('fuel')}>Fuel Tracker</button>
            <button className={`page-nav-btn ${page === 'travelLog' ? 'active' : ''}`} onClick={() => nav('travelLog')}>Travel Log</button>
            <button className={`page-nav-btn ${page === 'warehouses' ? 'active' : ''}`} onClick={() => nav('warehouses')}>Warehouses</button>
            <button className={`page-nav-btn ${page === 'customLocations' ? 'active' : ''}`} onClick={() => nav('customLocations')}>Custom Locations</button>
          </nav>

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
        {page === 'travelLog' && <TravelLog />}
        {page === 'warehouses' && <WarehouseSettings />}
        {page === 'customLocations' && <CustomLocations />}
        <div className="app-version">v2.2.0</div>
      </main>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;

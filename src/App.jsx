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
import TravelLog from './components/TravelLog';
import WarehouseSettings from './components/WarehouseSettings';
import './App.css';

function AppContent() {
  const { state, setPage } = useApp();
  const page = state.currentPage;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="map-wrapper">
        <div className="page-nav">
          <button
            className={`page-nav-btn ${page === 'map' ? 'active' : ''}`}
            onClick={() => setPage('map')}
          >
            Map View
          </button>
          <button
            className={`page-nav-btn ${page === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setPage('leaderboard')}
          >
            Route Leaderboard
          </button>
          <button
            className={`page-nav-btn ${page === 'visits' ? 'active' : ''}`}
            onClick={() => setPage('visits')}
          >
            Visit History
          </button>
          <button
            className={`page-nav-btn ${page === 'schedule' ? 'active' : ''}`}
            onClick={() => setPage('schedule')}
          >
            Route Schedule
          </button>
          <button
            className={`page-nav-btn ${page === 'import' ? 'active' : ''}`}
            onClick={() => setPage('import')}
          >
            Data Import
          </button>
          <button
            className={`page-nav-btn ${page === 'alerts' || page === 'alertAnalytics' ? 'active' : ''}`}
            onClick={() => setPage('alerts')}
          >
            Alert Log
          </button>
          <button
            className={`page-nav-btn ${page === 'fleet' ? 'active' : ''}`}
            onClick={() => setPage('fleet')}
          >
            Fleet Tracker
          </button>
          <button
            className={`page-nav-btn ${page === 'travelLog' ? 'active' : ''}`}
            onClick={() => setPage('travelLog')}
          >
            Travel Log
          </button>
          <button
            className={`page-nav-btn ${page === 'warehouses' ? 'active' : ''}`}
            onClick={() => setPage('warehouses')}
          >
            Warehouses
          </button>
        </div>
        {page === 'map' && <MapView />}
        {page === 'leaderboard' && <RouteLeaderboard />}
        {page === 'visits' && <VisitHistory />}
        {page === 'schedule' && <RouteSchedule />}
        {page === 'import' && <DataImport />}
        {page === 'alerts' && <AlertLog />}
        {page === 'alertAnalytics' && <AlertAnalytics />}
        {page === 'fleet' && <FleetTracker />}
        {page === 'travelLog' && <TravelLog />}
        {page === 'warehouses' && <WarehouseSettings />}
        <div className="app-version">v1.7.9</div>
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

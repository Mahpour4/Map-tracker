import { useState } from 'react';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import RouteLeaderboard from './components/RouteLeaderboard';
import VisitHistory from './components/VisitHistory';
import './App.css';

function App() {
  const [page, setPage] = useState('map');

  return (
    <AppProvider>
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
          </div>
          {page === 'map' && <MapView />}
          {page === 'leaderboard' && <RouteLeaderboard />}
          {page === 'visits' && <VisitHistory />}
        </main>
      </div>
    </AppProvider>
  );
}

export default App;

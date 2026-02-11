import { useState } from 'react';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import RouteLeaderboard from './components/RouteLeaderboard';
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
          </div>
          {page === 'map' ? <MapView /> : <RouteLeaderboard />}
        </main>
      </div>
    </AppProvider>
  );
}

export default App;

import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import './App.css';

function App() {
  return (
    <AppProvider>
      <div className="app-layout">
        <Sidebar />
        <main className="map-wrapper">
          <MapView />
        </main>
      </div>
    </AppProvider>
  );
}

export default App;

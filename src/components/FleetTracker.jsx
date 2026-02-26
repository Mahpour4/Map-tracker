import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useApp } from '../context/AppContext';
import {
  getMotiveApiKey,
  setMotiveApiKey,
  clearMotiveApiKey,
  getMotiveBaseUrl,
  setMotiveBaseUrl,
  getCorsProxy,
  setCorsProxy,
  isMotiveConnected,
  fetchVehicleLocations,
  testMotiveConnection,
} from '../services/motiveService';
import { detectCurrentProximity, filterNewVisits } from '../services/proximityService';
import { getTodaySchedule, getScheduleDeviation } from '../utils/driverMetrics';

function createTruckIcon(engineStatus, isSelected) {
  const color = engineStatus === 'on' ? '#22c55e' : engineStatus === 'off' ? '#ef4444' : '#9ca3af';
  const size = isSelected ? 16 : 12;
  const border = isSelected ? '3px solid #1e3a5f' : '2px solid #fff';
  return L.divIcon({
    className: 'fleet-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      border-radius: 3px;
      border: ${border};
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      transform: rotate(45deg);
    "></div>`,
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
  });
}

export default function FleetTracker() {
  const { state, updateVehicleLocations, setFleetSyncStatus, setVehiclesOnMap, bulkRecordVisits, logTravelEntries, toggleAutoVisit } = useApp();
  const { fleetVehicles, vehicleLocations, fleetSyncStatus, fleetSyncError, showVehiclesOnMap, stores, warehouses, travelLog, autoVisitEnabled, schedules } = state;
  const [scheduleDeviations, setScheduleDeviations] = useState({});

  const [showApiSetup, setShowApiSetup] = useState(!isMotiveConnected());
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [corsProxyInput, setCorsProxyInput] = useState(getCorsProxy());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval] = useState(30);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [viewMode, setViewMode] = useState('table');
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  const refreshTimer = useRef(null);
  const connected = isMotiveConnected();

  // ---- API Key Setup ----
  const handleSaveKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setMotiveApiKey(apiKeyInput);
    if (baseUrlInput.trim()) setMotiveBaseUrl(baseUrlInput);
    setCorsProxy(corsProxyInput);
    setTesting(true);
    setTestResult(null);
    const result = await testMotiveConnection();
    setTesting(false);
    if (result.ok) {
      setTestResult('success');
      setApiKeyInput('');
      setShowApiSetup(false);
    } else {
      setTestResult(result.error);
      clearMotiveApiKey();
    }
  }, [apiKeyInput, baseUrlInput, corsProxyInput]);

  function handleDisconnect() {
    clearMotiveApiKey();
    setTestResult(null);
    setShowApiSetup(true);
    setAutoRefresh(false);
    updateVehicleLocations([]);
    setFleetSyncStatus('idle');
  }

  // ---- Data fetch & merge ----
  const handleRefreshNow = useCallback(async () => {
    if (!isMotiveConnected()) return;
    setFleetSyncStatus('loading');
    try {
      // v2 vehicle_locations includes driver info — no separate drivers call needed
      const locations = await fetchVehicleLocations();

      console.log('[Fleet] Merging', locations.length, 'API locations with', fleetVehicles.length, 'local vehicles');
      // Log all API VINs so we can compare against local vehicles
      console.log('[Fleet] API VINs:', locations.map(l => l.vin));
      console.log('[Fleet] Local VINs:', fleetVehicles.map(fv => fv.vin));

      const merged = fleetVehicles.map(fv => {
        // Try matching by VIN first, then by vehicle number, then by license plate
        const fvVin = (fv.vin || '').toUpperCase().trim();
        const apiMatch = locations.find(loc => {
          if (fvVin && loc.vin && loc.vin.toUpperCase().trim() === fvVin) return true;
          if (fv.vehicleId && loc.number && loc.number === fv.vehicleId) return true;
          if (fv.licensePlate && loc.licensePlate && loc.licensePlate === fv.licensePlate) return true;
          return false;
        });
        console.log('[Fleet] Match:', fv.vehicleId, 'VIN:', fv.vin, '→', apiMatch ? `VIN:${apiMatch.vin} num:${apiMatch.number} lat:${apiMatch.lat}` : 'NO MATCH');

        if (apiMatch) {
          return {
            ...fv,
            motiveId: apiMatch.id,
            lat: apiMatch.lat,
            lng: apiMatch.lng,
            speed: apiMatch.speed,
            bearing: apiMatch.bearing,
            engineStatus: apiMatch.engineStatus,
            driverName: apiMatch.driverName || null,
            driverStatus: apiMatch.driverStatus || null,
            lastUpdated: apiMatch.locatedAt,
            description: apiMatch.description,
            matched: true,
          };
        }

        return { ...fv, matched: false };
      });

      updateVehicleLocations(merged);
      setLastRefreshTime(new Date());

      // Real-time proximity snapshot (route-matched, type-based radius, no speed filter)
      if (autoVisitEnabled) {
        const allVisits = detectCurrentProximity(merged, stores, warehouses);
        const newVisits = filterNewVisits(allVisits, travelLog);
        if (newVisits.length > 0) {
          console.log('[Proximity] Detected visits:', newVisits);
          // Log store visits to visitHistory (for compliance/recency tracking)
          const storeVisits = newVisits
            .filter(v => v.type === 'store')
            .map(v => ({ storeId: v.locationId, date: v.time.slice(0, 10) }));
          if (storeVisits.length > 0) {
            bulkRecordVisits(storeVisits);
          }
          // Log all visits to travel log (stores + warehouses)
          logTravelEntries(newVisits);
        }
      }

      // Schedule deviation check — flag routes that are behind pace
      const deviations = {};
      for (const v of merged) {
        if (!v.routeNumber || !v.matched) continue;
        const todaySched = getTodaySchedule(schedules, v.routeNumber);
        const dev = getScheduleDeviation(v, todaySched, travelLog, stores);
        deviations[v.routeNumber] = { ...dev, driverName: v.driverName, routeNumber: v.routeNumber };
      }
      setScheduleDeviations(deviations);
    } catch (err) {
      console.error('Fleet refresh failed:', err);
      setFleetSyncStatus('error', err.message);
    }
  }, [fleetVehicles, updateVehicleLocations, setFleetSyncStatus, autoVisitEnabled, stores, warehouses, travelLog, schedules, bulkRecordVisits, logTravelEntries]);

  // Auto-fetch on first render when connected
  useEffect(() => {
    if (connected && vehicleLocations.length === 0) {
      handleRefreshNow();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Auto-refresh interval ----
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (autoRefresh && connected) {
      refreshTimer.current = setInterval(handleRefreshNow, refreshInterval * 1000);
    }
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [autoRefresh, connected, refreshInterval, handleRefreshNow]);

  // ---- Filter/search vehicles ----
  const displayVehicles = useMemo(() => {
    const source = vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles;
    if (!searchTerm) return source;
    const term = searchTerm.toLowerCase();
    return source.filter(v =>
      v.vehicleId.toLowerCase().includes(term) ||
      (v.routeNumber || '').toLowerCase().includes(term) ||
      v.licensePlate.toLowerCase().includes(term) ||
      v.vin.toLowerCase().includes(term) ||
      (v.yearMakeModel || '').toLowerCase().includes(term) ||
      (v.driverName || '').toLowerCase().includes(term)
    );
  }, [vehicleLocations, fleetVehicles, searchTerm]);

  const mappableVehicles = useMemo(() =>
    displayVehicles.filter(v => v.lat && v.lng),
    [displayVehicles]
  );

  const mapCenter = useMemo(() => {
    if (mappableVehicles.length === 0) return [39.0, -76.8];
    const avgLat = mappableVehicles.reduce((s, v) => s + v.lat, 0) / mappableVehicles.length;
    const avgLng = mappableVehicles.reduce((s, v) => s + v.lng, 0) / mappableVehicles.length;
    return [avgLat, avgLng];
  }, [mappableVehicles]);

  const stats = useMemo(() => {
    const total = displayVehicles.length;
    const online = displayVehicles.filter(v => v.engineStatus === 'on').length;
    const offline = displayVehicles.filter(v => v.engineStatus === 'off').length;
    const moving = displayVehicles.filter(v => v.speed && v.speed > 0).length;
    return { total, online, offline, moving };
  }, [displayVehicles]);

  return (
    <div className="ft-page">
      {/* Header */}
      <div className="ft-header">
        <div className="ft-title-row">
          <h2>Motive Fleet Tracker</h2>
          <div className="ft-connection">
            <span className={`ft-status-dot ${fleetSyncStatus}`} />
            <span className="ft-status-text">
              {fleetSyncStatus === 'connected' ? 'Connected' :
               fleetSyncStatus === 'loading' ? 'Loading...' :
               fleetSyncStatus === 'error' ? 'Error' : 'Not connected'}
            </span>
            <button className="ft-settings-btn" onClick={() => setShowApiSetup(!showApiSetup)}>
              {connected ? 'Settings' : 'Connect API'}
            </button>
          </div>
        </div>

        {/* API Key Setup panel */}
        {showApiSetup && (
          <div className="ft-api-setup">
            {connected ? (
              <div className="ft-api-connected">
                <span>Motive API: Connected</span>
                <button className="btn btn-sm btn-danger" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="ft-api-form">
                <label className="ft-label">Motive API Key</label>
                <input
                  type="password"
                  className="ft-input"
                  placeholder="Enter your Motive API key..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                />
                <details className="ft-advanced">
                  <summary>Advanced Settings</summary>
                  <label className="ft-label">API Base URL (uses dev proxy by default)</label>
                  <input
                    type="text"
                    className="ft-input"
                    placeholder="/api/motive/v1 (default — proxied through Vite)"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                  />
                  <label className="ft-label">CORS Proxy URL (for production)</label>
                  <input
                    type="text"
                    className="ft-input"
                    placeholder="https://corsproxy.io/?"
                    value={corsProxyInput}
                    onChange={(e) => setCorsProxyInput(e.target.value)}
                  />
                </details>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleSaveKey}
                  disabled={testing || !apiKeyInput.trim()}
                  style={{ marginTop: 8 }}
                >
                  {testing ? 'Testing...' : 'Connect'}
                </button>
                {testResult && testResult !== 'success' && (
                  <div className="ft-error">{testResult}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stats bar + controls (shown when API connected) */}
        {connected && (
          <div className="ft-controls">
            <div className="ft-stats">
              <span className="ft-stat">{stats.total} <span>Vehicles</span></span>
              <span className="ft-stat green">{stats.online} <span>Online</span></span>
              <span className="ft-stat red">{stats.offline} <span>Offline</span></span>
              <span className="ft-stat blue">{stats.moving} <span>Moving</span></span>
            </div>
            <div className="ft-actions">
              <button className="ft-btn" onClick={handleRefreshNow} disabled={fleetSyncStatus === 'loading'}>
                {fleetSyncStatus === 'loading' ? 'Refreshing...' : 'Refresh Now'}
              </button>
              <label className="ft-auto-toggle">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto ({refreshInterval}s)
              </label>
              <label className="ft-auto-toggle">
                <input
                  type="checkbox"
                  checked={showVehiclesOnMap}
                  onChange={(e) => setVehiclesOnMap(e.target.checked)}
                />
                Show on Main Map
              </label>
              <label className="ft-auto-toggle">
                <input
                  type="checkbox"
                  checked={autoVisitEnabled}
                  onChange={toggleAutoVisit}
                />
                Auto-Visit Log
              </label>
            </div>
          </div>
        )}

        {/* Schedule Deviation Alerts */}
        {connected && Object.values(scheduleDeviations).some(d => d.status === 'behind') && (
          <div className="ft-sched-alerts">
            <span className="ft-sched-alerts-title">Schedule Alerts</span>
            {Object.values(scheduleDeviations)
              .filter(d => d.status === 'behind')
              .sort((a, b) => (b.detail?.behind || 0) - (a.detail?.behind || 0))
              .map(d => (
                <div key={d.routeNumber} className="ft-sched-alert-item">
                  <span className="ft-sched-alert-route">Rt {d.routeNumber}</span>
                  <span className="ft-sched-alert-driver">{d.driverName || '--'}</span>
                  <span className="ft-sched-alert-msg">{d.message}</span>
                </div>
              ))}
          </div>
        )}

        {/* View toggle + Search */}
        <div className="ft-toolbar">
          <div className="ft-view-toggle">
            {['table', 'map', 'split'].map(m => (
              <button
                key={m}
                className={`ft-view-btn ${viewMode === m ? 'active' : ''}`}
                onClick={() => setViewMode(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <input
            className="ft-search"
            type="text"
            placeholder="Search vehicles, VIN, driver..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Content: map, table, or split */}
      <div className={`ft-content ft-${viewMode}`}>
        {/* Fleet Map */}
        {(viewMode === 'map' || viewMode === 'split') && (
          <div className="ft-map-container">
            {mappableVehicles.length > 0 ? (
              <MapContainer
                center={mapCenter}
                zoom={10}
                className="ft-map"
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mappableVehicles.map(v => (
                  <Marker
                    key={v.vin}
                    position={[v.lat, v.lng]}
                    icon={createTruckIcon(v.engineStatus, selectedVehicle === v.vin)}
                    eventHandlers={{ click: () => setSelectedVehicle(v.vin) }}
                  >
                    <Popup>
                      <div className="ft-popup">
                        <strong>{v.vehicleId}</strong><br />
                        {v.routeNumber && <><span>Route: {v.routeNumber}</span><br /></>}
                        <span>{v.licensePlate}</span><br />
                        {v.driverName && <><span>Driver: {v.driverName}</span><br /></>}
                        <span>Speed: {v.speed != null ? `${v.speed} mph` : 'N/A'}</span><br />
                        <span>Engine: {v.engineStatus || 'Unknown'}</span><br />
                        {v.description && <><span>{v.description}</span><br /></>}
                        {v.lastUpdated && (
                          <span className="ft-popup-time">
                            Updated: {new Date(v.lastUpdated).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            ) : (
              <div className="ft-map-empty">
                {connected
                  ? 'No GPS data available. Click "Refresh Now" to fetch vehicle locations.'
                  : 'Connect to Motive API to see vehicle locations on the map.'}
              </div>
            )}
          </div>
        )}

        {/* Fleet Table */}
        {(viewMode === 'table' || viewMode === 'split') && (
          <div className="ft-table-container">
            <table className="ft-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vehicle</th>
                  <th>Route</th>
                  <th>Year / Make / Model</th>
                  <th>License Plate</th>
                  <th>VIN</th>
                  <th>Source / Gateway</th>
                  <th>Policy #</th>
                  <th>Insurance Pg</th>
                  <th>Ins. Exp.</th>
                  <th>Reg. Exp.</th>
                  {connected && <th>Driver</th>}
                  {connected && <th>Location</th>}
                  {connected && <th>Speed</th>}
                  {connected && <th>Engine</th>}
                  {connected && <th>Updated</th>}
                  {connected && <th>Schedule</th>}
                </tr>
              </thead>
              <tbody>
                {displayVehicles.map(v => (
                  <tr
                    key={v.vin}
                    className={`${selectedVehicle === v.vin ? 'selected' : ''} ${v.matched ? 'matched' : ''}`}
                    onClick={() => setSelectedVehicle(v.vin === selectedVehicle ? null : v.vin)}
                  >
                    <td>{v.index}</td>
                    <td className="ft-cell-vehicle">{v.vehicleId}</td>
                    <td className="ft-cell-route">{v.routeNumber || '—'}</td>
                    <td className="ft-cell-ymm">{v.yearMakeModel || '—'}</td>
                    <td className="ft-cell-plate">{v.licensePlate}</td>
                    <td className="ft-cell-vin">{v.vin}</td>
                    <td className="ft-cell-source">{v.source}</td>
                    <td className="ft-cell-policy">{v.policyNumber || '—'}</td>
                    <td className="ft-cell-inspage">{v.insuranceCardPage || '—'}</td>
                    <td className="ft-cell-expiry">{v.expirationDate || '—'}</td>
                    <td className="ft-cell-regexpiry">
                      {v.registration?.registrationExpires
                        ? <span title={v.registration.temporaryRegistration ? `Temp reg — Conf: ${v.registration.temporaryRegistration.confirmationNumber}` : ''}>
                            {v.registration.registrationExpires}
                            {v.registration.temporaryRegistration && <span className="ft-temp-reg-badge"> TEMP</span>}
                          </span>
                        : '—'}
                    </td>
                    {connected && <td>{v.driverName || '—'}</td>}
                    {connected && (
                      <td className="ft-cell-location">
                        {v.lat && v.lng
                          ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`
                          : '—'}
                        {v.description && <div className="ft-cell-desc">{v.description}</div>}
                      </td>
                    )}
                    {connected && (
                      <td className="ft-cell-speed">
                        {v.speed != null ? `${v.speed} mph` : '—'}
                      </td>
                    )}
                    {connected && (
                      <td>
                        <span className={`ft-engine-badge ${v.engineStatus || 'unknown'}`}>
                          {v.engineStatus || '—'}
                        </span>
                      </td>
                    )}
                    {connected && (
                      <td className="ft-cell-updated">
                        {v.lastUpdated
                          ? new Date(v.lastUpdated).toLocaleTimeString()
                          : '—'}
                      </td>
                    )}
                    {connected && (
                      <td className="ft-cell-sched">
                        {(() => {
                          const dev = scheduleDeviations[v.routeNumber];
                          if (!dev) return '—';
                          const dotColor = dev.status === 'on-track' ? '#22c55e'
                            : dev.status === 'behind' ? '#ef4444' : '#9ca3af';
                          return (
                            <span className="ft-sched-badge" style={{ color: dotColor }}>
                              <span className="ft-sched-dot" style={{ background: dotColor }} />
                              {dev.message}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      {lastRefreshTime && (
        <div className="ft-footer">
          Last refreshed: {lastRefreshTime.toLocaleTimeString()}
          {fleetSyncError && <span className="ft-footer-error"> | Error: {fleetSyncError}</span>}
        </div>
      )}
    </div>
  );
}

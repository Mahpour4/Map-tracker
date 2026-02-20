import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import StorePanel from './StorePanel';
import ZonePanel from './ZonePanel';
import AlertPanel from './AlertPanel';
import { getToken, setToken, clearToken, testConnection } from '../services/githubService';

function GithubSync() {
  const { state, syncFromGithub, saveToGithub } = useApp();
  const { syncStatus, syncError } = state;
  const [showSettings, setShowSettings] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const hasToken = !!getToken();

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    setToken(tokenInput);
    setTesting(true);
    setTestResult(null);
    const result = await testConnection();
    setTesting(false);
    if (result.ok) {
      setTestResult('success');
      setTokenInput('');
      setShowSettings(false);
      syncFromGithub();
    } else {
      setTestResult(result.error);
      clearToken();
    }
  }

  function handleDisconnect() {
    clearToken();
    setTestResult(null);
    setShowSettings(false);
  }

  const statusIcon = {
    idle: hasToken ? '●' : '○',
    loading: '↻',
    saving: '↑',
    saved: '✓',
    error: '!',
  };

  const statusColor = {
    idle: hasToken ? '#94a3b8' : '#d1d5db',
    loading: '#3b82f6',
    saving: '#f59e0b',
    saved: '#22c55e',
    error: '#ef4444',
  };

  const statusText = {
    idle: hasToken ? 'Connected' : 'Not connected',
    loading: 'Loading...',
    saving: 'Saving...',
    saved: 'Saved',
    error: 'Error',
  };

  return (
    <div className="github-sync">
      <div className="sync-bar">
        <div
          className="sync-status"
          style={{ color: statusColor[syncStatus] }}
          title={syncError || statusText[syncStatus]}
        >
          <span className={`sync-icon ${syncStatus === 'loading' || syncStatus === 'saving' ? 'spin' : ''}`}>
            {statusIcon[syncStatus]}
          </span>
          <span className="sync-label">{statusText[syncStatus]}</span>
        </div>
        <div className="sync-actions">
          {hasToken && (
            <>
              <button
                className="sync-btn"
                onClick={syncFromGithub}
                disabled={syncStatus === 'loading' || syncStatus === 'saving'}
                title="Pull from GitHub"
              >
                ↓
              </button>
              <button
                className="sync-btn"
                onClick={saveToGithub}
                disabled={syncStatus === 'loading' || syncStatus === 'saving'}
                title="Push to GitHub"
              >
                ↑
              </button>
            </>
          )}
          <button
            className="sync-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="GitHub settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {syncError && (
        <div className="sync-error">{syncError}</div>
      )}

      {showSettings && (
        <div className="github-settings">
          {hasToken ? (
            <div className="settings-connected">
              <span className="settings-label">GitHub: Connected</span>
              <button className="btn btn-xs btn-danger" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <label className="settings-label">GitHub Personal Access Token</label>
              <input
                type="password"
                placeholder="ghp_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
              />
              <button
                className="btn btn-xs btn-primary"
                onClick={handleSaveToken}
                disabled={testing || !tokenInput.trim()}
                style={{ marginTop: 4 }}
              >
                {testing ? 'Testing...' : 'Connect'}
              </button>
              {testResult && testResult !== 'success' && (
                <div className="sync-error">{testResult}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { state, setSidebarTab } = useApp();
  const { sidebarTab } = state;

  // Count unresolved alerts (considering visitHistory for accurate dates)
  const unresolvedCount = useMemo(() => {
    const vh = state.visitHistory || {};
    return state.alerts.filter(a => {
      const store = state.stores.find(s => s.id === a.storeId);
      if (!store || !a.dateReceived) return true;
      // Check visitHistory for the most up-to-date visit date
      const vhDates = (vh[a.storeId] || []).filter(Boolean).map(d => d.split('T')[0]);
      const newestVH = vhDates.length > 0 ? vhDates.sort().pop() : null;
      const storeLastVisited = store.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : null;
      const bestVisited = [storeLastVisited, newestVH].filter(Boolean).sort().pop() || null;
      const lv = ([store.lastSaleDate, bestVisited].filter(Boolean).sort().pop() || '').split('T')[0].split(' ')[0];
      return !lv || lv < a.dateReceived;
    }).length;
  }, [state.alerts, state.stores, state.visitHistory]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Map Tracker</h2>
        <GithubSync />
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
        <button
          className={`tab-btn ${sidebarTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setSidebarTab('alerts')}
        >
          Alerts
          {unresolvedCount > 0 && (
            <span className="alert-badge-count">{unresolvedCount}</span>
          )}
        </button>
      </div>
      <div className="sidebar-content">
        {sidebarTab === 'stores' && <StorePanel />}
        {sidebarTab === 'zones' && <ZonePanel />}
        {sidebarTab === 'alerts' && <AlertPanel />}
      </div>
    </aside>
  );
}

import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  getGoogleClientId,
  setGoogleClientId,
  isGmailConnected,
  signInWithGoogle,
  signOutGoogle,
} from '../services/gmailAlertService';

function getDaysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function getAlertStatus(alert, store) {
  if (!store || !alert.dateReceived) return { status: 'unknown', color: '#9ca3af' };
  const lastVisited = store.lastVisited;
  if (!lastVisited) return { status: 'unresolved', color: '#ef4444', days: null };

  const visitDate = lastVisited.split('T')[0].split(' ')[0];
  if (visitDate >= alert.dateReceived) {
    const responseDays = getDaysBetween(alert.dateReceived, visitDate);
    return { status: 'resolved', color: '#22c55e', days: responseDays };
  }
  const now = new Date().toISOString().split('T')[0];
  const waitDays = getDaysBetween(alert.dateReceived, now);
  return { status: 'unresolved', color: waitDays > 7 ? '#ef4444' : '#f97316', days: waitDays };
}

export default function AlertPanel() {
  const { state, fetchGmailAlerts } = useApp();
  const { alerts, stores, alertSyncStatus } = state;

  const [showSetup, setShowSetup] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [filterRoute, setFilterRoute] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const connected = isGmailConnected();
  const hasClientId = !!getGoogleClientId();

  // Build store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Enrich alerts with store data and status
  const enrichedAlerts = useMemo(() => {
    return alerts.map(a => {
      const store = storeMap[a.storeId];
      const statusInfo = getAlertStatus(a, store);
      return { ...a, store, ...statusInfo };
    }).sort((a, b) => {
      // Unresolved first, then by date (newest first)
      if (a.status !== b.status) {
        if (a.status === 'unresolved') return -1;
        if (b.status === 'unresolved') return 1;
      }
      return (b.dateReceived || '').localeCompare(a.dateReceived || '');
    });
  }, [alerts, storeMap]);

  // Get unique routes from alerts
  const alertRoutes = useMemo(() => {
    const set = new Set(alerts.map(a => a.routeNumber).filter(Boolean));
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [alerts]);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    let result = enrichedAlerts;
    if (filterRoute !== 'all') {
      result = result.filter(a => a.routeNumber === filterRoute);
    }
    if (filterStatus !== 'all') {
      result = result.filter(a => a.status === filterStatus);
    }
    return result;
  }, [enrichedAlerts, filterRoute, filterStatus]);

  // Summary stats
  const stats = useMemo(() => {
    const total = enrichedAlerts.length;
    const resolved = enrichedAlerts.filter(a => a.status === 'resolved').length;
    const unresolved = enrichedAlerts.filter(a => a.status === 'unresolved').length;
    const resolvedAlerts = enrichedAlerts.filter(a => a.status === 'resolved' && a.days !== null);
    const avgResponse = resolvedAlerts.length > 0
      ? Math.round(resolvedAlerts.reduce((sum, a) => sum + a.days, 0) / resolvedAlerts.length)
      : null;
    return { total, resolved, unresolved, avgResponse };
  }, [enrichedAlerts]);

  async function handleSignIn() {
    try {
      await signInWithGoogle();
      setShowSetup(false);
    } catch (err) {
      setFetchResult({ error: err.message });
    }
  }

  async function handleFetchAlerts() {
    setFetching(true);
    setFetchResult(null);
    try {
      const count = await fetchGmailAlerts();
      setFetchResult({ success: `Fetched ${count} new alert${count !== 1 ? 's' : ''}` });
    } catch (err) {
      setFetchResult({ error: err.message });
    }
    setFetching(false);
  }

  function handleSaveClientId() {
    if (!clientIdInput.trim()) return;
    setGoogleClientId(clientIdInput);
    setClientIdInput('');
  }

  return (
    <div className="alert-panel">
      <div className="panel-header">
        <h3>Service Alerts</h3>
        <span className="count-badge">{stats.total} total</span>
      </div>

      {/* Gmail Connection */}
      <div className="alert-gmail-bar">
        <div className="alert-gmail-status">
          <span className={`alert-gmail-dot ${connected ? 'connected' : ''}`}></span>
          <span>{connected ? 'Gmail Connected' : 'Gmail Not Connected'}</span>
        </div>
        <div className="alert-gmail-actions">
          {connected && (
            <button
              className="btn btn-xs btn-primary"
              onClick={handleFetchAlerts}
              disabled={fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Alerts'}
            </button>
          )}
          <button
            className="btn btn-xs"
            onClick={() => setShowSetup(!showSetup)}
          >
            {showSetup ? 'Close' : 'Setup'}
          </button>
        </div>
      </div>

      {fetchResult && (
        <div className={`alert-fetch-result ${fetchResult.error ? 'error' : 'success'}`}>
          {fetchResult.error || fetchResult.success}
        </div>
      )}

      {showSetup && (
        <div className="alert-setup">
          {!hasClientId ? (
            <>
              <label className="settings-label">Google OAuth Client ID</label>
              <input
                type="text"
                placeholder="xxxx.apps.googleusercontent.com"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveClientId()}
              />
              <button
                className="btn btn-xs btn-primary"
                onClick={handleSaveClientId}
                disabled={!clientIdInput.trim()}
                style={{ marginTop: 4 }}
              >
                Save Client ID
              </button>
            </>
          ) : !connected ? (
            <div className="alert-setup-actions">
              <button className="btn btn-sm btn-primary" onClick={handleSignIn}>
                Sign in with Google
              </button>
              <button className="btn btn-xs btn-danger" onClick={() => {
                localStorage.removeItem('google_client_id');
                setShowSetup(true);
              }}>
                Reset Client ID
              </button>
            </div>
          ) : (
            <div className="alert-setup-actions">
              <span className="settings-label">Gmail: Connected</span>
              <button className="btn btn-xs btn-danger" onClick={() => {
                signOutGoogle();
                setShowSetup(false);
              }}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats Summary */}
      {stats.total > 0 && (
        <div className="alert-stats">
          <div className="alert-stat-item">
            <span className="alert-stat-value" style={{ color: '#ef4444' }}>{stats.unresolved}</span>
            <span className="alert-stat-label">Open</span>
          </div>
          <div className="alert-stat-item">
            <span className="alert-stat-value" style={{ color: '#22c55e' }}>{stats.resolved}</span>
            <span className="alert-stat-label">Resolved</span>
          </div>
          <div className="alert-stat-item">
            <span className="alert-stat-value">{stats.avgResponse !== null ? `${stats.avgResponse}d` : '—'}</span>
            <span className="alert-stat-label">Avg Response</span>
          </div>
          <div className="alert-stat-item">
            <span className="alert-stat-value">{stats.total}</span>
            <span className="alert-stat-label">Total</span>
          </div>
        </div>
      )}

      {/* Filters */}
      {stats.total > 0 && (
        <div className="alert-filters">
          <select value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)}>
            <option value="all">All routes</option>
            {alertRoutes.map(r => (
              <option key={r} value={r}>Route {r}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      )}

      {/* Alert List */}
      <div className="alert-list">
        {filteredAlerts.length === 0 ? (
          <p className="empty-text">
            {stats.total === 0 ? 'No alerts yet — connect Gmail to fetch alerts' : 'No alerts match your filters'}
          </p>
        ) : (
          filteredAlerts.map((a) => (
            <div key={a.refNumber} className={`alert-card ${a.status}`}>
              <div className="alert-card-header">
                <span className={`alert-status-dot ${a.status}`}></span>
                <span className="alert-store-name">{a.storeName} #{a.storeNumber}</span>
                <span className="alert-ref">#{a.refNumber}</span>
              </div>
              <div className="alert-card-body">
                <span className="alert-city">{a.city}</span>
                {a.routeNumber && <span className="alert-route">Rt {a.routeNumber}</span>}
                <span className="alert-vendor">{a.vendor}</span>
              </div>
              <div className="alert-card-footer">
                <span className="alert-date">{a.dateReceived || 'Unknown date'}</span>
                <span className="alert-response" style={{ color: a.color }}>
                  {a.status === 'resolved'
                    ? `Resolved in ${a.days}d`
                    : a.status === 'unresolved'
                    ? a.days !== null ? `${a.days}d waiting` : 'Waiting'
                    : 'No store match'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

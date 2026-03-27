import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  const lastVisited = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
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
  const { state, fetchGmailAlerts, autoAcceptAlerts, selectStore, setMapView, setPage, setFilterRoute } = useApp();
  const { alerts, stores, visitHistory } = state;

  const [showSetup, setShowSetup] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [autoCheck, setAutoCheck] = useState(() => localStorage.getItem('gw_auto_check') === 'true');
  const [autoCheckStatus, setAutoCheckStatus] = useState(''); // '' | 'checking' | 'Next check in Xm'
  const autoCheckRef = useRef(null);
  const nextCheckRef = useRef(null);

  const connected = isGmailConnected();
  const hasClientId = !!getGoogleClientId();

  // Build store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Enrich alerts and get top unresolved for preview
  const { stats, topUnresolved } = useMemo(() => {
    const enriched = alerts.map(a => {
      const store = storeMap[a.storeId];
      // Include visitHistory for most up-to-date last visit date
      const storeId = a.storeId || store?.id;
      const vhDates = (visitHistory && storeId ? (visitHistory[storeId] || []) : [])
        .map(e => (typeof e === 'string' ? e : e.date))
        .filter(Boolean).map(d => d.split('T')[0]);
      const newestVH = vhDates.length > 0 ? vhDates.sort().pop() : null;
      const storeLastVisited = store?.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : null;
      const bestLastVisited = [storeLastVisited, newestVH].filter(Boolean).sort().pop() || null;
      const enrichedStore = store ? { ...store, lastVisited: bestLastVisited || store.lastVisited } : store;
      const statusInfo = getAlertStatus(a, enrichedStore);
      return { ...a, store, ...statusInfo };
    });

    const total = enriched.length;
    const unresolved = enriched.filter(a => a.status === 'unresolved');
    const resolved = enriched.filter(a => a.status === 'resolved');

    // Top 5 unresolved, sorted newest first
    const top = unresolved
      .sort((a, b) => (b.dateReceived || '').localeCompare(a.dateReceived || ''))
      .slice(0, 5);

    return {
      stats: { total, unresolved: unresolved.length, resolved: resolved.length },
      topUnresolved: top,
    };
  }, [alerts, storeMap, visitHistory]);

  function handleGoToStore(alert) {
    if (!alert.store) return;
    const s = alert.store;
    selectStore(s.id);
    setMapView([s.lat, s.lng], 15);
    if (s.routeNumber) setFilterRoute(s.routeNumber);
    setPage('map');
  }

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
    setDebugData(null);
    try {
      // Pass no date = default 7-day lookback (same as AlertLog page)
      const { newCount, rawMessages } = await fetchGmailAlerts();
      setFetchResult({ success: `Fetched ${newCount} alert${newCount !== 1 ? 's' : ''}` });
      setDebugData(rawMessages);
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

  // Auto-Check: periodic fetch + auto-accept cycle
  const AUTO_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

  const runAutoCheck = useCallback(async () => {
    if (!isGmailConnected()) return;
    setAutoCheckStatus('checking');
    try {
      await fetchGmailAlerts();
      try { await autoAcceptAlerts(); } catch (_) {}
    } catch (_) {}
    setAutoCheckStatus('');
  }, [fetchGmailAlerts, autoAcceptAlerts]);

  function toggleAutoCheck() {
    const next = !autoCheck;
    setAutoCheck(next);
    localStorage.setItem('gw_auto_check', String(next));
    if (next && connected) {
      // Run immediately, then set interval
      runAutoCheck();
    }
  }

  useEffect(() => {
    if (autoCheckRef.current) clearInterval(autoCheckRef.current);
    if (nextCheckRef.current) clearInterval(nextCheckRef.current);

    if (autoCheck && connected) {
      let lastRun = Date.now();
      autoCheckRef.current = setInterval(() => {
        lastRun = Date.now();
        runAutoCheck();
      }, AUTO_CHECK_INTERVAL);

      // Update countdown display every 30s
      nextCheckRef.current = setInterval(() => {
        const elapsed = Date.now() - lastRun;
        const remaining = Math.max(0, Math.ceil((AUTO_CHECK_INTERVAL - elapsed) / 60000));
        setAutoCheckStatus(prev => prev === 'checking' ? prev : `Next in ${remaining}m`);
      }, 30000);

      // Initial countdown
      setAutoCheckStatus(`Next in 15m`);
    } else {
      setAutoCheckStatus('');
    }

    return () => {
      if (autoCheckRef.current) clearInterval(autoCheckRef.current);
      if (nextCheckRef.current) clearInterval(nextCheckRef.current);
    };
  }, [autoCheck, connected, runAutoCheck]);

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
              {fetching ? 'Fetching...' : 'Fetch'}
            </button>
          )}
          {connected && (
            <button
              className={`btn btn-xs ${autoCheck ? 'btn-active' : ''}`}
              onClick={toggleAutoCheck}
              title={autoCheck ? `Auto-Check ON — ${autoCheckStatus || 'fetches & accepts every 15 min'}` : 'Enable auto-check: fetch alerts & auto-accept every 15 min'}
            >
              {autoCheck ? (autoCheckStatus === 'checking' ? 'Checking...' : `Auto ✓`) : 'Auto'}
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

      {/* Quick Stats */}
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
            <span className="alert-stat-value">{stats.total}</span>
            <span className="alert-stat-label">Total</span>
          </div>
        </div>
      )}

      {/* Top unresolved alerts preview */}
      {topUnresolved.length > 0 && (
        <div className="alert-preview-list">
          {topUnresolved.map(a => (
            <div
              key={a.refNumber}
              className={`alert-preview-item ${a.store ? 'clickable' : ''}`}
              onClick={a.store ? () => handleGoToStore(a) : undefined}
            >
              <span className="alert-status-dot unresolved"></span>
              <span className="alert-preview-name">{a.storeName} #{a.storeNumber}</span>
              <span className="alert-preview-days" style={{ color: a.color }}>
                {a.days !== null ? `${a.days}d` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Open full Alert Log page */}
      <button
        className="alert-open-log-btn"
        onClick={() => setPage('alerts')}
      >
        Open Alert Log
        {stats.unresolved > 0 && ` (${stats.unresolved} open)`}
      </button>

      {/* Debug: raw email data */}
      {debugData && (
        <div className="alert-debug-section">
          <button
            className="alert-debug-toggle"
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? 'Hide' : 'Show'} Raw Data ({debugData.filter(m => m.parsed).length}/{debugData.length} parsed)
          </button>

          {showDebug && (
            <div className="alert-debug-list">
              {debugData.map((msg, i) => (
                <div key={msg.id || i} className={`alert-debug-row ${msg.parsed ? 'parsed' : 'failed'}`}>
                  <div className="alert-debug-status">
                    <span className={`alert-debug-badge ${msg.parsed ? 'ok' : 'fail'}`}>
                      {msg.parsed ? 'OK' : 'FAIL'}
                    </span>
                    <span className="alert-debug-index">#{i + 1}</span>
                    {msg.date && <span className="alert-debug-date">{msg.date}</span>}
                  </div>
                  <div className="alert-debug-subject">{msg.error || msg.subject}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

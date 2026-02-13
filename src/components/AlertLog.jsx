import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AlertLog() {
  const { state, selectStore, setMapView, setPage, setFilterRoute, loadAlertImage, fetchGmailAlerts } = useApp();
  const { alerts, stores, alertImages } = state;

  const today = new Date().toISOString().split('T')[0];
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRoute, setLocalFilterRoute] = useState('all');
  const [filterVendor, setLocalFilterVendor] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState(null); // null = auto (expand unresolved)
  const [expandedImage, setExpandedImage] = useState(null); // emailId of alert with open image
  const [alertDate, setAlertDate] = useState(today);
  const [fetching, setFetching] = useState(false);

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
      if (a.status !== b.status) {
        if (a.status === 'unresolved') return -1;
        if (b.status === 'unresolved') return 1;
      }
      return (b.dateReceived || '').localeCompare(a.dateReceived || '');
    });
  }, [alerts, storeMap]);

  // Unique routes and vendors for filter dropdowns
  const alertRoutes = useMemo(() => {
    const set = new Set(alerts.map(a => a.routeNumber).filter(Boolean));
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [alerts]);

  const alertVendors = useMemo(() => {
    const set = new Set(alerts.map(a => a.vendor).filter(Boolean));
    return Array.from(set).sort();
  }, [alerts]);

  // Apply filters
  const filteredAlerts = useMemo(() => {
    let result = enrichedAlerts;
    if (filterStatus !== 'all') {
      result = result.filter(a => a.status === filterStatus);
    }
    if (filterRoute !== 'all') {
      result = result.filter(a => a.routeNumber === filterRoute);
    }
    if (filterVendor !== 'all') {
      result = result.filter(a => a.vendor === filterVendor);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(a =>
        a.storeName.toLowerCase().includes(term) ||
        a.storeNumber.includes(term) ||
        a.city.toLowerCase().includes(term) ||
        a.refNumber.toLowerCase().includes(term)
      );
    }
    return result;
  }, [enrichedAlerts, filterStatus, filterRoute, filterVendor, searchTerm]);

  // Group by route
  const alertsByRoute = useMemo(() => {
    const grouped = {};
    filteredAlerts.forEach(a => {
      const route = a.routeNumber || 'Unmatched';
      if (!grouped[route]) grouped[route] = [];
      grouped[route].push(a);
    });
    return Object.entries(grouped).sort((a, b) => {
      if (a[0] === 'Unmatched') return 1;
      if (b[0] === 'Unmatched') return -1;
      const na = parseInt(a[0]), nb = parseInt(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredAlerts]);

  // Summary stats (from all enriched, not filtered)
  const stats = useMemo(() => {
    const total = enrichedAlerts.length;
    const open = enrichedAlerts.filter(a => a.status === 'unresolved').length;
    const resolved = enrichedAlerts.filter(a => a.status === 'resolved').length;
    const unknown = enrichedAlerts.filter(a => a.status === 'unknown').length;
    const resolvedWithDays = enrichedAlerts.filter(a => a.status === 'resolved' && a.days !== null);
    const avgResponse = resolvedWithDays.length > 0
      ? Math.round(resolvedWithDays.reduce((sum, a) => sum + a.days, 0) / resolvedWithDays.length)
      : null;
    return { total, open, resolved, unknown, avgResponse };
  }, [enrichedAlerts]);

  // Determine which routes are expanded
  const isRouteExpanded = (route) => {
    if (expandedRoutes !== null) return expandedRoutes.has(route);
    // Auto mode: expand routes with unresolved alerts
    const routeAlerts = alertsByRoute.find(([r]) => r === route);
    if (!routeAlerts) return false;
    return routeAlerts[1].some(a => a.status === 'unresolved');
  };

  function toggleRoute(route) {
    setExpandedRoutes(prev => {
      const set = new Set(prev !== null ? prev : alertsByRoute.filter(([r, alerts]) => alerts.some(a => a.status === 'unresolved')).map(([r]) => r));
      if (set.has(route)) set.delete(route);
      else set.add(route);
      return set;
    });
  }

  function handleGoToStore(alert) {
    if (!alert.store) return;
    const s = alert.store;
    selectStore(s.id);
    setMapView([s.lat, s.lng], 15);
    if (s.routeNumber) setFilterRoute(s.routeNumber);
    setPage('map');
  }

  function handleSendToDriver(e, alert) {
    e.stopPropagation();
    const lines = [
      `Service Alert - Route ${alert.routeNumber || 'N/A'}`,
      `Store: ${alert.storeName} #${alert.storeNumber}`,
      `City: ${alert.city}`,
      `Vendor: ${alert.vendor}`,
      `Ref: ${alert.refNumber}`,
      `Date: ${formatDate(alert.dateReceived)}`,
    ];
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  function handleToggleImage(e, alert) {
    e.stopPropagation();
    const eid = alert.emailId;
    if (!eid) return;
    if (expandedImage === eid) {
      setExpandedImage(null);
      return;
    }
    setExpandedImage(eid);
    // Fetch if not already cached
    if (!alertImages[eid]) {
      loadAlertImage(eid);
    }
  }

  function handleDownloadImage(e, imgData) {
    e.stopPropagation();
    if (imgData.isExternal) {
      // External URL — open in new tab for manual save
      window.open(imgData.dataUri, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = imgData.dataUri;
      a.download = imgData.filename || 'alert-image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  async function handleFetchByDate() {
    setFetching(true);
    try {
      await fetchGmailAlerts(alertDate);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
    setFetching(false);
  }

  return (
    <div className="al-page">
      {/* Header */}
      <div className="al-header">
        <div className="al-title-row">
          <h2>Alert Log</h2>
          <div className="al-date-picker">
            <input
              type="date"
              className="al-date-input"
              value={alertDate}
              max={today}
              onChange={(e) => setAlertDate(e.target.value)}
            />
            <button
              className="al-btn-fetch"
              onClick={handleFetchByDate}
              disabled={fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Alerts'}
            </button>
          </div>
          <div className="al-stats">
            <span className="al-stat red">{stats.open} <span>Open</span></span>
            <span className="al-stat green">{stats.resolved} <span>Resolved</span></span>
            {stats.unknown > 0 && <span className="al-stat gray">{stats.unknown} <span>No Match</span></span>}
            <span className="al-stat gray">{stats.total} <span>Total</span></span>
            {stats.avgResponse !== null && <span className="al-stat gray">{stats.avgResponse}d <span>Avg Response</span></span>}
          </div>
        </div>

        {/* Filters */}
        <div className="al-filters">
          <div className="al-filter-group">
            <button className={`al-filter-btn ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>
              All ({stats.total})
            </button>
            <button className={`al-filter-btn red ${filterStatus === 'unresolved' ? 'active' : ''}`} onClick={() => setFilterStatus('unresolved')}>
              Open ({stats.open})
            </button>
            <button className={`al-filter-btn green ${filterStatus === 'resolved' ? 'active' : ''}`} onClick={() => setFilterStatus('resolved')}>
              Resolved ({stats.resolved})
            </button>
          </div>
          <div className="al-filter-group">
            <select className="al-select" value={filterRoute} onChange={e => setLocalFilterRoute(e.target.value)}>
              <option value="all">All Routes</option>
              {alertRoutes.map(r => <option key={r} value={r}>Route {r}</option>)}
            </select>
            <select className="al-select" value={filterVendor} onChange={e => setLocalFilterVendor(e.target.value)}>
              <option value="all">All Vendors</option>
              {alertVendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <input
              className="al-search"
              type="text"
              placeholder="Search store, city, ref..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Route-grouped content */}
      {filteredAlerts.length === 0 ? (
        <div className="al-empty">
          {alerts.length === 0
            ? 'No alerts yet — fetch alerts from Gmail in the sidebar'
            : 'No alerts match your filters'}
        </div>
      ) : (
        <div className="al-content">
          {alertsByRoute.map(([route, routeAlerts]) => {
            const open = routeAlerts.filter(a => a.status === 'unresolved').length;
            const resolved = routeAlerts.filter(a => a.status === 'resolved').length;
            const expanded = isRouteExpanded(route);

            return (
              <div key={route} className="al-route-section">
                <div className="al-route-header" onClick={() => toggleRoute(route)}>
                  <div className="al-route-left">
                    <span className={`al-chevron ${expanded ? 'expanded' : ''}`}>&#9654;</span>
                    <span className="al-route-name">
                      {route === 'Unmatched' ? 'Unmatched Stores' : `Route ${route}`}
                    </span>
                  </div>
                  <div className="al-route-right">
                    <div className="al-route-bar">
                      {open > 0 && <div style={{ flex: open, background: '#ef4444' }}></div>}
                      {resolved > 0 && <div style={{ flex: resolved, background: '#22c55e' }}></div>}
                    </div>
                    <span className="al-route-counts">
                      {routeAlerts.length} alert{routeAlerts.length !== 1 ? 's' : ''}
                      {open > 0 && <span className="al-count-open">{open} open</span>}
                      {resolved > 0 && <span className="al-count-resolved">{resolved} resolved</span>}
                    </span>
                  </div>
                </div>

                {expanded && (
                  <table className="al-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}></th>
                        <th>Store</th>
                        <th>City</th>
                        <th>Vendor</th>
                        <th>Ref #</th>
                        <th>Date</th>
                        <th>Response</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routeAlerts.map(a => {
                        const hasStore = !!a.store;
                        const imgData = alertImages[a.emailId];
                        const isImgOpen = expandedImage === a.emailId;
                        return (
                          <React.Fragment key={a.refNumber}>
                            <tr
                              className={`${a.status} ${hasStore ? 'clickable' : ''}`}
                              onClick={hasStore ? () => handleGoToStore(a) : undefined}
                            >
                              <td>
                                <span className="al-status-dot" style={{ background: a.color }}></span>
                              </td>
                              <td className="al-cell-store">{a.storeName} #{a.storeNumber}</td>
                              <td>{a.city}</td>
                              <td>{a.vendor}</td>
                              <td className="al-cell-ref">{a.refNumber}</td>
                              <td>{formatDate(a.dateReceived)}</td>
                              <td style={{ color: a.color, fontWeight: 600 }}>
                                {a.status === 'resolved'
                                  ? `Resolved ${a.days}d`
                                  : a.status === 'unresolved'
                                  ? a.days !== null ? `${a.days}d waiting` : 'Waiting'
                                  : 'No match'}
                              </td>
                              <td>
                                <div className="al-action-btns">
                                  <button
                                    className="al-btn-send"
                                    onClick={(e) => handleSendToDriver(e, a)}
                                    title="Send to driver via WhatsApp"
                                  >
                                    Send
                                  </button>
                                  {a.emailId && (
                                    <button
                                      className={`al-btn-image ${isImgOpen ? 'active' : ''}`}
                                      onClick={(e) => handleToggleImage(e, a)}
                                      title="View alert image"
                                    >
                                      {imgData?.loading ? '...' : 'Image'}
                                    </button>
                                  )}
                                  {hasStore && (
                                    <span className="al-map-link" onClick={(e) => { e.stopPropagation(); handleGoToStore(a); }}>
                                      Map
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isImgOpen && (
                              <tr className="al-image-row">
                                <td colSpan={8}>
                                  <div className="al-image-container">
                                    {imgData?.loading && <span className="al-image-loading">Loading image...</span>}
                                    {imgData?.error && <span className="al-image-error">{imgData.error}</span>}
                                    {imgData?.dataUri && (
                                      <>
                                        <img className="al-image-preview" src={imgData.dataUri} alt="Alert" />
                                        <button
                                          className="al-btn-download"
                                          onClick={(e) => handleDownloadImage(e, imgData)}
                                        >
                                          Download Image
                                        </button>
                                      </>
                                    )}
                                    <button
                                      className="al-btn-close-image"
                                      onClick={(e) => { e.stopPropagation(); setExpandedImage(null); }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

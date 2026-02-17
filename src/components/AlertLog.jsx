import React, { useState, useMemo, useCallback, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext';
import { fetchAlertImage, isGmailConnected } from '../services/gmailAlertService';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  const now = localDateStr();
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
  const { state, selectStore, setMapView, setPage, setFilterRoute, loadAlertImage, fetchGmailAlerts, syncFromGithub } = useApp();
  const { alerts, stores, alertImages, syncStatus } = state;

  const today = localDateStr();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDateStr(d); })();
  const dayBefore = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return localDateStr(d); })();
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRoute, setLocalFilterRoute] = useState('all');
  const [filterVendor, setLocalFilterVendor] = useState('all');
  const [filterDate, setFilterDate] = useState(null); // null = show all dates
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState(null); // null = auto (expand unresolved)
  const [expandedImage, setExpandedImage] = useState(null); // emailId of alert with open image
  const [alertDate, setAlertDate] = useState(today);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(null); // route string or null

  // --- PDF sent tracking (persisted in localStorage) ---
  const PDF_SENT_KEY = 'pdf_sent_log';
  const [pdfSentLog, setPdfSentLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PDF_SENT_KEY)) || {}; }
    catch { return {}; }
  });

  function getRouteRefKey(routeAlerts) {
    // Create a stable key from sorted RefNumbers so we can track exactly which alerts were sent
    return routeAlerts.map(a => a.refNumber).filter(Boolean).sort().join(',');
  }

  function markRouteSent(routeAlerts) {
    const refKey = getRouteRefKey(routeAlerts);
    if (!refKey) return;
    const updated = {
      ...pdfSentLog,
      [refKey]: {
        date: new Date().toISOString(),
        refs: routeAlerts.map(a => a.refNumber).filter(Boolean),
        count: routeAlerts.length,
      },
    };
    setPdfSentLog(updated);
    localStorage.setItem(PDF_SENT_KEY, JSON.stringify(updated));
  }

  function getRouteSentInfo(routeAlerts) {
    const refKey = getRouteRefKey(routeAlerts);
    return refKey ? pdfSentLog[refKey] : null;
  }

  // Build store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Enrich alerts with store data, status, and days since service
  const enrichedAlerts = useMemo(() => {
    const now = localDateStr();
    return alerts.map(a => {
      const store = storeMap[a.storeId];
      const statusInfo = getAlertStatus(a, store);
      let daysSinceService = null;
      if (store?.lastVisited) {
        const visited = store.lastVisited.split('T')[0].split(' ')[0];
        daysSinceService = getDaysBetween(visited, now);
      }
      return { ...a, store, ...statusInfo, daysSinceService };
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
    if (filterDate) {
      result = result.filter(a => a.dateReceived === filterDate);
    }
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
  }, [enrichedAlerts, filterDate, filterStatus, filterRoute, filterVendor, searchTerm]);

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

  async function handleFetchByDate(dateOverride) {
    const dateToFetch = dateOverride || alertDate;
    if (dateOverride) setAlertDate(dateOverride);
    setFetching(true);
    try {
      await fetchGmailAlerts(dateToFetch);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
    setFetching(false);
  }

  function handleRefresh() {
    setRefreshing(true);
    syncFromGithub();
  }

  // Stop refreshing spinner when sync finishes
  useEffect(() => {
    if (refreshing && (syncStatus === 'saved' || syncStatus === 'error' || syncStatus === 'idle')) {
      setRefreshing(false);
    }
  }, [syncStatus, refreshing]);

  async function generateRoutePDF(e, route, routeAlerts) {
    e.stopPropagation();
    setPdfGenerating(route);

    try {
      // --- 1. Gather images for all alerts ---
      const alertsWithEmail = routeAlerts.filter(a => a.emailId);
      const gmailOk = isGmailConnected();
      const imageResults = {};
      let fetchFails = 0;

      const fetchPromises = alertsWithEmail.map(async (a) => {
        // Check in-memory cache first (from previously expanded images)
        const cached = alertImages[a.emailId];
        if (cached && cached.dataUri && !cached.loading) {
          imageResults[a.emailId] = cached;
          return;
        }
        // Skip Gmail fetch if not connected
        if (!gmailOk) { fetchFails++; return; }
        try {
          const result = await fetchAlertImage(a.emailId);
          if (result && result.dataUri) {
            imageResults[a.emailId] = result;
          } else { fetchFails++; }
        } catch (err) {
          fetchFails++;
          console.warn(`Image fetch failed for ${a.emailId}:`, err);
        }
      });
      await Promise.allSettled(fetchPromises);

      // --- 2. Convert images to embeddable base64 & get dimensions ---
      const processedImages = {};

      async function fetchViaProxy(url) {
        // Try a CORS proxy to fetch external images the browser can't access directly
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error(`Proxy returned ${resp.status}`);
        const blob = await resp.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      async function processOneImage(emailId, imgData) {
        let base64Uri = imgData.dataUri;

        // External URLs (http/https) need conversion to base64 for PDF embedding
        if (imgData.isExternal) {
          // Strategy A: direct fetch as blob (works if server sends CORS headers)
          try {
            const resp = await fetch(imgData.dataUri);
            const blob = await resp.blob();
            base64Uri = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (_) {
            // Strategy B: CORS proxy
            try {
              base64Uri = await fetchViaProxy(imgData.dataUri);
            } catch (_2) {
              // Strategy C: canvas with crossOrigin (works if server allows it)
              try {
                base64Uri = await new Promise((resolve, reject) => {
                  const el = new Image();
                  el.crossOrigin = 'anonymous';
                  el.onload = () => {
                    try {
                      const c = document.createElement('canvas');
                      c.width = el.naturalWidth;
                      c.height = el.naturalHeight;
                      c.getContext('2d').drawImage(el, 0, 0);
                      resolve(c.toDataURL('image/jpeg', 0.9));
                    } catch (ce) { reject(ce); }
                  };
                  el.onerror = reject;
                  el.src = imgData.dataUri;
                });
              } catch (_3) {
                console.warn(`All image strategies failed for ${emailId}`);
                return; // skip this image
              }
            }
          }
        }

        // Load the (now base64) image to get its natural dimensions
        return new Promise((resolve) => {
          const el = new Image();
          el.onload = () => {
            processedImages[emailId] = { base64Uri, width: el.naturalWidth, height: el.naturalHeight };
            resolve();
          };
          el.onerror = () => {
            console.warn(`Dimension load failed for ${emailId}`);
            resolve();
          };
          el.src = base64Uri;
        });
      }

      await Promise.all(
        Object.entries(imageResults).map(([eid, data]) => processOneImage(eid, data))
      );

      // Warn user if images couldn't be included
      const imgCount = Object.keys(processedImages).length;
      if (alertsWithEmail.length > 0 && imgCount === 0) {
        if (!gmailOk) {
          window.alert('Gmail is not connected — images could not be fetched.\n\nPlease sign in to Gmail first, then try again.');
        } else {
          window.alert('No images could be loaded for this route.\n\nTry expanding an image in the alert list first, then generate the PDF.');
        }
      }

      // --- 3. Build the PDF ---
      const doc = new jsPDF('landscape', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      // Title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(route === 'Unmatched' ? 'Unmatched Stores — Service Alerts' : `Route ${route} — Service Alerts`, pageWidth / 2, 15, { align: 'center' });

      // Subtitle
      const open = routeAlerts.filter(a => a.status === 'unresolved').length;
      const resolved = routeAlerts.filter(a => a.status === 'resolved').length;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`${todayStr} | ${routeAlerts.length} alerts | ${open} open | ${resolved} resolved`, pageWidth / 2, 21, { align: 'center' });

      // Build table rows
      const tableData = routeAlerts.map((a, i) => {
        const lastService = a.daysSinceService !== null ? `${a.daysSinceService}d ago` : 'Never';
        const response = a.status === 'resolved'
          ? `Resolved ${a.days}d`
          : a.status === 'unresolved'
          ? a.days !== null ? `${a.days}d waiting` : 'Waiting'
          : 'No match';
        return [
          i + 1,
          `${a.storeName} #${a.storeNumber}`,
          a.city,
          lastService,
          a.refNumber,
          formatDate(a.dateReceived),
          a.status === 'resolved' ? 'Resolved' : a.status === 'unresolved' ? 'Open' : 'Unknown',
          response,
          '', // image placeholder — drawn via didDrawCell
        ];
      });

      autoTable(doc, {
        startY: 26,
        head: [['#', 'Store', 'City', 'Last Svc', 'Ref #', 'Date', 'Status', 'Response', 'Image']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, minCellHeight: 30 },
        columnStyles: {
          0: { cellWidth: 7, halign: 'center' },
          1: { cellWidth: 42 },
          2: { cellWidth: 25 },
          3: { cellWidth: 18, halign: 'center' },
          4: { cellWidth: 30 },
          5: { cellWidth: 20 },
          6: { cellWidth: 15, halign: 'center' },
          7: { cellWidth: 28 },
          8: { cellWidth: 55 },
        },
        margin: { left: 14, right: 14 },
        didParseCell: function (data) {
          if (data.section !== 'body') return;
          const a = routeAlerts[data.row.index];
          if (!a) return;
          // Status column
          if (data.column.index === 6) {
            data.cell.styles.fontStyle = 'bold';
            if (a.status === 'resolved') data.cell.styles.textColor = [34, 197, 94];
            else if (a.status === 'unresolved') data.cell.styles.textColor = [239, 68, 68];
            else data.cell.styles.textColor = [156, 163, 175];
          }
          // Last Service column
          if (data.column.index === 3) {
            if (a.daysSinceService === null) data.cell.styles.textColor = [156, 163, 175];
            else if (a.daysSinceService > 14) data.cell.styles.textColor = [239, 68, 68];
            else if (a.daysSinceService > 7) data.cell.styles.textColor = [249, 115, 22];
            else data.cell.styles.textColor = [34, 197, 94];
            data.cell.styles.fontStyle = 'bold';
          }
          // Response column
          if (data.column.index === 7) {
            if (a.status === 'resolved') data.cell.styles.textColor = [34, 197, 94];
            else if (a.status === 'unresolved') data.cell.styles.textColor = a.days > 7 ? [239, 68, 68] : [249, 115, 22];
            else data.cell.styles.textColor = [156, 163, 175];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        didDrawCell: function (data) {
          // Embed thumbnail in the Image column
          if (data.section !== 'body' || data.column.index !== 8) return;
          const a = routeAlerts[data.row.index];
          const img = a ? processedImages[a.emailId] : null;
          if (!img) return;

          const pad = 1.5;
          const cellX = data.cell.x + pad;
          const cellY = data.cell.y + pad;
          const maxW = data.cell.width - pad * 2;
          const maxH = data.cell.height - pad * 2;
          const aspect = img.width / img.height;
          let drawW, drawH;
          if (maxW / maxH > aspect) { drawH = maxH; drawW = drawH * aspect; }
          else { drawW = maxW; drawH = drawW / aspect; }
          const drawX = cellX + (maxW - drawW) / 2;
          const drawY = cellY + (maxH - drawH) / 2;

          try {
            const fmt = img.base64Uri.match(/^data:image\/png/) ? 'PNG' : 'JPEG';
            doc.addImage(img.base64Uri, fmt, drawX, drawY, drawW, drawH);
          } catch (_) {}
        },
      });



      // Footer on all pages
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Generated ${todayStr} — Map Tracker — Page ${i}/${pageCount}`,
          pageWidth / 2, pageHeight - 5, { align: 'center' }
        );
      }

      const dateSlug = localDateStr();
      doc.save(`Route_${route}_Alerts_${dateSlug}.pdf`);
      // Mark this exact set of alerts as "sent"
      markRouteSent(routeAlerts);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setPdfGenerating(null);
    }
  }

  return (
    <div className="al-page">
      {/* Header */}
      <div className="al-header">
        <div className="al-title-row">
          <h2>Alert Log</h2>
          <div className="al-quick-dates">
            <button
              className={`al-quick-btn ${filterDate === null ? 'active' : ''}`}
              onClick={() => setFilterDate(null)}
            >All</button>
            <button
              className={`al-quick-btn ${filterDate === today ? 'active' : ''}`}
              onClick={() => setFilterDate(today)}
            >Today</button>
            <button
              className={`al-quick-btn ${filterDate === yesterday ? 'active' : ''}`}
              onClick={() => setFilterDate(yesterday)}
            >Yesterday</button>
            <button
              className={`al-quick-btn ${filterDate === dayBefore ? 'active' : ''}`}
              onClick={() => setFilterDate(dayBefore)}
            >Day Before</button>
          </div>
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
              onClick={() => handleFetchByDate()}
              disabled={fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Alerts'}
            </button>
            <button
              className="al-btn-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh Stores'}
            </button>
            <button
              className="al-btn-report"
              onClick={() => setPage('alertAnalytics')}
            >
              30-Day Report
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
                    {(() => {
                      const sentInfo = getRouteSentInfo(routeAlerts);
                      const sentDate = sentInfo ? new Date(sentInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
                      return (
                        <div className="al-pdf-wrap">
                          <button
                            className={`al-btn-pdf${sentInfo ? ' al-btn-pdf--sent' : ''}`}
                            onClick={(e) => generateRoutePDF(e, route, routeAlerts)}
                            disabled={pdfGenerating !== null}
                            title={sentInfo
                              ? `Sent ${sentDate} (${sentInfo.count} alerts: ${sentInfo.refs.join(', ')})\nClick to re-generate`
                              : `Download PDF for ${route === 'Unmatched' ? 'unmatched stores' : 'Route ' + route}`}
                          >
                            {pdfGenerating === route ? 'Generating...' : sentInfo ? 'PDF' : 'PDF'}
                          </button>
                          {sentInfo && (
                            <span className="al-pdf-sent-tag">Sent {sentDate}</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {expanded && (
                  <table className="al-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}></th>
                        <th>Store</th>
                        <th>City</th>
                        <th>Last Service</th>
                        <th>Ref #</th>
                        <th>Date</th>
                        <th>Response</th>
                        <th>Email</th>
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
                              <td className="al-cell-service">
                                {a.daysSinceService !== null
                                  ? <span style={{ color: a.daysSinceService > 14 ? '#ef4444' : a.daysSinceService > 7 ? '#f97316' : '#16a34a', fontWeight: 600 }}>{a.daysSinceService}d ago</span>
                                  : <span style={{ color: '#9ca3af' }}>Never</span>}
                              </td>
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
                                {a.emailId && (
                                  <a
                                    className="al-email-link"
                                    href={`https://mail.google.com/mail/u/0/#inbox/${a.emailId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open email in Gmail"
                                  >
                                    Open
                                  </a>
                                )}
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
                                <td colSpan={9}>
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

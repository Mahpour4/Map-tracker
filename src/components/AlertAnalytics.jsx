import React, { useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext';

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
  const lastVisited = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
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

export default function AlertAnalytics() {
  const { state, setPage, clearAlerts } = useApp();
  const { alerts, stores } = state;

  // Build store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Enrich all alerts with store data and status
  const enrichedAlerts = useMemo(() => {
    const now = localDateStr();
    return alerts.map(a => {
      const store = storeMap[a.storeId];
      const statusInfo = getAlertStatus(a, store);
      let daysSinceService = null;
      const storeLatest = store ? [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() : null;
      if (storeLatest) {
        const visited = storeLatest.split('T')[0].split(' ')[0];
        daysSinceService = getDaysBetween(visited, now);
      }
      return { ...a, store, ...statusInfo, daysSinceService };
    });
  }, [alerts, storeMap]);

  // Date range
  const dateRange = useMemo(() => {
    const dates = enrichedAlerts.map(a => a.dateReceived).filter(Boolean).sort();
    if (dates.length === 0) return { earliest: null, latest: null };
    return { earliest: dates[0], latest: dates[dates.length - 1] };
  }, [enrichedAlerts]);

  // Overall stats
  const overallStats = useMemo(() => {
    const total = enrichedAlerts.length;
    const open = enrichedAlerts.filter(a => a.status === 'unresolved').length;
    const resolved = enrichedAlerts.filter(a => a.status === 'resolved').length;
    const unknown = enrichedAlerts.filter(a => a.status === 'unknown').length;
    const resolvedWithDays = enrichedAlerts.filter(a => a.status === 'resolved' && a.days !== null);
    const avgResponse = resolvedWithDays.length > 0
      ? Math.round(resolvedWithDays.reduce((sum, a) => sum + a.days, 0) / resolvedWithDays.length)
      : null;
    const uniqueDates = new Set(enrichedAlerts.map(a => a.dateReceived).filter(Boolean));
    return { total, open, resolved, unknown, avgResponse, days: uniqueDates.size };
  }, [enrichedAlerts]);

  // Route stats
  const routeStats = useMemo(() => {
    const map = {};
    enrichedAlerts.forEach(a => {
      const r = a.routeNumber || 'Unmatched';
      if (!map[r]) map[r] = { route: r, total: 0, open: 0, resolved: 0, responseDays: [], storeMap: {} };
      map[r].total++;
      if (a.status === 'unresolved') map[r].open++;
      if (a.status === 'resolved') {
        map[r].resolved++;
        if (a.days !== null) map[r].responseDays.push(a.days);
      }
      const storeKey = `${a.storeName} #${a.storeNumber}`;
      map[r].storeMap[storeKey] = (map[r].storeMap[storeKey] || 0) + 1;
    });
    return Object.values(map)
      .map(r => {
        const avgResponse = r.responseDays.length > 0
          ? Math.round(r.responseDays.reduce((s, d) => s + d, 0) / r.responseDays.length)
          : null;
        const worstEntries = Object.entries(r.storeMap).sort((a, b) => b[1] - a[1]);
        const worstStore = worstEntries[0] ? `${worstEntries[0][0]} (${worstEntries[0][1]})` : '—';
        return { ...r, avgResponse, worstStore };
      })
      .sort((a, b) => b.total - a.total);
  }, [enrichedAlerts]);

  // Store stats (repeat offenders)
  const storeStats = useMemo(() => {
    const map = {};
    enrichedAlerts.forEach(a => {
      const key = a.storeId || `${a.storeName}_${a.storeNumber}`;
      if (!map[key]) map[key] = {
        name: a.storeName, number: a.storeNumber, city: a.city,
        route: a.routeNumber, total: 0, open: 0, resolved: 0,
        lastAlert: '', daysSinceService: null,
      };
      map[key].total++;
      if (a.status === 'unresolved') map[key].open++;
      if (a.status === 'resolved') map[key].resolved++;
      if (a.dateReceived > (map[key].lastAlert || '')) map[key].lastAlert = a.dateReceived;
      if (a.daysSinceService !== null) map[key].daysSinceService = a.daysSinceService;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [enrichedAlerts]);

  // Unresolved aging (oldest open alerts)
  const unresolvedAging = useMemo(() => {
    return enrichedAlerts
      .filter(a => a.status === 'unresolved')
      .sort((a, b) => {
        const da = a.days ?? 0;
        const db = b.days ?? 0;
        return db - da;
      });
  }, [enrichedAlerts]);

  function handleClearAll() {
    if (window.confirm('Clear all accumulated alerts? This cannot be undone.')) {
      clearAlerts();
    }
  }

  function handleExportPDF() {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('30-Day Alert Report', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const rangeStr = dateRange.earliest
      ? `${formatDate(dateRange.earliest)} — ${formatDate(dateRange.latest)}`
      : 'No data';
    doc.text(`${rangeStr} | ${overallStats.total} alerts | ${overallStats.open} open | ${overallStats.resolved} resolved | Avg response: ${overallStats.avgResponse ?? '—'}d`, pageWidth / 2, 21, { align: 'center' });

    // Section 1: Routes
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('Routes by Alert Volume', 14, 30);
    doc.setTextColor(0, 0, 0);

    autoTable(doc, {
      startY: 33,
      head: [['Route', 'Total', 'Open', 'Resolved', 'Avg Response', 'Top Offender']],
      body: routeStats.map(r => [
        r.route === 'Unmatched' ? 'Unmatched' : `Route ${r.route}`,
        r.total,
        r.open,
        r.resolved,
        r.avgResponse !== null ? `${r.avgResponse}d` : '—',
        r.worstStore,
      ]),
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      didParseCell: function (data) {
        if (data.section !== 'body') return;
        const r = routeStats[data.row.index];
        if (!r) return;
        if (data.column.index === 2 && r.open > 0) {
          data.cell.styles.textColor = [239, 68, 68];
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 3 && r.resolved > 0) {
          data.cell.styles.textColor = [34, 197, 94];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    let yPos = doc.lastAutoTable.finalY + 10;

    // Section 2: Repeat Offenders
    if (yPos + 30 > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      yPos = 15;
    }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('Repeat Offender Stores', 14, yPos);
    doc.setTextColor(0, 0, 0);

    const offenders = storeStats.filter(s => s.total >= 2);
    autoTable(doc, {
      startY: yPos + 3,
      head: [['Store', 'City', 'Route', 'Alerts', 'Open', 'Resolved', 'Last Alert', 'Last Service']],
      body: offenders.map(s => [
        `${s.name} #${s.number}`,
        s.city,
        s.route || '—',
        s.total,
        s.open,
        s.resolved,
        formatDate(s.lastAlert),
        s.daysSinceService !== null ? `${s.daysSinceService}d ago` : 'Never',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      didParseCell: function (data) {
        if (data.section !== 'body') return;
        const s = offenders[data.row.index];
        if (!s) return;
        if (data.column.index === 3 && s.total >= 3) {
          data.cell.styles.textColor = [239, 68, 68];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Generated ${todayStr} — Map Tracker — Page ${i}/${pageCount}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' }
      );
    }

    const dateSlug = localDateStr();
    doc.save(`30Day_Alert_Report_${dateSlug}.pdf`);
  }

  return (
    <div className="aa-page">
      {/* Header */}
      <div className="aa-header">
        <div className="aa-title-row">
          <button className="aa-back-btn" onClick={() => setPage('alerts')}>
            &#8592; Alert Log
          </button>
          <h2>30-Day Alert Report</h2>
          {dateRange.earliest && (
            <span className="aa-date-range">
              {formatDate(dateRange.earliest)} — {formatDate(dateRange.latest)}
            </span>
          )}
          <div className="aa-header-actions">
            <button className="aa-btn-export" onClick={handleExportPDF}>
              Export PDF
            </button>
            <button className="aa-btn-clear" onClick={handleClearAll}>
              Clear All
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="aa-stats">
          <div className="aa-stat-card">
            <span className="aa-stat-value">{overallStats.total}</span>
            <span className="aa-stat-label">Total Alerts</span>
          </div>
          <div className="aa-stat-card red">
            <span className="aa-stat-value">{overallStats.open}</span>
            <span className="aa-stat-label">Open</span>
          </div>
          <div className="aa-stat-card green">
            <span className="aa-stat-value">{overallStats.resolved}</span>
            <span className="aa-stat-label">Resolved</span>
          </div>
          <div className="aa-stat-card">
            <span className="aa-stat-value">{overallStats.avgResponse ?? '—'}</span>
            <span className="aa-stat-label">Avg Response (days)</span>
          </div>
          <div className="aa-stat-card">
            <span className="aa-stat-value">{overallStats.days}</span>
            <span className="aa-stat-label">Days Tracked</span>
          </div>
        </div>
      </div>

      {enrichedAlerts.length === 0 ? (
        <div className="aa-empty">
          No alerts accumulated yet. Fetch alerts from the Alert Log to start building your 30-day history.
        </div>
      ) : (
        <div className="aa-content">
          {/* Section 1: Routes by Alert Volume */}
          <div className="aa-section">
            <h3>Routes Ranked by Alert Volume</h3>
            <table className="aa-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Total</th>
                  <th>Open</th>
                  <th>Resolved</th>
                  <th>Avg Response</th>
                  <th>Top Offender</th>
                </tr>
              </thead>
              <tbody>
                {routeStats.map(r => (
                  <tr key={r.route} className={r.open > r.resolved ? 'aa-row-bad' : r.resolved > 0 ? 'aa-row-good' : ''}>
                    <td className="aa-cell-route">
                      {r.route === 'Unmatched' ? 'Unmatched' : `Route ${r.route}`}
                    </td>
                    <td style={{ fontWeight: 700 }}>{r.total}</td>
                    <td style={{ color: r.open > 0 ? '#ef4444' : '#9ca3af', fontWeight: 600 }}>{r.open}</td>
                    <td style={{ color: r.resolved > 0 ? '#22c55e' : '#9ca3af', fontWeight: 600 }}>{r.resolved}</td>
                    <td>{r.avgResponse !== null ? `${r.avgResponse}d` : '—'}</td>
                    <td className="aa-cell-offender">{r.worstStore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Section 2: Repeat Offender Stores */}
          <div className="aa-section">
            <h3>Repeat Offender Stores</h3>
            <p className="aa-section-desc">Stores with multiple alerts in the past 30 days — persistent service issues.</p>
            <table className="aa-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>City</th>
                  <th>Route</th>
                  <th>Alerts</th>
                  <th>Open</th>
                  <th>Resolved</th>
                  <th>Last Alert</th>
                  <th>Last Service</th>
                </tr>
              </thead>
              <tbody>
                {storeStats.map((s, i) => (
                  <tr key={i} className={s.total >= 3 ? 'aa-row-critical' : s.total >= 2 ? 'aa-row-warning' : ''}>
                    <td className="aa-cell-store">{s.name} #{s.number}</td>
                    <td>{s.city}</td>
                    <td>{s.route || '—'}</td>
                    <td style={{ fontWeight: 700, color: s.total >= 3 ? '#ef4444' : s.total >= 2 ? '#f97316' : 'inherit' }}>{s.total}</td>
                    <td style={{ color: s.open > 0 ? '#ef4444' : '#9ca3af', fontWeight: 600 }}>{s.open}</td>
                    <td style={{ color: s.resolved > 0 ? '#22c55e' : '#9ca3af', fontWeight: 600 }}>{s.resolved}</td>
                    <td>{formatDate(s.lastAlert)}</td>
                    <td>
                      {s.daysSinceService !== null
                        ? <span style={{ color: s.daysSinceService > 14 ? '#ef4444' : s.daysSinceService > 7 ? '#f97316' : '#16a34a', fontWeight: 600 }}>{s.daysSinceService}d ago</span>
                        : <span style={{ color: '#9ca3af' }}>Never</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Section 3: Unresolved Aging */}
          {unresolvedAging.length > 0 && (
            <div className="aa-section">
              <h3>Unresolved Alerts — Aging</h3>
              <p className="aa-section-desc">Open alerts sorted by how long they&apos;ve been waiting, oldest first.</p>
              <table className="aa-table">
                <thead>
                  <tr>
                    <th>Days Waiting</th>
                    <th>Store</th>
                    <th>City</th>
                    <th>Route</th>
                    <th>Alert Date</th>
                    <th>Ref #</th>
                  </tr>
                </thead>
                <tbody>
                  {unresolvedAging.map((a, i) => (
                    <tr key={i} className={a.days > 14 ? 'aa-row-critical' : a.days > 7 ? 'aa-row-warning' : ''}>
                      <td style={{ fontWeight: 700, color: a.days > 14 ? '#ef4444' : a.days > 7 ? '#f97316' : '#f59e0b' }}>
                        {a.days !== null ? `${a.days}d` : 'Unknown'}
                      </td>
                      <td className="aa-cell-store">{a.storeName} #{a.storeNumber}</td>
                      <td>{a.city}</td>
                      <td>{a.routeNumber || '—'}</td>
                      <td>{formatDate(a.dateReceived)}</td>
                      <td className="aa-cell-ref">{a.refNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

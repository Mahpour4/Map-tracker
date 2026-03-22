import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Helpers (kept from original) ────────────────────────────────────────────

function isCashStop(store) {
  return store.id.toLowerCase().startsWith('cash');
}

function getStorePrefix(id) {
  const m = (id || '').match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : '?';
}

function getDaysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.abs(Math.floor((a - b) / (1000 * 60 * 60 * 24)));
}

function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toYMD(dateStr) {
  if (!dateStr) return null;
  return dateStr.split('T')[0].split(' ')[0];
}

function localDateStr(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getVisitGrade(daysSince, intervals, targetDays) {
  if (daysSince === null) return { letter: 'F', color: '#9ca3af', label: 'Never', score: 0 };
  const scores = [];
  if (daysSince <= targetDays) scores.push(100);
  else if (daysSince <= targetDays * 1.5) scores.push(70);
  else if (daysSince <= targetDays * 2) scores.push(40);
  else if (daysSince <= targetDays * 3) scores.push(15);
  else scores.push(0);
  intervals.forEach((gap) => {
    if (gap <= targetDays) scores.push(100);
    else if (gap <= targetDays * 1.5) scores.push(70);
    else if (gap <= targetDays * 2) scores.push(40);
    else scores.push(10);
  });
  const currentScore = scores[0];
  const historyScores = scores.slice(1);
  const histAvg = historyScores.length > 0
    ? historyScores.reduce((a, b) => a + b, 0) / historyScores.length
    : currentScore;
  const avg = Math.round(currentScore * 0.6 + histAvg * 0.4);
  if (avg >= 85) return { letter: 'A', color: '#22c55e', label: 'A', score: avg };
  if (avg >= 65) return { letter: 'B', color: '#3b82f6', label: 'B', score: avg };
  if (avg >= 45) return { letter: 'C', color: '#eab308', label: 'C', score: avg };
  if (avg >= 25) return { letter: 'D', color: '#f97316', label: 'D', score: avg };
  return { letter: 'F', color: '#ef4444', label: 'F', score: avg };
}

function getRowStatus(daysSince, targetDays) {
  if (daysSince === null) return 'never';
  if (daysSince <= targetDays) return 'ontrack';
  if (daysSince <= targetDays * 2) return 'missed';
  return 'overdue';
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

const TYPE_COLORS = {
  FLW: '#16a34a', SRW: '#7c3aed', MTW: '#0891b2', GTW: '#0891b2',
  CMW: '#6366f1', WMW: '#2563eb', WAW: '#2563eb', AMW: '#dc2626',
  RDW: '#b91c1c', WGW: '#059669', SFW: '#8b5cf6', BGW: '#a16207',
  FDW: '#0d9488', KFW: '#ea580c', HF: '#64748b', IND: '#78716c',
  CASH: '#d97706', SV: '#6b7280', MISC: '#94a3b8',
};

const TYPE_LABELS = {
  FLW: 'Food Lion', SRW: 'ShopRite', MTW: 'Martins', GTW: 'Giant',
  CMW: 'Commissary', WMW: 'Walmart', WAW: 'Walmart', AMW: 'Acme',
  RDW: 'Redners', WGW: 'Wegmans', SFW: 'Shoppers', BGW: 'B Green',
  FDW: 'Food Depot', KFW: 'K Food', HF: 'HF', IND: 'Independent',
  CASH: 'Cash Stop', SV: 'Seven Mile', MISC: 'Misc',
};

function getThisWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const dates = new Set();
  for (let i = mondayOffset; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.add(localDateStr(d));
  }
  return dates;
}

// ── Mini Calendar ────────────────────────────────────────────────────────────

function MiniCalendar({ visitDates, alerts, targetDays }) {
  // Default to month of most recent visit (or current month if none)
  const initialOffset = useMemo(() => {
    if (!visitDates || visitDates.length === 0) return 0;
    const sorted = [...visitDates].sort();
    const latest = sorted[sorted.length - 1];
    const latestDate = new Date(latest + 'T00:00:00');
    const now = new Date();
    return (latestDate.getFullYear() - now.getFullYear()) * 12 + (latestDate.getMonth() - now.getMonth());
  }, []); // only compute once on mount
  const [monthOffset, setMonthOffset] = useState(initialOffset);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + monthOffset;
  const dt = new Date(year, month, 1);
  const mYear = dt.getFullYear();
  const mMonth = dt.getMonth();
  const daysInMonth = new Date(mYear, mMonth + 1, 0).getDate();
  const startDay = dt.getDay(); // 0=Sun
  const monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const visitSet = useMemo(() => new Set(visitDates || []), [visitDates]);
  const todayStr = localDateStr();

  // Build alert range sets: received dates and active bar dates
  const { alertReceivedSet, alertBarSet } = useMemo(() => {
    const received = new Set();
    const bar = new Set();
    const sortedVisits = [...(visitDates || [])].sort();
    (alerts || []).forEach(a => {
      const recv = a.dateReceived ? a.dateReceived.split('T')[0].split(' ')[0] : null;
      if (!recv) return;
      received.add(recv);
      // Find end date: first visit on or after alert date, or today if unresolved
      let endDate = todayStr;
      for (const v of sortedVisits) {
        if (v >= recv) { endDate = v; break; }
      }
      // Fill bar from day after received to end date
      const start = new Date(recv + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      const cur = new Date(start);
      cur.setDate(cur.getDate() + 1); // start bar the day after received
      while (cur <= end) {
        bar.add(localDateStr(cur));
        cur.setDate(cur.getDate() + 1);
      }
    });
    return { alertReceivedSet: received, alertBarSet: bar };
  }, [alerts, visitDates, todayStr]);

  // Compute missed days: when the gap between two visits exceeds targetDays,
  // highlight all days between them (the "missed" period with no visit).
  // E.g. visits Mar 7 and Mar 16 with targetDays=7 → gap=9 > 7 → highlight Mar 8-15.
  const missedSet = useMemo(() => {
    const missed = new Set();
    if (!targetDays || !visitDates || visitDates.length < 2) return missed;
    const sorted = [...visitDates].sort();
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + 'T00:00:00');
      const next = new Date(sorted[i] + 'T00:00:00');
      const gap = Math.round((next - prev) / 86400000);
      if (gap > targetDays) {
        // Highlight all days between the two visits
        const cur = new Date(prev);
        cur.setDate(cur.getDate() + 1);
        while (cur < next) {
          missed.add(localDateStr(cur));
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
    return missed;
  }, [visitDates, targetDays]);

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(<span key={`e${i}`} className="vh-cal-empty" />);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${mYear}-${String(mMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isVisit = visitSet.has(ds);
    const isReceived = alertReceivedSet.has(ds);
    const isBar = alertBarSet.has(ds);
    const isMissed = missedSet.has(ds);
    const isToday = ds === todayStr;
    let cls = 'vh-cal-day';
    if (isMissed && !isVisit && !isBar && !isReceived) cls += ' missed';
    if (isBar) cls += ' alert-bar';
    if (isVisit) cls += ' visit';
    if (isReceived) cls += ' alert-recv';
    if (isToday) cls += ' today';
    cells.push(<span key={d} className={cls}>{d}</span>);
  }

  return (
    <div className="vh-cal">
      <div className="vh-cal-nav">
        <button onClick={() => setMonthOffset(o => o - 1)}>&lsaquo;</button>
        <span className="vh-cal-month">{monthLabel}</span>
        <button onClick={() => setMonthOffset(o => Math.min(o + 1, 0))} disabled={monthOffset >= 0}>&rsaquo;</button>
      </div>
      <div className="vh-cal-header">
        {['S','M','T','W','T','F','S'].map((l, i) => <span key={i} className="vh-cal-dow">{l}</span>)}
      </div>
      <div className="vh-cal-grid">{cells}</div>
      <div className="vh-cal-legend">
        <span className="vh-cal-leg-item"><span className="vh-cal-leg-visit" /> Visit</span>
        <span className="vh-cal-leg-item"><span className="vh-cal-leg-alert" /> Received</span>
        <span className="vh-cal-leg-item"><span className="vh-cal-leg-bar" /> Open</span>
        <span className="vh-cal-leg-item"><span className="vh-cal-leg-missed" /> Missed</span>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VisitHistory() {
  const { state, syncFromGithub, recordVisit, loadAlertImage } = useApp();
  const { stores, syncStatus, travelLog, fleetVehicles, visitHistory } = state;

  const [selectedRoute, setSelectedRoute] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [selectedCalDay, setSelectedCalDay] = useState(null); // { date, gpsStops, visitedStores }
  const [editPos, setEditPos] = useState(null);
  const [expandedStore, setExpandedStore] = useState(null);
  const [expandedAlert, setExpandedAlert] = useState(null);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(null); // storeId
  const [lightboxImg, setLightboxImg] = useState(null); // { src, alt }
  const [columnLayout, setColumnLayout] = useState(2); // 1, 2, or 3 columns
  const editDateRef = useRef(null);
  const pdfMenuRef = useRef(null);

  // Auto-open date picker
  useEffect(() => {
    if (editingId && editDateRef.current) {
      setTimeout(() => {
        try { editDateRef.current.showPicker(); } catch (_) {}
      }, 50);
    }
  }, [editingId]);

  const openEdit = useCallback((storeId, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setEditPos({ top: rect.bottom + 4, left: rect.right - 200 });
    setEditingId(storeId);
    setEditDate(localDateStr());
  }, []);

  const closeEdit = useCallback(() => {
    setEditingId(null);
    setEditDate('');
    setEditPos(null);
  }, []);

  const handleAddVisit = useCallback((storeId) => {
    if (!editDate) return;
    const ymd = toYMD(editDate);
    if (!ymd) return;
    recordVisit(storeId, ymd);
    closeEdit();
  }, [editDate, recordVisit, closeEdit]);

  const [quickAdded, setQuickAdded] = useState(null);
  const handleQuickAdd = useCallback((storeId) => {
    recordVisit(storeId, localDateStr());
    setQuickAdded(storeId);
    setTimeout(() => setQuickAdded(prev => prev === storeId ? null : prev), 1500);
  }, [recordVisit]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    syncFromGithub();
  }, [syncFromGithub]);

  useEffect(() => {
    if (refreshing && syncStatus !== 'loading') {
      const t = setTimeout(() => setRefreshing(false), 400);
      return () => clearTimeout(t);
    }
  }, [refreshing, syncStatus]);

  // Close PDF menu on outside click
  useEffect(() => {
    if (!pdfMenuOpen) return;
    const handleClick = (e) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target)) setPdfMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pdfMenuOpen]);

  // ── Route list ──
  const routes = useMemo(() => {
    const set = new Set();
    stores.forEach(s => { if (s.routeNumber && s.routeNumber !== '0') set.add(s.routeNumber); });
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [stores]);

  // ── All stores with visit data (for route overview) ──
  const allStoreData = useMemo(() => {
    const today = localDateStr();
    return stores
      .filter(s => s.routeNumber && s.routeNumber !== '0')
      .map(s => {
        const vhDates = state.visitHistory[s.id] || [];
        const dates = new Set(vhDates);
        // Only use store-level dates as fallback when no visit history exists
        if (vhDates.length === 0) {
          if (s.lastVisited) { const d = toYMD(s.lastVisited); if (d) dates.add(d); }
          if (s.lastSaleDate) { const d = toYMD(s.lastSaleDate); if (d) dates.add(d); }
        }
        const history = [...dates].sort().reverse();
        const lastVisit = history[0] || null;
        const prevVisit = history[1] || null;
        const thirdVisit = history[2] || null;
        const daysSince = lastVisit ? getDaysBetween(today, lastVisit) : null;
        const intervals = [];
        if (lastVisit && prevVisit) intervals.push(getDaysBetween(lastVisit, prevVisit));
        if (prevVisit && thirdVisit) intervals.push(getDaysBetween(prevVisit, thirdVisit));
        const isCash = isCashStop(s);
        const targetDays = isCash ? 14 : 7;
        const grade = getVisitGrade(daysSince, intervals, targetDays);
        const status = getRowStatus(daysSince, targetDays);
        const prefix = getStorePrefix(s.id);
        const missedWeeks = daysSince !== null ? Math.max(0, Math.floor(daysSince / targetDays) - 1) : null;
        const lastSaleDate = s.lastSaleDate ? toYMD(s.lastSaleDate) : null;

        // Missing data warnings
        const warnings = [];
        if (history.length === 0) warnings.push('No visit history recorded');
        if (!lastSaleDate) warnings.push('No sale date on record');
        else {
          const saleDays = getDaysBetween(today, lastSaleDate);
          if (saleDays > 30) warnings.push(`Last sale ${saleDays} days ago`);
        }
        if (s.dormant === 'true' || s.dormant === true) warnings.push('Store marked dormant');

        return {
          id: s.id, name: s.name, city: s.city || '', address: s.address || '',
          route: s.routeNumber, prefix, isCash, targetDays,
          lastVisit, prevVisit, thirdVisit, daysSince, intervals, grade, status,
          missedWeeks, lastSaleDate, warnings, allDates: history,
          storeObj: s,
        };
      });
  }, [stores, state.visitHistory]);

  // ── Store alert map ──
  const storeAlertMap = useMemo(() => {
    const map = {};
    const alerts = state.alerts || [];
    alerts.forEach(a => {
      const storeId = a.storeId;
      if (!storeId) return;
      const store = stores.find(s => s.id === storeId);
      if (!store) return;
      // Enrich with visit history for accurate status
      const vhDates = (state.visitHistory[storeId] || []).filter(Boolean).sort();
      const bestVisited = vhDates.length > 0 ? vhDates[vhDates.length - 1] : store.lastVisited;
      const enrichedStore = { ...store, lastVisited: bestVisited || store.lastVisited };
      const statusInfo = getAlertStatus(a, enrichedStore);
      if (!map[storeId]) map[storeId] = [];
      map[storeId].push({ ...a, ...statusInfo });
    });
    // Sort: unresolved first, then by date desc
    Object.values(map).forEach(arr => {
      arr.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'unresolved' ? -1 : 1;
        return (b.dateReceived || '').localeCompare(a.dateReceived || '');
      });
    });
    return map;
  }, [state.alerts, stores, state.visitHistory]);

  // ── Route stores (filtered to selected route) ──
  const routeStores = useMemo(() => {
    if (!selectedRoute) return [];
    let rows = allStoreData.filter(s => s.route === selectedRoute);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      rows = rows.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    }
    // Sort: Food Lions first, then by urgency: overdue → missed → never → ontrack
    const statusOrder = { overdue: 0, missed: 1, never: 2, ontrack: 3 };
    rows.sort((a, b) => {
      const aFL = a.prefix === 'FLW' ? 0 : 1;
      const bFL = b.prefix === 'FLW' ? 0 : 1;
      if (aFL !== bFL) return aFL - bFL;
      const so = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      if (so !== 0) return so;
      return (b.daysSince ?? 9999) - (a.daysSince ?? 9999);
    });
    return rows;
  }, [allStoreData, selectedRoute, searchTerm]);

  // ── Route summary stats ──
  const routeStats = useMemo(() => {
    if (!selectedRoute) return null;
    const stores = routeStores;
    const weekDates = getThisWeekDates();
    const visitedThisWeek = stores.filter(s => s.allDates.some(d => weekDates.has(d))).length;
    const overdue = stores.filter(s => s.status === 'overdue' || s.status === 'missed').length;
    const openAlerts = stores.reduce((sum, s) => {
      const alerts = storeAlertMap[s.id] || [];
      return sum + alerts.filter(a => a.status === 'unresolved').length;
    }, 0);
    const graded = stores.filter(s => s.status !== 'never');
    const avgScore = graded.length > 0
      ? Math.round(graded.reduce((sum, s) => sum + s.grade.score, 0) / graded.length) : 0;
    let gradeLetter = '—', gradeColor = '#9ca3af';
    if (graded.length > 0) {
      if (avgScore >= 85) { gradeLetter = 'A'; gradeColor = '#22c55e'; }
      else if (avgScore >= 65) { gradeLetter = 'B'; gradeColor = '#3b82f6'; }
      else if (avgScore >= 45) { gradeLetter = 'C'; gradeColor = '#eab308'; }
      else if (avgScore >= 25) { gradeLetter = 'D'; gradeColor = '#f97316'; }
      else { gradeLetter = 'F'; gradeColor = '#ef4444'; }
    }
    return { total: stores.length, visitedThisWeek, overdue, openAlerts, gradeLetter, gradeColor };
  }, [routeStores, selectedRoute, storeAlertMap]);

  // ── Store type breakdown for selected route ──
  const storeTypeCounts = useMemo(() => {
    if (!selectedRoute) return [];
    const counts = {};
    routeStores.forEach(s => {
      const key = s.prefix;
      if (!counts[key]) counts[key] = { prefix: key, label: TYPE_LABELS[key] || key, color: TYPE_COLORS[key] || '#64748b', total: 0, overdue: 0 };
      counts[key].total++;
      if (s.status === 'overdue' || s.status === 'missed') counts[key].overdue++;
    });
    return Object.values(counts).sort((a, b) => b.total - a.total);
  }, [routeStores, selectedRoute]);

  // ── Route overview for no-route-selected state ──
  const routeOverview = useMemo(() => {
    if (selectedRoute) return [];
    const weekDates = getThisWeekDates();
    return routes.map(r => {
      const rStores = allStoreData.filter(s => s.route === r);
      const overdue = rStores.filter(s => s.status === 'overdue' || s.status === 'missed').length;
      const visitedThisWeek = rStores.filter(s => s.allDates.some(d => weekDates.has(d))).length;
      const openAlerts = rStores.reduce((sum, s) => {
        const alerts = storeAlertMap[s.id] || [];
        return sum + alerts.filter(a => a.status === 'unresolved').length;
      }, 0);
      const graded = rStores.filter(s => s.status !== 'never');
      const avgScore = graded.length > 0
        ? Math.round(graded.reduce((sum, s) => sum + s.grade.score, 0) / graded.length) : 0;
      let gradeLetter = '—', gradeColor = '#9ca3af';
      if (graded.length > 0) {
        if (avgScore >= 85) { gradeLetter = 'A'; gradeColor = '#22c55e'; }
        else if (avgScore >= 65) { gradeLetter = 'B'; gradeColor = '#3b82f6'; }
        else if (avgScore >= 45) { gradeLetter = 'C'; gradeColor = '#eab308'; }
        else if (avgScore >= 25) { gradeLetter = 'D'; gradeColor = '#f97316'; }
        else { gradeLetter = 'F'; gradeColor = '#ef4444'; }
      }
      return { route: r, total: rStores.length, overdue, visitedThisWeek, openAlerts, gradeLetter, gradeColor };
    });
  }, [routes, allStoreData, selectedRoute, storeAlertMap]);

  // ── Alert image expand handler ──
  function handleExpandAlert(refNumber, emailId) {
    if (expandedAlert === refNumber) { setExpandedAlert(null); return; }
    setExpandedAlert(refNumber);
    if (emailId && !state.alertImages?.[emailId]) {
      loadAlertImage(emailId);
    }
  }

  // ── Gallery handler: load all images for a store's alerts ──
  function handleToggleGallery(storeId, alerts) {
    if (galleryOpen === storeId) { setGalleryOpen(null); return; }
    setGalleryOpen(storeId);
    loadGalleryImages(alerts);
  }

  function loadGalleryImages(alertsList) {
    alertsList.forEach(a => {
      if (!a.emailId) return;
      const existing = state.alertImages?.[a.emailId];
      // Load if never attempted, or if previous attempt had error
      if (!existing || (existing.error && !existing.loading)) {
        loadAlertImage(a.emailId);
      }
    });
  }

  // Resolve image src — proxy external URLs through backend to avoid CORS
  function getImageSrc(imgData) {
    if (!imgData || !imgData.dataUri) return null;
    if (imgData.dataUri.startsWith('data:')) return imgData.dataUri;
    if (imgData.dataUri.startsWith('http')) return `/api/proxy-image?url=${encodeURIComponent(imgData.dataUri)}`;
    return imgData.dataUri;
  }

  // ── Status colors ──
  const statusColors = { ontrack: '#22c55e', missed: '#f97316', overdue: '#ef4444', never: '#9ca3af' };

  // ── PDF export ──
  const generatePDF = useCallback((mode) => {
    setPdfMenuOpen(false);
    let rows = selectedRoute ? [...routeStores] : [...allStoreData];
    let subtitle = selectedRoute ? `Route ${selectedRoute}` : 'All Routes';

    if (mode === 'days') rows.sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
    else if (mode === 'grade') {
      const order = { F: 1, D: 2, C: 3, B: 4, A: 5 };
      rows.sort((a, b) => (order[a.grade.letter] || 5) - (order[b.grade.letter] || 5));
    }

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Visit History — ${subtitle}`, pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const pdfOverdue = rows.filter(r => r.status === 'overdue' || r.status === 'missed').length;
    doc.text(`${rows.length} stores | Overdue: ${pdfOverdue} | ${today}`, pageWidth / 2, 21, { align: 'center' });

    const tableRows = rows.map((row, i) => {
      const alerts = storeAlertMap[row.id] || [];
      const openCount = alerts.filter(a => a.status === 'unresolved').length;
      return [
        i + 1, row.id, row.name, row.city, row.route,
        formatShortDate(row.lastVisit), row.daysSince !== null ? `${row.daysSince}d` : '—',
        formatShortDate(row.prevVisit), row.grade.letter,
        openCount > 0 ? `${openCount} open` : '—',
      ];
    });

    autoTable(doc, {
      startY: 26,
      head: [['#', 'ID', 'Store', 'City', 'Rte', 'Last Visit', 'Days', 'Prev', 'Grade', 'Alerts']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 22 },
        2: { cellWidth: 42 },
        3: { cellWidth: 28 },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 22 },
        6: { cellWidth: 14, halign: 'center' },
        7: { cellWidth: 22 },
        8: { cellWidth: 14, halign: 'center' },
        9: { cellWidth: 18, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
    });

    let filename = 'visit-history';
    if (selectedRoute) filename += `-route-${selectedRoute}`;
    doc.save(filename + '.pdf');
  }, [routeStores, allStoreData, selectedRoute, storeAlertMap]);

  // ── Render ──
  return (
    <div className="vh">
      {/* ── Header ── */}
      <div className="vh-header">
        <div className="vh-title-row">
          <h2>Visit History</h2>
          <button
            className={`vh-refresh-btn ${refreshing ? 'spinning' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <span className="vh-refresh-icon">&#x21bb;</span>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <div className="vh-pdf-wrap" ref={pdfMenuRef}>
            <button className="vh-pdf-btn" onClick={() => setPdfMenuOpen(!pdfMenuOpen)}>
              PDF {pdfMenuOpen ? '\u25B2' : '\u25BC'}
            </button>
            {pdfMenuOpen && (
              <div className="vh-pdf-menu">
                <button onClick={() => generatePDF('current')}>Current View</button>
                <button onClick={() => generatePDF('days')}>Most Days Since</button>
                <button onClick={() => generatePDF('grade')}>Worst Grade First</button>
              </div>
            )}
          </div>
          <div className="vh-col-toggle">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                className={`vh-col-btn ${columnLayout === n ? 'active' : ''}`}
                onClick={() => setColumnLayout(n)}
                title={`${n} column${n > 1 ? 's' : ''}`}
              >
                {n === 1 ? '\u2630' : n === 2 ? '\u2587\u2587' : '\u2587\u2587\u2587'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Route Selector ── */}
        <div className="vh-route-bar">
          <span className="vh-route-label">Route</span>
          {routes.map(r => (
            <button
              key={r}
              className={`vh-route-btn ${selectedRoute === r ? 'active' : ''}`}
              onClick={() => { setSelectedRoute(selectedRoute === r ? null : r); setExpandedStore(null); setExpandedAlert(null); }}
            >
              {r}
            </button>
          ))}
          {selectedRoute && (
            <input
              type="text"
              className="vh-search"
              placeholder="Search store..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          )}
        </div>
      </div>

      {/* ── No Route Selected: Overview Grid ── */}
      {!selectedRoute && (
        <div className="vh-overview">
          <p className="vh-overview-hint">Select a route to view store details</p>
          <div className="vh-overview-grid">
            {routeOverview.map(r => (
              <button key={r.route} className="vh-overview-card" onClick={() => setSelectedRoute(r.route)}>
                <div className="vh-ov-route">Route {r.route}</div>
                <div className="vh-ov-stats">
                  <span>{r.total} stores</span>
                  <span>{r.visitedThisWeek} visited</span>
                  {r.overdue > 0 && <span className="vh-ov-overdue">{r.overdue} overdue</span>}
                  {r.openAlerts > 0 && <span className="vh-ov-alerts">{r.openAlerts} alerts</span>}
                </div>
                <div className="vh-ov-grade" style={{ color: r.gradeColor }}>{r.gradeLetter}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Route Selected: Summary + Store Cards ── */}
      {selectedRoute && routeStats && (
        <>
          {/* Summary Cards */}
          <div className="vh-summary">
            <div className="vh-summary-card">
              <div className="vh-summary-value">{routeStats.total}</div>
              <div className="vh-summary-label">Total Stores</div>
            </div>
            <div className="vh-summary-card green">
              <div className="vh-summary-value">{routeStats.visitedThisWeek}</div>
              <div className="vh-summary-label">Visited This Week</div>
            </div>
            <div className="vh-summary-card red">
              <div className="vh-summary-value">{routeStats.overdue}</div>
              <div className="vh-summary-label">Overdue</div>
            </div>
            <div className="vh-summary-card orange">
              <div className="vh-summary-value">{routeStats.openAlerts}</div>
              <div className="vh-summary-label">Open Alerts</div>
            </div>
            <div className="vh-summary-card grade" style={{ borderColor: routeStats.gradeColor + '60' }}>
              <div className="vh-summary-value" style={{ color: routeStats.gradeColor }}>{routeStats.gradeLetter}</div>
              <div className="vh-summary-label">Route Grade</div>
            </div>
          </div>

          {/* Store Layout: cards + type panel */}
          <div className={`vh-store-layout vh-cols-${columnLayout}`}>
          <div className="vh-store-list">
            {routeStores.length === 0 && (
              <div className="vh-empty">No stores match your search</div>
            )}
            {routeStores.map(row => {
              const alerts = storeAlertMap[row.id] || [];
              const openAlerts = alerts.filter(a => a.status === 'unresolved');
              const isExpanded = expandedStore === row.id;
              const borderColor = statusColors[row.status] || '#9ca3af';

              return (
                <div key={row.id} id={`vh-card-${row.id}`} className={`vh-store-card vh-store-${row.status}`} style={{ borderLeftColor: borderColor }}>
                  {/* Card Header */}
                  <div className="vh-card-header">
                    <div className="vh-card-title">
                      <span className="vh-card-name">{row.name}</span>
                      <span className="vh-card-id">#{row.id}</span>
                      <span className="vh-card-city">{row.city}</span>
                    </div>
                    <div className="vh-card-meta">
                      <span className="vh-type-badge" style={{ background: (TYPE_COLORS[row.prefix] || '#64748b') + '18', color: TYPE_COLORS[row.prefix] || '#64748b' }}>
                        {TYPE_LABELS[row.prefix] || row.prefix}
                      </span>
                      {row.lastSaleDate && (
                        <span className="vh-card-sale">Sale: {formatShortDate(row.lastSaleDate)}</span>
                      )}
                      <span className="vh-days-badge" style={{ color: borderColor }}>
                        {row.daysSince !== null ? `${row.daysSince}d` : 'Never'}
                      </span>
                      <span className="vh-grade-badge" style={{ background: row.grade.color + '18', color: row.grade.color }}>
                        {row.grade.letter}
                      </span>
                      <button
                        className={`vh-quick-add-btn${quickAdded === row.id ? ' added' : ''}`}
                        title="Record visit for today"
                        onClick={() => handleQuickAdd(row.id)}
                      >{quickAdded === row.id ? '\u2713' : 'Today'}</button>
                      <button
                        className="vh-add-visit-btn"
                        title="Pick date"
                        onClick={e => editingId === row.id ? closeEdit() : openEdit(row.id, e)}
                      >+</button>
                    </div>
                  </div>

                  {/* Card Body: Visits + Calendar + Alerts */}
                  <div className="vh-card-body">
                    {/* Visits Column */}
                    <div className="vh-visits">
                      <div className="vh-visit-row">
                        <span className="vh-visit-label">Last</span>
                        <span className="vh-visit-date">{formatShortDate(row.lastVisit)}</span>
                        {row.lastVisit && row.prevVisit && (
                          <span className={`vh-visit-gap ${getDaysBetween(row.lastVisit, row.prevVisit) <= row.targetDays ? 'good' : 'bad'}`}>
                            {getDaysBetween(row.lastVisit, row.prevVisit)}d gap
                          </span>
                        )}
                      </div>
                      <div className="vh-visit-row">
                        <span className="vh-visit-label">Prev</span>
                        <span className="vh-visit-date">{formatShortDate(row.prevVisit)}</span>
                        {row.prevVisit && row.thirdVisit && (
                          <span className={`vh-visit-gap ${getDaysBetween(row.prevVisit, row.thirdVisit) <= row.targetDays ? 'good' : 'bad'}`}>
                            {getDaysBetween(row.prevVisit, row.thirdVisit)}d gap
                          </span>
                        )}
                      </div>
                      <div className="vh-visit-row">
                        <span className="vh-visit-label">3rd</span>
                        <span className="vh-visit-date">{formatShortDate(row.thirdVisit)}</span>
                      </div>
                      {row.missedWeeks !== null && row.missedWeeks > 0 && (
                        <div className="vh-missed-weeks">
                          {row.missedWeeks} missed {row.isCash ? 'cycle' : 'week'}{row.missedWeeks > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    {/* Calendar Column */}
                    <div className="vh-cal-col">
                      <MiniCalendar
                        visitDates={row.allDates}
                        alerts={alerts}
                        targetDays={row.targetDays}
                      />
                    </div>

                    {/* Alerts Column */}
                    <div className="vh-alerts">
                      {openAlerts.length > 0 && (
                        <div className="vh-alert-badge" onClick={() => setExpandedStore(isExpanded ? null : row.id)}>
                          {openAlerts.length} open alert{openAlerts.length > 1 ? 's' : ''}
                          <span className="vh-alert-toggle">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                        </div>
                      )}
                      {alerts.length === 0 && (
                        <span className="vh-no-alerts">No alerts</span>
                      )}
                      {/* Always show compact alert list */}
                      {!isExpanded && openAlerts.slice(0, 2).map(a => (
                        <div key={a.refNumber} className="vh-alert-line">
                          {a.issueType || a.gwAlertType || 'Alert'} — {formatShortDate(a.dateReceived)}
                        </div>
                      ))}
                      {!isExpanded && openAlerts.length > 2 && (
                        <div className="vh-alert-more" onClick={() => setExpandedStore(row.id)}>+{openAlerts.length - 2} more</div>
                      )}
                      {/* Expanded alert details */}
                      {isExpanded && alerts.map(a => {
                        const isAlertExpanded = expandedAlert === a.refNumber;
                        const imgData = state.alertImages?.[a.emailId];
                        return (
                          <div key={a.refNumber} className={`vh-alert-detail ${a.status}`}>
                            <div className="vh-alert-detail-header" onClick={() => handleExpandAlert(a.refNumber, a.emailId)}>
                              <span className="vh-alert-status-dot" style={{ background: a.color }}></span>
                              <span className="vh-alert-ref">{a.refNumber}</span>
                              <span className="vh-alert-date">{formatShortDate(a.dateReceived)}</span>
                              <span className="vh-alert-expand">{isAlertExpanded ? '\u25B2' : '\u25BC'}</span>
                            </div>
                            {isAlertExpanded && (
                              <div className="vh-alert-detail-body">
                                {(a.issueType || a.gwAlertType) && <div><strong>Type:</strong> {a.issueType || a.gwAlertType}</div>}
                                {(a.gwReason || a.reason) && <div><strong>Reason:</strong> {a.gwReason || a.reason}</div>}
                                {(a.gwCreatedBy || a.createdBy) && <div><strong>By:</strong> {a.gwCreatedBy || a.createdBy}</div>}
                                {a.notes && <div><strong>Notes:</strong> {a.notes}</div>}
                                <div><strong>Status:</strong> <span style={{ color: a.color }}>{a.status}{a.days != null ? ` (${a.days}d)` : ''}</span></div>
                                {imgData && imgData.dataUri && !imgData.loading && (
                                  <img className="vh-alert-img" src={getImageSrc(imgData)} alt="Alert" />
                                )}
                                {imgData && imgData.loading && <div className="vh-alert-img-loading">Loading image...</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Photo Gallery */}
                  {alerts.length > 0 && (() => {
                    const emailIds = alerts.map(a => a.emailId).filter(Boolean);
                    if (emailIds.length === 0) return null;
                    const isOpen = galleryOpen === row.id;
                    const allEntries = emailIds.map(eid => {
                      const img = state.alertImages?.[eid];
                      const alert = alerts.find(a => a.emailId === eid);
                      return { eid, img, alert };
                    });
                    const loaded = allEntries.filter(x => x.img && x.img.dataUri && !x.img.loading);
                    const loading = allEntries.some(x => x.img?.loading);
                    const errors = allEntries.filter(x => x.img && x.img.error && !x.img.loading);
                    const pending = allEntries.filter(x => !x.img);
                    return (
                      <div className="vh-gallery">
                        <div className="vh-gallery-toggle" onClick={() => handleToggleGallery(row.id, alerts)}>
                          <span className="vh-gallery-icon">&#x1F4F7;</span>
                          <span>{emailIds.length} photo{emailIds.length > 1 ? 's' : ''}</span>
                          {isOpen && loaded.length > 0 && <span className="vh-gallery-count">({loaded.length} loaded)</span>}
                          <span className="vh-gallery-arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
                        </div>
                        {isOpen && (
                          <div className="vh-gallery-strip">
                            {loading && <span className="vh-gallery-loading">Loading images...</span>}
                            {loaded.map(({ eid, img, alert: a }) => (
                              <div key={eid} className="vh-gallery-thumb" onClick={() => setLightboxImg({ src: getImageSrc(img), alt: a?.refNumber || 'Alert' })}>
                                <img src={getImageSrc(img)} alt={a?.refNumber || 'Alert'} />
                                <span className="vh-gallery-label">{formatShortDate(a?.dateReceived)}</span>
                              </div>
                            ))}
                            {!loading && loaded.length === 0 && errors.length === 0 && pending.length > 0 && (
                              <span className="vh-gallery-loading">Fetching from Gmail...</span>
                            )}
                            {!loading && loaded.length === 0 && errors.length > 0 && (
                              <div className="vh-gallery-error">
                                <span>Failed to load {errors.length} image{errors.length > 1 ? 's' : ''}</span>
                                <button className="vh-gallery-retry" onClick={() => loadGalleryImages(alerts)}>Retry</button>
                              </div>
                            )}
                            {!loading && loaded.length > 0 && errors.length > 0 && (
                              <div className="vh-gallery-error-mini">
                                <span>{errors.length} failed</span>
                                <button className="vh-gallery-retry" onClick={() => loadGalleryImages(alerts)}>Retry</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Warnings Bar */}
                  {row.warnings.length > 0 && (
                    <div className="vh-warnings">
                      {row.warnings.map((w, i) => (
                        <span key={i} className="vh-warning-item">{w}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Center: Store Types Panel + Missed Weeks */}
          <div className="vh-type-panel">
            <div className="vh-type-panel-title">Store Types</div>
            {storeTypeCounts.map(t => (
              <div key={t.prefix} className="vh-type-row" onClick={() => setSearchTerm(t.label)}>
                <span className="vh-type-dot" style={{ background: t.color }}></span>
                <span className="vh-type-name">{t.label}</span>
                <span className="vh-type-count">{t.total}</span>
                {t.overdue > 0 && <span className="vh-type-overdue">{t.overdue}</span>}
              </div>
            ))}

            {/* Missed Weeks Table — checksum: any ISO week with 0 visits = missed */}
            {(() => {
              const allRouteStores = allStoreData.filter(r => r.route === selectedRoute);
              const filtered = searchTerm
                ? allRouteStores.filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.id.toLowerCase().includes(searchTerm.toLowerCase()))
                : allRouteStores;

              const getISOWeek = (d) => {
                const date = new Date(d.getTime());
                date.setHours(0, 0, 0, 0);
                date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
                const week1 = new Date(date.getFullYear(), 0, 4);
                return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
              };
              const scrollToStore = (id) => {
                const el = document.getElementById('vh-card-' + id);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.style.boxShadow = '0 0 0 3px #ef4444';
                  setTimeout(() => { el.style.boxShadow = ''; }, 2000);
                }
              };

              // For each store, build a set of weeks that have visits,
              // then check every week from first visit to now — any week missing = failed checksum
              const now = new Date(); now.setHours(0, 0, 0, 0);
              const currentWeek = getISOWeek(now);
              const currentYear = now.getFullYear();
              const rows = [];

              filtered.forEach(r => {
                if (!r.allDates || r.allDates.length === 0) return;
                // Build set of "YYYY-WW" keys that have at least one visit
                const visitedWeeks = new Set();
                r.allDates.forEach(d => {
                  const dt = new Date(d + 'T00:00:00');
                  const wk = getISOWeek(dt);
                  const yr = dt.getFullYear();
                  visitedWeeks.add(`${yr}-${wk}`);
                });
                // Walk every week from first visit's week to current week
                const first = new Date(r.allDates.slice().sort()[0] + 'T00:00:00');
                const firstWeek = getISOWeek(first);
                const firstYear = first.getFullYear();
                for (let yr = firstYear; yr <= currentYear; yr++) {
                  const startWk = yr === firstYear ? firstWeek + 1 : 1;
                  const endWk = yr === currentYear ? currentWeek : 52;
                  for (let wk = startWk; wk <= endWk; wk++) {
                    if (!visitedWeeks.has(`${yr}-${wk}`)) {
                      rows.push({ id: r.id, name: r.name, rowKey: `${r.id}-${yr}w${wk}`, week: wk, year: yr });
                    }
                  }
                }
              });

              if (rows.length === 0) return null;

              // Group by store
              const grouped = {};
              rows.forEach(r => {
                if (!grouped[r.id]) grouped[r.id] = { id: r.id, name: r.name, weeks: [] };
                grouped[r.id].weeks.push(r.week);
              });
              const stores = Object.values(grouped);

              return (
                <>
                  <div className="vh-missed-title">Missed ({stores.length} stores)</div>
                  <div className="vh-missed-list">
                    {stores.map(s => (
                      <div key={s.id} className="vh-missed-store-group">
                        <div className="vh-missed-store-name" onClick={() => scrollToStore(s.id)}>{s.name}</div>
                        <div className="vh-missed-weeks">
                          {s.weeks.map((wk, i) => (
                            <span key={wk} className="vh-missed-wk" onClick={() => scrollToStore(s.id)}>
                              {i + 1}. Wk {wk}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
          </div>

          <div className="vh-footer">
            Showing {routeStores.length} stores for Route {selectedRoute}
            {' '}| Regular: 7-day cycle | CASH: 14-day cycle
          </div>

          {/* ── Route Work Calendar ── */}
          {selectedRoute && (() => {
            // Build VIN → routeNumber map from fleetVehicles
            const vinToRoute = {};
            (fleetVehicles || []).forEach(v => {
              if (v.vin && v.routeNumber) vinToRoute[v.vin] = String(v.routeNumber);
            });

            // Collect GPS days + stops per day for this route
            const gpsDays = new Set();
            const gpsStopsByDay = {}; // date → [{ locationName, time }]
            Object.entries(travelLog || {}).forEach(([date, byVin]) => {
              Object.entries(byVin).forEach(([vin, stops]) => {
                if (vinToRoute[vin] === String(selectedRoute)) {
                  gpsDays.add(date);
                  if (!gpsStopsByDay[date]) gpsStopsByDay[date] = [];
                  gpsStopsByDay[date].push(...(stops || []));
                }
              });
            });

            // Collect visit days + which stores per day for this route
            const visitDays = new Set();
            const visitsByDay = {}; // date → [storeName]
            const routeStoreIds = new Set(stores.filter(s => String(s.routeNumber) === String(selectedRoute)).map(s => s.id));
            const storeNameById = {};
            stores.forEach(s => { storeNameById[s.id] = s.name || s.storeName || s.id; });
            Object.entries(visitHistory || {}).forEach(([storeId, dates]) => {
              if (!routeStoreIds.has(storeId)) return;
              (Array.isArray(dates) ? dates : []).forEach(d => {
                const ds = typeof d === 'string' ? d : d.date;
                visitDays.add(ds);
                if (!visitsByDay[ds]) visitsByDay[ds] = [];
                visitsByDay[ds].push(storeNameById[storeId] || storeId);
              });
            });

            if (gpsDays.size === 0 && visitDays.size === 0) return null;

            const allDates = [...gpsDays, ...visitDays].sort();
            const firstDate = new Date(allDates[0] + 'T00:00:00');
            const today = new Date(); today.setHours(0,0,0,0);

            const months = [];
            let cur = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
            while (cur <= today) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }

            const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const DAY_NAMES = ['S','M','T','W','T','F','S'];

            const handleDayClick = (ds, hasGps, hasVisit) => {
              if (!hasGps && !hasVisit) return;
              setSelectedCalDay({
                date: ds,
                gpsStops: gpsStopsByDay[ds] || [],
                visitedStores: visitsByDay[ds] || [],
              });
            };

            return (
              <div className="vh-route-calendar">
                <div className="vh-rc-title">
                  Route {selectedRoute} — Work Days Calendar
                  <span className="vh-rc-legend">
                    <span className="vh-rc-dot gps" /> GPS
                    <span className="vh-rc-dot visit" /> Visit
                    <span className="vh-rc-dot both" /> Both
                  </span>
                </div>
                <div className="vh-rc-months">
                  {months.map(monthStart => {
                    const yr = monthStart.getFullYear();
                    const mo = monthStart.getMonth();
                    const daysInMonth = new Date(yr, mo + 1, 0).getDate();
                    const firstDow = monthStart.getDay();
                    return (
                      <div key={`${yr}-${mo}`} className="vh-rc-month">
                        <div className="vh-rc-month-label">{MONTH_NAMES[mo]} {yr}</div>
                        <div className="vh-rc-days-header">
                          {DAY_NAMES.map((d, i) => <span key={i} className="vh-rc-dow">{d}</span>)}
                        </div>
                        <div className="vh-rc-days-grid">
                          {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} className="vh-rc-day empty" />)}
                          {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const ds = `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                            const hasGps = gpsDays.has(ds);
                            const hasVisit = visitDays.has(ds);
                            const dt = new Date(ds + 'T00:00:00');
                            const isFuture = dt > today;
                            const isSelected = selectedCalDay?.date === ds;
                            let cls = 'vh-rc-day';
                            if (isFuture) cls += ' future';
                            else if (hasGps && hasVisit) cls += ' both';
                            else if (hasGps) cls += ' gps';
                            else if (hasVisit) cls += ' visit';
                            if (isSelected) cls += ' selected';
                            if (!isFuture && (hasGps || hasVisit)) cls += ' clickable';
                            return <span key={day} className={cls} title={ds} onClick={() => handleDayClick(ds, hasGps, hasVisit)}>{day}</span>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Day detail panel */}
                {selectedCalDay && (
                  <div className="vh-rc-detail">
                    <div className="vh-rc-detail-header">
                      <span className="vh-rc-detail-date">{selectedCalDay.date}</span>
                      <button className="vh-rc-detail-close" onClick={() => setSelectedCalDay(null)}>✕</button>
                    </div>
                    <div className="vh-rc-detail-cols">
                      {selectedCalDay.gpsStops.length > 0 && (
                        <div className="vh-rc-detail-col">
                          <div className="vh-rc-detail-col-title gps">GPS Stops ({selectedCalDay.gpsStops.length})</div>
                          {selectedCalDay.gpsStops.map((s, i) => (
                            <div key={i} className="vh-rc-detail-stop">
                              <span className="vh-rc-detail-stop-name">{s.locationName || s.locationId || '—'}</span>
                              <span className="vh-rc-detail-stop-time">{s.time ? new Date(s.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedCalDay.visitedStores.length > 0 && (
                        <div className="vh-rc-detail-col">
                          <div className="vh-rc-detail-col-title visit">Visits Recorded ({selectedCalDay.visitedStores.length})</div>
                          {selectedCalDay.visitedStores.map((name, i) => (
                            <div key={i} className="vh-rc-detail-stop">
                              <span className="vh-rc-detail-stop-name">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedCalDay.gpsStops.length === 0 && selectedCalDay.visitedStores.length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No activity data for this day.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* ── Add Visit Popup ── */}
      {editingId && editPos && (
        <>
          <div className="vh-edit-backdrop" onClick={closeEdit}></div>
          <div className="vh-edit-popup" style={{ top: editPos.top, left: Math.max(8, editPos.left) }}>
            <div className="vh-edit-label">Add visit for: <strong>{stores.find(s => s.id === editingId)?.name || editingId}</strong></div>
            <div className="vh-edit-row">
              <input ref={editDateRef} type="date" className="vh-edit-date" value={editDate} onChange={e => setEditDate(e.target.value)} />
              <button className="vh-edit-save" onClick={() => handleAddVisit(editingId)} disabled={!editDate}>Save</button>
              <button className="vh-edit-cancel" onClick={closeEdit}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {/* ── Lightbox ── */}
      {lightboxImg && (
        <div className="vh-lightbox" onClick={() => setLightboxImg(null)}>
          <div className="vh-lightbox-inner" onClick={e => e.stopPropagation()}>
            <button className="vh-lightbox-close" onClick={() => setLightboxImg(null)}>&times;</button>
            <img src={lightboxImg.src} alt={lightboxImg.alt} />
            <div className="vh-lightbox-caption">{lightboxImg.alt}</div>
          </div>
        </div>
      )}
    </div>
  );
}

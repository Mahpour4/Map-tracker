import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import visitHistoryData from '../data/visitHistory';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function isCashStop(store) {
  return store.id.toLowerCase().startsWith('cash');
}

function getStorePrefix(id) {
  const m = (id || '').match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : '?';
}

function getDaysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
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

function getVisitGrade(daysSince, intervals, targetDays) {
  if (daysSince === null) return { letter: 'F', color: '#9ca3af', label: 'Never', score: 0 };

  // Weight: current gap matters most, then recent history
  const scores = [];

  // Current gap score
  if (daysSince <= targetDays) scores.push(100);
  else if (daysSince <= targetDays * 1.5) scores.push(70);
  else if (daysSince <= targetDays * 2) scores.push(40);
  else if (daysSince <= targetDays * 3) scores.push(15);
  else scores.push(0);

  // Historical interval scores
  intervals.forEach((gap) => {
    if (gap <= targetDays) scores.push(100);
    else if (gap <= targetDays * 1.5) scores.push(70);
    else if (gap <= targetDays * 2) scores.push(40);
    else scores.push(10);
  });

  // Weighted average: current gap = 50%, history = 50%
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

export default function VisitHistory() {
  const { state, updateStore } = useApp();
  const { stores } = state;
  const [filterRoute, setFilterRoute] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState('days');
  const [sortDir, setSortDir] = useState('desc');
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editPos, setEditPos] = useState(null);
  const [viewDate, setViewDate] = useState('');
  const [visitVersion, setVisitVersion] = useState(0);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const editDateRef = useRef(null);
  const pdfMenuRef = useRef(null);

  // Column resizing
  const defaultWidths = { status: 24, name: 180, city: 110, route: 44, type: 52, lastVisit: 74, days: 44, prevVisit: 74, thirdVisit: 74, grade: 48, actions: 30 };
  const [colWidths, setColWidths] = useState(() => ({ ...defaultWidths }));
  const [tableScale, setTableScale] = useState(100);
  const resizeRef = useRef(null);
  const tableWrapRef = useRef(null);

  const applyScale = useCallback((pct) => {
    setTableScale(pct);
    const scale = pct / 100;
    const scaled = {};
    Object.entries(defaultWidths).forEach(([k, v]) => { scaled[k] = Math.round(v * scale); });
    setColWidths(scaled);
  }, []);

  const onResizeStart = useCallback((col, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col];
    resizeRef.current = { col, startX, startW };

    const onMove = (ev) => {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(30, resizeRef.current.startW + diff);
      setColWidths((prev) => ({ ...prev, [resizeRef.current.col]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  // Auto-open the native calendar when edit popup shows
  useEffect(() => {
    if (editingId && editDateRef.current) {
      setTimeout(() => {
        try { editDateRef.current.showPicker(); } catch (_) { /* browser may not support */ }
      }, 50);
    }
  }, [editingId]);

  const openEdit = useCallback((storeId, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setEditPos({ top: rect.bottom + 4, left: rect.right - 200 });
    setEditingId(storeId);
    setEditDate(new Date().toISOString().split('T')[0]);
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
    // Update visit history in memory
    if (!visitHistoryData[storeId]) visitHistoryData[storeId] = [];
    if (!visitHistoryData[storeId].includes(ymd)) {
      visitHistoryData[storeId].push(ymd);
      visitHistoryData[storeId].sort();
    }
    // Update store's lastVisited (triggers GitHub sync)
    const store = stores.find((s) => s.id === storeId);
    if (store) {
      const allDates = visitHistoryData[storeId].slice().sort();
      const newest = allDates[allDates.length - 1];
      updateStore({ ...store, lastVisited: newest });
    }
    closeEdit();
    setVisitVersion((v) => v + 1);
  }, [editDate, stores, updateStore, closeEdit]);

  const routes = useMemo(() => {
    const set = new Set();
    stores.forEach((s) => {
      if (s.routeNumber && s.routeNumber !== '0') set.add(s.routeNumber);
    });
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [stores]);

  const storeTypes = useMemo(() => {
    const set = new Set();
    stores.forEach((s) => {
      const p = getStorePrefix(s.id);
      if (p !== '?') set.add(p);
    });
    return [...set].sort();
  }, [stores]);

  // Build full store table with visit data
  const tableData = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    return stores
      .filter((s) => s.routeNumber && s.routeNumber !== '0')
      .map((s) => {
        // Merge visitHistory.js dates with the store's lastVisited from stores.csv
        const dates = new Set(visitHistoryData[s.id] || []);
        if (s.lastVisited) {
          const csvDate = toYMD(s.lastVisited);
          if (csvDate) dates.add(csvDate);
        }
        const history = [...dates].sort().reverse();
        const lastVisit = history[0] || null;
        const prevVisit = history[1] || null;
        const thirdVisit = history[2] || null;

        const daysSince = lastVisit ? getDaysBetween(today, lastVisit) : null;

        // Calculate intervals between visits
        const intervals = [];
        if (lastVisit && prevVisit) intervals.push(getDaysBetween(lastVisit, prevVisit));
        if (prevVisit && thirdVisit) intervals.push(getDaysBetween(prevVisit, thirdVisit));

        const isCash = isCashStop(s);
        const targetDays = isCash ? 14 : 7;
        const grade = getVisitGrade(daysSince, intervals, targetDays);
        const status = getRowStatus(daysSince, targetDays);
        const prefix = getStorePrefix(s.id);

        return {
          id: s.id,
          name: s.name,
          city: s.city || '',
          route: s.routeNumber,
          prefix,
          isCash,
          targetDays,
          lastVisit,
          prevVisit,
          thirdVisit,
          daysSince,
          intervals,
          grade,
          status,
          totalVisits: history.length,
          allDates: history,
        };
      });
  }, [stores, visitVersion]);

  // Visits on selected date
  const viewDateCount = useMemo(() => {
    if (!viewDate) return 0;
    return tableData.filter((row) => row.allDates.includes(viewDate)).length;
  }, [tableData, viewDate]);

  // Apply filters
  const filtered = useMemo(() => {
    const search = searchTerm.toLowerCase();
    return tableData.filter((row) => {
      if (viewDate && !row.allDates.includes(viewDate)) return false;
      if (filterRoute !== 'all' && row.route !== filterRoute) return false;
      if (filterStatus !== 'all' && row.status !== filterStatus) return false;
      if (filterType !== 'all' && row.prefix !== filterType) return false;
      if (search && !row.name.toLowerCase().includes(search) && !row.city.toLowerCase().includes(search) && !row.id.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [tableData, filterRoute, filterStatus, filterType, searchTerm, viewDate]);

  // Sort
  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'city': cmp = a.city.localeCompare(b.city); break;
        case 'route': cmp = Number(a.route) - Number(b.route); break;
        case 'type': cmp = a.prefix.localeCompare(b.prefix); break;
        case 'days': {
          const da = a.daysSince ?? 9999;
          const db = b.daysSince ?? 9999;
          cmp = da - db;
          break;
        }
        case 'grade': {
          const order = { A: 1, B: 2, C: 3, D: 4, F: 5 };
          cmp = (order[a.grade.letter] || 5) - (order[b.grade.letter] || 5);
          break;
        }
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortCol, sortDir]);

  // Summary stats
  const stats = useMemo(() => {
    const onTrack = tableData.filter((r) => r.status === 'ontrack').length;
    const missed = tableData.filter((r) => r.status === 'missed').length;
    const overdue = tableData.filter((r) => r.status === 'overdue').length;
    const never = tableData.filter((r) => r.status === 'never').length;

    // Overall grade: average scores excluding never-visited stores (may be seasonal)
    let overallGrade = { letter: '—', color: '#9ca3af', score: 0 };
    const gradedStores = tableData.filter((r) => r.status !== 'never');
    if (gradedStores.length > 0) {
      const avgScore = Math.round(gradedStores.reduce((sum, r) => sum + r.grade.score, 0) / gradedStores.length);
      if (avgScore >= 85) overallGrade = { letter: 'A', color: '#22c55e', score: avgScore };
      else if (avgScore >= 65) overallGrade = { letter: 'B', color: '#3b82f6', score: avgScore };
      else if (avgScore >= 45) overallGrade = { letter: 'C', color: '#eab308', score: avgScore };
      else if (avgScore >= 25) overallGrade = { letter: 'D', color: '#f97316', score: avgScore };
      else overallGrade = { letter: 'F', color: '#ef4444', score: avgScore };
    }

    return { total: tableData.length, onTrack, missed, overdue, never, overallGrade };
  }, [tableData]);

  // Chain type counts for quick filter buttons
  const chainCounts = useMemo(() => {
    const counts = {};
    tableData.forEach((r) => {
      counts[r.prefix] = (counts[r.prefix] || 0) + 1;
    });
    // Sort by count descending, keep top chains + always include CASH
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([prefix, count]) => ({ prefix, count, label: TYPE_LABELS[prefix] || prefix }));
  }, [tableData]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir(col === 'days' ? 'desc' : 'asc'); }
  }

  // Close PDF menu when clicking outside
  useEffect(() => {
    if (!pdfMenuOpen) return;
    const handleClick = (e) => {
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(e.target)) setPdfMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pdfMenuOpen]);

  const statusColor = (status) => {
    if (status === 'ontrack') return [34, 197, 94];
    if (status === 'missed') return [249, 115, 22];
    if (status === 'overdue') return [239, 68, 68];
    return [156, 163, 175];
  };

  const gradeColor = (letter) => {
    if (letter === 'A') return [34, 197, 94];
    if (letter === 'B') return [59, 130, 246];
    if (letter === 'C') return [234, 179, 8];
    if (letter === 'D') return [249, 115, 22];
    return [239, 68, 68];
  };

  const generatePDF = useCallback((mode) => {
    setPdfMenuOpen(false);
    let rows = [...sorted];
    let subtitle = '';
    let filenameSuffix = '';

    switch (mode) {
      case 'current':
        subtitle = 'Current View';
        break;
      case 'chain': {
        rows.sort((a, b) => {
          const cmp = a.prefix.localeCompare(b.prefix);
          if (cmp !== 0) return cmp;
          return (a.daysSince ?? 9999) - (b.daysSince ?? 9999);
        });
        subtitle = 'Grouped by Chain';
        filenameSuffix = '-by-chain';
        break;
      }
      case 'oldest': {
        rows.sort((a, b) => {
          const da = a.lastVisit || '';
          const db = b.lastVisit || '';
          if (!da && !db) return 0;
          if (!da) return -1;
          if (!db) return 1;
          return da.localeCompare(db);
        });
        subtitle = 'Oldest First';
        filenameSuffix = '-oldest';
        break;
      }
      case 'days': {
        rows.sort((a, b) => {
          const da = a.daysSince ?? 9999;
          const db = b.daysSince ?? 9999;
          return db - da;
        });
        subtitle = 'Most Days Since Visit';
        filenameSuffix = '-by-days';
        break;
      }
      case 'grade': {
        const order = { F: 1, D: 2, C: 3, B: 4, A: 5 };
        rows.sort((a, b) => (order[a.grade.letter] || 5) - (order[b.grade.letter] || 5));
        subtitle = 'Worst Grade First';
        filenameSuffix = '-by-grade';
        break;
      }
      case 'route': {
        rows.sort((a, b) => {
          const cmp = Number(a.route) - Number(b.route);
          if (cmp !== 0) return cmp;
          return (a.daysSince ?? 9999) - (b.daysSince ?? 9999);
        });
        subtitle = 'Grouped by Route';
        filenameSuffix = '-by-route';
        break;
      }
      default:
        subtitle = 'Current View';
    }

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    let title = 'Visit History';
    if (filterRoute !== 'all') title += ` — Route ${filterRoute}`;
    if (filterType !== 'all') title += ` (${TYPE_LABELS[filterType] || filterType})`;
    doc.text(title, pageWidth / 2, 15, { align: 'center' });

    // Subtitle
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const pdfStats = {
      onTrack: rows.filter(r => r.status === 'ontrack').length,
      missed: rows.filter(r => r.status === 'missed').length,
      overdue: rows.filter(r => r.status === 'overdue').length,
      never: rows.filter(r => r.status === 'never').length,
    };
    // Compute overall grade for PDF (exclude never-visited stores)
    let pdfGradeLetter = '—';
    const pdfGradedRows = rows.filter(r => r.status !== 'never');
    if (pdfGradedRows.length > 0) {
      const avg = Math.round(pdfGradedRows.reduce((s, r) => s + r.grade.score, 0) / pdfGradedRows.length);
      if (avg >= 85) pdfGradeLetter = 'A';
      else if (avg >= 65) pdfGradeLetter = 'B';
      else if (avg >= 45) pdfGradeLetter = 'C';
      else if (avg >= 25) pdfGradeLetter = 'D';
      else pdfGradeLetter = 'F';
    }
    doc.text(
      `${subtitle} | ${rows.length} stores | Grade: ${pdfGradeLetter} | On Track: ${pdfStats.onTrack} | Missed: ${pdfStats.missed} | Overdue: ${pdfStats.overdue} | Never: ${pdfStats.never} | ${today}`,
      pageWidth / 2, 21, { align: 'center' }
    );

    // Build table — insert chain/route group headers if grouped
    const isGrouped = mode === 'chain' || mode === 'route';
    const tableRows = [];
    const rowRef = []; // parallel array tracking source row for coloring
    let lastGroup = null;

    rows.forEach((row, i) => {
      const groupKey = mode === 'chain' ? (TYPE_LABELS[row.prefix] || row.prefix)
        : mode === 'route' ? `Route ${row.route}`
        : null;
      if (isGrouped && groupKey !== lastGroup) {
        tableRows.push([{ content: groupKey, colSpan: 10, styles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 8, textColor: [30, 58, 95] } }]);
        rowRef.push(null);
        lastGroup = groupKey;
      }
      tableRows.push([
        tableRows.filter(r => rowRef[tableRows.indexOf(r)] !== null).length > 0
          ? rowRef.filter(r => r !== null).length + 1 : 1,
        row.id,
        row.name,
        row.city,
        row.route,
        TYPE_LABELS[row.prefix] || row.prefix,
        row.lastVisit ? formatShortDate(row.lastVisit) : '—',
        row.daysSince !== null ? `${row.daysSince}d` : '—',
        row.prevVisit ? formatShortDate(row.prevVisit) : '—',
        row.grade.letter,
      ]);
      rowRef.push(row);
    });

    // Simpler numbering — recalculate row numbers
    let num = 0;
    for (let i = 0; i < tableRows.length; i++) {
      if (rowRef[i] === null) continue; // group header
      num++;
      tableRows[i][0] = num;
    }

    autoTable(doc, {
      startY: 26,
      head: [['#', 'Store ID', 'Store Name', 'City', 'Rte', 'Type', 'Last Visit', 'Days', 'Prev Visit', 'Grade']],
      body: tableRows,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 22 },
        2: { cellWidth: 45 },
        3: { cellWidth: 30 },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 24 },
        6: { cellWidth: 22 },
        7: { cellWidth: 14, halign: 'center' },
        8: { cellWidth: 22 },
        9: { cellWidth: 14, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: function (data) {
        if (data.section === 'body') {
          const row = rowRef[data.row.index];
          if (!row) return; // group header row
          if (data.column.index === 7) {
            data.cell.styles.textColor = statusColor(row.status);
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.column.index === 9) {
            data.cell.styles.textColor = gradeColor(row.grade.letter);
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    let filename = 'visit-history';
    if (filterRoute !== 'all') filename += `-route-${filterRoute}`;
    if (filterType !== 'all') filename += `-${filterType}`;
    filename += filenameSuffix + '.pdf';
    doc.save(filename);
  }, [sorted, filterRoute, filterType]);

  const SortArrow = ({ col }) => {
    if (sortCol !== col) return <span className="vh2-sort-arrow inactive">&#8597;</span>;
    return <span className="vh2-sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="vh2">
      <div className="vh2-header">
        <div className="vh2-title-row">
          <h2>Visit History</h2>
          <div className="vh2-stats">
            <div className="vh2-stat green">{stats.onTrack}<span>on track</span></div>
            <div className="vh2-stat orange">{stats.missed}<span>missed</span></div>
            <div className="vh2-stat red">{stats.overdue}<span>overdue</span></div>
            <div className="vh2-stat gray">{stats.never}<span>never</span></div>
            <div className="vh2-overall-grade" style={{ background: stats.overallGrade.color + '18', borderColor: stats.overallGrade.color + '40' }}>
              <span className="vh2-overall-letter" style={{ color: stats.overallGrade.color }}>{stats.overallGrade.letter}</span>
              <span className="vh2-overall-label">overall</span>
            </div>
          </div>
          <div className="vh2-pdf-wrap" ref={pdfMenuRef}>
            <button className="vh2-pdf-btn" onClick={() => setPdfMenuOpen(!pdfMenuOpen)}>
              Export PDF <span className="vh2-pdf-arrow">{pdfMenuOpen ? '\u25B2' : '\u25BC'}</span>
            </button>
            {pdfMenuOpen && (
              <div className="vh2-pdf-menu">
                <button onClick={() => generatePDF('current')}>Current View</button>
                <button onClick={() => generatePDF('chain')}>Group by Chain</button>
                <button onClick={() => generatePDF('route')}>Group by Route</button>
                <button onClick={() => generatePDF('days')}>Most Days Since</button>
                <button onClick={() => generatePDF('oldest')}>Oldest Visit First</button>
                <button onClick={() => generatePDF('grade')}>Worst Grade First</button>
              </div>
            )}
          </div>
        </div>

        <div className="vh2-filters">
          <div className="vh2-filter-group">
            <span className="vh2-filter-label">Status</span>
            {[
              { key: 'all', label: 'All', count: stats.total },
              { key: 'ontrack', label: 'On Track', count: stats.onTrack },
              { key: 'missed', label: 'Missed', count: stats.missed },
              { key: 'overdue', label: 'Overdue', count: stats.overdue },
              { key: 'never', label: 'Never', count: stats.never },
            ].map((f) => (
              <button
                key={f.key}
                className={`vh2-filter-btn ${filterStatus === f.key ? 'active' : ''} ${f.key}`}
                onClick={() => setFilterStatus(f.key)}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          <div className="vh2-filter-group">
            <span className="vh2-filter-label">Chain</span>
            <button
              className={`vh2-chain-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
              style={filterType === 'all' ? { background: 'var(--primary)', color: 'white', borderColor: 'var(--primary)' } : {}}
            >All</button>
            {chainCounts.map(({ prefix, count, label }) => (
              <button
                key={prefix}
                className={`vh2-chain-btn ${filterType === prefix ? 'active' : ''}`}
                onClick={() => setFilterType(filterType === prefix ? 'all' : prefix)}
                style={filterType === prefix
                  ? { background: TYPE_COLORS[prefix] || '#64748b', color: 'white', borderColor: TYPE_COLORS[prefix] || '#64748b' }
                  : { color: TYPE_COLORS[prefix] || '#64748b', borderColor: (TYPE_COLORS[prefix] || '#64748b') + '40' }}
              >
                {label} <span className="vh2-chain-count">{count}</span>
              </button>
            ))}
          </div>

          <div className="vh2-filter-row">
            <select className="vh2-select" value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)}>
              <option value="all">All Routes</option>
              {routes.map((r) => <option key={r} value={r}>Route {r}</option>)}
            </select>
            <input
              type="text"
              className="vh2-search"
              placeholder="Search name, city, ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="vh2-date-picker">
              <label className="vh2-filter-label" style={{ marginRight: 4 }}>View date</label>
              <input
                type="date"
                className="vh2-date-input"
                value={viewDate}
                onChange={(e) => setViewDate(e.target.value)}
              />
              {viewDate && (
                <>
                  <span className="vh2-date-count">{viewDateCount} visited</span>
                  <button className="vh2-date-clear" onClick={() => setViewDate('')}>&times;</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="vh2-scale-bar">
        <span className="vh2-scale-label">Table width</span>
        {[50, 75, 85, 100].map((pct) => (
          <button
            key={pct}
            className={`vh2-scale-btn ${tableScale === pct ? 'active' : ''}`}
            onClick={() => applyScale(pct)}
          >
            {pct}%
          </button>
        ))}
        <button className="vh2-scale-btn fill" onClick={() => {
          if (!tableWrapRef.current) return;
          const wrapW = tableWrapRef.current.clientWidth - 2;
          const baseTotal = Object.values(defaultWidths).reduce((a, b) => a + b, 0);
          const pct = Math.round((wrapW / baseTotal) * 100);
          applyScale(pct);
        }}>Fill</button>
        <button className="vh2-scale-btn" onClick={() => applyScale(100)}>Reset</button>
      </div>

      <div className="vh2-table-wrap" ref={tableWrapRef}>
        <table className="vh2-table" style={{ tableLayout: 'fixed', width: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: colWidths.status }} />
            <col style={{ width: colWidths.name }} />
            <col style={{ width: colWidths.city }} />
            <col style={{ width: colWidths.route }} />
            <col style={{ width: colWidths.type }} />
            <col style={{ width: colWidths.lastVisit }} />
            <col style={{ width: colWidths.days }} />
            <col style={{ width: colWidths.prevVisit }} />
            <col style={{ width: colWidths.thirdVisit }} />
            <col style={{ width: colWidths.grade }} />
            <col style={{ width: colWidths.actions }} />
          </colgroup>
          <thead>
            <tr>
              <th className="vh2-th-status"></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('name')}>Store <SortArrow col="name" /><span className="vh2-resize" onMouseDown={(e) => onResizeStart('name', e)}></span></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('city')}>City <SortArrow col="city" /><span className="vh2-resize" onMouseDown={(e) => onResizeStart('city', e)}></span></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('route')}>Rte <SortArrow col="route" /><span className="vh2-resize" onMouseDown={(e) => onResizeStart('route', e)}></span></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('type')}>Type <SortArrow col="type" /><span className="vh2-resize" onMouseDown={(e) => onResizeStart('type', e)}></span></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('days')}>Last Visit <SortArrow col="days" /><span className="vh2-resize" onMouseDown={(e) => onResizeStart('lastVisit', e)}></span></th>
              <th>Days<span className="vh2-resize" onMouseDown={(e) => onResizeStart('days', e)}></span></th>
              <th>Prev Visit<span className="vh2-resize" onMouseDown={(e) => onResizeStart('prevVisit', e)}></span></th>
              <th>3rd Visit<span className="vh2-resize" onMouseDown={(e) => onResizeStart('thirdVisit', e)}></span></th>
              <th className="vh2-th-sortable" onClick={() => handleSort('grade')}>Grade <SortArrow col="grade" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => {
              const rowClass = `vh2-row vh2-row-${row.status} ${idx % 2 === 0 ? 'even' : 'odd'}`;
              return (
                <tr key={row.id} className={rowClass}>
                  <td className="vh2-td-status">
                    <span className="vh2-status-dot" style={{
                      background: row.status === 'ontrack' ? '#22c55e'
                        : row.status === 'missed' ? '#f97316'
                        : row.status === 'overdue' ? '#ef4444'
                        : '#9ca3af'
                    }}></span>
                  </td>
                  <td className="vh2-td-name" title={row.id}>{row.name}</td>
                  <td className="vh2-td-city">{row.city}</td>
                  <td className="vh2-td-route">{row.route}</td>
                  <td className="vh2-td-type">
                    <span className="vh2-type-badge" style={{ background: (TYPE_COLORS[row.prefix] || '#64748b') + '20', color: TYPE_COLORS[row.prefix] || '#64748b' }}>
                      {row.prefix}
                    </span>
                  </td>
                  <td className="vh2-td-date">{formatShortDate(row.lastVisit)}</td>
                  <td className="vh2-td-days" style={{ color: row.status === 'ontrack' ? '#22c55e' : row.status === 'missed' ? '#f97316' : row.status === 'overdue' ? '#ef4444' : '#9ca3af' }}>
                    {row.daysSince !== null ? `${row.daysSince}d` : '—'}
                  </td>
                  <td className="vh2-td-date">{formatShortDate(row.prevVisit)}</td>
                  <td className="vh2-td-date">{formatShortDate(row.thirdVisit)}</td>
                  <td className="vh2-td-grade">
                    <span className="vh2-grade-badge" style={{ background: row.grade.color + '20', color: row.grade.color }}>
                      {row.grade.letter}
                    </span>
                  </td>
                  <td className="vh2-td-actions">
                    <button
                      className={`vh2-add-visit-btn ${editingId === row.id ? 'active' : ''}`}
                      title="Add visit date"
                      onClick={(e) => editingId === row.id ? closeEdit() : openEdit(row.id, e)}
                    >+</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="vh2-empty">No stores match your filters</div>
        )}
      </div>
      <div className="vh2-footer">
        Showing {sorted.length} of {tableData.length} stores
        {' '}| Regular stores: 7-day cycle | CASH stops: 14-day cycle
      </div>

      {editingId && editPos && (
        <>
          <div className="vh2-edit-backdrop" onClick={closeEdit}></div>
          <div className="vh2-edit-popup" style={{ top: editPos.top, left: Math.max(8, editPos.left) }}>
            <div className="vh2-edit-popup-label">Add visit for: <strong>{stores.find(s => s.id === editingId)?.name || editingId}</strong></div>
            <div className="vh2-edit-popup-row">
              <input
                ref={editDateRef}
                type="date"
                className="vh2-edit-date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
              <button className="vh2-edit-save" onClick={() => handleAddVisit(editingId)} disabled={!editDate}>Save</button>
              <button className="vh2-edit-cancel" onClick={closeEdit}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

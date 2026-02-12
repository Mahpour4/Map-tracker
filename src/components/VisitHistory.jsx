import { useMemo, useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import visitHistoryData from '../data/visitHistory';

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

function getVisitGrade(daysSince, intervals, targetDays) {
  if (daysSince === null) return { letter: 'F', color: '#9ca3af', label: 'Never' };

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

  if (avg >= 85) return { letter: 'A', color: '#22c55e', label: 'A' };
  if (avg >= 65) return { letter: 'B', color: '#3b82f6', label: 'B' };
  if (avg >= 45) return { letter: 'C', color: '#eab308', label: 'C' };
  if (avg >= 25) return { letter: 'D', color: '#f97316', label: 'D' };
  return { letter: 'F', color: '#ef4444', label: 'F' };
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
  CASH: 'Cash Stop', SV: 'SV', MISC: 'Misc',
};

export default function VisitHistory() {
  const { state } = useApp();
  const { stores } = state;
  const [filterRoute, setFilterRoute] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState('days');
  const [sortDir, setSortDir] = useState('desc');

  // Column resizing
  const defaultWidths = { status: 24, name: 180, city: 110, route: 44, type: 52, lastVisit: 74, days: 44, prevVisit: 74, thirdVisit: 74, grade: 48 };
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
        const history = (visitHistoryData[s.id] || []).slice().sort().reverse();
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
        };
      });
  }, [stores]);

  // Apply filters
  const filtered = useMemo(() => {
    const search = searchTerm.toLowerCase();
    return tableData.filter((row) => {
      if (filterRoute !== 'all' && row.route !== filterRoute) return false;
      if (filterStatus !== 'all' && row.status !== filterStatus) return false;
      if (filterType !== 'all' && row.prefix !== filterType) return false;
      if (search && !row.name.toLowerCase().includes(search) && !row.city.toLowerCase().includes(search) && !row.id.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [tableData, filterRoute, filterStatus, filterType, searchTerm]);

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
    return { total: tableData.length, onTrack, missed, overdue, never };
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
    </div>
  );
}

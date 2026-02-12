import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import visitHistoryData from '../data/visitHistory';

function getMonthDays(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

function formatDate(year, month, day) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function VisitHistory() {
  const { state } = useApp();
  const { stores } = state;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [filterRoute, setFilterRoute] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Build store lookup by ID
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [stores]);

  // Get all routes for the filter dropdown
  const routes = useMemo(() => {
    const set = new Set();
    stores.forEach((s) => {
      if (s.routeNumber && s.routeNumber !== '0') set.add(s.routeNumber);
    });
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [stores]);

  // Filter visit history for the selected month
  const monthData = useMemo(() => {
    const daysInMonth = getMonthDays(year, month);
    const dayMap = {}; // day number → [{ storeId, storeName, routeNumber }]
    const storeVisitsThisMonth = {}; // storeId → [day numbers]

    Object.entries(visitHistoryData).forEach(([storeId, dates]) => {
      dates.forEach((dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        if (y === year && m - 1 === month) {
          const dayNum = d;
          if (!dayMap[dayNum]) dayMap[dayNum] = [];
          const store = storeMap[storeId];
          dayMap[dayNum].push({
            storeId,
            storeName: store ? store.name : storeId,
            routeNumber: store ? store.routeNumber : '?',
          });
          if (!storeVisitsThisMonth[storeId]) storeVisitsThisMonth[storeId] = [];
          storeVisitsThisMonth[storeId].push(dayNum);
        }
      });
    });

    return { dayMap, storeVisitsThisMonth, daysInMonth };
  }, [year, month, storeMap]);

  // Stores grouped by route for the month, applying filters
  const routeGroups = useMemo(() => {
    const groups = {};
    const search = searchTerm.toLowerCase();

    Object.entries(monthData.storeVisitsThisMonth).forEach(([storeId, days]) => {
      const store = storeMap[storeId];
      const routeNum = store ? store.routeNumber : '0';
      const name = store ? store.name : storeId;

      if (filterRoute !== 'all' && routeNum !== filterRoute) return;
      if (search && !name.toLowerCase().includes(search) && !storeId.toLowerCase().includes(search)) return;

      if (!groups[routeNum]) groups[routeNum] = [];
      groups[routeNum].push({
        storeId,
        name,
        routeNumber: routeNum,
        days: days.sort((a, b) => a - b),
      });
    });

    // Sort stores within each route by name
    Object.values(groups).forEach((g) => g.sort((a, b) => a.name.localeCompare(b.name)));

    return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b));
  }, [monthData, storeMap, filterRoute, searchTerm]);

  // Summary stats
  const stats = useMemo(() => {
    const uniqueStores = Object.keys(monthData.storeVisitsThisMonth).length;
    let totalVisits = 0;
    Object.values(monthData.storeVisitsThisMonth).forEach((days) => {
      totalVisits += days.length;
    });
    const routesCovered = new Set();
    Object.keys(monthData.storeVisitsThisMonth).forEach((storeId) => {
      const store = storeMap[storeId];
      if (store && store.routeNumber && store.routeNumber !== '0') {
        routesCovered.add(store.routeNumber);
      }
    });
    return { uniqueStores, totalVisits, routesCovered: routesCovered.size };
  }, [monthData, storeMap]);

  // Stores visited on selected day
  const selectedDayStores = useMemo(() => {
    if (!selectedDay) return [];
    const entries = monthData.dayMap[selectedDay] || [];
    const filtered = entries.filter((e) => {
      if (filterRoute !== 'all' && e.routeNumber !== filterRoute) return false;
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        if (!e.storeName.toLowerCase().includes(search) && !e.storeId.toLowerCase().includes(search)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [selectedDay, monthData, filterRoute, searchTerm]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
    setSelectedDay(null);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
    setSelectedDay(null);
  }

  // Calendar rendering
  const firstDay = getFirstDayOfWeek(year, month);
  const daysInMonth = monthData.daysInMonth;
  const calendarCells = [];

  for (let i = 0; i < firstDay; i++) {
    calendarCells.push({ day: null, count: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const visits = monthData.dayMap[d] || [];
    calendarCells.push({ day: d, count: visits.length });
  }

  const maxCount = Math.max(1, ...calendarCells.map((c) => c.count));

  return (
    <div className="visit-history">
      <div className="vh-header">
        <div className="vh-title-row">
          <h2>Visit History</h2>
          <div className="vh-stats">
            <div className="vh-stat">
              <span className="vh-stat-num">{stats.uniqueStores}</span>
              <span className="vh-stat-label">Stores</span>
            </div>
            <div className="vh-stat">
              <span className="vh-stat-num">{stats.totalVisits}</span>
              <span className="vh-stat-label">Visits</span>
            </div>
            <div className="vh-stat">
              <span className="vh-stat-num">{stats.routesCovered}</span>
              <span className="vh-stat-label">Routes</span>
            </div>
          </div>
        </div>
        <div className="vh-controls">
          <div className="vh-month-nav">
            <button className="vh-nav-btn" onClick={prevMonth}>&laquo;</button>
            <span className="vh-month-label">{monthNames[month]} {year}</span>
            <button className="vh-nav-btn" onClick={nextMonth}>&raquo;</button>
          </div>
          <div className="vh-filters">
            <select
              className="vh-select"
              value={filterRoute}
              onChange={(e) => setFilterRoute(e.target.value)}
            >
              <option value="all">All Routes</option>
              {routes.map((r) => (
                <option key={r} value={r}>Route {r}</option>
              ))}
            </select>
            <input
              type="text"
              className="vh-search"
              placeholder="Search stores..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="vh-body">
        <div className="vh-calendar-section">
          <div className="vh-calendar">
            <div className="vh-cal-header">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="vh-cal-day-name">{d}</div>
              ))}
            </div>
            <div className="vh-cal-grid">
              {calendarCells.map((cell, i) => {
                if (cell.day === null) {
                  return <div key={`empty-${i}`} className="vh-cal-cell empty"></div>;
                }
                const intensity = cell.count > 0 ? Math.max(0.15, cell.count / maxCount) : 0;
                const isSelected = selectedDay === cell.day;
                const isToday = cell.day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
                return (
                  <div
                    key={cell.day}
                    className={`vh-cal-cell ${cell.count > 0 ? 'has-visits' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                    onClick={() => cell.count > 0 && setSelectedDay(isSelected ? null : cell.day)}
                    style={cell.count > 0 ? { '--visit-intensity': intensity } : {}}
                  >
                    <span className="vh-cal-date">{cell.day}</span>
                    {cell.count > 0 && (
                      <span className="vh-cal-count">{cell.count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedDay && (
            <div className="vh-day-detail">
              <h3>
                {monthNames[month]} {selectedDay} — {selectedDayStores.length} visit{selectedDayStores.length !== 1 ? 's' : ''}
              </h3>
              <div className="vh-day-list">
                {selectedDayStores.map((s) => (
                  <div key={s.storeId} className="vh-day-item">
                    <span className="vh-day-route">R{s.routeNumber}</span>
                    <span className="vh-day-store">{s.storeName}</span>
                    <span className="vh-day-id">{s.storeId}</span>
                  </div>
                ))}
                {selectedDayStores.length === 0 && (
                  <div className="vh-empty">No visits match your filters</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="vh-routes-section">
          <h3 className="vh-routes-title">
            Visits by Route — {monthNames[month]} {year}
          </h3>
          {routeGroups.length === 0 && (
            <div className="vh-empty">No visits recorded this month{filterRoute !== 'all' ? ' for this route' : ''}</div>
          )}
          {routeGroups.map(([route, storeEntries]) => (
            <div key={route} className="vh-route-group">
              <div className="vh-route-header">
                <span className="vh-route-name">Route {route}</span>
                <span className="vh-route-count">
                  {storeEntries.length} store{storeEntries.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="vh-route-stores">
                {storeEntries.map((entry) => (
                  <div key={entry.storeId} className="vh-store-row">
                    <span className="vh-store-name">{entry.name}</span>
                    <span className="vh-store-dates">
                      {entry.days.map((d) => (
                        <span
                          key={d}
                          className={`vh-date-chip ${selectedDay === d ? 'active' : ''}`}
                          onClick={() => setSelectedDay(selectedDay === d ? null : d)}
                        >
                          {d}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

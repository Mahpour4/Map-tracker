import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  computeDriverScore,
  getTodaySchedule,
  getScheduleDeviation,
  getScheduleAdherence,
  getWeeklyTrend,
  getGrade,
  getLatestDate,
  getDaysSinceVisit,
  getDaysBetween,
  getMonday,
  getDayDate,
  localDateStr,
  DAYS,
} from '../utils/driverMetrics';

const SUB_SCORE_LABELS = {
  scheduleAdherence: 'Schedule Adherence',
  storeCoverage: 'Store Coverage',
  alertResponse: 'Alert Response',
  efficiency: 'Efficiency',
};

export default function DriverDashboard() {
  const { state } = useApp();
  const { stores, travelLog, visitHistory, schedules, alerts, fleetVehicles, vehicleLocations } = state;
  const [selectedRoute, setSelectedRoute] = useState('');

  // Available routes (sorted numerically)
  const routes = useMemo(() => {
    const set = new Set();
    stores.forEach(s => {
      if (s.routeNumber && s.routeNumber !== '0') set.add(s.routeNumber);
    });
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [stores]);

  // Current driver info from live data or static fleet
  const driverInfo = useMemo(() => {
    const source = vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles;
    return source.find(v => v.routeNumber === selectedRoute) || null;
  }, [selectedRoute, vehicleLocations, fleetVehicles]);

  const driverName = driverInfo?.driverName || null;

  // Composite performance score
  const score = useMemo(() => {
    if (!selectedRoute) return null;
    return computeDriverScore(selectedRoute, { stores, travelLog, visitHistory, schedules, alerts, fleetVehicles });
  }, [selectedRoute, stores, travelLog, visitHistory, schedules, alerts, fleetVehicles]);

  // Today's schedule and progress
  const todaySchedule = useMemo(() => {
    if (!selectedRoute) return null;
    return getTodaySchedule(schedules, selectedRoute);
  }, [selectedRoute, schedules]);

  const todayProgress = useMemo(() => {
    if (!todaySchedule || !driverInfo) return null;
    return getScheduleDeviation(driverInfo, todaySchedule, travelLog, stores);
  }, [todaySchedule, driverInfo, travelLog, stores]);

  // This week's schedule with per-stop compliance
  const weekSchedule = useMemo(() => {
    if (!selectedRoute) return null;
    const weekOf = getMonday(new Date());
    const key = `${selectedRoute}_${weekOf}`;
    const sched = schedules[key];
    if (!sched) return null;

    const today = localDateStr();
    const storeMap = {};
    stores.forEach(s => { storeMap[s.id] = s; });

    return DAYS.map(day => {
      const stops = sched[day] || [];
      const scheduledDate = getDayDate(weekOf, day);
      const isFuture = scheduledDate > today;
      return {
        day,
        scheduledDate,
        isFuture,
        stops: stops.map(stop => {
          const visits = (visitHistory[stop.storeId] || []).map(e => typeof e === 'string' ? e : e.date);
          const weekEnd = getDayDate(weekOf, 'friday');
          const visitedExact = visits.includes(scheduledDate);
          const visitedSameWeek = !visitedExact && visits.some(v => v >= weekOf && v <= weekEnd);
          const store = storeMap[stop.storeId];
          return {
            ...stop,
            storeName: store?.name || stop.storeId,
            visitedExact,
            visitedSameWeek,
            missed: !isFuture && !visitedExact && !visitedSameWeek,
            isFuture,
          };
        }),
      };
    });
  }, [selectedRoute, schedules, visitHistory, stores]);

  // 4-week trend
  const trend = useMemo(() => {
    if (!selectedRoute) return [];
    return getWeeklyTrend(selectedRoute, { schedules, visitHistory, weekCount: 4 });
  }, [selectedRoute, schedules, visitHistory]);

  // Recent activity (last 7 calendar days)
  const recentActivity = useMemo(() => {
    if (!driverInfo) return [];
    const vin = driverInfo.vin;
    const result = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = localDateStr(d);
      const entries = (travelLog[dateKey] || {})[vin] || [];
      if (entries.length === 0) continue;
      let storeCount = 0, warehouseCount = 0, customCount = 0, totalMiles = 0;
      entries.forEach(e => {
        if (e.type === 'store') storeCount++;
        else if (e.type === 'warehouse') warehouseCount++;
        else if (e.type === 'custom') customCount++;
        if (e.distance) totalMiles += e.distance;
      });
      result.push({ date: dateKey, storeCount, warehouseCount, customCount, totalMiles: Math.round(totalMiles), entryCount: entries.length });
    }
    return result;
  }, [driverInfo, travelLog]);

  // Route alerts
  const routeAlerts = useMemo(() => {
    if (!selectedRoute) return [];
    return alerts.filter(a => a.routeNumber === selectedRoute);
  }, [alerts, selectedRoute]);

  // Route stores for alert resolution checking
  const routeStoreMap = useMemo(() => {
    const map = {};
    stores.filter(s => s.routeNumber === selectedRoute).forEach(s => { map[s.id] = s; });
    return map;
  }, [stores, selectedRoute]);

  if (!selectedRoute) {
    return (
      <div className="dd-page">
        <p className="dd-caption">Tracks driver performance by route — scores schedule adherence, store coverage, alert response, and efficiency. Select a route to see today's stop progress, weekly compliance, and visit trends.</p>
        <div className="dd-header">
          <h2>Driver Dashboard</h2>
          <select className="dd-route-select" value="" onChange={e => setSelectedRoute(e.target.value)}>
            <option value="">Select a route / driver...</option>
            {routes.map(r => {
              const v = (vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles).find(fv => fv.routeNumber === r);
              return <option key={r} value={r}>Route {r}{v?.driverName ? ` — ${v.driverName}` : ''}</option>;
            })}
          </select>
        </div>
        <div className="dd-empty">Select a route to view driver performance metrics.</div>
      </div>
    );
  }

  return (
    <div className="dd-page">
      <p className="dd-caption">Tracks driver performance by route — scores schedule adherence, store coverage, alert response, and efficiency. Select a route to see today's stop progress, weekly compliance, and visit trends.</p>
      {/* Header */}
      <div className="dd-header">
        <h2>Driver Dashboard</h2>
        <select className="dd-route-select" value={selectedRoute} onChange={e => setSelectedRoute(e.target.value)}>
          <option value="">Select a route / driver...</option>
          {routes.map(r => {
            const v = (vehicleLocations.length > 0 ? vehicleLocations : fleetVehicles).find(fv => fv.routeNumber === r);
            return <option key={r} value={r}>Route {r}{v?.driverName ? ` — ${v.driverName}` : ''}</option>;
          })}
        </select>
      </div>

      {/* Driver info bar */}
      <div className="dd-driver-info">
        <span className="dd-driver-name">{driverName || driverInfo?.vehicleId || `Route ${selectedRoute}`}</span>
        <span className="dd-driver-vehicle">{driverInfo?.vehicleId || '--'}</span>
        <span className="dd-driver-plate">{driverInfo?.licensePlate || '--'}</span>
        {driverInfo?.engineStatus && (
          <span className={`ft-engine-badge ${driverInfo.engineStatus}`}>{driverInfo.engineStatus}</span>
        )}
      </div>

      {/* Score Card */}
      {score && (
        <div className="dd-score-card">
          <div className="dd-grade-circle" style={{ background: score.grade.color }}>
            <span className="dd-grade-letter">{score.grade.letter}</span>
            <span className="dd-grade-number">{score.overall}</span>
          </div>
          <div className="dd-sub-scores">
            {Object.entries(score.breakdown).map(([key, sub]) => {
              const subGrade = sub.score !== null ? getGrade(sub.score) : { color: '#9ca3af' };
              return (
                <div key={key} className="dd-sub-score">
                  <span className="dd-sub-label">{SUB_SCORE_LABELS[key]}</span>
                  <div className="dd-sub-bar-track">
                    <div
                      className="dd-sub-bar-fill"
                      style={{ width: `${sub.score ?? 0}%`, background: subGrade.color }}
                    />
                  </div>
                  <span className="dd-sub-value">{sub.score !== null ? sub.score : 'N/A'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's Progress */}
      <div className="dd-section">
        <h3>Today's Progress</h3>
        {todayProgress ? (
          <div className="dd-today">
            <div className="dd-today-bar-track">
              <div
                className="dd-today-bar-fill"
                style={{
                  width: `${todayProgress.detail ? (todayProgress.detail.completedCount / todayProgress.detail.totalScheduled * 100) : 0}%`,
                  background: todayProgress.status === 'on-track' ? '#22c55e' : '#ef4444',
                }}
              />
            </div>
            <span className={`dd-today-status dd-status-${todayProgress.status}`}>
              {todayProgress.message}
            </span>
            {todayProgress.detail && (
              <span className="dd-today-detail">
                Expected ~{todayProgress.detail.expectedCompleted} by now
              </span>
            )}
          </div>
        ) : (
          <div className="dd-muted">{new Date().getDay() === 0 || new Date().getDay() === 6 ? 'Weekend — no schedule' : 'No schedule for today'}</div>
        )}
      </div>

      {/* This Week Schedule */}
      <div className="dd-section">
        <h3>This Week</h3>
        {weekSchedule ? (
          <div className="dd-week-grid">
            {weekSchedule.map(({ day, stops, isFuture, scheduledDate }) => (
              <div key={day} className={`dd-week-day ${isFuture ? 'dd-week-future' : ''}`}>
                <div className="dd-week-day-label">
                  {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                  <span className="dd-week-day-date">{scheduledDate.slice(5)}</span>
                </div>
                <div className="dd-week-stops">
                  {stops.length === 0 ? (
                    <span className="dd-muted-sm">--</span>
                  ) : stops.map((s, i) => (
                    <div
                      key={i}
                      className={`dd-week-stop ${s.visitedExact ? 'exact' : s.visitedSameWeek ? 'same-week' : s.missed ? 'missed' : 'future'}`}
                      title={`${s.storeName}${s.visitedExact ? ' (on time)' : s.visitedSameWeek ? ' (same week)' : s.missed ? ' (missed)' : ' (upcoming)'}`}
                    >
                      <span className="dd-week-stop-dot" />
                    </div>
                  ))}
                </div>
                <div className="dd-week-summary">
                  {stops.length > 0 && (
                    <>
                      <span className="dd-week-done">{stops.filter(s => s.visitedExact || s.visitedSameWeek).length}</span>
                      /{stops.length}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dd-muted">No schedule for this week</div>
        )}
      </div>

      {/* 4-Week Trend */}
      <div className="dd-section">
        <h3>4-Week Trend</h3>
        {trend.length > 0 && trend.some(t => t.adherence !== null) ? (
          <div className="dd-trend">
            {trend.map(t => {
              const pct = t.adherence ?? 0;
              const hasData = t.adherence !== null;
              const gr = hasData ? getGrade(pct) : { color: '#d1d5db' };
              return (
                <div key={t.weekOf} className="dd-trend-bar-col">
                  <div className="dd-trend-bar-track">
                    <div
                      className="dd-trend-bar-fill"
                      style={{ height: `${pct}%`, background: hasData ? gr.color : '#e5e7eb' }}
                    />
                  </div>
                  <span className="dd-trend-pct">{hasData ? `${pct}%` : '--'}</span>
                  <span className="dd-trend-week">{t.weekOf.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dd-muted">No schedule history to display</div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="dd-section">
        <h3>Recent Activity</h3>
        {recentActivity.length > 0 ? (
          <div className="dd-activity-list">
            {recentActivity.map(a => (
              <div key={a.date} className="dd-activity-row">
                <span className="dd-activity-date">{a.date}</span>
                <span className="dd-activity-stores">{a.storeCount} stores</span>
                {a.warehouseCount > 0 && <span className="dd-activity-wh">{a.warehouseCount} wh</span>}
                {a.totalMiles > 0 && <span className="dd-activity-miles">{a.totalMiles} mi</span>}
                <span className="dd-activity-total">{a.entryCount} entries</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="dd-muted">No travel log data for this vehicle</div>
        )}
      </div>

      {/* Route Alerts */}
      <div className="dd-section">
        <h3>Service Alerts ({routeAlerts.length})</h3>
        {routeAlerts.length > 0 ? (
          <div className="dd-alerts-list">
            {routeAlerts.map((a, i) => {
              const store = routeStoreMap[a.storeId];
              const lv = store ? (getLatestDate(store) || '').split('T')[0].split(' ')[0] : null;
              const resolved = lv && a.dateReceived && lv >= a.dateReceived;
              const responseDays = resolved ? getDaysBetween(a.dateReceived, lv) : null;
              const daysPending = !resolved && a.dateReceived ? getDaysBetween(a.dateReceived, localDateStr()) : null;
              return (
                <div key={i} className={`dd-alert-row ${resolved ? 'dd-alert-resolved' : 'dd-alert-open'}`}>
                  <span className="dd-alert-icon">{resolved ? '+' : '!'}</span>
                  <span className="dd-alert-store">{store?.name || a.storeId}</span>
                  {resolved ? (
                    <span className="dd-alert-status">resolved{responseDays !== null ? ` in ${responseDays}d` : ''}</span>
                  ) : (
                    <span className="dd-alert-status">{daysPending !== null ? `${daysPending}d pending` : 'open'}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dd-muted">No service alerts for this route</div>
        )}
      </div>
    </div>
  );
}

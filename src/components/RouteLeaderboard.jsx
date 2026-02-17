import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

function isCashStop(store) {
  return store.id.toLowerCase().startsWith('cash');
}

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const visited = new Date(lastVisited);
  if (isNaN(visited.getTime())) return null;
  const now = new Date();
  return Math.floor((now - visited) / (1000 * 60 * 60 * 24));
}

function getGrade(pct) {
  if (pct >= 90) return { letter: 'A', color: '#22c55e' };
  if (pct >= 75) return { letter: 'B', color: '#3b82f6' };
  if (pct >= 55) return { letter: 'C', color: '#eab308' };
  if (pct >= 30) return { letter: 'D', color: '#f97316' };
  return { letter: 'F', color: '#ef4444' };
}

function getStatusCounts(stores) {
  const counts = { onTrack: 0, overdue1: 0, overdue2: 0, critical: 0, never: 0 };
  stores.forEach((s) => {
    const days = getDaysSinceVisit(s.lastVisited);
    if (days === null) counts.never++;
    else if (days <= 7) counts.onTrack++;
    else if (days <= 14) counts.overdue1++;
    else if (days <= 30) counts.overdue2++;
    else counts.critical++;
  });
  return counts;
}

function getDaysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_OFFSETS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function getDayDate(weekOf, day) {
  const d = new Date(weekOf + 'T00:00:00');
  d.setDate(d.getDate() + DAY_OFFSETS[day]);
  return d.toISOString().split('T')[0];
}

function getScheduleAdherence(schedules, route, visitHistoryMap) {
  const currentWeek = getMonday(new Date());
  const key = `${route}_${currentWeek}`;
  const schedule = schedules[key];
  if (!schedule) return null;

  let total = 0, exact = 0, sameWeek = 0, missed = 0, future = 0;
  const today = new Date().toISOString().split('T')[0];

  DAYS.forEach(day => {
    (schedule[day] || []).forEach(item => {
      total++;
      const scheduledDate = getDayDate(currentWeek, day);
      const weekEnd = getDayDate(currentWeek, 'friday');
      const visits = visitHistoryMap[item.storeId] || [];

      if (visits.includes(scheduledDate)) {
        exact++;
      } else {
        const sameWeekVisit = visits.find(v => v >= currentWeek && v <= weekEnd);
        if (sameWeekVisit) sameWeek++;
        else if (scheduledDate > today) future++;
        else missed++;
      }
    });
  });

  if (total === 0) return null;
  const completed = exact + sameWeek;
  const scorable = total - future;
  const adherence = scorable > 0 ? Math.round((completed / scorable) * 100) : 0;
  return { total, exact, sameWeek, missed, future, completed, adherence };
}

function getAlertStats(alerts, stores) {
  const storeMap = {};
  stores.forEach(s => { storeMap[s.id] = s; });

  let total = 0;
  let resolved = 0;
  let unresolved = 0;
  let totalResponseDays = 0;
  let responseCount = 0;

  alerts.forEach(a => {
    total++;
    const store = storeMap[a.storeId];
    if (!store || !a.dateReceived) {
      unresolved++;
      return;
    }
    const lv = (store.lastVisited || '').split('T')[0].split(' ')[0];
    if (lv && lv >= a.dateReceived) {
      resolved++;
      const days = getDaysBetween(a.dateReceived, lv);
      if (days !== null) {
        totalResponseDays += days;
        responseCount++;
      }
    } else {
      unresolved++;
    }
  });

  const avgResponse = responseCount > 0 ? Math.round(totalResponseDays / responseCount) : null;
  return { total, resolved, unresolved, avgResponse };
}

export default function RouteLeaderboard() {
  const { state } = useApp();
  const { stores, alerts, schedules, visitHistory: visitHistoryMap } = state;
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Group alerts by route
  const alertsByRoute = useMemo(() => {
    const map = {};
    alerts.forEach(a => {
      const route = a.routeNumber || '0';
      if (!map[route]) map[route] = [];
      map[route].push(a);
    });
    return map;
  }, [alerts]);

  const routeData = useMemo(() => {
    const routeMap = {};
    stores.forEach((s) => {
      const route = s.routeNumber || '0';
      if (route === '0') return;
      if (!routeMap[route]) routeMap[route] = { required: [], cash: [] };
      if (isCashStop(s)) {
        routeMap[route].cash.push(s);
      } else {
        routeMap[route].required.push(s);
      }
    });

    return Object.entries(routeMap).map(([route, { required, cash }]) => {
      const counts = getStatusCounts(required);
      const active = required.length - counts.never; // exclude never-visited (may be seasonal)
      const coverage = active > 0 ? Math.round((counts.onTrack / active) * 100) : 0;
      const grade = getGrade(coverage);
      const routeAlerts = alertsByRoute[route] || [];
      const alertStats = getAlertStats(routeAlerts, stores);
      const adherence = getScheduleAdherence(schedules, route, visitHistoryMap);
      return {
        route,
        required,
        cash,
        totalRequired: required.length,
        totalActive: active,
        totalCash: cash.length,
        counts,
        coverage,
        grade,
        alertStats,
        alerts: routeAlerts,
        adherence,
      };
    });
  }, [stores, alertsByRoute, schedules]);

  const sorted = useMemo(() => {
    const s = [...routeData];
    s.sort((a, b) => sortAsc ? a.coverage - b.coverage : b.coverage - a.coverage);
    return s;
  }, [routeData, sortAsc]);

  const overallStats = useMemo(() => {
    let totalActive = 0;
    let totalOnTrack = 0;
    routeData.forEach((r) => {
      totalActive += r.totalActive;
      totalOnTrack += r.counts.onTrack;
    });
    const pct = totalActive > 0 ? Math.round((totalOnTrack / totalActive) * 100) : 0;
    return { totalActive, totalOnTrack, pct, grade: getGrade(pct) };
  }, [routeData]);

  const overallAlertStats = useMemo(() => {
    return getAlertStats(alerts, stores);
  }, [alerts, stores]);

  const overallScheduleStats = useMemo(() => {
    let total = 0, exact = 0, sameWeek = 0, missed = 0, future = 0;
    let scheduledRoutes = 0;
    routeData.forEach(r => {
      if (r.adherence) {
        scheduledRoutes++;
        total += r.adherence.total;
        exact += r.adherence.exact;
        sameWeek += r.adherence.sameWeek;
        missed += r.adherence.missed;
        future += r.adherence.future;
      }
    });
    if (total === 0) return null;
    const completed = exact + sameWeek;
    const scorable = total - future;
    const adherence = scorable > 0 ? Math.round((completed / scorable) * 100) : 0;
    return { total, exact, sameWeek, missed, future, completed, adherence, scheduledRoutes };
  }, [routeData]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <div className="leaderboard-title-row">
          <h2>Route Leaderboard</h2>
          <div className="overall-grade" style={{ background: overallStats.grade.color + '15', borderColor: overallStats.grade.color }}>
            <span className="overall-grade-letter" style={{ color: overallStats.grade.color }}>{overallStats.grade.letter}</span>
            <span className="overall-grade-label">{overallStats.totalOnTrack}/{overallStats.totalActive} on track</span>
          </div>
        </div>

        <div className="lb-subtitle">
          Weekly coverage — stores visited within 7 days (CASH stops excluded)
        </div>

        {/* Overall Alert Stats */}
        {overallAlertStats.total > 0 && (
          <div className="lb-alert-summary">
            <span className="lb-alert-title">Service Alerts</span>
            <div className="lb-alert-stats">
              <span className="lb-alert-stat">
                <span className="lb-alert-val" style={{ color: '#ef4444' }}>{overallAlertStats.unresolved}</span> open
              </span>
              <span className="lb-alert-stat">
                <span className="lb-alert-val" style={{ color: '#22c55e' }}>{overallAlertStats.resolved}</span> resolved
              </span>
              <span className="lb-alert-stat">
                <span className="lb-alert-val">{overallAlertStats.total}</span> total
              </span>
              {overallAlertStats.avgResponse !== null && (
                <span className="lb-alert-stat">
                  <span className="lb-alert-val">{overallAlertStats.avgResponse}d</span> avg response
                </span>
              )}
            </div>
          </div>
        )}

        {/* Schedule Adherence Summary */}
        {overallScheduleStats && (
          <div className="lb-schedule-summary">
            <span className="lb-schedule-title">Schedule Adherence (This Week)</span>
            <div className="lb-schedule-stats">
              <span className="lb-schedule-stat">
                <span className="lb-schedule-val" style={{ color: overallScheduleStats.adherence >= 80 ? '#22c55e' : overallScheduleStats.adherence >= 50 ? '#f97316' : '#ef4444' }}>
                  {overallScheduleStats.adherence}%
                </span> adherence
              </span>
              <span className="lb-schedule-stat">
                <span className="lb-schedule-val" style={{ color: '#22c55e' }}>{overallScheduleStats.exact}</span> on time
              </span>
              <span className="lb-schedule-stat">
                <span className="lb-schedule-val" style={{ color: '#3b82f6' }}>{overallScheduleStats.sameWeek}</span> same week
              </span>
              <span className="lb-schedule-stat">
                <span className="lb-schedule-val" style={{ color: '#ef4444' }}>{overallScheduleStats.missed}</span> missed
              </span>
              <span className="lb-schedule-stat">
                <span className="lb-schedule-val">{overallScheduleStats.scheduledRoutes}</span> routes scheduled
              </span>
            </div>
          </div>
        )}

        <div className="leaderboard-controls">
          <button
            className={`sort-btn ${!sortAsc ? 'active' : ''}`}
            onClick={() => setSortAsc(false)}
          >
            Best First
          </button>
          <button
            className={`sort-btn ${sortAsc ? 'active' : ''}`}
            onClick={() => setSortAsc(true)}
          >
            Worst First
          </button>
        </div>

        <div className="leaderboard-legend">
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#22c55e' }}></span>On track (0-7d)</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#f97316' }}></span>Missed 1 wk (8-14d)</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#ef4444' }}></span>Missed 2+ wk (15-30d)</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#7f1d1d' }}></span>Critical (30d+)</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#9ca3af' }}></span>Never visited</span>
        </div>
      </div>

      <div className="leaderboard-grid">
        {sorted.map((r, idx) => {
          const { grade, counts, alertStats: as } = r;
          const rank = idx + 1;
          const isExpanded = expanded === r.route;

          return (
            <div
              key={r.route}
              className={`route-card ${isExpanded ? 'route-card-expanded' : ''}`}
              onClick={() => setExpanded(isExpanded ? null : r.route)}
              style={{ cursor: 'pointer' }}
            >
              <div className="route-card-top">
                <div className="route-rank">#{rank}</div>
                <div className="route-info">
                  <div className="route-name">Route {r.route}</div>
                  <div className="route-store-count">
                    {r.totalRequired} stores{r.totalCash > 0 ? ` + ${r.totalCash} cash` : ''}
                  </div>
                </div>
                <div className="route-grade-circle" style={{ background: grade.color }}>
                  <span className="grade-letter">{grade.letter}</span>
                  <span className="grade-score">{r.coverage}%</span>
                </div>
              </div>

              <div className="route-coverage-text">
                <span className="coverage-fraction">
                  <strong>{counts.onTrack}</strong>/{r.totalActive}
                </span>
                <span className="coverage-label"> visited this week</span>
              </div>

              <div className="route-bar">
                {counts.onTrack > 0 && (
                  <div className="bar-seg" style={{ background: '#22c55e', flex: counts.onTrack }} title={`${counts.onTrack} on track`}></div>
                )}
                {counts.overdue1 > 0 && (
                  <div className="bar-seg" style={{ background: '#f97316', flex: counts.overdue1 }} title={`${counts.overdue1} missed 1 week`}></div>
                )}
                {counts.overdue2 > 0 && (
                  <div className="bar-seg" style={{ background: '#ef4444', flex: counts.overdue2 }} title={`${counts.overdue2} missed 2+ weeks`}></div>
                )}
                {counts.critical > 0 && (
                  <div className="bar-seg" style={{ background: '#7f1d1d', flex: counts.critical }} title={`${counts.critical} critical (30d+)`}></div>
                )}
                {counts.never > 0 && (
                  <div className="bar-seg" style={{ background: '#9ca3af', flex: counts.never }} title={`${counts.never} never visited`}></div>
                )}
              </div>

              <div className="route-tier-counts">
                {counts.onTrack > 0 && <span className="tier-count" style={{ color: '#22c55e' }}>{counts.onTrack} on track</span>}
                {counts.overdue1 > 0 && <span className="tier-count" style={{ color: '#f97316' }}>{counts.overdue1} missed</span>}
                {counts.overdue2 > 0 && <span className="tier-count" style={{ color: '#ef4444' }}>{counts.overdue2} overdue</span>}
                {counts.critical > 0 && <span className="tier-count" style={{ color: '#7f1d1d' }}>{counts.critical} critical</span>}
                {counts.never > 0 && <span className="tier-count" style={{ color: '#9ca3af' }}>{counts.never} never</span>}
              </div>

              {/* Alert stats per route */}
              {as.total > 0 && (
                <div className="route-alert-row">
                  <span className="route-alert-icon">!</span>
                  <span className="route-alert-text">
                    {as.total} alert{as.total !== 1 ? 's' : ''}
                    {as.unresolved > 0 && <span style={{ color: '#ef4444' }}> ({as.unresolved} open)</span>}
                    {as.resolved > 0 && <span style={{ color: '#22c55e' }}> ({as.resolved} resolved)</span>}
                    {as.avgResponse !== null && <span className="route-alert-avg"> avg {as.avgResponse}d response</span>}
                  </span>
                </div>
              )}

              {/* Schedule adherence per route */}
              {r.adherence && (
                <div className="route-schedule-row">
                  <span className="route-schedule-icon">📅</span>
                  <span>
                    <strong>{r.adherence.adherence}%</strong> adherence
                    ({r.adherence.exact} on time, {r.adherence.sameWeek} same week
                    {r.adherence.missed > 0 && <span style={{ color: '#ef4444' }}>, {r.adherence.missed} missed</span>})
                  </span>
                  <div className="route-schedule-bar">
                    {r.adherence.exact > 0 && <div className="bar-seg" style={{ background: '#22c55e', flex: r.adherence.exact }}></div>}
                    {r.adherence.sameWeek > 0 && <div className="bar-seg" style={{ background: '#3b82f6', flex: r.adherence.sameWeek }}></div>}
                    {r.adherence.missed > 0 && <div className="bar-seg" style={{ background: '#ef4444', flex: r.adherence.missed }}></div>}
                    {r.adherence.future > 0 && <div className="bar-seg" style={{ background: '#e5e7eb', flex: r.adherence.future }}></div>}
                  </div>
                </div>
              )}

              {isExpanded && (
                <div className="route-store-list">
                  {r.required
                    .sort((a, b) => {
                      const da = getDaysSinceVisit(a.lastVisited);
                      const db = getDaysSinceVisit(b.lastVisited);
                      if (da === null && db === null) return 0;
                      if (da === null) return 1;
                      if (db === null) return -1;
                      return db - da;
                    })
                    .map((s) => {
                      const days = getDaysSinceVisit(s.lastVisited);
                      let statusColor = '#9ca3af';
                      let statusText = 'Never';
                      if (days !== null) {
                        if (days <= 7) { statusColor = '#22c55e'; statusText = `${days}d ago`; }
                        else if (days <= 14) { statusColor = '#f97316'; statusText = `${days}d ago`; }
                        else if (days <= 30) { statusColor = '#ef4444'; statusText = `${days}d ago`; }
                        else { statusColor = '#7f1d1d'; statusText = `${days}d ago`; }
                      }
                      const storeAlerts = r.alerts.filter(a => a.storeId === s.id);
                      return (
                        <div key={s.id} className="route-store-item">
                          <span className="store-status-dot" style={{ background: statusColor }}></span>
                          <span className="store-item-name">{s.name}</span>
                          <span className="store-item-city">{s.city}</span>
                          {storeAlerts.length > 0 && (
                            <span className="store-alert-badge" title={`${storeAlerts.length} alert(s)`}>
                              !{storeAlerts.length}
                            </span>
                          )}
                          <span className="store-item-days" style={{ color: statusColor }}>{statusText}</span>
                        </div>
                      );
                    })}
                  {r.cash.length > 0 && (
                    <div className="route-cash-section">
                      <div className="cash-section-label">CASH stops ({r.cash.length}) — not scored</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

export default function RouteLeaderboard() {
  const { state } = useApp();
  const { stores } = state;
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState(null);

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
      const total = required.length;
      const counts = getStatusCounts(required);
      const coverage = total > 0 ? Math.round((counts.onTrack / total) * 100) : 0;
      const grade = getGrade(coverage);
      return {
        route,
        required,
        cash,
        totalRequired: total,
        totalCash: cash.length,
        counts,
        coverage,
        grade,
      };
    });
  }, [stores]);

  const sorted = useMemo(() => {
    const s = [...routeData];
    s.sort((a, b) => sortAsc ? a.coverage - b.coverage : b.coverage - a.coverage);
    return s;
  }, [routeData, sortAsc]);

  const overallStats = useMemo(() => {
    let totalReq = 0;
    let totalOnTrack = 0;
    routeData.forEach((r) => {
      totalReq += r.totalRequired;
      totalOnTrack += r.counts.onTrack;
    });
    const pct = totalReq > 0 ? Math.round((totalOnTrack / totalReq) * 100) : 0;
    return { totalReq, totalOnTrack, pct, grade: getGrade(pct) };
  }, [routeData]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <div className="leaderboard-title-row">
          <h2>Route Leaderboard</h2>
          <div className="overall-grade" style={{ background: overallStats.grade.color + '15', borderColor: overallStats.grade.color }}>
            <span className="overall-grade-letter" style={{ color: overallStats.grade.color }}>{overallStats.grade.letter}</span>
            <span className="overall-grade-label">{overallStats.totalOnTrack}/{overallStats.totalReq} on track</span>
          </div>
        </div>

        <div className="lb-subtitle">
          Weekly coverage — stores visited within 7 days (CASH stops excluded)
        </div>

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
          const { grade, counts } = r;
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
                  <strong>{counts.onTrack}</strong>/{r.totalRequired}
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
                      return (
                        <div key={s.id} className="route-store-item">
                          <span className="store-status-dot" style={{ background: statusColor }}></span>
                          <span className="store-item-name">{s.name}</span>
                          <span className="store-item-city">{s.city}</span>
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

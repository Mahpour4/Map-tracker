import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const visited = new Date(lastVisited);
  if (isNaN(visited.getTime())) return null;
  const now = new Date();
  return Math.floor((now - visited) / (1000 * 60 * 60 * 24));
}

function getStoreScore(lastVisited) {
  const days = getDaysSinceVisit(lastVisited);
  if (days === null) return 0;
  if (days <= 7) return 100;
  if (days <= 10) return 80;
  if (days <= 15) return 50;
  if (days <= 30) return 20;
  return 0;
}

function getGrade(score) {
  if (score >= 90) return { letter: 'A', color: '#22c55e' };
  if (score >= 75) return { letter: 'B', color: '#3b82f6' };
  if (score >= 55) return { letter: 'C', color: '#eab308' };
  if (score >= 30) return { letter: 'D', color: '#f97316' };
  return { letter: 'F', color: '#ef4444' };
}

function getTierCounts(stores) {
  const counts = { week: 0, ten: 0, fifteen: 0, thirty: 0, overdue: 0, never: 0 };
  stores.forEach((s) => {
    const days = getDaysSinceVisit(s.lastVisited);
    if (days === null) counts.never++;
    else if (days <= 7) counts.week++;
    else if (days <= 10) counts.ten++;
    else if (days <= 15) counts.fifteen++;
    else if (days <= 30) counts.thirty++;
    else counts.overdue++;
  });
  return counts;
}

export default function RouteLeaderboard() {
  const { state } = useApp();
  const { stores } = state;
  const [sortAsc, setSortAsc] = useState(false);

  const routeData = useMemo(() => {
    const routeMap = {};
    stores.forEach((s) => {
      const route = s.routeNumber || '0';
      if (route === '0') return;
      if (!routeMap[route]) routeMap[route] = [];
      routeMap[route].push(s);
    });

    return Object.entries(routeMap).map(([route, routeStores]) => {
      const scores = routeStores.map((s) => getStoreScore(s.lastVisited));
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const grade = getGrade(avgScore);
      const tiers = getTierCounts(routeStores);
      return { route, stores: routeStores, storeCount: routeStores.length, avgScore, grade, tiers };
    });
  }, [stores]);

  const sorted = useMemo(() => {
    const s = [...routeData];
    s.sort((a, b) => sortAsc ? a.avgScore - b.avgScore : b.avgScore - a.avgScore);
    return s;
  }, [routeData, sortAsc]);

  const overallScore = useMemo(() => {
    if (!routeData.length) return 0;
    const total = routeData.reduce((sum, r) => sum + r.avgScore, 0);
    return Math.round(total / routeData.length);
  }, [routeData]);

  const overallGrade = getGrade(overallScore);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <div className="leaderboard-title-row">
          <h2>Route Leaderboard</h2>
          <div className="overall-grade" style={{ background: overallGrade.color + '15', borderColor: overallGrade.color }}>
            <span className="overall-grade-letter" style={{ color: overallGrade.color }}>{overallGrade.letter}</span>
            <span className="overall-grade-label">Overall: {overallScore}%</span>
          </div>
        </div>
        <div className="leaderboard-controls">
          <button
            className={`sort-btn ${!sortAsc ? 'active' : ''}`}
            onClick={() => setSortAsc(false)}
          >
            Best First ↓
          </button>
          <button
            className={`sort-btn ${sortAsc ? 'active' : ''}`}
            onClick={() => setSortAsc(true)}
          >
            Worst First ↑
          </button>
        </div>
        <div className="leaderboard-legend">
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#22c55e' }}></span>0-7d</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#3b82f6' }}></span>8-10d</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#eab308' }}></span>11-15d</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#f97316' }}></span>16-30d</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#ef4444' }}></span>30d+</span>
          <span className="lb-legend-item"><span className="lb-dot" style={{ background: '#9ca3af' }}></span>Never</span>
        </div>
      </div>

      <div className="leaderboard-grid">
        {sorted.map((r, idx) => {
          const { grade, tiers } = r;
          const rank = idx + 1;
          return (
            <div key={r.route} className="route-card">
              <div className="route-card-top">
                <div className="route-rank">#{rank}</div>
                <div className="route-info">
                  <div className="route-name">Route {r.route}</div>
                  <div className="route-store-count">{r.storeCount} stores</div>
                </div>
                <div className="route-grade-circle" style={{ background: grade.color }}>
                  <span className="grade-letter">{grade.letter}</span>
                  <span className="grade-score">{r.avgScore}%</span>
                </div>
              </div>

              <div className="route-bar">
                {tiers.week > 0 && (
                  <div className="bar-seg" style={{ background: '#22c55e', flex: tiers.week }} title={`${tiers.week} stores (0-7 days)`}></div>
                )}
                {tiers.ten > 0 && (
                  <div className="bar-seg" style={{ background: '#3b82f6', flex: tiers.ten }} title={`${tiers.ten} stores (8-10 days)`}></div>
                )}
                {tiers.fifteen > 0 && (
                  <div className="bar-seg" style={{ background: '#eab308', flex: tiers.fifteen }} title={`${tiers.fifteen} stores (11-15 days)`}></div>
                )}
                {tiers.thirty > 0 && (
                  <div className="bar-seg" style={{ background: '#f97316', flex: tiers.thirty }} title={`${tiers.thirty} stores (16-30 days)`}></div>
                )}
                {tiers.overdue > 0 && (
                  <div className="bar-seg" style={{ background: '#ef4444', flex: tiers.overdue }} title={`${tiers.overdue} stores (30+ days)`}></div>
                )}
                {tiers.never > 0 && (
                  <div className="bar-seg" style={{ background: '#9ca3af', flex: tiers.never }} title={`${tiers.never} stores (never visited)`}></div>
                )}
              </div>

              <div className="route-tier-counts">
                {tiers.week > 0 && <span className="tier-count" style={{ color: '#22c55e' }}>{tiers.week} ✓</span>}
                {tiers.ten > 0 && <span className="tier-count" style={{ color: '#3b82f6' }}>{tiers.ten}</span>}
                {tiers.fifteen > 0 && <span className="tier-count" style={{ color: '#eab308' }}>{tiers.fifteen} ⚠</span>}
                {tiers.thirty > 0 && <span className="tier-count" style={{ color: '#f97316' }}>{tiers.thirty} ⚠</span>}
                {tiers.overdue > 0 && <span className="tier-count" style={{ color: '#ef4444' }}>{tiers.overdue} ✗</span>}
                {tiers.never > 0 && <span className="tier-count" style={{ color: '#9ca3af' }}>{tiers.never} —</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

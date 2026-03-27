// Shared driver/route metric functions
// Extracted from RouteLeaderboard + new scoring/deviation functions

// ── Constants ─────────────────────────────────────────────────────────────────
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const DAY_OFFSETS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };
const DAY_NAMES = ['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

// ── Visit history helpers ──────────────────────────────────────────────────────
// visitHistory entries can be plain strings "YYYY-MM-DD" (old) or { date, by } (new)

export function vhDate(entry) {
  return typeof entry === 'string' ? entry : entry?.date || '';
}

export function vhBy(entry) {
  return typeof entry === 'string' ? null : entry?.by || null;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getLatestDate(store) {
  return [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
}

export function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const raw = lastVisited.split('T')[0];
  const visited = new Date(raw + 'T00:00:00');
  if (isNaN(visited.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - visited) / (1000 * 60 * 60 * 24));
}

export function getDaysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

export function getDayDate(weekOf, day) {
  const d = new Date(weekOf + 'T00:00:00');
  d.setDate(d.getDate() + DAY_OFFSETS[day]);
  return d.toISOString().split('T')[0];
}

// ── Grading ───────────────────────────────────────────────────────────────────

export function getGrade(pct) {
  if (pct >= 90) return { letter: 'A', color: '#22c55e' };
  if (pct >= 75) return { letter: 'B', color: '#3b82f6' };
  if (pct >= 55) return { letter: 'C', color: '#eab308' };
  if (pct >= 30) return { letter: 'D', color: '#f97316' };
  return { letter: 'F', color: '#ef4444' };
}

// ── Store status counts ───────────────────────────────────────────────────────

export function getStatusCounts(stores) {
  const counts = { onTrack: 0, overdue1: 0, overdue2: 0, critical: 0, never: 0, dormant: 0 };
  stores.forEach((s) => {
    const days = getDaysSinceVisit(getLatestDate(s));
    if (days === null) counts.never++;
    else if (days >= 90) counts.dormant++;
    else if (days <= 7) counts.onTrack++;
    else if (days <= 14) counts.overdue1++;
    else if (days <= 30) counts.overdue2++;
    else counts.critical++;
  });
  return counts;
}

// ── Find the saved schedule for a route (schedules are permanent, not per-week) ──

function findRouteSchedule(schedules, route) {
  // Try exact current week first, then fall back to any saved schedule for this route
  const weekOf = getMonday(new Date());
  const exactKey = `${route}_${weekOf}`;
  if (schedules[exactKey]) return schedules[exactKey];
  // Find any key that starts with this route number
  const prefix = `${route}_`;
  const fallbackKey = Object.keys(schedules).find(k => k.startsWith(prefix));
  return fallbackKey ? schedules[fallbackKey] : null;
}

// ── Schedule adherence (for a specific week, defaults to current) ─────────────

export function getScheduleAdherence(schedules, route, visitHistoryMap, weekOf) {
  const targetWeek = weekOf || getMonday(new Date());
  const schedule = findRouteSchedule(schedules, route);
  if (!schedule) return null;

  let total = 0, exact = 0, sameWeek = 0, missed = 0, future = 0;
  const today = localDateStr();

  DAYS.forEach(day => {
    (schedule[day] || []).forEach(item => {
      total++;
      const scheduledDate = getDayDate(targetWeek, day);
      const weekEnd = getDayDate(targetWeek, 'friday');
      const visits = (visitHistoryMap[item.storeId] || []).map(vhDate);

      if (visits.includes(scheduledDate)) {
        exact++;
      } else {
        const sameWeekVisit = visits.find(v => v >= targetWeek && v <= weekEnd);
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

// ── Alert stats ───────────────────────────────────────────────────────────────

export function getAlertStats(alerts, stores) {
  const storeMap = {};
  stores.forEach(s => { storeMap[s.id] = s; });

  let total = 0, resolved = 0, unresolved = 0, totalResponseDays = 0, responseCount = 0;

  alerts.forEach(a => {
    total++;
    const store = storeMap[a.storeId];
    if (!store || !a.dateReceived) { unresolved++; return; }
    const lv = (getLatestDate(store) || '').split('T')[0].split(' ')[0];
    if (lv && lv >= a.dateReceived) {
      resolved++;
      const days = getDaysBetween(a.dateReceived, lv);
      if (days !== null) { totalResponseDays += days; responseCount++; }
    } else {
      unresolved++;
    }
  });

  const avgResponse = responseCount > 0 ? Math.round(totalResponseDays / responseCount) : null;
  return { total, resolved, unresolved, avgResponse };
}

// ── NEW: Today's schedule for a route ─────────────────────────────────────────

export function getTodaySchedule(schedules, routeNumber) {
  const today = new Date();
  const dayIndex = today.getDay(); // 0=Sun ... 6=Sat
  if (dayIndex < 1 || dayIndex > 5) return null; // weekend
  const weekOf = getMonday(today);
  const dayLabel = DAY_NAMES[dayIndex];
  const schedule = findRouteSchedule(schedules, routeNumber);
  if (!schedule || !schedule[dayLabel]) return null;
  return {
    storeIds: schedule[dayLabel].map(s => s.storeId),
    stops: schedule[dayLabel],
    dayLabel,
    weekOf,
  };
}

// ── NEW: Schedule deviation for a vehicle right now ───────────────────────────

export function getScheduleDeviation(vehicle, todaySchedule, travelLog, stores) {
  if (!todaySchedule) return { status: 'no-schedule', message: 'No schedule today', detail: null };

  const today = localDateStr();
  const vin = vehicle.vin;
  const vehicleTodayLog = (travelLog[today] || {})[vin] || [];
  const storeVisitsToday = new Set(
    vehicleTodayLog.filter(e => e.type === 'store').map(e => e.locationId)
  );

  const totalScheduled = todaySchedule.storeIds.length;
  const completedCount = todaySchedule.storeIds.filter(id => storeVisitsToday.has(id)).length;

  if (totalScheduled === 0) return { status: 'no-schedule', message: 'No stops today', detail: null };

  // Expected progress based on time of day (8am-6pm = 10hr workday)
  const now = new Date();
  const hoursSince8am = Math.max(0, (now.getHours() + now.getMinutes() / 60) - 8);
  const workdayHours = 10;
  const expectedProgress = Math.min(1, hoursSince8am / workdayHours);
  const expectedCompleted = Math.round(totalScheduled * expectedProgress);

  const detail = { completedCount, totalScheduled, expectedCompleted };

  if (completedCount >= totalScheduled) {
    return { status: 'on-track', message: `${completedCount}/${totalScheduled} (done)`, detail };
  }
  if (completedCount >= expectedCompleted) {
    return { status: 'on-track', message: `${completedCount}/${totalScheduled} (on pace)`, detail };
  }

  const behind = expectedCompleted - completedCount;
  return {
    status: 'behind',
    message: `${completedCount}/${totalScheduled} (${behind} behind)`,
    detail,
  };
}

// ── NEW: Weekly trend (past N weeks adherence %) ──────────────────────────────

export function getWeeklyTrend(routeNumber, { schedules, visitHistory, weekCount = 4 }) {
  const results = [];
  const now = new Date();
  for (let i = 0; i < weekCount; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekOf = getMonday(d);
    const adherence = getScheduleAdherence(schedules, routeNumber, visitHistory, weekOf);
    results.push({ weekOf, adherence: adherence ? adherence.adherence : null, detail: adherence });
  }
  return results.reverse(); // oldest first
}

// ── NEW: Composite driver performance score ───────────────────────────────────

export function computeDriverScore(routeNumber, { stores, travelLog, visitHistory, schedules, alerts, fleetVehicles }) {
  const routeStores = stores.filter(s => s.routeNumber === routeNumber);
  const routeAlerts = alerts.filter(a => a.routeNumber === routeNumber);

  // 1. Schedule adherence (40%)
  const sched = getScheduleAdherence(schedules, routeNumber, visitHistory);
  const schedScore = sched ? sched.adherence : null;

  // 2. Store coverage (25%) — % of active stores visited within 7 days
  const counts = getStatusCounts(routeStores);
  const active = routeStores.length - counts.dormant - counts.never;
  const coverageScore = active > 0 ? Math.round((counts.onTrack / active) * 100) : (routeStores.length === 0 ? null : 0);

  // 3. Alert responsiveness (20%)
  const alertStats = getAlertStats(routeAlerts, routeStores);
  let alertScore;
  if (alertStats.total === 0) {
    alertScore = 100; // no alerts = perfect
  } else {
    alertScore = Math.max(0, Math.round(
      100 - (alertStats.unresolved * 15) - Math.max(0, (alertStats.avgResponse || 0) - 2) * 10
    ));
  }

  // 4. Efficiency (15%) — productive stops vs driving segments over last 5 working days
  const vehicle = fleetVehicles.find(v => v.routeNumber === routeNumber);
  let efficiencyScore = null;
  if (vehicle) {
    let storeVisits = 0, warehouseVisits = 0, drivingSegments = 0;
    const today = new Date();
    for (let i = 0; i < 7; i++) { // scan 7 calendar days to get ~5 working days
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = localDateStr(d);
      const entries = (travelLog[dateKey] || {})[vehicle.vin] || [];
      entries.forEach(e => {
        if (e.type === 'store') storeVisits++;
        else if (e.type === 'warehouse') warehouseVisits++;
        else if (e.type === 'driving') drivingSegments++;
      });
    }
    const productive = storeVisits + warehouseVisits;
    efficiencyScore = drivingSegments > 0
      ? Math.min(100, Math.round((productive / drivingSegments) * 100))
      : (productive > 0 ? 100 : null);
  }

  // Composite — redistribute weight if a sub-score is unavailable
  const weights = { scheduleAdherence: 40, storeCoverage: 25, alertResponse: 20, efficiency: 15 };
  const scores = {
    scheduleAdherence: schedScore,
    storeCoverage: coverageScore,
    alertResponse: alertScore,
    efficiency: efficiencyScore,
  };

  let totalWeight = 0, weightedSum = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score !== null) {
      totalWeight += weights[key];
      weightedSum += score * weights[key];
    }
  }
  const overall = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  return {
    overall,
    grade: getGrade(overall),
    breakdown: {
      scheduleAdherence: { score: schedScore, weight: weights.scheduleAdherence, detail: sched },
      storeCoverage: { score: coverageScore, weight: weights.storeCoverage, detail: { onTrack: counts.onTrack, total: routeStores.length, active } },
      alertResponse: { score: alertScore, weight: weights.alertResponse, detail: alertStats },
      efficiency: { score: efficiencyScore, weight: weights.efficiency, detail: { storeVisits: 0, warehouseVisits: 0, drivingSegments: 0 } },
    },
  };
}

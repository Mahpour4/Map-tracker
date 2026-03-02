import React, { useState, useMemo, useCallback, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext';
import { fetchAlertImage, isGmailConnected, signInWithGoogle } from '../services/gmailAlertService';
import { scrapeAlertDetails as gwScrapeDetails, checkAlertStatus as gwCheckStatus } from '../services/globalworxService';
import { labelAlertsCompleted } from '../services/gmailAlertService';
import { fetchCardTransactions, fetchVehicles } from '../services/motiveService';
import { getWhatsAppStatus, getWhatsAppGroups, sendWhatsAppAlert, sendWhatsAppReport } from '../services/whatsappService';
import { computeDriverScore, getScheduleAdherence, getStatusCounts, getLatestDate, getDaysSinceVisit, getWeeklyTrend } from '../utils/driverMetrics';

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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AlertLog() {
  const { state, selectStore, setSidebarTab, setMapView, setPage, setFilterRoute, setFilterRegion, setFilterType, setSearch, loadAlertImage, fetchGmailAlerts, autoAcceptAlerts, autoCompleteAlerts, syncFromGithub } = useApp();
  const { alerts, stores, alertImages, syncStatus, schedules, visitHistory, travelLog, fleetVehicles } = state;

  const today = localDateStr();
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDateStr(d); })();
  const dayBefore = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return localDateStr(d); })();
  // This week: Monday through today
  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const dates = new Set();
    for (let i = mondayOffset; i >= 0; i--) {
      const d = new Date(); d.setDate(now.getDate() - i);
      dates.add(localDateStr(d));
    }
    return dates;
  }, []);
  // Last week: previous Monday through Sunday
  const lastWeekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const dates = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(now.getDate() - mondayOffset - 7 + i);
      dates.add(localDateStr(d));
    }
    return dates;
  }, []);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRoute, setLocalFilterRoute] = useState('all');
  const [filterVendor, setLocalFilterVendor] = useState('all');
  const [filterDate, setFilterDate] = useState(null); // null = show all dates
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState(null); // null = auto (expand unresolved)
  const [expandedImage, setExpandedImage] = useState(null); // emailId of alert with open image
  const [alertDate, setAlertDate] = useState(today);
  const [fetching, setFetching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(null); // route string or null
  const [reportGenerating, setReportGenerating] = useState(null); // route string or null
  const [showStats, setShowStats] = useState(false);
  const [statsTab, setStatsTab] = useState('time'); // 'time' | 'route' | 'zone' | 'chain' | 'top'
  const [statsView, setStatsView] = useState('day'); // 'day' | 'week' | 'month'
  const [statsRouteTime, setStatsRouteTime] = useState('all'); // 'all' | 'this-week' | '30d' | '90d'
  const [selectedAlertRef, setSelectedAlertRef] = useState(null); // refNumber of expanded alert
  const [autoClearing, setAutoClearing] = useState(false);
  const [autoAccepting, setAutoAccepting] = useState(false);
  const [checkedAlerts, setCheckedAlerts] = useState(new Set());
  const [statusChecking, setStatusChecking] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [waStatus, setWaStatus] = useState('offline'); // offline | connected | qr-pending | disconnected
  const [waSending, setWaSending] = useState(null); // identifier of what's being sent
  const [waGroups, setWaGroups] = useState([]); // available WhatsApp groups
  const [showWaSettings, setShowWaSettings] = useState(false);
  const WA_GROUP_MAP_KEY = 'wa_route_group_map';
  const [waGroupMap, setWaGroupMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WA_GROUP_MAP_KEY)) || {}; }
    catch { return {}; }
  });

  // Check WhatsApp service status on mount and periodically; fetch groups when connected
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const s = await getWhatsAppStatus();
      if (mounted) {
        setWaStatus(s.status);
        if (s.status === 'connected' && waGroups.length === 0) {
          try {
            const groups = await getWhatsAppGroups();
            if (mounted) setWaGroups(groups);
          } catch { /* service may not be ready yet */ }
        }
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Auto-fetch Gmail alerts on mount to pick up label flags (Accepted/Done/Completed)
  // Also fetch when no alerts are loaded (CSV may have failed)
  useEffect(() => {
    if (isGmailConnected()) {
      fetchGmailAlerts().catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- PDF sent tracking (persisted in localStorage) ---
  const PDF_SENT_KEY = 'pdf_sent_log';
  const [pdfSentLog, setPdfSentLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PDF_SENT_KEY)) || {}; }
    catch { return {}; }
  });

  function getRouteRefKey(routeAlerts) {
    // Create a stable key from sorted RefNumbers so we can track exactly which alerts were sent
    return routeAlerts.map(a => a.refNumber).filter(Boolean).sort().join(',');
  }

  function markRouteSent(routeAlerts) {
    const refKey = getRouteRefKey(routeAlerts);
    if (!refKey) return;
    const updated = {
      ...pdfSentLog,
      [refKey]: {
        date: new Date().toISOString(),
        refs: routeAlerts.map(a => a.refNumber).filter(Boolean),
        count: routeAlerts.length,
      },
    };
    setPdfSentLog(updated);
    localStorage.setItem(PDF_SENT_KEY, JSON.stringify(updated));
  }

  function getRouteSentInfo(routeAlerts) {
    const refKey = getRouteRefKey(routeAlerts);
    return refKey ? pdfSentLog[refKey] : null;
  }

  // Build store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Enrich alerts with store data, status, and days since service
  const enrichedAlerts = useMemo(() => {
    const now = localDateStr();
    return alerts.map(a => {
      const store = storeMap[a.storeId];

      // Get the most recent visit date from visitHistory (more up-to-date than store.lastVisited)
      const storeId = a.storeId || store?.id;
      const vhDates = (visitHistory && storeId ? (visitHistory[storeId] || []) : [])
        .filter(Boolean)
        .map(d => d.split('T')[0]);
      const newestVisitFromHistory = vhDates.length > 0 ? vhDates.sort().pop() : null;

      // Use the best available lastVisited: whichever is most recent between store field and visit history
      const storeLastVisited = store?.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : null;
      const bestLastVisited = [storeLastVisited, newestVisitFromHistory].filter(Boolean).sort().pop() || null;

      const lastSaleDate = store?.lastSaleDate ? store.lastSaleDate.split('T')[0].split(' ')[0] : null;
      const lastVisitDate = bestLastVisited;

      // Build an enriched store object with the best visit date for status calculation
      const enrichedStore = store ? { ...store, lastVisited: bestLastVisited || store.lastVisited } : store;
      const statusInfo = getAlertStatus(a, enrichedStore);

      let daysSinceService = null;
      const storeLatest = [lastSaleDate, bestLastVisited].filter(Boolean).sort().pop() || null;
      if (storeLatest) {
        daysSinceService = getDaysBetween(storeLatest, now);
      }

      return { ...a, store, ...statusInfo, daysSinceService, lastSaleDate, lastVisitDate };
    }).sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'unresolved') return -1;
        if (b.status === 'unresolved') return 1;
      }
      return (b.dateReceived || '').localeCompare(a.dateReceived || '');
    });
  }, [alerts, storeMap, visitHistory]);

  // Unique routes and vendors for filter dropdowns
  const alertRoutes = useMemo(() => {
    const set = new Set(alerts.map(a => a.routeNumber).filter(Boolean));
    return Array.from(set).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [alerts]);

  const alertVendors = useMemo(() => {
    const set = new Set(alerts.map(a => a.vendor).filter(Boolean));
    return Array.from(set).sort();
  }, [alerts]);

  // Apply filters
  const filteredAlerts = useMemo(() => {
    let result = enrichedAlerts;
    // When user is searching or using a date filter, show all alerts (don't hide completed/done)
    if (!showCompleted && !searchTerm && !filterDate) {
      const now = new Date();
      result = result.filter(a => {
        if (a.globalworxCompleted) return false;
        // In default 'all' view, hide Done alerts older than 48h (GW button expired)
        // But keep them visible when a specific status filter is active
        if (filterStatus === 'all' && a.globalworxDone && a.dateReceived) {
          const alertDate = new Date(a.dateReceived + 'T00:00:00');
          if ((now - alertDate) / (1000 * 60 * 60) >= 79) return false;
        }
        return true;
      });
    }
    if (filterDate === 'this-week') {
      result = result.filter(a => weekDates.has(a.dateReceived));
    } else if (filterDate === 'last-week') {
      result = result.filter(a => lastWeekDates.has(a.dateReceived));
    } else if (filterDate) {
      result = result.filter(a => a.dateReceived === filterDate);
    }
    if (filterStatus !== 'all') {
      result = result.filter(a => a.status === filterStatus);
    }
    if (filterRoute !== 'all') {
      result = result.filter(a => a.routeNumber === filterRoute);
    }
    if (filterVendor !== 'all') {
      result = result.filter(a => a.vendor === filterVendor);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(a =>
        (a.storeName || '').toLowerCase().includes(term) ||
        (a.storeNumber || '').includes(term) ||
        (a.city || '').toLowerCase().includes(term) ||
        (a.refNumber || '').toLowerCase().includes(term) ||
        (a.vendor || '').toLowerCase().includes(term)
      );
    }
    return result;
  }, [enrichedAlerts, showCompleted, filterDate, weekDates, lastWeekDates, filterStatus, filterRoute, filterVendor, searchTerm]);

  // Group by route
  const alertsByRoute = useMemo(() => {
    const grouped = {};
    filteredAlerts.forEach(a => {
      const route = a.routeNumber || 'Unmatched';
      if (!grouped[route]) grouped[route] = [];
      grouped[route].push(a);
    });
    return Object.entries(grouped).sort((a, b) => {
      if (a[0] === 'Unmatched') return 1;
      if (b[0] === 'Unmatched') return -1;
      const na = parseInt(a[0]), nb = parseInt(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredAlerts]);

  // Summary stats (reflect active date/route/vendor filters so counts match visible results)
  const stats = useMemo(() => {
    let base = enrichedAlerts;
    if (!showCompleted && !searchTerm && !filterDate) {
      const now = new Date();
      base = base.filter(a => {
        if (a.globalworxCompleted) return false;
        if (filterStatus === 'all' && a.globalworxDone && a.dateReceived) {
          const alertDate = new Date(a.dateReceived + 'T00:00:00');
          if ((now - alertDate) / (1000 * 60 * 60) >= 79) return false;
        }
        return true;
      });
    }
    if (filterDate === 'this-week') base = base.filter(a => weekDates.has(a.dateReceived));
    else if (filterDate === 'last-week') base = base.filter(a => lastWeekDates.has(a.dateReceived));
    else if (filterDate) base = base.filter(a => a.dateReceived === filterDate);
    if (filterRoute !== 'all') base = base.filter(a => a.routeNumber === filterRoute);
    if (filterVendor !== 'all') base = base.filter(a => a.vendor === filterVendor);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      base = base.filter(a => (a.storeName || '').toLowerCase().includes(term) || (a.storeNumber || '').includes(term) || (a.city || '').toLowerCase().includes(term) || (a.refNumber || '').toLowerCase().includes(term) || (a.vendor || '').toLowerCase().includes(term));
    }
    const total = base.length;
    const open = base.filter(a => a.status === 'unresolved').length;
    const resolved = base.filter(a => a.status === 'resolved').length;
    const unknown = base.filter(a => a.status === 'unknown').length;
    const accepted = base.filter(a => a.globalworxAccepted).length;
    const done = base.filter(a => a.globalworxDone).length;
    const completed = base.filter(a => a.globalworxCompleted).length;
    const resolvedWithDays = base.filter(a => a.status === 'resolved' && a.days !== null);
    const avgResponse = resolvedWithDays.length > 0
      ? Math.round(resolvedWithDays.reduce((sum, a) => sum + a.days, 0) / resolvedWithDays.length)
      : null;
    return { total, open, resolved, unknown, accepted, done, completed, avgResponse };
  }, [enrichedAlerts, showCompleted, filterStatus, filterDate, weekDates, lastWeekDates, filterRoute, filterVendor, searchTerm]);

  // Count alerts eligible for auto-clear (Done + has acceptance URL + not yet completed)
  const autoClearCount = useMemo(() => {
    return enrichedAlerts.filter(a => {
      if (a.globalworxCompleted) return false;
      if (!a.globalworxDone) return false;
      if (!a.acceptanceUrl) return false;
      return true;
    }).length;
  }, [enrichedAlerts]);

  // Count alerts eligible for auto-accept (has URL, not yet accepted/done/completed)
  const autoAcceptCount = useMemo(() => {
    return enrichedAlerts.filter(a =>
      a.acceptanceUrl && !a.globalworxAccepted && !a.globalworxDone && !a.globalworxCompleted
    ).length;
  }, [enrichedAlerts]);

  // Comprehensive statistics across all dimensions
  const allStats = useMemo(() => {
    if (!showStats) return { time: {}, routes: [], zones: [], chains: [], topStores: [], topDrivers: [], summary: {} };

    // --- Time groupings ---
    function getWeekKey(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((d - jan1) / 86400000) + 1;
      const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
      return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    }

    const dayMap = {}, weekMap = {}, monthMap = {};
    const routeMap = {}, zoneMap = {}, chainMap = {}, storeCountMap = {}, driverMap = {};

    function inc(map, key, a) {
      if (!key) return;
      if (!map[key]) map[key] = { key, total: 0, open: 0, resolved: 0, completed: 0, accepted: 0, done: 0, avgDays: 0, _days: [] };
      map[key].total++;
      if (a.status === 'unresolved') map[key].open++;
      if (a.status === 'resolved') {
        map[key].resolved++;
        if (a.days !== null) map[key]._days.push(a.days);
      }
      if (a.globalworxAccepted) map[key].accepted++;
      if (a.globalworxDone) map[key].done++;
      if (a.globalworxCompleted) map[key].completed++;
    }

    // Extract chain name from store name (e.g. "Food Lion 1414" → "Food Lion")
    function getChain(name) {
      if (!name) return 'Unknown';
      return name.replace(/\s*#?\d+\s*$/, '').trim() || name;
    }

    enrichedAlerts.forEach(a => {
      const date = a.dateReceived;
      if (date) {
        inc(dayMap, date, a);
        inc(weekMap, getWeekKey(date), a);
        inc(monthMap, date.slice(0, 7), a);
      }

      // Route
      inc(routeMap, a.routeNumber || 'Unassigned', a);

      // Zone (use store region/territory)
      const zone = a.store?.region || a.store?.territory || 'Unknown';
      inc(zoneMap, zone, a);

      // Chain
      inc(chainMap, getChain(a.storeName), a);

      // Store & Driver — exclude stores not visited in over 30 days
      const staleStore = a.daysSinceService !== null && a.daysSinceService > 30;
      if (!staleStore) {
        const storeKey = a.storeId || a.storeName;
        if (!storeCountMap[storeKey]) storeCountMap[storeKey] = { key: storeKey, name: a.storeName, number: a.storeNumber, city: a.city, route: a.routeNumber, driver: a.store?.driver || null, total: 0, open: 0, resolved: 0, accepted: 0, done: 0, completed: 0, _days: [] };
        storeCountMap[storeKey].total++;
        if (a.status === 'unresolved') storeCountMap[storeKey].open++;
        if (a.status === 'resolved') {
          storeCountMap[storeKey].resolved++;
          if (a.days !== null) storeCountMap[storeKey]._days.push(a.days);
        }
        if (a.globalworxAccepted) storeCountMap[storeKey].accepted++;
        if (a.globalworxDone) storeCountMap[storeKey].done++;
        if (a.globalworxCompleted) storeCountMap[storeKey].completed++;

        // Driver (from store data)
        const driver = a.store?.driver || `Route ${a.routeNumber || '?'} Driver`;
        inc(driverMap, driver, a);
      }
    });

    // Compute average response days for each bucket
    function finalize(map) {
      const arr = Object.values(map);
      arr.forEach(b => {
        b.avgDays = b._days.length > 0 ? Math.round(b._days.reduce((s, d) => s + d, 0) / b._days.length * 10) / 10 : null;
        delete b._days;
      });
      return arr;
    }

    const toSortedDesc = (map) => { const arr = finalize(map); arr.sort((a, b) => b.key.localeCompare(a.key)); return arr; };
    const toSortedByTotal = (map) => { const arr = finalize(map); arr.sort((a, b) => b.total - a.total); return arr; };

    const dayArr = toSortedDesc(dayMap);
    const busiest = dayArr.length > 0 ? dayArr.reduce((max, d) => d.total > max.total ? d : max, dayArr[0]) : null;
    const avgPerDay = dayArr.length > 0 ? Math.round(dayArr.reduce((s, d) => s + d.total, 0) / dayArr.length * 10) / 10 : 0;
    const resolutionRate = enrichedAlerts.length > 0
      ? Math.round(enrichedAlerts.filter(a => a.status === 'resolved').length / enrichedAlerts.length * 100) : 0;

    // Top stores: finalize and sort by total, take stores with 2+ alerts
    const allStores = finalize(storeCountMap);
    const topStores = allStores.filter(s => s.total >= 1).sort((a, b) => b.total - a.total).slice(0, 15);

    return {
      time: { day: dayArr, week: toSortedDesc(weekMap), month: toSortedDesc(monthMap) },
      routes: toSortedByTotal(routeMap),
      zones: toSortedByTotal(zoneMap),
      chains: toSortedByTotal(chainMap),
      topStores,
      topDrivers: toSortedByTotal(driverMap),
      summary: { busiest, avgPerDay, resolutionRate },
    };
  }, [enrichedAlerts, showStats]);

  // Route stats with optional time filter
  const routeStats = useMemo(() => {
    if (!showStats || statsTab !== 'route') return [];
    let source = enrichedAlerts;
    if (statsRouteTime !== 'all') {
      const now = new Date();
      let cutoff;
      if (statsRouteTime === 'this-week') {
        const day = now.getDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        cutoff = new Date(now); cutoff.setDate(now.getDate() - mondayOffset);
        cutoff.setHours(0, 0, 0, 0);
      } else {
        const days = statsRouteTime === '30d' ? 30 : 90;
        cutoff = new Date(now); cutoff.setDate(now.getDate() - days);
      }
      const cutoffStr = localDateStr(cutoff);
      source = source.filter(a => a.dateReceived >= cutoffStr);
    }
    const routeMap = {};
    source.forEach(a => {
      const key = a.routeNumber || 'Unassigned';
      if (!routeMap[key]) routeMap[key] = { key, total: 0, open: 0, resolved: 0, completed: 0, accepted: 0, done: 0, _days: [] };
      routeMap[key].total++;
      if (a.status === 'unresolved') routeMap[key].open++;
      if (a.status === 'resolved') { routeMap[key].resolved++; if (a.days !== null) routeMap[key]._days.push(a.days); }
      if (a.globalworxCompleted) routeMap[key].completed++;
    });
    const arr = Object.values(routeMap);
    arr.forEach(b => { b.avgDays = b._days.length > 0 ? Math.round(b._days.reduce((s, d) => s + d, 0) / b._days.length * 10) / 10 : null; delete b._days; });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [enrichedAlerts, showStats, statsTab, statsRouteTime]);

  // Determine which routes are expanded
  const isRouteExpanded = (route) => {
    if (expandedRoutes !== null) return expandedRoutes.has(route);
    // Auto mode: when a status filter is active, expand all routes that have matching alerts
    if (filterStatus !== 'all') return alertsByRoute.some(([r]) => r === route);
    // Default: expand routes with unresolved alerts
    const routeAlerts = alertsByRoute.find(([r]) => r === route);
    if (!routeAlerts) return false;
    return routeAlerts[1].some(a => a.status === 'unresolved');
  };

  function toggleRoute(route) {
    setExpandedRoutes(prev => {
      const set = new Set(prev !== null ? prev : alertsByRoute.filter(([r, alerts]) => alerts.some(a => a.status === 'unresolved')).map(([r]) => r));
      if (set.has(route)) set.delete(route);
      else set.add(route);
      return set;
    });
  }

  function handleGoToStore(alert) {
    if (!alert.store) return;
    const s = alert.store;
    selectStore(s.id);
    setMapView([s.lat, s.lng], 15);
    if (s.routeNumber) setFilterRoute(s.routeNumber);
    setPage('map');
  }

  function handleAlertRowClick(a) {
    setSelectedAlertRef(ref => ref === a.refNumber ? null : a.refNumber);
    setExpandedImage(null);
  }

  // Get group ID mapped to a route
  function getRouteGroupId(routeNumber) {
    return waGroupMap[routeNumber] || null;
  }

  // Save route→group mapping
  function setRouteGroup(routeNumber, groupId) {
    const updated = { ...waGroupMap, [routeNumber]: groupId };
    setWaGroupMap(updated);
    localStorage.setItem(WA_GROUP_MAP_KEY, JSON.stringify(updated));
    // Also save group name map so MapView can show "sent to [name]"
    const nameMap = JSON.parse(localStorage.getItem('wa_route_group_names') || '{}');
    const group = waGroups.find(g => g.id === groupId);
    if (group) nameMap[routeNumber] = group.name;
    else delete nameMap[routeNumber];
    localStorage.setItem('wa_route_group_names', JSON.stringify(nameMap));
  }

  async function handleSendToDriver(e, alert) {
    e.stopPropagation();
    const groupId = getRouteGroupId(alert.routeNumber);

    // If WhatsApp service is connected and route has a mapped group, send via API
    if (waStatus === 'connected' && groupId) {
      const alertData = {
        route: alert.routeNumber || 'N/A',
        type: alert.vendor || 'Alert',
        store: `${alert.storeName} #${alert.storeNumber}`,
        message: `${alert.city} — Ref: ${alert.refNumber}`,
        timestamp: formatDate(alert.dateReceived),
      };
      setWaSending(`alert-${alert.refNumber}`);
      try {
        await sendWhatsAppAlert(groupId, alertData);
        setWaSending(null);
        return;
      } catch (err) {
        console.warn('WhatsApp API send failed, falling back to wa.me:', err.message);
        setWaSending(null);
      }
    }

    // If connected but no group mapped, prompt to configure
    if (waStatus === 'connected' && !groupId) {
      setShowWaSettings(true);
      return;
    }

    // Fallback: open wa.me with pre-filled text
    const lines = [
      `Service Alert - Route ${alert.routeNumber || 'N/A'}`,
      `Store: ${alert.storeName} #${alert.storeNumber}`,
      `City: ${alert.city}`,
      `Vendor: ${alert.vendor}`,
      `Ref: ${alert.refNumber}`,
      `Date: ${formatDate(alert.dateReceived)}`,
    ];
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  // Auto-clear: label all clearable alerts as completed in one step
  // Eligible: resolved 48h+ OR globalworxDone 48h+ (not yet labeled completed)
  async function handleAutoClear() {
    const eligible = enrichedAlerts.filter(a => {
      if (a.globalworxCompleted) return false;
      if (!a.globalworxDone) return false;
      if (!a.acceptanceUrl) return false;
      return true;
    });
    if (eligible.length === 0) {
      alert('No alerts to auto-clear. Alerts must be Done and have an acceptance URL.');
      return;
    }
    setAutoClearing(true);
    try {
      // Use the same Puppeteer flow as autoCompleteAlerts — clicks "Complete Here" on
      // GlobalWorx first, then labels Gmail as Completed only if the button was pressed
      await autoCompleteAlerts(eligible);
      fetchGmailAlerts();
    } catch (err) {
      alert(`Failed to auto-clear: ${err.message}`);
    } finally {
      setAutoClearing(false);
    }
  }

  // Auto-accept: send all unaccepted alerts to GlobalWorx backend for acceptance
  async function handleAutoAccept() {
    if (autoAcceptCount === 0) {
      alert('No alerts to auto-accept. Alerts must have an acceptance URL and not already be accepted.');
      return;
    }
    setAutoAccepting(true);
    try {
      const result = await autoAcceptAlerts();
      if (result.accepted > 0) {
        // Refresh alerts to pick up new "Processed" labels
        await fetchGmailAlerts();
      }
      alert(`Auto-Accept: ${result.accepted} accepted, ${result.failed} failed out of ${result.total}`);
    } catch (err) {
      alert(`Auto-Accept failed: ${err.message}`);
    } finally {
      setAutoAccepting(false);
    }
  }

  // --- Check Status: checkbox selection + GW page inspection ---
  function isAlertCheckable(a) {
    return !a.globalworxCompleted;
  }

  function toggleAlertCheck(refNumber, e) {
    e.stopPropagation();
    setCheckedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(refNumber)) next.delete(refNumber);
      else next.add(refNumber);
      return next;
    });
  }

  function toggleRouteCheck(routeAlerts, e) {
    e.stopPropagation();
    const checkableRefs = routeAlerts.filter(a => isAlertCheckable(a)).map(a => a.refNumber);
    setCheckedAlerts(prev => {
      const next = new Set(prev);
      const allChecked = checkableRefs.every(ref => next.has(ref));
      if (allChecked) checkableRefs.forEach(ref => next.delete(ref));
      else checkableRefs.forEach(ref => next.add(ref));
      return next;
    });
  }

  async function handleCheckStatus() {
    if (checkedAlerts.size === 0) return;
    const selected = enrichedAlerts.filter(a =>
      checkedAlerts.has(a.refNumber) && !a.globalworxCompleted
    );
    if (selected.length === 0) {
      alert('No checkable alerts selected.');
      return;
    }
    setStatusChecking(true);
    try {
      const withUrl = selected.filter(a => a.acceptanceUrl);
      const noUrl = selected.filter(a => !a.acceptanceUrl);

      let stillActive = 0;
      let expired = 0;
      let errors = 0;

      // Check GW pages for alerts that have URLs
      if (withUrl.length > 0) {
        const payload = withUrl.map(a => ({
          url: a.acceptanceUrl,
          refNumber: a.refNumber,
          emailId: a.emailId,
        }));
        const { results } = await gwCheckStatus(payload);

        // No buttons at all → clear and label as Completed
        const noButtons = results.filter(r => !r.hasCompleteButton && !r.hasAcceptButton && !r.error);
        if (noButtons.length > 0) {
          const emailIds = noButtons.map(r => r.emailId).filter(Boolean);
          if (emailIds.length > 0) await labelAlertsCompleted(emailIds);
        }

        // Accept or Complete button still there → leave open
        stillActive = results.filter(r => r.hasCompleteButton || r.hasAcceptButton).length;
        expired = noButtons.length;
        errors = results.filter(r => r.error).length;
      }

      // Alerts without URLs — label as completed directly (no GW page to check)
      if (noUrl.length > 0) {
        const emailIds = noUrl.map(a => a.emailId).filter(Boolean);
        if (emailIds.length > 0) await labelAlertsCompleted(emailIds);
        expired += noUrl.length;
      }

      let msg = `Check Status: ${expired} closed`;
      if (stillActive > 0) msg += `, ${stillActive} still active on GW`;
      if (errors > 0) msg += `, ${errors} errors`;
      alert(msg);

      setCheckedAlerts(new Set());
      if (expired > 0) await fetchGmailAlerts();
    } catch (err) {
      alert(`Check Status failed: ${err.message}`);
    } finally {
      setStatusChecking(false);
    }
  }

  async function handleSendReportWhatsApp(e, routeNumber, stats) {
    e.stopPropagation();
    const groupId = getRouteGroupId(routeNumber);
    if (!groupId) {
      setShowWaSettings(true);
      return;
    }
    setWaSending(`report-${routeNumber}`);
    try {
      await sendWhatsAppReport(groupId, routeNumber, stats);
    } catch (err) {
      console.error('Failed to send report via WhatsApp:', err.message);
      alert('Failed to send report: ' + err.message);
    }
    setWaSending(null);
  }

  // Refresh groups list
  async function handleRefreshGroups() {
    try {
      const groups = await getWhatsAppGroups();
      setWaGroups(groups);
    } catch (err) {
      console.error('Failed to fetch groups:', err.message);
    }
  }

  function handleToggleImage(e, alert) {
    e.stopPropagation();
    const eid = alert.emailId;
    if (!eid) return;
    if (expandedImage === eid) {
      setExpandedImage(null);
      return;
    }
    setExpandedImage(eid);
    // Fetch if not already cached
    if (!alertImages[eid]) {
      loadAlertImage(eid);
    }
  }

  function handleDownloadImage(e, imgData) {
    e.stopPropagation();
    if (imgData.isExternal) {
      // External URL — open in new tab for manual save
      window.open(imgData.dataUri, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = imgData.dataUri;
      a.download = imgData.filename || 'alert-image.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  async function handleFetchByDate(dateOverride) {
    // Use the active quick filter to determine fetch date range
    let dateToFetch = dateOverride || alertDate;
    if (!dateOverride && filterDate) {
      if (filterDate === 'this-week') {
        const now = new Date();
        const day = now.getDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        const monday = new Date(); monday.setDate(now.getDate() - mondayOffset);
        dateToFetch = localDateStr(monday);
      } else if (filterDate === 'last-week') {
        const now = new Date();
        const day = now.getDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        const lastMonday = new Date(); lastMonday.setDate(now.getDate() - mondayOffset - 7);
        dateToFetch = localDateStr(lastMonday);
      } else {
        dateToFetch = filterDate; // today, yesterday, dayBefore
      }
    } else if (!dateOverride && filterDate === null) {
      // "All" — fetch last 30 days
      dateToFetch = null;
    }
    if (dateOverride) setAlertDate(dateOverride);
    setFetching(true);
    try {
      if (!isGmailConnected()) {
        await signInWithGoogle();
      }
      await fetchGmailAlerts(dateToFetch);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
    setFetching(false);
  }

  function handleRefresh() {
    setRefreshing(true);
    syncFromGithub();
  }

  // Stop refreshing spinner when sync finishes
  useEffect(() => {
    if (refreshing && (syncStatus === 'saved' || syncStatus === 'error' || syncStatus === 'idle')) {
      setRefreshing(false);
    }
  }, [syncStatus, refreshing]);

  // Helper: get Monday of the week containing a date
  function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  }

  // Helper: find the scheduled day for a store by checking all schedule weeks for the route
  function getScheduleDay(storeId, routeNum) {
    if (!storeId || !routeNum || !schedules) return null;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    // Search all schedule keys for this route (most recent week first)
    const routeKeys = Object.keys(schedules)
      .filter(k => k.startsWith(`${routeNum}_`))
      .sort((a, b) => b.localeCompare(a));
    for (const key of routeKeys) {
      const sched = schedules[key];
      if (!sched) continue;
      for (const day of days) {
        if (sched[day] && sched[day].some(s => s.storeId === storeId)) {
          return day.charAt(0).toUpperCase() + day.slice(1);
        }
      }
    }
    return null;
  }

  // Helper: count alerts for a specific store this month
  function getStoreMonthlyStats(storeId) {
    if (!storeId) return null;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const storeAlerts = enrichedAlerts.filter(a =>
      (a.storeId === storeId) && a.dateReceived && a.dateReceived >= monthStart
    );
    if (storeAlerts.length === 0) return null;
    const earliest = storeAlerts.reduce((min, a) => a.dateReceived < min ? a.dateReceived : min, storeAlerts[0].dateReceived);
    return { count: storeAlerts.length, since: earliest };
  }

  async function generateRoutePDF(e, route, routeAlerts) {
    e.stopPropagation();
    setPdfGenerating(route);

    try {
      // --- 0. Scrape GW details for alerts missing them ---
      const needScrape = routeAlerts.filter(a => a.acceptanceUrl && !a.gwCreatedBy);
      if (needScrape.length > 0) {
        console.log(`[PDF] Scraping GW details for ${needScrape.length} alert(s) missing data...`);
        try {
          const payload = needScrape.map(a => ({ url: a.acceptanceUrl, refNumber: a.refNumber }));
          const { results } = await gwScrapeDetails(payload);
          results.forEach(r => {
            if (r.alertDetails) {
              const alert = routeAlerts.find(a => a.refNumber === r.refNumber);
              if (alert) {
                const d = r.alertDetails.details || {};
                if (d['Created By']) alert.gwCreatedBy = d['Created By'];
                if (d['Alert Type']) alert.gwAlertType = d['Alert Type'];
                if (d['Reason']) alert.gwReason = d['Reason'];
              }
            }
          });
          console.log(`[PDF] Scraped ${results.filter(r => r.alertDetails).length}/${needScrape.length} alerts`);
        } catch (err) {
          console.warn('[PDF] GW scrape unavailable — Details column will be empty:', err.message);
        }
      }

      // --- 1. Gather images for all alerts ---
      const alertsWithEmail = routeAlerts.filter(a => a.emailId);
      const gmailOk = isGmailConnected();
      const imageResults = {};
      let fetchFails = 0;

      const fetchPromises = alertsWithEmail.map(async (a) => {
        const cached = alertImages[a.emailId];
        if (cached && cached.dataUri && !cached.loading) {
          imageResults[a.emailId] = cached;
          return;
        }
        if (!gmailOk) { fetchFails++; return; }
        try {
          const result = await fetchAlertImage(a.emailId);
          if (result && result.dataUri) {
            imageResults[a.emailId] = result;
          } else { fetchFails++; }
        } catch (err) {
          fetchFails++;
          console.warn(`Image fetch failed for ${a.emailId}:`, err);
        }
      });
      await Promise.allSettled(fetchPromises);

      // --- 2. Convert images to embeddable base64 & get dimensions ---
      const processedImages = {};

      async function fetchViaProxy(url) {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error(`Proxy returned ${resp.status}`);
        const blob = await resp.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      async function processOneImage(emailId, imgData) {
        let base64Uri = imgData.dataUri;

        if (imgData.isExternal) {
          try {
            const resp = await fetch(imgData.dataUri);
            const blob = await resp.blob();
            base64Uri = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (_) {
            try {
              base64Uri = await fetchViaProxy(imgData.dataUri);
            } catch (_2) {
              try {
                base64Uri = await new Promise((resolve, reject) => {
                  const el = new Image();
                  el.crossOrigin = 'anonymous';
                  el.onload = () => {
                    try {
                      const c = document.createElement('canvas');
                      c.width = el.naturalWidth;
                      c.height = el.naturalHeight;
                      c.getContext('2d').drawImage(el, 0, 0);
                      resolve(c.toDataURL('image/jpeg', 0.9));
                    } catch (ce) { reject(ce); }
                  };
                  el.onerror = reject;
                  el.src = imgData.dataUri;
                });
              } catch (_3) {
                console.warn(`All image strategies failed for ${emailId}`);
                return;
              }
            }
          }
        }

        return new Promise((resolve) => {
          const el = new Image();
          el.onload = () => {
            processedImages[emailId] = { base64Uri, width: el.naturalWidth, height: el.naturalHeight };
            resolve();
          };
          el.onerror = () => {
            console.warn(`Dimension load failed for ${emailId}`);
            resolve();
          };
          el.src = base64Uri;
        });
      }

      await Promise.all(
        Object.entries(imageResults).map(([eid, data]) => processOneImage(eid, data))
      );

      const imgCount = Object.keys(processedImages).length;
      if (alertsWithEmail.length > 0 && imgCount === 0) {
        if (!gmailOk) {
          window.alert('Gmail is not connected — images could not be fetched.\n\nPlease sign in to Gmail first, then try again.');
        } else {
          window.alert('No images could be loaded for this route.\n\nTry expanding an image in the alert list first, then generate the PDF.');
        }
      }

      // --- 3. Build the PDF (portrait, phone-optimized) ---
      const doc = new jsPDF('portrait', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      // Title
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(route === 'Unmatched' ? 'Unmatched — Service Alerts' : `Route ${route} — Service Alerts`, pageWidth / 2, 12, { align: 'center' });

      // Subtitle
      const open = routeAlerts.filter(a => a.status === 'unresolved').length;
      const resolved = routeAlerts.filter(a => a.status === 'resolved').length;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`${todayStr} | ${routeAlerts.length} alerts | ${open} open | ${resolved} resolved`, pageWidth / 2, 17, { align: 'center' });

      // Build table rows — columns:
      // Store (name + address), Details (Created By, Reason, Location), Last Svc, Status, Response, Image
      const tableData = routeAlerts.map((a, i) => {
        // Store column: name #number + address + city
        const addr = a.store?.address || '';
        const storeCell = `${a.storeName} #${a.storeNumber}\n${addr}${addr && a.city ? ', ' : ''}${a.city || ''}`;

        // Details column: Created By + Reason (items + location) from GlobalWorx scrape
        const detailParts = [];
        if (a.gwCreatedBy) detailParts.push(`By: ${a.gwCreatedBy}`);
        if (a.gwReason) {
          // Reason may contain multiple lines like "Ad items: 2\nNon Ad items: 0\nTotal items: 2\nLocation: Shelf/In aisle"
          // or "Consolidate/Loose product\nLocation: Back room"
          detailParts.push(a.gwReason);
        }
        if (a.gwAlertType && !detailParts.some(p => p.includes(a.gwAlertType))) {
          detailParts.unshift(a.gwAlertType);
        }
        const detailsCell = detailParts.join('\n') || '';

        // Last Svc column: days since visit + schedule day
        const svcParts = [];
        if (a.daysSinceService !== null) svcParts.push(`${a.daysSinceService}d ago`);
        else svcParts.push('Never');
        const schedDay = getScheduleDay(a.storeId, a.routeNumber);
        if (schedDay) svcParts.push(`Sched: ${schedDay}`);
        const lastSvcCell = svcParts.join('\n');

        // Status
        const statusCell = a.status === 'resolved' ? 'Resolved' : a.status === 'unresolved' ? 'Open' : '?';

        // Response column: monthly stats for this store
        const monthStats = getStoreMonthlyStats(a.storeId);
        const responseParts = [];
        if (a.status === 'resolved') responseParts.push(`Resolved ${a.days}d`);
        else if (a.status === 'unresolved') responseParts.push(a.days !== null ? `${a.days}d waiting` : 'Waiting');
        else responseParts.push('No match');
        if (monthStats) {
          responseParts.push(`${monthStats.count} alert${monthStats.count > 1 ? 's' : ''} since ${formatDate(monthStats.since)}`);
        }
        const responseCell = responseParts.join('\n');

        return [
          i + 1,
          storeCell,
          detailsCell,
          lastSvcCell,
          statusCell,
          responseCell,
          '', // image placeholder
        ];
      });

      autoTable(doc, {
        startY: 21,
        head: [['#', 'Store', 'Details', 'Last Svc', 'Status', 'Response', 'Image']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 7, fontStyle: 'bold', cellPadding: 1.5 },
        bodyStyles: { fontSize: 6.5, minCellHeight: 28, cellPadding: 1.5, lineHeightFactor: 1.3 },
        columnStyles: {
          0: { cellWidth: 7, halign: 'center' },
          1: { cellWidth: 38 },
          2: { cellWidth: 40 },
          3: { cellWidth: 18 },
          4: { cellWidth: 13, halign: 'center' },
          5: { cellWidth: 32 },
          6: { cellWidth: 38 },
        },
        margin: { left: 7, right: 7 },
        tableWidth: pageWidth - 14,
        didParseCell: function (data) {
          if (data.section !== 'body') return;
          const a = routeAlerts[data.row.index];
          if (!a) return;
          // Status column (4)
          if (data.column.index === 4) {
            data.cell.styles.fontStyle = 'bold';
            if (a.status === 'resolved') data.cell.styles.textColor = [34, 197, 94];
            else if (a.status === 'unresolved') data.cell.styles.textColor = [239, 68, 68];
            else data.cell.styles.textColor = [156, 163, 175];
          }
          // Last Service column (3)
          if (data.column.index === 3) {
            if (a.daysSinceService === null) data.cell.styles.textColor = [156, 163, 175];
            else if (a.daysSinceService > 14) data.cell.styles.textColor = [239, 68, 68];
            else if (a.daysSinceService > 7) data.cell.styles.textColor = [249, 115, 22];
            else data.cell.styles.textColor = [34, 197, 94];
            data.cell.styles.fontStyle = 'bold';
          }
          // Response column (5)
          if (data.column.index === 5) {
            if (a.status === 'resolved') data.cell.styles.textColor = [34, 197, 94];
            else if (a.status === 'unresolved') data.cell.styles.textColor = a.days > 7 ? [239, 68, 68] : [249, 115, 22];
            else data.cell.styles.textColor = [156, 163, 175];
            data.cell.styles.fontStyle = 'bold';
          }
          // Details column (2) — slightly smaller font for dense content
          if (data.column.index === 2) {
            data.cell.styles.fontSize = 6;
          }
        },
        didDrawCell: function (data) {
          // Embed thumbnail in Image column (6)
          if (data.section !== 'body' || data.column.index !== 6) return;
          const a = routeAlerts[data.row.index];
          const img = a ? processedImages[a.emailId] : null;
          if (!img) return;

          const pad = 1;
          const cellX = data.cell.x + pad;
          const cellY = data.cell.y + pad;
          const maxW = data.cell.width - pad * 2;
          const maxH = data.cell.height - pad * 2;
          const aspect = img.width / img.height;
          let drawW, drawH;
          if (maxW / maxH > aspect) { drawH = maxH; drawW = drawH * aspect; }
          else { drawW = maxW; drawH = drawW / aspect; }
          const drawX = cellX + (maxW - drawW) / 2;
          const drawY = cellY + (maxH - drawH) / 2;

          try {
            const fmt = img.base64Uri.match(/^data:image\/png/) ? 'PNG' : 'JPEG';
            doc.addImage(img.base64Uri, fmt, drawX, drawY, drawW, drawH);
          } catch (_) {}
        },
      });

      // Footer on all pages
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Generated ${todayStr} — Map Tracker — Page ${i}/${pageCount}`,
          pageWidth / 2, pageHeight - 5, { align: 'center' }
        );
      }

      const dateSlug = localDateStr();
      doc.save(`Route_${route}_Alerts_${dateSlug}.pdf`);
      markRouteSent(routeAlerts);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setPdfGenerating(null);
    }
  }

  // ── Route Report Card PDF ─────────────────────────────────────────────────
  async function generateRouteReportCard(e, routeNumber) {
    e.stopPropagation();
    setReportGenerating(routeNumber);
    try {
      // --- Data aggregation (last 7 days) ---
      const reportDays = 7;
      const cutoffDate = (() => { const d = new Date(); d.setDate(d.getDate() - reportDays); return localDateStr(d); })();
      const reportEnd = localDateStr();
      const reportStart = cutoffDate;
      const routeStores = stores.filter(s => s.routeNumber === routeNumber);
      const routeAlerts = enrichedAlerts.filter(a => a.routeNumber === routeNumber && a.dateReceived && a.dateReceived >= cutoffDate);
      const totalStores = routeStores.length;

      // Driver & vehicle
      const vehicle = (fleetVehicles || []).find(v => v.routeNumber === routeNumber);
      const driverName = routeStores.find(s => s.driver)?.driver || `Route ${routeNumber} Driver`;
      const vehicleDesc = vehicle?.yearMakeModel || 'N/A';
      const licensePlate = vehicle?.licensePlate ? vehicle.licensePlate.split(' ')[0] : 'N/A';

      // --- Mileage from travelLog (driving segments only) ---
      let totalMiles = 0, storeStops = 0, warehouseStops = 0, drivingSegments = 0;
      if (vehicle) {
        const vin = vehicle.vin;
        for (let i = 0; i < reportDays; i++) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const dateKey = localDateStr(d);
          const entries = ((travelLog || {})[dateKey] || {})[vin] || [];
          entries.forEach(entry => {
            if (entry.type === 'driving') { totalMiles += (entry.distance || 0); drivingSegments++; }
            else if (entry.type === 'store') storeStops++;
            else if (entry.type === 'warehouse') warehouseStops++;
          });
        }
      }

      // --- Fuel data from Motive API ---
      let fuelSpend = 0, fuelGallons = 0, fuelTxCount = 0;
      try {
        const [txs, motiveVehicles] = await Promise.all([
          fetchCardTransactions({ startDate: reportStart, endDate: reportEnd }),
          fetchVehicles(),
        ]);
        // Build motiveVehicleId → routeNumber map via VIN
        const vinRouteMap = {};
        (fleetVehicles || []).forEach(v => { vinRouteMap[v.vin] = v.routeNumber; });
        const motiveIdRouteMap = {};
        motiveVehicles.forEach(v => {
          const route = vinRouteMap[v.vin];
          if (route && v.id) motiveIdRouteMap[String(v.id)] = route;
        });
        // Also load manual card-route assignments from localStorage
        let cardRouteMap = {};
        try { cardRouteMap = JSON.parse(localStorage.getItem('fuel_card_route_map') || '{}'); } catch {}
        // Filter transactions for this route
        txs.forEach(tx => {
          let txRoute = null;
          if (tx.cardId && cardRouteMap[tx.cardId]) txRoute = cardRouteMap[tx.cardId];
          else if (tx.vehicleId && motiveIdRouteMap[String(tx.vehicleId)]) txRoute = motiveIdRouteMap[String(tx.vehicleId)];
          if (txRoute === routeNumber && !tx.declined) {
            fuelSpend += tx.totalAmount;
            fuelGallons += tx.totalGallons;
            fuelTxCount++;
          }
        });
      } catch (fuelErr) {
        console.warn('Could not fetch fuel data for report:', fuelErr.message);
      }
      const mpg = totalMiles > 0 && fuelGallons > 0 ? (totalMiles / fuelGallons) : null;
      const costPerMile = totalMiles > 0 && fuelSpend > 0 ? (fuelSpend / totalMiles) : null;

      // Alert stats
      const openAlerts = routeAlerts.filter(a => a.status === 'unresolved');
      const resolvedAlerts = routeAlerts.filter(a => a.status === 'resolved');
      const resolvedWithDays = resolvedAlerts.filter(a => a.days !== null);
      const avgResponse = resolvedWithDays.length > 0
        ? Math.round(resolvedWithDays.reduce((s, a) => s + a.days, 0) / resolvedWithDays.length * 10) / 10
        : null;
      const resolutionRate = routeAlerts.length > 0
        ? Math.round(resolvedAlerts.length / routeAlerts.length * 100) : 100;

      // GW pipeline
      const gwCompleted = routeAlerts.filter(a => a.globalworxCompleted).length;
      const gwRate = routeAlerts.length > 0 ? Math.round(gwCompleted / routeAlerts.length * 100) : 100;

      // Visit coverage (last 7 days)
      let visitedInPeriod = 0;
      routeStores.forEach(s => {
        const latest = getLatestDate(s);
        if (!latest) return;
        const raw = latest.split('T')[0].split(' ')[0];
        if (raw >= cutoffDate) visitedInPeriod++;
      });
      const visitCoverage = totalStores > 0 ? Math.round(visitedInPeriod / totalStores * 100) : 0;

      // Alert score
      const alertsPerStore = totalStores > 0 ? routeAlerts.length / totalStores : 0;
      const alertScore = Math.max(0, Math.round(100 - alertsPerStore * 25));

      // Composite grade
      const compositeScore = computeDriverScore(routeNumber, { stores, travelLog: travelLog || {}, visitHistory: visitHistory || {}, schedules: schedules || {}, alerts, fleetVehicles: fleetVehicles || [] });
      const overallGrade = compositeScore.grade;
      const overallPct = compositeScore.overall;

      // Response distribution
      let fastCount = 0, mediumCount = 0, slowCount = 0;
      resolvedWithDays.forEach(a => { if (a.days <= 3) fastCount++; else if (a.days <= 7) mediumCount++; else slowCount++; });

      // Repeat offenders
      const storeAlertCounts = {};
      routeAlerts.forEach(a => {
        const sid = a.storeId || a.storeName;
        if (!storeAlertCounts[sid]) storeAlertCounts[sid] = { name: a.storeName, city: a.city, id: a.storeId, total: 0, open: 0, daysList: [] };
        storeAlertCounts[sid].total++;
        if (a.status === 'unresolved') storeAlertCounts[sid].open++;
        if (a.days !== null) storeAlertCounts[sid].daysList.push(a.days);
      });
      const repeatOffenders = Object.values(storeAlertCounts)
        .filter(s => s.total >= 2)
        .sort((a, b) => b.total - a.total)
        .map(s => ({ ...s, avgResponse: s.daysList.length > 0 ? Math.round(s.daysList.reduce((sum, d) => sum + d, 0) / s.daysList.length * 10) / 10 : null }));

      // Most missed store
      const mostMissed = Object.values(storeAlertCounts).sort((a, b) => b.open - a.open || b.total - a.total)[0] || null;

      // Overdue / out-of-date stores (not visited within report period)
      const overdueStores = routeStores
        .map(s => {
          const latest = getLatestDate(s);
          const days = getDaysSinceVisit(latest);
          const hasOpenAlert = routeAlerts.some(a => a.storeId === (s.id || s.storeId) && a.status === 'unresolved');
          const severity = days === null ? 'never' : days >= 30 ? 'critical' : days >= 14 ? 'overdue' : days > 7 ? 'due' : null;
          return { name: s.name || s.storeName, city: s.city, lastVisit: latest, days, severity, hasOpenAlert, id: s.id || s.storeId };
        })
        .filter(s => s.severity !== null)
        .sort((a, b) => (b.days || 9999) - (a.days || 9999));

      // Schedule compliance
      const adherence = getScheduleAdherence(schedules || {}, routeNumber, visitHistory || {});

      // Weekly trend
      const trend = getWeeklyTrend(routeNumber, { schedules: schedules || {}, visitHistory: visitHistory || {} });

      // Store visit summary
      const storeVisitSummary = routeStores.map(s => {
        const latest = getLatestDate(s);
        const days = getDaysSinceVisit(latest);
        return { name: s.name || s.storeName, city: s.city, lastVisit: latest ? latest.split('T')[0].split(' ')[0] : null, lastSale: s.lastSaleDate ? s.lastSaleDate.split('T')[0].split(' ')[0] : null, daysSince: days };
      }).sort((a, b) => (b.daysSince || 9999) - (a.daysSince || 9999));

      // Top chains
      const chainCounts = {};
      routeAlerts.forEach(a => { const chain = (a.storeName || '').replace(/\s*#?\d+\s*$/, '').trim() || 'Unknown'; chainCounts[chain] = (chainCounts[chain] || 0) + 1; });
      const topChains = Object.entries(chainCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // Recommendations
      const recommendations = [];
      const criticalStores = overdueStores.filter(s => s.severity === 'critical' || s.severity === 'never');
      criticalStores.filter(s => s.hasOpenAlert).slice(0, 3)
        .forEach(s => { recommendations.push(`Visit ${s.name} ASAP — ${s.days || '?'} days overdue with open alert`); });
      if (criticalStores.length > 0) recommendations.push(`${criticalStores.length} store${criticalStores.length > 1 ? 's' : ''} are critical (30+ days or never visited)`);
      const unvisited30 = routeStores.filter(s => { const days = getDaysSinceVisit(getLatestDate(s)); return days === null || days >= 30; }).length;
      if (unvisited30 > 0 && unvisited30 !== criticalStores.length) recommendations.push(`${unvisited30} store${unvisited30 > 1 ? 's' : ''} haven't been visited in 30+ days`);
      if (gwRate < 50 && routeAlerts.length > 0) recommendations.push(`GW completion rate at ${gwRate}% — ${routeAlerts.length - gwCompleted} pending completions`);
      if (repeatOffenders.length > 0) recommendations.push(`${repeatOffenders.length} repeat offender store${repeatOffenders.length > 1 ? 's' : ''} need attention`);
      if (adherence && adherence.adherence < 70) recommendations.push(`Schedule adherence is ${adherence.adherence}% — ${adherence.missed} missed stops this week`);
      if (costPerMile !== null && costPerMile > 0.50) recommendations.push(`Fuel cost is $${costPerMile.toFixed(2)}/mile — review route efficiency`);
      if (mpg !== null && mpg < 8) recommendations.push(`Low MPG (${mpg.toFixed(1)}) — check vehicle maintenance or driving habits`);
      if (recommendations.length === 0) recommendations.push('Route is performing well — maintain current pace');

      // --- Build PDF (compact 2-page layout) ---
      const doc = new jsPDF('portrait', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const m = 10; // tight margins
      const cw = pageWidth - m * 2;
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const tbl = { margin: { left: m, right: m }, headStyles: { fillColor: [51, 65, 85], fontSize: 6.5, fontStyle: 'bold', cellPadding: 1.5 }, bodyStyles: { fontSize: 6.5, cellPadding: 1.5 } };
      let y = 10;

      // ═══ PAGE 1: Overview + Alerts + Schedule ═══

      // Header bar
      const gradeColors = { A: [16, 185, 129], B: [59, 130, 246], C: [234, 179, 8], D: [249, 115, 22], F: [239, 68, 68] };
      const gc = gradeColors[overallGrade.letter] || [156, 163, 175];
      // Grade circle (left)
      doc.setFillColor(gc[0], gc[1], gc[2]);
      doc.circle(m + 8, y + 6, 7, 'F');
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255);
      doc.text(overallGrade.letter, m + 8, y + 8, { align: 'center' });
      doc.setFontSize(5.5); doc.text(`${overallPct}%`, m + 8, y + 11.5, { align: 'center' });
      doc.setTextColor(0);
      // Title (center)
      doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      const startFmt = new Date(reportStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endFmt = new Date(reportEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      doc.text(`Route ${routeNumber} — Weekly Report Card`, m + 22, y + 4);
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
      doc.text(`${startFmt} – ${endFmt}  |  ${driverName}  |  ${vehicleDesc} (${licensePlate})`, m + 22, y + 9);
      doc.setTextColor(0);
      y += 16;
      doc.setDrawColor(200); doc.line(m, y, pageWidth - m, y); y += 3;

      // Key metrics row
      autoTable(doc, {
        startY: y,
        head: [['Alert Score', 'Avg Response', 'Resolution', 'GW Complete', 'Visited (7d)', 'Stores']],
        body: [[`${alertScore}/100`, avgResponse !== null ? `${avgResponse}d` : 'N/A', `${resolutionRate}%`, `${gwRate}%`, `${visitCoverage}%`, `${totalStores}`]],
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 6, fontStyle: 'bold', halign: 'center', cellPadding: 1.5 },
        bodyStyles: { fontSize: 9, fontStyle: 'bold', halign: 'center', cellPadding: 3 },
        margin: { left: m, right: m }, tableWidth: cw,
      });
      y = doc.lastAutoTable.finalY + 2;

      // Truck & operations row
      autoTable(doc, {
        startY: y,
        head: [['Miles Driven', 'Fuel Cost', 'Gallons', 'MPG', '$/Mile', 'Store Stops', 'WH Stops']],
        body: [[
          totalMiles > 0 ? `${Math.round(totalMiles)} mi` : 'No data',
          fuelSpend > 0 ? `$${fuelSpend.toFixed(2)}` : 'No data',
          fuelGallons > 0 ? `${fuelGallons.toFixed(1)} gal` : '—',
          mpg !== null ? mpg.toFixed(1) : '—',
          costPerMile !== null ? `$${costPerMile.toFixed(2)}` : '—',
          `${storeStops}`,
          `${warehouseStops}`,
        ]],
        theme: 'grid',
        headStyles: { fillColor: [15, 118, 110], fontSize: 6, fontStyle: 'bold', halign: 'center', cellPadding: 1.5 },
        bodyStyles: { fontSize: 8, fontStyle: 'bold', halign: 'center', cellPadding: 2.5 },
        margin: { left: m, right: m }, tableWidth: cw,
      });
      y = doc.lastAutoTable.finalY + 3;

      // Score breakdown + Store health side by side (two mini tables)
      const breakdownLabels = { scheduleAdherence: 'Schedule', storeCoverage: 'Coverage', alertResponse: 'Alerts', efficiency: 'Efficiency' };
      const breakdownRows = Object.entries(compositeScore.breakdown).map(([key, val]) => [breakdownLabels[key] || key, `${val.weight}%`, val.score !== null ? `${val.score}` : '—']);
      const statusCounts = getStatusCounts(routeStores);

      // Left table: Score breakdown
      autoTable(doc, {
        startY: y, head: [['Category', 'Wt', 'Score']], body: breakdownRows, theme: 'striped', ...tbl,
        margin: { left: m, right: pageWidth / 2 + 2 },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      });
      const leftY = doc.lastAutoTable.finalY;
      // Right table: Store health
      autoTable(doc, {
        startY: y, head: [['≤7d', '1wk', '2wk', '30d+', 'Never', 'Dorm']],
        body: [[statusCounts.onTrack, statusCounts.overdue1, statusCounts.overdue2, statusCounts.critical, statusCounts.never, statusCounts.dormant]],
        theme: 'grid', headStyles: { fillColor: [51, 65, 85], fontSize: 6, fontStyle: 'bold', halign: 'center', cellPadding: 1.5 },
        bodyStyles: { fontSize: 8, fontStyle: 'bold', halign: 'center', cellPadding: 2.5 },
        margin: { left: pageWidth / 2 + 2, right: m },
        didParseCell: function(data) {
          if (data.section === 'body') {
            const c = [[34,197,94],[249,115,22],[239,68,68],[127,29,29],[156,163,175],[156,163,175]];
            if (c[data.column.index]) data.cell.styles.textColor = c[data.column.index];
          }
        },
      });
      y = Math.max(leftY, doc.lastAutoTable.finalY) + 3;

      // Alert summary line
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');
      doc.text('ALERTS', m, y + 1);
      doc.setFont('helvetica', 'normal');
      let alertLine = `Total: ${routeAlerts.length}  |  Open: ${openAlerts.length}  |  Resolved: ${resolvedAlerts.length}  |  Completed: ${gwCompleted}`;
      if (mostMissed && mostMissed.total > 0) alertLine += `  |  Most Missed: ${mostMissed.name} (${mostMissed.open} open)`;
      alertLine += `  |  Response: Fast ${fastCount} / Med ${mediumCount} / Slow ${slowCount}`;
      doc.text(alertLine, m + 16, y + 1);
      y += 4;

      // Repeat offenders (compact)
      if (repeatOffenders.length > 0) {
        autoTable(doc, {
          startY: y, head: [['Repeat Offenders (2+)', 'City', 'Tot', 'Open', 'Avg']],
          body: repeatOffenders.slice(0, 10).map(s => [s.name, s.city, s.total, s.open, s.avgResponse !== null ? `${s.avgResponse}d` : '—']),
          theme: 'grid', ...tbl, headStyles: { ...tbl.headStyles, fillColor: [220, 38, 38] },
          columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
          didParseCell: function(data) { if (data.section === 'body' && data.column.index === 3 && parseInt(data.cell.raw) > 0) data.cell.styles.textColor = [239, 68, 68]; },
        });
        y = doc.lastAutoTable.finalY + 3;
      }

      // Schedule compliance + Weekly trend side by side
      if (adherence || trend.some(t => t.adherence !== null)) {
        const hasAdh = !!adherence;
        const hasTrend = trend.some(t => t.adherence !== null);
        if (hasAdh) {
          autoTable(doc, {
            startY: y, head: [['Schedule', 'On Time', 'Same Wk', 'Missed', 'Future', '%']],
            body: [[adherence.total, adherence.exact, adherence.sameWeek, adherence.missed, adherence.future, `${adherence.adherence}%`]],
            theme: 'grid', headStyles: { fillColor: [59, 130, 246], fontSize: 6, fontStyle: 'bold', halign: 'center', cellPadding: 1.5 },
            bodyStyles: { fontSize: 7, fontStyle: 'bold', halign: 'center', cellPadding: 2 },
            margin: { left: m, right: hasTrend ? pageWidth / 2 + 2 : m },
          });
        }
        if (hasTrend) {
          autoTable(doc, {
            startY: y, head: [['Week', 'Adherence', 'Done/Total']],
            body: trend.map(t => [t.weekOf, t.adherence !== null ? `${t.adherence}%` : '—', t.detail ? `${t.detail.completed}/${t.detail.total}` : '—']),
            theme: 'striped', ...tbl, headStyles: { ...tbl.headStyles, fillColor: [59, 130, 246] },
            margin: { left: hasAdh ? pageWidth / 2 + 2 : m, right: m },
            columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
          });
        }
        y = doc.lastAutoTable.finalY + 3;
      }

      // Out-of-date stores (with severity and alert status)
      if (overdueStores.length > 0) {
        const critCount = overdueStores.filter(s => s.severity === 'critical' || s.severity === 'never').length;
        const overdueCount = overdueStores.filter(s => s.severity === 'overdue').length;
        const dueCount = overdueStores.filter(s => s.severity === 'due').length;
        const headerLabel = `Out-of-Date Stores (${overdueStores.length}) — ${critCount} critical, ${overdueCount} overdue, ${dueCount} due`;
        autoTable(doc, {
          startY: y, head: [['Store', 'City', 'Status', 'Last Visit', 'Days', 'Alert']],
          body: overdueStores.slice(0, 20).map(s => [
            s.name, s.city,
            s.severity === 'never' ? 'NEVER' : s.severity === 'critical' ? 'CRITICAL' : s.severity === 'overdue' ? 'OVERDUE' : 'DUE',
            s.lastVisit ? formatDate(s.lastVisit) : 'Never',
            s.days !== null ? `${s.days}d` : '—',
            s.hasOpenAlert ? 'OPEN' : '—',
          ]),
          theme: 'grid', ...tbl, headStyles: { ...tbl.headStyles, fillColor: [220, 38, 38] },
          columnStyles: { 2: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
          didParseCell: function(data) {
            if (data.section === 'body') {
              // Status column color
              if (data.column.index === 2) {
                const val = data.cell.raw;
                data.cell.styles.fontStyle = 'bold';
                if (val === 'NEVER' || val === 'CRITICAL') data.cell.styles.textColor = [127, 29, 29];
                else if (val === 'OVERDUE') data.cell.styles.textColor = [239, 68, 68];
                else data.cell.styles.textColor = [249, 115, 22];
              }
              // Days column
              if (data.column.index === 4) {
                const raw = data.cell.raw; if (raw === '—') data.cell.styles.textColor = [156,163,175];
                else { const d = parseInt(raw); data.cell.styles.textColor = d >= 30 ? [127,29,29] : d >= 14 ? [239,68,68] : [249,115,22]; }
                data.cell.styles.fontStyle = 'bold';
              }
              // Alert column
              if (data.column.index === 5 && data.cell.raw === 'OPEN') {
                data.cell.styles.textColor = [239, 68, 68]; data.cell.styles.fontStyle = 'bold';
              }
            }
          },
        });
        y = doc.lastAutoTable.finalY + 3;
      }

      // Recommendations (inline)
      if (y < pageHeight - 25) {
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.text('RECOMMENDATIONS', m, y + 1); y += 3;
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
        recommendations.forEach((rec, i) => { doc.text(`${i + 1}. ${rec}`, m + 1, y); y += 3.5; });
        y += 2;
      }

      // ═══ PAGE 2: All Stores + Chains ═══
      doc.addPage(); y = 10;
      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text(`Route ${routeNumber} — All Stores (${totalStores})`, m, y); y += 2;

      autoTable(doc, {
        startY: y, head: [['Store', 'City', 'Last Visit', 'Last Sale', 'Days']],
        body: storeVisitSummary.map(s => [s.name, s.city, s.lastVisit ? formatDate(s.lastVisit) : 'Never', s.lastSale ? formatDate(s.lastSale) : 'Never', s.daysSince !== null ? `${s.daysSince}d` : '—']),
        theme: 'grid', ...tbl,
        didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 4) {
            const raw = data.cell.raw; if (raw === '—') data.cell.styles.textColor = [156,163,175];
            else { const d = parseInt(raw); data.cell.styles.textColor = d <= 7 ? [34,197,94] : d <= 14 ? [249,115,22] : [239,68,68]; }
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
      y = doc.lastAutoTable.finalY + 4;

      // Chains table (if space)
      if (topChains.length > 0 && y < pageHeight - 30) {
        doc.setFontSize(8); doc.setFont('helvetica', 'bold');
        doc.text('Alerts by Chain', m, y); y += 2;
        autoTable(doc, {
          startY: y, head: [['Chain', 'Count']], body: topChains.map(([n, c]) => [n, c]),
          theme: 'grid', ...tbl, headStyles: { ...tbl.headStyles, fillColor: [6, 182, 212] },
          columnStyles: { 1: { halign: 'center' } },
        });
      }

      // Footer on all pages
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(150);
        doc.text(`Route ${routeNumber} Report — ${todayStr} — Map Tracker — ${i}/${pageCount}`, pageWidth / 2, pageHeight - 4, { align: 'center' });
      }
      doc.setTextColor(0);

      doc.save(`Route_${routeNumber}_Report_${localDateStr()}.pdf`);
    } catch (err) {
      console.error('Report card generation failed:', err);
    } finally {
      setReportGenerating(null);
    }
  }

  return (
    <div className="al-page">
      {/* Header */}
      <div className="al-header">
        <div className="al-title-row">
          <h2>Alert Log</h2>
          <span
            className={`al-wa-status al-wa-status--${waStatus}`}
            title={`WhatsApp: ${waStatus} — Click to configure groups`}
            onClick={() => { if (waStatus === 'connected') { handleRefreshGroups(); setShowWaSettings(!showWaSettings); } }}
            style={{ cursor: waStatus === 'connected' ? 'pointer' : 'default' }}
          >
            WA {waStatus === 'connected' ? 'ON' : waStatus === 'qr-pending' ? 'QR' : 'OFF'}
          </span>
          <div className="al-quick-dates">
            <button
              className={`al-quick-btn ${filterDate === null ? 'active' : ''}`}
              onClick={() => setFilterDate(null)}
            >All</button>
            <button
              className={`al-quick-btn ${filterDate === today ? 'active' : ''}`}
              onClick={() => setFilterDate(today)}
            >Today</button>
            <button
              className={`al-quick-btn ${filterDate === yesterday ? 'active' : ''}`}
              onClick={() => setFilterDate(yesterday)}
            >Yesterday</button>
            <button
              className={`al-quick-btn ${filterDate === dayBefore ? 'active' : ''}`}
              onClick={() => setFilterDate(dayBefore)}
            >Day Before</button>
            <button
              className={`al-quick-btn ${filterDate === 'this-week' ? 'active' : ''}`}
              onClick={() => setFilterDate('this-week')}
            >This Week</button>
            <button
              className={`al-quick-btn ${filterDate === 'last-week' ? 'active' : ''}`}
              onClick={() => setFilterDate('last-week')}
            >Last Week</button>
          </div>
          <div className="al-date-picker">
            <input
              type="date"
              className="al-date-input"
              value={alertDate}
              max={today}
              onChange={(e) => setAlertDate(e.target.value)}
            />
            <button
              className="al-btn-fetch"
              onClick={() => handleFetchByDate()}
              disabled={fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Alerts'}
            </button>
            <button
              className="al-btn-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh Stores'}
            </button>
            <button
              className="al-btn-report"
              onClick={() => setPage('alertAnalytics')}
            >
              30-Day Report
            </button>
            <button
              className={`al-btn-stats ${showStats ? 'active' : ''}`}
              onClick={() => setShowStats(!showStats)}
            >
              {showStats ? 'Close Stats' : 'Statistics'}
            </button>
          </div>
          <div className="al-stats">
            <span className="al-stat red" title="Store not yet visited">{stats.open} <span>Open</span></span>
            <span className="al-stat green" title="Store visited after alert">{stats.resolved} <span>Resolved</span></span>
            {stats.unknown > 0 && <span className="al-stat gray" title="Store not found in data">{stats.unknown} <span>No Match</span></span>}
            <span className="al-stat gray">{stats.total} <span>Total</span></span>
            {stats.avgResponse !== null && <span className="al-stat gray" title="Average days between alert and store visit">{stats.avgResponse}d <span>Avg Response</span></span>}
            <span className="al-stat-divider" />
            <span className="al-stat blue" title="Accepted on GlobalWorx">{stats.accepted} <span>Accepted</span></span>
            <span className="al-stat teal" title="Store visited — awaiting GW completion">{stats.done} <span>Done</span></span>
            <span className="al-stat emerald" title="Completed on GlobalWorx">{stats.completed} <span>Completed</span></span>
            {autoAcceptCount > 0 && (
              <button
                className="al-btn-autoaccept"
                onClick={handleAutoAccept}
                disabled={autoAccepting}
                title={`${autoAcceptCount} alert(s) have acceptance URLs — auto-accept on GlobalWorx`}
              >
                {autoAccepting ? 'Accepting...' : `Auto-Accept ${autoAcceptCount}`}
              </button>
            )}
            {autoClearCount > 0 && (
              <button
                className="al-btn-autoclear"
                onClick={handleAutoClear}
                disabled={autoClearing}
                title={`${autoClearCount} Done alert(s) — click Complete on GlobalWorx and label as Completed`}
              >
                {autoClearing ? 'Clearing...' : `Auto-Clear ${autoClearCount}`}
              </button>
            )}
            {checkedAlerts.size > 0 && (
              <button
                className="al-btn-checkstatus"
                onClick={handleCheckStatus}
                disabled={statusChecking}
                title={`Check GlobalWorx status for ${checkedAlerts.size} selected alert(s)`}
              >
                {statusChecking ? 'Checking...' : `Check Status ${checkedAlerts.size}`}
              </button>
            )}
          </div>
        </div>

        {/* WhatsApp Group Mapping Settings */}
        {showWaSettings && waStatus === 'connected' && (
          <div className="al-wa-settings">
            <div className="al-wa-settings-header">
              <strong>WhatsApp Group Mapping</strong>
              <button className="al-wa-settings-close" onClick={() => setShowWaSettings(false)}>X</button>
            </div>
            <div className="al-wa-settings-body">
              {alertRoutes.length === 0 && <div style={{ color: '#9ca3af', fontSize: 12 }}>No routes found</div>}
              {alertRoutes.map(route => (
                <div key={route} className="al-wa-route-row">
                  <span className="al-wa-route-label">Route {route}</span>
                  <select
                    className="al-wa-group-select"
                    value={waGroupMap[route] || ''}
                    onChange={(e) => setRouteGroup(route, e.target.value || null)}
                  >
                    <option value="">— Select Group —</option>
                    {waGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  {waGroupMap[route] && <span className="al-wa-mapped-check">OK</span>}
                </div>
              ))}
              {waGroups.length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 6 }}>
                  No groups found. Make sure WhatsApp is connected and you belong to groups.
                </div>
              )}
              <button className="al-wa-refresh-btn" onClick={handleRefreshGroups}>
                Refresh Groups
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="al-filters">
          <div className="al-filter-group">
            <button className={`al-filter-btn ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => { setFilterStatus('all'); setExpandedRoutes(null); setCheckedAlerts(new Set()); }}>
              All ({stats.total})
            </button>
            <button className={`al-filter-btn red ${filterStatus === 'unresolved' ? 'active' : ''}`} onClick={() => { setFilterStatus('unresolved'); setExpandedRoutes(null); setCheckedAlerts(new Set()); }}>
              Open ({stats.open})
            </button>
            <button className={`al-filter-btn green ${filterStatus === 'resolved' ? 'active' : ''}`} onClick={() => { setFilterStatus('resolved'); setExpandedRoutes(null); setCheckedAlerts(new Set()); }}>
              Resolved ({stats.resolved})
            </button>
            {stats.completed > 0 && (
              <button className={`al-filter-btn ${showCompleted ? 'active' : ''}`} onClick={() => setShowCompleted(prev => !prev)} title="Toggle visibility of completed alerts">
                {showCompleted ? 'Hide' : 'Show'} Completed ({stats.completed})
              </button>
            )}
          </div>
          <div className="al-filter-group">
            <select className="al-select" value={filterRoute} onChange={e => setLocalFilterRoute(e.target.value)}>
              <option value="all">All Routes</option>
              {alertRoutes.map(r => <option key={r} value={r}>Route {r}</option>)}
            </select>
            <select className="al-select" value={filterVendor} onChange={e => setLocalFilterVendor(e.target.value)}>
              <option value="all">All Vendors</option>
              {alertVendors.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <input
              className="al-search"
              type="text"
              placeholder="Search store, city, ref..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Statistics Panel */}
      {showStats && (
        <div className="al-stats-panel">
          <div className="al-stats-panel-header">
            <h3>Alert Statistics</h3>
            <div className="al-stats-tabs">
              {[
                ['time', 'By Time'],
                ['route', 'By Route'],
                ['zone', 'By Zone'],
                ['chain', 'By Chain'],
                ['top', 'Top Stores'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`al-stats-tab ${statsTab === key ? 'active' : ''}`}
                  onClick={() => setStatsTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="al-stats-close" onClick={() => setShowStats(false)}>Close</button>
          </div>

          {/* Summary cards */}
          <div className="al-stats-summary">
            <div className="al-stats-card" title="Total number of service alert emails received">
              <span className="al-stats-card-value">{stats.total}</span>
              <span className="al-stats-card-label">Total</span>
            </div>
            <div className="al-stats-card red" title="Alerts where the store has not been visited since the alert date">
              <span className="al-stats-card-value">{stats.open}</span>
              <span className="al-stats-card-label">Open</span>
            </div>
            <div className="al-stats-card green" title="Alerts where the store was visited after the alert date (based on sales or visit data)">
              <span className="al-stats-card-value">{stats.resolved}</span>
              <span className="al-stats-card-label">Resolved</span>
            </div>
            <div className="al-stats-card" title="Percentage of alerts that have been resolved by a store visit">
              <span className="al-stats-card-value">{allStats.summary.resolutionRate}%</span>
              <span className="al-stats-card-label">Resolution Rate</span>
            </div>
            <div className="al-stats-card" title="Average number of alerts received per day">
              <span className="al-stats-card-value">{allStats.summary.avgPerDay}</span>
              <span className="al-stats-card-label">Avg / Day</span>
            </div>
            {allStats.summary.busiest && (
              <div className="al-stats-card" title="The day with the highest number of service alerts">
                <span className="al-stats-card-value">{allStats.summary.busiest.total}</span>
                <span className="al-stats-card-label">Peak: {formatDate(allStats.summary.busiest.key)}</span>
              </div>
            )}
          </div>
          {/* GlobalWorx pipeline cards */}
          <div className="al-stats-summary al-stats-gw">
            <div className="al-stats-card blue" title="Alert was accepted on GlobalWorx — issue acknowledged and 48-hour resolution window set">
              <span className="al-stats-card-value">{stats.accepted}</span>
              <span className="al-stats-card-label">GW Accepted</span>
            </div>
            <div className="al-stats-card teal" title="Store was visited after the alert — labeled 'Done' in Gmail, waiting for completion form to be submitted on GlobalWorx">
              <span className="al-stats-card-value">{stats.done}</span>
              <span className="al-stats-card-label">GW Done</span>
            </div>
            <div className="al-stats-card emerald" title="'Complete Here' button was clicked on GlobalWorx — the service issue is fully closed out">
              <span className="al-stats-card-value">{stats.completed}</span>
              <span className="al-stats-card-label">GW Completed</span>
            </div>
            <div className="al-stats-card" title="Percentage of all alerts that have been fully completed on GlobalWorx">
              <span className="al-stats-card-value">{stats.total > 0 ? Math.round(stats.completed / stats.total * 100) : 0}%</span>
              <span className="al-stats-card-label">Completion Rate</span>
            </div>
          </div>

          {/* === TIME TAB === */}
          {statsTab === 'time' && (
            <div className="al-stats-section">
              <div className="al-stats-section-header">
                <h4>Alert Volume Over Time</h4>
                <div className="al-stats-view-toggle">
                  {['day', 'week', 'month'].map(v => (
                    <button key={v} className={`al-quick-btn ${statsView === v ? 'active' : ''}`} onClick={() => setStatsView(v)}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="al-stats-legend">
                <span><span className="al-stats-legend-dot" style={{ background: '#ef4444' }} /> Open</span>
                <span><span className="al-stats-legend-dot" style={{ background: '#22c55e' }} /> Resolved</span>
                <span><span className="al-stats-legend-dot" style={{ background: '#06b6d4' }} /> Completed</span>
                <span><span className="al-stats-legend-dot" style={{ background: '#9ca3af' }} /> Unknown</span>
              </div>
              <div className="al-stats-chart">
                {(allStats.time[statsView] || []).length === 0 ? (
                  <div className="al-stats-empty">No data</div>
                ) : (() => {
                  const data = allStats.time[statsView];
                  const maxTotal = Math.max(...data.map(d => d.total));
                  return data.map(d => {
                    const label = statsView === 'day' ? formatDate(d.key)
                      : statsView === 'week' ? d.key
                      : new Date(d.key + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    return (
                      <div key={d.key} className="al-stats-row">
                        <span className="al-stats-row-label">{label}</span>
                        <div className="al-stats-row-bar-wrap">
                          <div className="al-stats-row-bar" style={{ width: `${(d.total / maxTotal) * 100}%` }}>
                            {d.open > 0 && <div className="al-stats-bar-segment" style={{ flex: d.open, background: '#ef4444' }} />}
                            {(d.resolved - (d.completed || 0)) > 0 && <div className="al-stats-bar-segment" style={{ flex: d.resolved - (d.completed || 0), background: '#22c55e' }} />}
                            {(d.completed || 0) > 0 && <div className="al-stats-bar-segment" style={{ flex: d.completed, background: '#06b6d4' }} />}
                            {(d.total - d.open - d.resolved) > 0 && <div className="al-stats-bar-segment" style={{ flex: d.total - d.open - d.resolved, background: '#9ca3af' }} />}
                          </div>
                        </div>
                        <span className="al-stats-row-count">
                          {d.total}
                          <span className="al-stats-row-breakdown">
                            {d.open > 0 && <span style={{ color: '#ef4444' }}>{d.open}o</span>}
                            {d.resolved > 0 && <span style={{ color: '#22c55e' }}>{d.resolved}r</span>}
                            {(d.completed || 0) > 0 && <span style={{ color: '#06b6d4' }}>{d.completed}c</span>}
                          </span>
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* === ROUTE TAB === */}
          {statsTab === 'route' && (
            <div className="al-stats-section">
              <div className="al-stats-section-header">
                <h4>Alerts by Route</h4>
                <div className="al-stats-view-toggle">
                  {[['all', 'All Time'], ['this-week', 'This Week'], ['30d', '30 Days'], ['90d', '90 Days']].map(([v, label]) => (
                    <button key={v} className={`al-quick-btn ${statsRouteTime === v ? 'active' : ''}`} onClick={() => setStatsRouteTime(v)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <table className="al-stats-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Total</th>
                    <th>Open</th>
                    <th>Resolved</th>
                    <th>Completed</th>
                    <th>Avg Response</th>
                    <th className="al-stats-bar-col">Distribution</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {routeStats.map(r => {
                    const maxTotal = routeStats[0]?.total || 1;
                    return (
                      <tr key={r.key} className={r.open > 0 ? 'has-open' : ''}>
                        <td className="al-stats-td-label">Route {r.key}</td>
                        <td className="al-stats-td-num">{r.total}</td>
                        <td className="al-stats-td-num" style={{ color: r.open > 0 ? '#dc2626' : undefined }}>{r.open}</td>
                        <td className="al-stats-td-num" style={{ color: r.resolved > 0 ? '#16a34a' : undefined }}>{r.resolved}</td>
                        <td className="al-stats-td-num" style={{ color: r.completed > 0 ? '#0891b2' : undefined }}>{r.completed}</td>
                        <td className="al-stats-td-num">{r.avgDays !== null ? `${r.avgDays}d` : '—'}</td>
                        <td>
                          <div className="al-stats-row-bar-wrap">
                            <div className="al-stats-row-bar" style={{ width: `${(r.total / maxTotal) * 100}%` }}>
                              {r.open > 0 && <div className="al-stats-bar-segment" style={{ flex: r.open, background: '#ef4444' }} />}
                              {(r.resolved - (r.completed || 0)) > 0 && <div className="al-stats-bar-segment" style={{ flex: r.resolved - (r.completed || 0), background: '#22c55e' }} />}
                              {(r.completed || 0) > 0 && <div className="al-stats-bar-segment" style={{ flex: r.completed, background: '#06b6d4' }} />}
                              {(r.total - r.open - r.resolved) > 0 && <div className="al-stats-bar-segment" style={{ flex: r.total - r.open - r.resolved, background: '#9ca3af' }} />}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="al-btn-report"
                            onClick={(e) => generateRouteReportCard(e, r.key)}
                            disabled={reportGenerating !== null}
                            title={`Generate Report Card for Route ${r.key}`}
                          >
                            {reportGenerating === r.key ? '...' : 'Report'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* === ZONE TAB === */}
          {statsTab === 'zone' && (
            <div className="al-stats-section">
              <h4>Alerts by Zone / Region</h4>
              <table className="al-stats-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Total</th>
                    <th>Open</th>
                    <th>Resolved</th>
                    <th>Avg Response</th>
                    <th className="al-stats-bar-col">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {allStats.zones.map(z => {
                    const maxTotal = allStats.zones[0]?.total || 1;
                    return (
                      <tr key={z.key} className={z.open > 0 ? 'has-open' : ''}>
                        <td className="al-stats-td-label">{z.key}</td>
                        <td className="al-stats-td-num">{z.total}</td>
                        <td className="al-stats-td-num" style={{ color: z.open > 0 ? '#dc2626' : undefined }}>{z.open}</td>
                        <td className="al-stats-td-num" style={{ color: z.resolved > 0 ? '#16a34a' : undefined }}>{z.resolved}</td>
                        <td className="al-stats-td-num">{z.avgDays !== null ? `${z.avgDays}d` : '—'}</td>
                        <td>
                          <div className="al-stats-row-bar-wrap">
                            <div className="al-stats-row-bar" style={{ width: `${(z.total / maxTotal) * 100}%` }}>
                              {z.open > 0 && <div className="al-stats-bar-segment" style={{ flex: z.open, background: '#ef4444' }} />}
                              {(z.resolved - (z.completed || 0)) > 0 && <div className="al-stats-bar-segment" style={{ flex: z.resolved - (z.completed || 0), background: '#22c55e' }} />}
                              {(z.completed || 0) > 0 && <div className="al-stats-bar-segment" style={{ flex: z.completed, background: '#06b6d4' }} />}
                              {(z.total - z.open - z.resolved) > 0 && <div className="al-stats-bar-segment" style={{ flex: z.total - z.open - z.resolved, background: '#9ca3af' }} />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* === CHAIN TAB === */}
          {statsTab === 'chain' && (
            <div className="al-stats-section">
              <h4>Alerts by Store Chain</h4>
              <table className="al-stats-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th>Total</th>
                    <th>Open</th>
                    <th>Resolved</th>
                    <th>Avg Response</th>
                    <th className="al-stats-bar-col">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {allStats.chains.map(c => {
                    const maxTotal = allStats.chains[0]?.total || 1;
                    return (
                      <tr key={c.key} className={c.open > 0 ? 'has-open' : ''}>
                        <td className="al-stats-td-label">{c.key}</td>
                        <td className="al-stats-td-num">{c.total}</td>
                        <td className="al-stats-td-num" style={{ color: c.open > 0 ? '#dc2626' : undefined }}>{c.open}</td>
                        <td className="al-stats-td-num" style={{ color: c.resolved > 0 ? '#16a34a' : undefined }}>{c.resolved}</td>
                        <td className="al-stats-td-num">{c.avgDays !== null ? `${c.avgDays}d` : '—'}</td>
                        <td>
                          <div className="al-stats-row-bar-wrap">
                            <div className="al-stats-row-bar" style={{ width: `${(c.total / maxTotal) * 100}%` }}>
                              {c.open > 0 && <div className="al-stats-bar-segment" style={{ flex: c.open, background: '#ef4444' }} />}
                              {(c.resolved - (c.completed || 0)) > 0 && <div className="al-stats-bar-segment" style={{ flex: c.resolved - (c.completed || 0), background: '#22c55e' }} />}
                              {(c.completed || 0) > 0 && <div className="al-stats-bar-segment" style={{ flex: c.completed, background: '#06b6d4' }} />}
                              {(c.total - c.open - c.resolved) > 0 && <div className="al-stats-bar-segment" style={{ flex: c.total - c.open - c.resolved, background: '#9ca3af' }} />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* === TOP STORES / DRIVERS TAB === */}
          {statsTab === 'top' && (
            <div className="al-stats-section">
              <div className="al-lb-heading">&#9888; Store Leaderboard</div>
              <table className="al-stats-table al-leaderboard">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Store</th>
                    <th>City</th>
                    <th>Rt</th>
                    <th title="Total service alerts">Alerts</th>
                    <th title="Unresolved — store not yet visited" style={{ color: '#dc2626' }}>Open</th>
                    <th title="Store visited after alert" style={{ color: '#16a34a' }}>Res</th>
                    <th title="Average days from alert to store visit">Avg</th>
                    <th title="Accepted on GlobalWorx" style={{ color: '#2563eb' }}>Acc</th>
                    <th title="Completion form submitted on GlobalWorx" style={{ color: '#059669' }}>Comp</th>
                    <th title="GW pipeline progress: Accepted → Done → Completed">Pipeline</th>
                    <th title="Performance grade based on resolution rate">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {allStats.topStores.map((s, i) => {
                    const pipelinePct = s.total > 0 ? Math.round(s.completed / s.total * 100) : 0;
                    const resPct = s.total > 0 ? Math.round(s.resolved / s.total * 100) : 0;
                    const grade = resPct >= 90 ? 'A' : resPct >= 70 ? 'B' : resPct >= 50 ? 'B' : 'C';
                    const gradeClass = grade === 'A' ? 'al-grade-a' : grade === 'B' ? 'al-grade-b' : 'al-grade-c';
                    return (
                      <tr key={s.key} className={s.open >= 3 ? 'al-lb-critical' : s.open >= 2 ? 'al-lb-warning' : s.completed === s.total && s.total > 0 ? 'al-lb-done' : ''}>
                        <td className="al-stats-td-num">{i + 1}</td>
                        <td className="al-stats-td-label">{s.name} #{s.number}</td>
                        <td>{s.city || '—'}</td>
                        <td className="al-stats-td-num">{s.route || '—'}</td>
                        <td className="al-stats-td-num" style={{ fontWeight: 700 }}>{s.total}</td>
                        <td className="al-stats-td-num" style={{ color: s.open > 0 ? '#dc2626' : '#9ca3af', fontWeight: s.open > 0 ? 700 : 400 }}>{s.open}</td>
                        <td className="al-stats-td-num" style={{ color: s.resolved > 0 ? '#16a34a' : '#9ca3af' }}>{s.resolved}</td>
                        <td className="al-stats-td-num">{s.avgDays !== null ? `${s.avgDays}d` : '—'}</td>
                        <td className="al-stats-td-num" style={{ color: s.accepted > 0 ? '#2563eb' : '#9ca3af' }}>{s.accepted}</td>
                        <td className="al-stats-td-num" style={{ color: s.completed > 0 ? '#059669' : '#9ca3af' }}>{s.completed}</td>
                        <td>
                          <div className="al-lb-pipeline" title={`${s.accepted} accepted → ${s.done} done → ${s.completed} completed (${pipelinePct}%)`}>
                            <div className="al-lb-pipeline-track">
                              <div className="al-lb-pipeline-fill" style={{ width: `${pipelinePct}%`, background: pipelinePct === 100 ? '#059669' : '#06b6d4' }} />
                            </div>
                            <span className="al-lb-pipeline-pct">{pipelinePct}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`al-grade ${gradeClass}`} title={`${resPct}% resolved`}>{grade}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="al-lb-heading" style={{ marginTop: 24 }}>&#128663; Driver Scorecard</div>
              <table className="al-stats-table al-leaderboard">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th title="Total service alerts">Alerts</th>
                    <th title="Unresolved alerts" style={{ color: '#dc2626' }}>Open</th>
                    <th title="Resolved by visit" style={{ color: '#16a34a' }}>Res</th>
                    <th title="Average response days">Avg</th>
                    <th title="GW Accepted" style={{ color: '#2563eb' }}>Acc</th>
                    <th title="GW Completed" style={{ color: '#059669' }}>Comp</th>
                    <th title="Resolution rate: resolved / total">Res%</th>
                    <th title="Completion rate: GW completed / total">Comp%</th>
                    <th title="Overall pipeline progress">Progress</th>
                    <th title="Performance grade">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {allStats.topDrivers.map(d => {
                    const resPct = d.total > 0 ? Math.round(d.resolved / d.total * 100) : 0;
                    const compPct = d.total > 0 ? Math.round((d.completed || 0) / d.total * 100) : 0;
                    const maxTotal = allStats.topDrivers[0]?.total || 1;
                    const grade = resPct >= 90 ? 'A' : resPct >= 70 ? 'B' : resPct >= 50 ? 'B' : 'C';
                    const gradeClass = grade === 'A' ? 'al-grade-a' : grade === 'B' ? 'al-grade-b' : 'al-grade-c';
                    return (
                      <tr key={d.key} className={d.open > 0 ? 'al-lb-warning' : compPct === 100 ? 'al-lb-done' : ''}>
                        <td className="al-stats-td-label">{d.key}</td>
                        <td className="al-stats-td-num" style={{ fontWeight: 700 }}>{d.total}</td>
                        <td className="al-stats-td-num" style={{ color: d.open > 0 ? '#dc2626' : '#9ca3af', fontWeight: d.open > 0 ? 700 : 400 }}>{d.open}</td>
                        <td className="al-stats-td-num" style={{ color: d.resolved > 0 ? '#16a34a' : '#9ca3af' }}>{d.resolved}</td>
                        <td className="al-stats-td-num">{d.avgDays !== null ? `${d.avgDays}d` : '—'}</td>
                        <td className="al-stats-td-num" style={{ color: (d.accepted || 0) > 0 ? '#2563eb' : '#9ca3af' }}>{d.accepted || 0}</td>
                        <td className="al-stats-td-num" style={{ color: (d.completed || 0) > 0 ? '#059669' : '#9ca3af' }}>{d.completed || 0}</td>
                        <td className="al-stats-td-num" style={{ color: resPct >= 90 ? '#16a34a' : resPct >= 50 ? '#d97706' : '#dc2626' }}>{resPct}%</td>
                        <td className="al-stats-td-num" style={{ color: compPct >= 90 ? '#059669' : compPct >= 50 ? '#0d9488' : '#9ca3af' }}>{compPct}%</td>
                        <td>
                          <div className="al-lb-pipeline">
                            <div className="al-lb-pipeline-track">
                              {d.open > 0 && <div className="al-lb-pipeline-seg" style={{ flex: d.open, background: '#ef4444' }} />}
                              {(d.resolved - (d.completed || 0)) > 0 && <div className="al-lb-pipeline-seg" style={{ flex: d.resolved - (d.completed || 0), background: '#22c55e' }} />}
                              {(d.completed || 0) > 0 && <div className="al-lb-pipeline-seg" style={{ flex: d.completed, background: '#06b6d4' }} />}
                              {(d.total - d.open - d.resolved) > 0 && <div className="al-lb-pipeline-seg" style={{ flex: d.total - d.open - d.resolved, background: '#e5e7eb' }} />}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`al-grade ${gradeClass}`} title={`${resPct}% resolved`}>{grade}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="al-stats-legend">
            <span><span className="al-stats-legend-dot" style={{ background: '#ef4444' }} /> Open</span>
            <span><span className="al-stats-legend-dot" style={{ background: '#22c55e' }} /> Resolved</span>
            <span><span className="al-stats-legend-dot" style={{ background: '#06b6d4' }} /> Completed</span>
            <span><span className="al-stats-legend-dot" style={{ background: '#9ca3af' }} /> Unknown</span>
          </div>
        </div>
      )}

      {/* Route-grouped content */}
      {filteredAlerts.length === 0 ? (
        <div className="al-empty">
          {alerts.length === 0
            ? 'No alerts yet — fetch alerts from Gmail in the sidebar'
            : 'No alerts match your filters'}
        </div>
      ) : (
        <div className="al-content">
          {alertsByRoute.map(([route, routeAlerts]) => {
            const open = routeAlerts.filter(a => a.status === 'unresolved').length;
            const resolved = routeAlerts.filter(a => a.status === 'resolved').length;
            const expanded = isRouteExpanded(route);

            return (
              <div key={route} className="al-route-section">
                <div className="al-route-header" onClick={() => toggleRoute(route)}>
                  <div className="al-route-left">
                    <span className={`al-chevron ${expanded ? 'expanded' : ''}`}>&#9654;</span>
                    <span className="al-route-name">
                      {route === 'Unmatched' ? 'Unmatched Stores' : `Route ${route}`}
                    </span>
                  </div>
                  <div className="al-route-right">
                    <div className="al-route-bar">
                      {open > 0 && <div style={{ flex: open, background: '#ef4444' }}></div>}
                      {resolved > 0 && <div style={{ flex: resolved, background: '#22c55e' }}></div>}
                    </div>
                    <span className="al-route-counts">
                      {routeAlerts.length} alert{routeAlerts.length !== 1 ? 's' : ''}
                      {open > 0 && <span className="al-count-open">{open} open</span>}
                      {resolved > 0 && <span className="al-count-resolved">{resolved} resolved</span>}
                    </span>
                    {(() => {
                      const sentInfo = getRouteSentInfo(routeAlerts);
                      const sentDate = sentInfo ? new Date(sentInfo.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
                      return (
                        <div className="al-pdf-wrap">
                          <button
                            className={`al-btn-pdf${sentInfo ? ' al-btn-pdf--sent' : ''}`}
                            onClick={(e) => generateRoutePDF(e, route, routeAlerts)}
                            disabled={pdfGenerating !== null}
                            title={sentInfo
                              ? `Sent ${sentDate} (${sentInfo.count} alerts: ${sentInfo.refs.join(', ')})\nClick to re-generate`
                              : `Download PDF for ${route === 'Unmatched' ? 'unmatched stores' : 'Route ' + route}`}
                          >
                            {pdfGenerating === route ? 'Generating...' : sentInfo ? 'PDF' : 'PDF'}
                          </button>
                          {route !== 'Unmatched' && (
                            <button
                              className="al-btn-report"
                              onClick={(e) => generateRouteReportCard(e, route)}
                              disabled={reportGenerating !== null}
                              title={`Generate Report Card for Route ${route}`}
                            >
                              {reportGenerating === route ? '...' : 'Report'}
                            </button>
                          )}
                          {route !== 'Unmatched' && waStatus === 'connected' && (
                            <button
                              className="al-btn-wa"
                              onClick={(e) => handleSendReportWhatsApp(e, route, {
                                period: `${new Date(new Date().setDate(new Date().getDate() - 7)).toLocaleDateString()} - ${new Date().toLocaleDateString()}`,
                                storesVisited: routeAlerts.filter(a => a.status === 'resolved').length,
                                totalStops: routeAlerts.length,
                              })}
                              disabled={waSending === `report-${route}`}
                              title={`Send report summary to Route ${route} driver via WhatsApp`}
                            >
                              {waSending === `report-${route}` ? '...' : 'WA'}
                            </button>
                          )}
                          {sentInfo && (
                            <span className="al-pdf-sent-tag">Sent {sentDate}</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {expanded && (
                  <table className="al-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32, textAlign: 'center', padding: '8px 4px' }}>
                          <input
                            type="checkbox"
                            checked={routeAlerts.filter(a => isAlertCheckable(a)).length > 0 &&
                                     routeAlerts.filter(a => isAlertCheckable(a)).every(a => checkedAlerts.has(a.refNumber))}
                            onChange={(e) => toggleRouteCheck(routeAlerts, e)}
                            onClick={(e) => e.stopPropagation()}
                            title="Select all checkable alerts in this route"
                            className="al-check-input"
                          />
                        </th>
                        <th style={{ width: 36 }}></th>
                        <th>Store</th>
                        <th>City</th>
                        <th>Alert Date</th>
                        <th>Last Visit</th>
                        <th>Last Sale</th>
                        <th>Since Service</th>
                        <th>Ref #</th>
                        <th>Days to Serve</th>
                        <th>GW</th>
                        <th>Email</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routeAlerts.map(a => {
                        const hasStore = !!a.store;
                        const imgData = alertImages[a.emailId];
                        const isImgOpen = expandedImage === a.emailId;
                        const isDetailOpen = selectedAlertRef === a.refNumber;

                        // Visit/sale context from CSV + visitHistory
                        const storeVisits = (visitHistory && a.store?.id ? (visitHistory[a.store.id] || []) : [])
                          .filter(Boolean)
                          .map(d => d.split('T')[0])
                          .sort((x, y) => y.localeCompare(x)); // newest first
                        const postAlertVisits = a.dateReceived
                          ? storeVisits.filter(d => d >= a.dateReceived)
                          : storeVisits;
                        const lastVisitedDate = a.store?.lastVisited
                          ? a.store.lastVisited.split('T')[0]
                          : null;
                        const lastSaleDate = a.store?.lastSaleDate
                          ? a.store.lastSaleDate.split('T')[0]
                          : null;
                        const visitedSinceAlert = a.dateReceived && lastVisitedDate && lastVisitedDate >= a.dateReceived;
                        const soldSinceAlert = a.dateReceived && lastSaleDate && lastSaleDate >= a.dateReceived;

                        return (
                          <React.Fragment key={a.refNumber}>
                            <tr
                              className={`${a.status} clickable${isDetailOpen ? ' al-row-selected' : ''}`}
                              onClick={() => handleAlertRowClick(a)}
                            >
                              <td style={{ textAlign: 'center', padding: '8px 4px' }} onClick={(e) => e.stopPropagation()}>
                                {isAlertCheckable(a) ? (
                                  <input
                                    type="checkbox"
                                    checked={checkedAlerts.has(a.refNumber)}
                                    onChange={(e) => toggleAlertCheck(a.refNumber, e)}
                                    className="al-check-input"
                                  />
                                ) : null}
                              </td>
                              <td>
                                <span className="al-status-dot" style={{ background: a.color }}></span>
                              </td>
                              <td className="al-cell-store">
                                {a.store
                                  ? <span
                                      className="al-store-link"
                                      onClick={e => {
                                        e.stopPropagation();
                                        // Clear sidebar filters so the store is visible
                                        setSearch('');
                                        setFilterRegion('all');
                                        setFilterType('all');
                                        setFilterRoute(a.store.routeNumber || 'all');
                                        selectStore(a.store.id);
                                        setSidebarTab('stores');
                                      }}
                                    >{a.storeName} #{a.storeNumber}</span>
                                  : <span>{a.storeName} #{a.storeNumber}</span>
                                }
                              </td>
                              <td>{a.city}</td>
                              <td>{formatDate(a.dateReceived)}{a.timeReceived ? ` ${a.timeReceived}` : ''}</td>
                              <td className="al-cell-date">{a.lastVisitDate ? formatDate(a.lastVisitDate) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                              <td className="al-cell-date">{a.lastSaleDate ? formatDate(a.lastSaleDate) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                              <td className="al-cell-service">
                                {a.daysSinceService !== null
                                  ? <span style={{ color: a.daysSinceService > 14 ? '#ef4444' : a.daysSinceService > 7 ? '#f97316' : '#16a34a', fontWeight: 600 }}>{a.daysSinceService}d</span>
                                  : <span style={{ color: '#9ca3af' }}>—</span>}
                              </td>
                              <td className="al-cell-ref">{a.refNumber}</td>
                              <td style={{ color: a.color, fontWeight: 600 }} title={a.status === 'resolved' ? 'Days between alert and next store visit' : 'Days since alert with no visit'}>
                                {a.status === 'resolved'
                                  ? `${a.days}d`
                                  : a.status === 'unresolved'
                                  ? a.days !== null ? `${a.days}d` : '—'
                                  : '—'}
                              </td>
                              <td className="al-cell-gw">
                                {a.globalworxCompleted
                                  ? <span className="al-gw-col-completed" title="Completion form submitted">Completed</span>
                                  : a.globalworxDone
                                    ? <span className="al-gw-col-done" title="Store visited — marked Done">Done</span>
                                    : a.globalworxAccepted
                                      ? <span className="al-gw-col-yes" title="Accepted">✓</span>
                                      : a.acceptanceUrl
                                        ? <a
                                            href={a.acceptanceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="al-gw-btn"
                                            title="Open GlobalWorx acceptance form"
                                            onClick={e => e.stopPropagation()}
                                          >Accept</a>
                                        : <span className="al-gw-col-no" title="No acceptance link">—</span>
                                }
                              </td>
                              <td>
                                {a.emailId && (
                                  <a
                                    className="al-email-link"
                                    href={`https://mail.google.com/mail/u/0/#inbox/${a.emailId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open email in Gmail"
                                  >
                                    Open
                                  </a>
                                )}
                              </td>
                              <td>
                                <div className="al-action-btns">
                                  <button
                                    className="al-btn-send"
                                    onClick={(e) => handleSendToDriver(e, a)}
                                    title="Send to driver via WhatsApp"
                                  >
                                    Send
                                  </button>
                                  {a.emailId && (
                                    <button
                                      className={`al-btn-image ${isImgOpen ? 'active' : ''}`}
                                      onClick={(e) => handleToggleImage(e, a)}
                                      title="View alert image"
                                    >
                                      {imgData?.loading ? '...' : 'Image'}
                                    </button>
                                  )}
                                  {hasStore && (
                                    <span className="al-map-link" onClick={(e) => { e.stopPropagation(); handleGoToStore(a); }}>
                                      Map
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {/* ── Inline detail panel ── */}
                            {isDetailOpen && (
                              <tr className="al-detail-row">
                                <td colSpan={14}>
                                  <div className="al-detail-panel">

                                    {/* Store profile */}
                                    <div className="al-detail-store">
                                      <div className="al-detail-store-name">{a.storeName} #{a.storeNumber}</div>
                                      {hasStore ? (
                                        <>
                                          {a.store.address && <div className="al-detail-store-address">{a.store.address}{a.city ? `, ${a.city}` : ''}</div>}
                                          <div className="al-detail-store-meta">
                                            {a.store.routeNumber && <span>Route {a.store.routeNumber}</span>}
                                            {a.store.driver && <span>Driver: {a.store.driver}</span>}
                                            {a.store.zone && <span>Zone: {a.store.zone}</span>}
                                          </div>
                                        </>
                                      ) : (
                                        <div className="al-detail-no-match">No matching store found in CSV — route and visit data unavailable</div>
                                      )}
                                      <div className="al-detail-alert-meta">
                                        <span>Ref: <strong>{a.refNumber}</strong></span>
                                        <span>Vendor: {a.vendor}</span>
                                        {a.company && <span>{a.company}</span>}
                                        <span>Alert date: {formatDate(a.dateReceived)}</span>
                                      </div>
                                    </div>

                                    {/* Visit / sale status since the alert */}
                                    <div className="al-detail-status">
                                      <div className="al-detail-status-title">Store Activity Since Alert</div>

                                      {/* Visited */}
                                      <div className={`al-detail-check ${visitedSinceAlert ? 'yes' : 'no'}`}>
                                        <span className="al-detail-check-icon">{visitedSinceAlert ? '✓' : '✗'}</span>
                                        <div>
                                          <div className="al-detail-check-label">
                                            {visitedSinceAlert
                                              ? `Visited after alert (${formatDate(lastVisitedDate)})`
                                              : lastVisitedDate
                                                ? `Last visit was before alert (${formatDate(lastVisitedDate)})`
                                                : 'No visit recorded'}
                                          </div>
                                          {postAlertVisits.length > 0 && (
                                            <div className="al-detail-visit-chips">
                                              {postAlertVisits.slice(0, 8).map(d => (
                                                <span key={d} className="al-detail-chip">{formatDate(d)}</span>
                                              ))}
                                              {postAlertVisits.length > 8 && <span className="al-detail-chip-more">+{postAlertVisits.length - 8} more</span>}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Sold */}
                                      <div className={`al-detail-check ${soldSinceAlert ? 'yes' : 'no'}`}>
                                        <span className="al-detail-check-icon">{soldSinceAlert ? '✓' : '✗'}</span>
                                        <div className="al-detail-check-label">
                                          {soldSinceAlert
                                            ? `Sale recorded after alert (${formatDate(lastSaleDate)})`
                                            : lastSaleDate
                                              ? `Last sale was before alert (${formatDate(lastSaleDate)})`
                                              : 'No sale data in CSV'}
                                        </div>
                                      </div>

                                      {/* GlobalWorx acceptance status */}
                                      <div className={`al-detail-check ${a.globalworxCompleted ? 'yes' : a.globalworxDone ? 'yes' : a.globalworxAccepted ? 'yes' : 'no'}`}>
                                        <span className="al-detail-check-icon">{a.globalworxCompleted ? '✓' : a.globalworxDone ? '✓' : a.globalworxAccepted ? '✓' : '✗'}</span>
                                        <div className="al-detail-check-label">
                                          {a.globalworxCompleted
                                            ? 'GlobalWorx completion form submitted'
                                            : a.globalworxDone
                                              ? 'Store visited — marked Done in Gmail'
                                              : a.globalworxAccepted
                                                ? 'GlobalWorx acceptance form submitted'
                                                : 'GlobalWorx acceptance not yet submitted'}
                                        </div>
                                        {a.acceptanceUrl && !a.globalworxAccepted && !a.globalworxDone && !a.globalworxCompleted && (
                                          <a
                                            href={a.acceptanceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="al-gw-detail-btn"
                                          >Open Acceptance Form</a>
                                        )}
                                      </div>

                                      {/* All recent visits from visitHistory (last 3 before alert) */}
                                      {storeVisits.filter(d => !a.dateReceived || d < a.dateReceived).slice(0, 3).length > 0 && (
                                        <div className="al-detail-prev-visits">
                                          <span className="al-detail-prev-label">Prior visits:</span>
                                          {storeVisits.filter(d => !a.dateReceived || d < a.dateReceived).slice(0, 3).map(d => (
                                            <span key={d} className="al-detail-chip al-detail-chip-prior">{formatDate(d)}</span>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    {/* Actions */}
                                    <div className="al-detail-actions">
                                      {hasStore && (
                                        <button
                                          className="al-detail-btn al-detail-btn-map"
                                          onClick={(e) => { e.stopPropagation(); handleGoToStore(a); }}
                                        >
                                          View on Map
                                        </button>
                                      )}
                                      <button
                                        className="al-detail-btn"
                                        onClick={(e) => handleSendToDriver(e, a)}
                                      >
                                        Send to Driver
                                      </button>
                                      {a.emailId && (
                                        <>
                                          <a
                                            className="al-detail-btn"
                                            href={`https://mail.google.com/mail/u/0/#inbox/${a.emailId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            Open Email
                                          </a>
                                          <button
                                            className={`al-detail-btn${isImgOpen ? ' active' : ''}`}
                                            onClick={(e) => handleToggleImage(e, a)}
                                          >
                                            {imgData?.loading ? 'Loading...' : 'View Image'}
                                          </button>
                                        </>
                                      )}
                                      <button
                                        className="al-detail-btn al-detail-btn-close"
                                        onClick={(e) => { e.stopPropagation(); setSelectedAlertRef(null); }}
                                      >
                                        Close
                                      </button>
                                    </div>

                                  </div>
                                </td>
                              </tr>
                            )}

                            {isImgOpen && (
                              <tr className="al-image-row">
                                <td colSpan={14}>
                                  <div className="al-image-container">
                                    {imgData?.loading && <span className="al-image-loading">Loading image...</span>}
                                    {imgData?.error && <span className="al-image-error">{imgData.error}</span>}
                                    {imgData?.dataUri && (
                                      <>
                                        <img className="al-image-preview" src={imgData.dataUri} alt="Alert" />
                                        <button
                                          className="al-btn-download"
                                          onClick={(e) => handleDownloadImage(e, imgData)}
                                        >
                                          Download Image
                                        </button>
                                      </>
                                    )}
                                    <button
                                      className="al-btn-close-image"
                                      onClick={(e) => { e.stopPropagation(); setExpandedImage(null); }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };
const DAY_OFFSETS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };

function toLocalDate(dateStr) {
  if (!dateStr) return null;
  const raw = dateStr.split('T')[0];
  const d = new Date(raw + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function getDaysSinceVisit(lastVisited) {
  const visited = toLocalDate(lastVisited);
  if (!visited) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - visited) / (1000 * 60 * 60 * 24));
}

/** Difference in days between two YYYY-MM-DD strings (a - b) */
function daysDiff(a, b) {
  return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Format a YYYY-MM-DD string as "Monday 2/16" */
function fmtDateDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function formatVisitDate(lastVisited) {
  const d = toLocalDate(lastVisited);
  if (!d) return 'Never';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function getScheduleKey(route, weekOf) {
  return `${route}_${weekOf}`;
}

/** Get the actual date for a day in a given week (weekOf = Monday YYYY-MM-DD) */
function getDayDate(weekOf, day) {
  const d = new Date(weekOf + 'T00:00:00');
  d.setDate(d.getDate() + DAY_OFFSETS[day]);
  return d.toISOString().split('T')[0];
}

/**
 * Check compliance by finding the closest visit to the expected date.
 *
 * For the viewed week's expected day, scan all visits and pick the one
 * closest by absolute distance. This naturally handles multiple visits:
 *
 * Example (scheduled Monday):
 *   Viewing this week: Tue (1d) and Thu (3d) → picks Tue → "1d late"
 *   Viewing next week: Tue (6d) and Thu (4d) → picks Thu → "4d early"
 */
function getStopCompliance(storeId, scheduledDay, weekOf, lastVisited, visitHistoryMap) {
  const expectedDate = getDayDate(weekOf, scheduledDay);
  const dayLabel = DAY_LABELS[scheduledDay];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // Gather all visits
  const visits = [...(visitHistoryMap[storeId] || [])];
  if (lastVisited) {
    const normalised = lastVisited.split('T')[0];
    if (!visits.includes(normalised)) visits.push(normalised);
  }

  if (visits.length === 0) {
    if (expectedDate > todayStr) {
      return { status: 'future', label: 'Upcoming', color: '#9ca3af', visitDate: null, tooltip: `Due: ${fmtDateDay(expectedDate)}` };
    }
    return { status: 'missed', label: 'Never visited', color: '#991b1b', visitDate: null, tooltip: `Due: ${fmtDateDay(expectedDate)} | Never visited` };
  }

  // Adjacent expected dates (previous / next week's same day)
  const prevExpected = (() => { const d = new Date(expectedDate + 'T00:00:00'); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; })();
  const nextExpected = (() => { const d = new Date(expectedDate + 'T00:00:00'); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();

  // Only keep visits closer to THIS week's expected date than to prev/next week
  const myVisits = visits.filter(v => {
    const distThis = Math.abs(daysDiff(v, expectedDate));
    const distPrev = Math.abs(daysDiff(v, prevExpected));
    const distNext = Math.abs(daysDiff(v, nextExpected));
    return distThis <= distPrev && distThis <= distNext;
  });

  // Find the closest visit among those assigned to this week
  let bestVisit = null;
  let bestDist = Infinity;
  for (const v of myVisits) {
    const dist = Math.abs(daysDiff(v, expectedDate));
    if (dist < bestDist) { bestDist = dist; bestVisit = v; }
  }

  if (bestVisit) {
    const diff = daysDiff(bestVisit, expectedDate); // positive = late, negative = early
    const dueLine = `Due: ${fmtDateDay(expectedDate)}`;
    const visitLine = `Visited: ${fmtDateDay(bestVisit)}`;
    if (diff === 0) {
      return { status: 'exact', label: 'On time', color: '#22c55e', visitDate: bestVisit, tooltip: `${dueLine} | ${visitLine} | On time` };
    } else if (diff > 0) {
      return { status: 'sameWeek', label: `${diff}d late`, color: diff === 1 ? '#f59e0b' : '#f97316', visitDate: bestVisit, tooltip: `${dueLine} | ${visitLine} | ${diff} day${diff > 1 ? 's' : ''} late` };
    } else {
      const early = Math.abs(diff);
      return { status: 'sameWeek', label: `${early}d early`, color: '#3b82f6', visitDate: bestVisit, tooltip: `${dueLine} | ${visitLine} | ${early} day${early > 1 ? 's' : ''} early` };
    }
  }

  // No visit attributed to this week's slot — check most recent visit overall
  const lastVisitAny = [...visits].sort().pop();

  if (expectedDate > todayStr) {
    return { status: 'future', label: 'Upcoming', color: '#9ca3af', visitDate: null, tooltip: `Due: ${fmtDateDay(expectedDate)}` };
  }

  // If the store was visited recently (within 7 days), treat as covered
  if (lastVisitAny) {
    const daysSinceVisit = daysDiff(todayStr, lastVisitAny);
    if (daysSinceVisit <= 7) {
      const diff = daysDiff(lastVisitAny, expectedDate);
      const dueLine = `Due: ${fmtDateDay(expectedDate)}`;
      const visitLine = `Visited: ${fmtDateDay(lastVisitAny)}`;
      if (diff === 0) {
        return { status: 'exact', label: 'On time', color: '#22c55e', visitDate: lastVisitAny, tooltip: `${dueLine} | ${visitLine} | On time` };
      } else if (diff > 0) {
        return { status: 'sameWeek', label: `${diff}d late`, color: diff <= 1 ? '#f59e0b' : '#f97316', visitDate: lastVisitAny, tooltip: `${dueLine} | ${visitLine}` };
      } else {
        const early = Math.abs(diff);
        return { status: 'sameWeek', label: `${early}d early`, color: '#3b82f6', visitDate: lastVisitAny, tooltip: `${dueLine} | ${visitLine}` };
      }
    }
  }

  // Truly overdue — no recent visit within 7 days
  const daysOverdue = daysDiff(todayStr, expectedDate);
  let label, color;
  if (daysOverdue <= 7) { label = `Late (${daysOverdue}d)`; color = '#eab308'; }
  else if (daysOverdue <= 14) { label = `Overdue (${daysOverdue}d)`; color = '#f97316'; }
  else if (daysOverdue <= 30) { label = `Critical (${daysOverdue}d)`; color = '#ef4444'; }
  else { label = lastVisitAny ? `Abandoned (${daysOverdue}d)` : 'Never visited'; color = '#991b1b'; }

  const tooltip = lastVisitAny
    ? `Due: ${fmtDateDay(expectedDate)} | Last visited: ${fmtDateDay(lastVisitAny)}`
    : `Due: ${fmtDateDay(expectedDate)} | Never visited`;

  return { status: 'missed', label, color, visitDate: null, daysOverdue, lastVisit: lastVisitAny, tooltip };
}

/** Parse schedule key into route and week components */
function parseScheduleKey(key) {
  const match = key.match(/^(.+?)_(\d{4}-\d{2}-\d{2})$/);
  if (!match) {
    console.warn(`Invalid schedule key: ${key}`);
    return null;
  }
  const route = match[1];
  const weekOf = match[2];
  const routeNum = parseInt(route) || 0;
  return { route, weekOf, routeNum };
}

/** Format week range for display */
function formatWeekRange(weekStart, weekEnd) {
  const options = { month: 'short', day: 'numeric' };
  const start = weekStart.toLocaleDateString('en-US', options);
  const end = weekEnd.toLocaleDateString('en-US', { ...options, year: 'numeric' });
  return `${start} - ${end}`;
}

export default function RouteSchedule() {
  const { state, saveSchedule, recordVisit } = useApp();
  const { stores, schedules, visitHistory: visitHistoryMap } = state;

  const [selectedRoute, setSelectedRoute] = useState('');
  const [weekOf, setWeekOf] = useState(getMonday(new Date()));
  const [dragItem, setDragItem] = useState(null);
  const [noteEditing, setNoteEditing] = useState(null);
  const [showSchedulesDropdown, setShowSchedulesDropdown] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);
  const [visitEditId, setVisitEditId] = useState(null);
  const [visitEditDate, setVisitEditDate] = useState('');
  const visitDateRef = useRef(null);

  // Current schedule from context
  const scheduleKey = selectedRoute ? getScheduleKey(selectedRoute, weekOf) : '';
  const schedule = useMemo(() => {
    if (!scheduleKey || !schedules[scheduleKey]) {
      const empty = {};
      DAYS.forEach(d => { empty[d] = []; });
      return empty;
    }
    return schedules[scheduleKey];
  }, [schedules, scheduleKey]);

  function persistSchedule(newSchedule) {
    if (selectedRoute) {
      saveSchedule(scheduleKey, newSchedule);
    }
  }

  // Get available routes
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

  // Get stores for selected route
  const routeStores = useMemo(() => {
    if (!selectedRoute) return [];
    return stores
      .filter(s => s.routeNumber === selectedRoute)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [stores, selectedRoute]);

  // Track which stores are already scheduled
  const scheduledIds = useMemo(() => {
    const set = new Set();
    DAYS.forEach(d => {
      (schedule[d] || []).forEach(item => set.add(item.storeId));
    });
    return set;
  }, [schedule]);

  const unscheduledStores = useMemo(() => {
    return routeStores.filter(s => !scheduledIds.has(s.id));
  }, [routeStores, scheduledIds]);

  const unscheduledChain = useMemo(() => {
    return unscheduledStores.filter(s => s.type !== 'other' && s.type !== 'military');
  }, [unscheduledStores]);

  const unscheduledCash = useMemo(() => {
    return unscheduledStores.filter(s => s.type === 'other' || s.type === 'military');
  }, [unscheduledStores]);

  // Store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Compliance stats
  const complianceStats = useMemo(() => {
    let total = 0, exact = 0, sameWeek = 0, late = 0, missed = 0, future = 0;
    DAYS.forEach(day => {
      (schedule[day] || []).forEach(item => {
        total++;
        const st = storeMap[item.storeId];
        const stLatest = st ? ([st.lastSaleDate, st.lastVisited].filter(Boolean).sort().pop() || null) : null;
        const c = getStopCompliance(item.storeId, day, weekOf, stLatest, visitHistoryMap);
        if (c.status === 'exact') exact++;
        else if (c.status === 'sameWeek') sameWeek++;
        else if (c.status === 'late') late++;
        else if (c.status === 'missed') missed++;
        else future++;
      });
    });
    const completed = exact + sameWeek + late;
    const adherence = total > 0 ? Math.round((completed / (total - future)) * 100) || 0 : 0;
    return { total, exact, sameWeek, late, missed, future, completed, adherence };
  }, [schedule, weekOf, storeMap]);

  // Process saved schedules list
  const savedSchedulesList = useMemo(() => {
    const scheduleKeys = Object.keys(schedules);

    return scheduleKeys
      .map(key => {
        const schedule = schedules[key];
        const parsed = parseScheduleKey(key);
        if (!parsed) return null;

        const { route, weekOf, routeNum } = parsed;

        // Calculate total stops
        const totalStops = DAYS.reduce((sum, day) => sum + (schedule[day]?.length || 0), 0);

        // Skip empty schedules
        if (totalStops === 0) return null;

        // Calculate week dates for display
        try {
          const weekStart = new Date(weekOf + 'T00:00:00');
          if (isNaN(weekStart.getTime())) return null;

          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 4);

          return {
            key,
            route,
            routeNum,
            weekOf,
            weekStart,
            weekEnd,
            totalStops,
            isPast: weekEnd < new Date(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // Primary sort: date (most recent first)
        const dateCompare = b.weekStart - a.weekStart;
        if (dateCompare !== 0) return dateCompare;

        // Secondary sort: route number
        return a.routeNum - b.routeNum;
      });
  }, [schedules]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showSchedulesDropdown) return;

    const handleClickOutside = (e) => {
      if (!e.target.closest('.schedules-dropdown-wrapper')) {
        setShowSchedulesDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSchedulesDropdown]);

  // Event handlers for saved schedules
  function toggleSchedulesDropdown() {
    setShowSchedulesDropdown(prev => !prev);
  }

  function loadSavedSchedule(scheduleItem) {
    setSelectedRoute(scheduleItem.route);
    setWeekOf(scheduleItem.weekOf);
    setShowSchedulesDropdown(false);
  }

  function addStoreToDay(storeId, day) {
    const newSchedule = { ...schedule };
    newSchedule[day] = [...(newSchedule[day] || []), { storeId, stopNumber: (newSchedule[day] || []).length + 1, notes: '' }];
    persistSchedule(newSchedule);
  }

  function removeFromDay(day, storeId) {
    const newSchedule = { ...schedule };
    newSchedule[day] = (newSchedule[day] || [])
      .filter(item => item.storeId !== storeId)
      .map((item, i) => ({ ...item, stopNumber: i + 1 }));
    persistSchedule(newSchedule);
  }

  function moveStop(day, index, direction) {
    const newDay = [...(schedule[day] || [])];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newDay.length) return;
    [newDay[index], newDay[targetIndex]] = [newDay[targetIndex], newDay[index]];
    const newSchedule = { ...schedule };
    newSchedule[day] = newDay.map((item, i) => ({ ...item, stopNumber: i + 1 }));
    persistSchedule(newSchedule);
  }

  function updateNotes(day, storeId, notes) {
    const newSchedule = { ...schedule };
    newSchedule[day] = (newSchedule[day] || []).map(item =>
      item.storeId === storeId ? { ...item, notes } : item
    );
    persistSchedule(newSchedule);
  }

  function handleDragStart(storeId, fromDay) {
    setDragItem({ storeId, fromDay });
  }

  function handleDrop(toDay) {
    if (!dragItem) return;
    const { storeId, fromDay } = dragItem;
    if (fromDay === toDay) { setDragItem(null); return; }

    const newSchedule = { ...schedule };
    if (fromDay) {
      const existingItem = (schedule[fromDay] || []).find(item => item.storeId === storeId);
      newSchedule[fromDay] = (newSchedule[fromDay] || [])
        .filter(item => item.storeId !== storeId)
        .map((item, i) => ({ ...item, stopNumber: i + 1 }));
      newSchedule[toDay] = [
        ...(newSchedule[toDay] || []),
        { storeId, stopNumber: (newSchedule[toDay] || []).length + 1, notes: existingItem?.notes || '' }
      ];
    } else {
      newSchedule[toDay] = [
        ...(newSchedule[toDay] || []),
        { storeId, stopNumber: (newSchedule[toDay] || []).length + 1, notes: '' }
      ];
    }
    persistSchedule(newSchedule);
    setDragItem(null);
  }

  function addAllToDay(day) {
    const newSchedule = { ...schedule };
    let nextStop = (newSchedule[day] || []).length + 1;
    newSchedule[day] = [...(newSchedule[day] || [])];
    unscheduledStores.forEach(s => {
      newSchedule[day].push({ storeId: s.id, stopNumber: nextStop++, notes: '' });
    });
    persistSchedule(newSchedule);
  }

  function clearDay(day) {
    const newSchedule = { ...schedule };
    newSchedule[day] = [];
    persistSchedule(newSchedule);
  }

  // Visit date editing
  const openVisitEdit = useCallback((storeId) => {
    setVisitEditId(storeId);
    setVisitEditDate(new Date().toISOString().split('T')[0]);
    setTimeout(() => {
      try { visitDateRef.current?.showPicker(); } catch (_) {}
    }, 50);
  }, []);

  const saveVisitDate = useCallback((storeId) => {
    if (!visitEditDate) return;
    const ymd = visitEditDate.split('T')[0].split(' ')[0];
    if (!ymd) return;
    recordVisit(storeId, ymd);
    setVisitEditId(null);
    setVisitEditDate('');
  }, [visitEditDate, recordVisit]);

  // Generate PDF with compliance
  const generatePDF = useCallback(() => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Route ${selectedRoute} — Weekly Schedule`, pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const monday = new Date(weekOf + 'T00:00:00');
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const dateRange = `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    doc.text(dateRange, pageWidth / 2, 21, { align: 'center' });

    const totalScheduled = DAYS.reduce((sum, d) => sum + (schedule[d] || []).length, 0);
    const adherenceText = complianceStats.adherence > 0 ? ` | Adherence: ${complianceStats.adherence}%` : '';
    doc.text(`${totalScheduled} stops across ${DAYS.filter(d => (schedule[d] || []).length > 0).length} days${adherenceText}`, pageWidth / 2, 26, { align: 'center' });

    let yPos = 32;

    DAYS.forEach(day => {
      const stops = schedule[day] || [];
      if (stops.length === 0) return;

      if (yPos + 15 + stops.length * 8 > doc.internal.pageSize.getHeight() - 10) {
        doc.addPage();
        yPos = 15;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(37, 99, 235);
      doc.text(`${DAY_LABELS[day]} — ${stops.length} stop${stops.length !== 1 ? 's' : ''}`, 14, yPos);
      doc.setTextColor(0, 0, 0);
      yPos += 2;

      const tableData = stops.map(item => {
        const store = storeMap[item.storeId];
        if (!store) return [item.stopNumber, item.storeId, '—', '—', '—', '—', '—', item.notes || ''];
        const latest = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
        const days = getDaysSinceVisit(latest);
        const sale = store.lastSaleDate ? store.lastSaleDate.split('T')[0].split(' ')[0] : null;
        const visit = store.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : null;
        const lastVisit = [sale ? `S:${sale}` : null, visit ? `V:${visit}` : null].filter(Boolean).join('/') || 'Never';
        const daysText = days !== null ? `${days}d` : 'Never';
        const compliance = getStopCompliance(item.storeId, day, weekOf, latest, visitHistoryMap);
        return [
          item.stopNumber,
          store.id,
          store.name || '—',
          `${store.address || ''}, ${store.city || ''} ${store.state || ''}`.trim().replace(/^,\s*/, ''),
          lastVisit,
          daysText,
          compliance.label,
          item.notes || '',
        ];
      });

      autoTable(doc, {
        startY: yPos,
        head: [['#', 'Store ID', 'Store Name', 'Address', 'Last Visit', 'Days', 'Status', 'Notes']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 32 },
          3: { cellWidth: 55 },
          4: { cellWidth: 20 },
          5: { cellWidth: 12, halign: 'center' },
          6: { cellWidth: 18, halign: 'center' },
          7: { cellWidth: 'auto' },
        },
        margin: { left: 14, right: 14 },
        didParseCell: function (data) {
          if (data.section === 'body' && data.column.index === 6) {
            const val = data.cell.raw;
            if (val === 'On time') data.cell.styles.textColor = [34, 197, 94];
            else if (val.includes('early')) data.cell.styles.textColor = [59, 130, 246];
            else if (val.includes('d late') && !val.startsWith('Late')) data.cell.styles.textColor = [245, 158, 11];
            else if (val.startsWith('Late')) data.cell.styles.textColor = [234, 179, 8];
            else if (val.startsWith('Overdue')) data.cell.styles.textColor = [249, 115, 22];
            else if (val.startsWith('Critical') || val.startsWith('Abandoned') || val === 'Never visited') data.cell.styles.textColor = [239, 68, 68];
            else if (val === 'Upcoming') data.cell.styles.textColor = [156, 163, 175];
            else data.cell.styles.textColor = [156, 163, 175];
          }
        },
      });

      yPos = doc.lastAutoTable.finalY + 8;
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Generated ${new Date().toLocaleDateString()} — Map Tracker — Page ${i}/${pageCount}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' }
      );
    }

    doc.save(`Route_${selectedRoute}_Schedule_${weekOf}.pdf`);
  }, [schedule, selectedRoute, weekOf, storeMap, complianceStats]);

  // Generate clean schedule PDF — no status, no scores, no visit history
  const generateCleanPDF = useCallback(() => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Route ${selectedRoute} — Weekly Schedule`, pageWidth / 2, 16, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const monday = new Date(weekOf + 'T00:00:00');
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const dateRange = `Week of ${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    doc.text(dateRange, pageWidth / 2, 22, { align: 'center' });

    const totalStops = DAYS.reduce((sum, d) => sum + (schedule[d] || []).length, 0);
    doc.text(`${totalStops} stop${totalStops !== 1 ? 's' : ''} — ${DAYS.filter(d => (schedule[d] || []).length > 0).length} days`, pageWidth / 2, 27, { align: 'center' });

    let yPos = 33;

    DAYS.forEach(day => {
      const stops = schedule[day] || [];
      if (stops.length === 0) return;

      if (yPos + 15 + stops.length * 8 > doc.internal.pageSize.getHeight() - 12) {
        doc.addPage();
        yPos = 15;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 58, 95);
      doc.text(`${DAY_LABELS[day]}`, 14, yPos);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`${stops.length} stop${stops.length !== 1 ? 's' : ''}`, 14 + doc.getTextWidth(`${DAY_LABELS[day]}`) + 4, yPos);
      doc.setTextColor(0, 0, 0);
      yPos += 2;

      const tableData = stops.map(item => {
        const store = storeMap[item.storeId];
        if (!store) return [item.stopNumber, item.storeId, '—', '—', item.notes || ''];
        const addr = `${store.address || ''}, ${store.city || ''} ${store.state || ''}`.trim().replace(/^,\s*/, '');
        return [
          item.stopNumber,
          store.id,
          store.name || '—',
          addr,
          item.notes || '',
        ];
      });

      autoTable(doc, {
        startY: yPos,
        head: [['#', 'Store ID', 'Store Name', 'Address', 'Notes']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 95], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        bodyStyles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 25 },
          2: { cellWidth: 55 },
          3: { cellWidth: 100 },
          4: { cellWidth: 'auto' },
        },
        margin: { left: 14, right: 14 },
      });

      yPos = doc.lastAutoTable.finalY + 10;
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(180, 180, 180);
      doc.text(
        `Route ${selectedRoute} — ${dateRange} — Page ${i}/${pageCount}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' }
      );
    }

    doc.save(`Route_${selectedRoute}_Clean_Schedule_${weekOf}.pdf`);
  }, [schedule, selectedRoute, weekOf, storeMap]);

  return (
    <div className="schedule-page">
      <div className="schedule-header">
        <h2>Route Schedule</h2>
        <div className="schedule-controls">
          <select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)}>
            <option value="">Select Route</option>
            {routes.map(r => (
              <option key={r} value={r}>Route {r}</option>
            ))}
          </select>
          <input
            type="date"
            value={weekOf}
            onChange={(e) => setWeekOf(getMonday(e.target.value))}
          />
          {selectedRoute && (
            <div className="schedule-pdf-dropdown-wrap">
              <div className="schedule-pdf-split-btn">
                <button className="btn btn-primary schedule-pdf-main" onClick={generatePDF}>
                  Export PDF
                </button>
                <button
                  className="btn btn-primary schedule-pdf-caret"
                  onClick={() => setShowPdfMenu(m => !m)}
                  title="More export options"
                >▾</button>
              </div>
              {showPdfMenu && (
                <div className="schedule-pdf-menu">
                  <button className="schedule-pdf-menu-item" onClick={() => { generatePDF(); setShowPdfMenu(false); }}>
                    <span className="schedule-pdf-menu-icon">📊</span>
                    <div>
                      <div className="schedule-pdf-menu-label">Full Schedule</div>
                      <div className="schedule-pdf-menu-desc">Includes visit history, days since, compliance status</div>
                    </div>
                  </button>
                  <button className="schedule-pdf-menu-item" onClick={() => { generateCleanPDF(); setShowPdfMenu(false); }}>
                    <span className="schedule-pdf-menu-icon">📋</span>
                    <div>
                      <div className="schedule-pdf-menu-label">Clean Schedule</div>
                      <div className="schedule-pdf-menu-desc">Stop #, store, address only — no scores or status</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="schedules-dropdown-wrapper">
            <button
              className={`schedule-saved-btn ${showSchedulesDropdown ? 'active' : ''}`}
              onClick={toggleSchedulesDropdown}
            >
              <span>📋</span>
              <span className="schedule-saved-btn-text">Saved Schedules</span>
              {savedSchedulesList.length > 0 && (
                <span className="schedules-count-badge">{savedSchedulesList.length}</span>
              )}
            </button>

            {showSchedulesDropdown && (
              <div className="schedules-dropdown">
                <div className="schedules-dropdown-header">
                  <span className="schedules-dropdown-title">Saved Schedules</span>
                  {savedSchedulesList.length > 0 && (
                    <span className="schedules-count-badge">{savedSchedulesList.length}</span>
                  )}
                </div>

                <div className="schedules-list">
                  {savedSchedulesList.length === 0 ? (
                    <div className="schedules-list-empty">
                      <p>No saved schedules yet</p>
                      <p style={{ fontSize: '12px', marginTop: '8px' }}>
                        Create a schedule by selecting a route and week above
                      </p>
                    </div>
                  ) : (
                    savedSchedulesList.map(item => {
                      const isCurrentSchedule = selectedRoute === item.route && weekOf === item.weekOf;
                      return (
                        <div
                          key={item.key}
                          className={`schedule-list-item ${isCurrentSchedule ? 'active' : ''}`}
                          onClick={() => loadSavedSchedule(item)}
                        >
                          <div className="schedule-item-top">
                            <span className="schedule-item-route">Route {item.route}</span>
                            <span className="schedule-item-stops">{item.totalStops} stops</span>
                          </div>
                          <div className="schedule-item-week">
                            {formatWeekRange(item.weekStart, item.weekEnd)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compliance Summary */}
      {selectedRoute && complianceStats.total > 0 && (
        <div className="schedule-compliance-bar">
          <div className="compliance-stat">
            <span className="compliance-pct" style={{
              color: complianceStats.adherence >= 80 ? '#22c55e' : complianceStats.adherence >= 50 ? '#f97316' : '#ef4444'
            }}>{complianceStats.adherence}%</span>
            <span className="compliance-label">Adherence</span>
          </div>
          <div className="compliance-stat">
            <span className="compliance-val" style={{ color: '#22c55e' }}>{complianceStats.exact}</span>
            <span className="compliance-label">On time</span>
          </div>
          <div className="compliance-stat">
            <span className="compliance-val" style={{ color: '#3b82f6' }}>{complianceStats.sameWeek}</span>
            <span className="compliance-label">Off-day</span>
          </div>
          {complianceStats.late > 0 && (
            <div className="compliance-stat">
              <span className="compliance-val" style={{ color: '#f59e0b' }}>{complianceStats.late}</span>
              <span className="compliance-label">Visited late</span>
            </div>
          )}
          <div className="compliance-stat">
            <span className="compliance-val" style={{ color: '#ef4444' }}>{complianceStats.missed}</span>
            <span className="compliance-label">Missed</span>
          </div>
          <div className="compliance-stat">
            <span className="compliance-val" style={{ color: '#9ca3af' }}>{complianceStats.future}</span>
            <span className="compliance-label">Upcoming</span>
          </div>
          <div className="compliance-bar-track">
            {complianceStats.exact > 0 && <div className="compliance-bar-seg" style={{ background: '#22c55e', flex: complianceStats.exact }}></div>}
            {complianceStats.sameWeek > 0 && <div className="compliance-bar-seg" style={{ background: '#3b82f6', flex: complianceStats.sameWeek }}></div>}
            {complianceStats.late > 0 && <div className="compliance-bar-seg" style={{ background: '#f59e0b', flex: complianceStats.late }}></div>}
            {complianceStats.missed > 0 && <div className="compliance-bar-seg" style={{ background: '#ef4444', flex: complianceStats.missed }}></div>}
            {complianceStats.future > 0 && <div className="compliance-bar-seg" style={{ background: '#e5e7eb', flex: complianceStats.future }}></div>}
          </div>
        </div>
      )}

      {/* Store totals summary */}
      {selectedRoute && (
        <div className="schedule-store-totals">
          <div className="store-total-stat">
            <span className="store-total-val">{routeStores.length}</span>
            <span className="store-total-label">Total Stores</span>
          </div>
          <div className="store-total-divider" />
          <div className="store-total-stat">
            <span className="store-total-val" style={{ color: '#16a34a' }}>{routeStores.length - unscheduledStores.length}</span>
            <span className="store-total-label">Scheduled</span>
          </div>
          <div className="store-total-divider" />
          <div className="store-total-stat">
            <span className="store-total-val" style={{ color: '#6b7280' }}>{unscheduledStores.length}</span>
            <span className="store-total-label">Unscheduled</span>
          </div>
          {unscheduledStores.length > 0 && (
            <>
              <div className="store-total-divider" />
              <div className="store-total-stat">
                <span className="store-total-val" style={{ color: '#1d4ed8' }}>{unscheduledChain.length}</span>
                <span className="store-total-label">Chain</span>
              </div>
              <div className="store-total-stat">
                <span className="store-total-val" style={{ color: '#92400e' }}>{unscheduledCash.length}</span>
                <span className="store-total-label">Cash / Ind.</span>
              </div>
            </>
          )}
          {routeStores.length > 0 && (
            <div className="store-total-progress">
              <div
                className="store-total-progress-fill"
                style={{ width: `${Math.round(((routeStores.length - unscheduledStores.length) / routeStores.length) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {!selectedRoute ? (
        <div className="schedule-empty">Select a route to build a weekly schedule</div>
      ) : (
        <div className="schedule-layout">
          {/* Unscheduled stores pool */}
          <div className="schedule-pool">
            <div className="schedule-pool-header">
              <span>Unscheduled ({unscheduledStores.length})</span>
            </div>
            <div className="schedule-pool-list">
              {/* Chain stores group */}
              {unscheduledChain.length > 0 && (
                <div className="schedule-pool-group-header schedule-pool-group-chain">
                  Chain Stores ({unscheduledChain.length})
                </div>
              )}
              {unscheduledChain.map(s => {
                const latest = [s.lastSaleDate, s.lastVisited].filter(Boolean).sort().pop() || null;
                const days = getDaysSinceVisit(latest);
                return (
                  <div
                    key={s.id}
                    className="schedule-store-chip"
                    draggable
                    onDragStart={() => handleDragStart(s.id, null)}
                  >
                    <div className="schedule-chip-name">{s.id} — {s.name}</div>
                    <div className="schedule-chip-detail">
                      {s.city}
                      <span className="schedule-chip-days" style={{
                        color: days === null ? '#9ca3af' : days <= 7 ? '#22c55e' : days <= 14 ? '#f97316' : '#ef4444'
                      }}>
                        {latest ? `${new Date(latest + 'T00:00:00').getMonth() + 1}/${new Date(latest + 'T00:00:00').getDate()} (${days}d)` : 'Never'}
                      </span>
                    </div>
                    <div
                      className="schedule-chip-lastvisit schedule-stop-days-clickable"
                      onClick={(e) => { e.stopPropagation(); openVisitEdit(s.id); }}
                      title={days !== null ? `${days} days since last visit — click to edit` : 'Click to edit visit date'}
                    >
                      {s.lastSaleDate ? `S: ${formatVisitDate(s.lastSaleDate)}` : ''}{s.lastSaleDate && s.lastVisited ? ' / ' : ''}{s.lastVisited ? `V: ${formatVisitDate(s.lastVisited)}` : ''}{!s.lastSaleDate && !s.lastVisited ? 'No date' : ''}
                    </div>
                    {visitEditId === s.id && (
                      <div className="schedule-visit-edit">
                        <input
                          ref={visitDateRef}
                          type="date"
                          className="schedule-visit-date-input"
                          value={visitEditDate}
                          onChange={(e) => setVisitEditDate(e.target.value)}
                        />
                        <button className="schedule-visit-save-btn" onClick={() => saveVisitDate(s.id)} disabled={!visitEditDate}>Save</button>
                        <button className="schedule-visit-cancel-btn" onClick={() => setVisitEditId(null)}>&times;</button>
                      </div>
                    )}
                    <div className="schedule-chip-add-btns">
                      {DAYS.map(d => (
                        <button
                          key={d}
                          className="schedule-chip-add"
                          onClick={() => addStoreToDay(s.id, d)}
                          title={`Add to ${DAY_LABELS[d]}`}
                        >
                          {DAY_LABELS[d].charAt(0)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Cash / Independent stores group */}
              {unscheduledCash.length > 0 && (
                <div className="schedule-pool-group-header schedule-pool-group-cash">
                  Cash / Independent ({unscheduledCash.length})
                </div>
              )}
              {unscheduledCash.map(s => {
                const latest = [s.lastSaleDate, s.lastVisited].filter(Boolean).sort().pop() || null;
                const days = getDaysSinceVisit(latest);
                return (
                  <div
                    key={s.id}
                    className="schedule-store-chip schedule-chip-cash"
                    draggable
                    onDragStart={() => handleDragStart(s.id, null)}
                  >
                    <div className="schedule-chip-name">{s.id} — {s.name}</div>
                    <div className="schedule-chip-detail">
                      {s.city}
                      <span className="schedule-chip-days" style={{
                        color: days === null ? '#9ca3af' : days <= 7 ? '#22c55e' : days <= 14 ? '#f97316' : '#ef4444'
                      }}>
                        {latest ? `${new Date(latest + 'T00:00:00').getMonth() + 1}/${new Date(latest + 'T00:00:00').getDate()} (${days}d)` : 'Never'}
                      </span>
                    </div>
                    <div
                      className="schedule-chip-lastvisit schedule-stop-days-clickable"
                      onClick={(e) => { e.stopPropagation(); openVisitEdit(s.id); }}
                      title={days !== null ? `${days} days since last visit — click to edit` : 'Click to edit visit date'}
                    >
                      {s.lastSaleDate ? `S: ${formatVisitDate(s.lastSaleDate)}` : ''}{s.lastSaleDate && s.lastVisited ? ' / ' : ''}{s.lastVisited ? `V: ${formatVisitDate(s.lastVisited)}` : ''}{!s.lastSaleDate && !s.lastVisited ? 'No date' : ''}
                    </div>
                    {visitEditId === s.id && (
                      <div className="schedule-visit-edit">
                        <input
                          ref={visitDateRef}
                          type="date"
                          className="schedule-visit-date-input"
                          value={visitEditDate}
                          onChange={(e) => setVisitEditDate(e.target.value)}
                        />
                        <button className="schedule-visit-save-btn" onClick={() => saveVisitDate(s.id)} disabled={!visitEditDate}>Save</button>
                        <button className="schedule-visit-cancel-btn" onClick={() => setVisitEditId(null)}>&times;</button>
                      </div>
                    )}
                    <div className="schedule-chip-add-btns">
                      {DAYS.map(d => (
                        <button
                          key={d}
                          className="schedule-chip-add"
                          onClick={() => addStoreToDay(s.id, d)}
                          title={`Add to ${DAY_LABELS[d]}`}
                        >
                          {DAY_LABELS[d].charAt(0)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {unscheduledStores.length === 0 && (
                <div className="schedule-pool-empty">All stores scheduled</div>
              )}
            </div>
          </div>

          {/* Day columns */}
          <div className="schedule-days">
            {DAYS.map(day => {
              const dayStops = schedule[day] || [];
              return (
                <div
                  key={day}
                  className={`schedule-day-col ${dragItem ? 'drop-target' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(day)}
                >
                  <div className="schedule-day-header">
                    <span className="schedule-day-label">{DAY_LABELS[day]}</span>
                    <span className="schedule-day-count">{dayStops.length}</span>
                    <div className="schedule-day-actions">
                      {unscheduledStores.length > 0 && (
                        <button className="btn-icon" onClick={() => addAllToDay(day)} title="Add all remaining">+all</button>
                      )}
                      {dayStops.length > 0 && (
                        <button className="btn-icon btn-icon-danger" onClick={() => clearDay(day)} title="Clear day">clear</button>
                      )}
                    </div>
                  </div>
                  <div className="schedule-day-stops">
                    {dayStops.map((item, idx) => {
                      const store = storeMap[item.storeId];
                      if (!store) return null;
                      const latest = [store.lastSaleDate, store.lastVisited].filter(Boolean).sort().pop() || null;
                      const days = getDaysSinceVisit(latest);
                      const compliance = getStopCompliance(item.storeId, day, weekOf, latest, visitHistoryMap);
                      const isEditingNote = noteEditing === `${day}_${item.storeId}`;
                      return (
                        <div
                          key={item.storeId}
                          className={`schedule-stop compliance-${compliance.status}`}
                          draggable
                          onDragStart={() => handleDragStart(item.storeId, day)}
                        >
                          <div className="schedule-stop-top">
                            <span className="schedule-stop-num">{item.stopNumber}</span>
                            <div className="schedule-stop-info">
                              <div className="schedule-stop-name">
                                {store.id}
                                <span
                                  className="schedule-stop-days schedule-stop-days-clickable"
                                  style={{
                                    color: days === null ? '#9ca3af' : days <= 7 ? '#22c55e' : days <= 14 ? '#f97316' : '#ef4444'
                                  }}
                                  onClick={(e) => { e.stopPropagation(); openVisitEdit(store.id); }}
                                  title={days !== null ? `${days} days since last visit — click to edit` : 'Click to edit visit date'}
                                >
                                  {latest ? `${new Date(latest + 'T00:00:00').getMonth() + 1}/${new Date(latest + 'T00:00:00').getDate()} (${days}d)` : 'Never'}
                                </span>
                              </div>
                              <div className="schedule-stop-detail">{store.name}</div>
                              <div className="schedule-stop-addr">{store.address}, {store.city}</div>
                            </div>
                            <div className="schedule-stop-compliance">
                              <span className="compliance-badge" style={{ color: compliance.color, borderColor: compliance.color }} title={compliance.tooltip || ''}>
                                {compliance.label}
                              </span>
                              {compliance.visitDate && (
                                <span className="compliance-visit-date">{compliance.visitDate}</span>
                              )}
                            </div>
                            <div className="schedule-stop-actions">
                              <button className="btn-icon" onClick={() => moveStop(day, idx, -1)} disabled={idx === 0}>▲</button>
                              <button className="btn-icon" onClick={() => moveStop(day, idx, 1)} disabled={idx === dayStops.length - 1}>▼</button>
                              <button className="btn-icon btn-icon-danger" onClick={() => removeFromDay(day, item.storeId)}>✕</button>
                            </div>
                          </div>
                          {visitEditId === store.id && (
                            <div className="schedule-visit-edit">
                              <input
                                ref={visitDateRef}
                                type="date"
                                className="schedule-visit-date-input"
                                value={visitEditDate}
                                onChange={(e) => setVisitEditDate(e.target.value)}
                              />
                              <button className="schedule-visit-save-btn" onClick={() => saveVisitDate(store.id)} disabled={!visitEditDate}>Save</button>
                              <button className="schedule-visit-cancel-btn" onClick={() => setVisitEditId(null)}>&times;</button>
                            </div>
                          )}
                          {isEditingNote ? (
                            <input
                              className="schedule-stop-note-input"
                              type="text"
                              value={item.notes}
                              onChange={(e) => updateNotes(day, item.storeId, e.target.value)}
                              onBlur={() => setNoteEditing(null)}
                              onKeyDown={(e) => e.key === 'Enter' && setNoteEditing(null)}
                              autoFocus
                              placeholder="Add notes..."
                            />
                          ) : (
                            <div className="schedule-stop-note" onClick={() => setNoteEditing(`${day}_${item.storeId}`)}>
                              {item.notes || 'Click to add notes...'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {dayStops.length === 0 && (
                      <div className="schedule-day-empty">Drag stores here or use day buttons</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

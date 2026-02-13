import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };
const SCHEDULE_STORAGE_KEY = 'route_schedules';

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const visited = new Date(lastVisited);
  if (isNaN(visited.getTime())) return null;
  return Math.floor((new Date() - visited) / (1000 * 60 * 60 * 24));
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function loadSchedules() {
  try {
    return JSON.parse(localStorage.getItem(SCHEDULE_STORAGE_KEY)) || {};
  } catch { return {}; }
}

function saveSchedules(schedules) {
  localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedules));
}

function getScheduleKey(route, weekOf) {
  return `${route}_${weekOf}`;
}

export default function RouteSchedule() {
  const { state } = useApp();
  const { stores } = state;

  const [selectedRoute, setSelectedRoute] = useState('');
  const [weekOf, setWeekOf] = useState(getMonday(new Date()));
  const [schedule, setSchedule] = useState(() => {
    const empty = {};
    DAYS.forEach(d => { empty[d] = []; });
    return empty;
  });
  const [dragItem, setDragItem] = useState(null);
  const [noteEditing, setNoteEditing] = useState(null);

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
      schedule[d].forEach(item => set.add(item.storeId));
    });
    return set;
  }, [schedule]);

  // Unscheduled stores
  const unscheduledStores = useMemo(() => {
    return routeStores.filter(s => !scheduledIds.has(s.id));
  }, [routeStores, scheduledIds]);

  // Load schedule when route or week changes
  function handleRouteChange(route) {
    setSelectedRoute(route);
    loadScheduleForRoute(route, weekOf);
  }

  function handleWeekChange(week) {
    setWeekOf(week);
    loadScheduleForRoute(selectedRoute, week);
  }

  function loadScheduleForRoute(route, week) {
    const all = loadSchedules();
    const key = getScheduleKey(route, week);
    if (all[key]) {
      setSchedule(all[key]);
    } else {
      const empty = {};
      DAYS.forEach(d => { empty[d] = []; });
      setSchedule(empty);
    }
  }

  function persistSchedule(newSchedule) {
    setSchedule(newSchedule);
    if (selectedRoute) {
      const all = loadSchedules();
      all[getScheduleKey(selectedRoute, weekOf)] = newSchedule;
      saveSchedules(all);
    }
  }

  // Add store to a day
  function addStoreToDay(storeId, day) {
    const newSchedule = { ...schedule };
    newSchedule[day] = [...newSchedule[day], { storeId, stopNumber: newSchedule[day].length + 1, notes: '' }];
    persistSchedule(newSchedule);
  }

  // Remove store from a day
  function removeFromDay(day, storeId) {
    const newSchedule = { ...schedule };
    newSchedule[day] = newSchedule[day]
      .filter(item => item.storeId !== storeId)
      .map((item, i) => ({ ...item, stopNumber: i + 1 }));
    persistSchedule(newSchedule);
  }

  // Move stop up/down within a day
  function moveStop(day, index, direction) {
    const newDay = [...schedule[day]];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newDay.length) return;
    [newDay[index], newDay[targetIndex]] = [newDay[targetIndex], newDay[index]];
    const newSchedule = { ...schedule };
    newSchedule[day] = newDay.map((item, i) => ({ ...item, stopNumber: i + 1 }));
    persistSchedule(newSchedule);
  }

  // Update notes for a stop
  function updateNotes(day, storeId, notes) {
    const newSchedule = { ...schedule };
    newSchedule[day] = newSchedule[day].map(item =>
      item.storeId === storeId ? { ...item, notes } : item
    );
    persistSchedule(newSchedule);
  }

  // Drag & drop handlers
  function handleDragStart(storeId, fromDay) {
    setDragItem({ storeId, fromDay });
  }

  function handleDrop(toDay) {
    if (!dragItem) return;
    const { storeId, fromDay } = dragItem;

    if (fromDay === toDay) { setDragItem(null); return; }

    const newSchedule = { ...schedule };

    // Remove from source day if it came from one
    if (fromDay) {
      newSchedule[fromDay] = newSchedule[fromDay]
        .filter(item => item.storeId !== storeId)
        .map((item, i) => ({ ...item, stopNumber: i + 1 }));
    }

    // Find existing notes if moving between days
    const existingItem = fromDay
      ? schedule[fromDay].find(item => item.storeId === storeId)
      : null;

    // Add to target day
    newSchedule[toDay] = [
      ...newSchedule[toDay],
      { storeId, stopNumber: newSchedule[toDay].length + 1, notes: existingItem?.notes || '' }
    ];

    persistSchedule(newSchedule);
    setDragItem(null);
  }

  // Add all unscheduled to a day
  function addAllToDay(day) {
    const newSchedule = { ...schedule };
    let nextStop = newSchedule[day].length + 1;
    unscheduledStores.forEach(s => {
      newSchedule[day].push({ storeId: s.id, stopNumber: nextStop++, notes: '' });
    });
    persistSchedule(newSchedule);
  }

  // Clear a day
  function clearDay(day) {
    const newSchedule = { ...schedule };
    newSchedule[day] = [];
    persistSchedule(newSchedule);
  }

  // Store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Generate PDF
  const generatePDF = useCallback(() => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
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

    const totalScheduled = DAYS.reduce((sum, d) => sum + schedule[d].length, 0);
    doc.text(`${totalScheduled} stops across ${DAYS.filter(d => schedule[d].length > 0).length} days`, pageWidth / 2, 26, { align: 'center' });

    let yPos = 32;

    DAYS.forEach(day => {
      const stops = schedule[day];
      if (stops.length === 0) return;

      // Check if we need a new page
      if (yPos + 15 + stops.length * 8 > doc.internal.pageSize.getHeight() - 10) {
        doc.addPage();
        yPos = 15;
      }

      // Day header
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(37, 99, 235);
      doc.text(`${DAY_LABELS[day]} — ${stops.length} stop${stops.length !== 1 ? 's' : ''}`, 14, yPos);
      doc.setTextColor(0, 0, 0);
      yPos += 2;

      // Table
      const tableData = stops.map(item => {
        const store = storeMap[item.storeId];
        if (!store) return [item.stopNumber, item.storeId, '—', '—', '—', '—', item.notes || ''];
        const days = getDaysSinceVisit(store.lastVisited);
        const lastVisit = store.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : 'Never';
        const daysText = days !== null ? `${days}d` : 'Never';
        return [
          item.stopNumber,
          store.id,
          store.name || '—',
          `${store.address || ''}, ${store.city || ''} ${store.state || ''}`.trim().replace(/^,\s*/, ''),
          lastVisit,
          daysText,
          item.notes || '',
        ];
      });

      doc.autoTable({
        startY: yPos,
        head: [['#', 'Store ID', 'Store Name', 'Address', 'Last Visit', 'Days', 'Notes']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 35 },
          3: { cellWidth: 65 },
          4: { cellWidth: 22 },
          5: { cellWidth: 14, halign: 'center' },
          6: { cellWidth: 'auto' },
        },
        margin: { left: 14, right: 14 },
      });

      yPos = doc.lastAutoTable.finalY + 8;
    });

    // Footer on each page
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
  }, [schedule, selectedRoute, weekOf, storeMap]);

  return (
    <div className="schedule-page">
      <div className="schedule-header">
        <h2>Route Schedule</h2>
        <div className="schedule-controls">
          <select value={selectedRoute} onChange={(e) => handleRouteChange(e.target.value)}>
            <option value="">Select Route</option>
            {routes.map(r => (
              <option key={r} value={r}>Route {r}</option>
            ))}
          </select>
          <input
            type="date"
            value={weekOf}
            onChange={(e) => handleWeekChange(getMonday(e.target.value))}
          />
          {selectedRoute && (
            <button className="btn btn-primary schedule-pdf-btn" onClick={generatePDF}>
              Export PDF
            </button>
          )}
        </div>
      </div>

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
              {unscheduledStores.map(s => {
                const days = getDaysSinceVisit(s.lastVisited);
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
                        {days === null ? 'Never' : `${days}d`}
                      </span>
                    </div>
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
            </div>
          </div>

          {/* Day columns */}
          <div className="schedule-days">
            {DAYS.map(day => (
              <div
                key={day}
                className={`schedule-day-col ${dragItem ? 'drop-target' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(day)}
              >
                <div className="schedule-day-header">
                  <span className="schedule-day-label">{DAY_LABELS[day]}</span>
                  <span className="schedule-day-count">{schedule[day].length}</span>
                  <div className="schedule-day-actions">
                    {unscheduledStores.length > 0 && (
                      <button
                        className="btn-icon"
                        onClick={() => addAllToDay(day)}
                        title="Add all remaining"
                      >+all</button>
                    )}
                    {schedule[day].length > 0 && (
                      <button
                        className="btn-icon btn-icon-danger"
                        onClick={() => clearDay(day)}
                        title="Clear day"
                      >clear</button>
                    )}
                  </div>
                </div>
                <div className="schedule-day-stops">
                  {schedule[day].map((item, idx) => {
                    const store = storeMap[item.storeId];
                    if (!store) return null;
                    const days = getDaysSinceVisit(store.lastVisited);
                    const isEditingNote = noteEditing === `${day}_${item.storeId}`;
                    return (
                      <div
                        key={item.storeId}
                        className="schedule-stop"
                        draggable
                        onDragStart={() => handleDragStart(item.storeId, day)}
                      >
                        <div className="schedule-stop-top">
                          <span className="schedule-stop-num">{item.stopNumber}</span>
                          <div className="schedule-stop-info">
                            <div className="schedule-stop-name">{store.id}</div>
                            <div className="schedule-stop-detail">{store.name}</div>
                            <div className="schedule-stop-addr">{store.address}, {store.city}</div>
                          </div>
                          <div className="schedule-stop-status">
                            <span style={{
                              color: days === null ? '#9ca3af' : days <= 7 ? '#22c55e' : days <= 14 ? '#f97316' : '#ef4444'
                            }}>
                              {days === null ? 'Never' : `${days}d`}
                            </span>
                          </div>
                          <div className="schedule-stop-actions">
                            <button
                              className="btn-icon"
                              onClick={() => moveStop(day, idx, -1)}
                              disabled={idx === 0}
                            >▲</button>
                            <button
                              className="btn-icon"
                              onClick={() => moveStop(day, idx, 1)}
                              disabled={idx === schedule[day].length - 1}
                            >▼</button>
                            <button
                              className="btn-icon btn-icon-danger"
                              onClick={() => removeFromDay(day, item.storeId)}
                            >✕</button>
                          </div>
                        </div>
                        {/* Notes */}
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
                          <div
                            className="schedule-stop-note"
                            onClick={() => setNoteEditing(`${day}_${item.storeId}`)}
                          >
                            {item.notes || 'Click to add notes...'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {schedule[day].length === 0 && (
                    <div className="schedule-day-empty">
                      Drag stores here or use day buttons
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

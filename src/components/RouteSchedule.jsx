import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import visitHistory from '../data/visitHistory';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };
const DAY_OFFSETS = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4 };

function getDaysSinceVisit(lastVisited) {
  if (!lastVisited) return null;
  const visited = new Date(lastVisited);
  if (isNaN(visited.getTime())) return null;
  return Math.floor((new Date() - visited) / (1000 * 60 * 60 * 24));
}

function formatVisitDate(lastVisited) {
  if (!lastVisited) return 'Never';
  const d = new Date(lastVisited);
  if (isNaN(d.getTime())) return 'Never';
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

/** Check compliance: was store visited on the scheduled day or same week? */
function getStopCompliance(storeId, scheduledDay, weekOf) {
  const scheduledDate = getDayDate(weekOf, scheduledDay);
  const weekEnd = getDayDate(weekOf, 'friday');
  const weekStart = weekOf;

  // Get all visit dates for this store
  const visits = visitHistory[storeId] || [];

  // Check if visited on exact day
  const exactMatch = visits.includes(scheduledDate);
  if (exactMatch) return { status: 'exact', label: 'On time', color: '#22c55e', visitDate: scheduledDate };

  // Check if visited same week (any day Mon-Fri)
  const sameWeekVisit = visits.find(v => v >= weekStart && v <= weekEnd);
  if (sameWeekVisit) return { status: 'sameWeek', label: 'Same week', color: '#3b82f6', visitDate: sameWeekVisit };

  // Check if the scheduled date is in the future
  const today = new Date().toISOString().split('T')[0];
  if (scheduledDate > today) return { status: 'future', label: 'Upcoming', color: '#9ca3af', visitDate: null };

  return { status: 'missed', label: 'Missed', color: '#ef4444', visitDate: null };
}

export default function RouteSchedule() {
  const { state, saveSchedule } = useApp();
  const { stores, schedules } = state;

  const [selectedRoute, setSelectedRoute] = useState('');
  const [weekOf, setWeekOf] = useState(getMonday(new Date()));
  const [dragItem, setDragItem] = useState(null);
  const [noteEditing, setNoteEditing] = useState(null);

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

  // Compliance stats
  const complianceStats = useMemo(() => {
    let total = 0, exact = 0, sameWeek = 0, missed = 0, future = 0;
    DAYS.forEach(day => {
      (schedule[day] || []).forEach(item => {
        total++;
        const c = getStopCompliance(item.storeId, day, weekOf);
        if (c.status === 'exact') exact++;
        else if (c.status === 'sameWeek') sameWeek++;
        else if (c.status === 'missed') missed++;
        else future++;
      });
    });
    const completed = exact + sameWeek;
    const adherence = total > 0 ? Math.round((completed / (total - future)) * 100) || 0 : 0;
    return { total, exact, sameWeek, missed, future, completed, adherence };
  }, [schedule, weekOf]);

  // Store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

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
        const days = getDaysSinceVisit(store.lastVisited);
        const lastVisit = store.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : 'Never';
        const daysText = days !== null ? `${days}d` : 'Never';
        const compliance = getStopCompliance(item.storeId, day, weekOf);
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
            else if (val === 'Same week') data.cell.styles.textColor = [59, 130, 246];
            else if (val === 'Missed') data.cell.styles.textColor = [239, 68, 68];
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
            <button className="btn btn-primary schedule-pdf-btn" onClick={generatePDF}>
              Export PDF
            </button>
          )}
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
            <span className="compliance-label">Same week</span>
          </div>
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
            {complianceStats.missed > 0 && <div className="compliance-bar-seg" style={{ background: '#ef4444', flex: complianceStats.missed }}></div>}
            {complianceStats.future > 0 && <div className="compliance-bar-seg" style={{ background: '#e5e7eb', flex: complianceStats.future }}></div>}
          </div>
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
                    <div className="schedule-chip-lastvisit">
                      Last: {formatVisitDate(s.lastVisited)}
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
                      const days = getDaysSinceVisit(store.lastVisited);
                      const compliance = getStopCompliance(item.storeId, day, weekOf);
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
                              <div className="schedule-stop-name">{store.id}</div>
                              <div className="schedule-stop-detail">{store.name}</div>
                              <div className="schedule-stop-addr">{store.address}, {store.city}</div>
                              <div className="schedule-stop-lastvisit">Last visit: {formatVisitDate(store.lastVisited)}</div>
                            </div>
                            <div className="schedule-stop-compliance">
                              <span className="compliance-badge" style={{ color: compliance.color, borderColor: compliance.color }}>
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

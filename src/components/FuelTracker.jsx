import React, { useState, useMemo, useCallback } from 'react';
import { fetchCardTransactions, fetchMotiveCards, fetchVehicles } from '../services/motiveService';
import { fleetVehicles } from '../data/fleetData';

// ---- Persistence ----
const CARD_ROUTE_MAP_KEY = 'fuel_card_route_map';

function loadCardRouteMap() {
  try { return JSON.parse(localStorage.getItem(CARD_ROUTE_MAP_KEY) || '{}'); }
  catch { return {}; }
}

function saveCardRouteMap(map) {
  localStorage.setItem(CARD_ROUTE_MAP_KEY, JSON.stringify(map));
}

// ---- Route options from fleet data ----
const routeOptions = [...new Set(fleetVehicles.map(v => v.routeNumber))]
  .sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  })
  .map(rn => {
    const veh = fleetVehicles.find(v => v.routeNumber === rn);
    const label = veh ? veh.vehicleId.slice(0, 30) : '';
    return { value: rn, label: `Route ${rn}${label ? ' — ' + label : ''}` };
  });

// ---- Formatters ----
const fmt$ = v => `$${(v || 0).toFixed(2)}`;
const fmtGal = v => `${(v || 0).toFixed(3)} gal`;

function getWeekRange(weeksAgo = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) - weeksAgo * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function getMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}

// ---- VIN → routeNumber map from fleetData ----
const vinRouteMap = Object.fromEntries(fleetVehicles.map(v => [v.vin, v.routeNumber]));

export default function FuelTracker() {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(() => getWeekRange().start);
  const [endDate, setEndDate]     = useState(() => getWeekRange().end > today ? today : getWeekRange().end);

  const [transactions, setTransactions]     = useState([]);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);
  const [lastFetched, setLastFetched]       = useState(null);

  const [cards, setCards]           = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError]     = useState(null);

  // cardId → routeNumber (manual overrides, persisted)
  const [cardRouteMap, setCardRouteMap] = useState(loadCardRouteMap);

  // motiveVehicleId → routeNumber (built when fetching)
  const [vehicleRouteMap, setVehicleRouteMap] = useState({});

  const [activeTab, setActiveTab] = useState('route');
  const [filterRoute, setFilterRoute]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate]     = useState('all');
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  // ---- Card info index (for last4 lookup in tx table) ----
  const cardInfoMap = useMemo(() => {
    const m = {};
    cards.forEach(c => { m[c.cardId] = c; });
    return m;
  }, [cards]);

  // ---- Resolve route for a transaction ----
  const resolveRoute = useCallback((tx) => {
    if (tx.cardId && cardRouteMap[tx.cardId]) return cardRouteMap[tx.cardId];
    if (tx.vehicleId && vehicleRouteMap[tx.vehicleId]) return vehicleRouteMap[tx.vehicleId];
    return null;
  }, [cardRouteMap, vehicleRouteMap]);

  // ---- Enriched transactions (add route + card last4) ----
  const enriched = useMemo(() => transactions.map(tx => ({
    ...tx,
    route: resolveRoute(tx) || 'Unknown',
    last4: tx.last4 || cardInfoMap[tx.cardId]?.last4 || '',
    cardName: cardInfoMap[tx.cardId]?.entityName || '',
  })), [transactions, resolveRoute, cardInfoMap]);

  // ---- Fetch transactions + vehicles ----
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [txs, vehicles] = await Promise.all([
        fetchCardTransactions({ startDate, endDate }),
        fetchVehicles(),
      ]);

      // Build motiveVehicleId → routeNumber via VIN cross-ref
      const vMap = {};
      vehicles.forEach(v => {
        const route = vinRouteMap[v.vin];
        if (route && v.id) vMap[String(v.id)] = route;
      });
      setVehicleRouteMap(vMap);
      setTransactions(txs);
      setLastFetched(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // ---- Fetch cards ----
  const fetchCards = useCallback(async () => {
    setCardsLoading(true);
    setCardsError(null);
    try {
      const result = await fetchMotiveCards();
      setCards(result);
    } catch (e) {
      setCardsError(e.message);
    } finally {
      setCardsLoading(false);
    }
  }, []);

  // ---- Save manual card assignment ----
  const setCardRoute = useCallback((cardId, routeNumber) => {
    setCardRouteMap(prev => {
      const updated = { ...prev };
      if (routeNumber) updated[cardId] = routeNumber;
      else delete updated[cardId];
      saveCardRouteMap(updated);
      return updated;
    });
  }, []);

  // ---- Summary stats ----
  const summary = useMemo(() => {
    let totalSpend = 0, totalGallons = 0, totalRebates = 0, declinedCount = 0;
    enriched.forEach(tx => {
      if (tx.declined) { declinedCount++; return; }
      totalSpend   += tx.totalAmount;
      totalGallons += tx.totalGallons;
      totalRebates += tx.rebateAmount;
    });
    const avgPpg = totalGallons > 0 ? totalSpend / totalGallons : 0;
    return { totalSpend, totalGallons, avgPpg, totalRebates, declinedCount, total: enriched.length };
  }, [enriched]);

  // ---- Route stats ----
  const routeStats = useMemo(() => {
    const map = {};
    const ensureRoute = (r) => {
      if (!map[r]) map[r] = { route: r, count: 0, spend: 0, gallons: 0, rebates: 0, declined: 0, odometers: {} };
    };

    enriched.forEach(tx => {
      const r = tx.route;
      ensureRoute(r);
      if (tx.declined) {
        map[r].declined++;
        return;
      }
      map[r].count++;
      map[r].spend   += tx.totalAmount;
      map[r].gallons += tx.totalGallons;
      map[r].rebates += tx.rebateAmount;

      if (tx.vehicleId && tx.odometerRaw != null) {
        const vid = String(tx.vehicleId);
        if (!map[r].odometers[vid]) map[r].odometers[vid] = [];
        // Normalise to miles using the API-provided unit
        const miles = tx.odometerUnit === 'km' ? tx.odometerRaw * 0.621371 : tx.odometerRaw;
        map[r].odometers[vid].push(miles);
      }
    });

    return Object.values(map).map(r => {
      let miles = 0;
      Object.values(r.odometers).forEach(readings => {
        if (readings.length >= 2) {
          const sorted = [...readings].sort((a, b) => a - b);
          // Values already normalised to miles at collection time
          miles += sorted[sorted.length - 1] - sorted[0];
        }
      });
      const avgPpg = r.gallons > 0 ? r.spend / r.gallons : 0;
      const mpg    = miles > 0 && r.gallons > 0 ? miles / r.gallons : 0;
      const cpm    = miles > 0 && r.spend > 0 ? r.spend / miles : 0;
      return { ...r, miles, avgPpg, mpg, cpm };
    }).sort((a, b) => {
      const na = parseInt(a.route), nb = parseInt(b.route);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (a.route === 'Unknown') return 1;
      if (b.route === 'Unknown') return -1;
      return a.route.localeCompare(b.route);
    });
  }, [enriched]);

  // ---- Daily breakdown ----
  const dailyStats = useMemo(() => {
    const map = {};
    enriched.filter(tx => !tx.declined && tx.transactedAt).forEach(tx => {
      const date = tx.transactedAt.slice(0, 10);
      if (!map[date]) map[date] = { date, count: 0, spend: 0, gallons: 0, routes: new Set() };
      map[date].count++;
      map[date].spend   += tx.totalAmount;
      map[date].gallons += tx.totalGallons;
      if (tx.route !== 'Unknown') map[date].routes.add(tx.route);
    });
    return Object.values(map)
      .map(d => ({ ...d, avgPpg: d.gallons > 0 ? d.spend / d.gallons : 0, routeList: [...d.routes].sort().join(', ') }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [enriched]);

  // ---- All routes list for filters ----
  const allRoutes = useMemo(() => {
    const set = new Set(enriched.map(tx => tx.route));
    return [...set].sort((a, b) => {
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [enriched]);

  // ---- Filtered + sorted transactions ----
  const filteredTx = useMemo(() => {
    let list = enriched;
    if (filterRoute !== 'all') list = list.filter(tx => tx.route === filterRoute);
    if (filterDate !== 'all') list = list.filter(tx => tx.transactedAt && tx.transactedAt.startsWith(filterDate));
    if (filterStatus === 'declined') list = list.filter(tx => tx.declined);
    else if (filterStatus !== 'all') list = list.filter(tx => !tx.declined && tx.status === filterStatus);

    return [...list].sort((a, b) => {
      let av, bv;
      if (sortCol === 'date')    { av = a.transactedAt || ''; bv = b.transactedAt || ''; }
      else if (sortCol === 'amount')  { av = a.totalAmount;  bv = b.totalAmount; }
      else if (sortCol === 'gallons') { av = a.totalGallons; bv = b.totalGallons; }
      else if (sortCol === 'route')   { av = a.route; bv = b.route; }
      else { av = ''; bv = ''; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }, [enriched, filterRoute, filterStatus, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };
  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // ---- Render ----
  return (
    <div className="fuel-tracker">

      {/* Header */}
      <div className="fuel-header">
        <div className="fuel-header-left">
          <h2 className="fuel-title">Fuel Tracker</h2>
          <span className="fuel-subtitle">Gas usage · Route breakdown · Cost per mile</span>
        </div>
        {lastFetched && <span className="fuel-last-fetched">Last fetched: {lastFetched}</span>}
      </div>

      {/* Controls */}
      <div className="fuel-controls">
        <div className="fuel-date-group">
          <label className="fuel-label">From</label>
          <input type="date" className="fuel-date-input" value={startDate} max={today}
            onChange={e => setStartDate(e.target.value)} />
          <label className="fuel-label">To</label>
          <input type="date" className="fuel-date-input" value={endDate} max={today}
            onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="fuel-quick-btns">
          <button className="fuel-quick-btn" onClick={() => {
            const r = getWeekRange(0);
            setStartDate(r.start);
            setEndDate(r.end > today ? today : r.end);
          }}>This Week</button>
          <button className="fuel-quick-btn" onClick={() => {
            const r = getWeekRange(1);
            setStartDate(r.start);
            setEndDate(r.end);
          }}>Last Week</button>
          <button className="fuel-quick-btn" onClick={() => {
            const r = getMonthRange();
            setStartDate(r.start);
            setEndDate(r.end > today ? today : r.end);
          }}>This Month</button>
        </div>
        <button className="fuel-fetch-btn" onClick={fetchData} disabled={loading}>
          {loading ? 'Loading…' : 'Fetch Data'}
        </button>
      </div>

      {error && <div className="fuel-error">⚠ {error}</div>}

      {/* Summary stats bar */}
      {transactions.length > 0 && (
        <div className="fuel-stats-bar">
          <div className="fuel-stat">
            <span className="fuel-stat-val">{fmt$(summary.totalSpend)}</span>
            <span className="fuel-stat-lbl">Total Spend</span>
          </div>
          <div className="fuel-stat-divider" />
          <div className="fuel-stat">
            <span className="fuel-stat-val">{fmtGal(summary.totalGallons)}</span>
            <span className="fuel-stat-lbl">Gallons</span>
          </div>
          <div className="fuel-stat-divider" />
          <div className="fuel-stat">
            <span className="fuel-stat-val">{fmt$(summary.avgPpg)}/gal</span>
            <span className="fuel-stat-lbl">Avg Price</span>
          </div>
          <div className="fuel-stat-divider" />
          <div className="fuel-stat">
            <span className="fuel-stat-val fuel-stat-green">{fmt$(summary.totalRebates)}</span>
            <span className="fuel-stat-lbl">Rebates</span>
          </div>
          <div className="fuel-stat-divider" />
          <div className="fuel-stat">
            <span className="fuel-stat-val fuel-stat-red">{summary.declinedCount}</span>
            <span className="fuel-stat-lbl">Declined</span>
          </div>
          <div className="fuel-stat-divider" />
          <div className="fuel-stat">
            <span className="fuel-stat-val">{summary.total}</span>
            <span className="fuel-stat-lbl">Transactions</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="fuel-tabs">
        {[
          { id: 'route',        label: 'By Route' },
          { id: 'daily',        label: 'Daily Breakdown' },
          { id: 'transactions', label: `All Transactions${transactions.length ? ` (${transactions.length})` : ''}` },
          { id: 'cards',        label: `Card Management${Object.keys(cardRouteMap).length ? ` (${Object.keys(cardRouteMap).length})` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            className={`fuel-tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {/* ===== By Route ===== */}
      {activeTab === 'route' && (
        <div className="fuel-panel">
          {routeStats.length === 0 ? (
            <div className="fuel-empty">
              {transactions.length === 0
                ? 'Select a date range and click "Fetch Data" to see route fuel breakdown.'
                : 'No data available for the selected range.'}
            </div>
          ) : (
            <div className="fuel-table-wrap">
              <table className="fuel-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Transactions</th>
                    <th>Total Spend</th>
                    <th>Gallons</th>
                    <th>Avg $/Gal</th>
                    <th>Miles *</th>
                    <th>Cost/Mile</th>
                    <th>MPG</th>
                    <th>Rebates</th>
                    <th>Declined</th>
                  </tr>
                </thead>
                <tbody>
                  {routeStats.map(r => (
                    <tr
                      key={r.route}
                      className={`fuel-row-clickable${r.route === 'Unknown' ? ' fuel-row-unknown' : ''}`}
                      title="Click to view individual transactions"
                      onClick={() => { setFilterRoute(r.route); setActiveTab('transactions'); }}
                    >
                      <td>
                        {r.route !== 'Unknown'
                          ? <span className="fuel-route-badge">Rt {r.route}</span>
                          : <span className="fuel-route-unknown">Unlinked</span>}
                      </td>
                      <td>{r.count}</td>
                      <td className="fuel-td-amount">{fmt$(r.spend)}</td>
                      <td>{fmtGal(r.gallons)}</td>
                      <td>{fmt$(r.avgPpg)}</td>
                      <td>{r.miles > 0 ? `${r.miles.toFixed(0)} mi` : '—'}</td>
                      <td>{r.cpm > 0 ? `$${r.cpm.toFixed(3)}/mi` : '—'}</td>
                      <td>{r.mpg > 0 ? `${r.mpg.toFixed(1)} mpg` : '—'}</td>
                      <td className={r.rebates > 0 ? 'fuel-td-green' : ''}>{fmt$(r.rebates)}</td>
                      <td className={r.declined > 0 ? 'fuel-td-red' : ''}>{r.declined || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="fuel-table-note">* Miles estimated from odometer delta — requires multiple transactions per vehicle in the date range.</div>
            </div>
          )}
        </div>
      )}

      {/* ===== Daily Breakdown ===== */}
      {activeTab === 'daily' && (
        <div className="fuel-panel">
          {dailyStats.length === 0 ? (
            <div className="fuel-empty">
              {transactions.length === 0
                ? 'Fetch data to see the daily breakdown.'
                : 'No transactions in the selected range.'}
            </div>
          ) : (
            <div className="fuel-table-wrap">
              <table className="fuel-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Transactions</th>
                    <th>Total Spend</th>
                    <th>Gallons</th>
                    <th>Avg $/Gal</th>
                    <th>Routes Active</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyStats.map(d => {
                    const dow = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                    return (
                      <tr
                        key={d.date}
                        className="fuel-row-clickable"
                        title="Click to view transactions for this day"
                        onClick={() => { setFilterDate(d.date); setFilterRoute('all'); setActiveTab('transactions'); }}
                      >
                        <td className="fuel-td-mono">{d.date}</td>
                        <td>{dow}</td>
                        <td>{d.count}</td>
                        <td className="fuel-td-amount">{fmt$(d.spend)}</td>
                        <td>{fmtGal(d.gallons)}</td>
                        <td>{fmt$(d.avgPpg)}</td>
                        <td><span className="fuel-routes-list">{d.routeList || '—'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== All Transactions ===== */}
      {activeTab === 'transactions' && (
        <div className="fuel-panel">
          <div className="fuel-tx-filters">
            <div className="fuel-tx-filter">
              <label className="fuel-label">Route</label>
              <select className="fuel-select" value={filterRoute} onChange={e => setFilterRoute(e.target.value)}>
                <option value="all">All Routes</option>
                {allRoutes.map(r => <option key={r} value={r}>{r === 'Unknown' ? 'Unlinked' : `Route ${r}`}</option>)}
              </select>
            </div>
            <div className="fuel-tx-filter">
              <label className="fuel-label">Status</label>
              <select className="fuel-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="posted">Posted</option>
                <option value="pending">Pending</option>
                <option value="declined">Declined</option>
              </select>
            </div>
            {filterDate !== 'all' && (
              <div className="fuel-active-filter-chip">
                <span>{filterDate}</span>
                <button className="fuel-clear-btn" onClick={() => setFilterDate('all')} title="Clear date filter">✕</button>
              </div>
            )}
            <span className="fuel-tx-count">{filteredTx.length} of {transactions.length} transactions</span>
            {(filterRoute !== 'all' || filterDate !== 'all' || filterStatus !== 'all') && (
              <button className="fuel-clear-all-btn" onClick={() => { setFilterRoute('all'); setFilterDate('all'); setFilterStatus('all'); }}>
                Clear filters
              </button>
            )}
          </div>

          {filteredTx.length === 0 ? (
            <div className="fuel-empty">
              {transactions.length === 0
                ? 'Fetch data to see transactions.'
                : 'No transactions match current filters.'}
            </div>
          ) : (
            <div className="fuel-table-wrap">
              <table className="fuel-table fuel-table-tx">
                <thead>
                  <tr>
                    <th className="fuel-th-sort" onClick={() => toggleSort('date')}>Date/Time{sortIcon('date')}</th>
                    <th className="fuel-th-sort" onClick={() => toggleSort('route')}>Route{sortIcon('route')}</th>
                    <th>Card</th>
                    <th>Merchant</th>
                    <th>Location</th>
                    <th>Fuel Type</th>
                    <th className="fuel-th-sort" onClick={() => toggleSort('gallons')}>Gallons{sortIcon('gallons')}</th>
                    <th>$/Gal</th>
                    <th className="fuel-th-sort" onClick={() => toggleSort('amount')}>Amount{sortIcon('amount')}</th>
                    <th>Odometer</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map(tx => (
                    <tr key={tx.id} className={tx.declined ? 'fuel-row-declined' : ''}>
                      <td className="fuel-td-mono">{tx.transactedAt ? tx.transactedAt.replace('T', ' ').slice(0, 16) : '—'}</td>
                      <td>
                        {tx.route !== 'Unknown'
                          ? <span className="fuel-route-badge">Rt {tx.route}</span>
                          : <span className="fuel-route-unknown">?</span>}
                      </td>
                      <td className="fuel-td-mono" title={tx.cardId || ''}>
                        {tx.cardName ? tx.cardName.split(' ')[0] : (tx.last4 ? `••••${tx.last4}` : (tx.cardId ? tx.cardId.slice(0, 8) + '…' : '—'))}
                      </td>
                      <td>{tx.merchantName || '—'}</td>
                      <td>{[tx.merchantCity, tx.merchantState].filter(Boolean).join(', ') || '—'}</td>
                      <td>{tx.fuelType || '—'}</td>
                      <td>{tx.totalGallons > 0 ? tx.totalGallons.toFixed(3) : '—'}</td>
                      <td>{tx.pricePerGallon ? fmt$(tx.pricePerGallon) : '—'}</td>
                      <td className={tx.totalAmount > 0 ? 'fuel-td-amount' : ''}>{tx.totalAmount > 0 ? fmt$(tx.totalAmount) : '—'}</td>
                      <td className="fuel-td-mono">{tx.odometerRaw != null ? tx.odometerRaw.toFixed(0) : '—'}</td>
                      <td><span className={`fuel-status fuel-status-${tx.status || 'unknown'}`}>{tx.status || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== Card Management ===== */}
      {activeTab === 'cards' && (
        <div className="fuel-panel">
          <div className="fuel-cards-header">
            <div>
              <h3 className="fuel-cards-title">Card → Route Assignment</h3>
              <p className="fuel-cards-desc">
                Manually link each Motive fuel card to a route. Assignments are saved locally and override API data when computing route stats.
                {Object.keys(cardRouteMap).length > 0 && (
                  <strong> {Object.keys(cardRouteMap).length} assignment(s) currently active.</strong>
                )}
              </p>
            </div>
            <button className="fuel-fetch-btn" onClick={fetchCards} disabled={cardsLoading}>
              {cardsLoading ? 'Loading…' : 'Fetch Cards from API'}
            </button>
          </div>

          {cardsError && <div className="fuel-error">⚠ {cardsError}</div>}

          {/* Active assignments summary */}
          {Object.keys(cardRouteMap).length > 0 && (
            <div className="fuel-assignments-summary">
              <div className="fuel-assignments-title">Active Assignments</div>
              <div className="fuel-assignments-list">
                {Object.entries(cardRouteMap).map(([cid, rn]) => {
                  const card = cards.find(c => c.cardId === cid);
                  const displayName = card ? (card.entityName || `••••${card.last4 || '????'}`) : cid.slice(0, 10) + '…';
                  return (
                    <div key={cid} className="fuel-assignment-chip">
                      <span className="fuel-assignment-name">{displayName}</span>
                      <span className="fuel-assignment-arrow">→</span>
                      <span className="fuel-route-badge">Rt {rn}</span>
                      <button className="fuel-clear-btn" onClick={() => setCardRoute(cid, '')} title="Remove assignment">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cards table */}
          {cards.length === 0 && !cardsLoading && (
            <div className="fuel-empty">
              Click "Fetch Cards from API" to load your Motive fuel cards and assign them to routes.
            </div>
          )}

          {cards.length > 0 && (
            <div className="fuel-table-wrap">
              <table className="fuel-table fuel-table-cards">
                <thead>
                  <tr>
                    <th>Card ID</th>
                    <th>Last 4</th>
                    <th>Status</th>
                    <th>API Assignment</th>
                    <th>Type</th>
                    <th>Route Override</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(card => {
                    const assigned = cardRouteMap[card.cardId] || '';
                    return (
                      <tr key={card.cardId} className={assigned ? 'fuel-row-assigned' : ''}>
                        <td className="fuel-td-mono fuel-td-sm" title={card.cardId}>{card.cardId.slice(0, 12)}…</td>
                        <td className="fuel-td-mono">••••{card.last4 || '????'}</td>
                        <td>
                          <span className={`fuel-card-status fuel-card-status-${card.status || 'unknown'}`}>
                            {card.status || '—'}
                          </span>
                        </td>
                        <td>{card.entityName || '—'}</td>
                        <td>
                          <span className={`fuel-entity-badge fuel-entity-${card.entityType || 'none'}`}>
                            {card.entityType || '—'}
                          </span>
                        </td>
                        <td>
                          <div className="fuel-card-assign-row">
                            <select
                              className="fuel-select fuel-select-sm"
                              value={assigned}
                              onChange={e => setCardRoute(card.cardId, e.target.value)}
                            >
                              <option value="">— No override —</option>
                              {routeOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            {assigned && (
                              <button className="fuel-clear-btn" onClick={() => setCardRoute(card.cardId, '')} title="Clear">✕</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

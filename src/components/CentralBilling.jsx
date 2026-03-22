import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function CentralBilling() {
  const { state, setCentralBilling } = useApp();
  const { centralBilling, transactions } = state;
  const [routeFilter, setRouteFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Build a set of all DAO transaction IDs for cross-reference
  const txIdSet = useMemo(() => {
    const s = new Set();
    (transactions || []).forEach(t => { if (t.id) s.add(String(t.id).trim()); });
    return s;
  }, [transactions]);

  const invoices = centralBilling?.invoices || [];

  // Unique routes for filter
  const routes = useMemo(() => {
    const r = [...new Set(invoices.map(i => i.route).filter(Boolean))].sort();
    return r;
  }, [invoices]);

  // Filtered invoices
  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (routeFilter !== 'all' && inv.route !== routeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          inv.storeName?.toLowerCase().includes(q) ||
          inv.storeId?.toLowerCase().includes(q) ||
          inv.invoiceNumber?.includes(q) ||
          inv.chain?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, routeFilter, search]);

  // Stats
  const stats = useMemo(() => {
    const matched = filtered.filter(i => txIdSet.has(String(i.invoiceNumber)));
    const total = filtered.reduce((s, i) => s + (i.cbAmount || 0), 0);
    return { count: filtered.length, matched: matched.length, total };
  }, [filtered, txIdSet]);

  // Route summary
  const routeSummary = useMemo(() => {
    const map = {};
    invoices.forEach(inv => {
      const r = inv.route || 'Unknown';
      if (!map[r]) map[r] = { route: r, count: 0, total: 0, matched: 0 };
      map[r].count++;
      map[r].total += inv.cbAmount || 0;
      if (txIdSet.has(String(inv.invoiceNumber))) map[r].matched++;
    });
    return Object.values(map).sort((a, b) => a.route.localeCompare(b.route));
  }, [invoices, txIdSet]);

  if (!centralBilling) {
    return (
      <div className="cb-empty">
        <div className="cb-empty-icon">📋</div>
        <div className="cb-empty-title">No Central Bill Loaded</div>
        <p className="cb-empty-desc">Go to Data Import and click "Import CB PDF" to load a Central Bill Transmit List.</p>
      </div>
    );
  }

  return (
    <div className="cb-page">
      {/* Debug panel when metadata missing */}
      {(!centralBilling.batchNumber || !centralBilling.endDate) && centralBilling._debugLines?.length > 0 && (
        <details className="cb-debug">
          <summary className="cb-debug-summary">Metadata not parsed — click to show raw PDF lines (for debugging)</summary>
          <pre className="cb-debug-pre">{centralBilling._debugLines.map((l, i) => `${i + 1}: ${l}`).join('\n')}</pre>
        </details>
      )}

      {/* Header */}
      <div className="cb-header">
        <div className="cb-header-left">
          <h2 className="cb-title">Central Billing</h2>
          <div className="cb-meta">
            {centralBilling.transmitFile && <span>File: <strong>{centralBilling.transmitFile}</strong></span>}
            {centralBilling.batchNumber && <span>Batch: <strong>{centralBilling.batchNumber}</strong></span>}
            {centralBilling.endDate && <span>End Date: <strong>{centralBilling.endDate}</strong></span>}
            {centralBilling.runDate && <span>Run Date: <strong>{centralBilling.runDate}</strong></span>}
            {centralBilling.batchTotal != null && (
              <span>Total: <strong>${centralBilling.batchTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setCentralBilling(null)}>Clear</button>
      </div>

      {/* Route Summary Cards */}
      <div className="cb-route-cards">
        {routeSummary.map(r => (
          <div
            key={r.route}
            className={`cb-route-card${routeFilter === r.route ? ' active' : ''}`}
            onClick={() => setRouteFilter(f => f === r.route ? 'all' : r.route)}
          >
            <div className="cb-route-card-route">Rt {r.route}</div>
            <div className="cb-route-card-total">${Math.abs(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div className="cb-route-card-sub">{r.count} invoices · {r.matched} matched</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="cb-filters">
        <input
          className="cb-search"
          placeholder="Search store, invoice, chain…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="cb-select" value={routeFilter} onChange={e => setRouteFilter(e.target.value)}>
          <option value="all">All Routes</option>
          {routes.map(r => <option key={r} value={r}>Route {r}</option>)}
        </select>
        <span className="cb-count">{stats.count} invoices · {stats.matched} matched · ${Math.abs(stats.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
      </div>

      {/* Invoice Table */}
      <div className="cb-table-wrap">
        <table className="cb-table">
          <thead>
            <tr>
              <th>Route</th>
              <th>Store ID</th>
              <th>Store Name</th>
              <th>Invoice #</th>
              <th>Date</th>
              <th>CB Amount</th>
              <th>DAO Match</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv, idx) => {
              const matched = txIdSet.has(String(inv.invoiceNumber));
              return (
                <tr key={idx} className={matched ? 'cb-row-matched' : 'cb-row-unmatched'}>
                  <td>{inv.route}</td>
                  <td className="cb-cell-mono">{inv.storeId}</td>
                  <td>{inv.storeName}{inv.chain ? <span className="cb-chain"> ({inv.chain})</span> : null}</td>
                  <td className="cb-cell-mono">{inv.invoiceNumber}</td>
                  <td>{inv.date}</td>
                  <td className="cb-cell-amount">${Math.abs(inv.cbAmount || 0).toFixed(2)}</td>
                  <td>
                    {matched
                      ? <span className="cb-badge cb-badge-matched">Matched</span>
                      : <span className="cb-badge cb-badge-none">No Record</span>
                    }
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="cb-no-results">No invoices found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

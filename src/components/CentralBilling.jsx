import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function CentralBilling() {
  const { state } = useApp();
  const { centralBilling, transactions } = state;
  const [routeFilter, setRouteFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);

  const batches = centralBilling?.batches || [];
  const invoices = centralBilling?.invoices || [];

  // Default to latest batch; 'all' only when explicitly chosen
  const latestBatchKey = batches.length > 0 ? String(batches[batches.length - 1].batchNumber ?? `import-${batches.length - 1}`) : 'all';
  const [batchFilter, setBatchFilter] = useState(latestBatchKey);

  // Build a set of all DAO transaction IDs for cross-reference
  const txIdSet = useMemo(() => {
    const s = new Set();
    (transactions || []).forEach(t => { if (t.id) s.add(String(t.id).trim()); });
    return s;
  }, [transactions]);

  // All unmatched invoices (for right panel — ignores current filters)
  const unpaidInvoices = useMemo(() => {
    return invoices.filter(i => !txIdSet.has(String(i.invoiceNumber)));
  }, [invoices, txIdSet]);

  const unpaidByRoute = useMemo(() => {
    const map = {};
    unpaidInvoices.forEach(inv => {
      const r = inv.route || 'Unknown';
      if (!map[r]) map[r] = { route: r, invoices: [], total: 0 };
      map[r].invoices.push(inv);
      map[r].total += Math.abs(inv.cbAmount || 0);
    });
    return Object.values(map).sort((a, b) => a.route.localeCompare(b.route));
  }, [unpaidInvoices]);

  const unpaidTotal = useMemo(() =>
    unpaidInvoices.reduce((s, i) => s + Math.abs(i.cbAmount || 0), 0),
    [unpaidInvoices]
  );

  // Unique routes
  const routes = useMemo(() => {
    return [...new Set(invoices.map(i => i.route).filter(Boolean))].sort();
  }, [invoices]);

  // Map import-N keys back to the batch's importedAt for null-batchNumber filtering
  const batchKeyToImportedAt = useMemo(() => {
    const m = {};
    batches.forEach((b, i) => { m[String(b.batchNumber ?? `import-${i}`)] = b.importedAt; });
    return m;
  }, [batches]);

  // Filtered invoices (main table)
  const filtered = useMemo(() => {
    return invoices.filter(inv => {
      if (batchFilter !== 'all') {
        if (batchFilter.startsWith('import-')) {
          // null batchNumber batches — match by importedAt
          if (inv.importedAt !== batchKeyToImportedAt[batchFilter]) return false;
        } else {
          if (String(inv.batchNumber) !== batchFilter) return false;
        }
      }
      if (routeFilter !== 'all' && inv.route !== routeFilter) return false;
      if (showUnmatchedOnly && txIdSet.has(String(inv.invoiceNumber))) return false;
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
  }, [invoices, routeFilter, batchFilter, search, showUnmatchedOnly, txIdSet]);

  // Stats
  const stats = useMemo(() => {
    const matched = filtered.filter(i => txIdSet.has(String(i.invoiceNumber)));
    const total = filtered.reduce((s, i) => s + (i.cbAmount || 0), 0);
    return { count: filtered.length, matched: matched.length, unmatched: filtered.length - matched.length, total };
  }, [filtered, txIdSet]);

  // Route summary cards (all invoices, not filtered)
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

  if (!invoices.length) {
    return (
      <div className="cb-empty">
        <div className="cb-empty-icon">📋</div>
        <div className="cb-empty-title">No Central Bill Data</div>
        <p className="cb-empty-desc">Go to Data Import and click "Import CB PDF" to load a Central Bill Transmit List. Each import merges into history — old invoices are never deleted.</p>
      </div>
    );
  }

  return (
    <div className="cb-page">
      <div className="cb-layout">
        {/* ── Left: main content ── */}
        <div className="cb-main">
          {/* Batch history bar */}
          {batches.length > 0 && (
            <div className="cb-batch-bar">
              <span className="cb-batch-label">Batches:</span>
              {batches.map((b, i) => (
                <button
                  key={i}
                  className={`cb-batch-chip${batchFilter === String(b.batchNumber) ? ' active' : ''}${b.batchTotal != null && b.invoiceTotal != null && Math.abs(b.batchTotal - b.invoiceTotal) >= 0.05 ? ' warn' : ''}`}
                  onClick={() => setBatchFilter(String(b.batchNumber ?? `import-${i}`))}
                  title={[
                    `End Date: ${b.endDate || '?'}`,
                    `${b.invoiceCount} invoices (${b.newCount ?? b.invoiceCount} new)`,
                    `Imported: ${b.importedAt ? new Date(b.importedAt).toLocaleDateString() : '?'}`,
                    b.batchTotal != null && b.invoiceTotal != null
                      ? Math.abs(b.batchTotal - b.invoiceTotal) < 0.05
                        ? `✓ Totals match: $${b.batchTotal.toFixed(2)}`
                        : `⚠ PDF total $${b.batchTotal.toFixed(2)} vs parsed $${b.invoiceTotal.toFixed(2)} — diff $${Math.abs(b.batchTotal - b.invoiceTotal).toFixed(2)}`
                      : null,
                  ].filter(Boolean).join('\n')}
                >
                  {b.batchNumber ? `Batch ${b.batchNumber}` : `Import ${i + 1}${b.importedAt ? ' · ' + new Date(b.importedAt).toLocaleDateString() : ''}`}
                  {b.batchNumber && b.endDate ? <span className="cb-batch-chip-date"> · {b.endDate}</span> : null}
                  {b.batchTotal != null && b.invoiceTotal != null && Math.abs(b.batchTotal - b.invoiceTotal) >= 0.05 && (
                    <span className="cb-batch-chip-warn"> ⚠</span>
                  )}
                </button>
              ))}
              {batchFilter !== 'all' && (
                <button className="cb-batch-chip-clear" onClick={() => setBatchFilter('all')}>Show All</button>
              )}
            </div>
          )}

          {/* Header */}
          <div className="cb-header">
            <div className="cb-header-left">
              <h2 className="cb-title">Central Billing</h2>
              <div className="cb-meta">
                <span>{invoices.length} total invoices across {batches.length} batch{batches.length !== 1 ? 'es' : ''}</span>
                <span className="cb-meta-unmatched">{unpaidInvoices.length} unpaid</span>
              </div>
            </div>
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
                <div className="cb-route-card-sub">{r.matched} matched · <span style={{ color: '#dc2626' }}>{r.count - r.matched} unpaid</span></div>
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
            <label className="cb-toggle">
              <input type="checkbox" checked={showUnmatchedOnly} onChange={e => setShowUnmatchedOnly(e.target.checked)} />
              Unpaid only
            </label>
            <span className="cb-count">{stats.count} shown · {stats.matched} matched · {stats.unmatched} unpaid</span>
          </div>

          {/* Invoice Table */}
          <div className="cb-table-wrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Route</th>
                  <th>Store ID</th>
                  <th>Store Name</th>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>CB Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, idx) => {
                  const matched = txIdSet.has(String(inv.invoiceNumber));
                  return (
                    <tr key={idx} className={matched ? 'cb-row-matched' : 'cb-row-unmatched'}>
                      <td className="cb-cell-batch">{inv.batchNumber || '—'}</td>
                      <td>{inv.route}</td>
                      <td className="cb-cell-mono">{inv.storeId}</td>
                      <td>{inv.storeName}{inv.chain ? <span className="cb-chain"> ({inv.chain})</span> : null}</td>
                      <td className="cb-cell-mono">{inv.invoiceNumber}</td>
                      <td>{inv.date}</td>
                      <td className="cb-cell-amount">${Math.abs(inv.cbAmount || 0).toFixed(2)}</td>
                      <td>
                        {matched
                          ? <span className="cb-badge cb-badge-matched">Paid</span>
                          : <span className="cb-badge cb-badge-none">Unpaid</span>
                        }
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="cb-no-results">No invoices found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Right: unpaid invoices panel ── */}
        <div className="cb-unpaid-panel">
          <div className="cb-unpaid-header">
            <div className="cb-unpaid-title">Unpaid Invoices</div>
            <div className="cb-unpaid-total">${unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div className="cb-unpaid-count">{unpaidInvoices.length} invoices outstanding</div>
          </div>
          <div className="cb-unpaid-list">
            {unpaidByRoute.map(group => (
              <div key={group.route} className="cb-unpaid-group">
                <div className="cb-unpaid-group-header">
                  <span>Route {group.route}</span>
                  <span className="cb-unpaid-group-total">${group.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                {group.invoices.map((inv, i) => (
                  <div key={i} className="cb-unpaid-row">
                    <div className="cb-unpaid-store">{inv.storeName || inv.storeId}</div>
                    <div className="cb-unpaid-meta">
                      <span className="cb-unpaid-inv">#{inv.invoiceNumber}</span>
                      <span className="cb-unpaid-date">{inv.date}</span>
                      <span className="cb-unpaid-amt">${Math.abs(inv.cbAmount || 0).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {unpaidInvoices.length === 0 && (
              <div className="cb-unpaid-empty">All invoices matched!</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

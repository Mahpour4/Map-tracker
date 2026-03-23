import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function CentralBilling() {
  const { state } = useApp();
  const { centralBilling, transactions, cbInquiry } = state;
  const [activeView, setActiveView] = useState('invoices'); // 'invoices' | 'aging'
  const [routeFilter, setRouteFilter] = useState('all');
  const [chainFilter, setChainFilter] = useState('all');
  const [storeFilter, setStoreFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [selectedAgingStore, setSelectedAgingStore] = useState(null); // StoreId string
  const [selectedInvoice, setSelectedInvoice] = useState(null); // invoiceNumber string
  const [agingSearch, setAgingSearch] = useState('');
  const [agingSort, setAgingSort] = useState({ col: 'StoreId', dir: 'asc' });

  const batches = centralBilling?.batches || [];
  const invoices = centralBilling?.invoices || [];

  // Default to latest batch; 'all' only when explicitly chosen
  const latestBatchKey = batches.length > 0 ? String(batches[batches.length - 1].batchNumber ?? `import-${batches.length - 1}`) : 'all';
  const [batchFilter, setBatchFilter] = useState(latestBatchKey);

  // Build a set + map of all DAO transaction IDs for cross-reference
  const { txIdSet, txMap } = useMemo(() => {
    const s = new Set();
    const m = {};
    (transactions || []).forEach(t => {
      if (t.id) {
        const key = String(t.id).trim();
        s.add(key);
        if (!m[key]) m[key] = t; // keep first match
      }
    });
    return { txIdSet: s, txMap: m };
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

  // Unique routes, chains, stores
  const routes = useMemo(() => [...new Set(invoices.map(i => i.route).filter(Boolean))].sort(), [invoices]);
  const chains = useMemo(() => [...new Set(invoices.map(i => i.chain).filter(Boolean))].sort(), [invoices]);
  const stores = useMemo(() => {
    const seen = new Set();
    return invoices
      .filter(i => i.storeName && (chainFilter === 'all' || i.chain === chainFilter))
      .map(i => ({ id: i.storeId, name: i.storeName }))
      .filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices, chainFilter]);

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
      if (chainFilter !== 'all' && inv.chain !== chainFilter) return false;
      if (storeFilter !== 'all' && inv.storeId !== storeFilter) return false;
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
  }, [invoices, routeFilter, chainFilter, storeFilter, batchFilter, search, showUnmatchedOnly, txIdSet]);

  // Stats — computed across ALL batches (batch filter only affects the table below)
  const statsBase = useMemo(() => invoices.filter(inv => {
    if (routeFilter !== 'all' && inv.route !== routeFilter) return false;
    if (chainFilter !== 'all' && inv.chain !== chainFilter) return false;
    if (storeFilter !== 'all' && inv.storeId !== storeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (inv.storeName?.toLowerCase().includes(q) || inv.storeId?.toLowerCase().includes(q) || inv.invoiceNumber?.includes(q) || inv.chain?.toLowerCase().includes(q));
    }
    return true;
  }), [invoices, routeFilter, chainFilter, storeFilter, search]);

  const stats = useMemo(() => {
    const matchedInvs = statsBase.filter(i => txIdSet.has(String(i.invoiceNumber)));
    const total = statsBase.reduce((s, i) => s + Math.abs(i.cbAmount || 0), 0);
    const paidTotal = matchedInvs.reduce((s, i) => s + Math.abs(i.cbAmount || 0), 0);
    return { count: statsBase.length, matched: matchedInvs.length, unmatched: statsBase.length - matchedInvs.length, total, paidTotal, unpaidTotal: total - paidTotal };
  }, [statsBase, txIdSet]);

  // Group filtered invoices by chain for the table
  const filteredByChain = useMemo(() => {
    const map = {};
    filtered.forEach(inv => {
      const key = inv.chain || 'Unknown';
      if (!map[key]) map[key] = { chain: key, invoices: [], total: 0, paid: 0 };
      map[key].invoices.push(inv);
      map[key].total += Math.abs(inv.cbAmount || 0);
      if (txIdSet.has(String(inv.invoiceNumber))) map[key].paid += Math.abs(inv.cbAmount || 0);
    });
    Object.values(map).forEach(g => {
      g.invoices.sort((a, b) => (a.storeId || '').localeCompare(b.storeId || '') || (a.date || '').localeCompare(b.date || ''));
    });
    return Object.values(map).sort((a, b) => a.chain.localeCompare(b.chain));
  }, [filtered, txIdSet]);

  // Selected batch object (for debug panel)
  const selectedBatch = useMemo(() =>
    batches.find((b, i) => String(b.batchNumber ?? `import-${i}`) === batchFilter) || null,
    [batches, batchFilter]
  );

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

  // ── AR Aging derived data ──────────────────────────────────────────────
  const AGING_COLS = ['TotalBalance', 'Current', 'Days30', 'Days60', 'Days90', 'Over90Days'];

  const agingByChain = useMemo(() => {
    const stores = cbInquiry?.stores || [];
    const chainMap = {};
    stores.forEach(s => {
      const cid = s.ChainId || 'Unknown';
      if (!chainMap[cid]) {
        const name = (s.StoreName || '').replace(/\s*\d+$/, '').trim() || cid;
        chainMap[cid] = { ChainId: cid, ChainName: name, stores: [], totals: {} };
        AGING_COLS.forEach(c => { chainMap[cid].totals[c] = 0; });
      }
      chainMap[cid].stores.push(s);
      AGING_COLS.forEach(c => { chainMap[cid].totals[c] += parseFloat(s[c]) || 0; });
    });
    // stores are sorted at render time based on agingSort
    return Object.values(chainMap).sort((a, b) => a.ChainId.localeCompare(b.ChainId));
  }, [cbInquiry]);

  const agingGrandTotals = useMemo(() => {
    const result = {};
    AGING_COLS.forEach(c => { result[c] = agingByChain.reduce((s, ch) => s + ch.totals[c], 0); });
    return result;
  }, [agingByChain]);

  // Map storeId → invoices from CB PDF data (exact match, case-insensitive)
  const storeInvoiceMap = useMemo(() => {
    const map = {};
    invoices.forEach(inv => {
      const key = (inv.storeId || '').toUpperCase();
      if (!map[key]) map[key] = [];
      map[key].push(inv);
    });
    return map;
  }, [invoices]);

  const fmt = (v) => (parseFloat(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!invoices.length && !cbInquiry) {
    return (
      <div className="cb-empty">
        <div className="cb-empty-icon">📋</div>
        <div className="cb-empty-title">No Central Bill Data</div>
        <p className="cb-empty-desc">Go to Data Import and click "Import CB PDF" to load a Central Bill Transmit List, or "Import CB Inquiry JSON" to load AR aging data.</p>
      </div>
    );
  }

  if (activeView === 'aging') {
    return (
      <div className="cb-page">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '2px solid #e2e8f0', paddingBottom: 8 }}>
          <button className={`btn ${activeView === 'invoices' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('invoices')}>Invoices</button>
          <button className={`btn ${activeView === 'aging' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('aging')}>AR Aging</button>
        </div>
        {!cbInquiry ? (
          <div className="cb-empty"><div className="cb-empty-title">No AR Aging Data</div><p className="cb-empty-desc">Go to Data Import → Import CB Inquiry JSON.</p></div>
        ) : (
          <div>
            {/* Summary bar */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Updated: {new Date(cbInquiry.importedAt).toLocaleString()}</span>
              <span style={{ fontSize: 13, color: '#374151' }}>{agingByChain.reduce((s, c) => s + c.stores.length, 0)} stores · {agingByChain.length} chain{agingByChain.length !== 1 ? 's' : ''}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Total Owed: <span style={{ color: '#1e40af' }}>${fmt(agingGrandTotals.TotalBalance)}</span></span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Over 90 Days: <span style={{ color: '#dc2626' }}>${fmt(agingGrandTotals.Over90Days)}</span></span>
            </div>

            {/* Chain search */}
            <div style={{ marginBottom: 16 }}>
              <input
                className="cb-search"
                placeholder="Filter chains A–Z…"
                value={agingSearch}
                onChange={e => setAgingSearch(e.target.value)}
                style={{ width: 260 }}
              />
              {agingSearch && (
                <button onClick={() => setAgingSearch('')} style={{ marginLeft: 8, fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Clear</button>
              )}
            </div>

            {/* Per-chain tables */}
            {agingByChain
              .filter(chain => !agingSearch || chain.ChainName.toLowerCase().includes(agingSearch.toLowerCase()) || chain.ChainId.toLowerCase().includes(agingSearch.toLowerCase()))
              .map(chain => (
              <div key={chain.ChainId} style={{ marginBottom: 28 }}>
                {/* Chain header */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, padding: '6px 0', borderBottom: '2px solid #2563eb' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1e40af' }}>{chain.ChainName}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Chain {chain.ChainId} · {chain.stores.length} stores</span>
                  <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 'auto' }}>Total: ${fmt(chain.totals.TotalBalance)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>Over 90: ${fmt(chain.totals.Over90Days)}</span>
                </div>

                {/* Store rows */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                        {[['StoreId','Store #',false],['StoreName','Store Name',false],['TotalBalance','Total',true],['Current','Current',true],['Days30','30 Days',true],['Days60','60 Days',true],['Days90','90 Days',true],['Over90Days','Over 90',true]].map(([col, label, isNum]) => {
                          const active = agingSort.col === col;
                          return (
                            <th
                              key={col}
                              onClick={() => setAgingSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
                              style={{ padding: '6px 10px', textAlign: isNum ? 'right' : 'left', fontWeight: 600, color: col === 'Over90Days' ? '#dc2626' : active ? '#2563eb' : '#374151', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                            >
                              {label} {active ? (agingSort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                          );
                        })}
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>CB Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...chain.stores].sort((a, b) => {
                        const col = agingSort.col;
                        const dir = agingSort.dir === 'asc' ? 1 : -1;
                        const av = AGING_COLS.includes(col) ? (parseFloat(a[col]) || 0) : (a[col] || '');
                        const bv = AGING_COLS.includes(col) ? (parseFloat(b[col]) || 0) : (b[col] || '');
                        return typeof av === 'number' ? (av - bv) * dir : av.localeCompare(bv) * dir;
                      }).map((row, i) => {
                        const storeKey = (row.StoreId || '').toUpperCase();
                        const storeInvs = storeInvoiceMap[storeKey] || [];
                        const cbPaid = storeInvs.filter(i => txIdSet.has(String(i.invoiceNumber))).reduce((s, i) => s + Math.abs(i.cbAmount || 0), 0);
                        const cbUnpaid = storeInvs.filter(i => !txIdSet.has(String(i.invoiceNumber))).reduce((s, i) => s + Math.abs(i.cbAmount || 0), 0);
                        const isOpen = selectedAgingStore === row.StoreId;
                        return (
                          <>
                            <tr
                              key={row.StoreId}
                              onClick={() => setSelectedAgingStore(isOpen ? null : row.StoreId)}
                              style={{ borderBottom: isOpen ? 'none' : '1px solid #f1f5f9', background: isOpen ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#f8fafc', cursor: 'pointer' }}
                            >
                              <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#374151' }}>
                                <span style={{ marginRight: 6, fontSize: 11, color: '#94a3b8' }}>{isOpen ? '▼' : '▶'}</span>
                                {row.StoreId}
                                {storeInvs.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 5px' }}>{storeInvs.length}</span>}
                              </td>
                              <td style={{ padding: '6px 10px', color: '#374151' }}>{row.StoreName}</td>
                              {['TotalBalance','Current','Days30','Days60','Days90','Over90Days'].map(col => (
                                <td key={col} style={{ padding: '6px 10px', textAlign: 'right', color: col === 'Over90Days' && parseFloat(row[col]) > 0 ? '#dc2626' : '#374151', fontWeight: col === 'Over90Days' ? 600 : 400 }}>
                                  ${fmt(row[col])}
                                </td>
                              ))}
                              <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {storeInvs.length === 0 ? (
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                                ) : (
                                  <span style={{ fontSize: 12 }}>
                                    <span style={{ color: '#166534' }}>✓ ${fmt(cbPaid)}</span>
                                    {cbUnpaid > 0 && <span style={{ color: '#dc2626', marginLeft: 6 }}>✗ ${fmt(cbUnpaid)}</span>}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr key={row.StoreId + '-detail'}>
                                <td colSpan={9} style={{ padding: '0 0 12px 32px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                                  {storeInvs.length === 0 ? (
                                    <div style={{ padding: '8px 0', fontSize: 13, color: '#64748b' }}>No CB PDF invoices found for {row.StoreId}</div>
                                  ) : (
                                    <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', maxWidth: 700 }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid #bfdbfe' }}>
                                          <th style={{ padding: '4px 10px', textAlign: 'left', color: '#1e40af', fontWeight: 600 }}>Batch</th>
                                          <th style={{ padding: '4px 10px', textAlign: 'left', color: '#1e40af', fontWeight: 600 }}>Invoice #</th>
                                          <th style={{ padding: '4px 10px', textAlign: 'left', color: '#1e40af', fontWeight: 600 }}>Date</th>
                                          <th style={{ padding: '4px 10px', textAlign: 'right', color: '#1e40af', fontWeight: 600 }}>Amount</th>
                                          <th style={{ padding: '4px 10px', textAlign: 'left', color: '#1e40af', fontWeight: 600 }}>Status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {storeInvs.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((inv, j) => {
                                          const matched = txIdSet.has(String(inv.invoiceNumber));
                                          return (
                                            <tr key={j} style={{ borderBottom: '1px solid #dbeafe' }}>
                                              <td style={{ padding: '4px 10px', color: '#475569' }}>{inv.batchNumber || '—'}</td>
                                              <td style={{ padding: '4px 10px', fontFamily: 'monospace', color: '#374151' }}>{inv.invoiceNumber}</td>
                                              <td style={{ padding: '4px 10px', color: '#475569' }}>{inv.date}</td>
                                              <td style={{ padding: '4px 10px', textAlign: 'right', color: '#374151' }}>${Math.abs(inv.cbAmount || 0).toFixed(2)}</td>
                                              <td style={{ padding: '4px 10px' }}>
                                                {matched
                                                  ? <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '1px 6px' }}>Paid</span>
                                                  : <span style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', borderRadius: 4, padding: '1px 6px' }}>Unpaid</span>
                                                }
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                      {/* Chain subtotal */}
                      <tr style={{ borderTop: '1px solid #cbd5e1', fontWeight: 700, background: '#eff6ff' }}>
                        <td colSpan={2} style={{ padding: '6px 10px', color: '#1e40af' }}>{chain.ChainName} Subtotal</td>
                        {AGING_COLS.map(col => (
                          <td key={col} style={{ padding: '6px 10px', textAlign: 'right', color: col === 'Over90Days' ? '#dc2626' : '#1e40af' }}>${fmt(chain.totals[col])}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Grand total */}
            <div style={{ borderTop: '3px solid #1e293b', paddingTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Grand Total</span>
              {AGING_COLS.map(col => (
                <span key={col} style={{ fontSize: 13, color: col === 'Over90Days' ? '#dc2626' : '#1e293b', fontWeight: col === 'Over90Days' ? 700 : 400 }}>
                  {col === 'TotalBalance' ? 'Total' : col === 'Over90Days' ? 'Over 90' : col.replace('Days', ' Days')}: ${fmt(agingGrandTotals[col])}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cb-page">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: '2px solid #e2e8f0', paddingBottom: 8 }}>
        <button className={`btn ${activeView === 'invoices' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('invoices')}>Invoices</button>
        <button className={`btn ${activeView === 'aging' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('aging')}>AR Aging{cbInquiry ? ` (${cbInquiry.stores?.length ?? 0})` : ''}</button>
      </div>
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
                  className={`cb-batch-chip${batchFilter === String(b.batchNumber ?? `import-${i}`) ? ' active' : ''}${b.batchTotal != null && b.invoiceTotal != null && Math.abs(b.batchTotal - b.invoiceTotal) >= 0.05 ? ' warn' : ''}`}
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

          {/* Debug panel for selected batch */}
          {selectedBatch && selectedBatch._debugLines?.length > 0 && (
            <details className="cb-debug">
              <summary className="cb-debug-summary">
                Raw PDF lines for this import ({selectedBatch._debugLines.length} lines captured)
                {(!selectedBatch.batchNumber || !selectedBatch.endDate) && ' — metadata not fully parsed'}
              </summary>
              <div className="cb-debug-meta">
                <span>Batch #: <strong>{selectedBatch.batchNumber ?? 'not found'}</strong></span>
                <span>End Date: <strong>{selectedBatch.endDate ?? 'not found'}</strong></span>
                <span>Transmit File: <strong>{selectedBatch.transmitFile ?? 'not found'}</strong></span>
                <span>PDF Total: <strong>{selectedBatch.batchTotal != null ? `$${selectedBatch.batchTotal.toFixed(2)}` : 'not found'}</strong></span>
                <span>Parsed Total: <strong>{selectedBatch.invoiceTotal != null ? `$${selectedBatch.invoiceTotal.toFixed(2)}` : '—'}</strong></span>
                <span>Invoices parsed: <strong>{selectedBatch.invoiceCount}</strong></span>
              </div>
              <pre className="cb-debug-pre">{selectedBatch._debugLines.map((l, i) => `${i + 1}: ${l}`).join('\n')}</pre>
            </details>
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
          {/* Totals bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160, padding: '10px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>TOTAL INVOICED</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>${stats.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{stats.count} invoice{stats.count !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ flex: 1, minWidth: 160, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#166534', marginBottom: 2 }}>TOTAL PAID</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#166534' }}>${stats.paidTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 11, color: '#166534' }}>{stats.matched} matched</div>
            </div>
            <div style={{ flex: 1, minWidth: 160, padding: '10px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 2 }}>TOTAL UNPAID</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>${stats.unpaidTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 11, color: '#991b1b' }}>{stats.unmatched} unmatched</div>
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
            {chains.length > 0 && (
              <select className="cb-select" value={chainFilter} onChange={e => { setChainFilter(e.target.value); setStoreFilter('all'); }}>
                <option value="all">All Chains</option>
                {chains.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select className="cb-select" value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
              <option value="all">All Stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="cb-toggle">
              <input type="checkbox" checked={showUnmatchedOnly} onChange={e => setShowUnmatchedOnly(e.target.checked)} />
              Unpaid only
            </label>
            {showUnmatchedOnly && stats.unmatched > 0 && (
              <span className="cb-unpaid-total-badge">
                Total unpaid: <strong>${Math.abs(stats.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
              </span>
            )}
            <span className="cb-count">{stats.count} shown · {stats.matched} matched · {stats.unmatched} unpaid</span>
          </div>

          {/* Invoice Table — grouped by chain */}
          <div className="cb-table-wrap">
            {filtered.length === 0 && (
              <div className="cb-no-results">No invoices found</div>
            )}
            {filteredByChain.map(group => (
              <div key={group.chain} style={{ marginBottom: 24 }}>
                {/* Chain header */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '6px 0', borderBottom: '2px solid #2563eb', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1e40af' }}>{group.chain}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{group.invoices.length} invoice{group.invoices.length !== 1 ? 's' : ''}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: '#166534' }}>Paid: ${group.paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>Unpaid: ${(group.total - group.paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  <span style={{ fontSize: 13, color: '#374151' }}>Total: ${group.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <table className="cb-table">
                  <thead>
                    <tr>
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
                    {group.invoices.map((inv, idx) => {
                      const matched = txIdSet.has(String(inv.invoiceNumber));
                      const tx = matched ? txMap[String(inv.invoiceNumber)] : null;
                      const isOpen = selectedInvoice === inv.invoiceNumber;
                      return (
                        <>
                          <tr
                            key={idx}
                            className={matched ? 'cb-row-matched' : 'cb-row-unmatched'}
                            style={{ cursor: 'pointer' }}
                            onClick={() => setSelectedInvoice(isOpen ? null : inv.invoiceNumber)}
                          >
                            <td>{inv.route}</td>
                            <td className="cb-cell-mono">{inv.storeId}</td>
                            <td><span style={{ marginRight: 6, fontSize: 11, color: '#94a3b8' }}>{isOpen ? '▼' : '▶'}</span>{inv.storeName}</td>
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
                          {isOpen && (
                            <tr key={idx + '-detail'}>
                              <td colSpan={7} style={{ padding: '8px 16px 12px 32px', background: matched ? '#f0fdf4' : '#fef2f2', borderBottom: '1px solid #e2e8f0' }}>
                                {matched && tx ? (
                                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                                    <div><span style={{ color: '#64748b' }}>Matched to DAO tx</span></div>
                                    <div><span style={{ color: '#64748b' }}>Route: </span><strong>{tx.route}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Customer: </span><strong>{tx.custName}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Doc Type: </span><strong>{tx.docType}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Invoice Type: </span><strong>{tx.invoiceType || '—'}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Doc Date: </span><strong>{tx.docDate}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>Settlement: </span><strong>{tx.settlementDate || '—'}</strong></div>
                                    <div><span style={{ color: '#64748b' }}>DAO Amount: </span><strong>${Math.abs(tx.amount || 0).toFixed(2)}</strong></div>
                                    {tx.dsd && <div><span style={{ color: '#64748b' }}>DSD: </span><strong>{tx.dsd}</strong></div>}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 13, color: '#991b1b' }}>
                                    No matching DAO transaction found for invoice #{inv.invoiceNumber}.
                                    Import more DAO history to reconcile this invoice.
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
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

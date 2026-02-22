import { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { parseTransactions, analyzeByRoute, analyzeByDay, analyzeByStore } from '../services/daoTransactionParser';

export default function Transactions() {
  const { state, setTransactions } = useApp();
  const transactions = state.transactions || [];
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [expandedRoute, setExpandedRoute] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const parsed = useMemo(() => parseTransactions(transactions), [transactions]);
  const routeAnalysis = useMemo(() => analyzeByRoute(parsed), [parsed]);

  const totalStats = useMemo(() => {
    if (routeAnalysis.length === 0) return null;
    const loadTotal = routeAnalysis.reduce((s, r) => s + r.loadTotal, 0);
    const grossSales = routeAnalysis.reduce((s, r) => s + r.grossSales, 0);
    const credits = routeAnalysis.reduce((s, r) => s + r.credits, 0);
    const netSales = grossSales + credits;
    return {
      routes: routeAnalysis.length,
      loadTotal,
      grossSales,
      credits,
      netSales,
      sellThrough: loadTotal > 0 ? (netSales / loadTotal) * 100 : 0,
      totalTx: parsed.length,
    };
  }, [routeAnalysis, parsed]);

  function processFileData(text) {
    setImporting(true);
    setImportError('');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setImportError('File does not contain valid JSON. Make sure you exported it using the DAO bookmarklet.');
      setImporting(false);
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      setImportError('No transaction data found in the file.');
      setImporting(false);
      return;
    }
    // Merge with existing — dedup by ID, newer overwrites older
    const newIds = new Set(data.map(d => d.id).filter(Boolean));
    const kept = transactions.filter(t => !t.id || !newIds.has(t.id));
    setTransactions([...kept, ...data]);
    setImportError('');
    setImporting(false);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processFileData(reader.result);
    reader.onerror = () => { setImportError('Failed to read file.'); };
    reader.readAsText(file);
    e.target.value = ''; // Reset so same file can be re-imported
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processFileData(reader.result);
    reader.onerror = () => { setImportError('Failed to read file.'); };
    reader.readAsText(file);
  }

  function handleClear() {
    if (confirm('Clear all transaction data?')) {
      setTransactions([]);
      setExpandedRoute(null);
      setExpandedDay(null);
    }
  }

  function fmt(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  function pct(n) {
    return n.toFixed(1) + '%';
  }

  function sellClass(p) {
    if (p >= 80) return 'tx-sell-good';
    if (p >= 50) return 'tx-sell-warn';
    return 'tx-sell-bad';
  }

  const dayAnalysis = useMemo(() => {
    if (!expandedRoute) return [];
    return analyzeByDay(parsed, expandedRoute);
  }, [parsed, expandedRoute]);

  const storeAnalysis = useMemo(() => {
    if (!expandedRoute || !expandedDay) return [];
    return analyzeByStore(parsed, expandedRoute, expandedDay);
  }, [parsed, expandedRoute, expandedDay]);

  // Bookmarklet URL
  const bookmarkletCode = `javascript:void(fetch('${window.location.origin}/dao-bookmarklet.js').then(r=>r.text()).then(t=>eval(t)))`;

  return (
    <div className="tx-container">
      <div className="tx-header">
        <h2 title="Weekly transaction data imported from the DAO Dashboard — shows route sales performance, sell-through rates, and DSD compliance">Transactions</h2>
        <div className="tx-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.json"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button className="tx-btn tx-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importing}
            title="Import a .txt file exported from the DAO Dashboard using the bookmarklet">
            {importing ? 'Importing...' : 'Import File'}
          </button>
          {transactions.length > 0 && (
            <button className="tx-btn tx-btn-secondary" onClick={handleClear}
              title="Remove all imported transaction data">Clear</button>
          )}
          <button className="tx-btn tx-btn-secondary" onClick={() => setShowSetup(s => !s)}
            title="Show instructions for exporting data from the DAO Dashboard">
            {showSetup ? 'Hide Setup' : 'Setup'}
          </button>
        </div>
      </div>

      {importError && <div className="tx-error">{importError}</div>}

      {showSetup && (
        <div className="tx-setup">
          <h3>How to import transactions from DAO Dashboard</h3>
          <ol>
            <li>Go to the <a href="https://dashboard.daogroup.com/Dashboards/DocumentViewer/DocumentViewerForm4.aspx" target="_blank" rel="noopener noreferrer">DAO Document Viewer</a></li>
            <li>Set your date range and filters, then click Search</li>
            <li>Set <strong>Max Rows</strong> to a high number (e.g., 500) so all data loads on one page</li>
            <li>
              Drag this link to your bookmarks bar:{' '}
              <a className="tx-bookmarklet-link" href={bookmarkletCode} onClick={e => e.preventDefault()}>
                DAO Scraper
              </a>
              <br />
              <small>Or paste the script from <code>public/dao-bookmarklet.js</code> into the browser console</small>
            </li>
            <li>Click the bookmarklet — it downloads a <strong>.txt file</strong> with the transaction data</li>
            <li>Come back here, click <strong>"Import File"</strong> and select the downloaded .txt file (or drag it onto the drop zone below)</li>
          </ol>
        </div>
      )}

      {totalStats && (
        <div className="tx-summary-bar" title="Aggregate totals across all routes for the imported date range">
          <div className="tx-stat" title="Number of unique delivery routes with transaction activity">
            <span className="tx-stat-label">Routes</span>
            <span className="tx-stat-value">{totalStats.routes}</span>
          </div>
          <div className="tx-stat" title="Total dollar value loaded onto trucks — this is the inventory sent out for delivery">
            <span className="tx-stat-label">Total Load</span>
            <span className="tx-stat-value">{fmt(totalStats.loadTotal)}</span>
          </div>
          <div className="tx-stat" title="Sum of all positive invoices — total revenue before credits/returns are subtracted">
            <span className="tx-stat-label">Gross Sales</span>
            <span className="tx-stat-value">{fmt(totalStats.grossSales)}</span>
          </div>
          <div className="tx-stat" title="Sum of all negative invoices — returns, adjustments, and credit memos issued to stores">
            <span className="tx-stat-label">Credits</span>
            <span className="tx-stat-value tx-negative">{fmt(totalStats.credits)}</span>
          </div>
          <div className="tx-stat" title="Gross Sales minus Credits — the actual revenue collected (Gross Sales + Credits since credits are negative)">
            <span className="tx-stat-label">Net Sales</span>
            <span className="tx-stat-value">{fmt(totalStats.netSales)}</span>
          </div>
          <div className="tx-stat" title="Percentage of loaded inventory that was actually sold: (Net Sales / Total Load) x 100. Green = 80%+, Orange = 50-79%, Red = below 50%">
            <span className="tx-stat-label">Sell-Through</span>
            <span className={`tx-stat-value ${sellClass(totalStats.sellThrough)}`}>{pct(totalStats.sellThrough)}</span>
          </div>
          <div className="tx-stat" title="Total number of individual transaction records (invoices, loads, deliveries, settlements, etc.)">
            <span className="tx-stat-label">Transactions</span>
            <span className="tx-stat-value">{totalStats.totalTx}</span>
          </div>
        </div>
      )}

      {routeAnalysis.length === 0 ? (
        <div
          className={`tx-dropzone${dragOver ? ' drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p>Drop a .txt file here or click to import</p>
          <p className="tx-dropzone-hint">Click <strong>"Setup"</strong> above for instructions on exporting from the DAO dashboard</p>
        </div>
      ) : (
        <div className="tx-routes">
          {routeAnalysis.map(r => (
            <div key={r.route} className={`tx-route-card${expandedRoute === r.route ? ' expanded' : ''}`}>
              <div className="tx-route-header" onClick={() => {
                setExpandedRoute(expandedRoute === r.route ? null : r.route);
                setExpandedDay(null);
              }}>
                <div className="tx-route-title">
                  <span className="tx-route-num" title={`Route ${r.route} — click to expand daily breakdown`}>Route {r.route}</span>
                  <span className="tx-route-dates" title="Date range of transactions for this route">{r.dateRange}</span>
                  <span className="tx-route-count" title="Total number of transaction records for this route">{r.transactionCount} txns</span>
                </div>
                <div className="tx-route-metrics">
                  <span className="tx-metric" title="Total dollar value loaded onto the truck for this route — the inventory sent out">
                    <span className="tx-metric-label">Load</span>
                    <span className="tx-metric-value">{fmt(r.loadTotal)}</span>
                  </span>
                  <span className="tx-metric" title="Sum of all positive invoices for this route — total revenue before credits">
                    <span className="tx-metric-label">Sales</span>
                    <span className="tx-metric-value">{fmt(r.grossSales)}</span>
                  </span>
                  <span className="tx-metric" title="Sum of all negative invoices — returns and adjustments for this route">
                    <span className="tx-metric-label">Credits</span>
                    <span className="tx-metric-value tx-negative">{fmt(r.credits)}</span>
                  </span>
                  <span className="tx-metric" title="Gross Sales minus Credits — actual revenue for this route">
                    <span className="tx-metric-label">Net</span>
                    <span className="tx-metric-value">{fmt(r.netSales)}</span>
                  </span>
                  <span className="tx-metric" title={`Sell-through rate: ${pct(r.sellThrough)} of loaded inventory was sold. Green = 80%+, Orange = 50-79%, Red = below 50%`}>
                    <span className="tx-metric-label">Sell-Through</span>
                    <span className={`tx-metric-value ${sellClass(r.sellThrough)}`}>{pct(r.sellThrough)}</span>
                  </span>
                  <span className="tx-metric" title="Number of unique stores/customers invoiced on this route">
                    <span className="tx-metric-label">Stores</span>
                    <span className="tx-metric-value">{r.storeCount}</span>
                  </span>
                  {(r.dsdOk + r.dsdMissing) > 0 && (
                    <span className="tx-metric" title={`DSD (Direct Store Delivery) compliance: ${r.dsdOk} OK, ${r.dsdMissing} Missing. Measures whether the driver properly scanned deliveries at the store`}>
                      <span className="tx-metric-label">DSD</span>
                      <span className={`tx-metric-value ${r.dsdCompliance >= 80 ? 'tx-sell-good' : 'tx-sell-bad'}`}>
                        {pct(r.dsdCompliance)}
                      </span>
                    </span>
                  )}
                </div>
                <span className="tx-expand-icon">{expandedRoute === r.route ? '\u25B2' : '\u25BC'}</span>
              </div>

              {expandedRoute === r.route && (
                <div className="tx-route-body">
                  <table className="tx-day-table">
                    <thead>
                      <tr>
                        <th title="Settlement date — the date the transactions were finalized">Date</th>
                        <th title="Total dollar value loaded onto the truck that day">Load</th>
                        <th title="Sum of positive invoices — revenue before credits">Gross Sales</th>
                        <th title="Sum of negative invoices — returns and adjustments">Credits</th>
                        <th title="Gross Sales minus Credits — actual revenue for the day">Net</th>
                        <th title="Percentage of loaded inventory sold: (Net / Load) x 100">Sell-Through</th>
                        <th title="Number of unique stores/customers invoiced that day">Stores</th>
                        <th title="Total transaction records for that day">Txns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayAnalysis.map(d => (
                        <>
                          <tr key={d.date}
                            className={`tx-day-row${expandedDay === d.date ? ' expanded' : ''}`}
                            onClick={() => setExpandedDay(expandedDay === d.date ? null : d.date)}
                            title="Click to see individual store transactions for this day"
                          >
                            <td>{d.dateFormatted}</td>
                            <td>{fmt(d.loadTotal)}</td>
                            <td>{fmt(d.grossSales)}</td>
                            <td className="tx-negative">{fmt(d.credits)}</td>
                            <td>{fmt(d.netSales)}</td>
                            <td className={sellClass(d.sellThrough)}>{pct(d.sellThrough)}</td>
                            <td>{d.storeCount}</td>
                            <td>{d.transactionCount}</td>
                          </tr>
                          {expandedDay === d.date && (
                            <tr key={d.date + '-detail'} className="tx-store-detail-row">
                              <td colSpan={8}>
                                <table className="tx-store-table">
                                  <thead>
                                    <tr>
                                      <th title="Store or customer name from the DAO system">Customer</th>
                                      <th title="DAO customer number — unique identifier for this store">Cust #</th>
                                      <th title="Transaction type: Invoice (sale/credit), Delivery (proof of delivery), Load (truck loaded), Settle (day closed)">Type</th>
                                      <th title="Dollar amount — positive = sale, negative = credit/return">Amount</th>
                                      <th title="DSD (Direct Store Delivery) scan status: OK = scanned at store, Missing = not scanned, blank = not applicable">DSD</th>
                                      <th title="Time of day the transaction was recorded">Time</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {storeAnalysis.length > 0 ? storeAnalysis.map(s => (
                                      s.transactions.map((tx, i) => (
                                        <tr key={tx.id || i} className={tx.amount < 0 ? 'tx-credit-row' : ''}>
                                          {i === 0 ? (
                                            <td rowSpan={s.transactions.length} className="tx-store-name">{s.custName}</td>
                                          ) : null}
                                          {i === 0 ? (
                                            <td rowSpan={s.transactions.length}>{s.custNum}</td>
                                          ) : null}
                                          <td title={{
                                            'Invoice': 'Invoice — a sale (positive) or credit/return (negative) to the store',
                                            'Delivery': 'Delivery — proof that product was physically delivered to the store',
                                            'Load': 'Load — inventory loaded onto the truck at the warehouse',
                                            'Settle': 'Settle — route settlement, closing out the day',
                                            'Route Order': 'Route Order — order placed for truck loading',
                                            'Truck Inventory': 'Truck Inventory — end-of-day truck inventory count',
                                            'Dex Audit Trail': 'Dex Audit Trail — electronic data exchange audit record',
                                          }[tx.docType] || tx.docType}>{tx.docType}</td>
                                          <td className={tx.amount < 0 ? 'tx-negative' : ''} title={tx.amount < 0 ? 'Credit/return — this amount is subtracted from gross sales' : 'Sale amount invoiced to the store'}>{fmt(tx.amount)}</td>
                                          <td title={tx.dsd === 'OK' ? 'Driver scanned delivery at the store' : tx.dsd === 'Missing' ? 'Driver did NOT scan delivery — DSD compliance issue' : 'DSD scan not applicable for this transaction type'}>{tx.dsd}</td>
                                          <td title="Time the transaction was recorded in the DAO system">{tx.docDate?.time || ''}</td>
                                        </tr>
                                      ))
                                    )) : (
                                      <tr><td colSpan={6} className="tx-empty-cell">No store data for this day</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { PRODUCT_CATALOG, PRODUCT_CATEGORIES } from '../data/productCatalog';
import {
  getGoogleSheetsUrl, setGoogleSheetsUrl, isGoogleSheetsConfigured,
  pushOrderToSheet, getOrderFromSheet, listSheetTabs, buildTabName,
} from '../services/googleSheetsService';

const ROUTE_DRIVERS = {
  '200': 'jose',
  '201': 'Ryan',
  '203': 'Jay',
  '204': 'Cindy',
  '206': 'eastern shore',
  '207': 'Andre',
  '208': 'Draco',
  '209': 'damian',
  '210': 'eastern shore',
  '211': 'Jhonny',
  '214': 'Randy',
};

// Reverse: driver name → first matching route
const DRIVER_ROUTES = {};
Object.entries(ROUTE_DRIVERS).forEach(([route, name]) => {
  if (!DRIVER_ROUTES[name]) DRIVER_ROUTES[name] = route;
});

export default function WarehouseOrders() {
  const { state, addWarehouseOrder, updateWarehouseOrder, deleteWarehouseOrder } = useApp();
  const { warehouseOrders, stores } = state;
  const orders = warehouseOrders?.orders || [];

  const [tab, setTab] = useState('entry'); // entry | queue
  const [selectedRoute, setSelectedRoute] = useState('');
  const [orderDate, setOrderDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [cases, setCases] = useState({}); // { sku: number }
  const [units, setUnits] = useState({}); // { sku: number } - individual units (not full cases)
  const [orderName, setOrderName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceCases, setInvoiceCases] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [loadNumber, setLoadNumber] = useState('');
  const [loadCases, setLoadCases] = useState('');
  const [loadAmount, setLoadAmount] = useState('');
  const [saving, setSaving] = useState(false);

  // Google Sheets sync state
  const [showSettings, setShowSettings] = useState(false);
  const [sheetsUrl, setSheetsUrl] = useState(() => getGoogleSheetsUrl());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // { type: 'success'|'error', text }
  const [sheetTabs, setSheetTabs] = useState([]);
  const [showPullModal, setShowPullModal] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);

  // Get unique routes from stores
  const routes = useMemo(() => {
    const r = [...new Set(stores.map(s => s.routeNumber).filter(Boolean))].sort((a, b) => a - b);
    return r;
  }, [stores]);

  // Find existing order for this route + date
  const existingOrder = useMemo(() => {
    return orders.find(o => o.routeNumber === selectedRoute && o.date === orderDate);
  }, [orders, selectedRoute, orderDate]);

  // Load existing order into cases state when found
  const loadExistingOrder = useCallback((order) => {
    const c = {};
    const u = {};
    (order.items || []).forEach(item => {
      if (item.cases > 0) c[item.sku] = item.cases;
      if (item.orderUnits > 0) u[item.sku] = item.orderUnits;
    });
    setCases(c);
    setUnits(u);
    setOrderName(order.name || '');
    setInvoiceNumber(order.invoiceNumber || '');
    setInvoiceCases(order.invoiceCases || '');
    setInvoiceAmount(order.invoiceAmount || '');
    setLoadNumber(order.loadNumber || '');
    setLoadCases(order.loadCases || '');
    setLoadAmount(order.loadAmount || '');
  }, []);

  // Copy last order for this route
  const copyLastOrder = useCallback(() => {
    const routeOrders = orders
      .filter(o => o.routeNumber === selectedRoute && o.date !== orderDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (routeOrders.length > 0) {
      loadExistingOrder(routeOrders[0]);
    }
  }, [orders, selectedRoute, orderDate, loadExistingOrder]);

  // When route/date changes, load existing order
  const handleRouteChange = useCallback((r) => {
    setSelectedRoute(r);
    const existing = orders.find(o => o.routeNumber === r && o.date === orderDate);
    if (existing) loadExistingOrder(existing);
    else { setCases({}); setUnits({}); setOrderName(ROUTE_DRIVERS[r] || ''); setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount(''); setLoadNumber(''); setLoadCases(''); setLoadAmount(''); }
  }, [orders, orderDate, loadExistingOrder]);

  const handleDateChange = useCallback((d) => {
    setOrderDate(d);
    const existing = orders.find(o => o.routeNumber === selectedRoute && o.date === d);
    if (existing) loadExistingOrder(existing);
    else { setCases({}); setUnits({}); setOrderName(''); setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount(''); setLoadNumber(''); setLoadCases(''); setLoadAmount(''); }
  }, [orders, selectedRoute, loadExistingOrder]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return PRODUCT_CATALOG;
    const q = search.toLowerCase();
    return PRODUCT_CATALOG.filter(p =>
      p.desc.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.type.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }, [search]);

  // Group filtered products by category
  const grouped = useMemo(() => {
    const g = {};
    PRODUCT_CATEGORIES.forEach(cat => { g[cat] = []; });
    filteredProducts.forEach(p => {
      if (g[p.category]) g[p.category].push(p);
    });
    return g;
  }, [filteredProducts]);

  // Totals
  const totals = useMemo(() => {
    let totalCases = 0, totalUnits = 0, totalGross = 0;
    // Get all SKUs that have cases or units
    const allSkus = new Set([...Object.keys(cases), ...Object.keys(units)]);
    allSkus.forEach(sku => {
      const product = PRODUCT_CATALOG.find(p => p.sku === sku);
      if (product) {
        const caseQty = cases[sku] || 0;
        const unitQty = units[sku] || 0;
        if (caseQty > 0 || unitQty > 0) {
          totalCases += caseQty;
          const caseUnits = caseQty * product.upc;
          totalUnits += caseUnits + unitQty;
          totalGross += (caseUnits + unitQty) * product.price;
        }
      }
    });
    return { totalCases, totalUnits, totalGross };
  }, [cases, units]);

  // Save order
  const handleSave = useCallback(() => {
    if (!selectedRoute) return;
    setSaving(true);
    const allSkus = new Set([...Object.keys(cases), ...Object.keys(units)]);
    const items = [...allSkus]
      .filter(sku => (cases[sku] || 0) > 0 || (units[sku] || 0) > 0)
      .map(sku => {
        const qty = cases[sku] || 0;
        const unitQty = units[sku] || 0;
        const p = PRODUCT_CATALOG.find(pr => pr.sku === sku);
        const caseUnits = qty * (p?.upc || 0);
        const allUnits = caseUnits + unitQty;
        return {
          sku,
          category: p?.category || '',
          desc: p?.desc || '',
          cases: qty,
          orderUnits: unitQty,
          upc: p?.upc || 0,
          price: p?.price || 0,
          units: allUnits,
          gross: allUnits * (p?.price || 0),
        };
      });

    const orderData = {
      routeNumber: selectedRoute,
      date: orderDate,
      name: orderName,
      invoiceNumber,
      invoiceCases,
      invoiceAmount,
      loadNumber,
      loadCases,
      loadAmount,
      status: 'pending',
      source: 'app',
      items,
      totals: { ...totals },
    };

    if (existingOrder) {
      updateWarehouseOrder({ ...orderData, id: existingOrder.id });
    } else {
      addWarehouseOrder(orderData);
    }
    setTimeout(() => setSaving(false), 500);
  }, [selectedRoute, orderDate, orderName, invoiceNumber, invoiceCases, invoiceAmount, loadNumber, loadCases, loadAmount, cases, units, totals, existingOrder, addWarehouseOrder, updateWarehouseOrder]);

  // Toggle category collapse
  const toggleCat = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  // Set case count for a product
  const setCaseCount = (sku, val) => {
    const num = val === '' ? 0 : parseFloat(val) || 0;
    setCases(prev => {
      const next = { ...prev };
      if (num > 0) next[sku] = num;
      else delete next[sku];
      return next;
    });
  };

  // Set individual unit count for a product
  const setUnitCount = (sku, val) => {
    const num = val === '' ? 0 : parseFloat(val) || 0;
    setUnits(prev => {
      const next = { ...prev };
      if (num > 0) next[sku] = num;
      else delete next[sku];
      return next;
    });
  };

  // Orders for the queue view
  const queueOrders = useMemo(() => {
    return [...orders].sort((a, b) => b.date.localeCompare(a.date) || a.routeNumber?.localeCompare(b.routeNumber));
  }, [orders]);

  // --- Google Sheets sync handlers ---

  const handleSaveUrl = useCallback(() => {
    setGoogleSheetsUrl(sheetsUrl);
    setSyncMsg({ type: 'success', text: 'Google Sheets URL saved' });
    setTimeout(() => setSyncMsg(null), 3000);
  }, [sheetsUrl]);

  // Push current order to Google Sheet
  const handlePushToSheet = useCallback(async () => {
    if (!selectedRoute || totals.totalCases === 0) return;
    if (!isGoogleSheetsConfigured()) {
      setSyncMsg({ type: 'error', text: 'Set up Google Sheets URL in settings first' });
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const items = Object.entries(cases)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => ({ sku, cases: qty }));

      const result = await pushOrderToSheet({
        routeNumber: selectedRoute,
        date: orderDate,
        name: orderName,
        items,
      });

      if (result.success) {
        const msg = `Pushed to "${result.tab}" — ${result.written}/${result.total} items written`;
        const extra = result.notFound?.length > 0 ? ` (${result.notFound.length} SKUs not found in sheet)` : '';
        setSyncMsg({ type: 'success', text: msg + extra });
        // Update order status to synced
        if (existingOrder) {
          updateWarehouseOrder({ ...existingOrder, status: 'synced', sheetTab: result.tab });
        }
      } else {
        setSyncMsg({ type: 'error', text: result.error || 'Push failed' });
      }
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  }, [selectedRoute, orderDate, orderName, cases, totals, existingOrder, updateWarehouseOrder]);

  // Push a queue order to Google Sheet
  const handlePushQueueOrder = useCallback(async (order) => {
    if (!isGoogleSheetsConfigured()) {
      setSyncMsg({ type: 'error', text: 'Set up Google Sheets URL in settings first' });
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await pushOrderToSheet({
        routeNumber: order.routeNumber,
        date: order.date,
        name: order.name,
        items: (order.items || []).map(i => ({ sku: i.sku, cases: i.cases })),
      });
      if (result.success) {
        setSyncMsg({ type: 'success', text: `Pushed "${result.tab}" — ${result.written} items` });
        updateWarehouseOrder({ ...order, status: 'synced', sheetTab: result.tab });
      } else {
        setSyncMsg({ type: 'error', text: result.error || 'Push failed' });
      }
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  }, [updateWarehouseOrder]);

  // Open the pull-from-sheet modal and load tab list
  const handleOpenPull = useCallback(async () => {
    if (!isGoogleSheetsConfigured()) {
      setSyncMsg({ type: 'error', text: 'Set up Google Sheets URL in settings first' });
      return;
    }
    setLoadingTabs(true);
    setShowPullModal(true);
    setSyncMsg(null);
    try {
      const result = await listSheetTabs();
      if (result.success) {
        setSheetTabs(result.tabs || []);
      } else {
        setSyncMsg({ type: 'error', text: result.error });
      }
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setLoadingTabs(false);
  }, []);

  // Pull order from a specific sheet tab
  const handlePullTab = useCallback(async (tabName) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await getOrderFromSheet(tabName);
      if (result.success) {
        const c = {};
        (result.items || []).forEach(item => {
          if (item.cases > 0) c[item.sku] = item.cases;
        });
        setCases(c);
        setSyncMsg({ type: 'success', text: `Pulled ${result.items?.length || 0} items from "${tabName}"` });
        setShowPullModal(false);
      } else {
        setSyncMsg({ type: 'error', text: result.error });
      }
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  }, []);

  const sheetsConfigured = isGoogleSheetsConfigured();

  return (
    <div className="wo-page">
      <div className="wo-header">
        <h2>Warehouse Orders</h2>
        <div className="wo-tabs">
          <button className={`wo-tab ${tab === 'entry' ? 'active' : ''}`} onClick={() => setTab('entry')}>Order Entry</button>
          <button className={`wo-tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>Order Queue ({orders.length})</button>
          <button
            className={`wo-tab wo-tab-settings ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Google Sheets Settings"
          >
            {sheetsConfigured ? '\u2601 Sheets' : '\u2699 Setup'}
          </button>
        </div>
      </div>

      {/* Sync status message */}
      {syncMsg && (
        <div className={`wo-sync-msg wo-sync-${syncMsg.type}`}>
          {syncMsg.text}
          <button className="wo-sync-msg-close" onClick={() => setSyncMsg(null)}>&times;</button>
        </div>
      )}

      {/* Google Sheets settings panel */}
      {showSettings && (
        <div className="wo-settings">
          <h3>Google Sheets Connection</h3>
          <p className="wo-settings-desc">
            Paste the Apps Script Web App URL from your warehouse order spreadsheet.
            Deploy the script via Extensions &rarr; Apps Script &rarr; Deploy &rarr; Web App.
          </p>
          <div className="wo-settings-row">
            <input
              type="text"
              value={sheetsUrl}
              onChange={e => setSheetsUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="wo-settings-url"
            />
            <button className="wo-save-btn" onClick={handleSaveUrl}>Save URL</button>
          </div>
          {sheetsConfigured && (
            <div className="wo-settings-status">
              Connected &mdash; ready to sync
            </div>
          )}
        </div>
      )}

      {tab === 'entry' && (
        <div className="wo-entry">
          <div className="wo-controls">
            <label>
              Route:
              <select value={selectedRoute} onChange={e => handleRouteChange(e.target.value)}>
                <option value="">Select route...</option>
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              Date:
              <input type="date" value={orderDate} onChange={e => handleDateChange(e.target.value)} />
            </label>
            <label>
              Driver:
              <select value={orderName} onChange={e => {
                const name = e.target.value;
                setOrderName(name);
                if (name && DRIVER_ROUTES[name]) {
                  handleRouteChange(DRIVER_ROUTES[name]);
                }
              }}>
                <option value="">Select driver...</option>
                {[...new Set(Object.values(ROUTE_DRIVERS))].map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <button className="wo-copy-btn" onClick={copyLastOrder} disabled={!selectedRoute} title="Copy last order for this route">Copy Last Order</button>
            {existingOrder && <span className="wo-existing-badge">Editing existing order</span>}
          </div>

          <div className="wo-confirm-panel">
            <div className="wo-confirm-side">
              <div className="wo-confirm-title">Warehouse</div>
              <label>Invoice #<input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice #" /></label>
              <label>Cases<input type="number" value={invoiceCases} onChange={e => setInvoiceCases(e.target.value)} placeholder="0" /></label>
              <label>Amount<input type="number" step="0.01" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="0.00" /></label>
            </div>
            <div className="wo-confirm-vs">
              {(() => {
                const casesMatch = invoiceCases && loadCases && invoiceCases === loadCases;
                const amtMatch = invoiceAmount && loadAmount && Math.abs(parseFloat(invoiceAmount) - parseFloat(loadAmount)) <= 0.01;
                if (invoiceCases && loadCases && invoiceAmount && loadAmount) {
                  return casesMatch && amtMatch
                    ? <span className="wo-match-badge">Match</span>
                    : <span className="wo-mismatch-badge">Mismatch</span>;
                }
                return <span className="wo-confirm-vs-label">vs</span>;
              })()}
            </div>
            <div className="wo-confirm-side">
              <div className="wo-confirm-title">Driver (Handheld)</div>
              <label>Load #<input type="text" value={loadNumber} onChange={e => setLoadNumber(e.target.value)} placeholder="Load / Customer Inv" /></label>
              <label>Cases<input type="number" value={loadCases} onChange={e => setLoadCases(e.target.value)} placeholder="0" /></label>
              <label>Amount<input type="number" step="0.01" value={loadAmount} onChange={e => setLoadAmount(e.target.value)} placeholder="0.00" /></label>
            </div>
          </div>

          {/* Sync action bar */}
          {sheetsConfigured && (
            <div className="wo-sync-bar">
              <span className="wo-sync-label">Google Sheets:</span>
              <button
                className="wo-sync-btn wo-sync-push"
                onClick={handlePushToSheet}
                disabled={syncing || !selectedRoute || totals.totalCases === 0}
                title={`Push to sheet tab: "${buildTabName(selectedRoute, orderName, orderDate)}"`}
              >
                {syncing ? 'Syncing...' : '\u2191 Push to Sheet'}
              </button>
              <button
                className="wo-sync-btn wo-sync-pull"
                onClick={handleOpenPull}
                disabled={syncing}
              >
                {'\u2193 Pull from Sheet'}
              </button>
              {selectedRoute && orderName && (
                <span className="wo-sync-tab-preview">
                  Tab: {buildTabName(selectedRoute, orderName, orderDate)}
                </span>
              )}
            </div>
          )}

          <div className="wo-search">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products..."
            />
            {search && <button className="wo-clear-search" onClick={() => setSearch('')}>Clear</button>}
          </div>

          <div className="wo-grid-wrapper">
            <table className="wo-grid">
              <thead>
                <tr>
                  <th className="wo-col-sku">SKU</th>
                  <th className="wo-col-desc">Product</th>
                  <th className="wo-col-type">Type</th>
                  <th className="wo-col-upc">UIC</th>
                  <th className="wo-col-price">Cost</th>
                  <th className="wo-col-cases">Cases</th>
                  <th className="wo-col-units">Order Units</th>
                  <th className="wo-col-total">Total $</th>
                </tr>
                <tr className="wo-totals-row">
                  <td colSpan="5" className="wo-totals-label">TOTALS</td>
                  <td className="wo-totals-val">{totals.totalCases || ''}</td>
                  <td className="wo-totals-val">{totals.totalUnits || ''}</td>
                  <td className="wo-totals-val">{totals.totalGross > 0 ? `$${totals.totalGross.toFixed(2)}` : ''}</td>
                </tr>
              </thead>
                {PRODUCT_CATEGORIES.map(cat => {
                  const products = grouped[cat] || [];
                  if (products.length === 0) return null;
                  const isCollapsed = collapsed[cat];
                  const catCases = products.reduce((sum, p) => sum + (cases[p.sku] || 0), 0);
                  return (
                    <tbody key={cat}>
                      <tr className="wo-cat-row" onClick={() => toggleCat(cat)}>
                        <td colSpan="5" className="wo-cat-name">
                          <span className="wo-cat-arrow">{isCollapsed ? '\u25b6' : '\u25bc'}</span>
                          {cat}
                        </td>
                        <td className="wo-cat-total">{catCases > 0 ? catCases : ''}</td>
                        <td colSpan="2"></td>
                      </tr>
                      {!isCollapsed && products.map(p => {
                        const qty = cases[p.sku] || 0;
                        const unitQty = units[p.sku] || 0;
                        const allUnits = (qty * p.upc) + unitQty;
                        const total = allUnits * p.price;
                        const hasQty = qty > 0 || unitQty > 0;
                        return (
                          <tr key={p.sku} className={`wo-product-row ${hasQty ? 'wo-has-qty' : ''}`}>
                            <td className="wo-col-sku">{p.sku}</td>
                            <td className="wo-col-desc">{p.desc}</td>
                            <td className="wo-col-type">{p.type}</td>
                            <td className="wo-col-upc">{p.upc}</td>
                            <td className="wo-col-price">${p.price.toFixed(2)}</td>
                            <td className="wo-col-cases">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={qty || ''}
                                onChange={e => setCaseCount(p.sku, e.target.value)}
                                className="wo-case-input"
                                tabIndex={0}
                              />
                            </td>
                            <td className="wo-col-units">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={unitQty || ''}
                                onChange={e => setUnitCount(p.sku, e.target.value)}
                                className="wo-case-input"
                                tabIndex={0}
                              />
                            </td>
                            <td className="wo-col-total">{hasQty ? `$${total.toFixed(2)}` : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
            </table>
          </div>

          <div className="wo-summary">
            <span><strong>{totals.totalCases}</strong> cases</span>
            <span><strong>{totals.totalUnits}</strong> units</span>
            <span><strong>${totals.totalGross.toFixed(2)}</strong> gross</span>
            <button
              className="wo-save-btn"
              onClick={handleSave}
              disabled={!selectedRoute || totals.totalCases === 0 || saving}
            >
              {saving ? 'Saving...' : existingOrder ? 'Update Order' : 'Save Order'}
            </button>
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="wo-queue">
          {queueOrders.length === 0 ? (
            <div className="wo-empty">No orders yet. Switch to Order Entry to create one.</div>
          ) : (
            <table className="wo-queue-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Route</th>
                  <th>Name</th>
                  <th>Items</th>
                  <th>Cases</th>
                  <th>Gross $</th>
                  <th>WH Inv</th>
                  <th>Driver Load</th>
                  <th>Verify</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queueOrders.map(order => (
                  <tr key={order.id} className="wo-queue-row">
                    <td>{order.date}</td>
                    <td><strong>{order.routeNumber}</strong></td>
                    <td>{order.name || '-'}</td>
                    <td>{order.items?.length || 0}</td>
                    <td>{order.totals?.totalCases || 0}</td>
                    <td>${(order.totals?.totalGross || 0).toFixed(2)}</td>
                    <td className="wo-invoice-cell">
                      {order.invoiceNumber ? `#${order.invoiceNumber}` : '-'}
                      {order.invoiceCases ? ` ${order.invoiceCases}cs` : ''}
                      {order.invoiceAmount ? ` $${parseFloat(order.invoiceAmount).toFixed(2)}` : ''}
                    </td>
                    <td className="wo-invoice-cell">
                      {order.loadNumber ? `#${order.loadNumber}` : '-'}
                      {order.loadCases ? ` ${order.loadCases}cs` : ''}
                      {order.loadAmount ? ` $${parseFloat(order.loadAmount).toFixed(2)}` : ''}
                    </td>
                    <td>
                      {order.invoiceAmount && order.loadAmount ? (
                        Math.abs(parseFloat(order.invoiceAmount) - parseFloat(order.loadAmount)) <= 0.01
                        && (!order.invoiceCases || !order.loadCases || order.invoiceCases === order.loadCases)
                          ? <span className="wo-match-badge">OK</span>
                          : <span className="wo-mismatch-badge">!</span>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={`wo-status wo-status-${order.status}`}>{order.status}</span>
                    </td>
                    <td className="wo-queue-actions">
                      <button onClick={() => {
                        setSelectedRoute(order.routeNumber);
                        setOrderDate(order.date);
                        loadExistingOrder(order);
                        setTab('entry');
                      }}>Edit</button>
                      {sheetsConfigured && order.status !== 'synced' && (
                        <button
                          className="wo-sync-btn-sm"
                          onClick={() => handlePushQueueOrder(order)}
                          disabled={syncing}
                        >
                          {syncing ? '...' : '\u2191 Sheet'}
                        </button>
                      )}
                      <button className="wo-del-btn" onClick={() => {
                        if (window.confirm(`Delete order for route ${order.routeNumber} on ${order.date}?`)) {
                          deleteWarehouseOrder(order.id);
                        }
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pull from Sheet modal */}
      {showPullModal && (
        <div className="wo-modal-overlay" onClick={() => setShowPullModal(false)}>
          <div className="wo-modal" onClick={e => e.stopPropagation()}>
            <div className="wo-modal-header">
              <h3>Pull from Google Sheet</h3>
              <button className="wo-modal-close" onClick={() => setShowPullModal(false)}>&times;</button>
            </div>
            <p className="wo-modal-desc">Select a sheet tab to import case counts from:</p>
            {loadingTabs ? (
              <div className="wo-modal-loading">Loading tabs...</div>
            ) : sheetTabs.length === 0 ? (
              <div className="wo-modal-loading">No tabs found</div>
            ) : (
              <div className="wo-modal-tabs">
                {sheetTabs.map(tabName => (
                  <button
                    key={tabName}
                    className="wo-modal-tab-btn"
                    onClick={() => handlePullTab(tabName)}
                    disabled={syncing}
                  >
                    {tabName}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { t } from '../locales/translations';
import { PRODUCT_CATALOG, PRODUCT_CATEGORIES } from '../data/productCatalog';
import {
  getGoogleClientId, setGoogleClientId,
  getSpreadsheetId, setSpreadsheetId,
  isGoogleSheetsConfigured, isSignedIn, signOut, authenticate,
  pushOrderToSheet, getOrderFromSheet, listSheetTabs, buildTabName, readSheetCases, getSheetTabUrl, getSpreadsheetUrl, hasSpreadsheetId, createTemplateCopy,
} from '../services/googleSheetsService';

const ROUTE_INFO = {
  '200': { driver: 'Jose Nunez', custNum: '00000956', whRouteCode: '360099', drvRouteCode: '360200' },
  '201': { driver: 'Ryan', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '203': { driver: 'Jay Aguirre', custNum: '00000961', whRouteCode: '360099', drvRouteCode: '360203' },
  '204': { driver: 'Cindy', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '206': { driver: 'Eastern Shore', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '207': { driver: 'Andre', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '208': { driver: 'Draco', custNum: '00000966', whRouteCode: '360099', drvRouteCode: '360208' },
  '209': { driver: 'Damian', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '210': { driver: 'Eastern Shore', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '211': { driver: 'Jhonny', custNum: '', whRouteCode: '', drvRouteCode: '' },
  '214': { driver: 'Randy', custNum: '', whRouteCode: '', drvRouteCode: '' },
};

// Legacy compat — flat route→name map
const ROUTE_DRIVERS = {};
Object.entries(ROUTE_INFO).forEach(([route, info]) => {
  ROUTE_DRIVERS[route] = info.driver;
});

// Reverse: driver name → first matching route
const DRIVER_ROUTES = {};
Object.entries(ROUTE_DRIVERS).forEach(([route, name]) => {
  if (!DRIVER_ROUTES[name]) DRIVER_ROUTES[name] = route;
});

export default function WarehouseOrders() {
  const { state, addWarehouseOrder, updateWarehouseOrder, deleteWarehouseOrder, setLanguage } = useApp();
  const { warehouseOrders, stores, language } = state;
  const lang = language || 'en';
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
  const [isAdmin, setIsAdmin] = useState(false);

  // Google Sheets sync state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsRole, setSettingsRole] = useState(() => localStorage.getItem('wo_role') || '');
  const [workerName, setWorkerName] = useState(() => localStorage.getItem('wo_worker_name') || '');
  const [clientId, setClientIdState] = useState(() => getGoogleClientId());
  const [spreadsheetId, setSpreadsheetIdState] = useState(() => {
    // Clear known placeholder value that was never a real spreadsheet
    const stored = getSpreadsheetId();
    if (stored === '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms') {
      setSpreadsheetId('');
      return '';
    }
    return stored;
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // { type: 'success'|'error', text }
  const [sheetTabs, setSheetTabs] = useState([]);
  const [showPullModal, setShowPullModal] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);
  // Overwrite confirmation state
  const [showConfirm, setShowConfirm] = useState(null); // { type: 'push'|'pull', conflicts: [], onConfirm, onMerge }
  const [confirmTab, setConfirmTab] = useState('');
  // History: sheet tabs grouped by route/driver
  const [historyTabs, setHistoryTabs] = useState([]); // raw tab names from Google Sheet
  const [tabSheetIds, setTabSheetIds] = useState({}); // { tabName: sheetId } for URL linking
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  // Recent orders dropdown (last 8 from Google Sheet)
  const [recentTabs, setRecentTabs] = useState([]);
  const [recentLoaded, setRecentLoaded] = useState(false);

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

  // When route/date changes, load existing order and auto-create template copy
  const handleRouteChange = useCallback((r) => {
    setSelectedRoute(r);
    const info = ROUTE_INFO[r];
    const driverName = info?.driver || '';
    const existing = orders.find(o => o.routeNumber === r && o.date === orderDate);
    if (existing) loadExistingOrder(existing);
    else { setCases({}); setUnits({}); setOrderName(driverName); setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount(''); setLoadNumber(''); setLoadCases(''); setLoadAmount(''); }

    // Auto-create template copy on Google Sheet when a route with a driver is selected
    if (r && driverName && isGoogleSheetsConfigured()) {
      const tabName = buildTabName(r, driverName, orderDate);
      setSyncMsg({ type: 'success', text: `Creating sheet tab "${tabName}"...` });
      createTemplateCopy(r, driverName, orderDate)
        .then(result => {
          if (result.alreadyExists) {
            setSyncMsg({ type: 'success', text: `Sheet tab "${result.tabName}" already exists — ready for entry` });
          } else {
            setSyncMsg({ type: 'success', text: `Template copied — "${result.tabName}" created and ready for entry` });
          }
          setTimeout(() => setSyncMsg(null), 5000);
        })
        .catch(err => {
          console.error('[Template Copy]', err);
          setSyncMsg({ type: 'error', text: `Template copy failed: ${err.message}` });
        });
    }
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

  // Set individual unit count — auto-converts full cases
  const setUnitCount = (sku, val) => {
    const num = val === '' ? 0 : parseInt(val, 10) || 0;
    if (num <= 0) {
      setUnits(prev => { const next = { ...prev }; delete next[sku]; return next; });
      return;
    }
    const product = PRODUCT_CATALOG.find(p => p.sku === sku);
    const upc = product?.upc || 1;
    if (num >= upc) {
      const fullCases = Math.floor(num / upc);
      const remainder = num % upc;
      setCases(prev => ({ ...prev, [sku]: (prev[sku] || 0) + fullCases }));
      setUnits(prev => {
        const next = { ...prev };
        if (remainder > 0) next[sku] = remainder;
        else delete next[sku];
        return next;
      });
    } else {
      setUnits(prev => ({ ...prev, [sku]: num }));
    }
  };

  // Orders for the queue view
  const queueOrders = useMemo(() => {
    return [...orders].sort((a, b) => b.date.localeCompare(a.date) || a.routeNumber?.localeCompare(b.routeNumber));
  }, [orders]);

  // --- Google Sheets sync handlers ---

  const handleSaveConfig = useCallback(() => {
    const trimmedId = spreadsheetId.trim();
    const trimmedClient = clientId.trim();
    setGoogleClientId(trimmedClient);
    setSpreadsheetId(trimmedId);
    setSpreadsheetIdState(trimmedId);
    setClientIdState(trimmedClient);
    setSyncMsg({ type: 'success', text: `Config saved! Sheet ID: ${trimmedId.slice(0, 8)}...${trimmedId.slice(-4)}` });
    setTimeout(() => setSyncMsg(null), 5000);
  }, [clientId, spreadsheetId]);

  const handleSignIn = useCallback(async () => {
    try {
      await authenticate();
      setSyncMsg({ type: 'success', text: 'Signed in to Google' });
      setTimeout(() => setSyncMsg(null), 3000);
    } catch (err) {
      setSyncMsg({ type: 'error', text: 'Sign-in failed: ' + err.message });
    }
  }, []);

  const handleSignOut = useCallback(() => {
    signOut();
    setSyncMsg({ type: 'success', text: 'Signed out of Google' });
    setTimeout(() => setSyncMsg(null), 3000);
  }, []);

  // Execute the actual push (called after confirmation)
  const executePush = useCallback(async (itemsToWrite) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await pushOrderToSheet({
        routeNumber: selectedRoute,
        date: orderDate,
        name: orderName,
        items: itemsToWrite,
      });

      if (result.success) {
        const msg = `Pushed to "${result.tab}" — ${result.written}/${result.total} items written`;
        const extra = result.notFound?.length > 0 ? ` (${result.notFound.length} SKUs not found in sheet)` : '';
        setSyncMsg({ type: 'success', text: msg + extra });
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
  }, [selectedRoute, orderDate, orderName, existingOrder, updateWarehouseOrder]);

  // Push current order to Google Sheet (checks for conflicts first)
  const handlePushToSheet = useCallback(async () => {
    if (!selectedRoute || totals.totalCases === 0) return;
    if (!isGoogleSheetsConfigured()) {
      setSyncMsg({ type: 'error', text: 'Set up Google Sheets config in settings first' });
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const tabName = buildTabName(selectedRoute, orderName, orderDate);
      const items = Object.entries(cases)
        .filter(([, qty]) => qty > 0)
        .map(([sku, qty]) => ({ sku, cases: qty }));

      // Read existing sheet data for comparison
      let sheetCases = {};
      try { sheetCases = await readSheetCases(tabName); } catch (e) { /* tab may not exist yet */ }

      const conflicts = [];
      for (const item of items) {
        const sheetVal = sheetCases[item.sku] || 0;
        if (sheetVal > 0 && sheetVal !== item.cases) {
          const prod = PRODUCT_CATALOG.find(p => p.sku === item.sku);
          conflicts.push({ sku: item.sku, desc: prod?.description || item.sku, sheetVal, appVal: item.cases });
        }
      }

      if (conflicts.length > 0) {
        // Show confirmation with conflicts
        setConfirmTab(tabName);
        setShowConfirm({
          type: 'push',
          conflicts,
          allItems: items,
          onOverwrite: () => { setShowConfirm(null); executePush(items); },
          onMerge: () => {
            // Only push items where sheet is empty
            const mergeItems = items.filter(i => !sheetCases[i.sku] || sheetCases[i.sku] === 0);
            setShowConfirm(null);
            executePush(mergeItems);
          },
        });
        setSyncing(false);
      } else {
        // No conflicts, push directly
        setSyncing(false);
        executePush(items);
      }
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
      setSyncing(false);
    }
  }, [selectedRoute, orderDate, orderName, cases, totals, executePush]);

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

  const [pullError, setPullError] = useState(null);

  // Open the pull-from-sheet modal and load tab list
  const handleOpenPull = useCallback(async () => {
    if (!isGoogleSheetsConfigured()) {
      setSyncMsg({ type: 'error', text: 'Set up Google Sheets config in settings first' });
      return;
    }
    setLoadingTabs(true);
    setShowPullModal(true);
    setPullError(null);
    setSheetTabs([]);
    try {
      const result = await listSheetTabs();
      if (result.success) {
        setSheetTabs(result.tabs || []);
        if ((result.tabs || []).length === 0) {
          setPullError('No tabs found in the spreadsheet. Check that the Spreadsheet ID is correct.');
        }
      } else {
        setPullError(result.error || 'Failed to load tabs');
      }
    } catch (err) {
      setPullError(err.message);
    }
    setLoadingTabs(false);
  }, []);

  // Pull order from a specific sheet tab (checks for conflicts first)
  const handlePullTab = useCallback(async (tabName) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await getOrderFromSheet(tabName);
      if (!result.success) {
        setSyncMsg({ type: 'error', text: result.error });
        setSyncing(false);
        return;
      }

      const sheetItems = {};
      (result.items || []).forEach(item => {
        if (item.cases > 0) sheetItems[item.sku] = item.cases;
      });

      // Check if form has data that would be overwritten
      const formHasData = Object.values(cases).some(v => v > 0);
      if (formHasData) {
        const conflicts = [];
        const allSkus = new Set([...Object.keys(cases), ...Object.keys(sheetItems)]);
        for (const sku of allSkus) {
          const formVal = parseFloat(cases[sku]) || 0;
          const sheetVal = sheetItems[sku] || 0;
          if (formVal > 0 && sheetVal > 0 && formVal !== sheetVal) {
            const prod = PRODUCT_CATALOG.find(p => p.sku === sku);
            conflicts.push({ sku, desc: prod?.description || sku, sheetVal, appVal: formVal });
          }
        }

        if (conflicts.length > 0) {
          setConfirmTab(tabName);
          setShowConfirm({
            type: 'pull',
            conflicts,
            onOverwrite: () => {
              setCases(sheetItems);
              setShowConfirm(null);
              setShowPullModal(false);
              setSyncMsg({ type: 'success', text: `Pulled ${result.items?.length || 0} items from "${tabName}"` });
            },
            onMerge: () => {
              // Only fill in items that are empty in the form
              const merged = { ...cases };
              for (const [sku, val] of Object.entries(sheetItems)) {
                if (!merged[sku] || merged[sku] === 0) merged[sku] = val;
              }
              setCases(merged);
              setShowConfirm(null);
              setShowPullModal(false);
              setSyncMsg({ type: 'success', text: `Merged ${result.items?.length || 0} items from "${tabName}" (kept existing)` });
            },
          });
          setSyncing(false);
          return;
        }
      }

      // No conflicts — apply directly
      setCases(sheetItems);
      setSyncMsg({ type: 'success', text: `Pulled ${result.items?.length || 0} items from "${tabName}"` });
      setShowPullModal(false);
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  }, [cases]);

  // Parse a sheet tab name like "200 Jose Nunez 2/26/26" into { route, driver, date, tabName }
  const parseTabName = useCallback((tabName) => {
    // Pattern: routeNum driverName M/DD/YY
    const match = tabName.match(/^(\d{3})\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})$/);
    if (match) {
      return { route: match[1], driver: match[2], date: match[3], tabName };
    }
    // Fallback: try just route + date
    const match2 = tabName.match(/^(\d{3})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})$/);
    if (match2) {
      return { route: match2[1], driver: ROUTE_DRIVERS[match2[1]] || 'Unknown', date: match2[2], tabName };
    }
    return null; // not an order tab (e.g. "Template")
  }, []);

  // Load sheet tabs for history view + recent dropdown
  const loadHistoryTabs = useCallback(async () => {
    if (!isGoogleSheetsConfigured()) {
      setHistoryError('Google Sheets not configured');
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await listSheetTabs();
      if (result.success) {
        const allTabs = result.tabs || [];
        setHistoryTabs(allTabs);
        // Build tab name → sheetId map for URL linking
        const idMap = {};
        (result.tabsWithIds || []).forEach(t => { idMap[t.title] = t.sheetId; });
        setTabSheetIds(idMap);
        // Also populate recent tabs (last 8 order tabs, sorted by date descending)
        updateRecentTabs(allTabs);
      } else {
        setHistoryError(result.error || 'Failed to load tabs');
      }
    } catch (err) {
      setHistoryError(err.message);
    }
    setHistoryLoading(false);
  }, []);

  // Load just the recent tabs dropdown (lightweight, for order entry page)
  const loadRecentTabs = useCallback(async () => {
    if (recentLoaded || !isGoogleSheetsConfigured()) return;
    try {
      const result = await listSheetTabs();
      if (result.success) {
        updateRecentTabs(result.tabs || []);
        setRecentLoaded(true);
      }
    } catch (err) {
      console.error('[Recent Tabs]', err);
    }
  }, [recentLoaded]);

  // Extract and sort the last 8 order tabs by date
  const updateRecentTabs = useCallback((allTabs) => {
    const parsed = allTabs
      .map(name => parseTabName(name))
      .filter(Boolean);
    // Sort by date descending
    parsed.sort((a, b) => {
      const pd = (d) => {
        const p = d.split('/');
        if (p.length === 3) {
          const yr = parseInt(p[2], 10);
          return new Date(yr < 100 ? 2000 + yr : yr, parseInt(p[0], 10) - 1, parseInt(p[1], 10));
        }
        return new Date(0);
      };
      return pd(b.date) - pd(a.date);
    });
    setRecentTabs(parsed.slice(0, 8));
  }, [parseTabName]);

  // Group sheet tabs by route/driver for history display
  const historyGrouped = useMemo(() => {
    const groups = {};
    for (const tabName of historyTabs) {
      const parsed = parseTabName(tabName);
      if (!parsed) continue; // skip Template, etc.
      const key = `${parsed.route} - ${parsed.driver}`;
      if (!groups[key]) groups[key] = { route: parsed.route, driver: parsed.driver, tabs: [] };
      groups[key].tabs.push({ date: parsed.date, tabName: parsed.tabName });
    }
    // Sort tabs within each group by date descending
    Object.values(groups).forEach(g => {
      g.tabs.sort((a, b) => {
        // Parse M/DD/YY dates for comparison
        const parseDate = (d) => {
          const p = d.split('/');
          if (p.length === 3) {
            const yr = parseInt(p[2], 10);
            return new Date(yr < 100 ? 2000 + yr : yr, parseInt(p[0], 10) - 1, parseInt(p[1], 10));
          }
          return new Date(0);
        };
        return parseDate(b.date) - parseDate(a.date);
      });
    });
    // Sort groups by route number
    return Object.values(groups).sort((a, b) => a.route.localeCompare(b.route));
  }, [historyTabs, parseTabName]);

  const sheetsConfigured = isGoogleSheetsConfigured();

  return (
    <div className="wo-page">
      <div className="wo-header">
        <h2>{t(lang, 'warehouseOrders')}</h2>
        <button
          className="wo-lang-toggle"
          onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}
          title={language === 'en' ? 'Cambiar a Español' : 'Switch to English'}
        >
          <span className="wo-lang-flag">
            {language === 'en' ? (
              <svg viewBox="0 0 60 40" width="28" height="19">
                <rect width="60" height="13.3" fill="#D52B1E"/>
                <rect y="13.3" width="60" height="13.4" fill="#F9E300"/>
                <rect y="26.7" width="60" height="13.3" fill="#007934"/>
              </svg>
            ) : (
              <svg viewBox="0 0 60 40" width="28" height="19">
                <rect width="60" height="40" fill="#fff"/>
                <rect width="60" height="5.7" fill="#B22234"/>
                <rect y="7.7" width="60" height="5.7" fill="#B22234"/>
                <rect y="15.4" width="60" height="5.7" fill="#B22234"/>
                <rect y="23.1" width="60" height="5.7" fill="#B22234"/>
                <rect y="30.8" width="60" height="5.7" fill="#B22234"/>
                <rect y="3.1" width="60" height="1.5" fill="#fff" opacity="0"/>
                <rect width="24" height="21.5" fill="#3C3B6E"/>
                <g fill="#fff">{[...Array(5)].map((_,r)=>[...Array(6)].map((_,c)=><circle key={`${r}${c}`} cx={2+c*4} cy={2+r*4.3} r="1"/>))}{[...Array(4)].map((_,r)=>[...Array(5)].map((_,c)=><circle key={`s${r}${c}`} cx={4+c*4} cy={4.15+r*4.3} r="1"/>))}</g>
              </svg>
            )}
          </span>
          <span className="wo-lang-label">{language === 'en' ? 'Español' : 'English'}</span>
        </button>
        <div className="wo-tabs">
          <button className={`wo-tab ${tab === 'entry' ? 'active' : ''}`} onClick={() => setTab('entry')}>{t(lang, 'orderEntry')}</button>
          <button className={`wo-tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>{t(lang, 'orderQueue')} ({orders.length})</button>
          <button className={`wo-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => { setTab('history'); if (isGoogleSheetsConfigured()) loadHistoryTabs(); }}>{t(lang, 'driverHistory')}</button>
          <button
            className={`wo-tab wo-tab-settings ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Google Sheets Settings"
          >
            {sheetsConfigured ? `\u2601 ${t(lang, 'sheets')}` : `\u2699 ${t(lang, 'setup')}`}
          </button>
          <button
            className={`wo-tab ${isAdmin ? 'wo-tab-admin-active' : ''}`}
            onClick={() => {
              if (isAdmin) {
                setIsAdmin(false);
              } else {
                const pwd = window.prompt('Enter admin password:');
                if (pwd === '1234') setIsAdmin(true);
                else if (pwd !== null) alert('Incorrect password');
              }
            }}
            title={isAdmin ? 'Admin mode active — click to lock' : 'Unlock admin mode'}
          >
            {isAdmin ? '\uD83D\uDD13 Admin' : '\uD83D\uDD12 Admin'}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{lang === 'es' ? 'Configuracion' : 'Setup'}</h3>
            <button className="wo-modal-close" onClick={() => setShowSettings(false)}>&times;</button>
          </div>

          {/* Role picker */}
          {!settingsRole ? (
            <div className="wo-role-picker">
              <p className="wo-role-question">{lang === 'es' ? '¿Quien eres?' : 'Who are you?'}</p>
              <div className="wo-role-options">
                <button className="wo-role-btn wo-role-worker" onClick={() => { setSettingsRole('worker'); localStorage.setItem('wo_role', 'worker'); }}>
                  <span className="wo-role-icon">&#x1F477;</span>
                  <span className="wo-role-name">{lang === 'es' ? 'Trabajador' : 'Worker'}</span>
                  <span className="wo-role-desc">{lang === 'es' ? 'Solo ver ordenes' : 'View orders only'}</span>
                </button>
                <button className="wo-role-btn wo-role-admin" onClick={() => { setSettingsRole('admin'); localStorage.setItem('wo_role', 'admin'); }}>
                  <span className="wo-role-icon">&#x1F4BC;</span>
                  <span className="wo-role-name">{lang === 'es' ? 'Admin / Dueño' : 'Owner / Admin'}</span>
                  <span className="wo-role-desc">{lang === 'es' ? 'Control total' : 'Full control'}</span>
                </button>
              </div>
            </div>
          ) : settingsRole === 'worker' ? (
            /* Worker form */
            <div className="wo-settings-form">
              <div className="wo-role-badge wo-role-badge-worker">
                <span>&#x1F477; {lang === 'es' ? 'Trabajador' : 'Worker'}</span>
                <button className="wo-role-change" onClick={() => { setSettingsRole(''); localStorage.removeItem('wo_role'); }}>
                  {lang === 'es' ? 'Cambiar' : 'Change'}
                </button>
              </div>
              <div className="wo-settings-row">
                <label className="wo-settings-label">
                  {lang === 'es' ? 'Tu nombre' : 'Your Name'}
                  <input
                    type="text"
                    value={workerName}
                    onChange={e => setWorkerName(e.target.value)}
                    placeholder={lang === 'es' ? 'Ej: Johnny' : 'E.g. Johnny'}
                    className="wo-settings-url"
                  />
                </label>
              </div>
              <div className="wo-settings-row">
                <label className="wo-settings-label">
                  {lang === 'es' ? 'Link del Google Sheet' : 'Google Sheet Link'}
                  <input
                    type="text"
                    value={spreadsheetId}
                    onChange={e => {
                      let val = e.target.value;
                      const urlMatch = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
                      if (urlMatch) val = urlMatch[1];
                      setSpreadsheetIdState(val);
                    }}
                    placeholder={lang === 'es' ? 'Pegar link del Google Sheet aqui' : 'Paste Google Sheet link here'}
                    className="wo-settings-url"
                  />
                  {getSpreadsheetId() && (
                    <small style={{ color: '#34a853', fontSize: '11px', marginTop: '2px' }}>
                      &#x2714; {lang === 'es' ? 'Conectado' : 'Connected'}
                    </small>
                  )}
                </label>
              </div>
              <div className="wo-settings-actions">
                <button className="wo-settings-save-btn" onClick={() => {
                  localStorage.setItem('wo_worker_name', workerName);
                  setSpreadsheetId(spreadsheetId);
                  setSyncMsg({ type: 'success', text: lang === 'es' ? 'Guardado!' : 'Saved!' });
                  setShowSettings(false);
                }}>
                  {lang === 'es' ? 'Guardar' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            /* Admin form */
            <div className="wo-settings-form">
              <div className="wo-role-badge wo-role-badge-admin">
                <span>&#x1F4BC; {lang === 'es' ? 'Admin / Dueño' : 'Owner / Admin'}</span>
                <button className="wo-role-change" onClick={() => { setSettingsRole(''); localStorage.removeItem('wo_role'); }}>
                  {lang === 'es' ? 'Cambiar' : 'Change'}
                </button>
              </div>
              <div className="wo-settings-row">
                <label className="wo-settings-label">
                  {t(lang, 'spreadsheetId')}
                  <input
                    type="text"
                    value={spreadsheetId}
                    onChange={e => {
                      let val = e.target.value;
                      const urlMatch = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
                      if (urlMatch) val = urlMatch[1];
                      setSpreadsheetIdState(val);
                    }}
                    placeholder={lang === 'es' ? 'Pegar ID o URL del Google Sheet' : 'Paste ID or full Google Sheets URL'}
                    className="wo-settings-url"
                  />
                  {getSpreadsheetId() && (
                    <small style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>
                      Saved: {getSpreadsheetId().slice(0, 12)}...{getSpreadsheetId().slice(-6)}
                    </small>
                  )}
                </label>
              </div>
              <div className="wo-settings-row">
                <label className="wo-settings-label">
                  {t(lang, 'oauthClientId')}
                  <input
                    type="text"
                    value={clientId}
                    onChange={e => setClientIdState(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    className="wo-settings-url"
                  />
                </label>
              </div>
              <div className="wo-settings-actions">
                <button id="1/admin" className="wo-settings-save-btn" onClick={handleSaveConfig}>{t(lang, 'saveConfig')}</button>
                {sheetsConfigured && (
                  isSignedIn()
                    ? <button className="wo-clear-btn" onClick={handleSignOut}>{t(lang, 'signOut')}</button>
                    : <button className="wo-settings-signin-btn" onClick={handleSignIn}>{t(lang, 'signIn')}</button>
                )}
              </div>
              {sheetsConfigured && (
                <div className="wo-settings-status">
                  {isSignedIn() ? t(lang, 'signedInReady') : t(lang, 'configSavedSignIn')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'entry' && (
        <div className="wo-entry">
          {!hasSpreadsheetId() && (
            <div className="wo-connect-banner" onClick={() => setShowSettings(true)}>
              <span>&#x26A0;</span> {lang === 'es' ? 'Google Sheet no conectado — toque aqui para configurar' : 'Google Sheet not connected — tap here to set up'}
            </div>
          )}
          <div className="wo-controls">
            <label>
              {t(lang, 'route')}:
              <select value={selectedRoute} onChange={e => handleRouteChange(e.target.value)}>
                <option value="">{t(lang, 'selectRoute')}</option>
                {routes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              {t(lang, 'date')}:
              <input type="date" value={orderDate} onChange={e => handleDateChange(e.target.value)} />
            </label>
            <label>
              {t(lang, 'driver')}:
              <select value={orderName} onChange={e => {
                const name = e.target.value;
                setOrderName(name);
                if (name && DRIVER_ROUTES[name]) {
                  handleRouteChange(DRIVER_ROUTES[name]);
                }
              }}>
                <option value="">{t(lang, 'selectDriver')}</option>
                {[...new Set(Object.values(ROUTE_DRIVERS))].map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            {selectedRoute && ROUTE_INFO[selectedRoute]?.custNum && (
              <span className="wo-cust-num" title="Customer number">Cust# {ROUTE_INFO[selectedRoute].custNum}</span>
            )}
            <button id="1/order" className="wo-clear-btn" title={t(lang, 'clear')} onClick={() => {
              setCases({}); setUnits({});
              setSelectedRoute(''); setOrderName('');
              const d = new Date();
              setOrderDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
              setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount('');
              setLoadNumber(''); setLoadCases(''); setLoadAmount('');
            }}>{t(lang, 'clear')}</button>
            <button
              id="btn-save-order-top"
              className="wo-save-btn"
              onClick={handleSave}
              disabled={!selectedRoute || (totals.totalCases === 0 && totals.totalUnits === 0) || saving}
            >
              {saving ? t(lang, 'saving') : existingOrder ? t(lang, 'updateOrder') : t(lang, 'saveOrder')}
            </button>
            {existingOrder && <span className="wo-existing-badge">{t(lang, 'editingExisting')}</span>}
            {sheetsConfigured && (
              <label className="wo-recent-label">
                {lang === 'es' ? 'Ordenes recientes' : 'Recent Orders'}:
                <select
                  className="wo-recent-select"
                  value=""
                  onFocus={() => { if (!recentLoaded) loadRecentTabs(); }}
                  onChange={e => {
                    const tabName = e.target.value;
                    if (!tabName) return;
                    const parsed = parseTabName(tabName);
                    if (parsed) {
                      // Set route, driver, date from tab name
                      setSelectedRoute(parsed.route);
                      setOrderName(parsed.driver);
                      const dp = parsed.date.split('/');
                      if (dp.length === 3) {
                        const yr = parseInt(dp[2], 10);
                        const fullYr = yr < 100 ? 2000 + yr : yr;
                        setOrderDate(`${fullYr}-${String(dp[0]).padStart(2,'0')}-${String(dp[1]).padStart(2,'0')}`);
                      }
                      // Pull data from sheet
                      handlePullTab(tabName);
                    }
                  }}
                >
                  <option value="">{recentTabs.length === 0 ? (lang === 'es' ? 'Cargando...' : 'Loading...') : (lang === 'es' ? 'Seleccionar orden...' : 'Select order...')}</option>
                  {recentTabs.map(rt => (
                    <option key={rt.tabName} value={rt.tabName}>{rt.tabName}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {(() => {
            const ri = ROUTE_INFO[selectedRoute] || {};
            return (
              <div className="wo-confirm-panel">
                <div className="wo-confirm-side">
                  <div className="wo-confirm-title">{t(lang, 'warehouse')}</div>
                  {ri.whRouteCode && <div className="wo-prefill-row">{t(lang, 'routeCode')}: <strong>{ri.whRouteCode}</strong></div>}
                  {ri.custNum && <div className="wo-prefill-row">Cust#: <strong>{ri.custNum}</strong> — {ri.driver}</div>}
                  <label>{t(lang, 'invoiceNum')}<input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder={t(lang, 'invoiceNum')} /></label>
                  <label>{t(lang, 'cases')}<input type="number" value={invoiceCases || totals.totalCases || ''} onChange={e => setInvoiceCases(e.target.value)} placeholder="0" /></label>
                  <label>{t(lang, 'amount')}<input type="number" step="0.01" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} placeholder="0.00" /></label>
                </div>
                <div className="wo-confirm-vs">
                  {(() => {
                    const whCases = invoiceCases || totals.totalCases || 0;
                    const drCases = loadCases || totals.totalCases || 0;
                    const casesMatch = whCases && drCases && String(whCases) === String(drCases);
                    const amtMatch = invoiceAmount && loadAmount && Math.abs(parseFloat(invoiceAmount) - parseFloat(loadAmount)) <= 0.01;
                    if (invoiceAmount && loadAmount) {
                      return casesMatch && amtMatch
                        ? <span className="wo-match-badge">{t(lang, 'match')}</span>
                        : <span className="wo-mismatch-badge">{t(lang, 'mismatch')}</span>;
                    }
                    return <span className="wo-confirm-vs-label">{t(lang, 'vs')}</span>;
                  })()}
                </div>
                <div className="wo-confirm-side">
                  <div className="wo-confirm-title">{t(lang, 'driverHandheld')}</div>
                  {ri.drvRouteCode && <div className="wo-prefill-row">{t(lang, 'routeCode')}: <strong>{ri.drvRouteCode}</strong></div>}
                  <label>{t(lang, 'loadNum')}<input type="text" value={loadNumber} onChange={e => setLoadNumber(e.target.value)} placeholder={t(lang, 'loadNum')} /></label>
                  <label>{t(lang, 'cases')}<input type="number" value={loadCases || totals.totalCases || ''} onChange={e => setLoadCases(e.target.value)} placeholder="0" /></label>
                  <label>{t(lang, 'amount')}<input type="number" step="0.01" value={loadAmount} onChange={e => setLoadAmount(e.target.value)} placeholder="0.00" /></label>
                </div>
              </div>
            );
          })()}

          {/* Sync action bar */}
          {sheetsConfigured && (
            <div className="wo-sync-bar">
              <span className="wo-sync-label">{t(lang, 'googleSheets')}:</span>
              <button
                className="wo-sync-btn wo-sync-push"
                onClick={handlePushToSheet}
                disabled={syncing || !selectedRoute || totals.totalCases === 0}
                title={`Push to sheet tab: "${buildTabName(selectedRoute, orderName, orderDate)}"`}
              >
                {syncing ? t(lang, 'syncing') : `\u2191 ${t(lang, 'pushToSheet')}`}
              </button>
              <button
                className="wo-sync-btn wo-sync-pull"
                onClick={handleOpenPull}
                disabled={syncing}
              >
                {`\u2193 ${t(lang, 'pullFromSheet')}`}
              </button>
              {selectedRoute && orderName && (
                <span className="wo-sync-tab-preview">
                  {t(lang, 'tab')}: {buildTabName(selectedRoute, orderName, orderDate)}
                </span>
              )}
            </div>
          )}

          <div className="wo-search">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t(lang, 'searchProducts')}
            />
            {search && <button id="btn-clear-search" className="wo-clear-search" onClick={() => setSearch('')}>{t(lang, 'clear')}</button>}
          </div>

          <div className="wo-grid-wrapper">
            <table className="wo-grid">
              <thead>
                <tr>
                  <th className="wo-col-idx">{t(lang, 'idx')}</th>
                  <th className="wo-col-sku">{t(lang, 'sku')}</th>
                  <th className="wo-col-desc">{t(lang, 'product')}</th>
                  <th className="wo-col-type">{t(lang, 'type')}</th>
                  <th className="wo-col-upc">{t(lang, 'uic')}</th>
                  <th className="wo-col-price">{t(lang, 'cost')}</th>
                  <th className="wo-col-cases">{t(lang, 'cases')}</th>
                  <th className="wo-col-units">{t(lang, 'orderUnits')}</th>
                  <th className="wo-col-total">{t(lang, 'total')}</th>
                </tr>
                <tr className="wo-totals-row">
                  <td className="wo-totals-label"></td>
                  <td colSpan="4" className="wo-totals-label">{t(lang, 'totals')}</td>
                  <td className="wo-totals-val">{totals.totalUnits > 0 ? `$${(totals.totalGross / totals.totalUnits).toFixed(2)}` : ''}</td>
                  <td className="wo-totals-val">{totals.totalCases || ''}</td>
                  <td className="wo-totals-val">{totals.totalUnits || ''}</td>
                  <td className="wo-totals-val">{totals.totalGross > 0 ? `$${totals.totalGross.toFixed(2)}` : ''}</td>
                </tr>
              </thead>
                {(() => {
                  let rowIdx = 0;
                  return PRODUCT_CATEGORIES.map(cat => {
                  const products = grouped[cat] || [];
                  if (products.length === 0) return null;
                  const isCollapsed = collapsed[cat];
                  const catCases = products.reduce((sum, p) => sum + (cases[p.sku] || 0), 0);
                  return (
                    <tbody key={cat}>
                      <tr className="wo-cat-row" onClick={() => toggleCat(cat)}>
                        <td colSpan="6" className="wo-cat-name">
                          <span className="wo-cat-arrow">{isCollapsed ? '\u25b6' : '\u25bc'}</span>
                          {cat}
                        </td>
                        <td className="wo-cat-total">{catCases > 0 ? catCases : ''}</td>
                        <td colSpan="2"></td>
                      </tr>
                      {!isCollapsed && products.map(p => {
                        rowIdx++;
                        const qty = cases[p.sku] || 0;
                        const unitQty = units[p.sku] || 0;
                        const allUnits = (qty * p.upc) + unitQty;
                        const total = allUnits * p.price;
                        const hasQty = qty > 0 || unitQty > 0;
                        return (
                          <tr key={p.sku} className={`wo-product-row ${hasQty ? 'wo-has-qty' : ''}`}>
                            <td className="wo-col-idx">{rowIdx}</td>
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
                });
                })()}
            </table>
          </div>

          <div className="wo-summary">
            <span><strong>{totals.totalCases}</strong> {t(lang, 'cases').toLowerCase()}</span>
            <span><strong>{totals.totalUnits}</strong> {lang === 'es' ? 'unidades' : 'units'}</span>
            <span><strong>${totals.totalGross.toFixed(2)}</strong> {t(lang, 'gross')}</span>
            <button
              id="btn-save-order-bottom"
              className="wo-save-btn"
              onClick={handleSave}
              disabled={!selectedRoute || totals.totalCases === 0 || saving}
            >
              {saving ? t(lang, 'saving') : existingOrder ? t(lang, 'updateOrder') : t(lang, 'saveOrder')}
            </button>
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="wo-queue">
          {queueOrders.length === 0 ? (
            <div className="wo-empty">{t(lang, 'noOrdersYet')}</div>
          ) : (
            <table className="wo-queue-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'route')}</th>
                  <th>{t(lang, 'name')}</th>
                  <th>{t(lang, 'items')}</th>
                  <th>{t(lang, 'cases')}</th>
                  <th>{t(lang, 'grossDollar')}</th>
                  <th>{t(lang, 'whInv')}</th>
                  <th>{t(lang, 'driverLoad')}</th>
                  <th>{t(lang, 'verify')}</th>
                  <th>{t(lang, 'status')}</th>
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
                      }}>{t(lang, 'edit')}</button>
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
                      }}>{t(lang, 'delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="wo-history">
          <div className="wo-history-header">
            <h3>{t(lang, 'orderHistory')}</h3>
            <div className="wo-history-actions">
              {hasSpreadsheetId() && (
                <a
                  href={getSpreadsheetUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wo-open-sheet-btn"
                >
                  {lang === 'es' ? 'Abrir Google Sheet' : 'Open Google Sheet'} &#x2197;
                </a>
              )}
              {sheetsConfigured && (
                <button
                  className="wo-sync-btn wo-sync-pull"
                  onClick={loadHistoryTabs}
                  disabled={historyLoading}
                >
                  {historyLoading ? t(lang, 'syncing') : `\u21bb ${lang === 'es' ? 'Cargar ordenes' : 'Load Orders'}`}
                </button>
              )}
            </div>
          </div>

          {historyError && (
            <div className="wo-sync-msg wo-sync-error" style={{ marginBottom: 10 }}>{historyError}</div>
          )}

          {/* Google Sheet tabs grouped by route/driver */}
          {historyGrouped.length > 0 ? (
            historyGrouped.map(group => (
              <div key={`${group.route}-${group.driver}`} className="wo-history-driver">
                <h3 className="wo-history-driver-name">
                  {group.driver} <span className="wo-history-route">{t(lang, 'route')} {group.route}</span>
                </h3>
                <table className="wo-history-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'date')}</th>
                      <th>{lang === 'es' ? 'Pestana' : 'Sheet Tab'}</th>
                      <th>{lang === 'es' ? 'App' : 'App'}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tabs.map(entry => {
                      const localOrder = orders.find(o => o.sheetTab === entry.tabName || (o.routeNumber === group.route && o.name === group.driver && o.date && entry.date.includes(o.date.split('-').slice(1).map(s => parseInt(s,10)).join('/'))));
                      return (
                        <tr key={entry.tabName}>
                          <td>{entry.date}</td>
                          <td>
                            {tabSheetIds[entry.tabName] != null ? (
                              <a
                                href={getSheetTabUrl(tabSheetIds[entry.tabName])}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="wo-match-badge wo-sheet-link"
                                title={`Open "${entry.tabName}" in Google Sheets`}
                              >
                                {entry.tabName} &#x2197;
                              </a>
                            ) : (
                              <span className="wo-match-badge">{entry.tabName}</span>
                            )}
                          </td>
                          <td>
                            {localOrder
                              ? <span className="wo-match-badge">{t(lang, 'uploaded')}</span>
                              : <span style={{ color: '#999' }}>-</span>
                            }
                          </td>
                          <td className="wo-queue-actions">
                            <button
                              className="wo-sync-btn-sm"
                              onClick={() => handlePullTab(entry.tabName)}
                              disabled={syncing}
                              title={`Pull "${entry.tabName}" into form`}
                            >
                              {`\u2193 ${t(lang, 'pullFromSheet')}`}
                            </button>
                            <button onClick={() => {
                              handleRouteChange(group.route);
                              setOrderName(group.driver);
                              // Parse date from tab
                              const dp = entry.date.split('/');
                              if (dp.length === 3) {
                                const yr = parseInt(dp[2], 10);
                                const fullYr = yr < 100 ? 2000 + yr : yr;
                                setOrderDate(`${fullYr}-${String(dp[0]).padStart(2,'0')}-${String(dp[1]).padStart(2,'0')}`);
                              }
                              setTab('entry');
                            }}>
                              {t(lang, 'edit')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          ) : historyTabs.length === 0 && !historyLoading ? (
            <div className="wo-not-connected">
              {!hasSpreadsheetId() ? (
                <>
                  <div className="wo-not-connected-icon">&#x26A0;</div>
                  <h3>{lang === 'es' ? 'No conectado' : 'Not Connected'}</h3>
                  <p>{lang === 'es'
                    ? 'No se ha configurado el Spreadsheet ID. Vaya a ajustes (icono de engranaje) y pegue el ID o URL del Google Sheet.'
                    : 'No Spreadsheet ID configured. Go to settings (gear icon) and paste the Google Sheet ID or URL.'}</p>
                  <button className="wo-tab wo-tab-settings" onClick={() => setShowSettings(true)}>
                    {lang === 'es' ? 'Abrir Ajustes' : 'Open Settings'}
                  </button>
                </>
              ) : !sheetsConfigured ? (
                <>
                  <div className="wo-not-connected-icon" style={{ color: '#34a853' }}>&#x2714;</div>
                  <h3>{lang === 'es' ? 'Sheet configurado' : 'Sheet Configured'}</h3>
                  <p>{lang === 'es'
                    ? 'Use el boton "Abrir Google Sheet" arriba para ver ordenes en su navegador.'
                    : 'Use the "Open Google Sheet" button above to view orders in your browser.'}</p>
                </>
              ) : (
                <>
                  <div className="wo-not-connected-icon">&#x1F4CB;</div>
                  <h3>{lang === 'es' ? 'Sin historial' : 'No History'}</h3>
                  <p>{lang === 'es' ? 'Presione "Cargar ordenes" para ver historial.' : 'Click "Load Orders" to see order history.'}</p>
                </>
              )}
            </div>
          ) : null}

          {/* Local orders not yet on sheets */}
          {(() => {
            const localOnly = orders.filter(o => o.status !== 'synced');
            if (localOnly.length === 0) return null;
            return (
              <div className="wo-history-driver" style={{ marginTop: 16 }}>
                <h3 className="wo-history-driver-name">{lang === 'es' ? 'Ordenes locales (no subidas)' : 'Local Orders (not uploaded)'}</h3>
                <table className="wo-history-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'date')}</th>
                      <th>{t(lang, 'route')}</th>
                      <th>{t(lang, 'name')}</th>
                      <th>{t(lang, 'cases')}</th>
                      <th>{t(lang, 'grossDollar')}</th>
                      <th>{t(lang, 'status')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {localOnly.sort((a, b) => b.date.localeCompare(a.date)).map(order => (
                      <tr key={order.id}>
                        <td>{order.date}</td>
                        <td><strong>{order.routeNumber}</strong></td>
                        <td>{order.name || '-'}</td>
                        <td>{order.totals?.totalCases || 0}</td>
                        <td>${(order.totals?.totalGross || 0).toFixed(2)}</td>
                        <td><span className={`wo-status wo-status-${order.status}`}>{order.status}</span></td>
                        <td className="wo-queue-actions">
                          <button onClick={() => {
                            setSelectedRoute(order.routeNumber);
                            setOrderDate(order.date);
                            loadExistingOrder(order);
                            setTab('entry');
                          }}>{t(lang, 'edit')}</button>
                          {sheetsConfigured && (
                            <button
                              className="wo-sync-btn-sm"
                              onClick={() => handlePushQueueOrder(order)}
                              disabled={syncing}
                            >{syncing ? '...' : `\u2191 ${t(lang, 'pushToSheet')}`}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* Pull from Sheet modal */}
      {showPullModal && (
        <div className="wo-modal-overlay" onClick={() => setShowPullModal(false)}>
          <div className="wo-modal" onClick={e => e.stopPropagation()}>
            <div className="wo-modal-header">
              <h3>{t(lang, 'pullFromGoogleSheet')}</h3>
              <button className="wo-modal-close" onClick={() => setShowPullModal(false)}>&times;</button>
            </div>
            <p className="wo-modal-desc">{t(lang, 'selectTabToImport')}</p>
            {pullError && (
              <div className="wo-sync-msg wo-sync-error" style={{ marginBottom: 10 }}>
                {pullError}
              </div>
            )}
            {loadingTabs ? (
              <div className="wo-modal-loading">{t(lang, 'loadingTabs')}</div>
            ) : sheetTabs.length === 0 ? (
              <div className="wo-modal-loading">{t(lang, 'noTabsFound')}</div>
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

      {/* Overwrite confirmation modal */}
      {showConfirm && (
        <div className="wo-modal-overlay" onClick={() => setShowConfirm(null)}>
          <div className="wo-modal wo-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="wo-modal-header">
              <h3>{showConfirm.type === 'push' ? t(lang, 'pushConflict') : t(lang, 'pullConflict')}</h3>
              <button className="wo-modal-close" onClick={() => setShowConfirm(null)}>&times;</button>
            </div>
            <p className="wo-modal-desc">
              {showConfirm.type === 'push'
                ? `Tab "${confirmTab}" already has values for ${showConfirm.conflicts.length} item(s) that differ from the form:`
                : `Your form has values for ${showConfirm.conflicts.length} item(s) that differ from the sheet:`}
            </p>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '12px' }}>
              <table className="wo-grid" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th style={{ background: '#dbeafe', color: '#1e40af' }}>{t(lang, 'appForm')}</th>
                    <th style={{ background: '#dcfce7', color: '#166534' }}>{t(lang, 'googleSheet')}</th>
                  </tr>
                </thead>
                <tbody>
                  {showConfirm.conflicts.map(c => (
                    <tr key={c.sku}>
                      <td>{c.sku}</td>
                      <td>{c.desc}</td>
                      <td style={{ background: '#eff6ff', fontWeight: 700 }}>{c.appVal}</td>
                      <td style={{ background: '#f0fdf4', fontWeight: 700 }}>{c.sheetVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="wo-clear-btn" onClick={() => setShowConfirm(null)}>{t(lang, 'cancel')}</button>
              <button
                className="wo-copy-btn"
                style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fbbf24', padding: '10px 20px', fontWeight: 700 }}
                onClick={showConfirm.onMerge}
              >
                3. {t(lang, 'mergeSkipExisting')}
              </button>
              <button
                className="wo-save-btn"
                style={{ marginLeft: 0 }}
                onClick={showConfirm.onOverwrite}
              >
                {showConfirm.type === 'push' ? `1. ${t(lang, 'overwriteSheet')}` : `2. ${t(lang, 'overwriteForm')}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

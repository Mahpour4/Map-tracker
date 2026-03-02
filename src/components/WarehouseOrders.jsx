import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext';
import { t } from '../locales/translations';
import { PRODUCT_CATALOG, PRODUCT_CATEGORIES } from '../data/productCatalog';
import {
  getGoogleClientId, setGoogleClientId,
  getSpreadsheetId, setSpreadsheetId,
  isGoogleSheetsConfigured, isSignedIn, signOut, authenticate,
  pushOrderToSheet, getOrderFromSheet, listSheetTabs, buildTabName, readSheetCases, getSheetTabUrl, getSpreadsheetUrl, hasSpreadsheetId, createTemplateCopy, renameSheetTab, updateRouteSummarySheet,
} from '../services/googleSheetsService';
import {
  getWhatsAppStatus, getWhatsAppGroups, getOrderMessages,
  dismissMessages, setOrderGroup, getOrderGroup,
  getWaContacts, setWaContact, removeWaContact, sendWhatsAppMessage,
  fetchWhatsAppHistory,
} from '../services/whatsappService';

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
  const { state, addWarehouseOrder, updateWarehouseOrder, deleteWarehouseOrder, setWarehouseOrders, setLanguage, setInventory } = useApp();
  const { warehouseOrders, stores, language, inventory } = state;
  const lang = language || 'en';
  const orders = warehouseOrders?.orders || [];

  // Check if an order's items have been deducted from inventory
  const getOrderInvStatus = useCallback((order) => {
    if (!inventory?.items || !order?.id || !order?.items?.length) return { applied: false, matched: 0, total: 0, units: 0, details: [] };
    const invItems = inventory.items;
    let matched = 0;
    let units = 0;
    const details = [];
    order.items.forEach(item => {
      const rawSku = item.sku.replace(/^0+/, '');
      const invItem = invItems[rawSku] || invItems[item.sku];
      if (!invItem) return;
      const deductions = invItem.orderDeductions || {};
      // Check for line-level deduction (orderId:lineId) or legacy order-level (orderId)
      let itemUnits = 0;
      const lineKey = item.lineId ? `${order.id}:${item.lineId}` : null;
      if (lineKey && deductions[lineKey]) {
        itemUnits = deductions[lineKey].units || deductions[lineKey];
      } else if (deductions[order.id]) {
        // Legacy format: orderId → units (number) or orderId → {units}
        const d = deductions[order.id];
        itemUnits = typeof d === 'number' ? d : (d.units || 0);
      }
      if (itemUnits > 0) {
        matched++;
        units += itemUnits;
        details.push({ sku: item.sku, lineId: item.lineId, desc: item.desc, units: itemUnits });
      }
    });
    return { applied: matched > 0, matched, total: order.items.length, units, details };
  }, [inventory?.items]);

  // Merge static catalog with custom entries from inventory
  const FULL_CATALOG = useMemo(() => {
    const custom = inventory?.customCatalog || [];
    if (custom.length === 0) return PRODUCT_CATALOG;
    // Dedupe: custom entries override static ones with same SKU
    const staticSkus = new Set(PRODUCT_CATALOG.map(p => p.sku));
    const newItems = custom.filter(c => !staticSkus.has(c.sku));
    return [...PRODUCT_CATALOG, ...newItems];
  }, [inventory?.customCatalog]);

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
  const [statsRange, setStatsRange] = useState('all');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [lastAutoSaved, setLastAutoSaved] = useState(null);
  const autoSaveRef = useRef(null);
  const executePushRef = useRef(null); // avoids forward-reference issue (executePush defined after handleSave)
  const pendingWaPush = useRef(null); // items to auto-push to sheets after WhatsApp order creation

  // Sync time indicators
  const [lastLocalSaved, setLastLocalSaved] = useState(() => localStorage.getItem('wo_last_local_saved'));
  const [lastGithubSaved, setLastGithubSaved] = useState(() => localStorage.getItem('wo_last_github_saved'));
  const [lastSheetsPushed, setLastSheetsPushed] = useState(null);

  // WhatsApp inbox state
  const [waMessages, setWaMessages] = useState([]);
  const [waContacts, setWaContacts] = useState({});
  const [waGroups, setWaGroups] = useState([]);
  const [waOrderGroupId, setWaOrderGroupId] = useState(null);
  const [waStatus, setWaStatus] = useState('offline');
  const [waLastPoll, setWaLastPoll] = useState(0);
  const [waSyncing, setWaSyncing] = useState(false);
  const [waEditContact, setWaEditContact] = useState(null); // { phone, name, route }
  const [waShowSetup, setWaShowSetup] = useState(false);
  const [waPeriod, setWaPeriod] = useState('all');
  const [waRefreshing, setWaRefreshing] = useState(false);
  const [waNote, setWaNote] = useState(''); // original WhatsApp message for reference
  const waPollerRef = useRef(null);

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
  // Queue: sheet orders list
  const [queueSheetTabs, setQueueSheetTabs] = useState(null); // null = not loaded, [] = loaded
  const [queueSheetLoading, setQueueSheetLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSheetTabs, setArchivedSheetTabs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('archivedSheetTabs') || '[]'); } catch { return []; }
  });

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
    console.log('[WO] loadExistingOrder called:', {
      route: order.routeNumber,
      date: order.date,
      name: order.name,
      itemCount: (order.items || []).length,
      items: order.items,
    });
    const c = {};
    const u = {};
    (order.items || []).forEach(item => {
      if (item.cases > 0) c[item.sku] = item.cases;
      if (item.orderUnits > 0) u[item.sku] = item.orderUnits;
    });
    console.log('[WO] Setting cases:', c, '| units:', u);
    setCases(c);
    setUnits(u);
    setOrderName(order.name || '');
    setInvoiceNumber(order.invoiceNumber || '');
    setInvoiceCases(order.invoiceCases || '');
    setInvoiceAmount(order.invoiceAmount || '');
    setLoadNumber(order.loadNumber || '');
    setLoadCases(order.loadCases || '');
    setLoadAmount(order.loadAmount || '');
    setWaNote(order.waOriginalMessage || '');
  }, []);

  // When route/date changes, load existing order and auto-create template copy
  const handleRouteChange = useCallback((r) => {
    setSelectedRoute(r);
    const info = ROUTE_INFO[r];
    const driverName = info?.driver || '';
    const existing = orders.find(o => o.routeNumber === r && o.date === orderDate);
    if (existing) loadExistingOrder(existing);
    else { setCases({}); setUnits({}); setOrderName(driverName); setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount(''); setLoadNumber(''); setLoadCases(''); setLoadAmount(''); }

    // Template copy on Google Sheet is only triggered by explicit "Push to Sheet" action
  }, [orders, orderDate, loadExistingOrder]);

  const handleDateChange = useCallback((d) => {
    setOrderDate(d);
    const existing = orders.find(o => o.routeNumber === selectedRoute && o.date === d);
    if (existing) loadExistingOrder(existing);
    else { setCases({}); setUnits({}); setOrderName(''); setInvoiceNumber(''); setInvoiceCases(''); setInvoiceAmount(''); setLoadNumber(''); setLoadCases(''); setLoadAmount(''); }
  }, [orders, selectedRoute, loadExistingOrder]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return FULL_CATALOG;
    const q = search.toLowerCase();
    return FULL_CATALOG.filter(p =>
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
    let totalCases = 0, totalUnits = 0, totalCost = 0, totalGross = 0;
    // Get all SKUs that have cases or units
    const allSkus = new Set([...Object.keys(cases), ...Object.keys(units)]);
    allSkus.forEach(sku => {
      const product = FULL_CATALOG.find(p => p.sku === sku);
      if (product) {
        const caseQty = cases[sku] || 0;
        const unitQty = units[sku] || 0;
        if (caseQty > 0 || unitQty > 0) {
          totalCases += caseQty;
          const caseUnits = caseQty * product.upc;
          totalUnits += caseUnits + unitQty;
          totalCost += (caseUnits + unitQty) * product.price;
          totalGross += (caseUnits + unitQty) * (product.retail || product.price);
        }
      }
    });
    return { totalCases, totalUnits, totalCost, totalGross };
  }, [cases, units]);

  // Stats computations
  const statsData = useMemo(() => {
    // Filter orders by date range
    const now = new Date();
    const filtered = orders.filter(o => {
      if (statsRange === 'all') return true;
      const d = new Date(o.date);
      const days = statsRange === '7' ? 7 : statsRange === '30' ? 30 : 90;
      return (now - d) / 86400000 <= days;
    });

    if (filtered.length === 0) return null;

    // Overview
    let oCases = 0, oCost = 0, oRevenue = 0, oUnits = 0;
    filtered.forEach(o => {
      oCases += o.totals?.totalCases || 0;
      oUnits += o.totals?.totalUnits || 0;
      oCost += o.totals?.totalCost || 0;
      oRevenue += o.totals?.totalGross || 0;
    });
    const overview = {
      totalOrders: filtered.length,
      totalCases: oCases,
      totalUnits: oUnits,
      totalCost: oCost,
      totalRevenue: oRevenue,
      grossProfit: oRevenue - oCost,
      avgCasesPerOrder: filtered.length > 0 ? Math.round(oCases / filtered.length) : 0,
    };

    // Top products
    const prodMap = {};
    filtered.forEach(o => {
      (o.items || []).forEach(item => {
        if (!prodMap[item.sku]) prodMap[item.sku] = { sku: item.sku, desc: item.desc, category: item.category, cases: 0, units: 0, cost: 0, revenue: 0, orderCount: 0 };
        prodMap[item.sku].cases += item.cases || 0;
        prodMap[item.sku].units += item.units || 0;
        prodMap[item.sku].cost += (item.units || 0) * (item.price || 0);
        const cat = FULL_CATALOG.find(p => p.sku === item.sku);
        prodMap[item.sku].revenue += (item.units || 0) * (cat?.retail || item.price || 0);
        prodMap[item.sku].orderCount += 1;
      });
    });
    const topProducts = Object.values(prodMap).sort((a, b) => b.cases - a.cases);

    // Route breakdown
    const routeMap = {};
    filtered.forEach(o => {
      const r = o.routeNumber || 'Unknown';
      if (!routeMap[r]) routeMap[r] = { route: r, driver: ROUTE_DRIVERS[r] || o.name || '-', orders: 0, cases: 0, units: 0, revenue: 0, cost: 0, dates: [] };
      routeMap[r].orders += 1;
      routeMap[r].cases += o.totals?.totalCases || 0;
      routeMap[r].units += o.totals?.totalUnits || 0;
      routeMap[r].revenue += o.totals?.totalGross || 0;
      routeMap[r].cost += o.totals?.totalCost || 0;
      if (o.date) routeMap[r].dates.push(o.date);
    });
    const routeBreakdown = Object.values(routeMap).sort((a, b) => b.cases - a.cases).map(r => ({
      ...r,
      avgCases: r.orders > 0 ? Math.round(r.cases / r.orders) : 0,
      lastOrder: r.dates.sort().reverse()[0] || '-',
    }));

    // Category mix
    const catMap = {};
    filtered.forEach(o => {
      (o.items || []).forEach(item => {
        const c = item.category || 'Other';
        if (!catMap[c]) catMap[c] = { category: c, cases: 0, units: 0, cost: 0, revenue: 0 };
        catMap[c].cases += item.cases || 0;
        catMap[c].units += item.units || 0;
        catMap[c].cost += (item.units || 0) * (item.price || 0);
        const cat = FULL_CATALOG.find(p => p.sku === item.sku);
        catMap[c].revenue += (item.units || 0) * (cat?.retail || item.price || 0);
      });
    });
    const categoryMix = Object.values(catMap).sort((a, b) => b.cases - a.cases).map(c => ({
      ...c,
      pct: oCases > 0 ? (c.cases / oCases * 100) : 0,
      margin: c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue * 100) : 0,
    }));

    // Route favorites (top 5 products per route)
    const routeFavs = {};
    filtered.forEach(o => {
      const r = o.routeNumber || 'Unknown';
      if (!routeFavs[r]) routeFavs[r] = { route: r, driver: ROUTE_DRIVERS[r] || o.name || '-', products: {} };
      (o.items || []).forEach(item => {
        if (!routeFavs[r].products[item.sku]) routeFavs[r].products[item.sku] = { sku: item.sku, desc: item.desc, cases: 0 };
        routeFavs[r].products[item.sku].cases += item.cases || 0;
      });
    });
    const routeFavorites = Object.values(routeFavs).map(r => ({
      ...r,
      top5: Object.values(r.products).sort((a, b) => b.cases - a.cases).slice(0, 5),
    })).sort((a, b) => a.route.localeCompare(b.route));

    // Order frequency per route
    const orderFrequency = Object.values(routeMap).map(r => {
      const sorted = r.dates.sort();
      let avgDays = 0;
      if (sorted.length > 1) {
        let totalDays = 0;
        for (let i = 1; i < sorted.length; i++) {
          totalDays += (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
        }
        avgDays = Math.round(totalDays / (sorted.length - 1));
      }
      const lastDate = sorted[sorted.length - 1];
      const daysSince = lastDate ? Math.round((now - new Date(lastDate)) / 86400000) : null;
      return { route: r.route, driver: r.driver, orders: r.orders, avgDays, lastOrder: lastDate || '-', daysSince };
    }).sort((a, b) => a.route.localeCompare(b.route));

    // Order Forecasting — uses ALL orders (not filtered) for prediction accuracy
    const forecast = (() => {
      if (orders.length < 2) return null;
      const now2 = new Date();

      // Per-route forecast
      const routeForecasts = Object.entries(routeMap).map(([route, data]) => {
        const sorted = [...data.dates].sort();
        const driver = data.driver;

        // Avg days between orders
        let avgDays = 0;
        if (sorted.length > 1) {
          let total = 0;
          for (let i = 1; i < sorted.length; i++) {
            total += (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
          }
          avgDays = Math.round(total / (sorted.length - 1));
        }

        // Predicted next order date
        const lastDate = sorted[sorted.length - 1];
        const predictedDate = lastDate && avgDays > 0
          ? new Date(new Date(lastDate).getTime() + avgDays * 86400000)
          : null;
        const daysSince = lastDate ? Math.round((now2 - new Date(lastDate)) / 86400000) : null;
        const daysUntil = predictedDate ? Math.round((predictedDate - now2) / 86400000) : null;
        const isOverdue = daysUntil !== null && daysUntil < 0;
        const isDueSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 2;

        // Suggested order — avg cases per product across orders for this route
        const routeOrders = orders.filter(o => o.routeNumber === route);
        const prodTotals = {};
        routeOrders.forEach(o => {
          (o.items || []).forEach(item => {
            if (!prodTotals[item.sku]) prodTotals[item.sku] = { sku: item.sku, desc: item.desc, category: item.category, totalCases: 0, count: 0 };
            if (item.cases > 0) {
              prodTotals[item.sku].totalCases += item.cases;
              prodTotals[item.sku].count += 1;
            }
          });
        });
        const suggestedItems = Object.values(prodTotals)
          .filter(p => p.count > 0)
          .map(p => ({ ...p, avgCases: Math.round(p.totalCases / p.count), frequency: Math.round(p.count / routeOrders.length * 100) }))
          .sort((a, b) => b.avgCases - a.avgCases);

        const suggestedTotalCases = suggestedItems.reduce((sum, p) => sum + p.avgCases, 0);

        return {
          route, driver, avgDays, lastDate, predictedDate,
          daysSince, daysUntil, isOverdue, isDueSoon,
          orderCount: routeOrders.length,
          suggestedItems, suggestedTotalCases,
        };
      }).sort((a, b) => {
        // Sort: overdue first, then due soon, then by days until
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        if (a.isDueSoon && !b.isDueSoon) return -1;
        if (!a.isDueSoon && b.isDueSoon) return 1;
        return (a.daysUntil || 999) - (b.daysUntil || 999);
      });

      // Weekly demand — total expected cases in the next 7 days
      const weeklyDemand = {};
      routeForecasts.forEach(rf => {
        if (rf.daysUntil !== null && rf.daysUntil <= 7) {
          rf.suggestedItems.forEach(item => {
            if (!weeklyDemand[item.sku]) weeklyDemand[item.sku] = { sku: item.sku, desc: item.desc, category: item.category, cases: 0, routes: [] };
            weeklyDemand[item.sku].cases += item.avgCases;
            weeklyDemand[item.sku].routes.push(rf.route);
          });
        }
      });
      const weeklyItems = Object.values(weeklyDemand).sort((a, b) => b.cases - a.cases);
      const weeklyTotalCases = weeklyItems.reduce((sum, p) => sum + p.cases, 0);

      return { routeForecasts, weeklyItems, weeklyTotalCases };
    })();

    // Restock Planner — usage this week + projected reorder with 10% buffer
    const restock = (() => {
      if (orders.length === 0) return null;
      const now3 = new Date();
      const weekAgo = new Date(now3.getTime() - 7 * 86400000);
      const twoWeeksAgo = new Date(now3.getTime() - 14 * 86400000);

      // This week's usage (last 7 days)
      const thisWeekOrders = orders.filter(o => new Date(o.date) >= weekAgo);
      const lastWeekOrders = orders.filter(o => {
        const d = new Date(o.date);
        return d >= twoWeeksAgo && d < weekAgo;
      });

      // Aggregate usage per product
      const usageMap = {};
      const addUsage = (orderList, key) => {
        orderList.forEach(o => {
          (o.items || []).forEach(item => {
            if (!usageMap[item.sku]) {
              usageMap[item.sku] = { sku: item.sku, desc: item.desc, category: item.category, thisWeek: 0, lastWeek: 0, projected: 0, reorder: 0 };
            }
            const totalUnits = (item.cases || 0) * (item.upc || 1) + (item.units || 0);
            usageMap[item.sku][key] += item.cases || 0;
          });
        });
      };
      addUsage(thisWeekOrders, 'thisWeek');
      addUsage(lastWeekOrders, 'lastWeek');

      // Calculate weekly avg across ALL history for better projection
      const allWeeks = {};
      orders.forEach(o => {
        const weekNum = Math.floor((now3 - new Date(o.date)) / (7 * 86400000));
        (o.items || []).forEach(item => {
          if (!allWeeks[item.sku]) allWeeks[item.sku] = {};
          if (!allWeeks[item.sku][weekNum]) allWeeks[item.sku][weekNum] = 0;
          allWeeks[item.sku][weekNum] += item.cases || 0;
        });
      });

      // Projected = avg weekly usage; Reorder = projected * 1.10
      Object.keys(usageMap).forEach(sku => {
        const weeks = allWeeks[sku] || {};
        const weekValues = Object.values(weeks);
        const avgWeekly = weekValues.length > 0 ? weekValues.reduce((a, b) => a + b, 0) / weekValues.length : 0;
        usageMap[sku].projected = Math.round(avgWeekly * 10) / 10;
        usageMap[sku].reorder = Math.ceil(avgWeekly * 1.10);
        usageMap[sku].trend = usageMap[sku].thisWeek > usageMap[sku].lastWeek ? 'up' : usageMap[sku].thisWeek < usageMap[sku].lastWeek ? 'down' : 'flat';
      });

      const items = Object.values(usageMap)
        .filter(p => p.thisWeek > 0 || p.projected > 0)
        .sort((a, b) => b.reorder - a.reorder);

      const totalThisWeek = items.reduce((s, p) => s + p.thisWeek, 0);
      const totalReorder = items.reduce((s, p) => s + p.reorder, 0);

      // Group by category
      const byCategory = {};
      items.forEach(item => {
        const cat = item.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = { category: cat, thisWeek: 0, reorder: 0, items: 0 };
        byCategory[cat].thisWeek += item.thisWeek;
        byCategory[cat].reorder += item.reorder;
        byCategory[cat].items += 1;
      });
      const categories = Object.values(byCategory).sort((a, b) => b.reorder - a.reorder);

      return { items, categories, totalThisWeek, totalReorder, thisWeekOrderCount: thisWeekOrders.length };
    })();

    return { overview, topProducts, routeBreakdown, categoryMix, routeFavorites, orderFrequency, forecast, restock };
  }, [orders, statsRange]);

  // ── Print Pick Sheet PDF ────────────────────────────────────────────────────
  const printPickSheet = useCallback(() => {
    const doc = new jsPDF('portrait', 'mm', 'letter');
    const pw = doc.internal.pageSize.getWidth();
    const fmtMoney = (n) => `$${n.toFixed(2)}`;
    const fmtDate = (iso) => {
      const [y, m, d] = iso.split('-');
      return `${parseInt(m)}/${parseInt(d)}/${y ? y.slice(-2) : ''}`;
    };
    const dateDisplay = fmtDate(orderDate);
    const ri = ROUTE_INFO[selectedRoute] || {};
    const driverName = orderName || ri.driver || '—';

    // === Cover Page — Order History Log ===
    const routeHistory = (warehouseOrders?.orders || [])
      .filter(o => o.routeNumber === selectedRoute)
      .sort((a, b) => a.date.localeCompare(b.date));

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(`Route ${selectedRoute} — ${driverName}`, pw / 2, 16, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('Order History Log', pw / 2, 23, { align: 'center' });

    const historyRows = routeHistory.map(o => {
      const isCurrent = o.date === orderDate && (o.invoiceNumber || '') === (invoiceNumber || '');
      return {
        data: [
          fmtDate(o.date),
          o.invoiceNumber || '—',
          o.invoiceCases || '—',
          o.invoiceAmount ? fmtMoney(parseFloat(o.invoiceAmount) || 0) : '—',
          o.loadNumber || '—',
          o.loadCases || '—',
          o.loadAmount ? fmtMoney(parseFloat(o.loadAmount) || 0) : '—',
        ],
        isCurrent,
      };
    });

    const histTotals = routeHistory.reduce((acc, o) => {
      acc.invCases += parseFloat(o.invoiceCases) || 0;
      acc.invAmt   += parseFloat(o.invoiceAmount) || 0;
      acc.ldCases  += parseFloat(o.loadCases) || 0;
      acc.ldAmt    += parseFloat(o.loadAmount) || 0;
      return acc;
    }, { invCases: 0, invAmt: 0, ldCases: 0, ldAmt: 0 });

    autoTable(doc, {
      startY: 28,
      head: [['Date', 'Invoice #', 'WH Cases', 'WH Amount', 'Load #', 'DRV Cases', 'DRV Amount']],
      body: [
        ...historyRows.map(r => r.data),
        ['TOTAL', '', String(histTotals.invCases), fmtMoney(histTotals.invAmt), '', String(histTotals.ldCases), fmtMoney(histTotals.ldAmt)],
      ],
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'right' },
        5: { halign: 'center' },
        6: { halign: 'right' },
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const rowIndex = data.row.index;
        if (rowIndex < historyRows.length && historyRows[rowIndex].isCurrent) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [219, 234, 254];
        }
        if (rowIndex === historyRows.length) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [243, 244, 246];
        }
      },
    });

    // === Pick Sheet starts on new page ===
    doc.addPage();

    // === Header ===
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('PICK SHEET', pw / 2, 14, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    let y = 22;

    // Order info row
    const infoItems = [
      `Route: ${selectedRoute}`,
      `Driver: ${orderName || ri.driver || '—'}`,
      `Date: ${dateDisplay}`,
    ];
    if (ri.custNum) infoItems.push(`Cust#: ${ri.custNum}`);
    doc.text(infoItems.join('    |    '), pw / 2, y, { align: 'center' });
    y += 5;

    // Invoice / Load info
    const invParts = [];
    if (invoiceNumber) invParts.push(`Invoice#: ${invoiceNumber}`);
    if (invoiceCases) invParts.push(`Inv Cases: ${invoiceCases}`);
    if (invoiceAmount) invParts.push(`Inv Amt: ${fmtMoney(parseFloat(invoiceAmount) || 0)}`);
    if (loadNumber) invParts.push(`Load#: ${loadNumber}`);
    if (loadCases) invParts.push(`Load Cases: ${loadCases}`);
    if (loadAmount) invParts.push(`Load Amt: ${fmtMoney(parseFloat(loadAmount) || 0)}`);
    if (invParts.length > 0) {
      doc.setFontSize(8);
      doc.text(invParts.join('    |    '), pw / 2, y, { align: 'center' });
      y += 4;
    }

    // Separator line
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(10, y, pw - 10, y);
    y += 3;

    // === Build items table — only items with qty > 0, grouped by category ===
    const tableBody = [];
    let globalIdx = 0;
    PRODUCT_CATEGORIES.forEach(cat => {
      const products = FULL_CATALOG.filter(p => p.category === cat);
      const catItems = products.filter(p => (cases[p.sku] || 0) > 0 || (units[p.sku] || 0) > 0);
      if (catItems.length === 0) return;

      // Category header row
      const catCases = catItems.reduce((s, p) => s + (cases[p.sku] || 0), 0);
      tableBody.push({
        content: [cat.toUpperCase(), '', '', '', '', String(catCases), '', ''],
        isCatHeader: true,
      });

      catItems.forEach(p => {
        globalIdx++;
        const qty = cases[p.sku] || 0;
        const unitQty = units[p.sku] || 0;
        const allUnits = (qty * p.upc) + unitQty;
        const cost = allUnits * p.price;
        const retail = allUnits * (p.retail || p.price);
        tableBody.push({
          content: [
            String(globalIdx),
            p.sku,
            p.desc,
            String(p.upc),
            String(qty),
            unitQty > 0 ? String(unitQty) : '',
            fmtMoney(cost),
            fmtMoney(retail),
          ],
          isCatHeader: false,
        });
      });
    });

    if (tableBody.length === 0) {
      doc.setFontSize(12);
      doc.text('No items to pick.', pw / 2, y + 10, { align: 'center' });
      doc.save(`PickSheet_${selectedRoute}_${orderDate}.pdf`);
      return;
    }

    // Checkbox column for picking
    autoTable(doc, {
      startY: y,
      head: [['#', 'Item #', 'Product', 'UPC', 'Cases', 'Units', 'Cost', 'Retail', '\u2610']],
      body: tableBody.map(row => [...row.content, '']),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.2 },
      headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },    // #
        1: { cellWidth: 18, halign: 'center' },   // Item #
        2: { cellWidth: 'auto' },                  // Product
        3: { cellWidth: 14, halign: 'center' },    // UPC
        4: { cellWidth: 16, halign: 'center' },    // Cases
        5: { cellWidth: 14, halign: 'center' },    // Units
        6: { cellWidth: 20, halign: 'right' },     // Cost
        7: { cellWidth: 20, halign: 'right' },     // Retail
        8: { cellWidth: 12, halign: 'center' },    // Checkbox
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const row = tableBody[data.row.index];
        if (row && row.isCatHeader) {
          data.cell.styles.fillColor = [220, 220, 220];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize = 8;
          if (data.column.index === 0) {
            data.cell.colSpan = 4;
          }
          if (data.column.index > 0 && data.column.index < 4) {
            data.cell.text = [];
          }
        }
      },
    });

    // === Summary footer ===
    const finalY = doc.lastAutoTable.finalY + 4;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(10, finalY, pw - 10, finalY);

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    const summaryY = finalY + 6;
    const summaryText = `Total Cases: ${totals.totalCases}    |    Total Units: ${totals.totalUnits}    |    Cost: ${fmtMoney(totals.totalCost)}    |    Retail: ${fmtMoney(totals.totalGross)}`;
    doc.text(summaryText, pw / 2, summaryY, { align: 'center' });

    // Picked-by / notes section
    const notesY = summaryY + 10;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text('Picked by: ___________________________', 14, notesY);
    doc.text(`Date/Time: ___________________________`, pw / 2 + 5, notesY);
    doc.text('Notes: ________________________________________________________________________________', 14, notesY + 8);

    // Save
    const fileName = `PickSheet_${selectedRoute}_${orderName ? orderName.replace(/\s+/g, '') : 'order'}_${orderDate}.pdf`;
    doc.save(fileName);
  }, [selectedRoute, orderName, orderDate, cases, units, totals, invoiceNumber, invoiceCases, invoiceAmount, loadNumber, loadCases, loadAmount, warehouseOrders]);

  // Save order
  const handleSave = useCallback(async () => {
    if (!selectedRoute) return;
    setSaving(true);
    const allSkus = new Set([...Object.keys(cases), ...Object.keys(units)]);
    // Build map of existing lineIds by SKU so we preserve them on update
    const existingLineIds = {};
    if (existingOrder?.items) {
      existingOrder.items.forEach(i => { if (i.lineId) existingLineIds[i.sku] = i.lineId; });
    }
    const items = [...allSkus]
      .filter(sku => (cases[sku] || 0) > 0 || (units[sku] || 0) > 0)
      .map(sku => {
        const qty = cases[sku] || 0;
        const unitQty = units[sku] || 0;
        const p = FULL_CATALOG.find(pr => pr.sku === sku);
        const caseUnits = qty * (p?.upc || 0);
        const allUnits = caseUnits + unitQty;
        return {
          lineId: existingLineIds[sku] || uuidv4(),
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
      // Inventory sold is auto-reconciled from all orders in Inventory.jsx
    }

    // Optimistically update local/GitHub timestamps (AppContext will do the actual saves momentarily)
    const now = new Date().toISOString();
    localStorage.setItem('wo_last_local_saved', now);
    localStorage.setItem('wo_last_github_saved', now);
    setLastLocalSaved(now);
    setLastGithubSaved(now);

    setSaving(false);
  }, [selectedRoute, orderDate, orderName, invoiceNumber, invoiceCases, invoiceAmount, loadNumber, loadCases, loadAmount, cases, units, totals, existingOrder, addWarehouseOrder, updateWarehouseOrder, inventory, setInventory]);

  // Auto-save every 30 seconds when there are unsaved changes
  useEffect(() => {
    autoSaveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedRoute && (totals.totalCases > 0 || totals.totalUnits > 0)) {
        autoSaveRef.current();
        setLastAutoSaved(new Date());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedRoute, totals.totalCases, totals.totalUnits]);

  // Poll localStorage for local/GitHub save timestamps every 5s
  useEffect(() => {
    const poll = setInterval(() => {
      setLastLocalSaved(localStorage.getItem('wo_last_local_saved'));
      setLastGithubSaved(localStorage.getItem('wo_last_github_saved'));
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  // WhatsApp inbox — always poll every 5s regardless of active tab
  const pollWaInbox = useCallback(async () => {
    try {
      const [statusRes, msgs, contacts, groupId] = await Promise.all([
        getWhatsAppStatus(),
        getOrderMessages(0),
        getWaContacts(),
        getOrderGroup(),
      ]);
      setWaStatus(statusRes.status || 'offline');
      setWaMessages(prev => {
        const uiState = {};
        prev.forEach(m => {
          const flags = {};
          Object.keys(m).forEach(k => { if (k.startsWith('_')) flags[k] = m[k]; });
          if (Object.keys(flags).length) uiState[m.id] = flags;
        });
        return msgs.map(m => uiState[m.id] ? { ...m, ...uiState[m.id] } : m);
      });
      setWaContacts(contacts);
      setWaOrderGroupId(groupId);
      setWaLastPoll(Date.now());
    } catch { /* service offline */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => { if (!cancelled) await pollWaInbox(); };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollWaInbox]);

  const handleWaSync = useCallback(async () => {
    setWaSyncing(true);
    await pollWaInbox();
    setWaSyncing(false);
  }, [pollWaInbox]);

  // Load WhatsApp groups when setup is opened
  useEffect(() => {
    if (!waShowSetup) return;
    getWhatsAppGroups().then(g => setWaGroups(g)).catch(() => {});
  }, [waShowSetup]);

  // Filter messages by period, then group by phone number
  const waFiltered = useMemo(() => {
    if (waPeriod === 'all') return waMessages;
    const now = Date.now();
    const ms = { '24h': 24*60*60*1000, '2d': 2*24*60*60*1000, '7d': 7*24*60*60*1000, '30d': 30*24*60*60*1000 }[waPeriod] || 0;
    if (!ms) return waMessages;
    return waMessages.filter(m => m.timestamp > now - ms);
  }, [waMessages, waPeriod]);

  const waGrouped = useMemo(() => {
    const groups = {};
    waFiltered.forEach(m => {
      if (!groups[m.from]) groups[m.from] = [];
      groups[m.from].push(m);
    });
    // Sort each group by timestamp desc
    Object.values(groups).forEach(arr => arr.sort((a, b) => b.timestamp - a.timestamp));
    return groups;
  }, [waFiltered]);

  const handleAssignContact = async (phone) => {
    if (!waEditContact) return;
    await setWaContact(phone, waEditContact.name, waEditContact.route);
    setWaContacts(prev => ({ ...prev, [phone]: { name: waEditContact.name, route: waEditContact.route } }));
    setWaEditContact(null);
  };

  const handleDismiss = async (ids) => {
    await dismissMessages(ids);
    setWaMessages(prev => prev.filter(m => !ids.includes(m.id)));
  };

  // Guess order from WhatsApp message text
  const [waGuessResult, setWaGuessResult] = useState(null); // { msgId, items: [{ qty, text, matches: [{ sku, desc, category, score }] }] }

  // Helper: score a search phrase against the catalog
  const scoreCatalog = (text, searchTerms) => {
    const textLower = text.toLowerCase();
    const textWords = textLower.split(/\s+/).filter(w => w.length > 1);

    return searchTerms.map(p => {
      const descLower = p.desc.toLowerCase();
      const catLower = p.category.toLowerCase();
      const typeLower = (p.type || '').toLowerCase();
      let score = 0;

      // Exact full match
      if (descLower === textLower) score += 200;
      // Full text found in desc
      if (descLower.includes(textLower)) score += 100;

      // Each search word that matches desc, category, or type
      let descHits = 0;
      textWords.forEach(tw => {
        if (descLower.includes(tw)) { score += 30; descHits++; }
        if (catLower.includes(tw)) score += 20;
        if (typeLower.includes(tw)) score += 15;
      });
      // Bonus when ALL search words match the description (strong signal)
      if (textWords.length > 1 && descHits === textWords.length) score += 50;

      // Category size hints
      if (textLower.includes('large') && catLower.includes('large')) score += 25;
      if (textLower.includes('small') && catLower.includes('small')) score += 25;
      if (textLower.includes('4.79') && catLower.includes('4.79')) score += 30;
      if (textLower.includes('2.49') && catLower.includes('2.49')) score += 30;
      if (textLower.includes('.50') && catLower.includes('.50')) score += 30;

      return { sku: p.sku, desc: p.desc, category: p.category, upc: p.upc, score };
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  };

  const guessOrder = useCallback((msg) => {
    if (!msg.body) return;
    const lines = msg.body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const results = [];

    // Build search index from catalog
    const searchTerms = FULL_CATALOG.map(p => {
      const words = (p.desc + ' ' + p.category + ' ' + p.type).toLowerCase();
      return { ...p, words };
    });

    // Category detection patterns
    let activeCategory = null;
    const categoryPatterns = [
      { pattern: /50[\s.]*cent|50\s*¢/i, category: '.50 Cents' },
      { pattern: /^\.50\b/i, category: '.50 Cents' },
      { pattern: /\b1[\s.]*49\b/i, category: '2.49 Products' }, // 1.49 = Deep River pricing, same tier
      { pattern: /\b2[\s.]*49\b/i, category: '2.49 Products' },
      { pattern: /\b4[\s.]*79\b/i, category: '4.79 Products' },
      { pattern: /deep\s*river\s*small/i, category: 'Deep River Small' },
      { pattern: /deep\s*river\s*large/i, category: 'Deep River Large' },
      { pattern: /crunch\s*time/i, category: 'Crunch Time' },
      { pattern: /candy/i, category: 'Candy' },
      { pattern: /snacks?/i, category: 'Snacks' },
      { pattern: /smoothie/i, category: 'Smoothies' },
      { pattern: /salsa|dip/i, category: 'Salsa & Dips' },
      { pattern: /variety/i, category: 'Variety Packs' },
    ];

    // Inline price prefix: ".50 honey bbq 4", "1.49 deep river mesquite BBQ 3", ".50 golden original1"
    // Matches: ".50 ...", "1.49 ...", "4.79 ..." — price then product text, optional trailing qty (with or without space)
    const inlinePriceRe = /^(\.\d{2}|\d+\.\d{2})\s+([a-zA-Z].+?)(?:\s+(\d+)|(\d+))?\s*$/;

    for (const line of lines) {
      // 1) Try inline price format FIRST: ".50 honey bbq 4", "1.49 mesquite BBQ 3"
      const inlineMatch = line.match(inlinePriceRe);
      if (inlineMatch) {
        const priceStr = inlineMatch[1]; // ".50" or "1.49" or "4.79"
        const inlineCat = categoryPatterns.find(cp => cp.pattern.test(priceStr));
        const productText = inlineMatch[2].trim();
        // Handle "total 4" at end — strip "total" and grab the number
        const totalMatch = productText.match(/^(.+?)\s+total\s*$/i);
        const cleanText = totalMatch ? totalMatch[1].trim() : productText;
        const inlineQty = parseInt(inlineMatch[3] || inlineMatch[4]) || 1;
        if (cleanText) {
          const terms = inlineCat
            ? searchTerms.filter(p => p.category === inlineCat.category)
            : searchTerms;
          let scored = scoreCatalog(cleanText, terms);
          if (scored.length === 0 && inlineCat) scored = scoreCatalog(cleanText, searchTerms);
          if (scored.length === 1) { scored[0].qty = inlineQty; scored[0].checked = true; }
          else if (scored.length > 1 && scored[0].score >= scored[1].score * 1.5) { scored[0].qty = inlineQty; scored[0].checked = true; }
          results.push({ qty: inlineQty, text: cleanText, matches: scored, loadAll: false, category: inlineCat?.category || null });
          continue;
        }
      }

      // 2) Check if this line is a category header (standalone, not a product line)
      //    e.g. "Order 50.cent", "2.49", "4.79:", ".50 Cents", "Snack"
      const qtyMatch = line.match(/^(\d+)\s*(?:each|ea|x|cs|cases?)?\s+(.+)$/i);
      const catMatch = categoryPatterns.find(cp => cp.pattern.test(line));
      if (catMatch && (!qtyMatch || qtyMatch[2].trim().length <= 8)) {
        activeCategory = catMatch.category;
        continue;
      }

      // 3) Try standard qty format: "25 onion ring", "4 each deep river large"
      const match = qtyMatch;
      if (!match) continue;

      const qty = parseInt(match[1]);
      let text = match[2].trim();
      if (qty <= 0 || !text) continue;

      // Check for price suffix like "BBQ DIPSY 50¢" or "PUFF 50 cent" — strip and use as category
      let lineCategory = activeCategory;
      const suffixMatch = text.match(/\s+(\d*\.?\d+\s*¢)\s*$/i) || text.match(/\s+(\d*\.?\d+\s*cents?)\s*$/i);
      if (suffixMatch) {
        text = text.slice(0, suffixMatch.index).trim();
        const priceSuffix = suffixMatch[1]; // "50¢" or "50 cent"
        const suffixCat = categoryPatterns.find(cp => cp.pattern.test(priceSuffix));
        if (suffixCat) lineCategory = suffixCat.category;
      }

      // When a category header is active, prefer products in that category
      // but always include strong matches from the full catalog
      const scoreFn = (t) => {
        const allResults = scoreCatalog(t, searchTerms);
        if (!lineCategory) return allResults;
        // Boost category matches, but keep strong full-catalog matches too
        const catResults = scoreCatalog(t, searchTerms.filter(p => p.category === lineCategory));
        catResults.forEach(cr => { cr.score += 50; }); // boost category matches
        const merged = new Map();
        [...allResults, ...catResults].forEach(m => {
          const existing = merged.get(m.sku);
          if (!existing || m.score > existing.score) merged.set(m.sku, m);
        });
        return [...merged.values()].sort((a, b) => b.score - a.score);
      };

      // Split on "and" to handle "deep river large and small bags"
      const andParts = text.split(/\s+and\s+/i);
      let matches;
      let loadAll = false;
      if (andParts.length > 1) {
        const firstPart = andParts[0].trim();
        const firstWords = firstPart.split(/\s+/);
        const firstMatches = scoreFn(firstPart);
        const secondPart = andParts.slice(1).join(' and ').trim();
        let bestSecondMatches = scoreFn(secondPart);
        for (let i = 0; i < firstWords.length; i++) {
          const prefix = firstWords.slice(0, firstWords.length - i).join(' ');
          const combined = prefix + ' ' + secondPart;
          const candidateMatches = scoreFn(combined);
          if (candidateMatches.length > bestSecondMatches.length ||
              (candidateMatches.length > 0 && candidateMatches[0].score > (bestSecondMatches[0]?.score || 0))) {
            bestSecondMatches = candidateMatches;
          }
        }
        const allMatches = new Map();
        [...firstMatches, ...bestSecondMatches].forEach(m => {
          const existing = allMatches.get(m.sku);
          if (!existing || m.score > existing.score) allMatches.set(m.sku, m);
        });
        matches = [...allMatches.values()].sort((a, b) => b.score - a.score);
        loadAll = true;
      } else {
        matches = scoreFn(text);
        loadAll = matches.length > 3;
      }

      // Auto-assign qty to the best match when there's a clear winner
      if (matches.length === 1) {
        matches[0].qty = qty;
        matches[0].checked = true;
      } else if (matches.length > 1) {
        const best = matches[0];
        const second = matches[1];
        if (best.score >= second.score * 1.5) {
          best.qty = qty;
          best.checked = true;
        }
      }

      results.push({ qty, text, matches, loadAll, category: lineCategory });
    }

    setWaGuessResult({ msgId: msg.id, items: results, _msgBody: msg.body || '' });
  }, []);

  const loadGuessIntoForm = (contactRoute) => {
    if (!waGuessResult) return;
    if (contactRoute) setSelectedRoute(contactRoute);
    const newCases = { ...cases };
    // Load all checked items with their individual quantities
    waGuessResult.items.forEach(item => {
      item.matches.forEach(match => {
        if (match.checked) {
          const qty = match.qty ?? item.qty;
          newCases[match.sku] = (newCases[match.sku] || 0) + qty;
        }
      });
    });
    setCases(newCases);
    setTab('entry');
    setWaGuessResult(null);
  };

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
    const product = FULL_CATALOG.find(p => p.sku === sku);
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
        invoiceNumber,
        invoiceCases,
        invoiceAmount,
        loadNumber,
        loadCases,
        loadAmount,
        items: itemsToWrite,
      });

      if (result.success) {
        setLastSheetsPushed(new Date().toISOString());
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
  }, [selectedRoute, orderDate, orderName, invoiceNumber, invoiceCases, invoiceAmount, loadNumber, loadCases, loadAmount, existingOrder, updateWarehouseOrder, orders]);

  // Keep executePushRef current so handleSave can call it without a forward-reference
  useEffect(() => { executePushRef.current = executePush; }, [executePush]);

  // Auto-push to Sheets after WhatsApp order creation (once state has settled)
  useEffect(() => {
    if (!pendingWaPush.current || !selectedRoute || !executePushRef.current) return;
    const itemsToWrite = pendingWaPush.current;
    pendingWaPush.current = null;
    executePushRef.current(itemsToWrite);
  }, [selectedRoute, orderName, cases]);

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
          const skuPad = item.sku.padStart(6, '0');
          const prod = FULL_CATALOG.find(p => p.sku === item.sku || p.sku === skuPad);
          conflicts.push({ sku: item.sku, desc: prod?.desc || item.sku, category: prod?.category || '', price: prod?.price || 0, sheetVal, appVal: item.cases });
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
        invoiceNumber: order.invoiceNumber,
        invoiceCases: order.invoiceCases,
        invoiceAmount: order.invoiceAmount,
        loadNumber: order.loadNumber,
        loadCases: order.loadCases,
        loadAmount: order.loadAmount,
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
  }, [updateWarehouseOrder, orders]);

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
    // Clear form state before loading new order data
    setCases({});
    setUnits({});
    setInvoiceNumber('');
    setInvoiceCases('');
    setInvoiceAmount('');
    setLoadNumber('');
    setLoadCases('');
    setLoadAmount('');

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

      // Apply sheet data (form was already cleared above)
      setCases(sheetItems);
      if (result.invoiceNumber) setInvoiceNumber(result.invoiceNumber);
      if (result.invoiceCases)  setInvoiceCases(result.invoiceCases);
      if (result.invoiceAmount) setInvoiceAmount(result.invoiceAmount);
      if (result.loadNumber)    setLoadNumber(result.loadNumber);
      if (result.loadCases)     setLoadCases(result.loadCases);
      if (result.loadAmount)    setLoadAmount(result.loadAmount);
      setSyncMsg({ type: 'success', text: `Pulled ${result.items?.length || 0} items from "${tabName}"` });
      setShowPullModal(false);
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    }
    setSyncing(false);
  }, []);

  // Parse a sheet tab name into { route, driver, date, tabName }
  // Supports: "200 Jose Nunez 2/26/26", "200 Jose 2.26.26", "Eastern shore 2.26.26", "Eastern shore 2/26/26"
  const parseTabName = useCallback((tabName) => {
    if (/^template$/i.test(tabName.trim())) return null;
    // Date pattern: M/DD/YY or M.DD.YY or M-DD-YY
    const datePattern = /(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})$/;
    const dateMatch = tabName.match(datePattern);
    if (!dateMatch) return null;
    const date = dateMatch[1].replace(/\./g, '/').replace(/-/g, '/');
    const prefix = tabName.slice(0, dateMatch.index).trim();
    // Check if prefix starts with a 3-digit route number
    const routeMatch = prefix.match(/^(\d{3})\s+(.+)$/);
    if (routeMatch) {
      return { route: routeMatch[1], driver: routeMatch[2].trim(), date, tabName };
    }
    // No route number — use the prefix as driver/name, try to find route
    if (prefix) {
      const foundRoute = Object.entries(ROUTE_INFO).find(([, info]) =>
        info.driver && prefix.toLowerCase().includes(info.driver.toLowerCase())
      );
      return { route: foundRoute ? foundRoute[0] : '—', driver: prefix, date, tabName };
    }
    return null;
  }, []);

  // Check if a tab name matches standard format: "200 Jose Nunez 2/26/26"
  const isStandardFormat = useCallback((tabName) => {
    return /^\d{3}\s+.+?\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(tabName);
  }, []);

  // Build the correct standard tab name from parsed data
  const buildStandardName = useCallback((parsed) => {
    if (!parsed || parsed.route === '—') return null;
    const info = ROUTE_INFO[parsed.route];
    const driver = info?.driver || parsed.driver;
    return `${parsed.route} ${driver} ${parsed.date}`;
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

  // Rename a sheet tab to standard format
  const handleFixTabName = useCallback(async (entry, parsed) => {
    const sheetId = tabSheetIds[entry.tabName];
    if (sheetId == null) return;
    const standard = buildStandardName(parsed);
    if (!standard || standard === entry.tabName) return;
    try {
      setSyncMsg({ type: 'success', text: `Renaming "${entry.tabName}" → "${standard}"...` });
      await renameSheetTab(sheetId, standard);
      setSyncMsg({ type: 'success', text: `Renamed to "${standard}"` });
      setTimeout(() => setSyncMsg(null), 3000);
      loadHistoryTabs();
    } catch (err) {
      setSyncMsg({ type: 'error', text: `Rename failed: ${err.message}` });
    }
  }, [tabSheetIds, buildStandardName, loadHistoryTabs]);

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

  // Load all sheet tabs for queue display
  const loadQueueSheetTabs = useCallback(async () => {
    if (!isGoogleSheetsConfigured()) return;
    setQueueSheetLoading(true);
    try {
      const result = await listSheetTabs();
      if (result.success) {
        const allTabs = result.tabs || [];
        const parsed = allTabs
          .map(name => parseTabName(name))
          .filter(Boolean);
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
        setQueueSheetTabs(parsed);
      }
    } catch (err) {
      console.error('Failed to load sheet tabs:', err);
    }
    setQueueSheetLoading(false);
  }, [parseTabName]);

  // Auto-load sheet tabs when queue tab is opened
  useEffect(() => {
    if (tab === 'queue' && isGoogleSheetsConfigured() && queueSheetTabs === null) {
      loadQueueSheetTabs();
    }
  }, [tab, loadQueueSheetTabs, queueSheetTabs]);

  const isSetupComplete = settingsRole && hasSpreadsheetId() && isSignedIn();

  // Gate: show setup screen if role or sheet not configured
  // Setup state for sign-in step
  const [setupSigningIn, setSetupSigningIn] = useState(false);
  const [setupSignInError, setSetupSignInError] = useState('');

  if (!isSetupComplete) {
    const step2Done = hasSpreadsheetId() && (settingsRole === 'worker' ? !!workerName : true);
    const step3Done = isSignedIn();

    const handleSetupSignIn = async () => {
      setSetupSigningIn(true);
      setSetupSignInError('');
      try {
        // Save config first
        if (settingsRole === 'worker') {
          localStorage.setItem('wo_worker_name', workerName);
          setSpreadsheetId(spreadsheetId);
        } else {
          setGoogleClientId(clientId);
          setSpreadsheetId(spreadsheetId);
        }
        await authenticate();
        setSetupSigningIn(false);
      } catch (err) {
        setSetupSigningIn(false);
        setSetupSignInError(err.message || 'Sign in failed');
      }
    };

    return (
      <div className="wo-page">
        <div className="wo-setup-gate">
          <div className="wo-setup-card">
            <h2>{lang === 'es' ? 'Configuracion Inicial' : 'First Time Setup'}</h2>

            {/* Step 1: Pick role */}
            <div className={`wo-setup-step ${settingsRole ? 'wo-setup-done' : 'wo-setup-active'}`}>
              <div className="wo-setup-step-num">{settingsRole ? '\u2714' : '1'}</div>
              <div className="wo-setup-step-content">
                <h3>{lang === 'es' ? '¿Quien eres?' : 'Who are you?'}</h3>
                {!settingsRole ? (
                  <div className="wo-role-options">
                    <button className="wo-role-btn wo-role-worker" onClick={() => { setSettingsRole('worker'); localStorage.setItem('wo_role', 'worker'); }}>
                      <span className="wo-role-icon">&#x1F477;</span>
                      <span className="wo-role-name">{lang === 'es' ? 'Trabajador' : 'Worker'}</span>
                      <span className="wo-role-desc">{lang === 'es' ? 'Crear y editar ordenes' : 'Create & edit orders'}</span>
                    </button>
                    <button className="wo-role-btn wo-role-admin" onClick={() => { setSettingsRole('admin'); localStorage.setItem('wo_role', 'admin'); }}>
                      <span className="wo-role-icon">&#x1F4BC;</span>
                      <span className="wo-role-name">{lang === 'es' ? 'Admin / Dueño' : 'Owner / Admin'}</span>
                      <span className="wo-role-desc">{lang === 'es' ? 'Control total' : 'Full control'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="wo-setup-selected">
                    <span>{settingsRole === 'worker' ? '\u{1F477}' : '\u{1F4BC}'} {settingsRole === 'worker' ? (lang === 'es' ? 'Trabajador' : 'Worker') : (lang === 'es' ? 'Admin' : 'Admin')}</span>
                    <button className="wo-role-change" onClick={() => { setSettingsRole(''); localStorage.removeItem('wo_role'); }}>
                      {lang === 'es' ? 'Cambiar' : 'Change'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Enter details */}
            {settingsRole && (
              <div className={`wo-setup-step ${step2Done ? 'wo-setup-done' : 'wo-setup-active'}`}>
                <div className="wo-setup-step-num">{step2Done ? '\u2714' : '2'}</div>
                <div className="wo-setup-step-content">
                  {settingsRole === 'worker' ? (
                    <>
                      <h3>{lang === 'es' ? 'Tu informacion' : 'Your Info'}</h3>
                      <p className="wo-settings-desc">{lang === 'es' ? 'Pide el link del Google Sheet a tu admin.' : 'Ask your admin for the Google Sheet link.'}</p>
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
                      <label className="wo-settings-label" style={{ marginTop: 8 }}>
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
                          placeholder={lang === 'es' ? 'Pegar link del Google Sheet' : 'Paste Google Sheet link here'}
                          className="wo-settings-url"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <h3>{lang === 'es' ? 'Conexion' : 'Connection'}</h3>
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
                      </label>
                      <label className="wo-settings-label" style={{ marginTop: 8 }}>
                        {t(lang, 'oauthClientId')}
                        <input
                          type="text"
                          value={clientId}
                          onChange={e => setClientIdState(e.target.value)}
                          placeholder="xxxx.apps.googleusercontent.com"
                          className="wo-settings-url"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Sign in with Google */}
            {settingsRole && step2Done && (
              <div className={`wo-setup-step ${step3Done ? 'wo-setup-done' : 'wo-setup-active'}`}>
                <div className="wo-setup-step-num">{step3Done ? '\u2714' : '3'}</div>
                <div className="wo-setup-step-content">
                  <h3>{lang === 'es' ? 'Iniciar sesion con Google' : 'Sign in with Google'}</h3>
                  <p className="wo-settings-desc">
                    {lang === 'es'
                      ? 'Solo necesitas hacer esto una vez. Conecta tu cuenta de Google para crear y editar ordenes.'
                      : 'You only need to do this once. Connect your Google account to create and edit orders.'}
                  </p>
                  {step3Done ? (
                    <div style={{ color: '#34a853', fontWeight: 600, fontSize: '0.9rem' }}>
                      &#x2714; {lang === 'es' ? 'Conectado — listo!' : 'Connected — ready!'}
                    </div>
                  ) : (
                    <>
                      <button
                        className="wo-google-signin-btn"
                        onClick={handleSetupSignIn}
                        disabled={setupSigningIn}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 8 }}>
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        {setupSigningIn
                          ? (lang === 'es' ? 'Conectando...' : 'Connecting...')
                          : (lang === 'es' ? 'Iniciar sesion con Google' : 'Sign in with Google')}
                      </button>
                      {setupSignInError && (
                        <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 6 }}>{setupSignInError}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Language toggle at bottom */}
            <button
              className="wo-lang-toggle"
              style={{ marginTop: 20 }}
              onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}
            >
              <span className="wo-lang-flag">
                {language === 'en' ? (
                  <svg viewBox="0 0 60 40" width="28" height="19">
                    <rect width="60" height="20" fill="#FCD116"/>
                    <rect y="20" width="60" height="10" fill="#003893"/>
                    <rect y="30" width="60" height="10" fill="#CE1126"/>
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wo-page">
      <div className="wo-header">
        <div className="wo-header-top">
          <h2>{t(lang, 'warehouseOrders')}</h2>
          <div className="wo-header-right">
            <button
              className="wo-lang-toggle"
              onClick={() => setLanguage(language === 'en' ? 'es' : 'en')}
              title={language === 'en' ? 'Cambiar a Español' : 'Switch to English'}
            >
              <span className="wo-lang-flag">
                {language === 'en' ? (
                  <svg viewBox="0 0 60 40" width="24" height="16">
                    <rect width="60" height="20" fill="#FCD116"/>
                    <rect y="20" width="60" height="10" fill="#003893"/>
                    <rect y="30" width="60" height="10" fill="#CE1126"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 60 40" width="24" height="16">
                    <rect width="60" height="40" fill="#fff"/>
                    <rect width="60" height="5.7" fill="#B22234"/>
                    <rect y="7.7" width="60" height="5.7" fill="#B22234"/>
                    <rect y="15.4" width="60" height="5.7" fill="#B22234"/>
                    <rect y="23.1" width="60" height="5.7" fill="#B22234"/>
                    <rect y="30.8" width="60" height="5.7" fill="#B22234"/>
                    <rect width="24" height="21.5" fill="#3C3B6E"/>
                    <g fill="#fff">{[...Array(5)].map((_,r)=>[...Array(6)].map((_,c)=><circle key={`${r}${c}`} cx={2+c*4} cy={2+r*4.3} r="1"/>))}{[...Array(4)].map((_,r)=>[...Array(5)].map((_,c)=><circle key={`s${r}${c}`} cx={4+c*4} cy={4.15+r*4.3} r="1"/>))}</g>
                  </svg>
                )}
              </span>
              <span className="wo-lang-label">{language === 'en' ? 'ES' : 'EN'}</span>
            </button>
            <button
              className={`wo-header-btn ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="Google Sheets Settings"
            >
              {sheetsConfigured ? '\u2601' : '\u2699'}
            </button>
            <button
              className={`wo-header-btn ${isAdmin ? 'wo-header-btn-admin' : ''}`}
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
              {isAdmin ? '\uD83D\uDD13' : '\uD83D\uDD12'}
            </button>
          </div>
        </div>
        <div className="wo-nav">
          <button className={`wo-nav-btn ${tab === 'entry' ? 'active' : ''}`} onClick={() => setTab('entry')}>
            <span className="wo-nav-icon">{'\u{1F4CB}'}</span> {t(lang, 'orderEntry')}
          </button>
          <button className={`wo-nav-btn ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
            <span className="wo-nav-icon">{'\u{1F4E6}'}</span> {t(lang, 'orderQueue')} <span className="wo-nav-badge">{orders.length}</span>
          </button>
          <button className={`wo-nav-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => { setTab('history'); if (isGoogleSheetsConfigured()) loadHistoryTabs(); }}>
            <span className="wo-nav-icon">{'\u{1F4C5}'}</span> {t(lang, 'driverHistory')}
          </button>
          <button className={`wo-nav-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
            <span className="wo-nav-icon">{'\u{1F4CA}'}</span> {t(lang, 'stats')}
          </button>
        </div>
      </div>

      {/* Combined sync bar: timestamps left, latest message right */}
      {(() => {
        const fmtTime = (iso) => {
          if (!iso) return 'Never';
          try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
          catch { return 'Never'; }
        };
        return (
          <div className="wo-sync-bar">
            <span className="wo-sync-bar-item">
              <span className="wo-sync-bar-label">Local:</span>
              <span className={`wo-sync-bar-time ${lastLocalSaved ? 'ok' : 'never'}`}>{fmtTime(lastLocalSaved)}</span>
            </span>
            <span className="wo-sync-bar-sep">|</span>
            <span className="wo-sync-bar-item">
              <span className="wo-sync-bar-label">GitHub:</span>
              <span className={`wo-sync-bar-time ${lastGithubSaved ? 'ok' : 'never'}`}>{fmtTime(lastGithubSaved)}</span>
            </span>
            <span className="wo-sync-bar-sep">|</span>
            <span className="wo-sync-bar-item">
              <span className="wo-sync-bar-label">Sheets:</span>
              <span className={`wo-sync-bar-time ${lastSheetsPushed ? 'ok' : 'never'}`}>{fmtTime(lastSheetsPushed)}</span>
            </span>
            {syncMsg && (
              <>
                <span className="wo-sync-bar-sep">|</span>
                <span className={`wo-sync-bar-msg wo-sync-bar-msg-${syncMsg.type}`}>
                  {syncMsg.text}
                </span>
                <button className="wo-sync-bar-close" onClick={() => setSyncMsg(null)}>&times;</button>
              </>
            )}
          </div>
        );
      })()}

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
                  <span className="wo-role-desc">{lang === 'es' ? 'Crear y editar ordenes' : 'Create & edit orders'}</span>
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
              setWaNote('');
            }}>{t(lang, 'clear')}</button>
            <button
              id="btn-save-order-top"
              className="wo-save-btn"
              onClick={handleSave}
              disabled={!selectedRoute || (totals.totalCases === 0 && totals.totalUnits === 0) || saving}
            >
              {saving ? t(lang, 'saving') : t(lang, 'saveOrder')}
            </button>
            <button
              className="wo-print-btn"
              onClick={printPickSheet}
              disabled={!selectedRoute || (totals.totalCases === 0 && totals.totalUnits === 0)}
              title={t(lang, 'printPickSheet')}
            >
              {t(lang, 'printPickSheet')}
            </button>
            {hasSpreadsheetId() && (
              <a
                href={getSpreadsheetUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="wo-open-sheet-btn wo-open-sheet-toolbar"
                title="Open spreadsheet in Google Sheets"
              >
                {lang === 'es' ? 'Abrir Sheet' : 'Open Sheet'} &#x2197;
              </a>
            )}
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
                      setSelectedRoute(parsed.route);
                      setOrderName(parsed.driver);
                      const dp = parsed.date.split('/');
                      if (dp.length === 3) {
                        const yr = parseInt(dp[2], 10);
                        const fullYr = yr < 100 ? 2000 + yr : yr;
                        setOrderDate(`${fullYr}-${String(dp[0]).padStart(2,'0')}-${String(dp[1]).padStart(2,'0')}`);
                      }
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

          {waNote && (
            <div className="wo-wa-note">
              <div className="wo-wa-note-header">
                <span className="wo-wa-note-icon">💬</span>
                <span className="wo-wa-note-title">Original WhatsApp Message</span>
                <button className="wo-wa-note-close" onClick={() => setWaNote('')}>&times;</button>
              </div>
              <div className="wo-wa-note-body">{waNote}</div>
            </div>
          )}

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
                  <label>{t(lang, 'amount')}<input type="number" step="0.01" value={invoiceAmount || (totals.totalCost > 0 ? totals.totalCost.toFixed(2) : '')} onChange={e => setInvoiceAmount(e.target.value)} placeholder="0.00" /></label>
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

          {/* Sync action bar — admin: push/pull API buttons, worker: open in browser */}

          <div className="wo-search">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t(lang, 'searchProducts')}
            />
            {search && <button id="btn-clear-search" className="wo-clear-search" onClick={() => setSearch('')}>{t(lang, 'clear')}</button>}
          </div>
          <div className="wo-quick-filters">
            {PRODUCT_CATEGORIES.map(cat => {
              const catProducts = FULL_CATALOG.filter(p => p.category === cat);
              const hasItems = catProducts.some(p => (cases[p.sku] || 0) > 0 || (units[p.sku] || 0) > 0);
              const isOpen = collapsed[cat] !== undefined ? !collapsed[cat] : hasItems;
              const shortName = cat.replace(' Products', '').replace(' Small', ' Sm').replace(' Large', ' Lg');
              return (
                <button
                  key={cat}
                  className={`wo-quick-filter${hasItems ? ' wo-qf-active' : ''}${isOpen ? ' wo-qf-open' : ' wo-qf-collapsed'}`}
                  onClick={() => toggleCat(cat)}
                  title={cat}
                >
                  {shortName}
                </button>
              );
            })}
          </div>

          {selectedRoute && (
            <div className="wo-current-order">
              <span className="wo-current-order-dot"></span>
              <strong>{selectedRoute}</strong> &mdash; {orderName || (lang === 'es' ? 'Sin chofer' : 'No driver')} &mdash; {orderDate}
              {sheetsConfigured && (
                <button
                  className="wo-current-order-status wo-current-order-pull-btn"
                  onClick={handleOpenPull}
                  disabled={syncing}
                >
                  {`\u2193 ${t(lang, 'pullFromSheet')}`}
                </button>
              )}
            </div>
          )}

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
                  <td className="wo-totals-val">{totals.totalCost > 0 ? `$${totals.totalCost.toFixed(2)}` : ''}</td>
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
                  const catCases = products.reduce((sum, p) => sum + (cases[p.sku] || 0), 0);
                  const catUnits = products.reduce((sum, p) => sum + (units[p.sku] || 0), 0);
                  const hasAnyItems = catCases > 0 || catUnits > 0;
                  // When searching, force-expand sections with matches; otherwise default collapse empty sections
                  const isCollapsed = search ? false : (collapsed[cat] !== undefined ? collapsed[cat] : !hasAnyItems);
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
                        const retailTotal = allUnits * (p.retail || p.price);
                        const hasQty = qty > 0 || unitQty > 0;
                        return (
                          <tr key={p.sku} className={`wo-product-row ${hasQty ? 'wo-has-qty' : ''}`}>
                            <td className="wo-col-idx">{rowIdx}</td>
                            <td className="wo-col-sku">{p.sku}</td>
                            <td className="wo-col-desc">{p.desc}</td>
                            <td className="wo-col-type">{p.type}</td>
                            <td className="wo-col-upc">{p.upc}</td>
                            <td className="wo-col-price" title={`$${p.price.toFixed(2)}/unit`}>{total > 0 ? `$${total.toFixed(2)}` : ''}</td>
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
                            <td className="wo-col-total">{hasQty ? `$${retailTotal.toFixed(2)}` : ''}</td>
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
            <span><strong>${totals.totalCost.toFixed(2)}</strong> {t(lang, 'cost').toLowerCase()}</span>
            <span><strong>${totals.totalGross.toFixed(2)}</strong> {t(lang, 'gross')}</span>
          </div>
        </div>
      )}

      {tab === 'queue' && (() => {
        // Split local orders into active vs archived
        const activeOrders = queueOrders.filter(o => !o.archived);
        const archivedOrders = queueOrders.filter(o => o.archived);

        // Merge active local orders + sheet-only orders into one list
        const mergedRows = [];
        const matchedSheetTabs = new Set();

        // Add active local orders first
        activeOrders.forEach(order => {
          const tabName = buildTabName(order.routeNumber, order.name, order.date);
          const onSheet = (queueSheetTabs || []).some(st => st.tabName === tabName);
          if (onSheet) matchedSheetTabs.add(tabName);
          mergedRows.push({ type: 'local', order, tabName, onSheet });
        });
        // Also mark archived local orders' tabs as matched
        archivedOrders.forEach(order => {
          const tabName = buildTabName(order.routeNumber, order.name, order.date);
          if ((queueSheetTabs || []).some(st => st.tabName === tabName)) matchedSheetTabs.add(tabName);
        });

        // Archived sheet-only tabs
        const archivedSheetRows = [];

        // Add sheet-only orders (not already local, not archived)
        (queueSheetTabs || []).forEach(st => {
          if (matchedSheetTabs.has(st.tabName)) return;
          if (archivedSheetTabs.includes(st.tabName)) {
            archivedSheetRows.push({ type: 'sheet', sheet: st, tabName: st.tabName });
            return;
          }
          mergedRows.push({ type: 'sheet', sheet: st, tabName: st.tabName });
        });

        // Sort by date descending
        mergedRows.sort((a, b) => {
          const getDate = (row) => {
            if (row.type === 'local') return new Date(row.order.date);
            const p = row.sheet.date.split('/');
            if (p.length === 3) {
              const yr = parseInt(p[2], 10);
              return new Date(yr < 100 ? 2000 + yr : yr, parseInt(p[0], 10) - 1, parseInt(p[1], 10));
            }
            return new Date(0);
          };
          return getDate(b) - getDate(a);
        });

        return (
        <div className="wo-queue">
          <div className="wo-queue-header">
            {sheetsConfigured && (
              <button
                className="wo-sheet-sync-btn"
                onClick={loadQueueSheetTabs}
                disabled={queueSheetLoading}
              >
                {queueSheetLoading ? (lang === 'es' ? 'Sincronizando...' : 'Syncing...') : `\u21BB ${lang === 'es' ? 'Sincronizar con Google Sheets' : 'Sync with Google Sheets'}`}
              </button>
            )}
            {queueOrders.length > 0 && (
              <button
                className="wo-clear-local-btn"
                onClick={() => {
                  if (window.confirm(lang === 'es' ? 'Borrar ordenes locales? Las ordenes en Google Sheets se mantienen.' : 'Clear all local orders? Orders on Google Sheets will remain.')) {
                    setWarehouseOrders({ orders: [], lastSyncedAt: warehouseOrders?.lastSyncedAt || null });
                  }
                }}
              >
                {lang === 'es' ? 'Limpiar Ordenes Locales' : 'Clear Local Orders'}
              </button>
            )}
          </div>

          {mergedRows.length === 0 ? (
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
                  <th>Inv</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mergedRows.map(row => {
                  if (row.type === 'local') {
                    const order = row.order;
                    const invStatus = getOrderInvStatus(order);
                    return (
                      <tr key={order.id} className={`wo-queue-row${row.onSheet ? ' wo-sheet-local' : ''}`}>
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
                          {row.onSheet
                            ? <span className="wo-status wo-status-synced">{lang === 'es' ? 'Sincronizado' : 'Synced'}</span>
                            : <span className="wo-status wo-status-pending">{lang === 'es' ? 'Solo Local' : 'Local Only'}</span>}
                        </td>
                        <td className="wo-inv-status-cell">
                          {invStatus.applied
                            ? <span className="wo-inv-badge wo-inv-applied" title={`${invStatus.units} units deducted from ${invStatus.matched}/${invStatus.total} items`}>{invStatus.matched}/{invStatus.total}</span>
                            : <span className="wo-inv-badge wo-inv-pending" title="Not yet deducted from inventory">--</span>}
                        </td>
                        <td className="wo-queue-actions">
                          <button onClick={() => {
                            setSelectedRoute(order.routeNumber);
                            setOrderDate(order.date);
                            loadExistingOrder(order);
                            setTab('entry');
                          }}>{t(lang, 'edit')}</button>
                          <button className="wo-archive-btn" onClick={() => updateWarehouseOrder({ id: order.id, archived: true })}>
                            {lang === 'es' ? 'Archivar' : 'Archive'}
                          </button>
                          <button className="wo-del-btn" onClick={() => {
                            if (window.confirm(`${lang === 'es' ? 'Borrar orden de ruta' : 'Delete order for route'} ${order.routeNumber}?`)) {
                              deleteWarehouseOrder(order.id);
                            }
                          }}>{t(lang, 'delete')}</button>
                        </td>
                      </tr>
                    );
                  }
                  // Sheet-only row
                  const st = row.sheet;
                  return (
                    <tr key={row.tabName} className="wo-queue-row wo-queue-sheet-only">
                      <td>{st.date}</td>
                      <td><strong>{st.route}</strong></td>
                      <td>{st.driver}</td>
                      <td colSpan="4" className="wo-sheet-tab-name">{st.tabName}</td>
                      <td></td>
                      <td></td>
                      <td><span className="wo-status wo-status-sheet">{lang === 'es' ? 'Google Sheet' : 'On Sheet'}</span></td>
                      <td className="wo-queue-actions">
                        <button
                          onClick={() => {
                            setSelectedRoute(st.route);
                            setOrderName(st.driver);
                            const dp = st.date.split('/');
                            if (dp.length === 3) {
                              const yr = parseInt(dp[2], 10);
                              const fullYr = yr < 100 ? 2000 + yr : yr;
                              setOrderDate(`${fullYr}-${String(dp[0]).padStart(2,'0')}-${String(dp[1]).padStart(2,'0')}`);
                            }
                            handlePullTab(st.tabName);
                            setTab('entry');
                          }}
                        >
                          {lang === 'es' ? 'Cargar' : 'Load'}
                        </button>
                        <button className="wo-archive-btn" onClick={() => {
                          const updated = [...archivedSheetTabs, st.tabName];
                          setArchivedSheetTabs(updated);
                          localStorage.setItem('archivedSheetTabs', JSON.stringify(updated));
                        }}>
                          {lang === 'es' ? 'Archivar' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── Archived Orders ────────────────────────────────────────── */}
          {(archivedOrders.length > 0 || archivedSheetRows.length > 0) && (
            <div className="wo-archived-section">
              <button className="wo-archived-toggle" onClick={() => setShowArchived(prev => !prev)}>
                <span className="wo-cat-arrow">{showArchived ? '\u25bc' : '\u25b6'}</span>
                {lang === 'es' ? 'Archivadas' : 'Archived'} ({archivedOrders.length + archivedSheetRows.length})
              </button>
              {showArchived && (
                <table className="wo-queue-table wo-archived-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'date')}</th>
                      <th>{t(lang, 'route')}</th>
                      <th>{t(lang, 'name')}</th>
                      <th>{t(lang, 'items')}</th>
                      <th>{t(lang, 'cases')}</th>
                      <th>{t(lang, 'grossDollar')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {archivedOrders.map(order => (
                      <tr key={order.id} className="wo-queue-row wo-archived-row">
                        <td>{order.date}</td>
                        <td><strong>{order.routeNumber}</strong></td>
                        <td>{order.name || '-'}</td>
                        <td>{order.items?.length || 0}</td>
                        <td>{order.totals?.totalCases || 0}</td>
                        <td>${(order.totals?.totalGross || 0).toFixed(2)}</td>
                        <td className="wo-queue-actions">
                          <button onClick={() => {
                            setSelectedRoute(order.routeNumber);
                            setOrderDate(order.date);
                            loadExistingOrder(order);
                            setTab('entry');
                          }}>{t(lang, 'edit')}</button>
                          <button className="wo-unarchive-btn" onClick={() => updateWarehouseOrder({ id: order.id, archived: false })}>
                            {lang === 'es' ? 'Restaurar' : 'Restore'}
                          </button>
                          <button className="wo-del-btn" onClick={() => {
                            if (window.confirm(`${lang === 'es' ? 'Borrar orden de ruta' : 'Delete order for route'} ${order.routeNumber}?`)) {
                              deleteWarehouseOrder(order.id);
                            }
                          }}>{t(lang, 'delete')}</button>
                        </td>
                      </tr>
                    ))}
                    {archivedSheetRows.map(row => {
                      const st = row.sheet;
                      return (
                        <tr key={row.tabName} className="wo-queue-row wo-archived-row">
                          <td>{st.date}</td>
                          <td><strong>{st.route}</strong></td>
                          <td>{st.driver}</td>
                          <td colSpan="3" className="wo-sheet-tab-name">{st.tabName}</td>
                          <td className="wo-queue-actions">
                            <button className="wo-unarchive-btn" onClick={() => {
                              const updated = archivedSheetTabs.filter(t => t !== st.tabName);
                              setArchivedSheetTabs(updated);
                              localStorage.setItem('archivedSheetTabs', JSON.stringify(updated));
                            }}>
                              {lang === 'es' ? 'Restaurar' : 'Restore'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── WhatsApp Inbox — always visible ─────────────────────────────── */}
      <div className="wa-inbox">
            <div className="wa-inbox-header">
              <h3>WhatsApp Inbox</h3>
              <div className="wa-inbox-controls">
                <span className={`wa-status-dot wa-status-${waStatus}`} title={waStatus} />
                <span className="wa-status-label">{waStatus === 'connected' ? 'Connected' : waStatus === 'qr-pending' ? 'Scan QR' : 'Offline'}</span>
                {waLastPoll > 0 && (
                  <span className="wa-last-poll" title="Last checked">
                    {waSyncing ? 'Checking...' : `Checked ${new Date(waLastPoll).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                  </span>
                )}
                <select
                  className="wa-period-select"
                  value={waPeriod}
                  onChange={e => setWaPeriod(e.target.value)}
                  title="Filter messages by time period"
                >
                  <option value="24h">Last 24h</option>
                  <option value="2d">Last 2 days</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="all">All</option>
                </select>
                <button
                  className={`wa-sync-now-btn${waSyncing ? ' spinning' : ''}`}
                  onClick={handleWaSync}
                  disabled={waSyncing}
                  title="Sync now"
                >
                  ↻
                </button>
                <button
                  className={`wa-refresh-btn${waRefreshing ? ' spinning' : ''}`}
                  onClick={async () => {
                    setWaRefreshing(true);
                    const result = await fetchWhatsAppHistory(500);
                    if (result.loaded > 0) await pollWaInbox();
                    setWaRefreshing(false);
                  }}
                  disabled={waRefreshing || waStatus !== 'connected'}
                  title="Refresh history from WhatsApp (fetch older messages)"
                >
                  {waRefreshing ? 'Loading...' : 'Refresh History'}
                </button>
                {waMessages.length > 0 && (
                  <button className="wa-dismiss-all" onClick={() => handleDismiss(waMessages.map(m => m.id))}>
                    Clear All ({waMessages.length})
                  </button>
                )}
                <button className="wa-setup-btn" onClick={() => setWaShowSetup(prev => !prev)}>
                  {waShowSetup ? 'Close' : 'Setup'}
                </button>
              </div>
            </div>

            {/* Setup panel — pick order group + manage contacts */}
            {waShowSetup && (
              <div className="wa-setup-panel">
                <div className="wa-setup-row">
                  <label>
                    Order Group:
                    <select
                      value={waOrderGroupId || ''}
                      onChange={async (e) => {
                        const gid = e.target.value;
                        if (gid) {
                          await setOrderGroup(gid);
                          setWaOrderGroupId(gid);
                        }
                      }}
                    >
                      <option value="">Select group...</option>
                      {waGroups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {Object.keys(waContacts).length > 0 && (
                  <div className="wa-contacts-list">
                    <strong>Contacts:</strong>
                    {Object.entries(waContacts).map(([phone, info]) => (
                      <span key={phone} className="wa-contact-chip">
                        {info.name || phone}{info.route ? ` (R${info.route})` : ''}
                        <button onClick={async () => { await removeWaContact(phone); setWaContacts(prev => { const n = { ...prev }; delete n[phone]; return n; }); }}>x</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages grouped by phone */}
            {Object.keys(waGrouped).length === 0 ? (
              <div className="wa-empty">
                {waStatus === 'connected'
                  ? (waOrderGroupId
                    ? (waMessages.length > 0 && waFiltered.length === 0
                      ? `No messages in selected period. ${waMessages.length} total in buffer.`
                      : 'No messages yet. Waiting for orders...')
                    : 'Set up an order group above to start capturing messages.')
                  : 'WhatsApp service is offline. Start the service to receive messages.'}
              </div>
            ) : (
              <div className="wa-phone-groups">
                {Object.entries(waGrouped).map(([phone, msgs]) => {
                  const contact = waContacts[phone];
                  const displayName = contact?.name || msgs[0]?.contactName || phone;
                  const routeNum = contact?.route || msgs[0]?.contactRoute || null;
                  return (
                    <div key={phone} className="wa-phone-group">
                      <div className="wa-phone-header">
                        <div className="wa-phone-info">
                          <strong className="wa-phone-name">{displayName}</strong>
                          {routeNum && <span className="wa-phone-route">Route {routeNum}</span>}
                          <span className="wa-phone-number">{phone}</span>
                          <span className="wa-msg-count">{msgs.length} msg{msgs.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="wa-phone-actions">
                          {!contact && (
                            <button
                              className="wa-assign-btn"
                              onClick={() => setWaEditContact({ phone, name: msgs[0]?.pushName || '', route: '' })}
                            >
                              Assign
                            </button>
                          )}
                          <button className="wa-dismiss-group" onClick={() => handleDismiss(msgs.map(m => m.id))}>
                            Dismiss
                          </button>
                        </div>
                      </div>

                      {/* Assign contact modal inline */}
                      {waEditContact && waEditContact.phone === phone && (
                        <div className="wa-assign-form">
                          <input
                            type="text"
                            placeholder="Name"
                            value={waEditContact.name}
                            onChange={e => setWaEditContact(prev => ({ ...prev, name: e.target.value }))}
                          />
                          <select
                            value={waEditContact.route}
                            onChange={e => setWaEditContact(prev => ({ ...prev, route: e.target.value }))}
                          >
                            <option value="">{t(lang, 'route')}...</option>
                            {routes.map(r => <option key={r} value={r}>{r} - {ROUTE_DRIVERS[r]}</option>)}
                          </select>
                          <button className="wa-assign-save" onClick={() => handleAssignContact(phone)}>{t(lang, 'assignSave')}</button>
                          <button className="wa-assign-cancel" onClick={() => setWaEditContact(null)}>{t(lang, 'assignCancel')}</button>
                        </div>
                      )}

                      {/* Message cards — show 8 most recent */}
                      <div className="wa-messages">
                        {msgs.slice(0, 8).map(m => (
                          <div key={m.id} className="wa-msg-card">
                            <button className="wa-msg-close" onClick={() => handleDismiss([m.id])}>×</button>
                            {m.mediaBase64 && m.mediaType?.startsWith('image/') && (
                              <div className="wa-msg-image">
                                <img src={`data:${m.mediaType};base64,${m.mediaBase64}`} alt="Order" />
                              </div>
                            )}
                            {m.body && <div className="wa-msg-body">{m.body}</div>}
                            <div className="wa-msg-footer">
                              <div className="wa-msg-time">
                                {m.edited && <span className="wa-msg-edited">(edited)</span>}
                                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {' '}
                                {new Date(m.timestamp).toLocaleDateString()}
                              </div>
                              {m.body && (
                                <button className="wa-guess-btn" onClick={() => guessOrder(m)}>
                                  {t(lang, 'guessOrder')}
                                </button>
                              )}
                            </div>
                            <div className="wa-msg-create-order">
                              <select
                                className="wa-msg-route-select"
                                value={m._createRoute ?? routeNum ?? ''}
                                onChange={e => {
                                  setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _createRoute: e.target.value } : msg));
                                }}
                              >
                                <option value="">{t(lang, 'route')}...</option>
                                {routes.map(r => <option key={r} value={r}>{r} - {ROUTE_DRIVERS[r]}</option>)}
                              </select>
                              <button
                                className="wa-msg-create-btn"
                                onClick={async () => {
                                  const route = m._createRoute ?? routeNum ?? '';
                                  if (!route) { alert(t(lang, 'selectARoute')); return; }
                                  const today = new Date().toISOString().split('T')[0];
                                  const name = ROUTE_DRIVERS[route] || displayName;

                                  // Build items from guessed matches
                                  const orderCases = {};
                                  if (waGuessResult && waGuessResult.msgId === m.id) {
                                    waGuessResult.items.forEach(item => {
                                      item.matches.forEach(match => {
                                        if (match.checked && (match.qty ?? 0) > 0) {
                                          orderCases[match.sku] = (orderCases[match.sku] || 0) + match.qty;
                                        }
                                      });
                                    });
                                  }

                                  // Build order items array
                                  const items = Object.entries(orderCases)
                                    .filter(([, qty]) => qty > 0)
                                    .map(([sku, qty]) => {
                                      const p = FULL_CATALOG.find(pr => pr.sku === sku);
                                      const caseUnits = qty * (p?.upc || 0);
                                      return {
                                        lineId: uuidv4(),
                                        sku, category: p?.category || '', desc: p?.desc || '',
                                        cases: qty, orderUnits: 0, upc: p?.upc || 0,
                                        price: p?.price || 0, units: caseUnits,
                                        gross: caseUnits * (p?.price || 0),
                                      };
                                    });

                                  if (items.length === 0) { alert(t(lang, 'noItemsSelected')); return; }

                                  const totalCases = items.reduce((s, i) => s + i.cases, 0);
                                  const totalUnits = items.reduce((s, i) => s + i.units, 0);
                                  const totalGross = items.reduce((s, i) => s + i.gross, 0);

                                  const orderData = {
                                    routeNumber: route, date: today, name,
                                    invoiceNumber: '', invoiceCases: '', invoiceAmount: '',
                                    loadNumber: '', loadCases: '', loadAmount: '',
                                    status: 'pending', source: 'whatsapp', items,
                                    totals: { totalCases, totalUnits, totalGross },
                                    waOriginalMessage: m.body || '',
                                  };

                                  // Save to queue
                                  addWarehouseOrder(orderData);

                                  // Load into form for editing
                                  setSelectedRoute(route);
                                  setOrderName(name);
                                  setOrderDate(today);
                                  setCases(prev => {
                                    const merged = { ...prev };
                                    Object.entries(orderCases).forEach(([sku, qty]) => {
                                      merged[sku] = (merged[sku] || 0) + qty;
                                    });
                                    return merged;
                                  });
                                  setWaNote(m.body || '');
                                  setWaGuessResult(null);
                                  // Auto-push to Sheets
                                  pendingWaPush.current = items;
                                  setTab('entry');
                                }}
                              >
                                {t(lang, 'createOrder')}
                              </button>
                            </div>
                            {/* Reply with pickup time */}
                            <div className="wa-reply-section">
                              {m._replyOpen ? (
                                <div className="wa-reply-panel">
                                  <div className="wa-reply-label">{t(lang, 'readyForPickup')}</div>
                                  <div className="wa-reply-time-btns">
                                    {[
                                      { label: '+30m', min: 30 },
                                      { label: '+45m', min: 45 },
                                      { label: '+1hr', min: 60 },
                                      { label: '+2hr', min: 120 },
                                    ].map(opt => {
                                      const etaTime = new Date(Date.now() + opt.min * 60000);
                                      const timeStr = etaTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                                      return (
                                        <button
                                          key={opt.label}
                                          className={`wa-reply-time-btn ${m._replyTime === timeStr ? 'active' : ''}`}
                                          onClick={() => setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _replyTime: timeStr } : msg))}
                                        >
                                          {opt.label}<span className="wa-reply-time-val">{timeStr}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="wa-reply-send-row">
                                    <input
                                      className="wa-reply-time-input"
                                      value={m._replyTime || ''}
                                      onChange={e => setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _replyTime: e.target.value } : msg))}
                                      placeholder="e.g. 3:30 PM"
                                    />
                                    <button
                                      className="wa-reply-send-btn"
                                      disabled={!m._replyTime || m._replySending}
                                      onClick={async () => {
                                        if (!m._replyTime || !waOrderGroupId) return;
                                        setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _replySending: true } : msg));
                                        try {
                                          const pushName = m.pushName || displayName;
                                          const msg = `@${pushName} your order will be ready for pickup at: *${m._replyTime}*`;
                                          await sendWhatsAppMessage(waOrderGroupId, msg);
                                          setWaMessages(prev => prev.map(msg2 => msg2.id === m.id ? { ...msg2, _replyOpen: false, _replySending: false, _replySent: true, _replyTime: '' } : msg2));
                                        } catch (err) {
                                          alert('Failed to send: ' + err.message);
                                          setWaMessages(prev => prev.map(msg2 => msg2.id === m.id ? { ...msg2, _replySending: false } : msg2));
                                        }
                                      }}
                                    >
                                      {m._replySending ? '...' : t(lang, 'send')}
                                    </button>
                                    <button className="wa-reply-cancel-btn" onClick={() => setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _replyOpen: false, _replyTime: '' } : msg))}>
                                      {t(lang, 'cancel')}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  className="wa-reply-btn"
                                  onClick={() => setWaMessages(prev => prev.map(msg => msg.id === m.id ? { ...msg, _replyOpen: true } : msg))}
                                >
                                  {m._replySent ? `✓ ${t(lang, 'replied')}` : t(lang, 'replyEta')}
                                </button>
                              )}
                            </div>
                            {/* Guess results */}
                            {waGuessResult && waGuessResult.msgId === m.id && (
                              <div className="wa-guess-panel">
                                <div className="wa-guess-header">
                                  <strong>{t(lang, 'orderGuess')}</strong>
                                  <button className="wa-guess-close" onClick={() => setWaGuessResult(null)}>x</button>
                                </div>
                                {waGuessResult.items.length === 0 ? (
                                  <div className="wa-guess-empty">{t(lang, 'noMatch')}</div>
                                ) : (
                                  <>
                                    {waGuessResult.items.map((item, idx) => {
                                      // Group matches by category
                                      const groups = {};
                                      const priceOrder = ['.50 Cents', '2.49 Products', '4.79 Products', 'Crunch Time'];
                                      item.matches.forEach(match => {
                                        const cat = match.category || 'Other';
                                        if (!groups[cat]) groups[cat] = [];
                                        groups[cat].push(match);
                                      });
                                      const sortedCats = Object.keys(groups).sort((a, b) => {
                                        const ai = priceOrder.findIndex(p => a.includes(p));
                                        const bi = priceOrder.findIndex(p => b.includes(p));
                                        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                                      });
                                      const checkedCount = item.matches.filter(m => m.checked).length;
                                      const isExpanded = !!item.expanded;

                                      return (
                                        <div key={idx} className="wa-guess-section">
                                          <div
                                            className="wa-guess-section-header"
                                            onClick={() => {
                                              setWaGuessResult(prev => ({
                                                ...prev,
                                                items: prev.items.map((it, i) => i === idx ? { ...it, expanded: !it.expanded } : it)
                                              }));
                                            }}
                                          >
                                            <span className="wa-guess-expand">{isExpanded ? '▾' : '▸'}</span>
                                            <span className="wa-guess-qty-badge">{item.qty}</span>
                                            <span className="wa-guess-text">{item.text}</span>
                                            {item.category && <span className="wa-guess-cat-badge">{item.category}</span>}
                                            <span className="wa-guess-count">
                                              {checkedCount > 0 ? `${checkedCount} selected` : `${item.matches.length} match${item.matches.length !== 1 ? 'es' : ''}`}
                                            </span>
                                          </div>
                                          {isExpanded && (
                                            <table className="wa-guess-table">
                                              <thead>
                                                <tr>
                                                  <th>Product</th>
                                                  <th>Qty</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {sortedCats.map(cat => (
                                                  <React.Fragment key={cat}>
                                                    <tr className="wa-guess-cat-row">
                                                      <td colSpan="2">{cat}</td>
                                                    </tr>
                                                    {groups[cat].map(match => (
                                                      <tr key={match.sku} className={match.checked ? 'wa-guess-checked' : ''}>
                                                        <td>{match.desc}</td>
                                                        <td>
                                                          <div className="wa-guess-qty-wrap">
                                                            <div className="wa-guess-qty-arrows">
                                                              <button onClick={() => {
                                                                const val = Math.max(0, (match.qty ?? 0) - 1);
                                                                setWaGuessResult(prev => ({ ...prev, items: prev.items.map((it, i) => i === idx ? { ...it, matches: it.matches.map(m => m.sku === match.sku ? { ...m, qty: val, checked: val > 0 } : m) } : it) }));
                                                              }}>−</button>
                                                              <button onClick={() => {
                                                                const val = (match.qty ?? 0) + 1;
                                                                setWaGuessResult(prev => ({ ...prev, items: prev.items.map((it, i) => i === idx ? { ...it, matches: it.matches.map(m => m.sku === match.sku ? { ...m, qty: val, checked: true } : m) } : it) }));
                                                              }}>+</button>
                                                            </div>
                                                            <input
                                                              type="number"
                                                              className="wa-guess-qty-input"
                                                              min="0"
                                                              value={match.qty ?? 0}
                                                              onChange={e => {
                                                                const val = parseInt(e.target.value) || 0;
                                                                setWaGuessResult(prev => ({
                                                                  ...prev,
                                                                  items: prev.items.map((it, i) => i === idx ? {
                                                                    ...it,
                                                                    matches: it.matches.map(m => m.sku === match.sku ? { ...m, qty: val, checked: val > 0 } : m)
                                                                  } : it)
                                                                }));
                                                              }}
                                                            />
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </React.Fragment>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {(() => {
                                      const hasChecked = waGuessResult.items.some(it => it.matches.some(m => m.checked));
                                      const guessRoute = waGuessResult.guessRoute ?? routeNum ?? '';
                                      return hasChecked && (
                                        <div className="wa-guess-create">
                                          <div className="wa-guess-route-row">
                                            <label>Route:</label>
                                            <select
                                              className="wa-guess-route-select"
                                              value={guessRoute}
                                              onChange={e => setWaGuessResult(prev => ({ ...prev, guessRoute: e.target.value }))}
                                            >
                                              <option value="">-- select route --</option>
                                              {routes.map(r => <option key={r} value={r}>{r} - {ROUTE_DRIVERS[r]}</option>)}
                                            </select>
                                          </div>
                                          <button
                                            className="wa-create-order-btn wa-create-order-main"
                                            onClick={() => {
                                              if (!guessRoute) { alert('Please select a route'); return; }
                                              const driverName = ROUTE_DRIVERS[guessRoute] || displayName;
                                              setSelectedRoute(guessRoute);
                                              setOrderName(driverName);
                                              setOrderDate(new Date().toISOString().split('T')[0]);
                                              // Load checked items
                                              const newCases = {};
                                              waGuessResult.items.forEach(item => {
                                                item.matches.forEach(match => {
                                                  if (match.checked) {
                                                    const qty = match.qty ?? 0;
                                                    newCases[match.sku] = (newCases[match.sku] || 0) + qty;
                                                  }
                                                });
                                              });
                                              // Build items for push
                                              const pushItems = Object.entries(newCases)
                                                .filter(([, qty]) => qty > 0)
                                                .map(([sku, qty]) => {
                                                  const p = FULL_CATALOG.find(pr => pr.sku === sku);
                                                  const caseUnits = qty * (p?.upc || 0);
                                                  return {
                                                    lineId: uuidv4(),
                                                    sku, category: p?.category || '', desc: p?.desc || '',
                                                    cases: qty, orderUnits: 0, upc: p?.upc || 0,
                                                    price: p?.price || 0, units: caseUnits,
                                                    gross: caseUnits * (p?.price || 0),
                                                  };
                                                });
                                              // Save order
                                              const today = new Date().toISOString().split('T')[0];
                                              const totalCases = pushItems.reduce((s, i) => s + i.cases, 0);
                                              const totalUnits = pushItems.reduce((s, i) => s + i.units, 0);
                                              const totalGross = pushItems.reduce((s, i) => s + i.gross, 0);
                                              addWarehouseOrder({
                                                routeNumber: guessRoute, date: today, name: driverName,
                                                invoiceNumber: '', invoiceCases: '', invoiceAmount: '',
                                                loadNumber: '', loadCases: '', loadAmount: '',
                                                status: 'pending', source: 'whatsapp', items: pushItems,
                                                totals: { totalCases, totalUnits, totalGross },
                                                waOriginalMessage: waGuessResult._msgBody || '',
                                              });
                                              setCases(prev => {
                                                const merged = { ...prev };
                                                Object.entries(newCases).forEach(([sku, qty]) => {
                                                  merged[sku] = (merged[sku] || 0) + qty;
                                                });
                                                return merged;
                                              });
                                              setWaNote(waGuessResult._msgBody || '');
                                              // Auto-push to Sheets
                                              pendingWaPush.current = pushItems;
                                              setWaGuessResult(null);
                                              setTab('entry');
                                            }}
                                            disabled={!guessRoute}
                                          >
                                            {t(lang, 'createOrderForRoute')} {guessRoute || '—'}
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                      const needsFix = !isStandardFormat(entry.tabName);
                      const parsed = parseTabName(entry.tabName);
                      const suggestedName = needsFix ? buildStandardName(parsed) : null;
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
                            {needsFix && suggestedName && (
                              <button
                                className="wo-fix-name-btn"
                                onClick={() => handleFixTabName(entry, parsed)}
                                title={`Rename to "${suggestedName}"`}
                              >
                                &#x2192; {suggestedName}
                              </button>
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

      {/* Stats tab */}
      {tab === 'stats' && (
        <div className="wo-stats">
          <div className="wo-stats-header">
            <h3>{t(lang, 'stats')}</h3>
            <select className="wo-stats-range" value={statsRange} onChange={e => setStatsRange(e.target.value)}>
              <option value="all">{t(lang, 'allTime')}</option>
              <option value="7">{t(lang, 'last7Days')}</option>
              <option value="30">{t(lang, 'last30Days')}</option>
              <option value="90">{t(lang, 'last90Days')}</option>
            </select>
          </div>

          {!statsData ? (
            <div className="wo-not-connected">
              <div className="wo-not-connected-icon">{'\u{1F4CA}'}</div>
              <h3>{t(lang, 'noStatsData')}</h3>
            </div>
          ) : (
            <>
              {/* Restock Planner */}
              {statsData.restock && (
                <div className="wo-stats-section">
                  <h4>{lang === 'es' ? 'Plan de Reabastecimiento' : 'Restock Planner'}</h4>

                  {/* Summary cards */}
                  <div className="wo-restock-summary">
                    <div className="wo-restock-card">
                      <span className="wo-restock-label">{lang === 'es' ? 'Ordenes esta semana' : 'Orders This Week'}</span>
                      <span className="wo-restock-value">{statsData.restock.thisWeekOrderCount}</span>
                    </div>
                    <div className="wo-restock-card">
                      <span className="wo-restock-label">{lang === 'es' ? 'Cajas usadas' : 'Cases Used'}</span>
                      <span className="wo-restock-value">{statsData.restock.totalThisWeek}</span>
                    </div>
                    <div className="wo-restock-card wo-restock-card-primary">
                      <span className="wo-restock-label">{lang === 'es' ? 'Reorden sugerida (+10%)' : 'Suggested Reorder (+10%)'}</span>
                      <span className="wo-restock-value">{statsData.restock.totalReorder} {lang === 'es' ? 'cajas' : 'cases'}</span>
                    </div>
                  </div>

                  {/* Category breakdown */}
                  {statsData.restock.categories.length > 0 && (
                    <div className="wo-restock-categories">
                      <h5>{lang === 'es' ? 'Por Categoria' : 'By Category'}</h5>
                      <div className="wo-restock-cat-grid">
                        {statsData.restock.categories.map(cat => (
                          <div key={cat.category} className="wo-restock-cat-card">
                            <span className="wo-restock-cat-name">{cat.category}</span>
                            <div className="wo-restock-cat-stats">
                              <span>{lang === 'es' ? 'Usado' : 'Used'}: <strong>{cat.thisWeek}</strong></span>
                              <span>{lang === 'es' ? 'Reorden' : 'Reorder'}: <strong>{cat.reorder}</strong></span>
                              <span>{cat.items} {lang === 'es' ? 'productos' : 'items'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detailed product table */}
                  <table className="wo-stats-table wo-restock-table">
                    <thead>
                      <tr>
                        <th>{t(lang, 'product')}</th>
                        <th>{lang === 'es' ? 'Categoria' : 'Category'}</th>
                        <th>{lang === 'es' ? 'Esta Semana' : 'This Week'}</th>
                        <th>{lang === 'es' ? 'Semana Pasada' : 'Last Week'}</th>
                        <th>{lang === 'es' ? 'Prom. Semanal' : 'Avg/Week'}</th>
                        <th>{lang === 'es' ? 'Tendencia' : 'Trend'}</th>
                        <th>{lang === 'es' ? 'Reorden (+10%)' : 'Reorder (+10%)'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statsData.restock.items.map(item => (
                        <tr key={item.sku}>
                          <td>{item.desc}</td>
                          <td className="wo-stats-date">{item.category}</td>
                          <td className="wo-stats-num">{item.thisWeek}</td>
                          <td className="wo-stats-num">{item.lastWeek}</td>
                          <td className="wo-stats-num">{item.projected}</td>
                          <td className="wo-stats-num">
                            <span className={`wo-restock-trend wo-trend-${item.trend}`}>
                              {item.trend === 'up' ? '▲' : item.trend === 'down' ? '▼' : '—'}
                            </span>
                          </td>
                          <td className="wo-stats-num wo-restock-reorder">{item.reorder}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="2"><strong>{lang === 'es' ? 'TOTAL' : 'TOTAL'}</strong></td>
                        <td className="wo-stats-num"><strong>{statsData.restock.totalThisWeek}</strong></td>
                        <td className="wo-stats-num"><strong>{statsData.restock.items.reduce((s, p) => s + p.lastWeek, 0)}</strong></td>
                        <td className="wo-stats-num"><strong>{statsData.restock.items.reduce((s, p) => s + p.projected, 0).toFixed(1)}</strong></td>
                        <td></td>
                        <td className="wo-stats-num wo-restock-reorder"><strong>{statsData.restock.totalReorder}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Overview Cards */}
              <div className="wo-stats-cards">
                <div className="wo-stat-card">
                  <div className="wo-stat-value">{statsData.overview.totalOrders}</div>
                  <div className="wo-stat-label">{t(lang, 'totalOrders')}</div>
                </div>
                <div className="wo-stat-card">
                  <div className="wo-stat-value">{statsData.overview.totalCases}</div>
                  <div className="wo-stat-label">{t(lang, 'totalCases')}</div>
                </div>
                <div className="wo-stat-card">
                  <div className="wo-stat-value">{statsData.overview.avgCasesPerOrder}</div>
                  <div className="wo-stat-label">{t(lang, 'avgOrderSize')}</div>
                </div>
                <div className="wo-stat-card">
                  <div className="wo-stat-value">${statsData.overview.totalCost.toFixed(2)}</div>
                  <div className="wo-stat-label">{t(lang, 'totalCost')}</div>
                </div>
                <div className="wo-stat-card">
                  <div className="wo-stat-value">${statsData.overview.totalRevenue.toFixed(2)}</div>
                  <div className="wo-stat-label">{t(lang, 'totalRevenue')}</div>
                </div>
                <div className="wo-stat-card wo-stat-card-profit">
                  <div className="wo-stat-value">${statsData.overview.grossProfit.toFixed(2)}</div>
                  <div className="wo-stat-label">{t(lang, 'grossProfit')}</div>
                </div>
              </div>

              {/* Top Products */}
              <div className="wo-stats-section">
                <h4>{t(lang, 'topProducts')}</h4>
                <table className="wo-stats-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'rank')}</th>
                      <th>{t(lang, 'sku')}</th>
                      <th>{t(lang, 'product')}</th>
                      <th>{t(lang, 'cases')}</th>
                      <th>{lang === 'es' ? 'Unidades' : 'Units'}</th>
                      <th>{t(lang, 'cost')}</th>
                      <th>{t(lang, 'revenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllProducts ? statsData.topProducts : statsData.topProducts.slice(0, 15)).map((p, i) => (
                      <tr key={p.sku}>
                        <td className="wo-stats-rank">{i + 1}</td>
                        <td className="wo-stats-sku">{p.sku}</td>
                        <td>{p.desc}</td>
                        <td className="wo-stats-num">{p.cases}</td>
                        <td className="wo-stats-num">{p.units}</td>
                        <td className="wo-stats-num">${p.cost.toFixed(2)}</td>
                        <td className="wo-stats-num">${p.revenue.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {statsData.topProducts.length > 15 && (
                  <button className="wo-stats-toggle" onClick={() => setShowAllProducts(!showAllProducts)}>
                    {showAllProducts ? t(lang, 'showLess') : `${t(lang, 'showAll')} (${statsData.topProducts.length})`}
                  </button>
                )}
              </div>

              {/* Route Breakdown */}
              <div className="wo-stats-section">
                <h4>{t(lang, 'routeBreakdown')}</h4>
                <table className="wo-stats-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'route')}</th>
                      <th>{t(lang, 'driver')}</th>
                      <th>{t(lang, 'numOrders')}</th>
                      <th>{t(lang, 'cases')}</th>
                      <th>{t(lang, 'avgCases')}</th>
                      <th>{t(lang, 'revenue')}</th>
                      <th>{t(lang, 'lastOrder')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.routeBreakdown.map(r => (
                      <tr key={r.route}>
                        <td className="wo-stats-route">{r.route}</td>
                        <td>{r.driver}</td>
                        <td className="wo-stats-num">{r.orders}</td>
                        <td className="wo-stats-num">{r.cases}</td>
                        <td className="wo-stats-num">{r.avgCases}</td>
                        <td className="wo-stats-num">${r.revenue.toFixed(2)}</td>
                        <td className="wo-stats-date">{r.lastOrder}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Category Mix */}
              <div className="wo-stats-section">
                <h4>{t(lang, 'categoryMix')}</h4>
                <div className="wo-cat-mix">
                  {statsData.categoryMix.map(c => (
                    <div key={c.category} className="wo-cat-mix-row">
                      <div className="wo-cat-mix-name">{c.category}</div>
                      <div className="wo-cat-mix-bar-wrap">
                        <div className="wo-cat-mix-bar" style={{ width: `${Math.max(c.pct, 2)}%` }}></div>
                      </div>
                      <div className="wo-cat-mix-pct">{c.pct.toFixed(1)}%</div>
                      <div className="wo-cat-mix-cases">{c.cases} {t(lang, 'cases').toLowerCase()}</div>
                      <div className="wo-cat-mix-rev">${c.revenue.toFixed(2)}</div>
                      <div className="wo-cat-mix-margin">{c.margin.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Route Favorites */}
              <div className="wo-stats-section">
                <h4>{t(lang, 'routeFavorites')}</h4>
                <div className="wo-route-favs">
                  {statsData.routeFavorites.map(r => (
                    <div key={r.route} className="wo-route-fav-card">
                      <div className="wo-route-fav-header">
                        <span className="wo-route-fav-num">{r.route}</span>
                        <span className="wo-route-fav-driver">{r.driver}</span>
                      </div>
                      <div className="wo-route-fav-list">
                        {r.top5.map((p, i) => (
                          <div key={p.sku} className="wo-route-fav-item">
                            <span className="wo-route-fav-rank">{i + 1}.</span>
                            <span className="wo-route-fav-name">{p.desc}</span>
                            <span className="wo-route-fav-cases">{p.cases}cs</span>
                          </div>
                        ))}
                        {r.top5.length === 0 && <div className="wo-route-fav-item" style={{ color: '#9ca3af' }}>No data</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Frequency */}
              <div className="wo-stats-section">
                <h4>{t(lang, 'orderFrequency')}</h4>
                <table className="wo-stats-table">
                  <thead>
                    <tr>
                      <th>{t(lang, 'route')}</th>
                      <th>{t(lang, 'driver')}</th>
                      <th>{t(lang, 'numOrders')}</th>
                      <th>{t(lang, 'avgDaysBetween')}</th>
                      <th>{t(lang, 'lastOrder')}</th>
                      <th>{t(lang, 'daysSinceLast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsData.orderFrequency.map(r => (
                      <tr key={r.route} className={r.daysSince !== null && r.avgDays > 0 && r.daysSince > r.avgDays * 1.5 ? 'wo-freq-overdue' : ''}>
                        <td className="wo-stats-route">{r.route}</td>
                        <td>{r.driver}</td>
                        <td className="wo-stats-num">{r.orders}</td>
                        <td className="wo-stats-num">{r.avgDays > 0 ? `${r.avgDays}d` : '-'}</td>
                        <td className="wo-stats-date">{r.lastOrder}</td>
                        <td className="wo-stats-num">
                          {r.daysSince !== null ? (
                            <span className={r.avgDays > 0 && r.daysSince > r.avgDays * 1.5 ? 'wo-freq-alert' : ''}>
                              {r.daysSince}d
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Order Forecasting */}
              {statsData.forecast && (
                <div className="wo-stats-section">
                  <h4>{lang === 'es' ? 'Pronostico de Ordenes' : 'Order Forecast'}</h4>

                  {/* Upcoming orders timeline */}
                  <div className="wo-forecast-timeline">
                    {statsData.forecast.routeForecasts.map(rf => (
                      <div key={rf.route} className={`wo-forecast-card ${rf.isOverdue ? 'wo-fc-overdue' : rf.isDueSoon ? 'wo-fc-due-soon' : ''}`}>
                        <div className="wo-fc-header">
                          <span className="wo-fc-route">{rf.route}</span>
                          <span className="wo-fc-driver">{rf.driver}</span>
                          {rf.isOverdue && <span className="wo-fc-badge wo-fc-badge-overdue">{lang === 'es' ? 'ATRASADO' : 'OVERDUE'}</span>}
                          {rf.isDueSoon && <span className="wo-fc-badge wo-fc-badge-soon">{lang === 'es' ? 'PRONTO' : 'DUE SOON'}</span>}
                        </div>
                        <div className="wo-fc-body">
                          <div className="wo-fc-stat">
                            <span className="wo-fc-stat-label">{lang === 'es' ? 'Cada' : 'Every'}</span>
                            <span className="wo-fc-stat-value">{rf.avgDays > 0 ? `${rf.avgDays}d` : '-'}</span>
                          </div>
                          <div className="wo-fc-stat">
                            <span className="wo-fc-stat-label">{lang === 'es' ? 'Ultima' : 'Last'}</span>
                            <span className="wo-fc-stat-value">{rf.daysSince !== null ? `${rf.daysSince}d ${lang === 'es' ? 'atras' : 'ago'}` : '-'}</span>
                          </div>
                          <div className="wo-fc-stat">
                            <span className="wo-fc-stat-label">{lang === 'es' ? 'Siguiente' : 'Next'}</span>
                            <span className="wo-fc-stat-value">
                              {rf.daysUntil !== null
                                ? rf.daysUntil <= 0
                                  ? (lang === 'es' ? 'Hoy' : 'Today')
                                  : `${rf.daysUntil}d`
                                : '-'}
                            </span>
                          </div>
                          <div className="wo-fc-stat">
                            <span className="wo-fc-stat-label">{lang === 'es' ? 'Est. Cajas' : 'Est. Cases'}</span>
                            <span className="wo-fc-stat-value wo-fc-cases">{rf.suggestedTotalCases || '-'}</span>
                          </div>
                        </div>
                        {rf.suggestedItems.length > 0 && (
                          <details className="wo-fc-details">
                            <summary>{lang === 'es' ? 'Orden sugerida' : 'Suggested order'} ({rf.suggestedItems.length} {lang === 'es' ? 'productos' : 'items'})</summary>
                            <div className="wo-fc-items">
                              {rf.suggestedItems.slice(0, 10).map(item => (
                                <div key={item.sku} className="wo-fc-item">
                                  <span className="wo-fc-item-name">{item.desc}</span>
                                  <span className="wo-fc-item-cases">{item.avgCases}cs</span>
                                  <span className="wo-fc-item-freq">{item.frequency}%</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Weekly demand forecast */}
                  {statsData.forecast.weeklyItems.length > 0 && (
                    <div className="wo-forecast-weekly">
                      <h5>{lang === 'es' ? 'Demanda proximos 7 dias' : 'Next 7 Days Demand'} — <strong>{statsData.forecast.weeklyTotalCases}</strong> {lang === 'es' ? 'cajas estimadas' : 'estimated cases'}</h5>
                      <table className="wo-stats-table">
                        <thead>
                          <tr>
                            <th>{t(lang, 'product')}</th>
                            <th>{lang === 'es' ? 'Categoria' : 'Category'}</th>
                            <th>{lang === 'es' ? 'Cajas Est.' : 'Est. Cases'}</th>
                            <th>{lang === 'es' ? 'Rutas' : 'Routes'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statsData.forecast.weeklyItems.map(item => (
                            <tr key={item.sku}>
                              <td>{item.desc}</td>
                              <td className="wo-stats-date">{item.category}</td>
                              <td className="wo-stats-num">{item.cases}</td>
                              <td className="wo-stats-date">{item.routes.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </>
          )}
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
                : `${showConfirm.conflicts.length} item(s) differ between Map Tracker and Google Sheet. Pick which to keep for each:`}
            </p>
            <div className="wo-conflict-table-wrap">
              <table className="wo-conflict-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="wo-conflict-col-mt">Map Tracker</th>
                    <th className="wo-conflict-col-gs">Google Sheet</th>
                    <th>Keep</th>
                  </tr>
                </thead>
                <tbody>
                  {showConfirm.conflicts.map(c => (
                    <tr key={c.sku} className={c._keep ? 'wo-conflict-resolved' : ''}>
                      <td>
                        <div className="wo-conflict-product">
                          <span className="wo-conflict-name">{c.desc}</span>
                          <span className="wo-conflict-detail">{c.category} · ${c.price?.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className={`wo-conflict-val ${c._keep === 'app' ? 'wo-conflict-picked' : ''}`}>{c.appVal}</td>
                      <td className={`wo-conflict-val ${c._keep === 'sheet' ? 'wo-conflict-picked' : ''}`}>{c.sheetVal}</td>
                      <td>
                        <div className="wo-conflict-btns">
                          <button
                            className={`wo-conflict-keep-btn wo-keep-app ${c._keep === 'app' ? 'active' : ''}`}
                            onClick={() => setShowConfirm(prev => ({ ...prev, conflicts: prev.conflicts.map(x => x.sku === c.sku ? { ...x, _keep: 'app' } : x) }))}
                          >
                            Map Tracker
                          </button>
                          <button
                            className={`wo-conflict-keep-btn wo-keep-sheet ${c._keep === 'sheet' ? 'active' : ''}`}
                            onClick={() => setShowConfirm(prev => ({ ...prev, conflicts: prev.conflicts.map(x => x.sku === c.sku ? { ...x, _keep: 'sheet' } : x) }))}
                          >
                            Google Sheet
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="wo-clear-btn" onClick={() => setShowConfirm(null)}>{t(lang, 'cancel')}</button>
              <button
                className="wo-save-btn"
                style={{ marginLeft: 0 }}
                disabled={!showConfirm.conflicts.every(c => c._keep)}
                onClick={() => {
                  // Apply per-item choices
                  const newCases = { ...cases };
                  showConfirm.conflicts.forEach(c => {
                    if (c._keep === 'sheet') {
                      newCases[c.sku] = c.sheetVal;
                    }
                    // 'app' means keep current form value — no change needed
                  });
                  setCases(newCases);
                  setShowConfirm(null);
                  setSyncMsg({ type: 'success', text: `Resolved ${showConfirm.conflicts.length} conflict(s)` });
                }}
              >
                Apply Choices
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

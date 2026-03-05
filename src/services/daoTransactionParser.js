/**
 * DAO Transaction Parser
 * Processes scraped transaction data from the DAO Group dashboard
 */

/**
 * GP benchmark — derived from Wise Foods Jobber pricing analysis.
 * Case Cost = 71.4% of Case Retail; GP = 28.6% of retail ≈ 29%.
 * In terms of load: Expected GP = Load × 0.408  (= Load × 29/71)
 * DAO Revenue is already post-promotion, so GP Efficiency < 100% is normal on promo-heavy routes.
 */
export const EXPECTED_GP_PCT = 29.0;

/**
 * Calculate the expected (theoretical max) gross profit for a given load cost.
 * Assumes 100% sell-through at full retail with no promos.
 * @param {number} loadTotal - Total load cost (what was paid to Wise Foods)
 * @returns {number} Expected GP in dollars
 */
export function expectedGP(loadTotal) {
  return loadTotal * 0.408;
}

/**
 * Sub-route mapping — sub-routes are combined into their parent route
 * e.g., route 206 is a sub-route of 210, so their data is merged
 */
export const SUB_ROUTE_MAP = {
  '206': '210',
};

/**
 * Storage routes — these trucks deliver supplies to storage locations.
 * Loads/Route Orders are internal supply movements, NOT cost of goods sold.
 * Only Invoice transactions to named stores count for revenue/metrics.
 */
export const STORAGE_ROUTES = new Set(['211']);

// Reverse lookup: parent → [sub-routes]
const SUB_ROUTE_CHILDREN = {};
for (const [sub, parent] of Object.entries(SUB_ROUTE_MAP)) {
  if (!SUB_ROUTE_CHILDREN[parent]) SUB_ROUTE_CHILDREN[parent] = [];
  SUB_ROUTE_CHILDREN[parent].push(sub);
}

/**
 * Get the effective route (parent) for a given route number
 */
export function getParentRoute(route) {
  return SUB_ROUTE_MAP[route] || route;
}

/**
 * Get all route numbers in a group (parent + sub-routes)
 */
export function getRouteGroup(route) {
  const parent = getParentRoute(route);
  const children = SUB_ROUTE_CHILDREN[parent] || [];
  return [parent, ...children];
}

/**
 * Get display label for a route (e.g., "210 (+206)")
 */
export function getRouteLabel(route) {
  const children = SUB_ROUTE_CHILDREN[route];
  if (children && children.length > 0) {
    return `${route} (+${children.join(', +')})`;
  }
  return route;
}

/**
 * Parse and normalize raw transaction JSON from the bookmarklet
 */
export function parseTransactions(rawArray) {
  if (!Array.isArray(rawArray)) return [];

  return rawArray.map(row => ({
    branch: (row.branch || '').replace(/^0+/, ''),
    route: normalizeRoute(row.route || ''),
    custNum: (row.custNum || '').replace(/^0+/, '') || '',
    custName: (row.custName || '').trim(),
    docType: (row.docType || '').trim(),
    id: row.id || '',
    docDate: parseDocDate(row.docDate || ''),
    settlementDate: parseSettlementDate(row.settlementDate || ''),
    amount: typeof row.amount === 'number' ? row.amount : parseFloat((row.amount || '0').replace(/[$,]/g, '')) || 0,
    deliveryAmount: typeof row.deliveryAmount === 'number' ? row.deliveryAmount : parseFloat((row.deliveryAmount || '0').replace(/[$,]/g, '')) || 0,
    deliveryDifference: typeof row.deliveryDifference === 'number' ? row.deliveryDifference : parseFloat((row.deliveryDifference || '0').replace(/[$,]/g, '')) || 0,
    invoiceType: (row.invoiceType || '').trim(),
    isVoid: (row.void || '').toLowerCase() === 'true',
    dsd: (row.dsd || '').trim(),
    docMissing: (row.docMissing || '').trim(),
  })).filter(r => r.docType); // Must have a document type
}

/**
 * Normalize route from "360209" → "209" or "0209" → "209"
 */
function normalizeRoute(raw) {
  const cleaned = raw.replace(/\s/g, '');
  // Format: 6-digit "36XXXX" where 36=branch prefix, last 3-4 digits=route
  if (/^\d{6}$/.test(cleaned)) {
    const routePart = cleaned.slice(2); // Remove "36" prefix → "0209"
    return String(parseInt(routePart, 10)); // "0209" → "209"
  }
  // Already a plain number
  return String(parseInt(cleaned, 10) || cleaned);
}

/**
 * Parse document date: "02/21/2026 11:38AM" → { date: "2026-02-21", time: "11:38 AM" }
 */
function parseDocDate(raw) {
  if (!raw) return { date: '', time: '' };
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}:\d{2}\s*[AP]M)?/i);
  if (match) {
    return {
      date: `${match[3]}-${match[1]}-${match[2]}`,
      time: (match[4] || '').trim(),
    };
  }
  return { date: raw, time: '' };
}

/**
 * Parse settlement date: "02/21/26" → "2026-02-21"
 */
function parseSettlementDate(raw) {
  if (!raw) return '';
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (match) {
    let year = match[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${match[1]}-${match[2]}`;
  }
  return raw;
}

/**
 * Chain name patterns → store ID prefix mapping
 * Each entry: [regex to match DAO custName, store ID prefix, digits to pad to]
 * The regex must have a capture group for the store number
 */
const CHAIN_PATTERNS = [
  [/FOOD\s*LION\s+#?(\d+)/i,          'FLW'],
  [/SHOPPERS?\s*(?:FOOD)?\s*#?(\d+)/i, 'SFW'],
  [/SHOP\s*RITE\s+#?(\d+)/i,          'SRW'],
  [/GIANT\s+(?:FOOD\s+)?#?(\d+)/i,    'GTW'],
  [/MARTINS?\s+#?(\d+)/i,             'MTW'],
  [/WEIS\s+#?(\d+)/i,                 'WMW'],
  [/REDNER'?S?\s+#?(\d+)/i,           'RDW'],
  [/ACME\s+#?(\d+)/i,                 'AMW'],
  [/WAL[\s-]*MART\s+#?(\d+)/i,        'WAW'],
  [/WEGMANS?\s+#?(\d+)/i,             'WGW'],
  [/TARGET\s+#?(\d+)/i,               'TGW'],
  [/B\s*GREEN\s+.*?(\d+)/i,           'BGW'],
  [/FOOD\s*DEPOT\s+#?(\d+)/i,         'FDW'],
  [/GROCERY\s*OUTLET\s+#?(\d+)/i,     'GOW'],
  [/KEY\s*FOOD\s+#?(\d+)/i,           'KFW'],
  [/COMM(?:ISSARY)?\s+.+?(\d+)/i,     'CMW'],
  [/GERESBECK'?S?\s+.*?(\d+)/i,       'GBW'],
  [/SAVE\s*A\s*LOT\s+.*?(\d+)/i,      'SL0'],
];

/**
 * Map DAO customer name to Map Tracker store ID format
 * "FOOD LION 1322" → "FLW01322"
 * "SHOPPERS 2342" → "SFW02342"
 * "SHOP RITE 542" → "SRW00542"
 */
export function mapCustomerToStoreId(custName) {
  if (!custName) return null;
  const trimmed = custName.trim();

  for (const [regex, prefix] of CHAIN_PATTERNS) {
    const m = trimmed.match(regex);
    if (m) {
      const num = m[1].padStart(5, '0');
      return `${prefix}${num}`;
    }
  }

  return null;
}

/**
 * Try to match a DAO customer to a Map Tracker store by name/number
 */
export function matchCustomerToStore(custName, custNum, stores) {
  if (!stores || stores.length === 0) return null;

  // Strategy 1: Construct store ID from chain name + number
  const storeId = mapCustomerToStoreId(custName);
  if (storeId) {
    const found = stores.find(s => s.id === storeId || s.storeNumber === storeId);
    if (found) return found;
  }

  // Strategy 2: Match custNum against numeric portion of store IDs/storeNumbers
  if (custNum) {
    const numericCust = custNum.replace(/^0+/, '') || '0';
    const found = stores.find(s => {
      // Extract numeric portion from store ID (e.g., "SFW02342" → "2342")
      const idNum = (s.id || '').replace(/^[A-Z]+0*/i, '');
      if (idNum && idNum === numericCust) return true;
      // Also check storeNumber field directly and its numeric portion
      const sn = s.storeNumber || '';
      if (sn === custNum) return true;
      const snNum = sn.replace(/^[A-Z]+0*/i, '');
      if (snNum && snNum === numericCust) return true;
      return false;
    });
    if (found) return found;
  }

  // Strategy 3: Fuzzy name match — for CASH/IND stores with unique names
  if (custName) {
    const upper = custName.toUpperCase().trim();
    // Skip very short or generic names that would false-match
    if (upper.length >= 4) {
      const found = stores.find(s => {
        const sName = (s.name || '').toUpperCase();
        if (!sName || sName.length < 4) return false;
        return upper.includes(sName) || sName.includes(upper);
      });
      if (found) return found;
    }
  }

  return null;
}

/**
 * Deduplicate transactions by ID — keeps first occurrence of each ID
 */
export function dedup(txs) {
  const seen = new Set();
  return txs.filter(t => {
    if (!t.id || !seen.has(t.id)) {
      if (t.id) seen.add(t.id);
      return true;
    }
    return false;
  });
}

/**
 * Analyze transactions grouped by route (sub-routes merged into parent)
 */
export function analyzeByRoute(transactions) {
  const routes = {};

  for (const tx of transactions) {
    if (!tx.route) continue;
    // Map sub-routes to their parent
    const effectiveRoute = getParentRoute(tx.route);
    if (!routes[effectiveRoute]) {
      routes[effectiveRoute] = {
        route: effectiveRoute,
        subRoutes: new Set(),
        transactions: [],
        dates: new Set(),
      };
    }
    if (tx.route !== effectiveRoute) {
      routes[effectiveRoute].subRoutes.add(tx.route);
    }
    routes[effectiveRoute].transactions.push(tx);
    if (tx.settlementDate && !tx.isVoid) routes[effectiveRoute].dates.add(tx.settlementDate);
  }

  return Object.values(routes).map(r => {
    const txs = r.transactions;
    // Non-void transactions for totals
    const activeTxs = txs.filter(t => !t.isVoid);
    const voidTxs = txs.filter(t => t.isVoid);
    const isStorage = STORAGE_ROUTES.has(r.route);
    const loads = dedup(activeTxs.filter(t => t.docType === 'Load' || t.docType === 'Route Order'));
    const invoices = dedup(activeTxs.filter(t => t.docType === 'Invoice'));
    const deliveries = dedup(activeTxs.filter(t => t.docType === 'Delivery'));
    const truckInv = dedup(activeTxs.filter(t => t.docType === 'Truck Inventory'));

    // Storage routes: loads are internal supply movements, not COGS
    const loadTotal = isStorage ? 0 : loads.reduce((s, t) => s + t.amount, 0);
    const grossSales = invoices.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const credits = invoices.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const netSales = grossSales + credits;
    const sellThrough = loadTotal > 0 ? (netSales / loadTotal) * 100 : 0;
    const storeNames = new Set(invoices.filter(t => t.custName).map(t => t.custName));
    const dsdOk = activeTxs.filter(t => t.dsd === 'OK').length;
    const dsdMissing = activeTxs.filter(t => t.dsd === 'Missing').length;
    const dates = [...r.dates].sort();

    // Payment method breakdown — from non-void invoices only
    const paymentBreakdown = {};
    for (const inv of invoices) {
      const method = inv.invoiceType || 'Other';
      if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
      paymentBreakdown[method].count++;
      paymentBreakdown[method].total += inv.amount;
    }

    const subRoutes = [...(r.subRoutes || [])].sort();
    return {
      route: r.route,
      subRoutes,
      isStorage,
      displayRoute: subRoutes.length > 0 ? `${r.route} (+${subRoutes.join(', +')})` : r.route,
      dateRange: dates.length > 0 ? `${formatDateShort(dates[0])} - ${formatDateShort(dates[dates.length - 1])}` : '',
      dates,
      loadTotal,
      rawLoadTotal: loads.reduce((s, t) => s + t.amount, 0),
      grossSales,
      credits,
      netSales,
      sellThrough,
      storeCount: storeNames.size,
      storeNames: [...storeNames],
      dsdOk,
      dsdMissing,
      dsdCompliance: (dsdOk + dsdMissing) > 0 ? (dsdOk / (dsdOk + dsdMissing)) * 100 : 100,
      deliveryTotal: deliveries.reduce((s, t) => s + t.deliveryAmount, 0),
      deliveryDiffTotal: deliveries.reduce((s, t) => s + t.deliveryDifference, 0),
      truckInventory: truckInv.reduce((s, t) => s + t.amount, 0),
      paymentBreakdown,
      voidCount: voidTxs.length,
      voidTotal: voidTxs.filter(t => t.docType === 'Invoice').reduce((s, t) => s + t.amount, 0),
      transactionCount: txs.length,
      transactions: txs,
    };
  }).sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
}

/**
 * Analyze transactions grouped by day within a route (includes sub-routes)
 */
export function analyzeByDay(transactions, routeFilter) {
  const isStorage = routeFilter ? STORAGE_ROUTES.has(getParentRoute(routeFilter)) : false;
  const filtered = routeFilter
    ? (() => {
        const group = new Set(getRouteGroup(routeFilter));
        return transactions.filter(t => group.has(t.route));
      })()
    : transactions;

  const days = {};
  for (const tx of filtered) {
    const date = tx.settlementDate || tx.docDate?.date || '';
    if (!date || tx.isVoid) continue;
    if (!days[date]) {
      days[date] = { date, transactions: [] };
    }
    days[date].transactions.push(tx);
  }

  return Object.values(days).map(d => {
    const txs = d.transactions;
    const loads = dedup(txs.filter(t => t.docType === 'Load' || t.docType === 'Route Order'));
    const invoices = dedup(txs.filter(t => t.docType === 'Invoice'));

    // Storage routes: loads are internal supply movements, not COGS
    const loadTotal = isStorage ? 0 : loads.reduce((s, t) => s + t.amount, 0);
    const grossSales = invoices.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const credits = invoices.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const netSales = grossSales + credits;
    const sellThrough = loadTotal > 0 ? (netSales / loadTotal) * 100 : 0;
    const storeNames = new Set(invoices.filter(t => t.custName).map(t => t.custName));

    return {
      date: d.date,
      dateFormatted: formatDateShort(d.date),
      loadTotal,
      grossSales,
      credits,
      netSales,
      sellThrough,
      storeCount: storeNames.size,
      transactionCount: txs.length,
      transactions: txs,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get store-level breakdown for a specific route and date (includes sub-routes)
 */
export function analyzeByStore(transactions, routeFilter, dateFilter) {
  // Include ALL transactions (including voids) — voids appear in ledger but not in totals
  let filtered = [...transactions];
  if (routeFilter) {
    const group = new Set(getRouteGroup(routeFilter));
    filtered = filtered.filter(t => group.has(t.route));
  }
  if (dateFilter) filtered = filtered.filter(t => t.settlementDate === dateFilter || t.docDate?.date === dateFilter);

  const stores = {};
  const routeOpsKey = '__route_ops__';
  for (const tx of filtered) {
    if (tx.docType === 'Settle') continue;
    // Group transactions without a customer (Load, Route Order, Truck Inventory) under "Route Operations"
    const key = tx.custName || routeOpsKey;
    const label = tx.custName || 'Route Operations';
    if (!stores[key]) {
      stores[key] = { custName: label, custNum: tx.custNum || '', transactions: [], isRouteOps: key === routeOpsKey };
    }
    stores[key].transactions.push(tx);
  }

  return Object.values(stores).map(s => {
    // Only count non-void invoices in totals
    const invoices = s.transactions.filter(t => t.docType === 'Invoice' && !t.isVoid);
    const total = invoices.reduce((sum, t) => sum + t.amount, 0);
    const dsdStatus = s.transactions.find(t => t.dsd && !t.isVoid)?.dsd || '';

    return {
      custName: s.custName,
      custNum: s.custNum,
      total,
      invoiceCount: invoices.length,
      dsd: dsdStatus,
      transactions: s.transactions,
      isRouteOps: s.isRouteOps || false,
    };
  }).sort((a, b) => {
    // Route Operations always first
    if (a.isRouteOps) return -1;
    if (b.isRouteOps) return 1;
    return b.total - a.total;
  });
}

/**
 * Extract route number from warehouse (Rt 99) customer name
 * "208 - JOBBER" → "208", "200 - Jose Nunez" → "200"
 */
function extractRouteFromWarehouseCust(custName) {
  if (!custName) return null;
  const match = custName.match(/^(\d{2,3})\s*-/);
  return match ? String(parseInt(match[1], 10)) : null;
}

/**
 * Get the next calendar day in YYYY-MM-DD format
 */
function nextDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Match warehouse (Rt 99) invoices to route loads
 * Returns per-route comparison: warehouse invoice vs route load
 * Handles 1-day offset — warehouse invoices the evening before,
 * route records the load the next morning
 */
export function analyzeWarehouseMatchup(transactions) {
  const rt99 = transactions.filter(t => t.route === '99' && !t.isVoid);
  const others = transactions.filter(t => t.route !== '99' && !t.isVoid);

  // Warehouse invoices grouped by target route + date
  const whInvoices = {};
  for (const tx of rt99) {
    if (tx.docType !== 'Invoice') continue;
    const targetRoute = extractRouteFromWarehouseCust(tx.custName);
    if (!targetRoute) continue;
    const date = tx.settlementDate || tx.docDate?.date || '';
    if (!date) continue;
    const key = `${targetRoute}|${date}`;
    if (!whInvoices[key]) whInvoices[key] = { route: targetRoute, date, invoices: [], custName: tx.custName };
    whInvoices[key].invoices.push(tx);
  }

  // Route loads grouped by route + date
  const routeLoads = {};
  for (const tx of others) {
    if (tx.docType !== 'Load' && tx.docType !== 'Route Order') continue;
    const route = tx.route;
    const date = tx.settlementDate || tx.docDate?.date || '';
    if (!date) continue;
    const key = `${route}|${date}`;
    if (!routeLoads[key]) routeLoads[key] = { route, date, loads: [] };
    routeLoads[key].loads.push(tx);
  }

  // Match warehouse invoices to route loads, allowing 1-day offset
  const results = [];
  const matchedLoadKeys = new Set();

  for (const whKey of Object.keys(whInvoices)) {
    const wh = whInvoices[whKey];
    const whDeduped = dedup(wh.invoices);
    const whAmount = whDeduped.reduce((s, t) => s + t.amount, 0);
    const invoiceId = whDeduped.map(t => t.id).filter(Boolean).join(', ');

    // Try same-date match first, then next-day match
    const sameDayKey = `${wh.route}|${wh.date}`;
    const nextDayKey = `${wh.route}|${nextDay(wh.date)}`;
    const rl = routeLoads[sameDayKey] || routeLoads[nextDayKey];
    const rlKey = routeLoads[sameDayKey] ? sameDayKey : (routeLoads[nextDayKey] ? nextDayKey : null);

    if (rlKey) matchedLoadKeys.add(rlKey);

    const routeLoadAmount = rl ? dedup(rl.loads).reduce((s, t) => s + t.amount, 0) : 0;
    const loadDate = rl ? rl.date : '';
    const diff = whAmount - routeLoadAmount;
    const matched = !!rl && Math.abs(diff) < 0.01;

    results.push({
      route: wh.route,
      date: wh.date,
      dateFormatted: formatDateShort(wh.date),
      loadDate,
      loadDateFormatted: formatDateShort(loadDate),
      custName: wh.custName,
      invoiceId,
      warehouseAmount: whAmount,
      routeLoadAmount,
      difference: diff,
      matched,
      hasWarehouse: true,
      hasRouteLoad: !!rl,
    });
  }

  // Add unmatched route loads (no warehouse invoice on same day or day before)
  for (const rlKey of Object.keys(routeLoads)) {
    if (matchedLoadKeys.has(rlKey)) continue;
    const rl = routeLoads[rlKey];
    const routeLoadAmount = dedup(rl.loads).reduce((s, t) => s + t.amount, 0);

    results.push({
      route: rl.route,
      date: rl.date,
      dateFormatted: formatDateShort(rl.date),
      loadDate: rl.date,
      loadDateFormatted: formatDateShort(rl.date),
      custName: '',
      invoiceId: '',
      warehouseAmount: 0,
      routeLoadAmount,
      difference: -routeLoadAmount,
      matched: false,
      hasWarehouse: false,
      hasRouteLoad: true,
    });
  }

  return results.sort((a, b) => {
    const rc = a.route.localeCompare(b.route, undefined, { numeric: true });
    return rc !== 0 ? rc : a.date.localeCompare(b.date);
  });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  }
  return dateStr;
}

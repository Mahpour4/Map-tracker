/**
 * DAO Transaction Parser
 * Processes scraped transaction data from the DAO Group dashboard
 */

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
 * Map DAO customer name to Map Tracker store ID format
 * "FOOD LION 1322" → "FLW01322"
 * "Comm Ft Belvoir 5235" → "CMW05235"
 */
export function mapCustomerToStoreId(custName) {
  if (!custName) return null;
  const upper = custName.toUpperCase().trim();

  // FOOD LION XXXX → FLW0XXXX
  const flMatch = upper.match(/FOOD\s*LION\s+(\d+)/);
  if (flMatch) return `FLW0${flMatch[1]}`;

  // Commissary patterns
  const commMatch = upper.match(/COMM(?:ISSARY)?\s+.+?(\d+)/);
  if (commMatch) return `CMW0${commMatch[1]}`;

  // B GREEN / other patterns — return null for manual matching
  return null;
}

/**
 * Try to match a DAO customer to a Map Tracker store by name/number
 */
export function matchCustomerToStore(custName, custNum, stores) {
  if (!stores || stores.length === 0) return null;

  // Try store ID mapping first
  const storeId = mapCustomerToStoreId(custName);
  if (storeId) {
    const found = stores.find(s => s.id === storeId || s.storeNumber === storeId);
    if (found) return found;
  }

  // Try matching by store number
  if (custNum) {
    const found = stores.find(s => s.storeNumber === custNum || s.customerNumber === custNum);
    if (found) return found;
  }

  // Try fuzzy name match
  const upper = (custName || '').toUpperCase();
  const found = stores.find(s => {
    const sName = (s.name || '').toUpperCase();
    return sName && upper.includes(sName) || sName.includes(upper);
  });
  return found || null;
}

/**
 * Deduplicate transactions by ID — keeps first occurrence of each ID
 */
function dedup(txs) {
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
 * Analyze transactions grouped by route
 */
export function analyzeByRoute(transactions) {
  const routes = {};

  for (const tx of transactions) {
    if (!tx.route || tx.isVoid) continue;
    if (!routes[tx.route]) {
      routes[tx.route] = {
        route: tx.route,
        transactions: [],
        dates: new Set(),
      };
    }
    routes[tx.route].transactions.push(tx);
    if (tx.settlementDate) routes[tx.route].dates.add(tx.settlementDate);
  }

  return Object.values(routes).map(r => {
    const txs = r.transactions;
    const loads = dedup(txs.filter(t => t.docType === 'Load' || t.docType === 'Route Order'));
    const invoices = dedup(txs.filter(t => t.docType === 'Invoice'));
    const deliveries = dedup(txs.filter(t => t.docType === 'Delivery'));
    const truckInv = dedup(txs.filter(t => t.docType === 'Truck Inventory'));

    const loadTotal = loads.reduce((s, t) => s + t.amount, 0);
    const grossSales = invoices.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const credits = invoices.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const netSales = grossSales + credits;
    const sellThrough = loadTotal > 0 ? (netSales / loadTotal) * 100 : 0;
    const storeNames = new Set(invoices.filter(t => t.custName).map(t => t.custName));
    const dsdOk = txs.filter(t => t.dsd === 'OK').length;
    const dsdMissing = txs.filter(t => t.dsd === 'Missing').length;
    const dates = [...r.dates].sort();

    return {
      route: r.route,
      dateRange: dates.length > 0 ? `${formatDateShort(dates[0])} - ${formatDateShort(dates[dates.length - 1])}` : '',
      dates,
      loadTotal,
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
      transactionCount: txs.length,
      transactions: txs,
    };
  }).sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
}

/**
 * Analyze transactions grouped by day within a route
 */
export function analyzeByDay(transactions, routeFilter) {
  const filtered = routeFilter
    ? transactions.filter(t => t.route === routeFilter)
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

    const loadTotal = loads.reduce((s, t) => s + t.amount, 0);
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
 * Get store-level breakdown for a specific route and date
 */
export function analyzeByStore(transactions, routeFilter, dateFilter) {
  let filtered = transactions.filter(t => !t.isVoid);
  if (routeFilter) filtered = filtered.filter(t => t.route === routeFilter);
  if (dateFilter) filtered = filtered.filter(t => t.settlementDate === dateFilter || t.docDate?.date === dateFilter);

  const stores = {};
  for (const tx of filtered) {
    if (!tx.custName || tx.docType === 'Settle') continue;
    const key = tx.custName;
    if (!stores[key]) {
      stores[key] = { custName: tx.custName, custNum: tx.custNum, transactions: [] };
    }
    stores[key].transactions.push(tx);
  }

  return Object.values(stores).map(s => {
    const invoices = s.transactions.filter(t => t.docType === 'Invoice');
    const total = invoices.reduce((sum, t) => sum + t.amount, 0);
    const dsdStatus = s.transactions.find(t => t.dsd)?.dsd || '';

    return {
      custName: s.custName,
      custNum: s.custNum,
      total,
      invoiceCount: invoices.length,
      dsd: dsdStatus,
      transactions: s.transactions,
    };
  }).sort((a, b) => b.total - a.total);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  }
  return dateStr;
}

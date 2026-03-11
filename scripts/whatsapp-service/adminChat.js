/**
 * Admin Chat Query Engine
 * Reads app data files and answers WhatsApp queries from authorized admins.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '../../src/data');
const LOCAL_DIR = path.join(__dirname, '../../local-data');

// ── Data loaders ──────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function parseCsv(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const cols = splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim()] = (cols[i] || '').trim(); });
      return obj;
    });
  } catch { return []; }
}

function splitCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cols.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

function loadStores()       { return parseCsv(path.join(DATA_DIR, 'stores.csv')); }
function loadAlerts()       { return parseCsv(path.join(DATA_DIR, 'alerts.csv')); }
function loadVisitHistory() { return readJson(path.join(DATA_DIR, 'visitHistory.json')) || {}; }
function loadOrders()       {
  return readJson(path.join(LOCAL_DIR, 'warehouseOrders.json'))
      || readJson(path.join(DATA_DIR, 'warehouseOrders.json'))
      || [];
}
function loadSchedules()    { return readJson(path.join(DATA_DIR, 'schedules.json')) || {}; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return 'N/A';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

function matchStore(query, stores) {
  const q = query.toLowerCase().trim();
  // Match by number
  const numMatch = stores.filter(s =>
    s.StoreNumber === q || s.StoreNumber === q.padStart(5, '0') ||
    s.id?.endsWith(q) || s.id?.endsWith(q.padStart(5, '0'))
  );
  if (numMatch.length > 0) return numMatch;
  // Match by name substring
  return stores.filter(s => s.Name?.toLowerCase().includes(q));
}

function getStoreLastVisit(storeId, visitHistory) {
  const visits = visitHistory[storeId];
  if (!visits || visits.length === 0) return null;
  const sorted = [...visits].sort((a, b) => new Date(b.date || b) - new Date(a.date || a));
  return sorted[0];
}

// ── Query handlers ────────────────────────────────────────────────────────────

function handleStore(args) {
  if (!args) return '❓ Usage: *store [name or number]*\nExample: store food lion 1214';
  const stores    = loadStores();
  const alerts    = loadAlerts();
  const visits    = loadVisitHistory();

  const matches = matchStore(args, stores);
  if (matches.length === 0) return `❌ No store found matching: "${args}"`;
  if (matches.length > 5)   return `⚠️ ${matches.length} stores found. Be more specific.\n${matches.slice(0,5).map(s => `• ${s.Name} #${s.StoreNumber} - ${s.City}`).join('\n')}...`;

  return matches.map(store => {
    const storeNum = store.StoreNumber || '';
    const storeId  = store.id || store.StoreID || '';
    const route    = store.RouteNumber || store.Route || 'N/A';

    // Last visit
    const lv = getStoreLastVisit(storeId, visits);
    const lastVisit = lv ? `${fmtDate(lv.date || lv)} (${daysAgo(lv.date || lv)}d ago)` : 'No visits recorded';

    // Open alerts
    const storeAlerts = alerts.filter(a =>
      (a.StoreNumber === storeNum || a.StoreNumber === storeNum.replace(/^0+/, '')) &&
      a.GwAlertType !== 'Completed'
    );
    const openAlerts    = storeAlerts.filter(a => !a.GwCreatedBy || !a.GwAlertType);
    const pendingAlerts = storeAlerts.length;

    const lines = [
      `🏪 *${store.Name} #${storeNum}*`,
      `📍 ${store.Address || ''} ${store.City || ''}, ${store.State || ''}`.trim(),
      `🛣️ Route: ${route}`,
      `📅 Last Visit: ${lastVisit}`,
      `🚨 Alerts: ${pendingAlerts} total${openAlerts.length > 0 ? ` (${openAlerts.length} open)` : ''}`,
    ];
    if (storeAlerts.length > 0) {
      const recent = storeAlerts.slice(0, 3);
      lines.push('');
      lines.push('Recent Alerts:');
      recent.forEach(a => lines.push(`  • ${a.RefNumber} — ${a.IssueType || a.GwAlertType || 'Alert'} (${fmtDate(a.DateReceived)})`));
    }
    return lines.join('\n');
  }).join('\n\n─────────────────\n\n');
}

function handleRoute(args) {
  if (!args) return '❓ Usage: *route [number]*\nExample: route 206';
  const routeNum  = args.trim().replace(/^rt?\.?\s*/i, '');
  const stores    = loadStores();
  const alerts    = loadAlerts();
  const orders    = loadOrders();
  const schedules = loadSchedules();

  const routeStores = stores.filter(s => s.RouteNumber === routeNum || s.Route === routeNum);
  const routeAlerts = alerts.filter(a => a.RouteNumber === routeNum);
  const openAlerts  = routeAlerts.filter(a => !a.GwAlertType?.includes('Completed'));
  const recentOrders = Array.isArray(orders)
    ? orders.filter(o => String(o.routeNumber) === routeNum).sort((a, b) => b.date?.localeCompare(a.date || '') || 0)
    : [];
  const lastOrder = recentOrders[0];

  const lines = [
    `🛣️ *Route ${routeNum}*`,
    `🏪 Stores: ${routeStores.length}`,
    `🚨 Alerts: ${openAlerts.length} open / ${routeAlerts.length} total`,
  ];
  if (lastOrder) {
    lines.push(`📦 Last Order: ${fmtDate(lastOrder.date)} — ${lastOrder.name || 'N/A'} — ${lastOrder.totals?.totalCases || 0} cases`);
  }

  // Schedule info
  const sched = schedules[routeNum];
  if (sched) {
    lines.push(`📅 Schedule: ${JSON.stringify(sched).substring(0, 60)}`);
  }

  if (openAlerts.length > 0) {
    lines.push('');
    lines.push('Open Alerts:');
    openAlerts.slice(0, 5).forEach(a =>
      lines.push(`  • ${a.StoreName} #${a.StoreNumber} — ${a.IssueType || a.GwAlertType || 'Alert'} (${fmtDate(a.DateReceived)})`)
    );
    if (openAlerts.length > 5) lines.push(`  ... and ${openAlerts.length - 5} more`);
  }

  return lines.join('\n');
}

function handleAlerts(args) {
  const alerts  = loadAlerts();
  const subArgs = (args || '').toLowerCase().trim();

  let filtered = alerts;
  let label    = 'All Alerts';

  if (subArgs === 'open' || subArgs === 'unresolved') {
    filtered = alerts.filter(a => !a.GwAlertType?.toLowerCase().includes('complet'));
    label = 'Open Alerts';
  } else if (subArgs === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    filtered = alerts.filter(a => a.DateReceived?.startsWith(today));
    label = "Today's Alerts";
  } else if (subArgs.match(/^route?\s*(\d+)/i)) {
    const m = subArgs.match(/\d+/);
    if (m) {
      filtered = alerts.filter(a => a.RouteNumber === m[0]);
      label = `Route ${m[0]} Alerts`;
    }
  } else if (subArgs.match(/^\d+$/)) {
    filtered = alerts.filter(a => a.RouteNumber === subArgs);
    label = `Route ${subArgs} Alerts`;
  }

  if (filtered.length === 0) return `✅ No alerts found for: ${label}`;

  const open      = filtered.filter(a => !a.GwAlertType?.toLowerCase().includes('complet')).length;
  const completed = filtered.length - open;

  const lines = [
    `🚨 *${label}* (${filtered.length} total)`,
    `  Open: ${open} | Completed: ${completed}`,
  ];

  // Group by route
  const byRoute = {};
  filtered.forEach(a => {
    const r = a.RouteNumber || 'N/A';
    if (!byRoute[r]) byRoute[r] = [];
    byRoute[r].push(a);
  });

  Object.entries(byRoute)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 8)
    .forEach(([route, list]) => {
      lines.push(`\nRoute ${route} (${list.length}):`);
      list.slice(0, 3).forEach(a =>
        lines.push(`  • ${a.StoreName} #${a.StoreNumber} — ${a.IssueType || a.GwAlertType || 'Alert'}`)
      );
      if (list.length > 3) lines.push(`  ... +${list.length - 3} more`);
    });

  return lines.join('\n');
}

function handleOrder(args) {
  if (!args) return '❓ Usage: *order [route number]*\nExample: order 206';
  const routeNum = (args || '').trim().replace(/^rt?\.?\s*/i, '');
  const orders   = loadOrders();

  if (!Array.isArray(orders)) return '⚠️ Orders data unavailable.';

  const routeOrders = orders
    .filter(o => String(o.routeNumber) === routeNum)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (routeOrders.length === 0) return `❌ No orders found for Route ${routeNum}`;

  const o = routeOrders[0];
  const lines = [
    `📦 *Route ${routeNum} — Latest Order*`,
    `📅 Date: ${fmtDate(o.date)}`,
    `👤 Driver: ${o.name || 'N/A'}`,
    `📊 Cases: ${o.totals?.totalCases || 0} | Units: ${o.totals?.totalUnits || 0}`,
    `💰 Gross: $${(o.totals?.totalGross || 0).toFixed(2)}`,
    `📋 Status: ${o.status || 'N/A'}`,
  ];
  if (o.invoiceNumber) lines.push(`🧾 Invoice: ${o.invoiceNumber} (${o.invoiceCases || 0} cases)`);
  if (o.loadNumber)    lines.push(`🚚 Load: ${o.loadNumber} (${o.loadCases || 0} cases)`);

  if (routeOrders.length > 1) {
    lines.push('');
    lines.push(`Previous orders (${routeOrders.length - 1} more):`);
    routeOrders.slice(1, 4).forEach(prev =>
      lines.push(`  • ${fmtDate(prev.date)} — ${prev.totals?.totalCases || 0} cases`)
    );
  }

  return lines.join('\n');
}

function handleHelp() {
  return [
    '*📱 Map Tracker — Admin Commands*',
    '',
    '*store [name or #]*',
    '  → Store info, last visit, alerts',
    '  Example: store food lion 1214',
    '',
    '*route [number]*',
    '  → Route summary, alerts, last order',
    '  Example: route 206',
    '',
    '*alerts [open | today | route N]*',
    '  → Alert summary',
    '  Examples: alerts open | alerts today | alerts 206',
    '',
    '*order [route number]*',
    '  → Latest order for a route',
    '  Example: order 206',
    '',
    '*help* — Show this menu',
  ].join('\n');
}

// ── Main entry point ──────────────────────────────────────────────────────────

function processQuery(text) {
  const clean  = (text || '').trim();
  const lower  = clean.toLowerCase();
  const spaceI = clean.indexOf(' ');
  const cmd    = spaceI === -1 ? lower : lower.slice(0, spaceI);
  const args   = spaceI === -1 ? '' : clean.slice(spaceI + 1).trim();

  try {
    if (cmd === 'store' || cmd === 'st')                   return handleStore(args);
    if (cmd === 'route' || cmd === 'rt' || cmd === 'r')    return handleRoute(args);
    if (cmd === 'alerts' || cmd === 'alert' || cmd === 'a') return handleAlerts(args);
    if (cmd === 'order' || cmd === 'orders')               return handleOrder(args);
    if (cmd === 'help' || cmd === '?')                     return handleHelp();

    // Fallback: if it looks like a store number, do store lookup
    if (/^\d{3,5}$/.test(clean)) return handleStore(clean);

    return `❓ Unknown command: *${cmd}*\n\nType *help* to see available commands.`;
  } catch (err) {
    console.error('[AdminChat] Query error:', err.message);
    return `⚠️ Error processing query: ${err.message}`;
  }
}

module.exports = { processQuery };

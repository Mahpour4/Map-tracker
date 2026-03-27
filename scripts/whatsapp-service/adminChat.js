/**
 * Admin Chat Query Engine
 * Reads app data files and answers WhatsApp queries from authorized admins.
 */
const fs = require('fs');
const path = require('path');
const { getRouteETA, FLEET } = require('./motiveApi');

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
function loadAlerts() {
  // Filter out junk metadata rows (no DateReceived or non-ADUSA RefNumber)
  return parseCsv(path.join(DATA_DIR, 'alerts.csv'))
    .filter(a => a.DateReceived && a.StoreNumber);
}
function loadVisitHistory() { return readJson(path.join(DATA_DIR, 'visitHistory.json')) || {}; }
function loadOrders()       {
  return readJson(path.join(LOCAL_DIR, 'warehouseOrders.json'))
      || readJson(path.join(DATA_DIR, 'warehouseOrders.json'))
      || [];
}
function loadSchedules()    { return readJson(path.join(DATA_DIR, 'schedules.json')) || {}; }
function loadWarehouses()   { return readJson(path.join(DATA_DIR, 'warehouses.json')) || []; }

function loadAlertImage(refNumber) {
  const dir = path.join(LOCAL_DIR, 'alert-images');
  for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
    const fp = path.join(dir, `${refNumber}.${ext}`);
    try {
      if (fs.existsSync(fp)) {
        const data = fs.readFileSync(fp);
        return { base64: data.toString('base64'), mimeType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
      }
    } catch { }
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse YYYY-MM-DD as local date (not UTC) to avoid off-by-one timezone shift
function parseLocal(d) {
  const s = String(d).replace(/"/g, '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(s);
}

function fmtDate(d) {
  if (!d) return 'N/A';
  const dt = parseLocal(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = parseLocal(dateStr);
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - d) / 86400000);
}

function matchStore(query, stores) {
  const q = query.toLowerCase().trim();

  // stores.csv headers have spaces: "Store Number", "Store Name", "ID", "Route Number"
  const getName = s => s['Store Name'] || s.StoreName || s.Name || '';
  const getNum  = s => s['Store Number'] || s.StoreNumber || '';
  const getId   = s => s['ID'] || s.ID || s.id || '';

  // Match by number (pure numeric query)
  if (/^\d+$/.test(q)) {
    const numMatch = stores.filter(s =>
      getNum(s) === q || getNum(s) === q.padStart(5, '0') ||
      getId(s).endsWith(q) || getId(s).endsWith(q.padStart(5, '0'))
    );
    if (numMatch.length > 0) return numMatch;
  }

  // Try extracting trailing number from mixed query like "food lion 2688"
  const trailingNum = q.match(/^(.+?)\s+(\d{3,5})$/);
  if (trailingNum) {
    const namePart = trailingNum[1].trim();
    const numPart  = trailingNum[2];
    const combo = stores.filter(s =>
      getName(s).toLowerCase().includes(namePart) &&
      (getNum(s) === numPart || getNum(s) === numPart.padStart(5, '0'))
    );
    if (combo.length > 0) return combo;
  }

  // Match by name substring
  return stores.filter(s => getName(s).toLowerCase().includes(q));
}

function getStoreLastVisit(storeId, visitHistory) {
  const visits = visitHistory[storeId];
  if (!visits || visits.length === 0) return null;
  const sorted = [...visits].sort((a, b) => new Date(b.date || b) - new Date(a.date || a));
  return sorted[0];
}

/**
 * Auto-resolve: an alert is considered resolved if the store was visited or
 * had a sale AFTER the alert date.
 */
function isAlertAutoResolved(alert, stores, visitHistory) {
  const alertDate = (alert.DateReceived || '').split('T')[0];
  if (!alertDate) return false;

  // Find the store
  const storeNum = alert.StoreNumber || '';
  const storeId  = alert.StoreID || '';
  const store = stores.find(s => {
    const sId  = s['ID'] || s.ID || '';
    const sNum = s['Store Number'] || s.StoreNumber || '';
    return sId === storeId || sNum === storeNum || sNum === storeNum.padStart(5, '0');
  });

  // Best last-activity date from all sources
  const dates = [];
  if (store) {
    if (store['Last Sale']) dates.push(store['Last Sale']);
    if (store['Last Visited']) dates.push(store['Last Visited']);
    if (store.LastSale) dates.push(store.LastSale);
    if (store.LastVisited) dates.push(store.LastVisited);
  }
  const vh = visitHistory[storeId] || visitHistory[storeNum] || [];
  if (vh.length > 0) {
    const newest = [...vh].sort().pop();
    if (newest) dates.push(typeof newest === 'string' ? newest : newest.date || '');
  }

  const bestDate = dates.filter(Boolean).sort().pop();
  if (!bestDate) return false;
  return bestDate.split('T')[0] >= alertDate;
}

// ── Query handlers ────────────────────────────────────────────────────────────

function handleStore(args) {
  if (!args) return '❓ Usage: *store [name or number]*\nExample: store food lion 1214';
  const stores    = loadStores();
  const alerts    = loadAlerts();
  const visits    = loadVisitHistory();

  const matches = matchStore(args, stores);
  if (matches.length === 0) return `❌ No store found matching: "${args}"`;
  if (matches.length > 5)   return `⚠️ ${matches.length} stores found. Be more specific.\n${matches.slice(0,5).map(s => `• ${s['Store Name'] || s.StoreName} #${s['Store Number'] || s.StoreNumber} - ${s.City}`).join('\n')}...`;

  return matches.map(store => {
    const storeNum = store['Store Number'] || store.StoreNumber || '';
    const storeId  = store['ID'] || store.ID || store.id || '';
    const route    = store['Route Number'] || store.RouteNumber || 'N/A';

    // Last visit — use best date from visitHistory, Last Sale, Last Visited
    const lv = getStoreLastVisit(storeId, visits);
    const vhDate = lv ? (lv.date || lv) : null;
    const lastSale    = store['Last Sale'] || store.LastSale || '';
    const lastVisited = store['Last Visited'] || store.LastVisited || '';
    const bestDate = [vhDate, lastSale, lastVisited].filter(Boolean).sort().pop();
    const lastVisit = bestDate ? `${fmtDate(bestDate)} (${daysAgo(bestDate)}d ago)` : 'No visits recorded';

    // Open alerts — exclude completed and auto-resolved (store visited after alert)
    const storeAlerts = alerts.filter(a =>
      (a.StoreNumber === storeNum || a.StoreNumber === storeNum.replace(/^0+/, '')) &&
      a.GwAlertType !== 'Completed' &&
      !isAlertAutoResolved(a, stores, visits)
    );
    const pendingAlerts = storeAlerts.length;

    const storeName = store['Store Name'] || store.StoreName || store.Name || '';
    const lines = [
      `🏪 *${storeName} #${storeNum}*`,
      `📍 ${store.Address || ''} ${store.City || ''}, ${store.State || ''}`.trim(),
      `🛣️ Route: ${route}`,
      `📅 Last Visit: ${lastVisit}`,
      `🚨 Alerts: ${pendingAlerts} open`,
    ];
    if (storeAlerts.length > 0) {
      const recent = storeAlerts.slice(0, 3);
      lines.push('');
      lines.push('Recent Alerts:');
      recent.forEach(a => lines.push(`  • ${a.RefNumber} — ${a.IssueType || a.GwAlertType || 'Alert'}${a.City ? ' (' + a.City + ')' : ''} (${fmtDate(a.DateReceived)})`));
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

  const visits      = loadVisitHistory();
  const routeStores = stores.filter(s => (s['Route Number'] || s.RouteNumber) === routeNum);
  const routeAlerts = alerts.filter(a => a.RouteNumber === routeNum);
  const openAlerts  = routeAlerts.filter(a =>
    !a.GwAlertType?.includes('Completed') &&
    !isAlertAutoResolved(a, stores, visits)
  );
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
      lines.push(`  • ${a.StoreName} #${a.StoreNumber}${a.City ? ' (' + a.City + ')' : ''} — ${a.IssueType || a.GwAlertType || 'Alert'} (${fmtDate(a.DateReceived)})`)
    );
    if (openAlerts.length > 5) lines.push(`  ... and ${openAlerts.length - 5} more`);
  }

  return lines.join('\n');
}

function handleAlerts(args, routeFilter) {
  let alerts  = loadAlerts();
  const stores  = loadStores();
  const visits  = loadVisitHistory();
  const subArgs = (args || '').toLowerCase().trim();

  // If this group is restricted to certain routes, filter upfront
  if (routeFilter && routeFilter.length > 0) {
    alerts = alerts.filter(a => routeFilter.includes(a.RouteNumber));
  }

  let filtered = alerts;
  let label    = routeFilter ? `Routes ${routeFilter.join(', ')} Alerts` : 'All Alerts';

  // Default (no args): show this week's open alerts (Mon–Sun)
  if (!subArgs || subArgs === 'week') {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMon = day === 0 ? 6 : day - 1; // days since Monday
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMon);
    const cutoff = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    filtered = alerts.filter(a =>
      a.DateReceived && a.DateReceived.replace(/"/g, '') >= cutoff &&
      !a.GwAlertType?.toLowerCase().includes('complet') &&
      !isAlertAutoResolved(a, stores, visits)
    );
    label = routeFilter ? `Routes ${routeFilter.join(', ')} — This Week (Open)` : "This Week's Open Alerts";
  } else if (subArgs === 'all' || subArgs === 'open' || subArgs === 'unresolved') {
    filtered = alerts.filter(a =>
      !a.GwAlertType?.toLowerCase().includes('complet') &&
      !isAlertAutoResolved(a, stores, visits)
    );
    label = 'All Open Alerts';
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

  // Auto-resolve: exclude alerts where store was visited after the alert
  const resolved  = filtered.filter(a => isAlertAutoResolved(a, stores, visits));
  const completed = filtered.filter(a => a.GwAlertType?.toLowerCase().includes('complet')).length;
  filtered = filtered.filter(a =>
    !a.GwAlertType?.toLowerCase().includes('complet') &&
    !isAlertAutoResolved(a, stores, visits)
  );

  if (filtered.length === 0 && resolved.length === 0 && completed === 0) return `✅ No alerts found for: ${label}`;
  if (filtered.length === 0) return `✅ ${label}: All resolved! (${resolved.length} auto-resolved, ${completed} completed)`;

  const open = filtered.length;

  const lines = [
    `🚨 *${label}* (${open} open)`,
    `  ${resolved.length > 0 ? `Auto-resolved: ${resolved.length} | ` : ''}Completed: ${completed}`,
  ];

  // Group by route
  const byRoute = {};
  filtered.forEach(a => {
    const r = a.RouteNumber || 'N/A';
    if (!byRoute[r]) byRoute[r] = [];
    byRoute[r].push(a);
  });

  // Collect images for open alerts (cached on disk by the app when blasting)
  const images = [];
  Object.entries(byRoute)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(([route, list]) => {
      lines.push(`\nRoute ${route} (${list.length}):`);
      list.forEach(a => {
        const alertLine = `  • ${a.StoreName} #${a.StoreNumber}${a.City ? ' (' + a.City + ')' : ''} — ${a.IssueType || a.GwAlertType || 'Alert'} (${fmtDate(a.DateReceived)})`;
        lines.push(alertLine);
        // Try to attach cached image
        const img = loadAlertImage(a.RefNumber);
        if (img) {
          images.push({
            base64: img.base64,
            mimeType: img.mimeType,
            caption: `${a.StoreName} #${a.StoreNumber} — ${a.RefNumber}`,
          });
        }
      });
    });

  const text = lines.join('\n');
  return images.length > 0 ? { text, images } : text;
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
    '*alerts [all | today | route N]*',
    '  → This week by default, or filter',
    '  Examples: alerts | alerts all | alerts today | alerts 206',
    '',
    '*order [route number]*',
    '  → Latest order for a route',
    '  Example: order 206',
    '',
    '*truck [truck number]*',
    '  → Truck location & ETA to delivery destination',
    '  Example: truck 211',
    '',
    '*truck eta [truck number]*',
    '  → Truck ETA back to warehouse',
    '  Example: truck eta 211 | truck eta 209 salisbury',
    '',
    '*sales* (or *fl*)',
    '  → Food Lion visit progress today / this week',
    '',
    '*help* — Show this menu',
  ].join('\n');
}

// ── Truck ETA handler ─────────────────────────────────────────────────────────

// Named destination overrides — type keyword to override route's default
const DEST_KEYWORDS = {
  'salisbury':  { name: 'Salisbury, MD',  lat: 38.3607, lng: -75.5994 },
  'woodbridge': { name: 'Woodbridge, VA', lat: 38.6582, lng: -77.2497 },
};

// Hardcoded fallbacks when group has no destination configured
const ROUTE_DEST_FALLBACKS = {
  '206': { name: 'Salisbury, MD',  lat: 38.3607, lng: -75.5994 },
  '209': { name: 'Woodbridge, VA', lat: 38.6582, lng: -77.2497 },
  '210': { name: 'Salisbury, MD',  lat: 38.3607, lng: -75.5994 },
  '211': { name: 'Salisbury, MD',  lat: 38.3607, lng: -75.5994 },
};

async function handleTruck(args, groupConfig) {
  const parts = (args || '').trim().split(/\s+/);
  const firstPart = (parts[0] || '').replace(/^rt?\.?\s*/i, '');
  // Default to truck 211 — dedicated delivery truck for all routes
  const routeNum = firstPart || '211';
  const destOverrideKey = (firstPart ? parts.slice(1) : parts).join(' ').toLowerCase().trim();

  if (!routeNum) return '❓ Usage: *truck [truck#] [destination?]*\nExamples: truck 211 | truck 211 woodbridge | truck 211 salisbury';

  if (!FLEET[routeNum]) return `❌ No vehicle assigned to Truck ${routeNum}`;

  const apiKey = groupConfig?.motiveApiKey;
  if (!apiKey) return '⚠️ Motive API key not configured. Ask admin to set it up.';

  // Destination priority: inline keyword > per-route config > group default > hardcoded fallback
  const dest = DEST_KEYWORDS[destOverrideKey]
    || groupConfig?.routeDestinations?.[routeNum]
    || groupConfig?.destination
    || ROUTE_DEST_FALLBACKS[routeNum];

  try {
    const result = await getRouteETA(apiKey, routeNum, dest?.lat, dest?.lng);
    if (result.error) return `⚠️ ${result.error}`;

    const lines = [
      `🚚 *Truck ${routeNum} — ${result.model}*`,
      `📍 Currently: ${result.description || 'Unknown'}`,
    ];

    if (result.driverName) lines.push(`👤 Driver: ${result.driverName}`);
    if (result.speed != null) lines.push(`🚗 Speed: ${Math.round(result.speed)} mph`);
    if (result.engineStatus) lines.push(`🔑 Engine: ${result.engineStatus}`);

    if (dest && result.route) {
      lines.push('');
      lines.push(`🏁 Destination: ${dest.name}`);
      lines.push(`📏 Distance: ${result.route.distanceMiles} mi${result.route.isStraightLine ? ' (straight-line est.)' : ''}`);
      lines.push(`⏱️ ETA: ~${result.route.durationText}${result.route.isStraightLine ? ' (est.)' : ''}`);
    } else if (dest && !result.route) {
      lines.push('');
      lines.push(`🏁 Destination: ${dest.name}`);
      lines.push(`📏 Routing unavailable`);
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[AdminChat] Truck ETA error:', err.message);
    return `⚠️ Error fetching truck location: ${err.message}`;
  }
}

// ── Warehouse ETA handler ─────────────────────────────────────────────────────

async function handleWarehouse(args, groupConfig) {
  const parts = (args || '').trim().split(/\s+/);
  const firstPart = (parts[0] || '').replace(/^rt?\.?\s*/i, '');
  // Default to truck 211 — dedicated delivery truck for all routes
  const routeNum = firstPart || '211';
  // Optional filter: "wh 211 salisbury" or "wh 211 main" etc.
  const filter = (firstPart ? parts.slice(1) : parts).join(' ').toLowerCase().trim();

  if (!routeNum) return '❓ Usage: *wh [truck#]*\nExamples: wh 211 | wh 209';

  if (!FLEET[routeNum]) return `❌ No vehicle assigned to Truck ${routeNum}`;

  const apiKey = groupConfig?.motiveApiKey;
  if (!apiKey) return '⚠️ Motive API key not configured.';

  // If no explicit filter, use group's configured destination (e.g. Woodbridge vs Salisbury)
  const groupDest = !filter && groupConfig?.destination ? groupConfig.destination : null;
  if (groupDest) {
    // Show single ETA to the group's delivery destination
    try {
      const result = await getRouteETA(apiKey, routeNum, groupDest.lat, groupDest.lng);
      if (result.error) return `⚠️ ${result.error}`;
      const lines = [
        `🚚 *Truck ${routeNum} — ${result.model}*`,
        `📍 Currently: ${result.description || 'Unknown'}`,
      ];
      if (result.driverName) lines.push(`👤 Driver: ${result.driverName}`);
      if (result.speed != null) lines.push(`🚗 Speed: ${Math.round(result.speed)} mph`);
      if (result.route) lines.push(`\n📦 ETA to ${groupDest.name}: ${result.route.distanceMiles} mi — ~${result.route.durationText}`);
      else lines.push(`\n📦 ETA to ${groupDest.name}: routing unavailable`);
      return lines.join('\n');
    } catch (err) {
      return `⚠️ Error fetching truck location: ${err.message}`;
    }
  }

  const warehouses = loadWarehouses();
  if (!warehouses.length) return '⚠️ No warehouses configured.';

  // Filter warehouses if a keyword was given
  const targets = filter
    ? warehouses.filter(w => w.name.toLowerCase().includes(filter) || w.id.toLowerCase().includes(filter))
    : warehouses;
  if (!targets.length) return `❌ No warehouse matching "${filter}"`;

  try {
    // Fetch truck location once, then calculate route to each warehouse
    const result = await getRouteETA(apiKey, routeNum, targets[0].lat, targets[0].lng);
    if (result.error) return `⚠️ ${result.error}`;

    const lines = [
      `🚚 *Truck ${routeNum} — ${result.model}*`,
      `📍 Currently: ${result.description || 'Unknown'}`,
    ];
    if (result.driverName) lines.push(`👤 Driver: ${result.driverName}`);
    if (result.speed != null) lines.push(`🚗 Speed: ${Math.round(result.speed)} mph`);
    lines.push('');
    lines.push('🏭 *Warehouse ETAs:*');

    // Calculate route to each warehouse (first one already fetched above)
    for (const wh of targets) {
      let route = null;
      if (wh.id === targets[0].id) {
        route = result.route;
      } else {
        try {
          const whResult = await getRouteETA(apiKey, routeNum, wh.lat, wh.lng);
          route = whResult.route;
        } catch { }
      }
      if (route) {
        lines.push(`  📦 ${wh.name}: ${route.distanceMiles} mi — ~${route.durationText}`);
      } else {
        lines.push(`  📦 ${wh.name}: routing unavailable`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    console.error('[AdminChat] Warehouse ETA error:', err.message);
    return `⚠️ Error fetching truck location: ${err.message}`;
  }
}

function handleSales(args) {
  const stores = loadStores();
  const visits = loadVisitHistory();

  const fl = stores.filter(s => (s['Store Name'] || '').toLowerCase().includes('food lion'));
  const total = fl.length;

  const now = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const todayStr = fmt(now);
  const yest = new Date(now); yest.setDate(now.getDate()-1);
  const yesterdayStr = fmt(yest);
  const weekStart = new Date(now); weekStart.setDate(now.getDate()-7);
  const weekStartStr = fmt(weekStart);

  const hitDate = (s, dates, weekCheck) => {
    const sale  = (s['Last Sale']    || s.LastSale    || '').split('T')[0].split(' ')[0];
    const visit = (s['Last Visited'] || s.LastVisited || '').split('T')[0].split(' ')[0];
    // Also check visitHistory
    const id  = s['ID'] || s.ID || '';
    const num = s['Store Number'] || s.StoreNumber || '';
    const vh  = visits[id] || visits[num] || [];
    const lastVH = vh.length > 0 ? ([...vh].sort((a,b)=>String(b.date||b).localeCompare(String(a.date||a)))[0]) : null;
    const vhDate = lastVH ? (lastVH.date || lastVH).toString().split('T')[0] : null;

    if (dates) {
      for (const d of [sale, visit, vhDate]) {
        if (d && dates.has(d)) return true;
      }
    }
    if (weekCheck) {
      for (const d of [sale, visit, vhDate]) {
        if (d && d >= weekStartStr && d <= todayStr) return true;
      }
    }
    return false;
  };

  const todayCount = fl.filter(s => hitDate(s, new Set([todayStr]), false)).length;
  const yesterdayCount = fl.filter(s => hitDate(s, new Set([yesterdayStr]), false)).length;
  const weekCount = fl.filter(s => hitDate(s, null, true)).length;

  const bar = (n, t) => {
    const pct = Math.round((n / t) * 10);
    return '█'.repeat(pct) + '░'.repeat(10 - pct) + ` ${n}/${t}`;
  };

  const todayPct  = Math.round((todayCount / total) * 100);
  const weekPct   = Math.round((weekCount  / total) * 100);

  return [
    `🏪 *Food Lion Sales Activity*`,
    ``,
    `📅 *Today*`,
    `${bar(todayCount, total)} (${todayPct}%)`,
    ``,
    `📅 *Yesterday*`,
    `${bar(yesterdayCount, total)} (${Math.round((yesterdayCount/total)*100)}%)`,
    ``,
    `📅 *This Week*`,
    `${bar(weekCount, total)} (${weekPct}%)`,
    ``,
    `Total FL stores: ${total}`,
  ].join('\n');
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * @param {string} text - the user command
 * @param {string[]|null} routeFilter - if set, restrict results to these routes only
 * @param {object|null} groupConfig - { motiveApiKey, destination, routes }
 */
async function processQuery(text, routeFilter, groupConfig) {
  const clean  = (text || '').trim();
  const lower  = clean.toLowerCase();
  const spaceI = clean.indexOf(' ');
  const cmd    = spaceI === -1 ? lower : lower.slice(0, spaceI);
  const args   = spaceI === -1 ? '' : clean.slice(spaceI + 1).trim();

  try {
    // Groups with route restrictions can only use alerts + truck
    if (routeFilter) {
      if (cmd === 'alerts' || cmd === 'alert' || cmd === 'a') return handleAlerts(args, routeFilter);
      if (cmd === 'truck' || cmd === 't') {
        if (/^eta\b/i.test(args) || /\beta$/i.test(args)) return await handleWarehouse(args.replace(/^eta\s*/i, '').replace(/\s*eta$/i, '').trim(), groupConfig);
        return await handleTruck(args, groupConfig);
      }
      if (cmd === 'wh' || cmd === 'warehouse' || cmd === 'home') return await handleWarehouse(args, groupConfig);
      if (cmd === 'help' || cmd === '?') return `*📱 Map Tracker — Commands*\n\n*alerts* — This week's open alerts\n*alerts all* — All open alerts\n*alerts today* — Today's alerts\n\n*truck [truck#]* — Truck location & ETA to delivery destination\n*truck [truck#] eta* — Truck ETA back to warehouse\n  Examples: truck 211 | truck 211 eta`;
      return `ℹ️ This group supports: *alerts*, *truck*, and *wh*\n\n*alerts* — open alerts for this group's routes\n*truck [truck#]* — truck location & ETA to delivery destination\n*wh [truck#]* — truck ETA back to warehouse\n  Example: truck 211 | wh 211`;
    }

    if (cmd === 'store' || cmd === 'st')                    return handleStore(args);
    if (cmd === 'route' || cmd === 'rt' || cmd === 'r')     return handleRoute(args);
    if (cmd === 'alerts' || cmd === 'alert' || cmd === 'a') return handleAlerts(args, routeFilter);
    if (cmd === 'order' || cmd === 'orders')                return handleOrder(args);
    if (cmd === 'truck' || cmd === 't') {
      if (/^eta\b/i.test(args) || /\beta$/i.test(args)) return await handleWarehouse(args.replace(/^eta\s*/i, '').replace(/\s*eta$/i, '').trim(), groupConfig);
      return await handleTruck(args, groupConfig);
    }
    if (cmd === 'wh' || cmd === 'warehouse' || cmd === 'home') return await handleWarehouse(args, groupConfig);
    if (cmd === 'sales' || cmd === 'fl')                    return handleSales(args);
    if (cmd === 'help' || cmd === '?')                      return handleHelp();

    // Fallback: if it looks like a store number, do store lookup
    if (/^\d{3,5}$/.test(clean)) return handleStore(clean);

    return `❓ Unknown command: *${cmd}*\n\nType *help* to see available commands.`;
  } catch (err) {
    console.error('[AdminChat] Query error:', err.message);
    return `⚠️ Error processing query: ${err.message}`;
  }
}

module.exports = { processQuery };

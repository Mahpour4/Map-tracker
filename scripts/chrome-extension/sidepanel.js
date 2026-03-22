// Side panel — tab-based, no site detection needed

const APP_URL_PATTERNS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://mahpour4.github.io/Map-tracker',
];

const TABS = {
  dao: {
    label: 'DAO Import',
    btnClass: 'btn-dao',
    btnText: 'Import DAO Dashboard',
    script: 'scrape-dao.js',
  },
  cb: {
    label: 'CB Inquiry',
    btnClass: 'btn-cb-inquiry',
    btnText: 'Download CB Invoice Inquiry',
    script: 'scrape-cb-inquiry.js',
  },
  websnak: {
    label: 'WebSnak',
    btnClass: 'btn-websnak',
    btnText: 'Import WebSnak Stores',
    script: 'scrape-websnak.js',
    extra: {
      key: 'invoices',
      btnClass: 'btn-invoices',
      btnText: 'Import Store Invoices',
      script: 'scrape-invoices.js',
      needsRoute: true,
    },
  },
};

let activeTab = 'dao';
let currentTabId = null;
let lastScrapedData = null;

// ── Logging ───────────────────────────────────────────────────────────────

function addLog(msg, type) {
  const log = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<div>${msg}</div><div class="log-time">${time}</div>`;
  if (log.firstChild) log.insertBefore(entry, log.firstChild);
  else log.appendChild(entry);
  log.querySelector('.empty-log')?.remove();
}

// ── Tab rendering ─────────────────────────────────────────────────────────

function renderTab() {
  const buttonArea = document.getElementById('button-area');
  const tab = TABS[activeTab];

  let html = `<div class="tab-panel">`;
  html += `<div class="tab-panel-label">${tab.label}</div>`;
  html += `<button id="importBtn" class="btn ${tab.btnClass}">${tab.btnText}</button>`;
  if (tab.extra) {
    html += `<button id="extraBtn" class="btn ${tab.extra.btnClass}">${tab.extra.btnText}</button>`;
  }
  html += `<div id="routePicker" style="display:none"></div>`;
  html += `</div>`;

  buttonArea.innerHTML = html;
  document.getElementById('importBtn').addEventListener('click', handleImportClick);
  if (tab.extra) {
    document.getElementById('extraBtn').addEventListener('click', () => handleExtraImport(tab.extra));
  }
}

// ── Import handlers ───────────────────────────────────────────────────────

function handleImportClick() {
  if (!currentTabId) return;
  const tab = TABS[activeTab];
  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  btn.textContent = 'Scraping...';
  addLog('Running ' + tab.btnText + '...', 'info');

  // CB inquiry must run in MAIN world to access ag-grid JS objects (__agComponent).
  // In MAIN world chrome.runtime is unavailable, so progress messages come from here.
  const execOptions = { target: { tabId: currentTabId, allFrames: true }, files: [tab.script] };
  if (activeTab === 'cb') execOptions.world = 'MAIN';

  chrome.scripting.executeScript(execOptions, () => {
    if (chrome.runtime.lastError) {
      addLog('Error: ' + chrome.runtime.lastError.message, 'error');
      btn.disabled = false;
      btn.textContent = tab.btnText;
    } else if (activeTab === 'cb') {
      // Script ran — download was triggered directly by the scraper
      addLog('CB Invoice Inquiry: script injected, download should start shortly.', 'success');
      btn.disabled = false;
      btn.textContent = tab.btnText;
    }
  });
}

function handleExtraImport(extra) {
  if (!currentTabId) return;
  if (extra.needsRoute) { showRoutePicker(extra); return; }
  launchExtraScraper(extra);
}

function launchExtraScraper(extra, storeList) {
  const btn = document.getElementById('extraBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping...'; }
  addLog('Running ' + extra.key + ' scraper...', 'info');
  showStopButton();

  const doInject = () => {
    chrome.scripting.executeScript(
      { target: { tabId: currentTabId, allFrames: true }, files: [extra.script] },
      () => {
        if (chrome.runtime.lastError) {
          addLog('Error: ' + chrome.runtime.lastError.message, 'error');
          if (btn) { btn.disabled = false; btn.textContent = extra.btnText; }
        }
      }
    );
  };

  if (storeList && storeList.length > 0) {
    chrome.scripting.executeScript(
      {
        target: { tabId: currentTabId, allFrames: true },
        world: 'MAIN',
        func: (stores) => {
          try { localStorage.setItem('invoice-scraper-stores', JSON.stringify(stores)); } catch (e) {}
        },
        args: [storeList],
      },
      () => {
        if (chrome.runtime.lastError) {
          addLog('Error setting store list: ' + chrome.runtime.lastError.message, 'error');
          if (btn) { btn.disabled = false; btn.textContent = extra.btnText; }
          return;
        }
        doInject();
      }
    );
  } else {
    doInject();
  }
}

// ── Stop button ───────────────────────────────────────────────────────────

function showStopButton() {
  const buttonArea = document.getElementById('button-area');
  if (document.getElementById('stopBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'stopBtn';
  btn.className = 'btn btn-stop';
  btn.textContent = 'Stop Scraping';
  btn.addEventListener('click', () => {
    addLog('Sending stop signal...', 'info');
    chrome.scripting.executeScript({
      target: { tabId: currentTabId, allFrames: true },
      world: 'MAIN',
      func: () => { try { localStorage.setItem('invoice-scraper-stop', '1'); } catch(e) {} },
    });
    btn.disabled = true;
    btn.textContent = 'Stopping...';
  });
  buttonArea.appendChild(btn);
}

function hideStopButton() {
  document.getElementById('stopBtn')?.remove();
}

// ── Route picker ──────────────────────────────────────────────────────────

function hideRoutePicker() {
  const picker = document.getElementById('routePicker');
  if (picker) picker.style.display = 'none';
}

async function showRoutePicker(extra) {
  const picker = document.getElementById('routePicker');
  if (!picker) return;
  picker.style.display = 'block';
  picker.innerHTML = '<div class="route-loading">Loading routes from Map Tracker...</div>';
  addLog('Fetching store list from Map Tracker...', 'info');

  try {
    const storeData = await fetchStoresFromApp();
    if (!storeData || storeData.length === 0) {
      picker.innerHTML = `
        <div class="route-error" style="margin-bottom:8px">Map Tracker not open — no store list available.</div>
        <div class="route-grid">
          <button class="route-btn route-current">Scrape Current Search</button>
          <button class="route-btn route-cancel">Cancel</button>
        </div>`;
      picker.querySelector('.route-current').addEventListener('click', () => { picker.style.display = 'none'; launchExtraScraper(extra, null); });
      picker.querySelector('.route-cancel').addEventListener('click', () => { picker.style.display = 'none'; });
      addLog('Map Tracker not open — will scrape current page only', 'info');
      return;
    }

    const routes = {};
    for (const s of storeData) {
      const route = s.route || 'Unassigned';
      if (!routes[route]) routes[route] = [];
      routes[route].push(s);
    }
    const sortedRoutes = Object.keys(routes).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1; if (!isNaN(nb)) return 1;
      return a.localeCompare(b);
    });

    const allActive = storeData.filter(s => s.route && s.route !== 'Unassigned' && !s.dormant);
    let html = '<div class="route-header">Select Route to Scrape</div><div class="route-grid">';
    html += `<button class="route-btn route-all" data-route="__ALL__">All<br><span class="route-count">${allActive.length} stores</span></button>`;
    html += `<button class="route-btn route-current" data-route="__CURRENT__">Current<br><span class="route-count">page only</span></button>`;
    for (const route of sortedRoutes) {
      if (route === 'Unassigned' || !route) continue;
      const activeStores = routes[route].filter(s => !s.dormant);
      html += `<button class="route-btn" data-route="${route}">Rt ${route}<br><span class="route-count">${activeStores.length} active</span></button>`;
    }
    html += '</div><button class="route-cancel" id="routeCancel">Cancel</button>';
    picker.innerHTML = html;

    picker.querySelectorAll('.route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;
        if (route === '__CURRENT__') { addLog('Scraping current page', 'info'); hideRoutePicker(); launchExtraScraper(extra, null); return; }
        let selected = route === '__ALL__'
          ? storeData.filter(s => s.route && s.route !== 'Unassigned' && !s.dormant)
          : routes[route].filter(s => !s.dormant);
        const storeList = selected.map(s => {
          const numMatch = (s.id || '').match(/\d+$/);
          return { storeId: s.id, storeNum: numMatch ? numMatch[0] : s.id };
        });
        addLog(`Selected ${route === '__ALL__' ? 'all routes' : 'Route ' + route}: ${storeList.length} stores`, 'info');
        hideRoutePicker();
        launchExtraScraper(extra, storeList);
      });
    });
    document.getElementById('routeCancel').addEventListener('click', hideRoutePicker);
  } catch (err) {
    picker.innerHTML = `<div class="route-error">Error: ${err.message}</div>`;
    addLog('Error fetching stores: ' + err.message, 'error');
  }
}

async function fetchStoresFromApp() {
  const tabs = await chrome.tabs.query({});
  let appTab = null;
  for (const tab of tabs) {
    const url = (tab.url || '').toLowerCase();
    for (const pattern of APP_URL_PATTERNS) {
      if (url.startsWith(pattern.toLowerCase())) { appTab = tab; break; }
    }
    if (appTab) break;
  }
  if (!appTab) return null;

  const results = await chrome.scripting.executeScript({
    target: { tabId: appTab.id },
    world: 'MAIN',
    func: () => {
      try {
        for (const key of ['MAP_TRACKER_STORES', 'map-tracker-stores']) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length > 0 && data[0].id)
              return data.map(s => ({ id: s.id, route: s.routeNumber || s.route || '', dormant: s.dormant === 'Yes' || s.dormant === true, name: s.name || s.storeName || '' }));
          } catch (e) {}
        }
        for (const key of Object.keys(localStorage)) {
          if (key.toLowerCase().includes('store')) {
            try {
              const data = JSON.parse(localStorage.getItem(key));
              if (Array.isArray(data) && data.length > 5 && data[0].id)
                return data.map(s => ({ id: s.id, route: s.routeNumber || s.route || '', dormant: s.dormant === 'Yes' || s.dormant === true, name: s.name || s.storeName || '' }));
            } catch (e) {}
          }
        }
        return null;
      } catch (e) { return null; }
    },
  });
  if (results?.[0]?.result) return results[0].result;
  throw new Error('Could not read store data from Map Tracker.');
}

// ── Tab tracking (for executeScript target only) ───────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) currentTabId = tabs[0].id;
});
chrome.tabs.onActivated.addListener((info) => { currentTabId = info.tabId; });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === currentTabId) { /* tab reloaded, keep tracking */ }
});

// ── Download fallback ─────────────────────────────────────────────────────

function showDownloadButton() {
  const buttonArea = document.getElementById('button-area');
  if (document.getElementById('downloadBtn')) return;
  const dlBtn = document.createElement('button');
  dlBtn.id = 'downloadBtn';
  dlBtn.className = 'btn btn-download';
  dlBtn.textContent = 'Download Data (Fallback)';
  dlBtn.addEventListener('click', downloadScrapedData);
  buttonArea.appendChild(dlBtn);
}

function downloadScrapedData() {
  if (!lastScrapedData) return;
  const filename = `map-tracker-${lastScrapedData.source}-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(lastScrapedData.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  addLog(`Downloaded ${lastScrapedData.count} records as ${filename}`, 'success');
}

// ── Message listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  const btn = document.getElementById('importBtn');
  const tab = TABS[activeTab];

  if (msg.type === 'scrape-progress') addLog(msg.message, 'info');

  if (msg.type === 'scrape-done') {
    hideStopButton();
    lastScrapedData = { source: msg.source, data: msg.data, count: msg.count, ts: Date.now() };

    if (msg.source === 'invoices' || msg.source === 'cb-inquiry') {
      addLog(`Scraped ${msg.count} records. Downloading JSON...`, 'info');
      downloadScrapedData();
      if (btn) { btn.disabled = false; btn.textContent = tab.btnText; }
      const eBtn = document.getElementById('extraBtn');
      if (eBtn && tab.extra) { eBtn.disabled = false; eBtn.textContent = tab.extra.btnText; }
      return;
    }

    addLog(`Scraped ${msg.count} records. Sending to Map Tracker...`, 'info');
    chrome.runtime.sendMessage({ type: 'import-to-app', source: msg.source, data: msg.data });
  }

  if (msg.type === 'import-complete') {
    addLog(`Done! ${msg.count} records imported into Map Tracker.`, 'success');
    lastScrapedData = null;
    document.getElementById('downloadBtn')?.remove();
    if (btn) { btn.disabled = false; btn.textContent = tab.btnText; }
  }

  if (msg.type === 'import-error') {
    addLog('Import error: ' + msg.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = tab.btnText; }
    if (lastScrapedData) showDownloadButton();
  }

  if (msg.type === 'scrape-error') {
    hideStopButton();
    addLog('Scrape error: ' + msg.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = tab.btnText; }
  }
});

// ── Tab switcher ──────────────────────────────────────────────────────────

document.querySelectorAll('.mode-toggle .mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === activeTab) return;
    activeTab = btn.dataset.mode;
    document.querySelectorAll('.mode-toggle .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    hideRoutePicker();
    renderTab();
  });
});

// ── Clear button ──────────────────────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';
  const btn = document.getElementById('importBtn');
  if (btn) { btn.disabled = false; btn.textContent = TABS[activeTab].btnText; }
  hideRoutePicker();
});

// ── Init ──────────────────────────────────────────────────────────────────

renderTab();
document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';

// Side panel script — detects site on active tab and shows the correct import button

// WebSnak checked FIRST — its URL (wsweb3.daogroup.com/websnak/) also contains "daogroup.com"
const SITES = [
  {
    key: 'websnak',
    match: (url) => url.includes('websnak') || url.includes('web-snak'),
    label: 'WebSnak',
    badgeClass: 'site-websnak',
    btnClass: 'btn-websnak',
    btnText: 'Import WebSnak Stores',
    script: 'scrape-websnak.js',
    extraButtons: [
      {
        key: 'invoices',
        btnClass: 'btn-invoices',
        btnText: 'Import Store Invoices',
        script: 'scrape-invoices.js',
        needsRoute: true,
      },
    ],
  },
  {
    key: 'dao',
    match: (url) => url.includes('daogroup.com') || url.includes('dao-group.com'),
    label: 'DAO Dashboard',
    badgeClass: 'site-dao',
    // btnClass / btnText / script are mode-dependent — see daoModes below
  },
];

const APP_URL_PATTERNS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://mahpour4.github.io/Map-tracker',
];

const DAO_MODES = {
  dao: {
    btnClass: 'btn-dao',
    btnText: 'Import DAO Dashboard',
    script: 'scrape-dao.js',
  },
  cb: {
    btnClass: 'btn-cb-inquiry',
    btnText: 'Download CB Invoice Inquiry',
    script: 'scrape-cb-inquiry.js',
  },
};

let currentDetected = null;
let currentTabId = null;
let lastScrapedData = null;
let daoMode = 'dao'; // 'dao' | 'cb'

function addLog(msg, type) {
  const log = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;

  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<div>${msg}</div><div class="log-time">${time}</div>`;

  if (log.firstChild) {
    log.insertBefore(entry, log.firstChild);
  } else {
    log.appendChild(entry);
  }

  const empty = log.querySelector('.empty-log');
  if (empty) empty.remove();
}

function detectSite(url) {
  for (const site of SITES) {
    if (site.match(url)) return site;
  }
  return null;
}

function updateUI(tab) {
  const url = (tab?.url || '').toLowerCase();
  const content = document.getElementById('content');
  const buttonArea = document.getElementById('button-area');
  currentTabId = tab?.id;

  currentDetected = detectSite(url);
  hideRoutePicker();

  if (!currentDetected) {
    content.innerHTML = `
      <div class="site-card">
        <span class="site-badge site-unknown">Unknown Site</span>
        <div class="site-url">${tab?.url || 'No URL'}</div>
      </div>
    `;
    buttonArea.innerHTML = `
      <p class="unknown-msg">
        Navigate to the <strong>DAO Dashboard</strong> or <strong>WebSnak</strong> to import data.
      </p>
    `;
    return;
  }

  content.innerHTML = `
    <div class="site-card">
      <span class="site-badge ${currentDetected.badgeClass}">${currentDetected.label}</span>
      <div class="site-url">${tab?.url || ''}</div>
    </div>
  `;

  if (currentDetected.key === 'dao') {
    renderDaoButtons(buttonArea);
  } else {
    const eb = currentDetected.extraButtons;
    let buttonsHtml = `<button id="importBtn" class="btn ${currentDetected.btnClass}">${currentDetected.btnText}</button>`;
    if (eb) {
      eb.forEach((b, i) => {
        buttonsHtml += `\n    <button id="extraBtn${i}" class="btn ${b.btnClass}" data-script="${b.script}" data-key="${b.key}">${b.btnText}</button>`;
      });
    }
    buttonsHtml += `<div id="routePicker" style="display:none"></div>`;
    buttonArea.innerHTML = buttonsHtml;

    document.getElementById('importBtn').addEventListener('click', handleImportClick);
    if (eb) {
      eb.forEach((b, i) => {
        document.getElementById(`extraBtn${i}`).addEventListener('click', () => handleExtraImport(b, i));
      });
    }
  }
}

function renderDaoButtons(buttonArea) {
  const mode = DAO_MODES[daoMode];
  buttonArea.innerHTML = `
    <button id="importBtn" class="btn ${mode.btnClass}">${mode.btnText}</button>
    <div id="routePicker" style="display:none"></div>
  `;
  document.getElementById('importBtn').addEventListener('click', handleImportClick);
}

function handleImportClick() {
  if (!currentDetected || !currentTabId) return;

  const modeConfig = currentDetected.key === 'dao' ? DAO_MODES[daoMode] : currentDetected;
  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  btn.textContent = 'Scraping...';
  addLog('Running ' + modeConfig.btnText + '...', 'info');

  chrome.scripting.executeScript(
    {
      target: { tabId: currentTabId, allFrames: true },
      files: [modeConfig.script],
    },
    (results) => {
      if (chrome.runtime.lastError) {
        addLog('Error: ' + chrome.runtime.lastError.message, 'error');
        btn.disabled = false;
        btn.textContent = modeConfig.btnText;
      }
    }
  );
}

function handleExtraImport(extraBtn, index) {
  if (!currentTabId) return;

  if (extraBtn.needsRoute) {
    showRoutePicker(extraBtn, index);
    return;
  }

  launchExtraScraper(extraBtn, index);
}

function launchExtraScraper(extraBtn, index, storeList) {
  const btn = document.getElementById(`extraBtn${index}`);
  btn.disabled = true;
  btn.textContent = 'Scraping...';
  addLog('Running ' + extraBtn.key + ' scraper...', 'info');

  showStopButton();

  const doInject = () => {
    chrome.scripting.executeScript(
      {
        target: { tabId: currentTabId, allFrames: true },
        files: [extraBtn.script],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          addLog('Error: ' + chrome.runtime.lastError.message, 'error');
          btn.disabled = false;
          btn.textContent = extraBtn.btnText;
        }
      }
    );
  };

  if (storeList && storeList.length > 0) {
    // Set the store list in sessionStorage on the target tab before injecting the scraper
    chrome.scripting.executeScript(
      {
        target: { tabId: currentTabId, allFrames: true },
        world: 'MAIN',
        func: (stores) => {
          try {
            localStorage.setItem('invoice-scraper-stores', JSON.stringify(stores));
          } catch (e) { console.error('[Invoice Scraper] Failed to set store list', e); }
        },
        args: [storeList],
      },
      () => {
        if (chrome.runtime.lastError) {
          addLog('Error setting store list: ' + chrome.runtime.lastError.message, 'error');
          btn.disabled = false;
          btn.textContent = extraBtn.btnText;
          return;
        }
        doInject();
      }
    );
  } else {
    doInject();
  }
}

// ── Stop Button ───────────────────────────────────────────────────────────

function showStopButton() {
  const buttonArea = document.getElementById('button-area');
  if (document.getElementById('stopBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'stopBtn';
  btn.className = 'btn btn-stop';
  btn.textContent = 'Stop Scraping';
  btn.addEventListener('click', () => {
    addLog('Sending stop signal...', 'info');
    // Set stop flag on the WebSnak tab via localStorage
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
  const btn = document.getElementById('stopBtn');
  if (btn) btn.remove();
}

// ── Route Picker ──────────────────────────────────────────────────────────

function hideRoutePicker() {
  const picker = document.getElementById('routePicker');
  if (picker) picker.style.display = 'none';
}

async function showRoutePicker(extraBtn, index) {
  const picker = document.getElementById('routePicker');
  if (!picker) return;

  picker.style.display = 'block';
  picker.innerHTML = '<div class="route-loading">Loading routes from Map Tracker...</div>';
  addLog('Fetching store list from Map Tracker...', 'info');

  try {
    const storeData = await fetchStoresFromApp();
    if (!storeData || storeData.length === 0) {
      // Map Tracker not open — offer scrape current search only
      picker.innerHTML = `
        <div class="route-error" style="margin-bottom:8px">Map Tracker not open — no store list available.</div>
        <div class="route-grid">
          <button class="route-btn route-current">Scrape Current Search</button>
          <button class="route-btn route-cancel">Cancel</button>
        </div>`;
      picker.querySelector('.route-current').addEventListener('click', () => {
        picker.style.display = 'none';
        launchExtraScraper(extraBtn, index, null);
      });
      picker.querySelector('.route-cancel').addEventListener('click', () => {
        picker.style.display = 'none';
      });
      addLog('Map Tracker not open — will scrape current page only', 'info');
      return;
    }

    // Group by route
    const routes = {};
    for (const s of storeData) {
      const route = s.route || 'Unassigned';
      if (!routes[route]) routes[route] = [];
      routes[route].push(s);
    }

    // Sort route numbers
    const sortedRoutes = Object.keys(routes).sort((a, b) => {
      const na = parseInt(a), nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return a.localeCompare(b);
    });

    let html = '<div class="route-header">Select Route to Scrape</div>';
    html += '<div class="route-grid">';
    // "All Routes" button
    const allActive = storeData.filter(s => s.route && s.route !== 'Unassigned' && !s.dormant);
    html += `<button class="route-btn route-all" data-route="__ALL__">All<br><span class="route-count">${allActive.length} stores</span></button>`;
    // "Current Page" button — scrape whatever is showing without searching
    html += `<button class="route-btn route-current" data-route="__CURRENT__">Current<br><span class="route-count">page only</span></button>`;
    for (const route of sortedRoutes) {
      if (route === 'Unassigned' || !route) continue;
      const stores = routes[route];
      const activeStores = stores.filter(s => !s.dormant);
      html += `<button class="route-btn" data-route="${route}">Rt ${route}<br><span class="route-count">${activeStores.length} active</span></button>`;
    }
    html += '</div>';
    html += '<button class="route-cancel" id="routeCancel">Cancel</button>';

    picker.innerHTML = html;

    // Wire up buttons
    picker.querySelectorAll('.route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;

        if (route === '__CURRENT__') {
          // Legacy mode — no store list, scrape current page
          addLog('Scraping current page (no store search)', 'info');
          hideRoutePicker();
          launchExtraScraper(extraBtn, index, null);
          return;
        }

        let selectedStores;
        if (route === '__ALL__') {
          selectedStores = storeData.filter(s => s.route && s.route !== 'Unassigned' && !s.dormant);
        } else {
          selectedStores = routes[route].filter(s => !s.dormant);
        }

        // Extract store numbers for searching
        const storeList = selectedStores.map(s => {
          // Extract numeric part from ID (e.g. FLW01668 → 01668)
          const numMatch = (s.id || '').match(/\d+$/);
          return {
            storeId: s.id,
            storeNum: numMatch ? numMatch[0] : s.id,
          };
        });

        const routeLabel = route === '__ALL__' ? 'all routes' : `Route ${route}`;
        addLog(`Selected ${routeLabel}: ${storeList.length} stores`, 'info');
        hideRoutePicker();
        launchExtraScraper(extraBtn, index, storeList);
      });
    });

    document.getElementById('routeCancel').addEventListener('click', hideRoutePicker);

  } catch (err) {
    picker.innerHTML = `<div class="route-error">Error: ${err.message}</div>`;
    addLog('Error fetching stores: ' + err.message, 'error');
  }
}

/**
 * Fetch store list from the Map Tracker app by reading its localStorage.
 */
async function fetchStoresFromApp() {
  const tabs = await chrome.tabs.query({});
  let appTab = null;

  for (const tab of tabs) {
    const url = (tab.url || '').toLowerCase();
    for (const pattern of APP_URL_PATTERNS) {
      if (url.startsWith(pattern.toLowerCase())) {
        appTab = tab;
        break;
      }
    }
    if (appTab) break;
  }

  if (!appTab) {
    return null; // Map Tracker not open — caller handles fallback
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: appTab.id },
    world: 'MAIN',
    func: () => {
      try {
        // Try known keys
        const tryKeys = ['MAP_TRACKER_STORES', 'map-tracker-stores'];
        for (const key of tryKeys) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length > 0 && data[0].id) {
              return data.map(s => ({
                id: s.id,
                route: s.routeNumber || s.route || '',
                dormant: s.dormant === 'Yes' || s.dormant === true,
                name: s.name || s.storeName || '',
              }));
            }
          } catch (e) { /* skip */ }
        }
        // Scan all keys for any that contain store data
        for (const key of Object.keys(localStorage)) {
          if (key.toLowerCase().includes('store')) {
            try {
              const data = JSON.parse(localStorage.getItem(key));
              if (Array.isArray(data) && data.length > 5 && data[0].id) {
                return data.map(s => ({
                  id: s.id,
                  route: s.routeNumber || s.route || '',
                  dormant: s.dormant === 'Yes' || s.dormant === true,
                  name: s.name || s.storeName || '',
                }));
              }
            } catch (e) { /* skip */ }
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    },
  });

  if (results && results[0] && results[0].result) {
    return results[0].result;
  }

  throw new Error('Could not read store data from Map Tracker.');
}

// ── Tab Events ────────────────────────────────────────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) updateUI(tabs[0]);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) updateUI(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === currentTabId) {
    updateUI(tab);
  }
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
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  addLog(`Downloaded ${lastScrapedData.count} records as ${filename}`, 'success');
}

// ── Message listener ──────────────────────────────────────────────────────

function getActiveBtnText() {
  if (!currentDetected) return 'Done!';
  if (currentDetected.key === 'dao') return DAO_MODES[daoMode].btnText;
  return currentDetected.btnText;
}

function resetExtraButtons() {
  if (currentDetected?.extraButtons) {
    currentDetected.extraButtons.forEach((eb, i) => {
      const eBtn = document.getElementById(`extraBtn${i}`);
      if (eBtn) { eBtn.disabled = false; eBtn.textContent = eb.btnText; }
    });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  const btn = document.getElementById('importBtn');

  if (msg.type === 'scrape-progress') {
    addLog(msg.message, 'info');
  }

  if (msg.type === 'scrape-done') {
    hideStopButton();
    lastScrapedData = { source: msg.source, data: msg.data, count: msg.count, ts: Date.now() };

    // Invoices / CB inquiry: always download as JSON — no Map Tracker required
    if (msg.source === 'invoices' || msg.source === 'cb-inquiry') {
      addLog(`Scraped ${msg.count} records. Downloading JSON...`, 'info');
      downloadScrapedData();
      if (btn) {
        btn.disabled = false;
        btn.textContent = getActiveBtnText();
      }
      resetExtraButtons();
      return;
    }

    addLog(`Scraped ${msg.count} records. Sending to Map Tracker...`, 'info');
    chrome.runtime.sendMessage({
      type: 'import-to-app',
      source: msg.source,
      data: msg.data,
    });
  }

  if (msg.type === 'import-complete') {
    addLog(`Done! ${msg.count} records imported into Map Tracker.`, 'success');
    lastScrapedData = null;
    const dlBtn = document.getElementById('downloadBtn');
    if (dlBtn) dlBtn.remove();
    if (btn) {
      btn.disabled = false;
      btn.textContent = getActiveBtnText();
    }
    resetExtraButtons();
  }

  if (msg.type === 'import-error') {
    addLog('Import error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      if (currentDetected) btn.textContent = getActiveBtnText();
    }
    if (lastScrapedData) showDownloadButton();
    resetExtraButtons();
  }

  if (msg.type === 'scrape-error') {
    hideStopButton();
    addLog('Scrape error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      if (currentDetected) btn.textContent = getActiveBtnText();
    }
    resetExtraButtons();
  }
});

// Clear / reset button
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';
  const btn = document.getElementById('importBtn');
  if (btn && currentDetected) {
    btn.disabled = false;
    btn.textContent = getActiveBtnText();
  }
  hideRoutePicker();
});

// ── Mode toggle (header) ──────────────────────────────────────────────────
document.querySelectorAll('.mode-toggle .mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === daoMode) return;
    daoMode = btn.dataset.mode;
    // Update active state
    document.querySelectorAll('.mode-toggle .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Re-render button area if currently on a DAO page
    if (currentDetected?.key === 'dao') {
      renderDaoButtons(document.getElementById('button-area'));
    }
  });
});

// Show empty state initially
document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';

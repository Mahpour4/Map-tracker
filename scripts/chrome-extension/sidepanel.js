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
  },
  {
    key: 'dao',
    match: (url) => url.includes('daogroup.com') || url.includes('dao-group.com'),
    label: 'DAO Dashboard',
    badgeClass: 'site-dao',
    btnClass: 'btn-dao',
    btnText: 'Import DAO Dashboard',
    script: 'scrape-dao.js',
  },
];

let currentDetected = null;
let currentTabId = null;
let lastScrapedData = null; // Store last scrape for download fallback

function addLog(msg, type) {
  const log = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + type;

  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<div>${msg}</div><div class="log-time">${time}</div>`;

  // Insert at top
  if (log.firstChild) {
    log.insertBefore(entry, log.firstChild);
  } else {
    log.appendChild(entry);
  }

  // Remove empty state
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

  buttonArea.innerHTML = `
    <button id="importBtn" class="btn ${currentDetected.btnClass}">${currentDetected.btnText}</button>
  `;

  document.getElementById('importBtn').addEventListener('click', handleImportClick);
}

function handleImportClick() {
  if (!currentDetected || !currentTabId) return;

  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  btn.textContent = 'Scraping...';
  addLog('Running ' + currentDetected.label + ' scraper...', 'info');

  chrome.scripting.executeScript(
    {
      target: { tabId: currentTabId, allFrames: true },
      files: [currentDetected.script],
    },
    (results) => {
      if (chrome.runtime.lastError) {
        addLog('Error: ' + chrome.runtime.lastError.message, 'error');
        btn.disabled = false;
        btn.textContent = currentDetected.btnText;
      }
    }
  );
}

// Initial load — get active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) updateUI(tabs[0]);
});

// Update when user switches tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab) updateUI(tab);
  });
});

// Update when tab URL changes (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === currentTabId) {
    updateUI(tab);
  }
});

function showDownloadButton() {
  const buttonArea = document.getElementById('button-area');
  // Don't add duplicate download buttons
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

// Listen for messages from content scripts and background
chrome.runtime.onMessage.addListener((msg) => {
  const btn = document.getElementById('importBtn');

  if (msg.type === 'scrape-progress') {
    addLog(msg.message, 'info');
  }

  if (msg.type === 'scrape-done') {
    // Store for download fallback
    lastScrapedData = { source: msg.source, data: msg.data, count: msg.count, ts: Date.now() };
    addLog(`Scraped ${msg.count} records. Sending to Map Tracker...`, 'info');

    // Send to background to relay to the app
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
      btn.textContent = currentDetected ? currentDetected.btnText : 'Done!';
    }
  }

  if (msg.type === 'import-error') {
    addLog('Import error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      if (currentDetected) btn.textContent = currentDetected.btnText;
    }
    // Show download button as fallback
    if (lastScrapedData) showDownloadButton();
  }

  if (msg.type === 'scrape-error') {
    addLog('Scrape error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      if (currentDetected) btn.textContent = currentDetected.btnText;
    }
  }
});

// Clear / reset button
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';
  const btn = document.getElementById('importBtn');
  if (btn && currentDetected) {
    btn.disabled = false;
    btn.textContent = currentDetected.btnText;
  }
});

// Show empty state initially
document.getElementById('log').innerHTML = '<div class="empty-log">No activity yet</div>';

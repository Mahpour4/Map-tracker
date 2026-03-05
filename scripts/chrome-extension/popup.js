// Detect which site the active tab is on and show the correct button

// WebSnak must be checked FIRST — its URL (wsweb3.daogroup.com/websnak/) also contains "daogroup.com"
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

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status show ' + type;
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const url = (tab?.url || '').toLowerCase();
  const content = document.getElementById('content');

  // Find which site we're on (order matters — websnak checked first)
  let detected = null;
  for (const site of SITES) {
    if (site.match(url)) {
      detected = site;
      break;
    }
  }

  if (!detected) {
    content.innerHTML = `
      <span class="site-badge site-unknown">Unknown Site</span>
      <p class="unknown-msg">
        Navigate to the <strong>DAO Dashboard</strong> or <strong>WebSnak</strong> and then open this extension.
      </p>
    `;
    return;
  }

  // Show detected site badge and import button
  content.innerHTML = `
    <span class="site-badge ${detected.badgeClass}">${detected.label}</span>
    <button id="importBtn" class="btn ${detected.btnClass}">${detected.btnText}</button>
  `;

  document.getElementById('importBtn').addEventListener('click', () => {
    const btn = document.getElementById('importBtn');
    btn.disabled = true;
    btn.textContent = 'Scraping...';
    setStatus('Running scraper on page...', 'info');

    // Inject the scraper content script into the active tab (allFrames for iframe support)
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id, allFrames: true },
        files: [detected.script],
      },
      (results) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
          btn.disabled = false;
          btn.textContent = detected.btnText;
        }
        // The scraper script will send results back via chrome.runtime.sendMessage
      }
    );
  });
});

// Listen for messages from the content scripts
chrome.runtime.onMessage.addListener((msg) => {
  const btn = document.getElementById('importBtn');

  if (msg.type === 'scrape-progress') {
    setStatus(msg.message, 'info');
  }

  if (msg.type === 'scrape-done') {
    setStatus(`Scraped ${msg.count} records. Sending to Map Tracker...`, 'info');

    // Send to background to relay to the app
    chrome.runtime.sendMessage({
      type: 'import-to-app',
      source: msg.source,
      data: msg.data,
    });
  }

  if (msg.type === 'import-complete') {
    setStatus(`Done! ${msg.count} records imported into Map Tracker.`, 'success');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Done!';
    }
  }

  if (msg.type === 'import-error') {
    setStatus('Error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      const site = SITES.find(s => s.key === msg.source);
      if (site) btn.textContent = site.btnText;
    }
  }

  if (msg.type === 'scrape-error') {
    setStatus('Scrape error: ' + msg.message, 'error');
    if (btn) {
      btn.disabled = false;
      const site = SITES.find(s => s.key === msg.source);
      if (site) btn.textContent = site.btnText;
    }
  }
});

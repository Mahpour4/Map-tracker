// Background service worker
// Opens side panel on icon click, relays scraped data to Map Tracker app
// Delays activation by 1 minute after Chrome starts to avoid slowing startup
// Does NOT inject scripts into the app tab — uses localStorage instead

const APP_URL_PATTERNS = [
  'http://localhost:',
  'http://127.0.0.1:',
  'https://mahpour4.github.io/Map-tracker',
];

// Disable extension for the first 60 seconds after Chrome starts
let ready = false;
chrome.action.disable();
setTimeout(() => {
  ready = true;
  chrome.action.enable();
}, 60000);

// Open side panel when clicking the extension icon (only after warmup)
chrome.action.onClicked.addListener((tab) => {
  if (!ready) return;
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle import-to-app messages from the side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'import-to-app') return;

  // Store the scraped data so the app can pick it up
  // The app polls localStorage for MAP_TRACKER_EXT_IMPORT
  findOrOpenAppTab().then((tab) => {
    // Set localStorage on the app's origin via a minimal cookie-based approach
    // Use executeScript ONLY to set one localStorage key — nothing else
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (source, data) => {
        // ONLY set localStorage — do not touch anything else
        try {
          localStorage.setItem('MAP_TRACKER_EXT_IMPORT', JSON.stringify({ source, data, ts: Date.now() }));
        } catch (e) {
          console.error('Map Tracker extension: failed to set import data', e);
        }
      },
      args: [msg.source, msg.data],
    }).then(() => {
      chrome.runtime.sendMessage({
        type: 'import-complete',
        source: msg.source,
        count: Array.isArray(msg.data) ? msg.data.length : 0,
      });
    }).catch((err) => {
      chrome.runtime.sendMessage({
        type: 'import-error',
        source: msg.source,
        message: err.message,
      });
    });
  }).catch((err) => {
    chrome.runtime.sendMessage({
      type: 'import-error',
      source: msg.source,
      message: 'Could not find or open Map Tracker: ' + err.message,
    });
  });
});

// Find an existing Map Tracker tab or open a new one
async function findOrOpenAppTab() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    const url = (tab.url || '').toLowerCase();
    for (const pattern of APP_URL_PATTERNS) {
      if (url.startsWith(pattern)) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return tab;
      }
    }
  }

  // No existing tab — open the local dev server
  const newTab = await chrome.tabs.create({ url: 'http://localhost:5174' });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 15000);

    function listener(tabId, changeInfo) {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        setTimeout(() => resolve(newTab), 1000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

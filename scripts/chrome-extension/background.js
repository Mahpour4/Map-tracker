// Background service worker
// Opens side panel on icon click, relays scraped data to Map Tracker app

const APP_URL_PATTERNS = [
  'http://localhost:',
  'http://127.0.0.1:',
  'https://mahpour4.github.io/Map-tracker',
];

// Open side panel when clicking the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle import-to-app messages from the side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'import-to-app') return;

  findOrOpenAppTab().then((tab) => {
    // Inject a small script that posts the data to the React app via window.postMessage
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: deliverData,
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

  // No existing tab — open localhost:5173 (Vite default)
  const newTab = await chrome.tabs.create({ url: 'http://localhost:5173' });

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

// This function runs in the Map Tracker tab's context
function deliverData(source, data) {
  window.postMessage({
    type: 'MAP_TRACKER_IMPORT',
    source: source,
    data: data,
  }, '*');
}

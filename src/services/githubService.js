const REPO_OWNER = 'Mahpour4';
const REPO_NAME = 'Map-tracker';
const FILE_PATH = 'src/data/stores.csv';
const ALERTS_FILE_PATH = 'src/data/alerts.csv';
const SCHEDULES_FILE_PATH = 'src/data/schedules.json';
const IMPORTLOG_FILE_PATH = 'src/data/importLog.json';
const VISITHISTORY_FILE_PATH = 'src/data/visitHistory.json';
const WAREHOUSES_FILE_PATH = 'src/data/warehouses.json';
const TRAVELLOG_FILE_PATH = 'src/data/travelLog.json';
const ADDRESS_OVERRIDES_FILE_PATH = 'src/data/addressOverrides.json';
const CUSTOM_LOCATIONS_FILE_PATH = 'src/data/customLocations.json';
const TRANSACTIONS_FILE_PATH = 'src/data/transactions.json';
const WAREHOUSE_ORDERS_FILE_PATH = 'src/data/warehouseOrders.json';
const INVENTORY_FILE_PATH = 'src/data/inventoryData.json';
const WA_CONFIG_FILE_PATH  = 'src/data/waConfig.json';
const API_BASE = 'https://api.github.com';

const TOKEN_KEY = 'github_pat';
const SHA_KEY = 'github_file_sha';
const ALERTS_SHA_KEY = 'github_alerts_sha';
const SCHEDULES_SHA_KEY = 'github_schedules_sha';
const IMPORTLOG_SHA_KEY = 'github_importlog_sha';
const VISITHISTORY_SHA_KEY = 'github_visithistory_sha';
const WAREHOUSES_SHA_KEY = 'github_warehouses_sha';
const TRAVELLOG_SHA_KEY = 'github_travellog_sha';
const ADDRESS_OVERRIDES_SHA_KEY = 'github_addressoverrides_sha';
const CUSTOM_LOCATIONS_SHA_KEY = 'github_customlocations_sha';
const TRANSACTIONS_SHA_KEY = 'github_transactions_sha';
const WAREHOUSE_ORDERS_SHA_KEY = 'github_warehouseorders_sha';
const INVENTORY_SHA_KEY   = 'github_inventory_sha';
const WA_CONFIG_SHA_KEY   = 'github_waconfig_sha';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SHA_KEY);
}

function getSavedSha() {
  return localStorage.getItem(SHA_KEY) || '';
}

function saveSha(sha) {
  localStorage.setItem(SHA_KEY, sha);
}

function headers() {
  const token = getToken();
  if (!token) throw new Error('No GitHub token configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
}

/**
 * Serialize all GitHub writes through a queue so only one PUT
 * runs at a time, preventing concurrent SHA conflicts.
 */
let saveQueue = Promise.resolve();

/**
 * PUT content to a GitHub file with retry on 409 SHA conflict.
 * Serialized through saveQueue to prevent concurrent write conflicts.
 * Always fetches fresh SHA before each attempt to avoid stale cache.
 */
async function githubPutWithRetry({ url, encoded, message, sha, fetchFn, saveShaFn, maxRetries = 5 }) {
  const doSave = async () => {
    let currentSha = sha;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // On retry (or if sha looks stale), fetch fresh SHA
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 300 * attempt + Math.random() * 200));
        const fresh = await fetchFn();
        currentSha = fresh.sha;
      }
      const body = { message, content: encoded };
      if (currentSha) body.sha = currentSha;
      const res = await fetch(url, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        saveShaFn(data.content.sha);
        return data;
      }
      if (res.status === 409 && attempt < maxRetries) {
        continue;
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub save failed: ${res.status}`);
    }
  };
  // Queue this save so it waits for any in-flight save to finish first
  saveQueue = saveQueue.catch(() => {}).then(doSave);
  return saveQueue;
}

/**
 * Fetch stores.csv content from GitHub.
 * Returns { content: string, sha: string } or throws.
 */
export async function fetchStoresCsv() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveSha(data.sha);
  return { content, sha: data.sha };
}

/**
 * Write updated CSV content back to GitHub.
 * Uses the stored SHA for the update (required by GitHub API).
 */
export async function saveStoresCsv(csvContent, message) {
  let sha = getSavedSha();
  if (!sha) {
    const current = await fetchStoresCsv();
    sha = current.sha;
  }
  const encoded = btoa(unescape(encodeURIComponent(csvContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    encoded,
    message: message || 'Update stores.csv from Map Tracker app',
    sha,
    fetchFn: fetchStoresCsv,
    saveShaFn: saveSha,
  });
}

// ---- Alerts CSV (GitHub sync) ----

function getAlertsSha() {
  return localStorage.getItem(ALERTS_SHA_KEY) || '';
}

function saveAlertsSha(sha) {
  localStorage.setItem(ALERTS_SHA_KEY, sha);
}

export async function fetchAlertsCsv() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ALERTS_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    // File doesn't exist yet — return empty
    return { content: '', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveAlertsSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveAlertsCsv(csvContent, message) {
  const sha = getAlertsSha();
  const encoded = btoa(unescape(encodeURIComponent(csvContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ALERTS_FILE_PATH}`,
    encoded,
    message: message || 'Update alerts.csv from Map Tracker app',
    sha,
    fetchFn: fetchAlertsCsv,
    saveShaFn: saveAlertsSha,
  });
}

// ---- Schedules JSON (GitHub sync) ----

function getSchedulesSha() {
  return localStorage.getItem(SCHEDULES_SHA_KEY) || '';
}

function saveSchedulesSha(sha) {
  localStorage.setItem(SCHEDULES_SHA_KEY, sha);
}

export async function fetchSchedulesJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SCHEDULES_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveSchedulesSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveSchedulesJson(jsonContent, message) {
  let sha = getSchedulesSha();
  if (!sha) {
    try { sha = (await fetchSchedulesJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SCHEDULES_FILE_PATH}`,
    encoded,
    message: message || 'Update schedules.json from Map Tracker app',
    sha,
    fetchFn: fetchSchedulesJson,
    saveShaFn: saveSchedulesSha,
  });
}

// ---- Import Log JSON (GitHub sync) ----

function getImportLogSha() {
  return localStorage.getItem(IMPORTLOG_SHA_KEY) || '';
}

function saveImportLogSha(sha) {
  localStorage.setItem(IMPORTLOG_SHA_KEY, sha);
}

export async function fetchImportLog() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMPORTLOG_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '[]', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveImportLogSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveImportLog(jsonContent, message) {
  let sha = getImportLogSha();
  if (!sha) {
    try { sha = (await fetchImportLog()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMPORTLOG_FILE_PATH}`,
    encoded,
    message: message || 'Update importLog.json from Map Tracker app',
    sha,
    fetchFn: fetchImportLog,
    saveShaFn: saveImportLogSha,
  });
}

// ---- Visit History JSON (GitHub sync) ----

function getVisitHistorySha() {
  return localStorage.getItem(VISITHISTORY_SHA_KEY) || '';
}

function saveVisitHistorySha(sha) {
  localStorage.setItem(VISITHISTORY_SHA_KEY, sha);
}

export async function fetchVisitHistoryJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${VISITHISTORY_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveVisitHistorySha(data.sha);
  return { content, sha: data.sha };
}

export async function saveVisitHistoryJson(jsonContent, message) {
  let sha = getVisitHistorySha();
  if (!sha) {
    try { sha = (await fetchVisitHistoryJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${VISITHISTORY_FILE_PATH}`,
    encoded,
    message: message || 'Update visitHistory.json from Map Tracker app',
    sha,
    fetchFn: fetchVisitHistoryJson,
    saveShaFn: saveVisitHistorySha,
  });
}

// ---- Warehouses JSON (GitHub sync) ----

function getWarehousesSha() {
  return localStorage.getItem(WAREHOUSES_SHA_KEY) || '';
}

function saveWarehousesSha(sha) {
  localStorage.setItem(WAREHOUSES_SHA_KEY, sha);
}

export async function fetchWarehousesJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WAREHOUSES_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '[]', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveWarehousesSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveWarehousesJson(jsonContent, message) {
  let sha = getWarehousesSha();
  if (!sha) {
    try { sha = (await fetchWarehousesJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WAREHOUSES_FILE_PATH}`,
    encoded,
    message: message || 'Update warehouses.json from Map Tracker app',
    sha,
    fetchFn: fetchWarehousesJson,
    saveShaFn: saveWarehousesSha,
  });
}

// ---- Travel Log JSON (GitHub sync) ----

function getTravelLogSha() {
  return localStorage.getItem(TRAVELLOG_SHA_KEY) || '';
}

function saveTravelLogSha(sha) {
  localStorage.setItem(TRAVELLOG_SHA_KEY, sha);
}

export async function fetchTravelLogJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TRAVELLOG_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveTravelLogSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveTravelLogJson(jsonContent, message) {
  let sha = getTravelLogSha();
  if (!sha) {
    try { sha = (await fetchTravelLogJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TRAVELLOG_FILE_PATH}`,
    encoded,
    message: message || 'Update travelLog.json from Map Tracker app',
    sha,
    fetchFn: fetchTravelLogJson,
    saveShaFn: saveTravelLogSha,
  });
}

// ---- Address Overrides JSON (GitHub sync) ----

function getAddressOverridesSha() {
  return localStorage.getItem(ADDRESS_OVERRIDES_SHA_KEY) || '';
}

function saveAddressOverridesSha(sha) {
  localStorage.setItem(ADDRESS_OVERRIDES_SHA_KEY, sha);
}

export async function fetchAddressOverridesJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ADDRESS_OVERRIDES_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveAddressOverridesSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveAddressOverridesJson(jsonContent, message) {
  let sha = getAddressOverridesSha();
  if (!sha) {
    try { sha = (await fetchAddressOverridesJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ADDRESS_OVERRIDES_FILE_PATH}`,
    encoded,
    message: message || 'Update addressOverrides.json from Map Tracker app',
    sha,
    fetchFn: fetchAddressOverridesJson,
    saveShaFn: saveAddressOverridesSha,
  });
}

// ---- Custom Locations JSON (GitHub sync) ----

function getCustomLocationsSha() {
  return localStorage.getItem(CUSTOM_LOCATIONS_SHA_KEY) || '';
}

function saveCustomLocationsSha(sha) {
  localStorage.setItem(CUSTOM_LOCATIONS_SHA_KEY, sha);
}

export async function fetchCustomLocationsJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CUSTOM_LOCATIONS_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '[]', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveCustomLocationsSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveCustomLocationsJson(jsonContent, message) {
  let sha = getCustomLocationsSha();
  if (!sha) {
    try { sha = (await fetchCustomLocationsJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CUSTOM_LOCATIONS_FILE_PATH}`,
    encoded,
    message: message || 'Update customLocations.json from Map Tracker app',
    sha,
    fetchFn: fetchCustomLocationsJson,
    saveShaFn: saveCustomLocationsSha,
  });
}

// ---- Transactions JSON (GitHub sync) ----

function getTransactionsSha() {
  return localStorage.getItem(TRANSACTIONS_SHA_KEY) || '';
}

function saveTransactionsSha(sha) {
  localStorage.setItem(TRANSACTIONS_SHA_KEY, sha);
}

export async function fetchTransactionsJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TRANSACTIONS_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '[]', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveTransactionsSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveTransactionsJson(jsonContent, message) {
  let sha = getTransactionsSha();
  if (!sha) {
    try { sha = (await fetchTransactionsJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${TRANSACTIONS_FILE_PATH}`,
    encoded,
    message: message || 'Update transactions.json from Map Tracker app',
    sha,
    fetchFn: fetchTransactionsJson,
    saveShaFn: saveTransactionsSha,
  });
}

// ---- Warehouse Orders JSON (GitHub sync) ----

function getWarehouseOrdersSha() {
  return localStorage.getItem(WAREHOUSE_ORDERS_SHA_KEY) || '';
}

function saveWarehouseOrdersSha(sha) {
  localStorage.setItem(WAREHOUSE_ORDERS_SHA_KEY, sha);
}

export async function fetchWarehouseOrdersJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WAREHOUSE_ORDERS_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{"orders":[],"lastSyncedAt":null}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveWarehouseOrdersSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveWarehouseOrdersJson(jsonContent, message) {
  let sha = getWarehouseOrdersSha();
  if (!sha) {
    try { sha = (await fetchWarehouseOrdersJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WAREHOUSE_ORDERS_FILE_PATH}`,
    encoded,
    message: message || 'Update warehouseOrders.json from Map Tracker app',
    sha,
    fetchFn: fetchWarehouseOrdersJson,
    saveShaFn: saveWarehouseOrdersSha,
  });
}

// ---- Inventory JSON (GitHub sync) ----

function getInventorySha() { return localStorage.getItem(INVENTORY_SHA_KEY) || ''; }
function saveInventorySha(sha) { localStorage.setItem(INVENTORY_SHA_KEY, sha); }

export async function fetchInventoryJson() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${INVENTORY_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );
  if (res.status === 404) return { content: '{"items":{},"lastUpdated":null}', sha: '' };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveInventorySha(data.sha);
  return { content, sha: data.sha };
}

export async function saveInventoryJson(jsonContent, message) {
  let sha = getInventorySha();
  if (!sha) {
    try { sha = (await fetchInventoryJson()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${INVENTORY_FILE_PATH}`,
    encoded,
    message: message || 'Update inventoryData.json from Map Tracker app',
    sha,
    fetchFn: fetchInventoryJson,
    saveShaFn: saveInventorySha,
  });
}

// ---- Map Snapshot JSON (GitHub Pages publish) ----

const SNAPSHOT_FILE_PATH = 'docs/data/map-snapshot.json';
const SNAPSHOT_SHA_KEY = 'github_snapshot_sha';

function getSnapshotSha() {
  return localStorage.getItem(SNAPSHOT_SHA_KEY) || '';
}

function saveSnapshotSha(sha) {
  localStorage.setItem(SNAPSHOT_SHA_KEY, sha);
}

export async function fetchMapSnapshot() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SNAPSHOT_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );

  if (res.status === 404) {
    return { content: '{}', sha: '' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }

  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveSnapshotSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveMapSnapshot(jsonContent, message) {
  let sha = getSnapshotSha();
  if (!sha) {
    try { sha = (await fetchMapSnapshot()).sha; } catch { /* file may not exist */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SNAPSHOT_FILE_PATH}`,
    encoded,
    message: message || 'Publish map snapshot for GitHub Pages',
    sha,
    fetchFn: fetchMapSnapshot,
    saveShaFn: saveSnapshotSha,
  });
}

// ---- WhatsApp Config JSON (GitHub sync, keyed by phone number) ----

function getWaConfigSha() { return localStorage.getItem(WA_CONFIG_SHA_KEY) || ''; }
function saveWaConfigSha(sha) { localStorage.setItem(WA_CONFIG_SHA_KEY, sha); }

export async function fetchWaConfigJson() {
  const token = getToken();
  if (!token) return { content: '{}', sha: '' };
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WA_CONFIG_FILE_PATH}`,
    { headers: headers(), cache: 'no-store' }
  );
  if (res.status === 404) return { content: '{}', sha: '' };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error: ${res.status}`);
  }
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  saveWaConfigSha(data.sha);
  return { content, sha: data.sha };
}

export async function saveWaConfigJson(jsonContent, message) {
  let sha = getWaConfigSha();
  if (!sha) {
    try { sha = (await fetchWaConfigJson()).sha; } catch { /* new file */ }
  }
  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));
  return githubPutWithRetry({
    url: `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${WA_CONFIG_FILE_PATH}`,
    encoded,
    message: message || 'Update waConfig.json from Map Tracker app',
    sha,
    fetchFn: fetchWaConfigJson,
    saveShaFn: saveWaConfigSha,
  });
}

/**
 * Test if the current token is valid by fetching the file.
 */
export async function testConnection() {
  try {
    await fetchStoresCsv();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

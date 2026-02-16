const REPO_OWNER = 'Mahpour4';
const REPO_NAME = 'Map-tracker';
const FILE_PATH = 'src/data/stores.csv';
const ALERTS_FILE_PATH = 'src/data/alerts.csv';
const SCHEDULES_FILE_PATH = 'src/data/schedules.json';
const IMPORTLOG_FILE_PATH = 'src/data/importLog.json';
const VISITHISTORY_FILE_PATH = 'src/data/visitHistory.json';
const API_BASE = 'https://api.github.com';

const TOKEN_KEY = 'github_pat';
const SHA_KEY = 'github_file_sha';
const ALERTS_SHA_KEY = 'github_alerts_sha';
const SCHEDULES_SHA_KEY = 'github_schedules_sha';
const IMPORTLOG_SHA_KEY = 'github_importlog_sha';
const VISITHISTORY_SHA_KEY = 'github_visithistory_sha';

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
 * Fetch stores.csv content from GitHub.
 * Returns { content: string, sha: string } or throws.
 */
export async function fetchStoresCsv() {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    { headers: headers() }
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

  // If we don't have a SHA, fetch the latest first
  if (!sha) {
    const current = await fetchStoresCsv();
    sha = current.sha;
  }

  const encoded = btoa(unescape(encodeURIComponent(csvContent)));

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        message: message || 'Update stores.csv from Map Tracker app',
        content: encoded,
        sha,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // SHA mismatch means file was updated externally - refetch and retry once
    if (res.status === 409) {
      const fresh = await fetchStoresCsv();
      const retryRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`,
        {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({
            message: message || 'Update stores.csv from Map Tracker app',
            content: encoded,
            sha: fresh.sha,
          }),
        }
      );
      if (!retryRes.ok) {
        const retryErr = await retryRes.json().catch(() => ({}));
        throw new Error(retryErr.message || `GitHub save failed: ${retryRes.status}`);
      }
      const retryData = await retryRes.json();
      saveSha(retryData.content.sha);
      return retryData;
    }
    throw new Error(err.message || `GitHub save failed: ${res.status}`);
  }

  const data = await res.json();
  saveSha(data.content.sha);
  return data;
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
    { headers: headers() }
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
  // Use cached SHA if available; if not, GitHub will create the file (no SHA needed)
  const sha = getAlertsSha();

  const encoded = btoa(unescape(encodeURIComponent(csvContent)));

  const body = {
    message: message || 'Update alerts.csv from Map Tracker app',
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ALERTS_FILE_PATH}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const fresh = await fetchAlertsCsv();
      const retryBody = { ...body, sha: fresh.sha };
      const retryRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${ALERTS_FILE_PATH}`,
        { method: 'PUT', headers: headers(), body: JSON.stringify(retryBody) }
      );
      if (!retryRes.ok) throw new Error('Failed to save alerts after retry');
      const retryData = await retryRes.json();
      saveAlertsSha(retryData.content.sha);
      return retryData;
    }
    throw new Error(err.message || `GitHub save failed: ${res.status}`);
  }

  const data = await res.json();
  saveAlertsSha(data.content.sha);
  return data;
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
    { headers: headers() }
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
    try {
      const current = await fetchSchedulesJson();
      sha = current.sha;
    } catch { /* file may not exist */ }
  }

  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));

  const body = {
    message: message || 'Update schedules.json from Map Tracker app',
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SCHEDULES_FILE_PATH}`,
    { method: 'PUT', headers: headers(), body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const fresh = await fetchSchedulesJson();
      const retryBody = { ...body, sha: fresh.sha };
      const retryRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${SCHEDULES_FILE_PATH}`,
        { method: 'PUT', headers: headers(), body: JSON.stringify(retryBody) }
      );
      if (!retryRes.ok) throw new Error('Failed to save schedules after retry');
      const retryData = await retryRes.json();
      saveSchedulesSha(retryData.content.sha);
      return retryData;
    }
    throw new Error(err.message || `GitHub save failed: ${res.status}`);
  }

  const data = await res.json();
  saveSchedulesSha(data.content.sha);
  return data;
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
    { headers: headers() }
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
    try {
      const current = await fetchImportLog();
      sha = current.sha;
    } catch { /* file may not exist */ }
  }

  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));

  const body = {
    message: message || 'Update importLog.json from Map Tracker app',
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMPORTLOG_FILE_PATH}`,
    { method: 'PUT', headers: headers(), body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const fresh = await fetchImportLog();
      const retryBody = { ...body, sha: fresh.sha };
      const retryRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMPORTLOG_FILE_PATH}`,
        { method: 'PUT', headers: headers(), body: JSON.stringify(retryBody) }
      );
      if (!retryRes.ok) throw new Error('Failed to save import log after retry');
      const retryData = await retryRes.json();
      saveImportLogSha(retryData.content.sha);
      return retryData;
    }
    throw new Error(err.message || `GitHub save failed: ${res.status}`);
  }

  const data = await res.json();
  saveImportLogSha(data.content.sha);
  return data;
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
    { headers: headers() }
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
    try {
      const current = await fetchVisitHistoryJson();
      sha = current.sha;
    } catch { /* file may not exist */ }
  }

  const encoded = btoa(unescape(encodeURIComponent(jsonContent)));

  const body = {
    message: message || 'Update visitHistory.json from Map Tracker app',
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${VISITHISTORY_FILE_PATH}`,
    { method: 'PUT', headers: headers(), body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const fresh = await fetchVisitHistoryJson();
      const retryBody = { ...body, sha: fresh.sha };
      const retryRes = await fetch(
        `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${VISITHISTORY_FILE_PATH}`,
        { method: 'PUT', headers: headers(), body: JSON.stringify(retryBody) }
      );
      if (!retryRes.ok) throw new Error('Failed to save visit history after retry');
      const retryData = await retryRes.json();
      saveVisitHistorySha(retryData.content.sha);
      return retryData;
    }
    throw new Error(err.message || `GitHub save failed: ${res.status}`);
  }

  const data = await res.json();
  saveVisitHistorySha(data.content.sha);
  return data;
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

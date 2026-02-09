const REPO_OWNER = 'Mahpour4';
const REPO_NAME = 'Map-tracker';
const FILE_PATH = 'src/data/stores.csv';
const API_BASE = 'https://api.github.com';

const TOKEN_KEY = 'github_pat';
const SHA_KEY = 'github_file_sha';

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

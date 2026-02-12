// Gmail Alert Service - OAuth + email fetching + alert parsing
// Uses Google Identity Services (GIS) for browser-based OAuth

const GMAIL_API = 'https://www.googleapis.com/gmail/v1';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';
const ALERT_SENDER = 'MailAgent@synergies4u.com';

const CLIENT_ID_KEY = 'google_client_id';
const GMAIL_TOKEN_KEY = 'gmail_access_token';
const GMAIL_TOKEN_EXPIRY_KEY = 'gmail_token_expiry';

// ---- Credential management ----

export function getGoogleClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || '';
}

export function setGoogleClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function clearGoogleAuth() {
  localStorage.removeItem(GMAIL_TOKEN_KEY);
  localStorage.removeItem(GMAIL_TOKEN_EXPIRY_KEY);
}

function getAccessToken() {
  const token = localStorage.getItem(GMAIL_TOKEN_KEY);
  const expiry = localStorage.getItem(GMAIL_TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry, 10)) {
    clearGoogleAuth();
    return null;
  }
  return token;
}

function saveAccessToken(token, expiresIn) {
  localStorage.setItem(GMAIL_TOKEN_KEY, token);
  localStorage.setItem(GMAIL_TOKEN_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

export function isGmailConnected() {
  return !!getAccessToken();
}

// ---- Google Identity Services OAuth ----

let tokenClient = null;

function ensureGisLoaded() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export async function signInWithGoogle() {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Google Client ID not configured');

  await ensureGisLoaded();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        saveAccessToken(response.access_token, response.expires_in);
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export function signOutGoogle() {
  const token = getAccessToken();
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token);
  }
  clearGoogleAuth();
}

// ---- Gmail API ----

async function gmailFetch(path, params = {}) {
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in to Gmail');

  const url = new URL(`${GMAIL_API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    clearGoogleAuth();
    throw new Error('Gmail session expired — please sign in again');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gmail API error: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch service alert emails from Gmail.
 * @param {string} afterDate - Only fetch emails after this date (YYYY-MM-DD). Optional.
 * @param {number} maxResults - Max emails to fetch (default 100).
 * @returns {Promise<Array>} Array of parsed alert objects.
 */
export async function fetchAlertEmails(afterDate, maxResults = 100) {
  // Search by subject pattern — more reliable than exact sender match
  let query = `from:MailAgent subject:"Service Alert created for"`;
  if (afterDate) {
    query += ` after:${afterDate}`;
  }

  const listResult = await gmailFetch('/users/me/messages', {
    q: query,
    maxResults,
  });

  if (!listResult.messages || listResult.messages.length === 0) {
    return [];
  }

  // Fetch each message to get subject and date
  const alerts = [];
  for (const msg of listResult.messages) {
    try {
      const detail = await gmailFetch(`/users/me/messages/${msg.id}`, {
        format: 'metadata',
        metadataHeaders: 'Subject,Date',
      });

      const subjectHeader = detail.payload?.headers?.find(h => h.name === 'Subject');
      const dateHeader = detail.payload?.headers?.find(h => h.name === 'Date');

      if (subjectHeader) {
        const parsed = parseAlertSubject(subjectHeader.value);
        if (parsed) {
          parsed.emailId = msg.id;
          parsed.dateReceived = dateHeader ? parseDateHeader(dateHeader.value) : '';
          alerts.push(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch message:', msg.id, e);
    }
  }

  return alerts;
}

// ---- Alert subject parsing ----

/**
 * Parse an alert email subject line.
 * Example: "Food Lion Service Alert created for Food Lion #1471 - Dumfries - WISE FOODS - ADUSA - Ref: #ADUSA-8877738"
 */
export function parseAlertSubject(subject) {
  const regex = /Service Alert created for (.+?) #(\d+)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*Ref:\s*#(.+)/i;
  const match = subject.match(regex);
  if (!match) return null;

  return {
    storeName: match[1].trim(),
    storeNumber: match[2].trim(),
    city: match[3].trim(),
    vendor: match[4].trim(),
    company: match[5].trim(),
    refNumber: match[6].trim(),
  };
}

function parseDateHeader(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return '';
  }
}

// ---- Store matching ----

/**
 * Match a parsed alert to a store in the stores array.
 * Matches by store number (padded to 5 digits) or by name+city.
 */
export function matchAlertToStore(alert, stores) {
  const num = alert.storeNumber;
  const paddedNum = num.padStart(5, '0');

  // Try matching by store number field
  let match = stores.find(s =>
    s.storeNumber === num ||
    s.storeNumber === paddedNum ||
    s.id.endsWith(paddedNum) ||
    s.id.endsWith(num)
  );

  if (!match) {
    // Fallback: match by city and name containing the number
    const cityLower = alert.city.toLowerCase();
    match = stores.find(s =>
      s.city.toLowerCase() === cityLower &&
      (s.name.includes(num) || s.name.includes(paddedNum))
    );
  }

  return match || null;
}

// ---- Alert CSV serialization ----

const ALERT_CSV_HEADER = 'RefNumber,EmailID,StoreID,StoreNumber,StoreName,City,Vendor,Company,RouteNumber,DateReceived';

export function alertsToCsv(alerts) {
  const lines = [ALERT_CSV_HEADER];
  alerts.forEach(a => {
    lines.push([
      a.refNumber,
      a.emailId || '',
      a.storeId || '',
      a.storeNumber,
      a.storeName,
      a.city,
      a.vendor,
      a.company,
      a.routeNumber || '',
      a.dateReceived || '',
    ].join(','));
  });
  return lines.join('\n');
}

export function parseAlertsCsv(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length <= 1) return [];

  return lines.slice(1).map(line => {
    const cols = line.split(',');
    return {
      refNumber: cols[0] || '',
      emailId: cols[1] || '',
      storeId: cols[2] || '',
      storeNumber: cols[3] || '',
      storeName: cols[4] || '',
      city: cols[5] || '',
      vendor: cols[6] || '',
      company: cols[7] || '',
      routeNumber: cols[8] || '',
      dateReceived: cols[9] || '',
    };
  });
}

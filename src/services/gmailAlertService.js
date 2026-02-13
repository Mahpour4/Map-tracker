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
    if (v === undefined || v === null) return;
    // Gmail API needs repeated params for metadataHeaders (one per header)
    if (Array.isArray(v)) {
      v.forEach(item => url.searchParams.append(k, item));
    } else {
      url.searchParams.set(k, v);
    }
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
  // Search by subject only — sendgrid routing can cause from: filter issues
  let query = `subject:"Service Alert created for"`;
  if (afterDate) {
    query += ` after:${afterDate}`;
  }

  console.log('[Gmail] Search query:', query);

  const listResult = await gmailFetch('/users/me/messages', {
    q: query,
    maxResults,
  });

  console.log('[Gmail] Messages found:', listResult.messages?.length || 0);

  if (!listResult.messages || listResult.messages.length === 0) {
    return [];
  }

  // Fetch messages in parallel batches for speed
  const BATCH_SIZE = 10;
  const alerts = [];
  const rawMessages = []; // Debug: track all fetched subjects
  const messages = listResult.messages;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(msg =>
        gmailFetch(`/users/me/messages/${msg.id}`, {
          format: 'metadata',
          metadataHeaders: ['Subject', 'Date'],
        }).then(detail => ({ id: msg.id, detail }))
      )
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        rawMessages.push({ id: null, subject: null, date: null, parsed: false, error: String(result.reason) });
        continue;
      }
      const { id, detail } = result.value;
      const subjectHeader = detail.payload?.headers?.find(h => h.name === 'Subject');
      const dateHeader = detail.payload?.headers?.find(h => h.name === 'Date');
      const subject = subjectHeader?.value || '';
      const date = dateHeader ? parseDateHeader(dateHeader.value) : '';

      if (subjectHeader) {
        const parsed = parseAlertSubject(subject);
        if (parsed) {
          parsed.emailId = id;
          parsed.dateReceived = date;
          alerts.push(parsed);
          rawMessages.push({ id, subject, date, parsed: true });
        } else {
          rawMessages.push({ id, subject, date, parsed: false });
        }
      } else {
        rawMessages.push({ id, subject: '(no subject header)', date, parsed: false });
      }
    }
  }

  console.log('[Gmail] Alerts parsed:', alerts.length, '/', rawMessages.length, 'messages');
  return { alerts, rawMessages };
}

// ---- Alert subject parsing ----

/**
 * Parse an alert email subject line.
 * Example: "Food Lion Service Alert created for Food Lion #1471 - Dumfries - WISE FOODS - ADUSA - Ref: #ADUSA-8877738"
 * Also handles variations: missing #, extra/fewer dash sections, different spacing.
 */
export function parseAlertSubject(subject) {
  // Primary regex: full 4-section format
  const regex = /Service Alert created for (.+?) #(\d+)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*Ref:\s*#?(.+)/i;
  const match = subject.match(regex);
  if (match) {
    return {
      storeName: match[1].trim(),
      storeNumber: match[2].trim(),
      city: match[3].trim(),
      vendor: match[4].trim(),
      company: match[5].trim(),
      refNumber: match[6].trim(),
    };
  }

  // Fallback: 3-section format (city - vendor/company combined - Ref)
  const regex3 = /Service Alert created for (.+?) #(\d+)\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*Ref:\s*#?(.+)/i;
  const match3 = subject.match(regex3);
  if (match3) {
    return {
      storeName: match3[1].trim(),
      storeNumber: match3[2].trim(),
      city: match3[3].trim(),
      vendor: match3[4].trim(),
      company: '',
      refNumber: match3[5].trim(),
    };
  }

  // Last resort: just extract store name, number, and ref
  const regexMin = /Service Alert created for (.+?) #(\d+).*?Ref:\s*#?(\S+)/i;
  const matchMin = subject.match(regexMin);
  if (matchMin) {
    // Try to extract city from the middle part
    const middle = subject.slice(subject.indexOf(`#${matchMin[2]}`) + matchMin[2].length + 1, subject.search(/Ref:/i));
    const parts = middle.split('-').map(s => s.trim()).filter(Boolean);
    return {
      storeName: matchMin[1].trim(),
      storeNumber: matchMin[2].trim(),
      city: parts[0] || '',
      vendor: parts[1] || '',
      company: parts[2] || '',
      refNumber: matchMin[3].trim(),
    };
  }

  return null;
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

// ---- On-demand image fetching ----

function decodeBase64Url(data) {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return b64;
}

function findEmailParts(part, results = { images: [] }) {
  if (!part) return results;
  const headers = (part.headers || []).reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {});

  // Inline image (CID-referenced attachment)
  if (part.mimeType?.startsWith('image/') && part.body?.attachmentId) {
    results.images.push({
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType,
      filename: part.filename || 'image.jpg',
    });
  }

  if (part.parts) {
    part.parts.forEach(child => findEmailParts(child, results));
  }
  return results;
}

/**
 * Fetch the primary image from a specific alert email (on-demand).
 * Returns { dataUri, filename } or null if no image found.
 */
export async function fetchAlertImage(emailId) {
  // Get full message to find image attachments
  const detail = await gmailFetch(`/users/me/messages/${emailId}`, {
    format: 'full',
  });

  const parts = findEmailParts(detail.payload);
  if (parts.images.length === 0) return null;

  // Fetch the first (primary) image attachment
  const img = parts.images[0];
  const attData = await gmailFetch(
    `/users/me/messages/${emailId}/attachments/${img.attachmentId}`
  );

  const base64 = decodeBase64Url(attData.data);
  const dataUri = `data:${img.mimeType};base64,${base64}`;
  return { dataUri, filename: img.filename, mimeType: img.mimeType };
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

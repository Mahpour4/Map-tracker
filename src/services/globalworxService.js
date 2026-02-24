// GlobalWorx Auto-Accept Service
// Calls the backend (whatsapp-service on port 3001) to accept alerts via Puppeteer

const BASE = '/api/globalworx';

/**
 * Check if the GlobalWorx acceptance backend is available.
 * @returns {{ available: boolean, error?: string }}
 */
export async function getGlobalworxStatus() {
  try {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) return { available: false, error: 'Service unavailable' };
    return await res.json();
  } catch {
    return { available: false, error: 'Service offline' };
  }
}

/**
 * Accept a batch of alerts on GlobalWorx via the backend.
 * @param {Array<{ url: string, refNumber: string, emailId?: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, success: boolean, error?: string }> }}
 */
export async function acceptAlerts(alerts) {
  const res = await fetch(`${BASE}/accept-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alerts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `GlobalWorx service error: ${res.status}`);
  }
  return await res.json();
}

/**
 * Complete a batch of alerts on GlobalWorx via the backend (clicks "Complete Here").
 * @param {Array<{ url: string, refNumber: string, emailId?: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, success: boolean, error?: string }> }}
 */
export async function completeAlerts(alerts) {
  const res = await fetch(`${BASE}/complete-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alerts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `GlobalWorx service error: ${res.status}`);
  }
  return await res.json();
}

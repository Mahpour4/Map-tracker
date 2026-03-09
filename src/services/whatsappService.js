const BASE = '/api/whatsapp';

export async function getWhatsAppStatus() {
  try {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) throw new Error('WhatsApp service unavailable');
    return await res.json();
  } catch {
    return { status: 'offline' };
  }
}

export async function getWhatsAppGroups() {
  const res = await fetch(`${BASE}/groups`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch groups');
  }
  const data = await res.json();
  return data.groups || [];
}

export async function sendWhatsAppMessage(groupId, message) {
  const res = await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send message');
  }
  return res.json();
}

export async function sendWhatsAppAlert(groupId, alert) {
  const res = await fetch(`${BASE}/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, alert }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send alert');
  }
  return res.json();
}

export async function sendWhatsAppAlertWithImage(groupId, alert, imageBase64, mimeType) {
  const res = await fetch(`${BASE}/send-alert-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, alert, imageBase64, mimeType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send alert with image');
  }
  return res.json();
}

export async function sendWhatsAppReport(groupId, routeNumber, stats) {
  const res = await fetch(`${BASE}/send-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, routeNumber, stats }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send report');
  }
  return res.json();
}

// ── Alert Blast ─────────────────────────────────────────────────────────────

export async function sendAlertBlast(groupId, storeGroups, summary) {
  const res = await fetch(`${BASE}/send-alert-blast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, storeGroups, summary }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send alert blast');
  }
  return res.json();
}

export async function getAlertResponses() {
  const res = await fetch(`${BASE}/alert-responses`);
  if (!res.ok) return { responses: [] };
  return res.json();
}

export async function getBlastSentRefs() {
  const res = await fetch(`${BASE}/blast-sent-refs`);
  if (!res.ok) return { refs: {} };
  return res.json();
}

// ── Order Message Inbox ──────────────────────────────────────────────────────

export async function setOrderGroup(groupId) {
  const res = await fetch(`${BASE}/set-order-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId }),
  });
  return res.json();
}

export async function getOrderGroup() {
  try {
    const res = await fetch(`${BASE}/order-group`);
    const data = await res.json();
    return data.groupId || null;
  } catch {
    return null;
  }
}

export async function getOrderMessages(since = 0) {
  try {
    const res = await fetch(`${BASE}/order-messages?since=${since}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

export async function fetchWhatsAppHistory(limit = 500) {
  try {
    const res = await fetch(`${BASE}/fetch-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
    return await res.json();
  } catch {
    return { success: false, error: 'Service unavailable' };
  }
}

export async function dismissMessages(ids) {
  const res = await fetch(`${BASE}/dismiss-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return res.json();
}

export async function getWaContacts() {
  try {
    const res = await fetch(`${BASE}/contacts`);
    const data = await res.json();
    return data.contacts || {};
  } catch {
    return {};
  }
}

export async function setWaContact(phone, name, route) {
  const res = await fetch(`${BASE}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, route }),
  });
  return res.json();
}

export async function removeWaContact(phone) {
  const res = await fetch(`${BASE}/contacts/${encodeURIComponent(phone)}`, {
    method: 'DELETE',
  });
  return res.json();
}

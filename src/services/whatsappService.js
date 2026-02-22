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

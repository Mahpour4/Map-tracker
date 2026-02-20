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

export async function sendWhatsAppMessage(phone, message) {
  const res = await fetch(`${BASE}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send message');
  }
  return res.json();
}

export async function sendWhatsAppAlert(phone, alert) {
  const res = await fetch(`${BASE}/send-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, alert }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send alert');
  }
  return res.json();
}

export async function sendWhatsAppReport(phone, routeNumber, stats) {
  const res = await fetch(`${BASE}/send-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, routeNumber, stats }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send report');
  }
  return res.json();
}

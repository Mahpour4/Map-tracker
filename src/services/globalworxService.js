const BASE = '/api/globalworx';

export async function getGlobalWorxStatus() {
  try {
    const res = await fetch(`${BASE}/status`);
    if (!res.ok) throw new Error('GlobalWorx service unavailable');
    return await res.json();
  } catch {
    return { status: 'offline' };
  }
}

export async function completeRouteAlerts(alerts) {
  const res = await fetch(`${BASE}/complete-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alerts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to complete route');
  }
  return res.json();
}

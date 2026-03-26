// Local disk persistence via the WhatsApp service (port 3001)
const LOCAL_API = `${import.meta.env.VITE_API_URL}/api/local`;

export async function loadLocalData(key) {
  try {
    const res = await fetch(`${LOCAL_API}/${key}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveLocalData(key, data) {
  try {
    const res = await fetch(`${LOCAL_API}/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

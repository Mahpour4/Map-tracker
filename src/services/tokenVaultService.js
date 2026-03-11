/**
 * Token Vault Service
 * Encrypts API tokens with AES-GCM (password-derived key via PBKDF2).
 * File format: base64(salt[16] + iv[12] + ciphertext)
 */

const VAULT_KEYS = [
  { key: 'github_pat',                   label: 'GitHub Token' },
  { key: 'google_client_id',             label: 'Google Client ID' },
  { key: 'google_sheets_spreadsheet_id', label: 'Google Spreadsheet ID' },
  { key: 'motive_api_key',               label: 'Motive API Key' },
];

export { VAULT_KEYS };

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt tokens object → base64 vault string */
export async function encryptVault(tokens, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(password, salt);
  const enc  = new TextEncoder();
  const ct   = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(tokens))
  );
  const combined = new Uint8Array(16 + 12 + ct.byteLength);
  combined.set(salt, 0);
  combined.set(iv, 16);
  combined.set(new Uint8Array(ct), 28);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypt base64 vault string → tokens object */
export async function decryptVault(vaultB64, password) {
  const bytes = Uint8Array.from(atob(vaultB64), c => c.charCodeAt(0));
  const salt  = bytes.slice(0, 16);
  const iv    = bytes.slice(16, 28);
  const ct    = bytes.slice(28);
  const key   = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Read tokens from localStorage */
export function readTokensFromStorage() {
  const out = {};
  for (const { key } of VAULT_KEYS) {
    out[key] = localStorage.getItem(key) || '';
  }
  return out;
}

/** Write tokens into localStorage */
export function writeTokensToStorage(tokens) {
  for (const { key } of VAULT_KEYS) {
    if (tokens[key] !== undefined) {
      if (tokens[key]) localStorage.setItem(key, tokens[key]);
      else localStorage.removeItem(key);
    }
  }
}

/** Download encrypted vault as .mtvault file */
export function downloadVaultFile(vaultB64) {
  const blob = new Blob([vaultB64], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'maptracker.mtvault';
  a.click();
  URL.revokeObjectURL(url);
}

/** Read an .mtvault file → base64 string */
export function readVaultFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

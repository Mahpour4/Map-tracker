import { useState, useRef } from 'react';
import {
  VAULT_KEYS,
  encryptVault,
  decryptVault,
  readTokensFromStorage,
  writeTokensToStorage,
  downloadVaultFile,
  readVaultFile,
} from '../services/tokenVaultService';

/**
 * TokenVault modal
 * Props: onClose()
 *
 * Two modes:
 *   setup — enter tokens + password → downloads .mtvault file
 *   load  — pick .mtvault file + enter password → loads tokens into localStorage
 */
export default function TokenVault({ onClose }) {
  const [mode, setMode] = useState('load'); // 'load' | 'setup'
  const [tokens, setTokens] = useState(() => readTokensFromStorage());
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [vaultFile, setVaultFile] = useState(null);
  const [status, setStatus] = useState(''); // success/error message
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const fileRef = useRef();

  async function handleLoad() {
    if (!vaultFile) { setStatus('Select a .mtvault file first.'); return; }
    if (!password)  { setStatus('Enter your password.'); return; }
    setBusy(true);
    setStatus('');
    try {
      const b64 = await readVaultFile(vaultFile);
      const loaded = await decryptVault(b64.trim(), password);
      writeTokensToStorage(loaded);
      setTokens(readTokensFromStorage());
      setStatus('Tokens loaded successfully.');
    } catch {
      setStatus('Wrong password or invalid vault file.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!password)          { setStatus('Enter a password.'); return; }
    if (password !== confirmPw) { setStatus('Passwords do not match.'); return; }
    setBusy(true);
    setStatus('');
    try {
      const b64 = await encryptVault(tokens, password);
      downloadVaultFile(b64);
      writeTokensToStorage(tokens);
      setStatus('Vault saved and tokens applied.');
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tv-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tv-modal">
        <div className="tv-header">
          <svg className="tv-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <h2 className="tv-title">Token Vault</h2>
          <button className="tv-close" onClick={onClose}>×</button>
        </div>

        {/* Mode tabs */}
        <div className="tv-tabs">
          <button className={`tv-tab${mode === 'load' ? ' active' : ''}`} onClick={() => { setMode('load'); setStatus(''); }}>
            Load Vault
          </button>
          <button className={`tv-tab${mode === 'setup' ? ' active' : ''}`} onClick={() => { setMode('setup'); setStatus(''); setTokens(readTokensFromStorage()); }}>
            Setup / Update
          </button>
        </div>

        <div className="tv-body">
          {mode === 'load' && (
            <>
              <p className="tv-hint">Select your <strong>maptracker.mtvault</strong> file and enter your password to load your API tokens.</p>
              <div className="tv-field">
                <label className="tv-label">Vault File</label>
                <div className="tv-file-row">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".mtvault"
                    className="tv-file-input"
                    onChange={e => { setVaultFile(e.target.files[0] || null); setStatus(''); }}
                  />
                  {vaultFile && <span className="tv-filename">{vaultFile.name}</span>}
                </div>
              </div>
              <div className="tv-field">
                <label className="tv-label">Password</label>
                <div className="tv-pw-row">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="tv-input"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleLoad(); }}
                  />
                  <button className="tv-eye" onClick={() => setShowPw(p => !p)}>{showPw ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <button className="tv-btn-primary" onClick={handleLoad} disabled={busy}>
                {busy ? 'Loading...' : 'Load Tokens'}
              </button>
            </>
          )}

          {mode === 'setup' && (
            <>
              <p className="tv-hint">Enter your API tokens below. Click <strong>Save Vault</strong> to download an encrypted <code>.mtvault</code> file to this machine and apply the tokens.</p>
              {VAULT_KEYS.map(({ key, label }) => (
                <div className="tv-field" key={key}>
                  <label className="tv-label">{label}</label>
                  <input
                    type="text"
                    className="tv-input tv-input-token"
                    placeholder={`Enter ${label}`}
                    value={tokens[key] || ''}
                    onChange={e => setTokens(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="tv-field">
                <label className="tv-label">Password</label>
                <div className="tv-pw-row">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="tv-input"
                    placeholder="Set password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                  <button className="tv-eye" onClick={() => setShowPw(p => !p)}>{showPw ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <div className="tv-field">
                <label className="tv-label">Confirm Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  className="tv-input"
                  placeholder="Confirm password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                />
              </div>
              <button className="tv-btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? 'Saving...' : 'Save Vault & Apply'}
              </button>
            </>
          )}

          {status && (
            <div className={`tv-status${status.includes('success') || status.includes('saved') || status.includes('loaded') ? ' ok' : ' err'}`}>
              {status}
            </div>
          )}
        </div>

        {/* Current token status */}
        <div className="tv-footer">
          <span className="tv-footer-label">Current status:</span>
          {VAULT_KEYS.map(({ key, label }) => (
            <span key={key} className={`tv-badge${tokens[key] ? ' set' : ' unset'}`} title={label}>
              {label.split(' ')[0]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getWhatsAppStatus, getWhatsAppGroups,
  getOrderGroup, setOrderGroup,
  getWaContacts, setWaContact, removeWaContact,
  getAdminConfig, saveAdminConfig, testAdminQuery,
  saveRouteGroupMap,
  disconnectWhatsApp, reconnectWhatsApp,
  getWhatsAppPhone,
} from '../services/whatsappService';
import { fetchWaConfigJson, saveWaConfigJson } from '../services/githubService';

const ALERT_ROUTES = ['198','199','200','201','203','204','206','207','208','209','210','211'];
const LOCAL_WA_CONFIG_KEY = phone => `waConfig_${phone}`;

export default function WhatsAppSettings() {
  // Connection
  const [status, setStatus]         = useState('offline');
  const [qrCode, setQrCode]         = useState(null);
  const [qrDataUrl, setQrDataUrl]   = useState(null);
  const [connectedPhone, setConnectedPhone] = useState(null);
  const [groups, setGroups]         = useState([]);
  const [groupsLoading, setGroupsLoading]     = useState(false);
  const [disconnecting, setDisconnecting]     = useState(false);
  const [reconnecting, setReconnecting]       = useState(false);

  // Order group
  const [orderGroupId, setOrderGroupIdState] = useState('');

  // Alert route groups (stored in localStorage)
  const [routeGroupMap, setRouteGroupMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wa_route_groups') || '{}'); } catch { return {}; }
  });

  // Admin chat
  const [adminGroupId, setAdminGroupId]   = useState('');
  const [adminPhones, setAdminPhones]     = useState([]);
  const [newPhone, setNewPhone]           = useState('');

  // Test query
  const [testQuery, setTestQuery]   = useState('');
  const [testResult, setTestResult] = useState('');
  const [testRunning, setTestRunning] = useState(false);

  // Contacts
  const [contacts, setContacts]         = useState({});
  const [editPhone, setEditPhone]       = useState(null);
  const [editName, setEditName]         = useState('');
  const [editRoute, setEditRoute]       = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactName, setNewContactName]   = useState('');
  const [newContactRoute, setNewContactRoute] = useState('');

  const [activeTab, setActiveTab] = useState('status');

  // Per-tab save feedback: { order: 'saved'|'error'|null, alerts: ..., admin: ..., contacts: ... }
  const [saveFeedback, setSaveFeedback] = useState({});
  const [saving, setSaving] = useState({});

  // Track previous status to detect transitions
  const prevStatusRef = useRef(null);

  // ── Cloud config helpers ─────────────────────────────────────────────────────

  function bundleConfig(snap) {
    // snap allows overriding current state (e.g. after a save)
    const routeNames = (() => {
      try { return JSON.parse(localStorage.getItem('wa_route_group_names') || '{}'); } catch { return {}; }
    })();
    return {
      savedAt:      new Date().toISOString(),
      orderGroupId: snap?.orderGroupId  ?? orderGroupId,
      routeGroupMap: snap?.routeGroupMap ?? routeGroupMap,
      routeGroupNames: routeNames,
      adminConfig:  { groupId: snap?.adminGroupId ?? adminGroupId, phones: snap?.adminPhones ?? adminPhones },
      contacts:     snap?.contacts ?? contacts,
    };
  }

  async function pushToGitHub(phone, config) {
    // Read current file, update phone key, write back
    const { content, sha: _ } = await fetchWaConfigJson();
    const all = (() => { try { return JSON.parse(content) || {}; } catch { return {}; } })();
    all[phone] = config;
    await saveWaConfigJson(JSON.stringify(all, null, 2), `Update WA config for ${phone}`);
    // Also cache locally
    localStorage.setItem(LOCAL_WA_CONFIG_KEY(phone), JSON.stringify(config));
  }

  function flashTab(tab, status) {
    setSaveFeedback(prev => ({ ...prev, [tab]: status }));
    setTimeout(() => setSaveFeedback(prev => ({ ...prev, [tab]: null })), 3000);
  }

  async function saveTab(tab, serverSaveFn) {
    setSaving(prev => ({ ...prev, [tab]: true }));
    try {
      const config = await serverSaveFn();
      // Try GitHub push
      const phone = connectedPhone || await getWhatsAppPhone();
      if (phone) {
        try {
          await pushToGitHub(phone, bundleConfig(config));
          flashTab(tab, 'saved');
        } catch {
          // GitHub failed — saved locally
          localStorage.setItem(LOCAL_WA_CONFIG_KEY(phone), JSON.stringify(bundleConfig(config)));
          flashTab(tab, 'local');
        }
      } else {
        flashTab(tab, 'local');
      }
    } catch {
      flashTab(tab, 'error');
    } finally {
      setSaving(prev => ({ ...prev, [tab]: false }));
    }
  }

  // ── Auto-load on connect ─────────────────────────────────────────────────────

  const applyConfig = useCallback(async (cfg, phone) => {
    if (!cfg) return;
    console.log('[WA Settings] Applying saved config for phone', phone);
    // Order group
    if (cfg.orderGroupId) {
      await setOrderGroup(cfg.orderGroupId).catch(() => {});
      setOrderGroupIdState(cfg.orderGroupId);
    }
    // Route group map (localStorage)
    if (cfg.routeGroupMap) {
      localStorage.setItem('wa_route_groups', JSON.stringify(cfg.routeGroupMap));
      setRouteGroupMap(cfg.routeGroupMap);
    }
    if (cfg.routeGroupNames) {
      localStorage.setItem('wa_route_group_names', JSON.stringify(cfg.routeGroupNames));
    }
    // Admin config
    if (cfg.adminConfig) {
      await saveAdminConfig(cfg.adminConfig.groupId || null, cfg.adminConfig.phones || []).catch(() => {});
      setAdminGroupId(cfg.adminConfig.groupId || '');
      setAdminPhones(cfg.adminConfig.phones || []);
    }
    // Contacts
    if (cfg.contacts) {
      for (const [p, info] of Object.entries(cfg.contacts)) {
        await setWaContact(p, info.name || '', info.route || '').catch(() => {});
      }
      setContacts(cfg.contacts);
    }
  }, []);

  const autoLoadConfig = useCallback(async (phone) => {
    if (!phone) return;
    // 1. Try localStorage first (fast)
    const local = localStorage.getItem(LOCAL_WA_CONFIG_KEY(phone));
    if (local) {
      try { await applyConfig(JSON.parse(local), phone); return; } catch { }
    }
    // 2. Try GitHub
    try {
      const { content } = await fetchWaConfigJson();
      const all = JSON.parse(content) || {};
      if (all[phone]) {
        await applyConfig(all[phone], phone);
        localStorage.setItem(LOCAL_WA_CONFIG_KEY(phone), JSON.stringify(all[phone]));
      }
    } catch { /* no config found, that's fine */ }
  }, [applyConfig]);

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    const s = await getWhatsAppStatus();
    const newStatus = s.status || 'offline';
    setStatus(newStatus);
    setQrCode(s.qrCode || null);
    setQrDataUrl(s.qrDataUrl || null);
    if (s.phone) setConnectedPhone(s.phone);
    return { status: newStatus, phone: s.phone };
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const g = await getWhatsAppGroups();
      setGroups(g || []);
    } catch { setGroups([]); }
    finally { setGroupsLoading(false); }
  }, []);

  const loadAll = useCallback(async () => {
    const s = await loadStatus();
    const [gId, contactData, adminCfg] = await Promise.all([
      getOrderGroup(),
      getWaContacts(),
      getAdminConfig(),
    ]);
    setOrderGroupIdState(gId || '');
    setContacts(contactData || {});
    setAdminGroupId(adminCfg.groupId || '');
    setAdminPhones(adminCfg.phones || []);
    return s;
  }, [loadStatus]);

  useEffect(() => {
    loadAll().then(s => {
      // If already connected on first load, auto-load config
      if (s?.status === 'connected' && s?.phone) {
        prevStatusRef.current = 'connected';
        autoLoadConfig(s.phone);
      }
    });
    const iv = setInterval(async () => {
      const s = await loadStatus();
      // Detect transition to connected
      if (s.status === 'connected' && prevStatusRef.current !== 'connected') {
        prevStatusRef.current = 'connected';
        if (s.phone) autoLoadConfig(s.phone);
      } else if (s.status !== 'connected') {
        prevStatusRef.current = s.status;
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [loadAll, loadStatus, autoLoadConfig]);

  useEffect(() => {
    if (status === 'connected' && groups.length === 0) loadGroups();
  }, [status, groups.length, loadGroups]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleDisconnect() {
    if (!window.confirm('Disconnect WhatsApp? This will log out the current session.')) return;
    setDisconnecting(true);
    try { await disconnectWhatsApp(); await loadStatus(); }
    finally { setDisconnecting(false); }
  }

  async function handleReconnect() {
    setReconnecting(true);
    try { await reconnectWhatsApp(); await loadStatus(); }
    finally { setReconnecting(false); }
  }

  function handleRouteGroup(routeNum, groupId) {
    const groupName = groups.find(g => g.id === groupId)?.name || '';
    saveRouteGroupMap(routeNum, groupId, groupName);
    setRouteGroupMap(prev => {
      const next = { ...prev };
      if (groupId) next[routeNum] = groupId;
      else delete next[routeNum];
      return next;
    });
  }

  function addPhone() {
    const p = newPhone.replace(/\D/g, '');
    if (!p || adminPhones.includes(p)) return;
    setAdminPhones(prev => [...prev, p]);
    setNewPhone('');
  }

  async function runTestQuery() {
    if (!testQuery.trim()) return;
    setTestRunning(true);
    setTestResult('');
    try {
      const r = await testAdminQuery(testQuery.trim());
      setTestResult(r.reply || r.error || 'No response');
    } catch (err) {
      setTestResult('Error: ' + err.message);
    } finally { setTestRunning(false); }
  }

  async function saveContact(phone) {
    await setWaContact(phone, editName, editRoute);
    setContacts(prev => ({ ...prev, [phone]: { name: editName, route: editRoute } }));
    setEditPhone(null);
  }

  async function deleteContact(phone) {
    await removeWaContact(phone);
    setContacts(prev => { const n = { ...prev }; delete n[phone]; return n; });
  }

  async function addContact() {
    if (!newContactPhone.trim()) return;
    const p = newContactPhone.replace(/\D/g, '');
    await setWaContact(p, newContactName, newContactRoute);
    setContacts(prev => ({ ...prev, [p]: { name: newContactName, route: newContactRoute } }));
    setNewContactPhone(''); setNewContactName(''); setNewContactRoute('');
  }

  // ── Save button helper ───────────────────────────────────────────────────────

  function SaveBtn({ tab, onClick, label }) {
    const fb = saveFeedback[tab];
    const busy = saving[tab];
    let cls = 'was-btn-primary';
    let text = busy ? 'Saving...' : (label || 'Save');
    if (fb === 'saved') { cls = 'was-btn-cloud-saved'; text = 'Saved'; }
    else if (fb === 'local') { cls = 'was-btn-cloud-local'; text = 'Saved locally'; }
    else if (fb === 'error') { cls = 'was-btn-cloud-error'; text = 'Save failed'; }
    return (
      <button className={cls} onClick={onClick} disabled={!!busy || !!fb}>
        {text}
      </button>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const statusColor = status === 'connected' ? '#22c55e' : status === 'qr-pending' ? '#f59e0b' : '#ef4444';

  return (
    <div className="was-page">
      <div className="was-header">
        <h1 className="was-title">WhatsApp Settings</h1>
        <div className="was-status-pill" style={{ background: statusColor }}>
          {status === 'connected' ? 'Connected' : status === 'qr-pending' ? 'Scan QR' : 'Offline'}
        </div>
        {connectedPhone && <span className="was-phone-badge">{connectedPhone}</span>}
      </div>

      {/* Tabs */}
      <div className="was-tabs">
        {[
          { id: 'status',   label: 'Connection' },
          { id: 'order',    label: 'Order Group' },
          { id: 'alerts',   label: 'Alert Routes' },
          { id: 'admin',    label: 'Admin Chat' },
          { id: 'contacts', label: 'Contacts' },
        ].map(t => (
          <button key={t.id} className={`was-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="was-body">

        {/* ── Connection Tab ── */}
        {activeTab === 'status' && (
          <div className="was-section">
            <h2 className="was-section-title">Connection Status</h2>
            <div className="was-status-row">
              <span className="was-status-dot" style={{ background: statusColor }} />
              <span className="was-status-text">{status}</span>
              <button className="was-btn-secondary" onClick={loadStatus}>Refresh</button>
              {status === 'connected' && (
                <button className="was-btn-secondary" onClick={loadGroups} disabled={groupsLoading}>
                  {groupsLoading ? 'Loading...' : `Refresh Groups (${groups.length})`}
                </button>
              )}
              {status === 'connected' && (
                <button className="was-btn-danger" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              )}
              {(status === 'disconnected' || status === 'offline') && (
                <button className="was-btn-primary" onClick={handleReconnect} disabled={reconnecting}>
                  {reconnecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>

            {status === 'qr-pending' && (
              <div className="was-qr-block">
                <p className="was-hint">Scan this QR code with your WhatsApp phone to connect.</p>
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="WhatsApp QR Code" className="was-qr-img" />
                ) : (
                  <div className="was-qr-hint">QR code loading... check the terminal if it does not appear.</div>
                )}
              </div>
            )}

            {status === 'offline' && (
              <div className="was-hint">
                WhatsApp service is not running. Start it with <code>start.bat</code> or run <code>node scripts/whatsapp-service/server.js</code>.
              </div>
            )}

            {status === 'connected' && (
              <div className="was-groups-list">
                <h3 className="was-sub-title">Available Groups ({groups.length})</h3>
                {groups.length === 0 && <div className="was-hint">No groups found. Make sure WhatsApp account is in groups.</div>}
                {groups.map(g => (
                  <div key={g.id} className="was-group-row">
                    <span className="was-group-name">{g.name}</span>
                    <span className="was-group-id">{g.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Order Group Tab ── */}
        {activeTab === 'order' && (
          <div className="was-section">
            <h2 className="was-section-title">Order Group</h2>
            <p className="was-hint">Incoming driver orders are read from this WhatsApp group.</p>
            <div className="was-field-row">
              <label className="was-label">Order Group</label>
              <select className="was-select" value={orderGroupId} onChange={e => setOrderGroupIdState(e.target.value)}>
                <option value="">— Select Group —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <SaveBtn tab="order" label="Save" onClick={() => saveTab('order', async () => {
                await setOrderGroup(orderGroupId);
                return { orderGroupId };
              })} />
            </div>
            {status !== 'connected' && <div className="was-warn">Connect WhatsApp to load groups.</div>}
          </div>
        )}

        {/* ── Alert Routes Tab ── */}
        {activeTab === 'alerts' && (
          <div className="was-section">
            <h2 className="was-section-title">Alert Route → Group Mapping</h2>
            <p className="was-hint">Map each route to a WhatsApp group. Alerts sent to drivers go to the mapped group.</p>
            {status !== 'connected' && <div className="was-warn">Connect WhatsApp to load groups.</div>}
            <div className="was-route-list">
              {ALERT_ROUTES.map(route => (
                <div key={route} className="was-route-row">
                  <span className="was-route-label">Route {route}</span>
                  <select
                    className="was-select was-select--route"
                    value={routeGroupMap[route] || ''}
                    onChange={e => handleRouteGroup(route, e.target.value)}
                  >
                    <option value="">— No group —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {routeGroupMap[route] && <span className="was-mapped-ok">✓</span>}
                </div>
              ))}
            </div>
            <SaveBtn tab="alerts" label="Save Route Mappings" onClick={() => saveTab('alerts', async () => {
              // Route map is localStorage-only on server side; snapshot current state
              return { routeGroupMap };
            })} />
          </div>
        )}

        {/* ── Admin Chat Tab ── */}
        {activeTab === 'admin' && (
          <div className="was-section">
            <h2 className="was-section-title">Admin Chat Bot</h2>
            <p className="was-hint">
              Select a WhatsApp group for admin queries. Authorized numbers can send commands like
              <code> store food lion 1214</code>, <code>route 206</code>, <code>alerts open</code>, <code>order 206</code>.
            </p>

            <div className="was-field-row">
              <label className="was-label">Admin Group</label>
              <select className="was-select" value={adminGroupId} onChange={e => setAdminGroupId(e.target.value)}>
                <option value="">— Select Group —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>

            <div className="was-admin-phones">
              <label className="was-label">Authorized Phone Numbers</label>
              <p className="was-hint-sm">Leave empty to allow all group members to query.</p>
              <div className="was-phone-list">
                {adminPhones.map(p => (
                  <div key={p} className="was-phone-chip">
                    <span>{p}</span>
                    <button onClick={() => setAdminPhones(prev => prev.filter(x => x !== p))}>×</button>
                  </div>
                ))}
              </div>
              <div className="was-add-phone-row">
                <input
                  className="was-input"
                  placeholder="+1 555 123 4567"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addPhone(); }}
                />
                <button className="was-btn-secondary" onClick={addPhone}>Add</button>
              </div>
            </div>

            <SaveBtn tab="admin" label="Save Admin Config" onClick={() => saveTab('admin', async () => {
              await saveAdminConfig(adminGroupId || null, adminPhones);
              return { adminGroupId, adminPhones };
            })} />

            {/* Test query */}
            <div className="was-test-section">
              <h3 className="was-sub-title">Test Query</h3>
              <p className="was-hint-sm">Test the bot without sending to WhatsApp.</p>
              <div className="was-test-row">
                <input
                  className="was-input was-input--wide"
                  placeholder="e.g. store food lion 1214"
                  value={testQuery}
                  onChange={e => setTestQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runTestQuery(); }}
                />
                <button className="was-btn-primary" onClick={runTestQuery} disabled={testRunning}>
                  {testRunning ? 'Running...' : 'Run'}
                </button>
              </div>
              {testResult && (
                <pre className="was-test-result">{testResult}</pre>
              )}
              <div className="was-cmd-ref">
                <strong>Commands:</strong>
                <code>store [name or #]</code>
                <code>route [number]</code>
                <code>alerts [open|today|route N]</code>
                <code>order [route]</code>
                <code>help</code>
              </div>
            </div>
          </div>
        )}

        {/* ── Contacts Tab ── */}
        {activeTab === 'contacts' && (
          <div className="was-section">
            <h2 className="was-section-title">Driver Contacts</h2>
            <p className="was-hint">Map phone numbers to driver names and routes for order identification.</p>

            {/* Add new */}
            <div className="was-add-contact-row">
              <input className="was-input" placeholder="Phone (digits only)" value={newContactPhone} onChange={e => setNewContactPhone(e.target.value)} />
              <input className="was-input" placeholder="Driver name" value={newContactName} onChange={e => setNewContactName(e.target.value)} />
              <input className="was-input was-input--sm" placeholder="Route #" value={newContactRoute} onChange={e => setNewContactRoute(e.target.value)} />
              <button className="was-btn-primary" onClick={addContact}>Add</button>
            </div>

            <div className="was-contact-list">
              {Object.keys(contacts).length === 0 && <div className="was-hint">No contacts yet.</div>}
              {Object.entries(contacts).map(([phone, info]) => (
                <div key={phone} className="was-contact-row">
                  {editPhone === phone ? (
                    <>
                      <span className="was-contact-phone">{phone}</span>
                      <input className="was-input was-input--inline" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
                      <input className="was-input was-input--sm" value={editRoute} onChange={e => setEditRoute(e.target.value)} placeholder="Route" />
                      <button className="was-btn-primary" onClick={() => saveContact(phone)}>Save</button>
                      <button className="was-btn-ghost" onClick={() => setEditPhone(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="was-contact-phone">{phone}</span>
                      <span className="was-contact-name">{info.name || '—'}</span>
                      <span className="was-contact-route">{info.route ? `Route ${info.route}` : '—'}</span>
                      <button className="was-btn-ghost" onClick={() => { setEditPhone(phone); setEditName(info.name || ''); setEditRoute(info.route || ''); }}>Edit</button>
                      <button className="was-btn-danger" onClick={() => deleteContact(phone)}>Remove</button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <SaveBtn tab="contacts" label="Save Contacts" onClick={() => saveTab('contacts', async () => {
              // Contacts already saved individually on each add/edit. Just snapshot for cloud.
              return { contacts };
            })} />
          </div>
        )}
      </div>
    </div>
  );
}

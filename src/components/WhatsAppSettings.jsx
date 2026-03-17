import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getWhatsAppStatus, getWhatsAppGroups,
  getOrderGroup, setOrderGroup,
  getWaContacts, setWaContact, removeWaContact,
  getAdminConfig, saveAdminConfig, testAdminQuery,
  saveRouteGroupMap,
  disconnectWhatsApp, reconnectWhatsApp, restartWhatsAppServer,
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
  const [restarting, setRestarting]           = useState(false);

  // Order group
  const [orderGroupId, setOrderGroupIdState] = useState('');

  // Alert route groups (stored in localStorage)
  const [routeGroupMap, setRouteGroupMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wa_route_groups') || '{}'); } catch { return {}; }
  });

  // Admin chat (multi-group)
  const [adminGroups, setAdminGroupsState] = useState([]); // [{ id, routes, destination }]
  const [adminPhones, setAdminPhones]     = useState([]);
  const [newPhone, setNewPhone]           = useState('');
  const [addingGroup, setAddingGroup]     = useState(false);
  const [newGroupId, setNewGroupId]       = useState('');

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
      adminConfig:  { groups: snap?.adminGroups ?? adminGroups, phones: snap?.adminPhones ?? adminPhones },
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
      const groups = cfg.adminConfig.groups || (cfg.adminConfig.groupId ? [{ id: cfg.adminConfig.groupId, routes: [] }] : []);
      await saveAdminConfig(groups, cfg.adminConfig.phones || []).catch(() => {});
      setAdminGroupsState(groups);
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
    // Multi-group format: server returns { groups: [...], phones: [...] }
    const loadedGroups = adminCfg.groups || (adminCfg.groupId ? [{ id: adminCfg.groupId, routes: [] }] : []);
    setAdminGroupsState(loadedGroups);
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

  async function handleRestart() {
    if (!window.confirm('Restart the WhatsApp server? It will be unavailable for a few seconds.')) return;
    setRestarting(true);
    setStatus('offline');
    try { await restartWhatsAppServer(); } catch {}
    // Poll until server comes back
    const poll = setInterval(async () => {
      try {
        const s = await getWhatsAppStatus();
        if (s.status && s.status !== 'offline') {
          clearInterval(poll);
          setRestarting(false);
          await loadStatus();
        }
      } catch {}
    }, 2000);
    // Stop polling after 30s
    setTimeout(() => { clearInterval(poll); setRestarting(false); }, 30000);
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
                <button className="was-btn-primary" onClick={handleReconnect} disabled={reconnecting || restarting}>
                  {reconnecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
              {status !== 'offline' && (
                <button className="was-btn-warn" onClick={handleRestart} disabled={restarting || disconnecting}>
                  {restarting ? 'Restarting...' : 'Restart Server'}
                </button>
              )}
            </div>

            {restarting && (
              <div className="was-hint" style={{ marginTop: 8, color: '#f59e0b' }}>
                Server is restarting... waiting for it to come back online.
              </div>
            )}

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
              Add WhatsApp groups where users can @mention the bot. Each group can be restricted to specific routes.
              Commands: <code>alerts</code>, <code>truck [route]</code>, <code>store [name]</code>, <code>route [#]</code>, <code>order [route]</code>.
            </p>

            {/* Configured admin groups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="was-label">Bot Groups</label>
              {adminGroups.length === 0 && <div className="was-hint">No groups configured. Add one below.</div>}
              {adminGroups.map((ag, idx) => {
                const groupName = groups.find(g => g.id === ag.id)?.name || ag.id;
                return (
                  <div key={ag.id} className="was-group-row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', padding: '12px 14px' }}>
                    <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="was-group-name">{groupName}</span>
                        {ag.routes && ag.routes.length > 0
                          ? <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Routes: {ag.routes.join(', ')}</span>
                          : <span style={{ fontSize: '0.75rem', color: '#22c55e' }}>All routes</span>}
                      </div>
                      {/* Route chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {ALERT_ROUTES.map(r => {
                          const active = ag.routes && ag.routes.includes(r);
                          return (
                            <button key={r}
                              style={{
                                padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600,
                                border: active ? '1px solid #2563eb' : '1px solid #d1d5db',
                                background: active ? '#dbeafe' : '#f9fafb', color: active ? '#1e40af' : '#9ca3af',
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                setAdminGroupsState(prev => prev.map((g, i) => {
                                  if (i !== idx) return g;
                                  const routes = g.routes || [];
                                  return { ...g, routes: active ? routes.filter(x => x !== r) : [...routes, r].sort() };
                                }));
                              }}
                            >
                              {r}
                            </button>
                          );
                        })}
                        <span style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: 4 }}>(empty = all)</span>
                      </div>
                      {/* Destination */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Destination:</span>
                        <input
                          className="was-input"
                          style={{ width: 130, fontSize: '0.78rem', padding: '3px 6px' }}
                          placeholder="e.g. Salisbury, MD"
                          value={ag.destination?.name || ''}
                          onChange={e => setAdminGroupsState(prev => prev.map((g, i) =>
                            i !== idx ? g : { ...g, destination: { ...g.destination, name: e.target.value, lat: g.destination?.lat || '', lng: g.destination?.lng || '' } }
                          ))}
                        />
                        <input
                          className="was-input"
                          style={{ width: 70, fontSize: '0.78rem', padding: '3px 6px' }}
                          placeholder="Lat"
                          value={ag.destination?.lat || ''}
                          onChange={e => setAdminGroupsState(prev => prev.map((g, i) =>
                            i !== idx ? g : { ...g, destination: { ...g.destination, lat: parseFloat(e.target.value) || e.target.value } }
                          ))}
                        />
                        <input
                          className="was-input"
                          style={{ width: 70, fontSize: '0.78rem', padding: '3px 6px' }}
                          placeholder="Lng"
                          value={ag.destination?.lng || ''}
                          onChange={e => setAdminGroupsState(prev => prev.map((g, i) =>
                            i !== idx ? g : { ...g, destination: { ...g.destination, lng: parseFloat(e.target.value) || e.target.value } }
                          ))}
                        />
                      </div>
                    </div>
                    <button className="was-btn-danger" onClick={() => {
                      if (window.confirm(`Remove ${groupName} from admin bot?`))
                        setAdminGroupsState(prev => prev.filter((_, i) => i !== idx));
                    }}>Remove</button>
                  </div>
                );
              })}

              {/* Add new group */}
              {addingGroup ? (
                <div className="was-field-row">
                  <select className="was-select" value={newGroupId} onChange={e => setNewGroupId(e.target.value)}>
                    <option value="">— Select Group —</option>
                    {groups.filter(g => !adminGroups.some(ag => ag.id === g.id)).map(g =>
                      <option key={g.id} value={g.id}>{g.name}</option>
                    )}
                  </select>
                  <button className="was-btn-primary" disabled={!newGroupId} onClick={() => {
                    if (newGroupId) {
                      setAdminGroupsState(prev => [...prev, { id: newGroupId, routes: [] }]);
                      setNewGroupId('');
                      setAddingGroup(false);
                    }
                  }}>Add</button>
                  <button className="was-btn-ghost" onClick={() => { setAddingGroup(false); setNewGroupId(''); }}>Cancel</button>
                </div>
              ) : (
                <button className="was-btn-secondary" onClick={() => setAddingGroup(true)} disabled={status !== 'connected'}>
                  + Add Group
                </button>
              )}
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
              await saveAdminConfig(adminGroups, adminPhones);
              return { adminGroups, adminPhones };
            })} />
            {localStorage.getItem('motive_api_key') && (
              <p className="was-hint-sm" style={{ marginTop: 8, color: '#22c55e' }}>
                Motive API key will be synced to bot on save (for truck ETA command)
              </p>
            )}

            {/* Test query */}
            <div className="was-test-section">
              <h3 className="was-sub-title">Test Query</h3>
              <p className="was-hint-sm">Test the bot without sending to WhatsApp.</p>
              <div className="was-test-row">
                <input
                  className="was-input was-input--wide"
                  placeholder="e.g. store food lion 1214 | alerts | truck 211"
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
                <code>truck [route]</code>
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

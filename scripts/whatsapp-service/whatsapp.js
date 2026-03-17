const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const adminChat = require('./adminChat');

let client = null;
let status = 'disconnected'; // disconnected | qr-pending | connected
let qrCode = null;         // raw QR string
let qrDataUrl = null;      // PNG data URL for browser display
let manualDisconnect = false;
let botWid = '';            // bot's own WhatsApp user ID (for @mention matching)

// Order message buffer -- incoming messages from the order group
const fs2 = require('fs');
const path = require('path');

const MESSAGES_FILE = path.join(__dirname, 'order-messages.json');
const CONTACTS_FILE = path.join(__dirname, 'order-contacts.json');
const GROUP_FILE = path.join(__dirname, 'order-group.json');
const RESPONSES_FILE = path.join(__dirname, 'alert-responses.json');
const BLAST_SENT_FILE = path.join(__dirname, 'blast-sent-refs.json');
const BLAST_SENT_APP_FILE = path.join(__dirname, '../../src/data/blastSentRefs.json');
const SENT_MESSAGES_FILE  = path.join(__dirname, 'sent-alert-messages.json');
const ADMIN_CONFIG_FILE   = path.join(__dirname, 'admin-chat.json');
const MAX_MESSAGES = 1000;

// Admin chat config
let adminGroups     = []; // array of { id, routes, destination } — routes [] = all routes
let adminPhones     = []; // authorized phone numbers (can query the bot)
let botPhone        = null;
let motiveApiKey    = null;
try {
  const cfg = JSON.parse(fs2.readFileSync(ADMIN_CONFIG_FILE, 'utf8'));
  if (cfg.groups) {
    adminGroups = cfg.groups;
  } else if (cfg.groupIds) {
    adminGroups = cfg.groupIds.map(id => ({ id, routes: [] }));
  } else if (cfg.groupId) {
    adminGroups = [{ id: cfg.groupId, routes: [] }];
  }
  adminPhones  = cfg.phones  || [];
  botPhone     = cfg.botPhone || null;
  motiveApiKey = cfg.motiveApiKey || null;
} catch { }

function saveAdminConfig() {
  try { fs2.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify({ motiveApiKey, groups: adminGroups, phones: adminPhones, botPhone }, null, 2)); } catch (e) { console.error('Failed to save admin config:', e.message); }
}

function setAdminGroup(groupId) {
  if (!adminGroups.some(g => g.id === groupId)) adminGroups.push({ id: groupId, routes: [] });
  saveAdminConfig();
}
function setAdminGroups(groups) {
  adminGroups = (groups || []).map(g => ({
    id: g.id,
    routes: g.routes || [],
    ...(g.destination ? { destination: g.destination } : {}),
  }));
  saveAdminConfig();
}
function setAdminPhones(phones) {
  adminPhones = phones || [];
  saveAdminConfig();
}
function getAdminConfig() {
  return { groups: adminGroups, phones: adminPhones, motiveApiKey: motiveApiKey || '' };
}
function setMotiveApiKey(key) {
  motiveApiKey = key || null;
  saveAdminConfig();
}
function getGroupConfig(groupId) {
  const g = adminGroups.find(g => g.id === groupId);
  if (!g) return null;
  return {
    routes: g.routes && g.routes.length > 0 ? g.routes : null,
    destination: g.destination || null,
    motiveApiKey,
  };
}
function getGroupRoutes(groupId) {
  const g = adminGroups.find(g => g.id === groupId);
  return g && g.routes && g.routes.length > 0 ? g.routes : null; // null = all routes
}

// Alert blast tracking — maps messageId -> refNumber for reply matching
let sentAlertMessages = {}; // { messageId: refNumber }
let alertResponses = [];
let blastSentRefs = {}; // { refNumber: timestamp }
try { alertResponses = JSON.parse(fs2.readFileSync(RESPONSES_FILE, 'utf8')) || []; } catch { }
try { blastSentRefs = JSON.parse(fs2.readFileSync(BLAST_SENT_FILE, 'utf8')) || {}; } catch { }
try { sentAlertMessages = JSON.parse(fs2.readFileSync(SENT_MESSAGES_FILE, 'utf8')) || {}; } catch { }

function saveResponses() {
  try { fs2.writeFileSync(RESPONSES_FILE, JSON.stringify(alertResponses, null, 2)); } catch (e) { console.error('Failed to save alert responses:', e.message); }
}

function saveBlastSentRefs() {
  const data = JSON.stringify(blastSentRefs, null, 2);
  try { fs2.writeFileSync(BLAST_SENT_FILE, data); } catch (e) { console.error('Failed to save blast sent refs:', e.message); }
  try { fs2.writeFileSync(BLAST_SENT_APP_FILE, data); } catch (e) { console.error('Failed to save blast sent refs to app:', e.message); }
}

function saveSentAlertMessages() {
  try { fs2.writeFileSync(SENT_MESSAGES_FILE, JSON.stringify(sentAlertMessages, null, 2)); } catch (e) { console.error('Failed to save sent alert messages:', e.message); }
}

// Load persisted state
let orderGroupId = null;
try { orderGroupId = JSON.parse(fs2.readFileSync(GROUP_FILE, 'utf8')).groupId || null; } catch { }

let orderMessages = [];
try { orderMessages = JSON.parse(fs2.readFileSync(MESSAGES_FILE, 'utf8')) || []; } catch { }

let contactMap = {};
try { contactMap = JSON.parse(fs2.readFileSync(CONTACTS_FILE, 'utf8')); } catch { }

// Save helpers
let msgSaveTimer = null;
function saveMessages() {
  if (msgSaveTimer) return; // debounce
  msgSaveTimer = setTimeout(() => {
    msgSaveTimer = null;
    try { fs2.writeFileSync(MESSAGES_FILE, JSON.stringify(orderMessages)); } catch (e) { console.error('Save messages error:', e.message); }
  }, 1000);
}
function saveContacts() { fs2.writeFileSync(CONTACTS_FILE, JSON.stringify(contactMap, null, 2)); }
function saveGroup() { fs2.writeFileSync(GROUP_FILE, JSON.stringify({ groupId: orderGroupId })); }

function getStatus() {
  return {
    status,
    qrCode:    status === 'qr-pending' ? qrCode    : null,
    qrDataUrl: status === 'qr-pending' ? qrDataUrl : null,
    phone:     status === 'connected'  ? getPhoneNumber() : null,
  };
}

function getPhoneNumber() {
  try { return client?.info?.wid?.user || null; } catch { return null; }
}

function initialize() {
  if (isInitializing) { console.log('[WA] initialize() skipped — already in progress'); return; }
  isInitializing = true;
  // Find Chrome on Windows
  const fs = require('fs');
  const chromePaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  ];
  const executablePath = chromePaths.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  if (executablePath) console.log('Using Chrome at:', executablePath);
  else console.log('No Chrome found, using bundled Chromium');

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      protocolTimeout: 120000, // 2 min
      ...(executablePath ? { executablePath } : {}),
    },
  });

  client.on('qr', async (qr) => {
    isInitializing = false; // QR received means init succeeded enough to show QR
    status = 'qr-pending';
    qrCode = qr;
    try { qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 }); } catch { qrDataUrl = null; }
    console.log('\n\uD83D\uDCF1 Scan this QR code with WhatsApp:\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    isInitializing = false;
    status = 'connected';
    qrCode = null;
    qrDataUrl = null;
    cachedGroups = null; // clear stale cache on reconnect
    groupsCachedAt = 0;

    // Store the bot's own WhatsApp ID for @mention matching
    try {
      const me = client.info?.wid;
      botWid = me ? (me.user || me._serialized || '') : '';
      console.log(`\u2705 WhatsApp client connected and ready! (bot ID: ${botWid})`);
    } catch {
      console.log('\u2705 WhatsApp client connected and ready!');
    }

    // Auto-fetch message history on startup if a group is configured
    if (orderGroupId) {
      console.log('\uD83D\uDCE5 Auto-loading message history on startup...');
      await loadHistory(500);
    }
  });

  client.on('authenticated', () => {
    console.log('\uD83D\uDD10 WhatsApp authenticated (session restored)');
  });

  client.on('auth_failure', (msg) => {
    isInitializing = false;
    status = 'disconnected';
    console.error('\u274C WhatsApp auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    qrCode = null;
    qrDataUrl = null;
    cachedGroups = null;
    groupsCachedAt = 0;
    console.log('\uD83D\uDD0C WhatsApp disconnected:', reason);
    // Only auto-reconnect if this wasn't a manual disconnect
    if (!manualDisconnect) scheduleReinitialize(10000);
    manualDisconnect = false;
  });

  // Listen for incoming messages -- capture order group messages + alert replies
  client.on('message', async (msg) => {
    try {
      // Check for alert reply (quoted message matching a sent alert)
      if (msg.hasQuotedMsg) {
        console.log(`[WA] Incoming quoted message from ${msg.author || msg.from}: "${(msg.body || '').substring(0, 40)}"`);

        try {
          const quoted = await msg.getQuotedMessage();
          const quotedId = quoted.id._serialized;
          // Check if the quoted message is one we sent as an alert blast
          let refNumber = sentAlertMessages[quotedId] || null;
          // Fallback: extract ref from quoted message caption/body text
          if (!refNumber) {
            const quotedText = quoted.body || '';
            const refMatch = quotedText.match(/(?:ADUSA|DSD1)-\d+/);
            if (refMatch) refNumber = refMatch[0];
          }
          if (refNumber) {
            const contact = await msg.getContact();
            const response = {
              refNumber,
              driverName: contact.pushname || contact.name || contact.number || msg.author || 'Unknown',
              response: msg.body || '',
              timestamp: msg.timestamp * 1000,
              messageId: msg.id._serialized,
              groupId: msg.from,
            };
            alertResponses.push(response);
            saveResponses();
            console.log(`\uD83D\uDCAC Alert reply for ${refNumber} from ${response.driverName}: "${msg.body.substring(0, 60)}"`);
          }
        } catch (qErr) {
          console.error('[WA] Quote fetch error:', qErr.message);
        }
      }

      // ── Admin chat query handler ──────────────────────────────────────────
      const isAdminGroup = adminGroups.some(g => g.id === msg.from);
      if (adminGroups.length > 0 && isAdminGroup) {
        const body = (msg.body || '').trim();

        // Check if message @mentions the bot
        const mentionedIds = msg.mentionedIds || [];
        const mentionsBot = mentionedIds.length > 0
          || (botWid && body.includes(botWid))
          || /[@＠]\d{5,}/.test(body);

        // Strip @mention tokens from the body to get the actual command
        // WhatsApp may use special unicode chars, so strip broadly
        const queryText = body
          .replace(/[@＠]\S+/g, '')          // standard and fullwidth @
          .replace(/\u200b/g, '')            // zero-width spaces
          .trim();

        // Only process if bot was @mentioned
        if (mentionsBot) {
          const contact = await msg.getContact();
          const phone   = contact.number || msg.author || msg.from;
          // Check if sender is authorized
          const isAuth  = adminPhones.length === 0 || adminPhones.includes(phone) || adminPhones.some(p => phone.endsWith(p.replace(/\D/g, '').slice(-10)));
          if (isAuth && queryText && !queryText.startsWith('_BOT_')) {
            console.log(`[AdminChat] Query from ${phone}: "${queryText.substring(0, 60)}"`);
            try {
              const routeFilter = getGroupRoutes(msg.from);
              const groupConfig = getGroupConfig(msg.from);
              const reply = await adminChat.processQuery(queryText, routeFilter, groupConfig);
              // Small delay so it feels natural
              await new Promise(r => setTimeout(r, 600));
              await client.sendMessage(msg.from, reply);
              console.log(`[AdminChat] Replied: "${reply.substring(0, 60)}"`);
            } catch (qErr) {
              console.error('[AdminChat] Reply error:', qErr.message);
            }
          }
        }
      }

      // Only capture order messages if an order group is configured
      if (!orderGroupId) return;
      // Only capture messages from the configured order group
      if (msg.from !== orderGroupId) return;

      const contact = await msg.getContact();
      const phone = contact.number || msg.author || msg.from;
      const entry = {
        id: msg.id._serialized,
        from: phone,
        pushName: contact.pushname || contact.name || phone,
        body: msg.body || '',
        timestamp: msg.timestamp * 1000, // convert to ms
        hasMedia: msg.hasMedia,
        mediaBase64: null,
        mediaType: null,
      };

      // Download media (images, etc.)
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            entry.mediaBase64 = media.data; // base64 string
            entry.mediaType = media.mimetype; // e.g. image/jpeg
          }
        } catch (mediaErr) {
          console.log('Could not download media:', mediaErr.message);
        }
      }

      orderMessages.push(entry);
      // Trim buffer
      if (orderMessages.length > MAX_MESSAGES) {
        orderMessages = orderMessages.slice(-MAX_MESSAGES);
      }
      saveMessages();

      console.log(`\uD83D\uDCE9 Order msg from ${entry.pushName} (${phone}): ${entry.body.substring(0, 60)}${entry.body.length > 60 ? '...' : ''}${entry.hasMedia ? ' [+media]' : ''}`);
    } catch (err) {
      console.error('Message listener error:', err.message);
    }
  });

  // Listen for edited messages -- update the buffer (WhatsApp allows edits up to 15 min)
  client.on('message_edit', (msg, newBody, prevBody) => {
    try {
      if (!orderGroupId) return;
      if (msg.from !== orderGroupId) return;

      const idx = orderMessages.findIndex(m => m.id === msg.id._serialized);
      if (idx !== -1) {
        // Only process edits for messages within the last 15 minutes
        const fifteenMin = 15 * 60 * 1000;
        if (Date.now() - orderMessages[idx].timestamp > fifteenMin) return;

        orderMessages[idx].body = newBody;
        orderMessages[idx].edited = true;
        saveMessages();
        console.log(`\uD83D\uDCDD Order msg edited by ${orderMessages[idx].pushName}: "${prevBody.substring(0, 30)}..." \u2192 "${newBody.substring(0, 30)}..."`);
      }
    } catch (err) {
      console.error('Message edit listener error:', err.message);
    }
  });

  // Listen for deleted messages -- remove from buffer
  client.on('message_revoke_everyone', (after, before) => {
    try {
      if (!orderGroupId) return;
      const msgId = after.id._serialized;
      const idx = orderMessages.findIndex(m => m.id === msgId);
      if (idx !== -1) {
        const removed = orderMessages.splice(idx, 1)[0];
        saveMessages();
        console.log(`\uD83D\uDDD1\uFE0F Order msg deleted by ${removed.pushName}: "${(removed.body || '').substring(0, 40)}..."`);
      }
    } catch (err) {
      console.error('Message revoke listener error:', err.message);
    }
  });

  client.initialize().catch(err => {
    console.error('\u274C Failed to initialize WhatsApp client:', err.message);
    isInitializing = false;
    status = 'disconnected';
    // Schedule retry after failure (longer delay to let Chrome release lock)
    scheduleReinitialize(15000);
  });
  console.log('\u23F3 Initializing WhatsApp client (this may take a moment)...');
}

// Cached group list -- avoid hammering WhatsApp Web on every poll
let cachedGroups = null;
let groupsCachedAt = 0;
const GROUPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Auto-reconnect scheduler -- avoids rapid reinit loops
let reinitTimer = null;
let isInitializing = false;

function scheduleReinitialize(delay = 10000) {
  if (reinitTimer || isInitializing) return; // already scheduled or in progress
  reinitTimer = setTimeout(async () => {
    reinitTimer = null;
    if (status !== 'disconnected' || manualDisconnect || isInitializing) return;
    isInitializing = true;
    console.log('[WA] Auto-reconnecting after detached frame / disconnect...');
    // Destroy old client and give Chrome time to fully exit
    const old = client;
    client = null;
    if (old) {
      try { await old.destroy(); } catch { }
      // Extra pause so Chromium releases the userDataDir lock
      await new Promise(r => setTimeout(r, 3000));
    }
    isInitializing = false;
    if (status === 'disconnected' && !manualDisconnect) initialize();
  }, delay);
}

// Manual disconnect — destroys session, stops auto-reconnect
async function disconnect() {
  manualDisconnect = true;
  if (reinitTimer) { clearTimeout(reinitTimer); reinitTimer = null; }
  status = 'disconnected';
  qrCode = null;
  qrDataUrl = null;
  cachedGroups = null;
  groupsCachedAt = 0;
  if (client) {
    try { await client.logout(); } catch { }
    try { await client.destroy(); } catch { }
    client = null;
  }
  console.log('[WA] Manually disconnected.');
}

// Reconnect after manual disconnect
async function reconnect() {
  manualDisconnect = false;
  isInitializing = false;
  const old = client;
  client = null;
  if (old) {
    try { await old.destroy(); } catch { }
    await new Promise(r => setTimeout(r, 2000));
  }
  initialize();
}

// Get all WhatsApp groups the user is a member of
async function getGroups() {
  if (status !== 'connected') {
    throw new Error('WhatsApp is not connected');
  }
  // Return cached list if fresh
  if (cachedGroups && Date.now() - groupsCachedAt < GROUPS_CACHE_TTL) {
    return cachedGroups;
  }
  // Retry once on timeout / detached-frame errors
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chats = await client.getChats();
      const groups = chats
        .filter(c => c.isGroup)
        .map(c => ({ id: c.id._serialized, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      cachedGroups = groups;
      groupsCachedAt = Date.now();
      return groups;
    } catch (err) {
      const isDetached = err.message.includes('detached Frame');
      const isRetryable = err.message.includes('timed out') || isDetached;
      console.warn(`[WA] getGroups attempt ${attempt} failed: ${err.message}`);
      if (attempt === 2 || !isRetryable) {
        // Detached frame persisted after both retries -- client is broken, force reconnect
        if (isDetached) {
          console.warn('[WA] Detached frame persists -- forcing reconnect in 8s');
          status = 'disconnected';
          cachedGroups = null;
          groupsCachedAt = 0;
          scheduleReinitialize();
        }
        throw err;
      }
      // Wait 3s before retry
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// Send a message to a group by its group ID (e.g. "120363xxxxx@g.us")
async function sendToGroup(groupId, message) {
  if (status !== 'connected') {
    throw new Error('WhatsApp is not connected');
  }
  const result = await client.sendMessage(groupId, message);
  return { success: true, messageId: result.id._serialized };
}

// Send formatted alert to a group
async function sendAlertToGroup(groupId, alert) {
  const lines = [
    '\uD83D\uDEA8 *Map Tracker Alert*',
    '',
    `*Route:* ${alert.route || 'N/A'}`,
    `*Type:* ${alert.type || 'Alert'}`,
    `*Store:* ${alert.store || 'N/A'}`,
    `*Message:* ${alert.message || ''}`,
    `*Time:* ${alert.timestamp || new Date().toLocaleString()}`,
  ];
  return sendToGroup(groupId, lines.join('\n'));
}

// Send formatted alert with image to a group
async function sendAlertWithImage(groupId, alert, imageBase64, mimeType) {
  if (!client || client.info === undefined) {
    throw new Error('WhatsApp is not connected');
  }

  // Build rich caption if new fields are present, otherwise fall back to legacy format
  let caption;
  if (alert.refNumber) {
    const lines = [
      `\uD83D\uDEA8 *Service Alert \u2014 ${alert.refNumber}*`,
      '',
    ];
    if (alert.store) lines.push(`\uD83D\uDCCD *Store:* ${alert.store}`);
    if (alert.city) lines.push(`\uD83C\uDFD9\uFE0F *Location:* ${alert.city}`);
    if (alert.alertDate) lines.push(`\uD83D\uDCC5 *Alert Date:* ${alert.alertDate}`);
    if (alert.createdBy) lines.push(`\uD83D\uDC64 *Created By:* ${alert.createdBy}`);
    if (alert.alertType) lines.push(`\u26A0\uFE0F *Type:* ${alert.alertType}`);
    if (alert.reason) lines.push(`\uD83D\uDCDD *Reason:* ${alert.reason}`);
    lines.push(`\uD83D\uDD17 *Ref:* ${alert.refNumber}`);
    lines.push('');
    lines.push('\u21A9\uFE0F Reply to this message to update the system.');
    caption = lines.join('\n');
  } else {
    caption = [
      '\uD83D\uDEA8 *Map Tracker Alert*',
      '',
      `*Route:* ${alert.route || 'N/A'}`,
      `*Type:* ${alert.type || 'Alert'}`,
      `*Store:* ${alert.store || 'N/A'}`,
      `*Message:* ${alert.message || ''}`,
      `*Time:* ${alert.timestamp || new Date().toLocaleString()}`,
    ].join('\n');
  }

  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  const base64Data = imageBase64 && imageBase64.length > 100
    ? (imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64)
    : null;

  const chat = await client.getChatById(groupId);
  let result;
  if (base64Data) {
    const media = new MessageMedia(mimeType || 'image/jpeg', base64Data);
    result = await chat.sendMessage(media, { caption });
  } else {
    // No valid image — send as text-only message
    result = await chat.sendMessage(caption);
  }
  const messageId = result.id._serialized;

  // Track sent message for reply matching
  if (alert.refNumber) {
    sentAlertMessages[messageId] = alert.refNumber;
    saveSentAlertMessages();
  }

  return { success: true, messageId };
}

// Send a batch of store-grouped alerts with images to a group
// Each item in `storeGroups` is: { store, city, alerts: [{ refNumber, alertDate, createdBy, alertType, reason, imageBase64, mimeType }] }
async function sendAlertBlast(groupId, storeGroups, summary) {
  if (!client || client.info === undefined) {
    throw new Error('WhatsApp is not connected');
  }

  const results = [];
  const chat = await client.getChatById(groupId);
  let storeIdx = 0;

  for (const group of storeGroups) {
    storeIdx++;
    const alertList = group.alerts || [];
    if (alertList.length === 0) continue;

    // Build combined caption for all alerts at this store
    const multi = alertList.length > 1;
    const lines = [
      `\uD83D\uDEA8 *Service Alert \u2014 ${group.store}${multi ? ` (${alertList.length} alerts)` : ''}*`,
      `\uD83C\uDFD9\uFE0F *Location:* ${group.city || 'N/A'}`,
      '',
    ];

    if (multi) {
      // Compact format: collect and deduplicate fields
      const refs = alertList.map(a => a.refNumber).filter(Boolean);
      const dates = alertList.map(a => {
        if (!a.alertDate) return null;
        // Strip year if present (show MM/DD only)
        const d = a.alertDate.replace(/\/20\d{2}$/, '').replace(/\/\d{4}$/, '');
        return d;
      }).filter(Boolean);
      const creators = [...new Set(alertList.map(a => a.createdBy).filter(Boolean))];
      const types = [...new Set(alertList.map(a => a.alertType).filter(Boolean))];
      const reasons = [...new Set(alertList.map(a => a.reason).filter(Boolean))];

      lines.push(`\uD83D\uDD17 *Refs:* ${refs.join(', ')}`);
      if (dates.length) lines.push(`\uD83D\uDCC5 *Dates:* ${dates.join(', ')}`);
      if (creators.length) lines.push(`\uD83D\uDC64 *Created By:* ${creators.join('; ')}`);
      if (types.length) lines.push(`\u26A0\uFE0F *Type${types.length > 1 ? 's' : ''}:* ${types.join(', ')}`);
      if (reasons.length) lines.push(`\uD83D\uDCDD *Reason${reasons.length > 1 ? 's' : ''}:* ${reasons.join('; ')}`);
    } else {
      // Single alert: clean single-entry format
      const a = alertList[0];
      lines.push(`\uD83D\uDD17 *Ref:* ${a.refNumber}`);
      if (a.alertDate) lines.push(`\uD83D\uDCC5 *Date:* ${a.alertDate}`);
      if (a.createdBy) lines.push(`\uD83D\uDC64 *Created By:* ${a.createdBy}`);
      if (a.alertType) lines.push(`\u26A0\uFE0F *Type:* ${a.alertType}`);
      if (a.reason) lines.push(`\uD83D\uDCDD *Reason:* ${a.reason}`);
    }

    lines.push('');
    lines.push('\u21A9\uFE0F Reply to this message to update the system.');
    const caption = lines.join('\n');

    // Send first image with the full caption
    const firstAlert = alertList[0];
    try {
      const base64Data = firstAlert.imageBase64 && firstAlert.imageBase64.length > 100
        ? (firstAlert.imageBase64.includes(',') ? firstAlert.imageBase64.split(',')[1] : firstAlert.imageBase64)
        : null;

      let result;
      if (base64Data) {
        const media = new MessageMedia(firstAlert.mimeType || 'image/jpeg', base64Data);
        result = await chat.sendMessage(media, { caption });
      } else {
        result = await chat.sendMessage(caption);
      }
      const messageId = result.id._serialized;
      // Track all ref numbers in this group for reply matching
      alertList.forEach(a => { sentAlertMessages[messageId] = a.refNumber; });
      results.push({ refNumber: firstAlert.refNumber, success: true, messageId });
      console.log(`[WA Blast] Sent store ${storeIdx}/${storeGroups.length}: ${group.store} (${alertList.length} alert${alertList.length > 1 ? 's' : ''})`);
    } catch (err) {
      console.error(`[WA Blast] Failed ${group.store}:`, err.message);
      alertList.forEach(a => results.push({ refNumber: a.refNumber, success: false, error: err.message }));
      continue;
    }

    // Send additional images (2nd, 3rd, etc.) with short captions
    for (let i = 1; i < alertList.length; i++) {
      const a = alertList[i];
      await new Promise(r => setTimeout(r, 800));
      try {
        const base64Data = a.imageBase64 && a.imageBase64.length > 100
          ? (a.imageBase64.includes(',') ? a.imageBase64.split(',')[1] : a.imageBase64)
          : null;

        if (base64Data) {
          const media = new MessageMedia(a.mimeType || 'image/jpeg', base64Data);
          const imgCaption = `\uD83D\uDCF7 ${group.store} \u2014 Ref: ${a.refNumber}`;
          const result = await chat.sendMessage(media, { caption: imgCaption });
          const msgId = result.id._serialized;
          sentAlertMessages[msgId] = a.refNumber;
          results.push({ refNumber: a.refNumber, success: true, messageId: msgId });
        } else {
          results.push({ refNumber: a.refNumber, success: true, messageId: null });
        }
      } catch (err) {
        console.error(`[WA Blast] Failed image for ${a.refNumber}:`, err.message);
        results.push({ refNumber: a.refNumber, success: false, error: err.message });
      }
    }

    // Delay between stores
    if (storeIdx < storeGroups.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Send summary message at the end
  if (summary) {
    try {
      await sendToGroup(groupId, summary);
      console.log('[WA Blast] Summary sent');
    } catch (err) {
      console.error('[WA Blast] Failed to send summary:', err.message);
    }
  }

  // Persist successful refs and message mappings to disk
  const now = new Date().toISOString();
  results.filter(r => r.success).forEach(r => { blastSentRefs[r.refNumber] = now; });
  saveBlastSentRefs();
  saveSentAlertMessages();

  return { results };
}

// Get blast-sent refs (for frontend hydration)
function getBlastSentRefs() {
  return blastSentRefs;
}

// Get alert responses from drivers
function getAlertResponses() {
  return alertResponses;
}

// Send route report summary to a group
async function sendReportToGroup(groupId, routeNumber, stats) {
  const lines = [
    `\uD83D\uDCCA *Route ${routeNumber} \u2014 Weekly Report*`,
    '',
    `\uD83D\uDCC5 *Period:* ${stats.period || 'Last 7 days'}`,
    `\uD83C\uDFEA *Stores Visited:* ${stats.storesVisited ?? 'N/A'}`,
    `\uD83D\uDCCD *Total Stops:* ${stats.totalStops ?? 'N/A'}`,
    `\uD83D\uDEE3\uFE0F *Miles Driven:* ${stats.milesDriven ? stats.milesDriven.toFixed(1) : 'N/A'}`,
    `\u26FD *Fuel Cost:* ${stats.fuelCost ? '$' + stats.fuelCost.toFixed(2) : 'N/A'}`,
    `\u26FD *Gallons:* ${stats.gallons ? stats.gallons.toFixed(1) : 'N/A'}`,
    `\uD83D\uDCC8 *MPG:* ${stats.mpg ? stats.mpg.toFixed(1) : 'N/A'}`,
  ];

  if (stats.overdueStores && stats.overdueStores.length > 0) {
    lines.push('', '\u26A0\uFE0F *Overdue Stores:*');
    stats.overdueStores.forEach((s) => {
      lines.push(`  \u2022 ${s.name} \u2014 ${s.severity || 'overdue'} (${s.daysSince} days)`);
    });
  }

  if (stats.alerts && stats.alerts > 0) {
    lines.push('', `\uD83D\uDD14 *Open Alerts:* ${stats.alerts}`);
  }

  return sendToGroup(groupId, lines.join('\n'));
}

// Load message history from WhatsApp -- reusable for startup + on-demand refresh
async function loadHistory(limit = 500) {
  if (!client || status !== 'connected' || !orderGroupId) {
    return { success: false, loaded: 0, total: orderMessages.length, error: 'Not connected or no group set' };
  }
  try {
    const chat = await client.getChatById(orderGroupId);
    const history = await chat.fetchMessages({ limit });
    let loaded = 0;
    for (const msg of history) {
      const msgId = msg.id._serialized;
      if (orderMessages.find(m => m.id === msgId)) continue;
      if (msg.fromMe) continue;

      const contact = await msg.getContact();
      const phone = contact.number || msg.author || msg.from;
      const entry = {
        id: msgId,
        from: phone,
        pushName: contact.pushname || contact.name || phone,
        body: msg.body || '',
        timestamp: msg.timestamp * 1000,
        hasMedia: msg.hasMedia,
        mediaBase64: null,
        mediaType: null,
      };

      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            entry.mediaBase64 = media.data;
            entry.mediaType = media.mimetype;
          }
        } catch { }
      }

      orderMessages.push(entry);
      loaded++;
    }
    orderMessages.sort((a, b) => a.timestamp - b.timestamp);
    if (orderMessages.length > MAX_MESSAGES) {
      orderMessages = orderMessages.slice(-MAX_MESSAGES);
    }
    if (loaded > 0) {
      saveMessages();
      console.log(`\uD83D\uDCE5 Loaded ${loaded} messages from group history (limit: ${limit}, total: ${orderMessages.length})`);
    } else {
      console.log(`\uD83D\uDCE5 No new messages to load (buffer has ${orderMessages.length})`);
    }
    return { success: true, loaded, total: orderMessages.length };
  } catch (err) {
    console.error('Failed to load group history:', err.message);
    return { success: false, loaded: 0, total: orderMessages.length, error: err.message };
  }
}

// Set which group to listen to for orders -- also load recent message history
async function setOrderGroup(groupId) {
  orderGroupId = groupId;
  saveGroup();
  console.log(`\uD83D\uDCCB Order group set to: ${groupId}`);
  await loadHistory(500);
}

function getOrderGroup() {
  return orderGroupId;
}

// Get buffered order messages, optionally since a timestamp
function getOrderMessages(since = 0) {
  const msgs = since ? orderMessages.filter(m => m.timestamp > since) : orderMessages;
  // Enrich with contact mapping
  return msgs.map(m => ({
    ...m,
    contactName: contactMap[m.from]?.name || m.pushName || m.from,
    contactRoute: contactMap[m.from]?.route || null,
  }));
}

// Dismiss/clear messages (by IDs or all)
function dismissMessages(ids) {
  if (!ids || ids.length === 0) {
    orderMessages = [];
  } else {
    orderMessages = orderMessages.filter(m => !ids.includes(m.id));
  }
  saveMessages();
}

// Contact mapping
function setContact(phone, name, route) {
  contactMap[phone] = { name, route };
  saveContacts();
}

function getContacts() {
  return contactMap;
}

function removeContact(phone) {
  delete contactMap[phone];
  saveContacts();
}

module.exports = {
  initialize,
  disconnect,
  reconnect,
  getStatus,
  getPhoneNumber,
  getGroups,
  sendToGroup,
  sendAlertToGroup,
  sendAlertWithImage,
  sendAlertBlast,
  sendReportToGroup,
  setOrderGroup,
  getOrderGroup,
  getOrderMessages,
  loadHistory,
  dismissMessages,
  setContact,
  getContacts,
  removeContact,
  getAlertResponses,
  getBlastSentRefs,
  setAdminGroup,
  setAdminGroups,
  setAdminPhones,
  getAdminConfig,
  setMotiveApiKey,
};

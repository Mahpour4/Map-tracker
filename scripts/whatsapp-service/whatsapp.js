const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

let client = null;
let status = 'disconnected'; // disconnected | qr-pending | connected
let qrCode = null;

// Order message buffer -- incoming messages from the order group
const fs2 = require('fs');
const path = require('path');

const MESSAGES_FILE = path.join(__dirname, 'order-messages.json');
const CONTACTS_FILE = path.join(__dirname, 'order-contacts.json');
const GROUP_FILE = path.join(__dirname, 'order-group.json');
const MAX_MESSAGES = 1000;

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
  return { status, qrCode: status === 'qr-pending' ? qrCode : null };
}

function initialize() {
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

  client.on('qr', (qr) => {
    status = 'qr-pending';
    qrCode = qr;
    console.log('\n\uD83D\uDCF1 Scan this QR code with WhatsApp:\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    status = 'connected';
    qrCode = null;
    cachedGroups = null; // clear stale cache on reconnect
    groupsCachedAt = 0;
    console.log('\u2705 WhatsApp client connected and ready!');

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
    status = 'disconnected';
    console.error('\u274C WhatsApp auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    cachedGroups = null;
    groupsCachedAt = 0;
    console.log('\uD83D\uDD0C WhatsApp disconnected:', reason);
    // Auto-reconnect after 10s (longer delay to let WhatsApp settle)
    scheduleReinitialize(10000);
  });

  // Listen for incoming messages -- capture order group messages
  client.on('message', async (msg) => {
    try {
      // Only capture if an order group is configured
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
    status = 'disconnected';
  });
  console.log('\u23F3 Initializing WhatsApp client (this may take a moment)...');
}

// Cached group list -- avoid hammering WhatsApp Web on every poll
let cachedGroups = null;
let groupsCachedAt = 0;
const GROUPS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Auto-reconnect scheduler -- avoids rapid reinit loops
let reinitTimer = null;
function scheduleReinitialize(delay = 8000) {
  if (reinitTimer) return; // already scheduled
  reinitTimer = setTimeout(() => {
    reinitTimer = null;
    if (status === 'disconnected') {
      console.log('[WA] Auto-reconnecting after detached frame / disconnect...');
      try { if (client) client.destroy().catch(() => {}); } catch { }
      client = null;
      initialize();
    }
  }, delay);
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
  const caption = [
    '\uD83D\uDEA8 *Map Tracker Alert*',
    '',
    `*Route:* ${alert.route || 'N/A'}`,
    `*Type:* ${alert.type || 'Alert'}`,
    `*Store:* ${alert.store || 'N/A'}`,
    `*Message:* ${alert.message || ''}`,
    `*Time:* ${alert.timestamp || new Date().toLocaleString()}`,
  ].join('\n');

  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const media = new MessageMedia(mimeType || 'image/jpeg', base64Data);
  const chat = await client.getChatById(groupId);
  const result = await chat.sendMessage(media, { caption });
  return { success: true, messageId: result.id._serialized };
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
  getStatus,
  getGroups,
  sendToGroup,
  sendAlertToGroup,
  sendAlertWithImage,
  sendReportToGroup,
  setOrderGroup,
  getOrderGroup,
  getOrderMessages,
  loadHistory,
  dismissMessages,
  setContact,
  getContacts,
  removeContact,
};

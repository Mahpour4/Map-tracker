const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

let client = null;
let status = 'disconnected'; // disconnected | qr-pending | connected
let qrCode = null;

// Order message buffer — incoming messages from the order group
let orderGroupId = null; // set via API
let orderMessages = []; // { id, from, pushName, body, timestamp, hasMedia, mediaBase64, mediaType }
const MAX_MESSAGES = 200;

// Phone number → driver/route mapping (persisted to file)
const fs2 = require('fs');
const path = require('path');
const CONTACTS_FILE = path.join(__dirname, 'order-contacts.json');
let contactMap = {}; // { phoneNumber: { name, route } }
try { contactMap = JSON.parse(fs2.readFileSync(CONTACTS_FILE, 'utf8')); } catch { }
function saveContacts() { fs2.writeFileSync(CONTACTS_FILE, JSON.stringify(contactMap, null, 2)); }

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
      ...(executablePath ? { executablePath } : {}),
    },
  });

  client.on('qr', (qr) => {
    status = 'qr-pending';
    qrCode = qr;
    console.log('\n📱 Scan this QR code with WhatsApp:\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    status = 'connected';
    qrCode = null;
    console.log('✅ WhatsApp client connected and ready!');
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated (session restored)');
  });

  client.on('auth_failure', (msg) => {
    status = 'disconnected';
    console.error('❌ WhatsApp auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    console.log('🔌 WhatsApp disconnected:', reason);
  });

  // Listen for incoming messages — capture order group messages
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

      console.log(`📩 Order msg from ${entry.pushName} (${phone}): ${entry.body.substring(0, 60)}${entry.body.length > 60 ? '...' : ''}${entry.hasMedia ? ' [+media]' : ''}`);
    } catch (err) {
      console.error('Message listener error:', err.message);
    }
  });

  client.initialize().catch(err => {
    console.error('❌ Failed to initialize WhatsApp client:', err.message);
    status = 'disconnected';
  });
  console.log('⏳ Initializing WhatsApp client (this may take a moment)...');
}

// Get all WhatsApp groups the user is a member of
async function getGroups() {
  if (status !== 'connected') {
    throw new Error('WhatsApp is not connected');
  }
  const chats = await client.getChats();
  return chats
    .filter(c => c.isGroup)
    .map(c => ({ id: c.id._serialized, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    '🚨 *Map Tracker Alert*',
    '',
    `*Route:* ${alert.route || 'N/A'}`,
    `*Type:* ${alert.type || 'Alert'}`,
    `*Store:* ${alert.store || 'N/A'}`,
    `*Message:* ${alert.message || ''}`,
    `*Time:* ${alert.timestamp || new Date().toLocaleString()}`,
  ];
  return sendToGroup(groupId, lines.join('\n'));
}

// Send route report summary to a group
async function sendReportToGroup(groupId, routeNumber, stats) {
  const lines = [
    `📊 *Route ${routeNumber} — Weekly Report*`,
    '',
    `📅 *Period:* ${stats.period || 'Last 7 days'}`,
    `🏪 *Stores Visited:* ${stats.storesVisited ?? 'N/A'}`,
    `📍 *Total Stops:* ${stats.totalStops ?? 'N/A'}`,
    `🛣️ *Miles Driven:* ${stats.milesDriven ? stats.milesDriven.toFixed(1) : 'N/A'}`,
    `⛽ *Fuel Cost:* ${stats.fuelCost ? '$' + stats.fuelCost.toFixed(2) : 'N/A'}`,
    `⛽ *Gallons:* ${stats.gallons ? stats.gallons.toFixed(1) : 'N/A'}`,
    `📈 *MPG:* ${stats.mpg ? stats.mpg.toFixed(1) : 'N/A'}`,
  ];

  if (stats.overdueStores && stats.overdueStores.length > 0) {
    lines.push('', '⚠️ *Overdue Stores:*');
    stats.overdueStores.forEach((s) => {
      lines.push(`  • ${s.name} — ${s.severity || 'overdue'} (${s.daysSince} days)`);
    });
  }

  if (stats.alerts && stats.alerts > 0) {
    lines.push('', `🔔 *Open Alerts:* ${stats.alerts}`);
  }

  return sendToGroup(groupId, lines.join('\n'));
}

// Set which group to listen to for orders
function setOrderGroup(groupId) {
  orderGroupId = groupId;
  console.log(`📋 Order group set to: ${groupId}`);
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
  sendReportToGroup,
  setOrderGroup,
  getOrderGroup,
  getOrderMessages,
  dismissMessages,
  setContact,
  getContacts,
  removeContact,
};

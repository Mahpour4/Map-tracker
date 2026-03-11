const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const whatsapp = require('./whatsapp');
const globalworx = require('./globalworx');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Local file persistence (saved outside src/ so Vite HMR doesn't trigger) ──
// Files go to project-root/local-data/ — not watched by Vite, not committed.
const DATA_DIR = path.join(__dirname, '../../local-data');

const LOCAL_FILES = {
  'warehouseOrders': path.join(DATA_DIR, 'warehouseOrders.json'),
  'inventory': path.join(DATA_DIR, 'inventory.json'),
};

app.get('/api/local/:key', (req, res) => {
  const filePath = LOCAL_FILES[req.params.key];
  if (!filePath) return res.status(404).json({ error: 'Unknown key' });
  try {
    if (!fs.existsSync(filePath)) return res.json(null);
    const content = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/local/:key', (req, res) => {
  const filePath = LOCAL_FILES[req.params.key];
  if (!filePath) return res.status(404).json({ error: 'Unknown key' });
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check / status
app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsapp.getStatus());
});

// Disconnect from WhatsApp (logs out + destroys session)
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    await whatsapp.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reconnect (re-initialize, will show QR if session gone)
app.post('/api/whatsapp/reconnect', async (req, res) => {
  try {
    await whatsapp.reconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all WhatsApp groups
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const groups = await whatsapp.getGroups();
    res.json({ groups });
  } catch (err) {
    console.error('Get groups error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send text message to a group
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { groupId, message } = req.body;
    if (!groupId || !message) {
      return res.status(400).json({ error: 'groupId and message are required' });
    }
    const result = await whatsapp.sendToGroup(groupId, message);
    res.json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send formatted alert to a group
app.post('/api/whatsapp/send-alert', async (req, res) => {
  try {
    const { groupId, alert } = req.body;
    if (!groupId || !alert) {
      return res.status(400).json({ error: 'groupId and alert are required' });
    }
    const result = await whatsapp.sendAlertToGroup(groupId, alert);
    res.json(result);
  } catch (err) {
    console.error('Send alert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send formatted alert with image to a group
app.post('/api/whatsapp/send-alert-image', async (req, res) => {
  try {
    const { groupId, alert, imageBase64, mimeType } = req.body;
    if (!groupId || !alert || !imageBase64) {
      return res.status(400).json({ error: 'groupId, alert, and imageBase64 are required' });
    }
    const result = await whatsapp.sendAlertWithImage(groupId, alert, imageBase64, mimeType);
    res.json(result);
  } catch (err) {
    console.error('Send alert image error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send route report summary to a group
app.post('/api/whatsapp/send-report', async (req, res) => {
  try {
    const { groupId, routeNumber, stats } = req.body;
    if (!groupId || !routeNumber) {
      return res.status(400).json({ error: 'groupId and routeNumber are required' });
    }
    const result = await whatsapp.sendReportToGroup(groupId, routeNumber, stats || {});
    res.json(result);
  } catch (err) {
    console.error('Send report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send a batch of store-grouped alerts with images to a group (alert blast)
app.post('/api/whatsapp/send-alert-blast', async (req, res) => {
  try {
    const { groupId, storeGroups, summary } = req.body;
    if (!groupId || !storeGroups || !Array.isArray(storeGroups) || storeGroups.length === 0) {
      return res.status(400).json({ error: 'groupId and storeGroups array are required' });
    }
    const result = await whatsapp.sendAlertBlast(groupId, storeGroups, summary);
    res.json(result);
  } catch (err) {
    console.error('Alert blast error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get driver responses to alert blasts
app.get('/api/whatsapp/alert-responses', (req, res) => {
  const responses = whatsapp.getAlertResponses();
  res.json({ responses });
});

// Get blast-sent refs (which alerts have been sent)
app.get('/api/whatsapp/blast-sent-refs', (req, res) => {
  const refs = whatsapp.getBlastSentRefs();
  res.json({ refs });
});

// ── Order Group Message Endpoints ────────────────────────────────────────────

// Set which WhatsApp group to listen to for orders
app.post('/api/whatsapp/set-order-group', async (req, res) => {
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId is required' });
  await whatsapp.setOrderGroup(groupId);
  res.json({ success: true, groupId });
});

// Get current order group
app.get('/api/whatsapp/order-group', (req, res) => {
  res.json({ groupId: whatsapp.getOrderGroup() });
});

// Get buffered order messages (optionally since a timestamp)
app.get('/api/whatsapp/order-messages', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const messages = whatsapp.getOrderMessages(since);
  res.json({ messages });
});

// Fetch/refresh message history from WhatsApp (on-demand)
app.post('/api/whatsapp/fetch-history', async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 500;
    const result = await whatsapp.loadHistory(limit);
    res.json(result);
  } catch (err) {
    console.error('Fetch history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dismiss order messages
app.post('/api/whatsapp/dismiss-messages', (req, res) => {
  const { ids } = req.body; // array of message IDs, or empty to clear all
  whatsapp.dismissMessages(ids || []);
  res.json({ success: true });
});

// Set phone → driver/route mapping
app.post('/api/whatsapp/contacts', (req, res) => {
  const { phone, name, route } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  whatsapp.setContact(phone, name || '', route || '');
  res.json({ success: true });
});

// Get all contacts
app.get('/api/whatsapp/contacts', (req, res) => {
  res.json({ contacts: whatsapp.getContacts() });
});

// Remove a contact mapping
app.delete('/api/whatsapp/contacts/:phone', (req, res) => {
  whatsapp.removeContact(req.params.phone);
  res.json({ success: true });
});

// ── GlobalWorx Auto-Accept Endpoints ─────────────────────────────────────────

// Check if GlobalWorx acceptance service (Puppeteer/Chrome) is available
app.get('/api/globalworx/status', async (req, res) => {
  try {
    const status = await globalworx.checkStatus();
    res.json(status);
  } catch (err) {
    res.json({ available: false, error: err.message });
  }
});

// Accept a single alert on GlobalWorx
app.post('/api/globalworx/accept', async (req, res) => {
  try {
    const { url, refNumber } = req.body;
    if (!url || !refNumber) {
      return res.status(400).json({ error: 'url and refNumber are required' });
    }
    const result = await globalworx.acceptBatch([{ url, refNumber }]);
    res.json(result.results[0] || { success: false, error: 'No result' });
  } catch (err) {
    console.error('GlobalWorx accept error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Accept a batch of alerts on GlobalWorx
app.post('/api/globalworx/accept-batch', async (req, res) => {
  try {
    const { alerts } = req.body;
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'alerts array is required' });
    }
    const result = await globalworx.acceptBatch(alerts);
    res.json(result);
  } catch (err) {
    console.error('GlobalWorx batch accept error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Complete a batch of alerts on GlobalWorx (click "Complete Here")
app.post('/api/globalworx/complete-batch', async (req, res) => {
  try {
    const { alerts } = req.body;
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'alerts array is required' });
    }
    const result = await globalworx.completeBatch(alerts);
    res.json(result);
  } catch (err) {
    console.error('GlobalWorx batch complete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/globalworx/scrape-batch', async (req, res) => {
  try {
    const { alerts } = req.body;
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'alerts array is required' });
    }
    const result = await globalworx.scrapeBatch(alerts);
    res.json(result);
  } catch (err) {
    console.error('GlobalWorx batch scrape error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/globalworx/check-status-batch', async (req, res) => {
  try {
    const { alerts } = req.body;
    if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
      return res.status(400).json({ error: 'alerts array is required' });
    }
    const result = await globalworx.checkStatusBatch(alerts);
    res.json(result);
  } catch (err) {
    console.error('GlobalWorx batch check-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Chat Config Endpoints ───────────────────────────────────────────────

app.get('/api/whatsapp/admin-config', (req, res) => {
  res.json(whatsapp.getAdminConfig());
});

app.post('/api/whatsapp/admin-config', (req, res) => {
  const { groupId, phones } = req.body;
  if (groupId !== undefined) whatsapp.setAdminGroup(groupId || null);
  if (phones  !== undefined) whatsapp.setAdminPhones(phones || []);
  res.json({ success: true, config: whatsapp.getAdminConfig() });
});

// Manual admin query (for testing from the UI)
app.post('/api/whatsapp/admin-query', (req, res) => {
  const adminChat = require('./adminChat');
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  try {
    const reply = adminChat.processQuery(query);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize WhatsApp client and start server
whatsapp.initialize();

app.listen(PORT, () => {
  console.log(`\n🌐 WhatsApp service running on http://localhost:${PORT}`);
  console.log(`   Status: http://localhost:${PORT}/api/whatsapp/status`);
  console.log(`   Groups: http://localhost:${PORT}/api/whatsapp/groups\n`);
});

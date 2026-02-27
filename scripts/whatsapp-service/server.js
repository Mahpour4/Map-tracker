const express = require('express');
const cors = require('cors');
const whatsapp = require('./whatsapp');
const globalworx = require('./globalworx');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Health check / status
app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsapp.getStatus());
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

// Initialize WhatsApp client and start server
whatsapp.initialize();

app.listen(PORT, () => {
  console.log(`\n🌐 WhatsApp service running on http://localhost:${PORT}`);
  console.log(`   Status: http://localhost:${PORT}/api/whatsapp/status`);
  console.log(`   Groups: http://localhost:${PORT}/api/whatsapp/groups\n`);
});

const express = require('express');
const cors = require('cors');
const whatsapp = require('./whatsapp');

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

// Initialize WhatsApp client and start server
whatsapp.initialize();

app.listen(PORT, () => {
  console.log(`\n🌐 WhatsApp service running on http://localhost:${PORT}`);
  console.log(`   Status: http://localhost:${PORT}/api/whatsapp/status`);
  console.log(`   Groups: http://localhost:${PORT}/api/whatsapp/groups\n`);
});

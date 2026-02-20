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

// Send text message
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }
    const result = await whatsapp.sendMessage(phone, message);
    res.json(result);
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send formatted alert
app.post('/api/whatsapp/send-alert', async (req, res) => {
  try {
    const { phone, alert } = req.body;
    if (!phone || !alert) {
      return res.status(400).json({ error: 'phone and alert are required' });
    }
    const result = await whatsapp.sendAlert(phone, alert);
    res.json(result);
  } catch (err) {
    console.error('Send alert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send route report summary
app.post('/api/whatsapp/send-report', async (req, res) => {
  try {
    const { phone, routeNumber, stats } = req.body;
    if (!phone || !routeNumber) {
      return res.status(400).json({ error: 'phone and routeNumber are required' });
    }
    const result = await whatsapp.sendReport(phone, routeNumber, stats || {});
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
  console.log(`   Status: http://localhost:${PORT}/api/whatsapp/status\n`);
});

'use strict';

const express = require('express');
const cors = require('cors');
const { submitCompletionForm } = require('./puppeteer-automation');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/globalworx/status', (req, res) => {
  res.json({ status: 'ready' });
});

// Complete a single alert
app.post('/api/globalworx/complete', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const success = await submitCompletionForm(url);
    res.json({ success });
  } catch (err) {
    console.error('[complete] Error:', err.message);
    res.status(500).json({ error: err.message, success: false });
  }
});

// Complete multiple alerts for a route (sequential processing)
app.post('/api/globalworx/complete-route', async (req, res) => {
  const { alerts } = req.body;
  if (!alerts || !Array.isArray(alerts) || alerts.length === 0) {
    return res.status(400).json({ error: 'alerts array is required' });
  }

  console.log(`[complete-route] Processing ${alerts.length} alert(s)...`);
  const results = [];

  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
    console.log(`[complete-route] (${i + 1}/${alerts.length}) ${alert.refNumber || 'unknown'}...`);

    if (!alert.acceptanceUrl) {
      results.push({ emailId: alert.emailId, refNumber: alert.refNumber, success: false, error: 'No URL' });
      continue;
    }

    try {
      const success = await submitCompletionForm(alert.acceptanceUrl);
      results.push({ emailId: alert.emailId, refNumber: alert.refNumber, success });
      console.log(`[complete-route]   ${success ? 'OK' : 'FAILED'}`);
    } catch (err) {
      console.error(`[complete-route]   ERROR: ${err.message}`);
      results.push({ emailId: alert.emailId, refNumber: alert.refNumber, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  console.log(`[complete-route] Done: ${succeeded}/${alerts.length} succeeded`);
  res.json({ results, succeeded, total: alerts.length });
});

app.listen(PORT, () => {
  console.log(`GlobalWorx completion service running on http://localhost:${PORT}`);
  console.log(`  GET  /api/globalworx/status`);
  console.log(`  POST /api/globalworx/complete-route`);
});

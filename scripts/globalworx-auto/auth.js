/**
 * auth.js — Run this once to generate credentials.json
 *
 * Usage:
 *   node auth.js
 *
 * Prerequisites:
 *   1. Create a Google Cloud project
 *   2. Enable the Gmail API
 *   3. Create OAuth2 credentials (Desktop app) and download as client_secret.json
 *   4. Place client_secret.json in this folder
 *   5. Run: node auth.js
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

const SECRET_PATH = path.join(__dirname, 'client_secret.json');
const CREDS_PATH  = path.join(__dirname, 'credentials.json');

async function main() {
  if (!fs.existsSync(SECRET_PATH)) {
    console.error('ERROR: client_secret.json not found.');
    console.error('Download it from Google Cloud Console → APIs & Services → Credentials.');
    process.exit(1);
  }

  const secret = JSON.parse(fs.readFileSync(SECRET_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = secret.installed || secret.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpen this URL in your browser and authorise the app:\n');
  console.log(authUrl);
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste the authorisation code here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      fs.writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
      console.log('\nSaved credentials to credentials.json — you can now run: node index.js');
    } catch (err) {
      console.error('Failed to get token:', err.message);
    }
  });
}

main();

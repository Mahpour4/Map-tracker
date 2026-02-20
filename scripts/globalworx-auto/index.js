/**
 * globalworx-auto/index.js
 *
 * Polls Gmail for unread GlobalWorx alert emails, extracts the acceptance
 * link from the email body, submits the form via Puppeteer, then labels
 * the email as "Processed".
 *
 * Setup: run `node auth.js` first to generate credentials.json
 * Run:   node index.js
 */

'use strict';

const { google }   = require('googleapis');
const puppeteer    = require('puppeteer');
const fs           = require('fs');
const path         = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG = {
  // Gmail label applied to processed emails
  PROCESSED_LABEL: 'Processed',

  // Gmail labels for the Done → Complete flow
  DONE_LABEL: 'GLOBAL WORKS/Done',
  COMPLETED_LABEL: 'GLOBAL WORKS/Completed',

  // How often to check for new emails (milliseconds). Set to 0 to run once.
  POLL_INTERVAL_MS: 2 * 60 * 1000, // 2 minutes

  // GlobalWorx acceptance form values
  FORM: {
    name:    'Wise Office',
    comment: 'Acknowledging issue — will resolve within 48 hours.',
    // Text that matches the "48 hours" option in the resolution-window dropdown
    resolutionText: '48',
  },

  // Gmail search query — unread service alert emails from the past 5 days only
  GMAIL_QUERY: 'is:unread subject:"Service Alert created for" newer_than:5d',

  // Gmail search query — emails labeled Done but not yet Completed
  COMPLETE_QUERY: 'subject:"Service Alert created for" label:GLOBAL-WORKS/Done -label:GLOBAL-WORKS/Completed newer_than:5d',

  // Regex to find the acceptance link anywhere in the email body
  URL_PATTERN: /https?:\/\/[^\s"'<>]+go\.mbl\?[^\s"'<>]+action=schedule\.RemoteAccept[^\s"'<>]*/gi,

  // Fallback: any adusa.goglobalworx link in the email (catches different URL shapes)
  FALLBACK_URL_PATTERN: /https?:\/\/[^\s"'<>]*adusa\.goglobalworx\.com[^\s"'<>]*/gi,

  // Paths
  SECRET_PATH: path.join(__dirname, 'client_secret.json'),
  CREDS_PATH:  path.join(__dirname, 'credentials.json'),

  // Puppeteer timeout (ms)
  PAGE_TIMEOUT: 30_000,
};
// ───────────────────────────────────────────────────────────────────────────

// ─── Gmail auth ─────────────────────────────────────────────────────────────
function buildAuthClient() {
  if (!fs.existsSync(CONFIG.SECRET_PATH)) {
    throw new Error(`client_secret.json not found at ${CONFIG.SECRET_PATH}\nRun node auth.js first.`);
  }
  if (!fs.existsSync(CONFIG.CREDS_PATH)) {
    throw new Error(`credentials.json not found at ${CONFIG.CREDS_PATH}\nRun node auth.js first.`);
  }

  const secret = JSON.parse(fs.readFileSync(CONFIG.SECRET_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = secret.installed || secret.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const tokens = JSON.parse(fs.readFileSync(CONFIG.CREDS_PATH, 'utf8'));
  oAuth2Client.setCredentials(tokens);

  // Auto-refresh tokens and persist
  oAuth2Client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(CONFIG.CREDS_PATH, JSON.stringify(merged, null, 2));
    console.log('[auth] Token refreshed and saved.');
  });

  return oAuth2Client;
}

// ─── Gmail helpers ───────────────────────────────────────────────────────────

/** Decode base64url-encoded Gmail message part */
function decodeBase64(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Recursively collect all text from MIME parts (HTML preferred, then plain) */
function extractBodyParts(payload) {
  const results = { html: '', plain: '' };

  function walk(part) {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();

    if (mime === 'text/html' && part.body?.data) {
      results.html += decodeBase64(part.body.data);
    } else if (mime === 'text/plain' && part.body?.data) {
      results.plain += decodeBase64(part.body.data);
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);
  return results;
}

/** Pull every GlobalWorx acceptance URL out of an email body */
function extractAcceptanceUrls(bodyHtml, bodyPlain) {
  const combined = bodyHtml + '\n' + bodyPlain;
  const found = new Set();

  // Primary pattern: explicit RemoteAccept action
  let m;
  const primary = new RegExp(CONFIG.URL_PATTERN.source, 'gi');
  while ((m = primary.exec(combined)) !== null) {
    found.add(cleanUrl(m[0]));
  }

  // Fallback: any goglobalworx link (catches shortened/redirected URLs)
  if (found.size === 0) {
    const fallback = new RegExp(CONFIG.FALLBACK_URL_PATTERN.source, 'gi');
    while ((m = fallback.exec(combined)) !== null) {
      found.add(cleanUrl(m[0]));
    }
  }

  return [...found];
}

/** Strip trailing HTML punctuation and decode HTML entities in URLs */
function cleanUrl(raw) {
  return raw
    .replace(/[)>\]"'.,;]+$/, '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&');
}

/** Find a Gmail label by name; optionally create it if missing. Returns label id or null. */
async function findOrCreateLabel(gmail, labelName, create = false) {
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const existing = (data.labels || []).find(
    l => l.name.toLowerCase() === labelName.toLowerCase()
  );
  if (existing) return existing.id;

  if (!create) return null;

  const { data: created } = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  console.log(`[gmail] Created label "${labelName}" (${created.id})`);
  return created.id;
}

/** Apply "Processed" label and mark as read */
async function markProcessed(gmail, messageId, labelId) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds:    [labelId],
      removeLabelIds: ['UNREAD'],
    },
  });
}

// ─── Puppeteer automation ────────────────────────────────────────────────────

/** Submit the GlobalWorx acceptance form at `url` */
async function submitAcceptanceForm(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(CONFIG.PAGE_TIMEOUT);

    // Disguise headless browser so the site doesn't serve a stripped-down view
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log(`  [puppeteer] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });

    // Extra wait for JS-rendered content
    await new Promise(r => setTimeout(r, 2000));

    // ── Check for expired / already-handled issues ───────────────────────
    const initialBody = await page.evaluate(() => (document.body?.innerText || '').trim());
    console.log('  [puppeteer] Page preview:', initialBody.replace(/\s+/g, ' ').slice(0, 300));

    if (/already\s+accept|already\s+been\s+accept|issue.*closed|link.*expired|expired.*link|no longer available|been resolved|invalid.*link|page not found|404/i.test(initialBody)) {
      console.log('  [puppeteer] Issue already handled or link expired — treating as processed.');
      return true;
    }

    // Check if "Accept Here" is on the main page
    let foundAcceptHere = /accept here/i.test(initialBody);

    // If not found on main page, check inside iframes
    if (!foundAcceptHere) {
      console.log('  [puppeteer] "Accept Here" not in main page — checking iframes...');
      const frames = page.frames();
      console.log(`  [puppeteer] Found ${frames.length} frame(s).`);

      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameUrl = frame.url();
          console.log(`  [puppeteer] Checking frame: ${frameUrl}`);
          const frameBody = await frame.evaluate(() => (document.body?.innerText || '').trim());
          console.log('  [puppeteer] Frame body preview:', frameBody.replace(/\s+/g, ' ').slice(0, 300));
          if (/accept here/i.test(frameBody)) {
            console.log('  [puppeteer] Found "Accept Here" inside iframe!');
            foundAcceptHere = true;
            // Switch context: we'll work inside this frame from now on
            // Replace page reference for subsequent steps
            page._gwFrame = frame;
            break;
          }
        } catch (e) {
          console.log(`  [puppeteer] Could not read frame: ${e.message}`);
        }
      }
    }

    // Also check the full HTML for hidden/styled elements with "accept here"
    if (!foundAcceptHere) {
      const htmlCheck = await page.evaluate(() => document.documentElement.innerHTML);
      const htmlHasAccept = /accept\s*here/i.test(htmlCheck);
      console.log(`  [puppeteer] "Accept Here" in raw HTML: ${htmlHasAccept}`);
      if (htmlHasAccept) {
        console.log('  [puppeteer] Found in HTML but not innerText — may be hidden or in shadow DOM.');
        foundAcceptHere = true;
      }
    }

    if (!foundAcceptHere) {
      // Take a debug screenshot
      const screenshotPath = path.join(__dirname, `debug-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.warn(`  [puppeteer] Debug screenshot saved: ${screenshotPath}`);
      console.warn('  [puppeteer] "Accept Here" not found anywhere on page. Full body:');
      console.warn(initialBody.slice(0, 1200));
      throw new Error('Accept Here button not present on page — issue may already be closed or link invalid.');
    }

    // Use iframe context if "Accept Here" was found there
    const ctx = page._gwFrame || page;

    // ── Step 1: Click "Accept Here" ─────────────────────────────────────
    console.log('  [puppeteer] Clicking "Accept Here"...');
    await clickByText(ctx, 'Accept Here');
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: CONFIG.PAGE_TIMEOUT }).catch(() => {});

    // ── Step 2: Select "48 hours" resolution window ─────────────────────
    console.log('  [puppeteer] Selecting 48-hour resolution window...');
    await selectResolutionWindow(ctx, CONFIG.FORM.resolutionText);

    // ── Step 3: Fill comment ─────────────────────────────────────────────
    console.log('  [puppeteer] Filling comment...');
    await fillField(ctx, CONFIG.FORM.comment, [
      '[name*="comment" i]',
      '[id*="comment" i]',
      'textarea',
    ]);

    // ── Step 4: Fill name ────────────────────────────────────────────────
    console.log('  [puppeteer] Filling name...');
    await fillField(ctx, CONFIG.FORM.name, [
      '[name*="name" i]',
      '[id*="name" i]',
      '[placeholder*="name" i]',
    ]);

    // ── Step 5: Click "Accept Issue" ─────────────────────────────────────
    console.log('  [puppeteer] Clicking "Accept Issue"...');
    await clickByText(ctx, 'Accept Issue');
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: CONFIG.PAGE_TIMEOUT }).catch(() => {});

    // Confirm success — look for a success indicator
    const bodyText = await ctx.evaluate(() => document.body.innerText || '');
    const success = /success|accepted|thank|confirm|submitted/i.test(bodyText);
    if (success) {
      console.log('  [puppeteer] Form submitted successfully.');
    } else {
      console.warn('  [puppeteer] Form submitted but could not confirm success. Check manually.');
    }

    return true;
  } finally {
    await browser.close();
  }
}

/** Click "Complete Here" on a GlobalWorx service issue page (for resolved alerts) */
async function submitCompletionForm(url) {
  // Use visible browser — the GW site does not render action buttons in headless mode
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    // Grant geolocation permission — the GW site requests location when clicking "Complete Here"
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://adusa.goglobalworx.com', ['geolocation']);

    const page = await browser.newPage();
    page.setDefaultTimeout(CONFIG.PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(CONFIG.PAGE_TIMEOUT);

    // Set a geolocation so the site gets coordinates without prompting
    await page.setGeolocation({ latitude: 38.9072, longitude: -77.0369, accuracy: 100 });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log(`  [complete] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: CONFIG.PAGE_TIMEOUT });
    await new Promise(r => setTimeout(r, 3000));

    const initialBody = await page.evaluate(() => (document.body?.innerText || '').trim());
    console.log('  [complete] Page preview:', initialBody.replace(/\s+/g, ' ').slice(0, 300));

    // Check for expired / already-completed issues
    if (/already\s+complete|already\s+been\s+complete|issue.*closed|link.*expired|expired.*link|no longer available|been resolved|invalid.*link|page not found|404/i.test(initialBody)) {
      console.log('  [complete] Issue already completed or link expired — treating as done.');
      return true;
    }

    // Check if page shows COMPLETED status (issue already done on GW side)
    if (/SERVICE ISSUE\s+COMPLETED/i.test(initialBody)) {
      console.log('  [complete] Page shows SERVICE ISSUE COMPLETED — already done.');
      return true;
    }

    // Scroll to bottom to trigger any lazy-loaded content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1000));

    // Count buttons BEFORE clicking (page may have multiple issues with their own buttons)
    const preCount = await page.evaluate(() =>
      document.querySelectorAll('input[value="Complete Here"]').length
    );
    console.log(`  [complete] Complete Here buttons found: ${preCount}`);

    if (preCount === 0) {
      console.warn('  [complete] No "Complete Here" button found on page.');
      const screenshotPath = path.join(__dirname, `debug-complete-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.warn(`  [complete] Debug screenshot saved: ${screenshotPath}`);
      return false;
    }

    // Click via schedList.checkout() in browser JS context
    const clickResult = await page.evaluate(() => {
      const buttons = document.querySelectorAll('input[value="Complete Here"]');
      if (buttons.length === 0) return { found: false };

      const btn = buttons[0];
      const info = { found: true, count: buttons.length, hasOnclick: !!btn.onclick, hasForm: !!btn.form };

      // Method 1: Directly call schedList.checkout
      if (typeof schedList !== 'undefined' && typeof schedList.checkout === 'function' && btn.form) {
        try {
          schedList.checkout(btn.form, btn);
          info.method = 'schedList.checkout()';
          return info;
        } catch (e) { info.checkoutError = e.message; }
      }

      // Method 2: Trigger onclick directly
      if (btn.onclick) {
        try {
          btn.onclick.call(btn);
          info.method = 'onclick.call()';
          return info;
        } catch (e) { info.onclickError = e.message; }
      }

      // Method 3: Standard click
      btn.click();
      info.method = 'btn.click()';
      return info;
    });

    console.log(`  [complete] Click result:`, JSON.stringify(clickResult));

    if (!clickResult.found) {
      console.warn('  [complete] Button disappeared before click.');
      return false;
    }

    console.log(`  [complete] Clicked via ${clickResult.method}`);

    // Wait for the form submission / page update
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: CONFIG.PAGE_TIMEOUT }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // Count buttons AFTER clicking — success if count decreased
    const postCount = await page.evaluate(() =>
      document.querySelectorAll('input[value="Complete Here"]').length
    );
    console.log(`  [complete] Buttons before: ${preCount}, after: ${postCount}`);

    if (postCount < preCount) {
      console.log('  [complete] Button count decreased — completion successful.');
      return true;
    }

    // Button count unchanged — the click didn't work
    console.warn('  [complete] Button count unchanged after click — completion may have failed.');
    const screenshotPath = path.join(__dirname, `debug-complete-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.warn(`  [complete] Debug screenshot saved: ${screenshotPath}`);
    return false;
  } finally {
    await browser.close();
  }
}

/**
 * Click the first element whose visible text contains `text` (case-insensitive).
 * Uses page.evaluate to click directly in browser JS context — compatible with
 * all Puppeteer versions including v22+ where page.$x() was removed.
 */
async function clickByText(page, text) {
  const lower = text.toLowerCase();

  // Click directly via browser JS — avoids ElementHandle / asElement() issues
  const clicked = await page.evaluate((searchText) => {
    // Priority: interactive elements
    const interactive = document.querySelectorAll(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [onclick]'
    );
    for (const el of interactive) {
      const t = (el.textContent || el.value || '').toLowerCase().trim();
      if (t.includes(searchText)) { el.click(); return true; }
    }
    // Broader: any short-text element that contains the search string
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (['SCRIPT', 'STYLE', 'HEAD'].includes(el.tagName)) continue;
      const t = (el.textContent || '').toLowerCase().trim();
      if (t.includes(searchText) && t.length < 100) { el.click(); return true; }
    }
    return false;
  }, lower);

  if (!clicked) throw new Error(`Could not find element with text "${text}"`);
}

/**
 * Select the resolution window dropdown option that contains `searchText`.
 * Tries <select> first; falls back to custom dropdown buttons/links.
 */
async function selectResolutionWindow(page, searchText) {
  // Native <select> approach
  const selects = await page.$$('select');
  for (const sel of selects) {
    const options = await sel.$$('option');
    for (const opt of options) {
      const text = await opt.evaluate(el => el.textContent || '');
      if (text.includes(searchText)) {
        const value = await opt.evaluate(el => el.value);
        await sel.select(value);
        console.log(`  [puppeteer] Selected option: "${text.trim()}"`);
        return;
      }
    }
  }

  // Custom dropdown: look for clickable elements (li, a, button, div) with the text
  const lower = searchText.toLowerCase();
  const allEls = await page.$$('li, a, button, [role="option"]');
  for (const el of allEls) {
    const text = await el.evaluate(n => (n.textContent || '').toLowerCase());
    if (text.includes(lower)) {
      await el.click();
      console.log(`  [puppeteer] Clicked custom dropdown option containing "${searchText}"`);
      return;
    }
  }

  console.warn(`  [puppeteer] WARNING: Could not find resolution dropdown option for "${searchText}".`);
}

/**
 * Fill the first visible input matching one of the CSS selectors with `value`.
 * Clears existing content first.
 */
async function fillField(page, value, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) continue;

    const isVisible = await el.evaluate(n => {
      const s = window.getComputedStyle(n);
      return s.display !== 'none' && s.visibility !== 'hidden' && n.offsetHeight > 0;
    });

    if (!isVisible) continue;

    await el.click({ clickCount: 3 }); // select all
    await el.type(value, { delay: 30 });
    return;
  }
  console.warn(`  [puppeteer] WARNING: Could not find input with selectors: ${selectors.join(', ')}`);
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function processEmails(gmail, processedLabelId) {
  // Fetch unread GlobalWorx emails
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: CONFIG.GMAIL_QUERY,
    maxResults: 20,
  });

  const messages = data.messages || [];
  if (messages.length === 0) {
    console.log('[gmail] No unread GlobalWorx emails found.');
    return;
  }

  console.log(`[gmail] Found ${messages.length} unread GlobalWorx email(s).`);

  for (const msg of messages) {
    await processEmail(gmail, msg.id, processedLabelId);
  }
}

async function processEmail(gmail, messageId, processedLabelId) {
  console.log(`\n[email] Processing message ${messageId}...`);

  // Fetch full message with body
  const { data: message } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  // Extract subject for logging
  const headers = message.payload?.headers || [];
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)';
  const from    = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
  console.log(`  Subject: ${subject}`);
  console.log(`  From:    ${from}`);

  // Decode body
  const { html, plain } = extractBodyParts(message.payload);

  if (!html && !plain) {
    console.warn('  [email] No readable body found — marking read and skipping.');
    await gmail.users.messages.modify({
      userId: 'me', id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
    return;
  }

  // Extract acceptance URLs from body
  const urls = extractAcceptanceUrls(html, plain);

  if (urls.length === 0) {
    console.warn('  [email] No GlobalWorx acceptance link found — marking read to prevent retry loop.');
    console.warn('  Plain body preview:', plain.slice(0, 400));
    await gmail.users.messages.modify({
      userId: 'me', id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
    return;
  }

  console.log(`  [email] Found ${urls.length} acceptance URL(s):`);
  urls.forEach((u, i) => console.log(`    [${i + 1}] ${u}`));

  // Process each URL (usually just one per email)
  let allSucceeded = true;
  for (const url of urls) {
    try {
      await submitAcceptanceForm(url);
    } catch (err) {
      console.error(`  [puppeteer] ERROR for URL ${url}:`, err.message);
      allSucceeded = false;
    }
  }

  // Always mark as read to prevent infinite retry loops
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });

  if (allSucceeded) {
    // Only label "Processed" when the form was actually submitted
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: [processedLabelId] },
    });
    console.log(`  [gmail] Form submitted — labelled "${CONFIG.PROCESSED_LABEL}" and marked read.`);
  } else {
    console.warn(`  [gmail] Form submission failed — marked read but NOT labelled "${CONFIG.PROCESSED_LABEL}". Check manually.`);
  }
}

// ─── Completion flow: process emails labeled "Done" ─────────────────────────

async function processCompletionEmails(gmail, completedLabelId) {
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: CONFIG.COMPLETE_QUERY,
    maxResults: 50,
  });

  const messages = data.messages || [];
  if (messages.length === 0) {
    console.log('[complete] No Done emails awaiting completion.');
    return;
  }

  // Fetch internalDate for each message and sort newest-first
  console.log(`[complete] Found ${messages.length} email(s) — fetching dates to sort newest-first...`);
  const withDates = [];
  for (const msg of messages) {
    const { data: meta } = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Date'],
    });
    const subject = (meta.payload?.headers || []).find(h => h.name.toLowerCase() === 'subject')?.value || '';
    withDates.push({ id: msg.id, internalDate: Number(meta.internalDate), subject });
  }
  withDates.sort((a, b) => b.internalDate - a.internalDate);

  console.log('[complete] Processing order (newest first):');
  withDates.forEach((m, i) => {
    const d = new Date(m.internalDate).toLocaleDateString();
    console.log(`  ${i + 1}. [${d}] ${m.subject.slice(0, 80)}`);
  });

  for (const msg of withDates) {
    await processCompletionEmail(gmail, msg.id, completedLabelId);
  }
}

async function processCompletionEmail(gmail, messageId, completedLabelId) {
  console.log(`\n[complete] Processing message ${messageId}...`);

  const { data: message } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = message.payload?.headers || [];
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)';
  console.log(`  Subject: ${subject}`);

  const { html, plain } = extractBodyParts(message.payload);
  if (!html && !plain) {
    console.warn('  [complete] No readable body — skipping.');
    return;
  }

  const urls = extractAcceptanceUrls(html, plain);
  if (urls.length === 0) {
    console.warn('  [complete] No GlobalWorx link found — labeling Completed to skip next time.');
    await gmail.users.messages.modify({
      userId: 'me', id: messageId,
      requestBody: { addLabelIds: [completedLabelId] },
    });
    return;
  }

  console.log(`  [complete] Using URL: ${urls[0]}`);

  let success = false;
  try {
    success = await submitCompletionForm(urls[0]);
  } catch (err) {
    console.error(`  [complete] ERROR: ${err.message}`);
  }

  if (success) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: [completedLabelId] },
    });
    console.log(`  [complete] Completed — labelled "${CONFIG.COMPLETED_LABEL}".`);
  } else {
    console.warn(`  [complete] Could not complete — will retry next cycle.`);
  }
}

// ─── Fix: remove incorrectly applied Completed labels ───────────────────────

async function fixCompletedLabels(gmail, completedLabelId) {
  console.log('\n[fix] Searching for emails with GLOBAL WORKS/Completed label...');
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: `subject:"Service Alert created for" label:GLOBAL-WORKS/Completed newer_than:10d`,
    maxResults: 100,
  });

  const messages = data.messages || [];
  if (messages.length === 0) {
    console.log('[fix] No Completed emails found.');
    return;
  }

  console.log(`[fix] Found ${messages.length} email(s) with Completed label:`);
  for (const msg of messages) {
    const { data: meta } = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'Date'],
    });
    const subject = (meta.payload?.headers || []).find(h => h.name.toLowerCase() === 'subject')?.value || '';
    const d = new Date(Number(meta.internalDate)).toLocaleDateString();
    console.log(`  [${d}] ${subject.slice(0, 90)}`);
  }

  console.log(`\n[fix] Removing "GLOBAL WORKS/Completed" label from ${messages.length} email(s)...`);
  for (const msg of messages) {
    await gmail.users.messages.modify({
      userId: 'me',
      id: msg.id,
      requestBody: { removeLabelIds: [completedLabelId] },
    });
  }
  console.log('[fix] Done — labels removed. Re-run without --fix to process them.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  const auth  = buildAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Set up labels
  const processedLabelId = await findOrCreateLabel(gmail, CONFIG.PROCESSED_LABEL, true);
  console.log(`[init] Using label "${CONFIG.PROCESSED_LABEL}" (id: ${processedLabelId})`);

  const completedLabelId = await findOrCreateLabel(gmail, CONFIG.COMPLETED_LABEL, true);
  console.log(`[init] Using label "${CONFIG.COMPLETED_LABEL}" (id: ${completedLabelId})`);

  // --fix flag: remove incorrectly applied Completed labels and exit
  if (process.argv.includes('--fix')) {
    await fixCompletedLabels(gmail, completedLabelId);
    return;
  }

  const runOnce = async () => {
    const now = new Date().toLocaleTimeString();
    console.log(`\n[${now}] Checking for GlobalWorx emails...`);
    try {
      // 1. Accept new unread alerts
      await processEmails(gmail, processedLabelId);

      // 2. Complete resolved alerts (labeled Done by React app)
      await processCompletionEmails(gmail, completedLabelId);
    } catch (err) {
      console.error('[run] Unexpected error:', err.message);
    }
  };

  // First run immediately
  await runOnce();

  // Poll if interval is set
  if (CONFIG.POLL_INTERVAL_MS > 0) {
    console.log(`\n[init] Polling every ${CONFIG.POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.`);
    setInterval(runOnce, CONFIG.POLL_INTERVAL_MS);
  }
}

run().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});

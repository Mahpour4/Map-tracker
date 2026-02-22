'use strict';

const puppeteer = require('puppeteer');
const path      = require('path');

// ─── Config (shared with index.js) ─────────────────────────────────────────
const AUTOMATION_CONFIG = {
  PAGE_TIMEOUT: 30_000,
  FORM: {
    name:    'Wise Office',
    comment: 'Acknowledging issue — will resolve within 48 hours.',
    resolutionText: '48',
  },
};

// ─── Helper functions ───────────────────────────────────────────────────────

/**
 * Click the first element whose visible text contains `text` (case-insensitive).
 */
async function clickByText(page, text) {
  const lower = text.toLowerCase();
  const clicked = await page.evaluate((searchText) => {
    const interactive = document.querySelectorAll(
      'button, a, input[type="submit"], input[type="button"], [role="button"], [onclick]'
    );
    for (const el of interactive) {
      const t = (el.textContent || el.value || '').toLowerCase().trim();
      if (t.includes(searchText)) { el.click(); return true; }
    }
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
 */
async function selectResolutionWindow(page, searchText) {
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
    await el.click({ clickCount: 3 });
    await el.type(value, { delay: 30 });
    return;
  }
  console.warn(`  [puppeteer] WARNING: Could not find input with selectors: ${selectors.join(', ')}`);
}

// ─── Main automation functions ──────────────────────────────────────────────

/** Submit the GlobalWorx acceptance form at `url` */
async function submitAcceptanceForm(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(AUTOMATION_CONFIG.PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(AUTOMATION_CONFIG.PAGE_TIMEOUT);

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log(`  [puppeteer] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: AUTOMATION_CONFIG.PAGE_TIMEOUT });
    await new Promise(r => setTimeout(r, 2000));

    const initialBody = await page.evaluate(() => (document.body?.innerText || '').trim());
    console.log('  [puppeteer] Page preview:', initialBody.replace(/\s+/g, ' ').slice(0, 300));

    if (/already\s+accept|already\s+been\s+accept|issue.*closed|link.*expired|expired.*link|no longer available|been resolved|invalid.*link|page not found|404/i.test(initialBody)) {
      console.log('  [puppeteer] Issue already handled or link expired — treating as processed.');
      return true;
    }

    // Check if "Accept Here" is on the main page
    const hasAcceptButton = await page.evaluate(() => {
      const buttons = document.querySelectorAll('input[type="submit"], input[type="button"], button');
      return Array.from(buttons).some(b => (b.value || b.textContent || '').toLowerCase().includes('accept here'));
    });

    if (!hasAcceptButton) {
      // Might be in an iframe
      const frames = page.frames();
      let targetFrame = null;
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameHas = await frame.evaluate(() => {
            const buttons = document.querySelectorAll('input[type="submit"], input[type="button"], button');
            return Array.from(buttons).some(b => (b.value || b.textContent || '').toLowerCase().includes('accept here'));
          });
          if (frameHas) { targetFrame = frame; break; }
        } catch (_) {}
      }

      if (targetFrame) {
        console.log('  [puppeteer] Found "Accept Here" inside iframe — switching context');
        // Process in iframe context
        await targetFrame.evaluate(() => {
          const buttons = document.querySelectorAll('input[type="submit"], input[type="button"], button');
          for (const b of buttons) {
            if ((b.value || b.textContent || '').toLowerCase().includes('accept here')) {
              b.click(); return;
            }
          }
        });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.warn('  [puppeteer] No "Accept Here" button found anywhere on page.');
        const screenshotPath = path.join(__dirname, `debug-accept-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.warn(`  [puppeteer] Debug screenshot saved: ${screenshotPath}`);
        return false;
      }
    } else {
      // Click "Accept Here" on the main page
      await clickByText(page, 'accept here');
      await new Promise(r => setTimeout(r, 2000));
    }

    // Select 48 hours resolution window
    await selectResolutionWindow(page, AUTOMATION_CONFIG.FORM.resolutionText);
    await new Promise(r => setTimeout(r, 500));

    // Fill comment
    await fillField(page, AUTOMATION_CONFIG.FORM.comment, [
      'textarea[name*="comment" i]', 'textarea[id*="comment" i]',
      'textarea[name*="note" i]', 'textarea',
      'input[name*="comment" i]', 'input[id*="comment" i]',
    ]);
    await new Promise(r => setTimeout(r, 300));

    // Fill name
    await fillField(page, AUTOMATION_CONFIG.FORM.name, [
      'input[name*="name" i]', 'input[id*="name" i]',
      'input[name*="person" i]', 'input[placeholder*="name" i]',
    ]);
    await new Promise(r => setTimeout(r, 300));

    // Submit
    await clickByText(page, 'accept issue');
    console.log('  [puppeteer] Clicked "Accept Issue" — waiting for response...');
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: AUTOMATION_CONFIG.PAGE_TIMEOUT }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const afterBody = await page.evaluate(() => (document.body?.innerText || '').trim());
    if (/thank you|accepted|success|received/i.test(afterBody)) {
      console.log('  [puppeteer] Acceptance confirmed!');
      return true;
    }

    console.log('  [puppeteer] Page after submit:', afterBody.replace(/\s+/g, ' ').slice(0, 300));
    return true;
  } finally {
    await browser.close();
  }
}

/** Click "Complete Here" on a GlobalWorx service issue page (for resolved alerts) */
async function submitCompletionForm(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://adusa.goglobalworx.com', ['geolocation']);

    const page = await browser.newPage();
    page.setDefaultTimeout(AUTOMATION_CONFIG.PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(AUTOMATION_CONFIG.PAGE_TIMEOUT);

    await page.setGeolocation({ latitude: 38.9072, longitude: -77.0369, accuracy: 100 });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log(`  [complete] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: AUTOMATION_CONFIG.PAGE_TIMEOUT });
    await new Promise(r => setTimeout(r, 3000));

    const initialBody = await page.evaluate(() => (document.body?.innerText || '').trim());
    console.log('  [complete] Page preview:', initialBody.replace(/\s+/g, ' ').slice(0, 300));

    if (/already\s+complete|already\s+been\s+complete|issue.*closed|link.*expired|expired.*link|no longer available|been resolved|invalid.*link|page not found|404/i.test(initialBody)) {
      console.log('  [complete] Issue already completed or link expired — treating as done.');
      return true;
    }

    if (/SERVICE ISSUE\s+COMPLETED/i.test(initialBody)) {
      console.log('  [complete] Page shows SERVICE ISSUE COMPLETED — already done.');
      return true;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1000));

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

    const clickResult = await page.evaluate(() => {
      const buttons = document.querySelectorAll('input[value="Complete Here"]');
      if (buttons.length === 0) return { found: false };
      const btn = buttons[0];
      const info = { found: true, count: buttons.length, hasOnclick: !!btn.onclick, hasForm: !!btn.form };
      if (typeof schedList !== 'undefined' && typeof schedList.checkout === 'function' && btn.form) {
        try { schedList.checkout(btn.form, btn); info.method = 'schedList.checkout()'; return info; } catch (e) { info.checkoutError = e.message; }
      }
      if (btn.onclick) {
        try { btn.onclick.call(btn); info.method = 'onclick.call()'; return info; } catch (e) { info.onclickError = e.message; }
      }
      btn.click();
      info.method = 'btn.click()';
      return info;
    });

    console.log(`  [complete] Click result:`, JSON.stringify(clickResult));
    if (!clickResult.found) { console.warn('  [complete] Button disappeared before click.'); return false; }
    console.log(`  [complete] Clicked via ${clickResult.method}`);

    await page.waitForNetworkIdle({ idleTime: 2000, timeout: AUTOMATION_CONFIG.PAGE_TIMEOUT }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const postCount = await page.evaluate(() =>
      document.querySelectorAll('input[value="Complete Here"]').length
    );
    console.log(`  [complete] Buttons before: ${preCount}, after: ${postCount}`);

    if (postCount < preCount) {
      console.log('  [complete] Button count decreased — completion successful.');
      return true;
    }

    console.warn('  [complete] Button count unchanged after click — completion may have failed.');
    const screenshotPath = path.join(__dirname, `debug-complete-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.warn(`  [complete] Debug screenshot saved: ${screenshotPath}`);
    return false;
  } finally {
    await browser.close();
  }
}

module.exports = { submitAcceptanceForm, submitCompletionForm };

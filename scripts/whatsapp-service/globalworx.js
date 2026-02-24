/**
 * GlobalWorx Auto-Accept Module
 * Uses Puppeteer (headless Chrome) to navigate to GlobalWorx acceptance URLs
 * and click through: Accept → set 48hr resolution → Submit
 */

const puppeteer = require('puppeteer');
const path = require('path');

const RESOLUTION_HOURS = '48';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'gw-screenshots');

let browserInstance = null;

/**
 * Accept a single alert by navigating to its GlobalWorx URL.
 * @param {import('puppeteer').Page} page - Puppeteer page
 * @param {string} url - GlobalWorx acceptance URL
 * @param {string} refNumber - Alert reference number (for logging)
 * @returns {{ success: boolean, error?: string }}
 */
async function acceptAlert(page, url, refNumber) {
  console.log(`[GW] Accepting ${refNumber}: ${url.substring(0, 100)}...`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Strategy 1: Click "Accept" button
    let acceptClicked = false;
    const acceptSelectors = [
      "//button[contains(text(), 'Accept')]",
      "//input[@value='Accept']",
      "//a[contains(text(), 'Accept')]",
      "//*[contains(@class, 'accept')]",
      "//button[contains(text(), 'Accept Issue')]",
      "//input[contains(@value, 'Accept')]",
    ];

    for (const xpath of acceptSelectors) {
      try {
        const [btn] = await page.$x(xpath);
        if (btn) {
          const visible = await btn.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          });
          if (visible) {
            console.log(`[GW]   Found Accept button: ${xpath.substring(0, 50)}`);
            await btn.click();
            acceptClicked = true;
            break;
          }
        }
      } catch (_) { continue; }
    }

    if (!acceptClicked) {
      console.log('[GW]   No Accept button found, checking if form is already shown...');
    }

    await page.waitForTimeout(2000);

    // Strategy 2: Set resolution time to 48 hours
    let timeSet = false;

    // Try dropdown/select elements
    const selectSelectors = [
      "select[name*='hour'], select[name*='time'], select[name*='resolution']",
      "select[id*='hour'], select[id*='time'], select[id*='resolution']",
      "select",
    ];

    for (const sel of selectSelectors) {
      try {
        const selects = await page.$$(sel);
        for (const selectEl of selects) {
          const visible = await selectEl.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          });
          if (!visible) continue;

          // Look for option containing "48"
          const set = await selectEl.evaluate((el, hours) => {
            for (const opt of el.options) {
              if (opt.text.includes(hours)) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return opt.text;
              }
            }
            return null;
          }, RESOLUTION_HOURS);

          if (set) {
            console.log(`[GW]   Set resolution to: ${set}`);
            timeSet = true;
            break;
          }
        }
        if (timeSet) break;
      } catch (_) { continue; }
    }

    if (!timeSet) {
      // Try input field
      const inputSelectors = [
        "input[name*='hour'], input[name*='time']",
        "input[type='number']",
      ];
      for (const sel of inputSelectors) {
        try {
          const inp = await page.$(sel);
          if (inp) {
            const visible = await inp.evaluate(el => {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
            });
            if (visible) {
              await inp.click({ clickCount: 3 }); // select all
              await inp.type(RESOLUTION_HOURS);
              console.log(`[GW]   Entered resolution: ${RESOLUTION_HOURS} hours`);
              timeSet = true;
              break;
            }
          }
        } catch (_) { continue; }
      }
    }

    await page.waitForTimeout(1000);

    // Strategy 3: Submit / Confirm
    let submitted = false;
    const submitSelectors = [
      "//button[contains(text(), 'Submit')]",
      "//button[contains(text(), 'Confirm')]",
      "//button[contains(text(), 'Accept Issue')]",
      "//input[@type='submit']",
      "//input[contains(@value, 'Submit')]",
      "//input[contains(@value, 'Confirm')]",
      "//input[contains(@value, 'Accept')]",
      "//button[contains(@class, 'submit')]",
      "//a[contains(text(), 'Submit')]",
    ];

    for (const xpath of submitSelectors) {
      try {
        const [btn] = await page.$x(xpath);
        if (btn) {
          const visible = await btn.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          });
          if (visible) {
            console.log(`[GW]   Clicking submit: ${xpath.substring(0, 50)}`);
            await btn.click();
            submitted = true;
            break;
          }
        }
      } catch (_) { continue; }
    }

    await page.waitForTimeout(2000);

    if (submitted) {
      console.log(`[GW]   ACCEPTED ${refNumber}`);
      return { success: true };
    } else {
      // Save screenshot for debugging
      try {
        const fs = require('fs');
        if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const ssPath = path.join(SCREENSHOT_DIR, `gw-debug-${refNumber}.png`);
        await page.screenshot({ path: ssPath });
        console.log(`[GW]   Could not find submit button. Screenshot: ${ssPath}`);
      } catch (_) {}
      return { success: false, error: 'Submit button not found' };
    }

  } catch (err) {
    console.error(`[GW]   ERROR accepting ${refNumber}:`, err.message);
    try {
      const fs = require('fs');
      if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const ssPath = path.join(SCREENSHOT_DIR, `gw-error-${refNumber}.png`);
      await page.screenshot({ path: ssPath });
    } catch (_) {}
    return { success: false, error: err.message };
  }
}

/**
 * Accept a batch of alerts sequentially using a shared browser.
 * @param {Array<{ url: string, refNumber: string, emailId?: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, success: boolean, error?: string }> }}
 */
async function acceptBatch(alerts) {
  if (!alerts || alerts.length === 0) {
    return { results: [] };
  }

  console.log(`[GW] Starting batch acceptance: ${alerts.length} alert(s)`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'],
    });
  } catch (err) {
    console.error('[GW] Failed to launch browser:', err.message);
    return {
      results: alerts.map(a => ({ refNumber: a.refNumber, success: false, error: 'Browser launch failed: ' + err.message })),
    };
  }

  const results = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      console.log(`[GW] --- Alert ${i + 1}/${alerts.length} ---`);
      const result = await acceptAlert(page, alert.url, alert.refNumber);
      results.push({ refNumber: alert.refNumber, emailId: alert.emailId, ...result });

      // Small delay between alerts
      if (i < alerts.length - 1) {
        await page.waitForTimeout(2000);
      }
    }
  } finally {
    await browser.close();
    console.log('[GW] Browser closed.');
  }

  const accepted = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`[GW] DONE: ${accepted} accepted, ${failed} failed out of ${alerts.length}`);

  return { results };
}

/**
 * Check if Puppeteer/Chrome is available.
 */
async function checkStatus() {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox'],
    });
    await browser.close();
    return { available: true };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

module.exports = { acceptAlert, acceptBatch, checkStatus };

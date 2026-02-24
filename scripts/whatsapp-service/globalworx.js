/**
 * GlobalWorx Auto-Accept Module
 * Uses Puppeteer (headless Chrome) to navigate to GlobalWorx acceptance URLs
 * and click through: Accept → set 48hr resolution → Submit
 */

const puppeteer = require('puppeteer');

const RESOLUTION_HOURS = '48';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Find a clickable element by its visible text using JS innerText search.
 * Much more reliable than XPath for JS-rendered apps (Sencha/ExtJS etc).
 * Returns an ElementHandle or null.
 */
async function findByText(page, texts) {
  const handle = await page.evaluateHandle((searchTexts) => {
    const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE'];
    const all = Array.from(document.querySelectorAll('*')).filter(el => !skip.includes(el.tagName));
    for (const text of searchTexts) {
      const lower = text.toLowerCase();
      // Prefer leaf nodes (no children), then any node
      const leaf = all.find(el =>
        el.children.length === 0 &&
        (el.innerText || el.textContent || '').trim().toLowerCase() === lower &&
        window.getComputedStyle(el).display !== 'none' &&
        window.getComputedStyle(el).visibility !== 'hidden'
      );
      if (leaf) return leaf;
      const any = all.find(el =>
        (el.innerText || el.textContent || '').trim().toLowerCase() === lower &&
        window.getComputedStyle(el).display !== 'none' &&
        window.getComputedStyle(el).visibility !== 'hidden'
      );
      if (any) return any;
    }
    return null;
  }, texts);

  // evaluateHandle returns a JSHandle — check if it resolved to a real element
  const el = handle.asElement();
  return el || null;
}

/**
 * Search for an XPath element across the main page and all iframes.
 * Returns { frame, element } or null if not found.
 */
async function findInFrames(page, xpath) {
  const frames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
  for (const frame of frames) {
    try {
      const [el] = await frame.$x(xpath);
      if (el) {
        const visible = await el.evaluate(e => {
          const s = window.getComputedStyle(e);
          return s.display !== 'none' && s.visibility !== 'hidden';
        });
        if (visible) return { frame, element: el };
      }
    } catch (_) { continue; }
  }
  return null;
}

/**
 * Search for a CSS selector across the main page and all iframes.
 * Returns { frame, elements[] } for the first frame that has matches, or null.
 */
async function findAllInFrames(page, cssSelector) {
  const frames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
  for (const frame of frames) {
    try {
      const els = await frame.$$(cssSelector);
      if (els.length > 0) return { frame, elements: els };
    } catch (_) { continue; }
  }
  return null;
}

async function acceptAlert(page, url, refNumber) {
  console.log(`[GW] Accepting ${refNumber}: ${url.substring(0, 100)}...`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    // Brief wait for JS app to finish rendering after network settles
    await sleep(2000);

    // Step 0: Dismiss Terms & Conditions overlay if present
    // The T&C has a button: <input class="vf-form-button vf-primary" value="Accept">
    // This is NOT the actual "Accept Here" button — it's the terms acceptance
    try {
      const tcButton = await findAllInFrames(page, 'input.vf-form-button[value="Accept"], input.vf-primary[value="Accept"]');
      if (tcButton && tcButton.elements.length > 0) {
        const tag = await tcButton.elements[0].evaluate(el => `${el.tagName} class="${el.className}" value="${el.value}"`);
        console.log(`[GW]   Found T&C Accept button: ${tag} — clicking to dismiss`);
        await tcButton.elements[0].evaluate(el => el.click());
        await sleep(2000);
      }
    } catch (_) {
      // T&C not present or already dismissed — continue
    }

    // Strategy 1: Click "Accept Here" button
    let acceptClicked = false;

    // 1a: CSS selector — the button is <input type="button" value="Accept Here" class="accept-btn">
    // Only match the specific accept-btn class or exact "Accept Here" value — NOT the broad wildcard
    const acceptCssSelectors = [
      'input.accept-btn',
      'input[value="Accept Here"]',
    ];
    for (const sel of acceptCssSelectors) {
      const found = await findAllInFrames(page, sel);
      if (found && found.elements.length > 0) {
        const tag = await found.elements[0].evaluate(el => `${el.tagName} class="${el.className}" value="${el.value}"`);
        console.log(`[GW]   Found Accept button via CSS "${sel}": ${tag}`);
        await found.elements[0].evaluate(el => el.scrollIntoView({ block: 'center' }));
        await sleep(300);
        await found.elements[0].evaluate(el => el.click());
        acceptClicked = true;
        // Wait for the resolution form/modal to appear
        try {
          await page.waitForSelector('input.si-accept-confirm, input[value="Accept Issue"], select[name*="restime"], select', { timeout: 8000 });
          console.log(`[GW]   Resolution form appeared`);
        } catch (_) {
          console.log(`[GW]   Timed out waiting for resolution form — sleeping 4s`);
          await sleep(4000);
        }
        break;
      }
    }

    // 1b: XPath fallback — only specific selectors, not broad wildcards
    if (!acceptClicked) {
      const acceptSelectors = [
        "//input[contains(@value, 'Accept Here')]",
        "//input[@class='accept-btn']",
      ];
      for (const xpath of acceptSelectors) {
        const found = await findInFrames(page, xpath);
        if (found) {
          console.log(`[GW]   Found Accept button via XPath: ${xpath.substring(0, 60)}`);
          await found.element.evaluate(el => el.click());
          acceptClicked = true;
          await sleep(1500);
          break;
        }
      }
    }

    // 1c: Text-based fallback — search for "Accept Here" text
    if (!acceptClicked) {
      const textEl = await findByText(page, ['Accept Here']);
      if (textEl) {
        console.log(`[GW]   Found Accept button via text search "Accept Here"`);
        await textEl.evaluate(el => el.click());
        acceptClicked = true;
        await sleep(1500);
      }
    }

    if (!acceptClicked) {
      console.log(`[GW]   No "Accept Here" button found for ${refNumber}`);
    }

    // Strategy 2: Set resolution time to 48 hours
    // The dropdown shows "within X hour(s)" — use indexOf (not includes) for older JS environments
    let timeSet = false;

    try {
      // Diagnostic: log all selects and their options
      const selectInfo = await page.evaluate(() => {
        var selects = document.querySelectorAll('select');
        var info = [];
        for (var i = 0; i < selects.length; i++) {
          var s = selects[i];
          var opts = [];
          for (var j = 0; j < s.options.length; j++) {
            opts.push({ value: s.options[j].value, text: s.options[j].text });
          }
          info.push({ name: s.name || '', id: s.id || '', optionCount: s.options.length, options: opts });
        }
        return info;
      });
      if (selectInfo.length > 0) {
        console.log(`[GW]   Found ${selectInfo.length} select(s) on page:`);
        selectInfo.forEach((s, i) => {
          console.log(`[GW]     Select ${i}: name="${s.name}" id="${s.id}" options=[${s.options.map(o => `"${o.value}:${o.text}"`).join(', ')}]`);
        });
      } else {
        console.log(`[GW]   No select elements found on page`);
      }

      timeSet = await page.evaluate((hours) => {
        // Find the resolution select
        var sel = document.querySelector('select[name*="restime"]')
               || document.querySelector('select[id*="restime"]')
               || document.querySelector('select[name*="time"]')
               || document.querySelector('select[name*="hour"]')
               || document.querySelector('select[name*="resolution"]')
               || document.querySelector('select');
        if (!sel || !sel.options || sel.options.length === 0) return false;

        // Find the option with value or text containing the target hours (e.g. "48")
        var match = null;
        for (var i = 0; i < sel.options.length; i++) {
          var o = sel.options[i];
          var val = (o.value || '') + '';
          var txt = (o.text || '') + '';
          if (val === hours || val.indexOf(hours) !== -1 || txt.indexOf(hours) !== -1) {
            match = o;
            break;
          }
        }
        if (!match) return false;

        sel.value = match.value;
        // Trigger native change event
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        // Also trigger jQuery change if available (for Select2 widgets)
        try {
          if (window.$ && window.$(sel).val) {
            window.$(sel).val(match.value).trigger('change');
          }
        } catch (_) {}
        return (match.text || match.value || '') + '';
      }, RESOLUTION_HOURS);

      if (timeSet) {
        console.log('[GW]   Set resolution to: ' + timeSet);
      } else {
        console.log('[GW]   Could not find 48hr option in resolution select — proceeding anyway');
      }
    } catch (err2) {
      console.error('[GW]   Strategy 2 error:', err2.message);
    }

    await sleep(1000);

    // Strategy 3: Click "Accept Issue" / Submit — CSS first, then XPath
    let submitted = false;

    try {
      // 3a: CSS selector — button is <input class="si-accept-confirm mobilebutton" value="Accept Issue">
      const submitCssSelectors = [
        'input.si-accept-confirm',
        'input[value="Accept Issue"]',
        'input[value*="Accept Issue"]',
        'input[value="Submit"]',
        'input[value="Confirm"]',
        'input[type="submit"]',
      ];
      for (const sel of submitCssSelectors) {
        const found = await findAllInFrames(page, sel);
        if (found && found.elements.length > 0) {
          const tag = await found.elements[0].evaluate(el => `${el.tagName} value="${el.value}"`);
          console.log(`[GW]   Found Submit button via CSS "${sel}": ${tag}`);
          await found.elements[0].evaluate(el => el.scrollIntoView({ block: 'center' }));
          await sleep(500);
          await found.elements[0].evaluate(el => el.click());
          submitted = true;
          break;
        }
      }

      // 3b: XPath fallback (only if CSS didn't work)
      if (!submitted) {
        const submitXpathSelectors = [
          "//input[contains(@class, 'si-accept-confirm')]",
          "//input[contains(@value, 'Accept Issue')]",
          "//input[contains(@value, 'Submit')]",
          "//input[contains(@value, 'Confirm')]",
          "//button[contains(text(), 'Accept Issue')]",
          "//button[contains(text(), 'Submit')]",
          "//button[contains(text(), 'Confirm')]",
          "//input[@type='submit']",
        ];
        for (const xpath of submitXpathSelectors) {
          const found = await findInFrames(page, xpath);
          if (found) {
            console.log(`[GW]   Found Submit button via XPath: ${xpath.substring(0, 50)}`);
            await found.element.evaluate(el => el.click());
            submitted = true;
            break;
          }
        }
      }

      if (submitted) {
        console.log(`[GW]   Submit clicked — waiting for result...`);
      }
    } catch (err3) {
      console.error('[GW]   Strategy 3 error:', err3.message);
    }

    // Wait for post-submit navigation
    await sleep(1500);

    if (submitted) {
      console.log(`[GW]   ACCEPTED ${refNumber}`);
      return { success: true };
    } else {
      console.log(`[GW]   FAILED ${refNumber} — Submit button not found`);
      return { success: false, error: 'Submit button not found' };
    }

  } catch (err) {
    console.error(`[GW]   ERROR accepting ${refNumber}:`, err.message);
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
        await sleep(1000);
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
 * Complete a single alert by navigating to its GlobalWorx URL and clicking "Complete Here".
 * This is for alerts that were already accepted and are now being closed out.
 * @param {import('puppeteer').Page} page
 * @param {string} url - Same GlobalWorx acceptance URL (shows "Complete Here" after acceptance)
 * @param {string} refNumber
 * @returns {{ success: boolean, error?: string }}
 */
async function completeAlert(page, url, refNumber) {
  console.log(`[GW] Completing ${refNumber}: ${url.substring(0, 100)}...`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(2000);

    // Look for "Complete Here" button: <input class="timelog-btn" value="Complete Here">
    let completed = false;

    const completeCssSelectors = [
      'input.timelog-btn',
      'input[value="Complete Here"]',
      'input[value*="Complete"]',
    ];
    for (const sel of completeCssSelectors) {
      const found = await findAllInFrames(page, sel);
      if (found && found.elements.length > 0) {
        const tag = await found.elements[0].evaluate(el => `${el.tagName} class="${el.className}" value="${el.value}"`);
        console.log(`[GW]   Found Complete button via CSS "${sel}": ${tag}`);
        await found.elements[0].evaluate(el => el.scrollIntoView({ block: 'center' }));
        await sleep(500);
        await found.elements[0].click();
        completed = true;
        break;
      }
    }

    // XPath fallback
    if (!completed) {
      const completeXpaths = [
        "//input[contains(@value, 'Complete Here')]",
        "//input[contains(@value, 'Complete')]",
        "//input[contains(@class, 'timelog-btn')]",
        "//button[contains(text(), 'Complete')]",
      ];
      for (const xpath of completeXpaths) {
        const found = await findInFrames(page, xpath);
        if (found) {
          console.log(`[GW]   Found Complete button via XPath: ${xpath.substring(0, 50)}`);
          await found.element.click();
          completed = true;
          break;
        }
      }
    }

    await sleep(1500);

    if (completed) {
      console.log(`[GW]   COMPLETED ${refNumber}`);
      return { success: true };
    }

    // Complete button not found — check if "Accept Here" is still showing
    // That means the alert was NEVER actually accepted on GlobalWorx
    let acceptStillShowing = false;
    const acceptCheckSelectors = [
      'input.accept-btn',
      'input[value="Accept Here"]',
      'input[value*="Accept"]',
    ];
    for (const sel of acceptCheckSelectors) {
      const found = await findAllInFrames(page, sel);
      if (found && found.elements.length > 0) {
        acceptStillShowing = true;
        break;
      }
    }

    if (acceptStillShowing) {
      console.log(`[GW]   SKIPPED ${refNumber} — "Accept Here" still showing (alert was never accepted on GlobalWorx)`);
      return { success: false, notAccepted: true, error: 'Alert was never accepted on GlobalWorx' };
    } else {
      console.log(`[GW]   ${refNumber} — No Complete or Accept button found (already completed/expired on GlobalWorx)`);
      return { success: false, error: 'Complete button not found' };
    }

  } catch (err) {
    console.error(`[GW]   ERROR completing ${refNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Complete a batch of alerts sequentially using a shared browser.
 * @param {Array<{ url: string, refNumber: string, emailId?: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, success: boolean, error?: string }> }}
 */
async function completeBatch(alerts) {
  if (!alerts || alerts.length === 0) {
    return { results: [] };
  }

  console.log(`[GW] Starting batch completion: ${alerts.length} alert(s)`);

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
      console.log(`[GW] --- Complete ${i + 1}/${alerts.length} ---`);
      const result = await completeAlert(page, alert.url, alert.refNumber);
      results.push({ refNumber: alert.refNumber, emailId: alert.emailId, ...result });

      if (i < alerts.length - 1) {
        await sleep(1000);
      }
    }
  } finally {
    await browser.close();
    console.log('[GW] Browser closed.');
  }

  const completed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`[GW] DONE: ${completed} completed, ${failed} failed out of ${alerts.length}`);

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

module.exports = { acceptAlert, acceptBatch, completeAlert, completeBatch, checkStatus };

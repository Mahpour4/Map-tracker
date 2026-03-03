/**
 * GlobalWorx Auto-Accept Module
 * Uses Puppeteer (headless Chrome) to navigate to GlobalWorx acceptance URLs
 * and click through: Accept → set 48hr resolution → Submit
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const RESOLUTION_HOURS = '48';
const SCREENSHOT_DIR = path.join(__dirname, 'gw-debug');

// Default geolocation to grant to pages that request it (GlobalWorx requires geolocation for Complete)
// Using a generic US location — the exact coordinates don't matter, GW just needs permission granted
const DEFAULT_GEO = { latitude: 38.8977, longitude: -77.0365, accuracy: 100 };

// Ensure debug screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Save a debug screenshot and page HTML for troubleshooting.
 * @param {import('puppeteer').Page} page
 * @param {string} refNumber
 * @param {string} stage - e.g. 'page-loaded', 'after-accept', 'after-complete', 'error'
 */
async function saveDebug(page, refNumber, stage) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${refNumber}_${stage}_${ts}`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${base}.png`), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(SCREENSHOT_DIR, `${base}.html`), html);
    console.log(`[GW]   DEBUG saved: ${base}.png + .html`);
  } catch (e) {
    console.warn(`[GW]   Failed to save debug: ${e.message}`);
  }
}

/**
 * Scrape structured alert details from the GlobalWorx page.
 * Extracts label/data pairs, store info, address, phone, status etc.
 * @param {import('puppeteer').Page} page
 * @returns {object|null} scraped details or null on error
 */
async function scrapeAlertDetails(page) {
  try {
    return await page.evaluate(() => {
      var result = {};

      // Find the main schedlist div (not the csidiv prompt)
      var schedDiv = document.querySelector('.schedlist:not(.csiprompt *)');
      if (!schedDiv) {
        // fallback: find any div with class schedlist
        var allScheds = document.querySelectorAll('.schedlist');
        for (var s = 0; s < allScheds.length; s++) {
          if (!allScheds[s].closest('.csiprompt')) { schedDiv = allScheds[s]; break; }
        }
      }
      if (!schedDiv) {
        // last fallback: scrape from the whole page
        schedDiv = document;
      }

      // Extract label/data pairs from event-detail table
      var labels = schedDiv.querySelectorAll('.event-detail-label');
      var details = {};
      for (var i = 0; i < labels.length; i++) {
        var labelTd = labels[i];
        var labelText = (labelTd.textContent || '').replace(/\u00a0/g, '').replace(/:$/, '').trim();
        // The data is in the next sibling tr > td.event-detail-data
        var nextTr = labelTd.closest('tr');
        if (nextTr) nextTr = nextTr.nextElementSibling;
        if (nextTr) {
          var dataTd = nextTr.querySelector('.event-detail-data');
          if (dataTd) {
            // Get text with <br> converted to newlines
            details[labelText] = dataTd.innerHTML
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&nbsp;/g, ' ')
              .trim();
          }
        }
      }
      result.details = details;

      // Store name from span.tier
      var tier = schedDiv.querySelector('.tier');
      if (tier) result.storeName = tier.textContent.trim();

      // Status from span.statusName
      var statusEl = schedDiv.querySelector('.statusName');
      if (statusEl) result.status = statusEl.textContent.trim();

      // DateTime from span.datetime
      var dtEl = schedDiv.querySelector('.datetime');
      if (dtEl) result.dateTime = dtEl.textContent.trim();

      // Address from div.event-address
      var addrEl = schedDiv.querySelector('.event-address');
      if (addrEl) {
        result.address = addrEl.textContent.replace(/[\n\r]+/g, ', ').trim();
      }

      // Phone from div.phone
      var phoneEl = schedDiv.querySelector('.phone');
      if (phoneEl) result.phone = phoneEl.textContent.trim();

      // Duration from span.duration
      var durEl = schedDiv.querySelector('.duration');
      if (durEl) result.duration = durEl.textContent.trim();

      return result;
    });
  } catch (err) {
    console.warn(`[GW]   Failed to scrape alert details: ${err.message}`);
    return null;
  }
}

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

    // Debug: screenshot after page load
    await saveDebug(page, refNumber, 'accept-page-loaded');

    // Scrape alert details from the page (Created By, Reason, Location, etc.)
    const alertDetails = await scrapeAlertDetails(page);
    if (alertDetails) {
      console.log(`[GW]   Scraped details: Created By="${alertDetails.details?.['Created By'] || 'N/A'}", Alert Type="${alertDetails.details?.['Alert Type'] || 'N/A'}"`);
    }

    // Strategy 1: Click "Accept Here" button (class="accept-btn")
    // IMPORTANT: Do NOT click other "Accept" buttons (vf-form-button etc) — those navigate away
    let acceptClicked = false;

    // 1a: CSS selector — the button is <input type="button" value="Accept Here" class="accept-btn">
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
          await page.waitForSelector('input.si-accept-confirm, input[value="Accept Issue"]', { timeout: 8000 });
          console.log(`[GW]   Resolution form appeared`);
        } catch (_) {
          console.log(`[GW]   Timed out waiting for resolution form — sleeping 4s`);
          await sleep(4000);
        }
        break;
      }
    }

    // 1b: XPath fallback
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

    // If "Accept Here" was NOT found, check if "Complete Here" is showing
    // That means the alert was ALREADY accepted — treat as success
    if (!acceptClicked) {
      await saveDebug(page, refNumber, 'accept-not-found');
      const completeCheck = await findAllInFrames(page, 'input.timelog-btn, input[value="Complete Here"]');
      if (completeCheck && completeCheck.elements.length > 0) {
        console.log(`[GW]   "Accept Here" not found but "Complete Here" is showing — already accepted on GlobalWorx`);
        return { success: true, alreadyAccepted: true, alertDetails };
      }
      // Neither button found — alert was already completed/expired on GlobalWorx
      console.log(`[GW]   ${refNumber} — No Accept or Complete button found (already completed/expired on GlobalWorx)`);
      return { success: true, alreadyCompleted: true, alertDetails };
    }

    // Strategy 2: Set resolution time to 48 hours
    // The restime dropdown is a Select2 widget — native <select> options are empty.
    // Must click the Select2 container to open the dropdown, then click the rendered option.
    let timeSet = false;

    try {
      // Extra wait for Select2 to fully initialize after the accept click
      await sleep(1500);

      // Diagnostic: log all selects
      const selectInfo = await page.evaluate(() => {
        var selects = document.querySelectorAll('select');
        var info = [];
        for (var i = 0; i < selects.length; i++) {
          var s = selects[i];
          info.push({ name: s.name || '', id: s.id || '', optionCount: s.options.length });
        }
        return info;
      });
      if (selectInfo.length > 0) {
        console.log(`[GW]   Found ${selectInfo.length} select(s) on page:`);
        selectInfo.forEach((s, i) => {
          console.log(`[GW]     Select ${i}: name="${s.name}" id="${s.id}" options=${s.optionCount}`);
        });
      }

      // First try: native options (in case they are present)
      timeSet = await page.evaluate((hours) => {
        var sel = document.querySelector('select[name*="restime"]')
               || document.querySelector('select[id*="restime"]')
               || document.querySelector('select[name*="resolution"]');
        if (!sel || !sel.options || sel.options.length === 0) return false;
        for (var i = 0; i < sel.options.length; i++) {
          var o = sel.options[i];
          if ((o.value+'').indexOf(hours) !== -1 || (o.text+'').indexOf(hours) !== -1) {
            sel.value = o.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            try { if (window.$ && window.$(sel).val) window.$(sel).val(o.value).trigger('change'); } catch(_) {}
            return o.text || o.value;
          }
        }
        return false;
      }, RESOLUTION_HOURS);

      // Second try: Select2 UI — click the container to open dropdown, then click the option
      if (!timeSet) {
        console.log('[GW]   Native options empty — trying Select2 UI interaction');

        // Open the Select2 dropdown by clicking its rendered container
        const opened = await page.evaluate(() => {
          var sel = document.querySelector('select[name*="restime"]')
                 || document.querySelector('select[id*="restime"]');
          if (!sel) return false;
          // Select2 renders a .select2-container sibling next to the hidden <select>
          var container = sel.nextElementSibling;
          if (!container || !container.classList.contains('select2-container')) {
            // Try parent's child
            container = sel.parentElement && sel.parentElement.querySelector('.select2-container');
          }
          if (container) {
            var selection = container.querySelector('.select2-selection, .select2-choice');
            if (selection) { selection.click(); return true; }
          }
          // Fallback: jQuery Select2 API
          try { if (window.$ && window.$(sel).select2) { window.$(sel).select2('open'); return true; } } catch(_) {}
          return false;
        });

        if (opened) {
          try {
            // Wait for Select2 results list to render
            await page.waitForSelector('.select2-results__option, .select2-results li, ul.select2-results li', { timeout: 4000 });
            await sleep(300);

            timeSet = await page.evaluate((hours) => {
              var options = document.querySelectorAll('.select2-results__option, .select2-results li');
              for (var i = 0; i < options.length; i++) {
                var txt = (options[i].textContent || '').trim();
                if (txt.indexOf(hours) !== -1) {
                  options[i].click();
                  return txt;
                }
              }
              return false;
            }, RESOLUTION_HOURS);
          } catch (s2err) {
            console.log('[GW]   Select2 dropdown did not open in time:', s2err.message);
          }
        } else {
          console.log('[GW]   Could not open Select2 container for restime');
        }
      }

      if (timeSet) {
        console.log('[GW]   Set resolution to: ' + timeSet);
      } else {
        console.log('[GW]   Could not set 48hr — proceeding anyway (form default will be used)');
      }
    } catch (err2) {
      console.error('[GW]   Strategy 2 error:', err2.message);
    }

    // HARD STOP: if resolution time could not be set to 48hr, do NOT submit.
    // Submitting with the wrong resolution time (e.g. 1hr default) is worse than not submitting.
    if (acceptClicked && !timeSet) {
      console.error(`[GW]   ${refNumber} — ABORTED: could not set 48hr resolution time. Will not submit with wrong value.`);
      return { success: false, abortedResolution: true, error: 'Could not set 48hr resolution — submission aborted' };
    }

    await sleep(1000);

    // Strategy 3: Click "Accept Issue" / Submit — CSS first, then XPath
    let submitted = false;

    try {
      // 3a: CSS selector — button is <input class="si-accept-confirm mobilebutton" value="Accept Issue">
      // IMPORTANT: Only match the actual "Accept Issue" submit — NOT generic submit buttons
      const submitCssSelectors = [
        'input.si-accept-confirm',
        'input[value="Accept Issue"]',
        'input[value*="Accept Issue"]',
      ];
      for (const sel of submitCssSelectors) {
        const found = await findAllInFrames(page, sel);
        if (found && found.elements.length > 0) {
          const tag = await found.elements[0].evaluate(el => `${el.tagName} class="${el.className}" value="${el.value}"`);
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
          "//button[contains(text(), 'Accept Issue')]",
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

      // 3c: Text-based fallback
      if (!submitted) {
        const textEl = await findByText(page, ['Accept Issue']);
        if (textEl) {
          console.log(`[GW]   Found Submit button via text search "Accept Issue"`);
          await textEl.evaluate(el => el.click());
          submitted = true;
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
      await saveDebug(page, refNumber, 'after-accept-submit');
      console.log(`[GW]   ACCEPTED ${refNumber}`);
      return { success: true, alertDetails };
    } else {
      await saveDebug(page, refNumber, 'accept-submit-not-found');
      console.log(`[GW]   FAILED ${refNumber} — "Accept Issue" submit button not found`);
      return { success: false, alertDetails, error: 'Submit button not found' };
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

    // Grant geolocation permission — GlobalWorx may request it during Accept/Complete flows
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://adusa.goglobalworx.com', ['geolocation']);
    await page.setGeolocation(DEFAULT_GEO);

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

    // Debug: screenshot after page load
    await saveDebug(page, refNumber, 'complete-page-loaded');

    // Scrape alert details from the page (Created By, Reason, Location, etc.)
    const alertDetails = await scrapeAlertDetails(page);
    if (alertDetails) {
      console.log(`[GW]   Scraped details: Created By="${alertDetails.details?.['Created By'] || 'N/A'}", Alert Type="${alertDetails.details?.['Alert Type'] || 'N/A'}"`);
    }

    // Log all buttons/inputs on the page for debugging
    const pageButtons = await page.evaluate(() => {
      var inputs = document.querySelectorAll('input[type="button"], input[type="submit"], button');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        result.push({
          tag: el.tagName,
          type: el.type || '',
          value: el.value || '',
          className: el.className || '',
          text: (el.textContent || '').trim().substring(0, 50),
          visible: window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden',
        });
      }
      return result;
    });
    console.log(`[GW]   Page has ${pageButtons.length} button(s):`);
    pageButtons.forEach((b, i) => {
      console.log(`[GW]     ${i}: <${b.tag} type="${b.type}" value="${b.value}" class="${b.className}"> visible=${b.visible} text="${b.text}"`);
    });

    // Look for "Complete Here" button: <input class="timelog-btn" value="Complete Here">
    let buttonFound = false;

    // ONLY match the exact "Complete Here" button — class="timelog-btn" or exact value
    // Do NOT use broad wildcards like input[value*="Complete"] — they match dashboard filters
    const completeCssSelectors = [
      'input.timelog-btn',
      'input[value="Complete Here"]',
    ];

    // Helper: find the Complete button in any frame
    async function findCompleteButton() {
      for (const sel of completeCssSelectors) {
        const found = await findAllInFrames(page, sel);
        if (found && found.elements.length > 0) {
          return { element: found.elements[0], selector: sel, frame: found.frame };
        }
      }
      // XPath fallback
      const completeXpaths = [
        "//input[@value='Complete Here']",
        "//input[contains(@class, 'timelog-btn')]",
      ];
      for (const xpath of completeXpaths) {
        const found = await findInFrames(page, xpath);
        if (found) {
          return { element: found.element, selector: xpath, frame: found.frame };
        }
      }
      // Text fallback
      const textEl = await findByText(page, ['Complete Here']);
      if (textEl) {
        return { element: textEl, selector: 'text:Complete Here', frame: null };
      }
      return null;
    }

    const btn = await findCompleteButton();
    if (btn) {
      buttonFound = true;
      const tag = await btn.element.evaluate(el => `${el.tagName} class="${el.className}" value="${el.value}"`);
      console.log(`[GW]   Found Complete button via "${btn.selector}": ${tag}`);

      // Attempt 1: Puppeteer native .click() — fires real mousedown/mouseup/click events
      // After clicking, GlobalWorx requests geolocation, submits form, then navigates away
      console.log(`[GW]   Attempt 1: Puppeteer native .click()`);
      await btn.element.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await sleep(500);
      try {
        await btn.element.click();
      } catch (clickErr) {
        console.log(`[GW]   Puppeteer .click() threw: ${clickErr.message} — trying evaluate fallbacks`);
      }
      // Wait for geolocation grant + form submission + page navigation
      await sleep(5000);

      // Verify: is the button still there?
      let stillThere = await findCompleteButton();
      if (stillThere) {
        console.log(`[GW]   Button still present after Attempt 1 — click did not register`);
        await saveDebug(page, refNumber, 'after-complete-attempt1-failed');

        // Attempt 2: Directly invoke the onclick handler via evaluate
        console.log(`[GW]   Attempt 2: Direct onclick invocation via evaluate`);
        await stillThere.element.evaluate(el => {
          // Try invoking onclick attribute directly
          if (el.onclick) {
            el.onclick.call(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
          } else {
            // Fallback: dispatch a full MouseEvent
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        });
        await sleep(3000);

        stillThere = await findCompleteButton();
        if (stillThere) {
          console.log(`[GW]   Button still present after Attempt 2 — trying schedList.checkout`);
          await saveDebug(page, refNumber, 'after-complete-attempt2-failed');

          // Attempt 3: Call schedList.checkout directly (the actual onclick handler)
          console.log(`[GW]   Attempt 3: Calling schedList.checkout() directly`);
          const targetFrame = btn.frame || page;
          await targetFrame.evaluate(() => {
            var btn = document.querySelector('input.timelog-btn') || document.querySelector('input[value="Complete Here"]');
            if (btn && typeof schedList !== 'undefined' && typeof schedList.checkout === 'function') {
              schedList.checkout(btn.form, btn);
            }
          });
          await sleep(3000);

          stillThere = await findCompleteButton();
          if (stillThere) {
            console.log(`[GW]   Button STILL present after all 3 attempts — click FAILED`);
            await saveDebug(page, refNumber, 'after-complete-all-attempts-failed');
            return { success: false, clickFailed: true, alertDetails, error: 'Complete button found but click did not register after 3 attempts' };
          }
        }
      }

      // Button is gone — click was successful
      await saveDebug(page, refNumber, 'after-complete-verified');
      console.log(`[GW]   COMPLETED ${refNumber} (verified — button no longer present)`);
      return { success: true, alertDetails };
    }

    // Complete button not found — screenshot for debugging
    await saveDebug(page, refNumber, 'complete-not-found');

    // Check if "Accept Here" is still showing — means never accepted
    let acceptStillShowing = false;
    const acceptCheckSelectors = [
      'input.accept-btn',
      'input[value="Accept Here"]',
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
      return { success: false, notAccepted: true, alertDetails, error: 'Alert was never accepted on GlobalWorx' };
    } else {
      console.log(`[GW]   ${refNumber} — No Complete or Accept button found (already completed/expired on GlobalWorx)`);
      return { success: true, alreadyCompleted: true, alertDetails };
    }

  } catch (err) {
    console.error(`[GW]   ERROR completing ${refNumber}:`, err.message);
    try { await saveDebug(page, refNumber, 'complete-error'); } catch (_) {}
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

    // Grant geolocation permission — GlobalWorx "Complete Here" triggers a geolocation request
    // Without this, the browser blocks the request and the Complete flow hangs
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://adusa.goglobalworx.com', ['geolocation']);
    await page.setGeolocation(DEFAULT_GEO);
    console.log('[GW] Geolocation permission granted for Complete flow');

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
 * Scrape alert details from GlobalWorx pages without clicking any buttons.
 * Used to backfill gwCreatedBy/gwAlertType/gwReason for alerts accepted before v2.19.0.
 * @param {Array<{ url: string, refNumber: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, alertDetails: object|null }> }}
 */
async function scrapeBatch(alerts) {
  if (!alerts || alerts.length === 0) {
    return { results: [] };
  }

  console.log(`[GW] Starting batch scrape: ${alerts.length} alert(s)`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'],
    });
  } catch (err) {
    console.error('[GW] Failed to launch browser:', err.message);
    return {
      results: alerts.map(a => ({ refNumber: a.refNumber, alertDetails: null })),
    };
  }

  const results = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      console.log(`[GW] --- Scrape ${i + 1}/${alerts.length}: ${alert.refNumber} ---`);
      try {
        await page.goto(alert.url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);
        const alertDetails = await scrapeAlertDetails(page);
        if (alertDetails) {
          console.log(`[GW]   Scraped: Created By="${alertDetails.details?.['Created By'] || 'N/A'}", Reason="${(alertDetails.details?.['Reason'] || 'N/A').substring(0, 60)}"`);
        }
        results.push({ refNumber: alert.refNumber, alertDetails });
      } catch (err) {
        console.error(`[GW]   ERROR scraping ${alert.refNumber}:`, err.message);
        results.push({ refNumber: alert.refNumber, alertDetails: null });
      }

      if (i < alerts.length - 1) await sleep(500);
    }
  } finally {
    await browser.close();
    console.log('[GW] Browser closed.');
  }

  const scraped = results.filter(r => r.alertDetails).length;
  console.log(`[GW] DONE: ${scraped} scraped, ${results.length - scraped} failed out of ${alerts.length}`);
  return { results };
}

/**
 * Check the status of alerts on GlobalWorx without clicking any buttons.
 * Navigates to each URL and checks which buttons are present.
 * @param {Array<{ url: string, refNumber: string, emailId?: string }>} alerts
 * @returns {{ results: Array<{ refNumber: string, emailId: string, hasCompleteButton: boolean, hasAcceptButton: boolean, alertDetails: object|null }> }}
 */
async function checkStatusBatch(alerts) {
  if (!alerts || alerts.length === 0) {
    return { results: [] };
  }

  console.log(`[GW] Starting batch status check: ${alerts.length} alert(s)`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'],
    });
  } catch (err) {
    console.error('[GW] Failed to launch browser:', err.message);
    return {
      results: alerts.map(a => ({ refNumber: a.refNumber, emailId: a.emailId || '', hasCompleteButton: false, hasAcceptButton: false, alertDetails: null, error: err.message })),
    };
  }

  const results = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      console.log(`[GW] --- Check Status ${i + 1}/${alerts.length}: ${alert.refNumber} ---`);
      try {
        await page.goto(alert.url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        // Scrape alert details
        const alertDetails = await scrapeAlertDetails(page);

        // Check for "Complete Here" button
        let hasCompleteButton = false;
        const completeCss = ['input.timelog-btn', 'input[value="Complete Here"]'];
        for (const sel of completeCss) {
          const found = await findAllInFrames(page, sel);
          if (found && found.elements.length > 0) {
            hasCompleteButton = true;
            break;
          }
        }

        // Check for "Accept Here" button
        let hasAcceptButton = false;
        const acceptCss = ['input.accept-btn', 'input[value="Accept Here"]'];
        for (const sel of acceptCss) {
          const found = await findAllInFrames(page, sel);
          if (found && found.elements.length > 0) {
            hasAcceptButton = true;
            break;
          }
        }

        console.log(`[GW]   Status: Complete=${hasCompleteButton}, Accept=${hasAcceptButton}${!hasCompleteButton && !hasAcceptButton ? ' (expired/completed)' : ''}`);
        results.push({ refNumber: alert.refNumber, emailId: alert.emailId || '', hasCompleteButton, hasAcceptButton, alertDetails });
      } catch (err) {
        console.error(`[GW]   ERROR checking ${alert.refNumber}:`, err.message);
        results.push({ refNumber: alert.refNumber, emailId: alert.emailId || '', hasCompleteButton: false, hasAcceptButton: false, alertDetails: null, error: err.message });
      }

      if (i < alerts.length - 1) await sleep(500);
    }
  } finally {
    await browser.close();
    console.log('[GW] Browser closed.');
  }

  const expired = results.filter(r => !r.hasCompleteButton && !r.hasAcceptButton && !r.error).length;
  const active = results.filter(r => r.hasCompleteButton || r.hasAcceptButton).length;
  console.log(`[GW] DONE: ${active} active, ${expired} expired/completed, ${results.length - active - expired} errors out of ${alerts.length}`);
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

module.exports = { acceptAlert, acceptBatch, completeAlert, completeBatch, scrapeBatch, checkStatusBatch, checkStatus };

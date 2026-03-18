/**
 * Jobber Store Invoices Batch Scraper
 * Searches each store in the provided list, scrapes invoice/visit data,
 * paginates through results, and accumulates all invoices.
 *
 * Store list is passed via sessionStorage key 'invoice-scraper-stores'
 * as a JSON array of { storeId, storeNum } objects.
 * If no store list is set, scrapes whatever is currently on the page (legacy mode).
 */
(function () {
  'use strict';

  const K = 'invoice-scraper-data';
  const STORES_KEY = 'invoice-scraper-stores';
  const DELAY_SEARCH = 2500;  // ms to wait after triggering a search
  const DELAY_PAGE = 2000;    // ms to wait after clicking Next Page
  const STOP_KEY = 'invoice-scraper-stop';

  // Skip non-content frames
  const frameUrl = window.location.href || '';
  console.log('[Invoice Scraper] Starting in frame:', frameUrl.substring(0, 100));
  if (frameUrl === 'about:blank' || frameUrl === '' || frameUrl === 'about:srcdoc') {
    console.log('[Invoice Scraper] Skipping non-content frame');
    return;
  }

  function toast(msg, color, persist) {
    try {
      const doc = (window.top || window).document;
      let t = doc.getElementById('inv-scrape-toast');
      if (!t) {
        t = doc.createElement('div');
        t.id = 'inv-scrape-toast';
        t.style.cssText =
          'position:fixed;top:20px;right:20px;padding:16px 24px;border-radius:8px;' +
          'font-size:15px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3);' +
          'color:#fff;max-width:500px;line-height:1.4';
        doc.body.appendChild(t);
      }
      t.style.background = color || '#3b82f6';
      t.innerHTML = msg;
      if (!persist) setTimeout(() => { try { t.remove(); } catch(e) {} }, 8000);
    } catch (e) { /* cross-origin frame */ }
  }

  function progress(msg) {
    try {
      chrome.runtime.sendMessage({ type: 'scrape-progress', source: 'invoices', message: msg });
    } catch (e) { /* ignore */ }
  }

  // ── Grid Search ────────────────────────────────────────────────────────────

  /**
   * Find the Store ID search input in the grid header.
   * It's the 2nd .grid-filter input (index 1).
   */
  function getStoreIdInput() {
    // Try the main grid approach from the user's working script
    const grids = document.querySelectorAll('.ag-root-wrapper');
    for (const grid of grids) {
      const container = grid.closest('.d-grid')?.parentElement || grid.parentElement;
      if (!container) continue;
      const inputs = container.querySelectorAll('input.grid-filter');
      if (inputs.length >= 2) return inputs[1]; // index 1 = Store ID
    }
    // Fallback: find any input with placeholder/title containing "Store"
    const allInputs = document.querySelectorAll('input.grid-filter');
    if (allInputs.length >= 2) return allInputs[1];
    return null;
  }

  /**
   * Search for a store number by typing into the Store ID input and pressing Enter.
   * Uses Aurelia-compatible events (native input + keyup Enter).
   */
  function searchStore(storeNum) {
    return new Promise((resolve) => {
      const inp = getStoreIdInput();
      if (!inp) {
        console.log('[Invoice Scraper] Could not find Store ID input');
        resolve(false);
        return;
      }

      // Clear first
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));

      // Set the value
      inp.value = storeNum;
      inp.dispatchEvent(new Event('input', { bubbles: true }));

      // Fire Enter keyup to trigger search
      inp.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
      }));

      // Also try callSearch if available
      try {
        if (document.WSApplet && typeof document.WSApplet.callSearch === 'function') {
          document.WSApplet.callSearch();
        }
      } catch (e) { /* ignore */ }

      // Wait for results
      setTimeout(() => resolve(true), DELAY_SEARCH);
    });
  }

  /**
   * Clear the search filter to reset the grid.
   */
  function clearSearch() {
    return new Promise((resolve) => {
      const inp = getStoreIdInput();
      if (inp) {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
        }));
      }
      setTimeout(resolve, 500);
    });
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  /**
   * Parse invoice data from body text.
   * Pattern per record: Edit | Jobber | Store ID | Store Name | Doc # | Doc Date | Post Date | Amount | Address
   */
  function parseFromText() {
    const bodyText = document.body?.innerText || '';
    if (!bodyText.includes('Store ID') && !bodyText.includes('FLW') && !bodyText.includes('SFW') && !bodyText.includes('SRW')) {
      return null;
    }

    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const data = [];

    // Strategy 1: Find "Edit" markers with fixed offsets
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== 'Edit') continue;
      if (i + 8 >= lines.length) continue;

      const jobber    = lines[i + 1];
      const storeId   = lines[i + 2];
      const storeName = lines[i + 3];
      const docNum    = lines[i + 4];
      const docDate   = lines[i + 5];
      const postDate  = lines[i + 6];
      const amount    = lines[i + 7];
      const address   = lines[i + 8];

      if (!/^\d{2,3}$/.test(jobber)) continue;
      if (!/^[A-Z]{2,5}\d{3,5}$/.test(storeId)) continue;
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(docDate)) continue;

      const amountVal = parseFloat(amount.replace(/[$,\s]/g, ''));
      data.push({ jobber, storeId, storeName, docNum, docDate, postDate, amount: isNaN(amountVal) ? 0 : amountVal, address });
      i += 8;
    }

    if (data.length > 0) return data;

    // Strategy 2: Find store IDs and scan nearby lines
    for (let i = 0; i < lines.length; i++) {
      if (!/^[A-Z]{2,5}\d{3,5}$/.test(lines[i])) continue;
      const storeId = lines[i];

      const win = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 8));
      let jobber = '', storeName = '', docNum = '', docDate = '', postDate = '', amount = '', address = '';
      const dates = [];

      for (const l of win) {
        if (/^\d{2,3}$/.test(l) && !jobber) jobber = l;
        else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l)) dates.push(l);
        else if (/^-?\$?[\d,]+\.\d{2}$/.test(l.replace(/\s/g, '')) && !amount) amount = l;
        else if (/^\d{6,8}$/.test(l) && !docNum) docNum = l;
        else if (l.includes(' ') && /[A-Z]{2}\.?\s*\d{5}/.test(l) && !address) address = l;
        else if (l !== storeId && l !== 'Edit' && !storeName && l.length > 3 && /[A-Z]/.test(l)) storeName = l;
      }

      if (dates.length >= 1) {
        docDate = dates[0];
        postDate = dates[1] || dates[0];
        const amountVal = parseFloat((amount || '0').replace(/[$,\s]/g, ''));
        data.push({ jobber, storeId, storeName, docNum, docDate, postDate, amount: isNaN(amountVal) ? 0 : amountVal, address });
      }
    }

    return data.length > 0 ? data : null;
  }

  /**
   * Fallback DOM-based parsing
   */
  function parseFromDOM() {
    const allElements = document.querySelectorAll('div, span, td');
    const storeIdEls = [];

    for (const el of allElements) {
      const text = el.textContent.trim();
      if (el.children.length > 0) continue;
      if (/^[A-Z]{2,5}\d{3,5}$/.test(text)) {
        storeIdEls.push(el);
      }
    }

    if (storeIdEls.length === 0) return null;

    const data = [];
    for (const el of storeIdEls) {
      const row = el.closest('tr, [role="row"], .row, [class*="row"], [class*="Row"]') || el.parentElement;
      if (!row) continue;

      const cells = Array.from(row.querySelectorAll('div, span, td')).filter(c => c.children.length === 0);
      const texts = cells.map(c => c.textContent.trim());

      const storeId = el.textContent.trim();
      let docDate = '', postDate = '', amount = '', jobber = '', storeName = '', docNum = '', address = '';

      for (const t of texts) {
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
          if (!docDate) docDate = t;
          else if (!postDate) postDate = t;
        } else if (/^-?\$?[\d,]+\.\d{2}$/.test(t.replace(/\s/g, ''))) {
          if (!amount) amount = t;
        } else if (/^\d{2,3}$/.test(t) && !jobber) {
          jobber = t;
        } else if (/^\d{6,8}$/.test(t) && !docNum) {
          docNum = t;
        }
      }

      if (docDate) {
        const amountVal = parseFloat((amount || '0').replace(/[$,\s]/g, ''));
        data.push({ jobber, storeId, storeName, docNum, docDate, postDate, amount: isNaN(amountVal) ? 0 : amountVal, address });
      }
    }

    return data.length > 0 ? data : null;
  }

  // ── Page Scraping ──────────────────────────────────────────────────────────

  /**
   * Scrape the current page and return parsed invoices (or empty array).
   */
  function scrapeCurrentPage() {
    let pageData = parseFromText();
    if (!pageData) pageData = parseFromDOM();
    return pageData || [];
  }

  /**
   * Check if there's an enabled Next Page button.
   */
  function findNextButton() {
    const candidates = [
      document.getElementById('cmdNxt'),
      ...Array.from(document.querySelectorAll('input[type="button"], input[type="submit"]')).filter(
        el => /next/i.test(el.value || '')
      ),
      document.querySelector('a[title*="Next"], a[id*="Next"]'),
      document.querySelector('img[id*="Nxt"], img[id*="Next"]'),
    ];

    for (const btn of candidates) {
      if (!btn) continue;
      let enabled = true;
      if (btn.style.visibility === 'hidden' || btn.style.display === 'none') enabled = false;
      if (btn.disabled) enabled = false;
      const src = (btn.src || '').toLowerCase();
      if (src.includes('grey') || src.includes('gray') || src.includes('disabled')) enabled = false;
      try {
        if (parseFloat(window.getComputedStyle(btn).opacity) < 0.5) enabled = false;
      } catch(e) {}
      if (enabled) return btn;
    }

    // Also look for "Next Page" text
    const allClickable = document.querySelectorAll('input, button, a, [onclick]');
    for (const el of allClickable) {
      const text = (el.value || el.textContent || '').trim();
      if (/^next\s*page$/i.test(text) && !el.disabled) return el;
    }

    return null;
  }

  /**
   * Scrape all pages for the current search result.
   * Paginates through Next buttons until no more pages.
   * Returns a promise that resolves with all invoices for this search.
   */
  function scrapeAllPages() {
    return new Promise((resolve) => {
      const allInvoices = [];
      const seenDocs = new Set();

      function scrapePage() {
        const pageData = scrapeCurrentPage();
        let newCount = 0;

        for (const inv of pageData) {
          const key = inv.docNum || `${inv.storeId}-${inv.docDate}-${inv.amount}`;
          if (!seenDocs.has(key)) {
            seenDocs.add(key);
            allInvoices.push(inv);
            newCount++;
          }
        }

        console.log('[Invoice Scraper] Page scraped:', pageData.length, 'rows,', newCount, 'new');

        // Check for Next page
        const nextBtn = findNextButton();
        if (nextBtn && newCount > 0) {
          nextBtn.click();
          setTimeout(scrapePage, DELAY_PAGE);
        } else {
          resolve(allInvoices);
        }
      }

      scrapePage();
    });
  }

  // ── Batch Runner ───────────────────────────────────────────────────────────

  async function runBatch(storeList) {
    const accumulated = [];
    const totalStores = storeList.length;

    progress(`Starting batch scrape for ${totalStores} store(s)...`);
    toast(`Starting batch scrape for <b>${totalStores}</b> stores...`, '#3b82f6', true);

    // Clear any previous stop signal
    try { localStorage.removeItem(STOP_KEY); } catch (e) {}

    for (let i = 0; i < storeList.length; i++) {
      // Check for stop signal
      try {
        if (localStorage.getItem(STOP_KEY)) {
          localStorage.removeItem(STOP_KEY);
          progress(`Stopped after ${i}/${totalStores} stores. Total: ${accumulated.length} invoices`);
          toast(`Stopped. <b>${accumulated.length}</b> invoices from ${i} stores.`, '#f59e0b', true);
          // Send whatever we have so far
          if (accumulated.length > 0) {
            chrome.runtime.sendMessage({ type: 'scrape-done', source: 'invoices', data: accumulated, count: accumulated.length });
          } else {
            chrome.runtime.sendMessage({ type: 'scrape-error', source: 'invoices', message: 'Stopped — no invoices collected.' });
          }
          return;
        }
      } catch (e) {}

      const { storeId, storeNum } = storeList[i];
      const label = storeId || storeNum;

      progress(`[${i + 1}/${totalStores}] Searching ${label}...`);
      toast(
        `[${i + 1}/${totalStores}] Searching <b>${label}</b>...<br>Total so far: <b>${accumulated.length}</b>`,
        '#3b82f6', true
      );

      // Search for this store
      const searched = await searchStore(storeNum);
      if (!searched) {
        progress(`[${i + 1}/${totalStores}] Could not find search input for ${label}`);
        continue;
      }

      // Scrape all pages of results
      const invoices = await scrapeAllPages();

      if (invoices.length > 0) {
        // Deduplicate against accumulated
        const existingDocs = new Set(accumulated.map(r => r.docNum).filter(Boolean));
        for (const inv of invoices) {
          const key = inv.docNum || `${inv.storeId}-${inv.docDate}-${inv.amount}`;
          if (!existingDocs.has(key)) {
            existingDocs.add(key);
            accumulated.push(inv);
          }
        }
        progress(`[${i + 1}/${totalStores}] ${label}: ${invoices.length} invoices found. Total: ${accumulated.length}`);
      } else {
        progress(`[${i + 1}/${totalStores}] ${label}: no invoices found`);
      }

      toast(
        `[${i + 1}/${totalStores}] <b>${label}</b>: ${invoices.length} invoices<br>Total: <b>${accumulated.length}</b>`,
        '#3b82f6', true
      );
    }

    // Clear the search filter
    await clearSearch();

    // Done — send results
    if (accumulated.length === 0) {
      toast('No invoices found for any stores.', '#ef4444');
      chrome.runtime.sendMessage({ type: 'scrape-error', source: 'invoices', message: 'No invoices found.' });
      return;
    }

    const storeIds = [...new Set(accumulated.map(r => r.storeId))];
    toast(
      `Done! <b>${accumulated.length}</b> invoices for ${storeIds.length} store${storeIds.length !== 1 ? 's' : ''}`,
      '#22c55e', true
    );

    chrome.runtime.sendMessage({
      type: 'scrape-done',
      source: 'invoices',
      data: accumulated,
      count: accumulated.length,
    });
  }

  // ── Legacy single-page mode ────────────────────────────────────────────────

  function runLegacy() {
    let pageData = scrapeCurrentPage();

    if (pageData.length === 0) {
      const bodyText = document.body?.innerText || '';
      if (bodyText.includes('Store ID') || bodyText.length > 5000) {
        toast('Could not parse invoice data from the page.', '#ef4444');
        chrome.runtime.sendMessage({ type: 'scrape-error', source: 'invoices', message: 'Could not parse invoice data.' });
      }
      return;
    }

    // Accumulate across pages
    let accumulated = [];
    try {
      const raw = sessionStorage.getItem(K);
      if (raw) accumulated = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    const existingDocs = new Set(accumulated.map(r => r.docNum).filter(Boolean));
    const newRows = pageData.filter(r => !r.docNum || !existingDocs.has(r.docNum));
    accumulated = accumulated.concat(newRows);
    sessionStorage.setItem(K, JSON.stringify(accumulated));

    const pageMatch = document.body.innerText.match(/Page[:\s]*(\d+)/i);
    const currentPage = pageMatch ? parseInt(pageMatch[1]) : '?';

    progress(`Page ${currentPage}: ${pageData.length} invoices (${newRows.length} new). Total: ${accumulated.length}`);
    toast(
      `Page ${currentPage}: ${pageData.length} invoices (${newRows.length} new)<br>Total: <b>${accumulated.length}</b>`,
      '#3b82f6', true
    );

    // Check for Next Page button
    setTimeout(() => {
      const nextBtn = findNextButton();
      if (newRows.length === 0 && accumulated.length > 0) {
        // No new rows — we've exhausted this search
      } else if (nextBtn) {
        toast(
          `Page ${currentPage}: auto-clicking Next...<br>Total so far: <b>${accumulated.length}</b>`,
          '#3b82f6', true
        );
        nextBtn.click();
        setTimeout(() => runLegacy(), 3000);
        return;
      }

      // Done
      if (accumulated.length === 0) {
        toast('No invoices found.', '#ef4444');
        return;
      }

      const storeIds = [...new Set(accumulated.map(r => r.storeId))];
      const storeNames = [...new Set(accumulated.map(r => r.storeName))].filter(Boolean);

      toast(
        `Done! <b>${accumulated.length}</b> invoices for ${storeIds.length} store${storeIds.length !== 1 ? 's' : ''} (${storeNames.join(', ')})`,
        '#22c55e', true
      );

      chrome.runtime.sendMessage({
        type: 'scrape-done',
        source: 'invoices',
        data: accumulated,
        count: accumulated.length,
      });

      sessionStorage.removeItem(K);
    }, 500);
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  // Check if a store list was provided (batch mode)
  // Uses localStorage (shared across frames) so the scraper can find it regardless of which frame it runs in
  let storeList = null;
  try {
    const raw = localStorage.getItem(STORES_KEY);
    if (raw) storeList = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  if (storeList && Array.isArray(storeList) && storeList.length > 0) {
    // Only run batch mode if this frame has the search grid
    const hasGrid = getStoreIdInput();
    if (hasGrid) {
      // Consume the store list so other frames don't also start batch mode
      try { localStorage.removeItem(STORES_KEY); } catch (e) { /* ignore */ }
      console.log('[Invoice Scraper] Batch mode:', storeList.length, 'stores');
      runBatch(storeList);
    } else {
      console.log('[Invoice Scraper] Store list found but no grid in this frame, skipping');
    }
  } else {
    console.log('[Invoice Scraper] Legacy mode: scraping current page');
    sessionStorage.removeItem(K);
    runLegacy();
  }
})();

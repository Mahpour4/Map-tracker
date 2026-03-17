/**
 * Jobber Store Invoices Scraper
 * Scrapes invoice/visit data from the WebSnak "Jobber Store Invoices" page.
 * The page uses a custom grid (not <table>), so we parse from body text.
 */
(function () {
  'use strict';

  const K = 'invoice-scraper-data';

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

  /**
   * Parse invoice data from the body text.
   * The grid renders each cell as a separate line in innerText.
   * Pattern per record: Edit | Jobber | Store ID | Store Name | Doc # | Doc Date | Post Date | Amount | Address
   */
  function parseFromText() {
    const bodyText = document.body?.innerText || '';
    if (!bodyText.includes('Store ID') && !bodyText.includes('FLW')) {
      return null; // Not the right frame
    }

    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const data = [];

    // Find data rows by looking for "Edit" followed by expected patterns
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== 'Edit') continue;

      // After "Edit", expect: Jobber(3-digit), StoreID, StoreName, DocNum, DocDate, PostDate, Amount, Address
      // But we need enough lines remaining
      if (i + 8 >= lines.length) continue;

      const jobber    = lines[i + 1];
      const storeId   = lines[i + 2];
      const storeName = lines[i + 3];
      const docNum    = lines[i + 4];
      const docDate   = lines[i + 5];
      const postDate  = lines[i + 6];
      const amount    = lines[i + 7];
      const address   = lines[i + 8];

      // Validate: jobber should be 3 digits, storeId should look like a store ID, dates should be MM/DD/YYYY
      if (!/^\d{2,3}$/.test(jobber)) continue;
      if (!/^[A-Z]{2,5}\d{3,5}$/.test(storeId)) continue;
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(docDate)) continue;

      const amountVal = parseFloat(amount.replace(/[$,\s]/g, ''));

      data.push({
        jobber,
        storeId,
        storeName,
        docNum,
        docDate,
        postDate,
        amount: isNaN(amountVal) ? 0 : amountVal,
        address,
      });

      i += 8; // Skip past this record
    }

    return data.length > 0 ? data : null;
  }

  /**
   * Alternative: try to find grid cells in the DOM by looking for elements with store-ID-like content
   */
  function parseFromDOM() {
    // Look for elements containing store IDs (FLW, SFW, CMW, etc.)
    const allElements = document.querySelectorAll('div, span, td');
    const storeIdEls = [];

    for (const el of allElements) {
      const text = el.textContent.trim();
      // Must be a direct text node, not a parent containing lots of text
      if (el.children.length > 0) continue;
      if (/^[A-Z]{2,5}\d{3,5}$/.test(text)) {
        storeIdEls.push(el);
      }
    }

    if (storeIdEls.length === 0) return null;

    console.log('[Invoice Scraper] Found', storeIdEls.length, 'store ID elements in DOM');

    // For each store ID element, try to find sibling cells in the same row
    const data = [];
    for (const el of storeIdEls) {
      const row = el.closest('tr, [role="row"], .row, [class*="row"], [class*="Row"]') || el.parentElement;
      if (!row) continue;

      const cells = Array.from(row.querySelectorAll('div, span, td')).filter(c => c.children.length === 0);
      const texts = cells.map(c => c.textContent.trim());

      // Try to extract data from cells
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
        data.push({
          jobber,
          storeId,
          storeName,
          docNum,
          docDate,
          postDate,
          amount: isNaN(amountVal) ? 0 : amountVal,
          address,
        });
      }
    }

    return data.length > 0 ? data : null;
  }

  function run() {
    // Try text parsing first (most reliable for this grid)
    let pageData = parseFromText();

    // Fallback to DOM parsing
    if (!pageData) {
      pageData = parseFromDOM();
    }

    if (!pageData) {
      const bodyText = document.body?.innerText || '';
      if (bodyText.includes('Store ID') || bodyText.includes('FLW') || bodyText.length > 5000) {
        console.log('[Invoice Scraper] Could not parse data. Body length:', bodyText.length);
        console.log('[Invoice Scraper] Body snippet:', bodyText.substring(0, 800));
        toast('Could not parse invoice data from the page.', '#ef4444');
        chrome.runtime.sendMessage({ type: 'scrape-error', source: 'invoices', message: 'Could not parse invoice data.' });
      }
      return;
    }

    console.log('[Invoice Scraper] Parsed', pageData.length, 'invoices from page');

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
      let nextBtn = null;
      let nextEnabled = false;

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
        nextBtn = btn;
        nextEnabled = true;
        if (btn.style.visibility === 'hidden' || btn.style.display === 'none') nextEnabled = false;
        if (btn.disabled) nextEnabled = false;
        const src = (btn.src || '').toLowerCase();
        if (src.includes('grey') || src.includes('gray') || src.includes('disabled')) nextEnabled = false;
        try {
          const opacity = window.getComputedStyle(btn).opacity;
          if (parseFloat(opacity) < 0.5) nextEnabled = false;
        } catch(e) {}
        if (nextEnabled) break;
      }

      // Also look for "Next Page" button
      if (!nextEnabled) {
        const allInputs = document.querySelectorAll('input[value="Next Page"]');
        for (const inp of allInputs) {
          if (!inp.disabled) { nextBtn = inp; nextEnabled = true; break; }
        }
      }

      if (newRows.length === 0 && accumulated.length > 0) nextEnabled = false;

      if (nextEnabled && nextBtn) {
        toast(
          `Page ${currentPage}: auto-clicking Next...<br>Total so far: <b>${accumulated.length}</b>`,
          '#3b82f6', true
        );
        nextBtn.click();
        setTimeout(() => run(), 3000);
      } else {
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
      }
    }, 500);
  }

  // Start
  console.log('[Invoice Scraper] Starting in frame:', window.location.href.substring(0, 100));
  sessionStorage.removeItem(K);
  run();
})();

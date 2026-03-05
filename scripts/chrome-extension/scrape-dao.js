// DAO Dashboard scraper — injected by the extension
// Same logic as dao-bookmarklet.js but sends data back to extension instead of downloading

(async function daoScrape() {
  function notify(msg) {
    chrome.runtime.sendMessage({ type: 'scrape-progress', source: 'dao', message: msg });
  }

  function showToast(msg, color) {
    let toast = document.getElementById('dao-scrape-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'dao-scrape-toast';
      toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:16px 24px;border-radius:8px;font-size:16px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);color:#fff;max-width:400px;';
      document.body.appendChild(toast);
    }
    toast.style.background = color || '#3b82f6';
    toast.textContent = msg;
  }

  /* Step 1: Find header row */
  let headerCells = [];
  for (const tr of document.querySelectorAll('tr')) {
    const ths = Array.from(tr.children).filter(c => c.tagName === 'TH');
    if (ths.length < 8) continue;
    const texts = ths.map(h => h.textContent.trim());
    const joined = texts.join(' ');
    if (joined.includes('Document Type') && (joined.includes('Route') || joined.includes('Cust'))) {
      headerCells = texts;
      break;
    }
  }
  if (headerCells.length === 0) {
    chrome.runtime.sendMessage({ type: 'scrape-error', source: 'dao', message: 'Could not find column headers. Make sure search results are loaded.' });
    return;
  }

  /* Step 2: Find data rows */
  function getDataRows() {
    let rows = Array.from(document.querySelectorAll('tr.rgRow, tr.rgAltRow'));
    if (rows.length > 0) return rows;
    let bestTable = null, bestCount = 0;
    for (const tbl of document.querySelectorAll('table')) {
      let count = 0;
      for (const tr of tbl.rows) {
        if (tr.cells.length >= 10 && !tr.querySelector('th')) count++;
      }
      if (count > bestCount) { bestCount = count; bestTable = tbl; }
    }
    if (bestTable) {
      rows = Array.from(bestTable.rows).filter(tr => tr.cells.length >= 10 && !tr.querySelector('th'));
    }
    return rows;
  }

  const testRows = getDataRows();
  if (testRows.length === 0) {
    chrome.runtime.sendMessage({ type: 'scrape-error', source: 'dao', message: 'No data rows found. Make sure search results are loaded.' });
    return;
  }

  /* Step 3: Build column map */
  const fieldMap = {
    'Branch': 'branch', 'Route': 'route', 'Cust. Num.': 'custNum',
    'Cust. Name': 'custName', 'Document Type': 'docType', 'ID': 'id',
    'Document Date': 'docDate', 'Settlement Date': 'settlementDate',
    'Amount': 'amount', 'Delivery Amount': 'deliveryAmount',
    'Delivery Difference': 'deliveryDifference', 'Invoice Type': 'invoiceType',
    'Void': 'void', 'DSD': 'dsd', 'Store Stamp': 'storeStamp',
    'DSD Store Stamp': 'dsd', 'Doc Missing': 'docMissing',
  };

  const colMap = {};
  headerCells.forEach((h, i) => {
    if (fieldMap[h]) { colMap[fieldMap[h]] = i; }
    else {
      for (const [key, field] of Object.entries(fieldMap)) {
        if (h.toLowerCase().includes(key.toLowerCase()) && !colMap[field]) {
          colMap[field] = i; break;
        }
      }
    }
  });

  /* Step 4: Detect column offset */
  const knownDocTypes = ['Invoice', 'Settle', 'Load', 'Truck Inventory', 'Route Order', 'Delivery'];

  function extractRows(rows, offset) {
    const data = [];
    for (const row of rows) {
      const cells = row.cells || row.querySelectorAll('td');
      const record = {};
      let nonEmpty = 0;
      for (const [field, idx] of Object.entries(colMap)) {
        const actualIdx = idx + offset;
        if (actualIdx >= 0 && actualIdx < cells.length) {
          let val = cells[actualIdx].textContent.trim();
          if (['amount', 'deliveryAmount', 'deliveryDifference'].includes(field)) {
            val = val.replace(/[$,]/g, '');
            const num = parseFloat(val);
            record[field] = isNaN(num) ? 0 : num;
            if (!isNaN(num) && num !== 0) nonEmpty++;
          } else {
            record[field] = val;
            if (val) nonEmpty++;
          }
        }
      }
      if (nonEmpty >= 3) data.push(record);
    }
    return data;
  }

  let bestOffset = 0, bestScore = 0;
  for (let off = 0; off <= 3; off++) {
    let score = 0;
    const sample = extractRows(testRows.slice(0, 10), off);
    for (const row of sample) {
      if (knownDocTypes.includes(row.docType)) score += 2;
      if (row.route && /^\d{5,6}$/.test(row.route)) score += 1;
      if (row.custName && row.custName.length > 2) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestOffset = off; }
  }

  /* Step 5: Scrape page 1 */
  let allData = extractRows(getDataRows(), bestOffset);
  notify('Page 1: ' + allData.length + ' rows');

  /* Step 6: Detect total pages */
  let totalPages = 0;
  const pageInfoMatch = document.body.innerText.match(/(\d+)\s*items?\s*in\s*(\d+)\s*pages?/i);
  if (pageInfoMatch) totalPages = parseInt(pageInfoMatch[2]);
  if (!totalPages) {
    let maxVisible = 1;
    for (const a of document.querySelectorAll('a[href*="Page"]')) {
      const m = a.href?.match(/Page\$(\d+)/);
      if (m) maxVisible = Math.max(maxVisible, parseInt(m[1]));
    }
    for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a')) {
      const n = parseInt(a.textContent.trim());
      if (!isNaN(n)) maxVisible = Math.max(maxVisible, n);
    }
    let hasMore = false;
    for (const el of document.querySelectorAll('a, input[type="submit"], input[type="button"], button')) {
      const txt = (el.textContent || el.value || '').trim();
      if (txt === '...' || txt === '\u2026' || txt === '>' || txt === '>>' || txt === '>|' || txt === '\u203A' || txt === '\u00BB' || txt.toLowerCase() === 'next') {
        hasMore = true; break;
      }
    }
    totalPages = hasMore ? maxVisible * 10 : maxVisible;
  }
  showToast('Page 1/' + (totalPages > 50 ? '?' : totalPages) + ' \u2014 ' + allData.length + ' rows', '#3b82f6');

  /* Step 7: Paginate */
  function getFirstRowText() {
    const rows = getDataRows();
    if (rows.length === 0) return '';
    return Array.from(rows[0].cells).map(c => c.textContent.trim()).join('|');
  }

  async function waitForChange(oldText, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise(r => setTimeout(r, 400));
      if (getFirstRowText() !== oldText) return true;
    }
    return false;
  }

  // Find a clickable "next page" element — prefer Next Page button over page numbers
  // because Telerik RadGrid re-renders page number links after each click
  function findNextPageLink(targetPage) {
    // Strategy A: Direct "Next Page" buttons (most reliable — always present if not last page)
    const nextSelectors = [
      '.rgArrPart2 a[title="Next Page"]',
      'a[title="Next Page"]',
      '.rgArrPart2 a[title="Next Pages"]',
      'a[title="Next Pages"]',
      'a[title="Next"]',
      '.rgArrPart2 a:not(.rgDisabled)',
      'input[title="Next Page"]',
      'input[title="Next Pages"]',
    ];
    for (const sel of nextSelectors) {
      const el = document.querySelector(sel);
      if (el && !el.classList.contains('rgDisabled') && !el.disabled &&
          el.offsetParent !== null) {
        return el;
      }
    }

    // Strategy B: Direct page number link
    let link = document.querySelector('a[title="Page ' + targetPage + '"]');
    if (link) return link;

    // Strategy C: Page number in pager area
    for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a')) {
      if (a.textContent.trim() === String(targetPage)) return a;
    }

    // Strategy D: href-based page link
    for (const a of document.querySelectorAll('a[href*="Page"]')) {
      if (a.href?.includes('Page$' + targetPage + "'") || a.href?.includes('Page%24' + targetPage)) return a;
    }

    // Strategy E: Click "..." ellipsis to reveal more page numbers, then find page
    for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a, a')) {
      const txt = a.textContent.trim();
      if (txt === '...' || txt === '\u2026') {
        a.click();
        // Can't await here (sync search), but we'll retry after
        return null;
      }
    }

    // Strategy F: > or >> buttons
    for (const el of document.querySelectorAll('input[type="submit"], input[type="button"], button')) {
      const val = (el.textContent || el.value || '').trim();
      if (!el.disabled && (val === '>' || val === '\u203A' || val === '\u00BB' || val === '>>')) return el;
    }

    return null;
  }

  for (let p = 2; p <= totalPages; p++) {
    const oldText = getFirstRowText();
    const pagesLabel = totalPages > 50 ? '?' : totalPages;
    showToast('Loading page ' + p + '/' + pagesLabel + '...', '#3b82f6');
    notify('Loading page ' + p + '/' + pagesLabel + '...');

    let link = findNextPageLink(p);

    // If no link found, maybe "..." was clicked — wait and retry
    if (!link) {
      await new Promise(r => setTimeout(r, 2500));
      link = findNextPageLink(p);
    }
    if (!link) break;

    link.click();

    let changed = await waitForChange(oldText, 15000);

    // If didn't change, try clicking the specific page number (the Next button might have revealed it)
    if (!changed) {
      const pageLink = document.querySelector('a[title="Page ' + p + '"]');
      if (pageLink) {
        pageLink.click();
        changed = await waitForChange(oldText, 10000);
      } else {
        for (const a2 of document.querySelectorAll('.rgNumPart a, .rgPager a, a')) {
          if (a2.textContent.trim() === String(p)) {
            a2.click();
            changed = await waitForChange(oldText, 10000);
            break;
          }
        }
      }
    }
    if (!changed) {
      notify('Page ' + p + ': timed out waiting for data. Stopping.');
      break;
    }

    const pageData = extractRows(getDataRows(), bestOffset);
    allData = allData.concat(pageData);
    showToast('Page ' + p + '/' + pagesLabel + ' \u2014 ' + allData.length + ' total', '#3b82f6');
    notify('Page ' + p + ': ' + allData.length + ' total rows');

    // Small delay between pages to let the UI settle
    await new Promise(r => setTimeout(r, 300));
  }

  // Clean up toast
  const toast = document.getElementById('dao-scrape-toast');
  if (toast) {
    toast.style.background = '#22c55e';
    toast.textContent = 'Scraped ' + allData.length + ' transactions! Sending to Map Tracker...';
    setTimeout(() => toast.remove(), 5000);
  }

  if (allData.length === 0) {
    chrome.runtime.sendMessage({ type: 'scrape-error', source: 'dao', message: 'No transaction data found.' });
    return;
  }

  // Send data back to extension
  chrome.runtime.sendMessage({
    type: 'scrape-done',
    source: 'dao',
    data: allData,
    count: allData.length,
  });
})();

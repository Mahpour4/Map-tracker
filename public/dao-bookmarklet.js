// DAO Dashboard Bookmarklet — scrapes ALL pages of the transaction table and downloads as .txt
// Paste this entire script into the browser console on the DAO dashboard page.

(async function daoScrape() {
  /* ── helpers ────────────────────────────────────────────────────────── */

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

  /* ── Step 1: Find the SPECIFIC header row ──────────────────────────── */
  // The page has many tables (RadDatePicker calendars, filter panels, etc.)
  // all with <th> elements. We need to find the ONE <tr> whose direct <th>
  // children include "Document Type", "Route", etc.
  let headerCells = [];
  for (const tr of document.querySelectorAll('tr')) {
    // Only look at direct child <th> elements of this row (not nested tables)
    const ths = Array.from(tr.children).filter(c => c.tagName === 'TH');
    if (ths.length < 8) continue;
    const texts = ths.map(h => h.textContent.trim());
    const joined = texts.join(' ');
    if (joined.includes('Document Type') && (joined.includes('Route') || joined.includes('Cust'))) {
      headerCells = texts;
      console.log('Found header row with ' + ths.length + ' columns:', texts.join(', '));
      break;
    }
  }
  if (headerCells.length === 0) {
    alert('Could not find column headers. Make sure search results are loaded.');
    return;
  }

  /* ── Step 2: Find data rows ────────────────────────────────────────── */
  // Strategy A: Telerik-specific classes (most reliable)
  function getDataRows() {
    let rows = Array.from(document.querySelectorAll('tr.rgRow, tr.rgAltRow'));
    if (rows.length > 0) return rows;
    // Strategy B: Find the single table with the most rows having 10+ cells
    let bestTable = null;
    let bestCount = 0;
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
  console.log('Data rows found:', testRows.length);
  if (testRows.length === 0) {
    alert('No data rows found. Make sure search results are loaded.');
    return;
  }
  // Log first row for debugging
  const firstCells = Array.from(testRows[0].cells).map(c => c.textContent.trim());
  console.log('First row cells (' + firstCells.length + '):', firstCells.join(' | '));

  /* ── Step 3: Build column map ──────────────────────────────────────── */
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
  console.log('Column map:', JSON.stringify(colMap));

  /* ── Step 4: Detect column offset ──────────────────────────────────── */
  // Data rows may have extra leading columns (e.g., checkboxes) that
  // the header row doesn't include. Try offsets 0-3 and pick the best.
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
      if (nonEmpty >= 3) {
        data.push(record);
      }
    }
    return data;
  }

  let bestOffset = 0;
  let bestScore = 0;
  for (let off = 0; off <= 3; off++) {
    let score = 0;
    const sample = extractRows(testRows.slice(0, 10), off);
    for (const row of sample) {
      if (knownDocTypes.includes(row.docType)) score += 2;
      if (row.route && /^\d{5,6}$/.test(row.route)) score += 1;
      if (row.custName && row.custName.length > 2) score += 1;
    }
    console.log('Offset ' + off + ': score=' + score + ', rows=' + sample.length);
    if (score > bestScore) { bestScore = score; bestOffset = off; }
  }
  console.log('Using offset:', bestOffset);

  /* ── Step 5: Scrape page 1 ─────────────────────────────────────────── */
  let allData = extractRows(getDataRows(), bestOffset);
  console.log('Page 1:', allData.length, 'rows');
  if (allData.length > 0) {
    console.log('Sample row:', JSON.stringify(allData[0]));
  }

  /* ── Step 6: Detect total pages ────────────────────────────────────── */
  // First try to find an explicit page count (e.g., "2500 items in 25 pages")
  let totalPages = 0;
  const pageInfoMatch = document.body.innerText.match(/(\d+)\s*items?\s*in\s*(\d+)\s*pages?/i);
  if (pageInfoMatch) {
    totalPages = parseInt(pageInfoMatch[2]);
    console.log('Total pages from text:', totalPages);
  }
  // Fallback: scan visible page links for the max page number
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
    // If "..." or ">" or ">|" buttons exist, there are MORE pages beyond what's visible
    let hasMoreIndicator = false;
    for (const el of document.querySelectorAll('a, input[type="submit"], input[type="button"], button')) {
      const txt = (el.textContent || el.value || '').trim();
      if (txt === '...' || txt === '…' || txt === '>' || txt === '>>' || txt === '>|' ||
          txt === '›' || txt === '»' || txt.toLowerCase() === 'next') {
        hasMoreIndicator = true;
        break;
      }
    }
    if (hasMoreIndicator) {
      // We can't know the real total, so set a high ceiling — the loop will stop
      // when it can no longer navigate forward
      totalPages = maxVisible * 10; // generous upper bound (e.g., 10 visible → assume up to 100)
      console.log('Visible pages:', maxVisible, '— "more" indicator found, setting ceiling:', totalPages);
    } else {
      totalPages = maxVisible;
      console.log('Total pages from visible links:', totalPages);
    }
  }
  showToast('Page 1/' + (totalPages > 50 ? '?' : totalPages) + ' — ' + allData.length + ' rows', '#3b82f6');

  /* ── Step 7: Paginate through remaining pages ──────────────────────── */
  function getFirstRowText() {
    const rows = getDataRows();
    if (rows.length === 0) return '';
    return Array.from(rows[0].cells).map(c => c.textContent.trim()).join('|');
  }

  async function waitForChange(oldText, maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise(r => setTimeout(r, 400));
      const cur = getFirstRowText();
      if (cur && cur !== oldText) return true;
    }
    return false;
  }

  for (let p = 2; p <= totalPages; p++) {
    const oldText = getFirstRowText();

    // Find page link using multiple strategies
    let link = null;

    // Strategy 1: Direct page number link (works for visible page numbers)
    link = document.querySelector('a[title="Page ' + p + '"]');

    // Strategy 2: Find by text content in pager area
    if (!link) {
      for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a')) {
        if (a.textContent.trim() === String(p)) { link = a; break; }
      }
    }

    // Strategy 3: Find by href containing Page$N
    if (!link) {
      for (const a of document.querySelectorAll('a[href*="Page"]')) {
        if (a.href?.includes('Page$' + p + "'") || a.href?.includes('Page%24' + p)) { link = a; break; }
      }
    }

    // Strategy 4: Click "..." ellipsis to expand page range, then retry
    if (!link) {
      // Look for any "..." link in the entire pager area
      for (const a of document.querySelectorAll('a')) {
        const txt = a.textContent.trim();
        if (txt === '...' || txt === '…') {
          console.log('Clicking "..." to expand page range');
          a.click();
          await new Promise(r => setTimeout(r, 2000));
          // After expanding, try to find the page number link
          link = document.querySelector('a[title="Page ' + p + '"]');
          if (!link) {
            for (const a2 of document.querySelectorAll('a')) {
              if (a2.textContent.trim() === String(p)) { link = a2; break; }
            }
          }
          break;
        }
      }
    }

    // Strategy 5: Use the "Next" arrow button (most reliable fallback)
    if (!link) {
      // Telerik Next button variations — try ALL possible selectors
      const nextSelectors = [
        '.rgArrPart2 a[title="Next Pages"]',
        '.rgArrPart2 a[title="Next Page"]',
        '.rgArrPart2 a',
        'a[title="Next Pages"]',
        'a[title="Next Page"]',
        'a[title="Next"]',
        'input[title="Next Pages"]',
        'input[title="Next Page"]',
        'button[title="Next Page"]',
        'button[title="Next Pages"]',
      ];
      for (const sel of nextSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          // Make sure it's not disabled
          if (el.classList.contains('rgDisabled') || el.disabled) continue;
          link = el;
          console.log('Using Next button:', sel);
          break;
        }
      }
    }

    // Strategy 6: Find any forward-navigation link by __doPostBack
    if (!link) {
      for (const a of document.querySelectorAll('a[href*="doPostBack"]')) {
        if (a.href?.includes("'Next'") || a.href?.includes("'Last'") ||
            a.href?.includes("Page%24Next") || a.href?.includes("Page$Next")) {
          link = a;
          console.log('Using doPostBack Next link');
          break;
        }
      }
    }

    // Strategy 7: Brute-force — find any clickable element that looks like forward navigation
    // IMPORTANT: Prefer ">" (next page) over ">|" (last page) to avoid jumping to the end
    if (!link) {
      // Check inputs first (Telerik often uses <input type="submit"> for pager arrows)
      const nextInputs = []; // ">" next page buttons
      const lastInputs = []; // ">|" last page buttons
      for (const el of document.querySelectorAll('input[type="submit"], input[type="button"]')) {
        const val = (el.value || '').trim();
        if (el.disabled) continue;
        if (val === '>' || val === '›' || val === '»' || val === '>>') {
          nextInputs.push(el);
        } else if (val === '>|') {
          lastInputs.push(el);
        }
      }
      // Prefer ">" over ">|"
      if (nextInputs.length > 0) {
        link = nextInputs[0];
        console.log('Using input button:', (link.value || '').trim());
      } else if (lastInputs.length > 0) {
        link = lastInputs[0];
        console.log('Using input button (last):', (link.value || '').trim());
      }
      // Then check links and buttons
      if (!link) {
        const nextLinks = [];
        const lastLinks = [];
        for (const a of document.querySelectorAll('a, button')) {
          if (a.classList.contains('rgDisabled') || a.disabled) continue;
          const txt = a.textContent?.trim() || a.title?.trim() || '';
          if (txt === '>' || txt === '›' || txt === '»' || txt === '>>' ||
              txt.toLowerCase() === 'next' || txt === '→') {
            nextLinks.push(a);
          } else if (txt === '>|') {
            lastLinks.push(a);
          }
        }
        if (nextLinks.length > 0) {
          link = nextLinks[0];
          console.log('Using brute-force next:', link.textContent?.trim());
        } else if (lastLinks.length > 0) {
          link = lastLinks[0];
          console.log('Using brute-force last:', link.textContent?.trim());
        }
      }
    }

    // Debug: if still no link, log all pager elements so we can diagnose
    if (!link) {
      console.log('=== PAGER DEBUG for page ' + p + ' ===');
      for (const a of document.querySelectorAll('.rgPager a, .rgPager input, .rgPager button, .rgNumPart a, .rgArrPart1 a, .rgArrPart2 a')) {
        console.log('  Pager element:', a.tagName, 'text="' + a.textContent.trim() + '"', 'title="' + (a.title||'') + '"', 'class="' + a.className + '"', 'href=' + (a.href||'').substring(0, 80));
      }
      // Also check for any Telerik pager wrapper
      const pager = document.querySelector('.rgPager, .GridPager, [class*="Pager"]');
      if (pager) {
        console.log('  Pager HTML:', pager.innerHTML.substring(0, 500));
      } else {
        console.log('  No .rgPager found. Searching all tables for pager-like content...');
        for (const td of document.querySelectorAll('td')) {
          if (td.querySelector('a') && td.textContent.includes('10') && td.querySelectorAll('a').length > 3) {
            console.log('  Possible pager TD:', td.innerHTML.substring(0, 500));
            break;
          }
        }
      }
    }

    if (!link) {
      console.log('No link found for page ' + p + ', stopping at ' + allData.length + ' rows.');
      break;
    }

    const pagesLabel = totalPages > 50 ? '?' : totalPages;
    showToast('Loading page ' + p + '/' + pagesLabel + '...', '#3b82f6');
    console.log('Clicking page ' + p + '...');

    // For input buttons, trigger click and also try form submission
    if (link.tagName === 'INPUT') {
      link.click();
      // Also try dispatching a proper click event
      if (!link.onclick) {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    } else {
      link.click();
    }

    let changed = await waitForChange(oldText, 15000);

    // If the ">" button just updated the pager without changing data,
    // we need to click the actual page number now
    if (!changed) {
      const pageLink = document.querySelector('a[title="Page ' + p + '"]');
      if (!pageLink) {
        for (const a2 of document.querySelectorAll('a')) {
          if (a2.textContent.trim() === String(p)) {
            console.log('Pager expanded, now clicking page ' + p);
            a2.click();
            changed = await waitForChange(oldText, 10000);
            break;
          }
        }
      } else {
        console.log('Pager expanded, now clicking page ' + p);
        pageLink.click();
        changed = await waitForChange(oldText, 10000);
      }
    }

    if (!changed) {
      // Try __doPostBack directly
      const pbMatch = link.href?.match(/__doPostBack\('([^']+)','([^']*)'\)/);
      if (pbMatch && typeof __doPostBack === 'function') {
        console.log('Trying __doPostBack for page ' + p);
        __doPostBack(pbMatch[1], pbMatch[2]);
        changed = await waitForChange(oldText, 10000);
      }
    }
    if (!changed) {
      // One more attempt: try clicking the link again after a delay
      await new Promise(r => setTimeout(r, 2000));
      link.click();
      changed = await waitForChange(oldText, 10000);
    }
    if (!changed) {
      console.log('Page ' + p + ': content did not change after retries, stopping at ' + allData.length + ' rows.');
      break;
    }

    const pageData = extractRows(getDataRows(), bestOffset);
    console.log('Page ' + p + ':', pageData.length, 'rows');
    allData = allData.concat(pageData);
    showToast('Page ' + p + '/' + pagesLabel + ' — ' + allData.length + ' total', '#3b82f6');
  }

  /* ── Step 8: Download ──────────────────────────────────────────────── */
  if (allData.length === 0) {
    alert('Could not extract any transaction data. Check the console (F12) for diagnostic output.');
    return;
  }

  const json = JSON.stringify(allData);
  const blob = new Blob([json], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const ts = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  a.href = url;
  a.download = 'dao-transactions-' + ts + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Downloaded ' + allData.length + ' transactions!', '#22c55e');
  setTimeout(function() { var el = document.getElementById('dao-scrape-toast'); if (el) el.remove(); }, 5000);
})();

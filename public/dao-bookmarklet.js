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
  let totalPages = 1;
  const pageInfoMatch = document.body.innerText.match(/(\d+)\s*items?\s*in\s*(\d+)\s*pages?/i);
  if (pageInfoMatch) {
    totalPages = parseInt(pageInfoMatch[2]);
  } else {
    for (const a of document.querySelectorAll('a[href*="Page"]')) {
      const m = a.href?.match(/Page\$(\d+)/);
      if (m) totalPages = Math.max(totalPages, parseInt(m[1]));
    }
    for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a')) {
      const n = parseInt(a.textContent.trim());
      if (!isNaN(n)) totalPages = Math.max(totalPages, n);
    }
  }
  console.log('Total pages:', totalPages);
  showToast('Page 1/' + totalPages + ' — ' + allData.length + ' rows', '#3b82f6');

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
    let link = document.querySelector('a[title="Page ' + p + '"]');
    if (!link) {
      for (const a of document.querySelectorAll('.rgNumPart a, .rgPager a, .rgArrPart2 a')) {
        if (a.textContent.trim() === String(p)) { link = a; break; }
      }
    }
    if (!link) {
      for (const a of document.querySelectorAll('a[href*="Page"]')) {
        if (a.href?.includes('Page$' + p + "'") || a.href?.includes('Page%24' + p)) { link = a; break; }
      }
    }
    if (!link) {
      link = document.querySelector('.rgArrPart2 a, a[title="Next Page"], a[title="Next"]');
    }

    if (!link) {
      console.log('No link found for page ' + p + ', stopping.');
      break;
    }

    showToast('Loading page ' + p + '/' + totalPages + '...', '#3b82f6');
    console.log('Clicking page ' + p + '...');
    link.click();

    let changed = await waitForChange(oldText, 10000);
    if (!changed) {
      const pbMatch = link.href?.match(/__doPostBack\('([^']+)','([^']*)'\)/);
      if (pbMatch && typeof __doPostBack === 'function') {
        console.log('Trying __doPostBack for page ' + p);
        __doPostBack(pbMatch[1], pbMatch[2]);
        changed = await waitForChange(oldText, 10000);
      }
    }
    if (!changed) {
      console.log('Page ' + p + ': content did not change after 10s, stopping.');
      break;
    }

    const pageData = extractRows(getDataRows(), bestOffset);
    console.log('Page ' + p + ':', pageData.length, 'rows');
    allData = allData.concat(pageData);
    showToast('Page ' + p + '/' + totalPages + ' — ' + allData.length + ' total', '#3b82f6');
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

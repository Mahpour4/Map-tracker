// Central Billing Invoice Inquiry scraper — injected by the extension
// Reads ag-grid tables (Chain_List, Store_List, Invoice_List, Invoice_Detail),
// paginates through each grid by clicking Next until disabled, then downloads as JSON

(async function () {
  function notify(msg) {
    try { chrome.runtime.sendMessage({ type: 'scrape-progress', source: 'cb-inquiry', message: msg }); } catch (e) {}
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function extractPageRows(api, colDefs) {
    const rows = [];
    api.forEachNodeAfterFilter(node => {
      if (node.data) {
        const row = {};
        colDefs.forEach(field => { row[field] = node.data[field] ?? null; });
        rows.push(row);
      }
    });
    return rows;
  }

  // Find the Next Page button inside a given ag-root-wrapper
  function findNextBtn(agEl) {
    return (
      agEl.querySelector('[ref="btNext"]') ||
      agEl.querySelector('button[aria-label="Next Page"]') ||
      agEl.querySelector('.ag-paging-button:last-of-type') ||
      null
    );
  }

  // Check if an ag-grid has pagination controls
  function hasPagination(agEl) {
    return !!agEl.querySelector('.ag-paging-panel');
  }

  async function extractAllPages(name, agEl, api, colDefs) {
    const allRows = [];

    if (!hasPagination(agEl)) {
      // No pagination — just grab all rows directly
      api.forEachNode(node => {
        if (node.data) {
          const row = {};
          colDefs.forEach(field => { row[field] = node.data[field] ?? null; });
          allRows.push(row);
        }
      });
      notify(`${name}: ${allRows.length} rows (no pagination)`);
      return allRows;
    }

    // Navigate to first page if API supports it
    if (typeof api.paginationGoToFirstPage === 'function') {
      api.paginationGoToFirstPage();
      await wait(400);
    }

    let page = 1;
    while (true) {
      const pageRows = extractPageRows(api, colDefs);
      allRows.push(...pageRows);
      notify(`${name}: page ${page} — ${pageRows.length} rows (${allRows.length} total)`);

      const nextBtn = findNextBtn(agEl);
      if (!nextBtn || nextBtn.disabled || nextBtn.classList.contains('ag-disabled') ||
          nextBtn.getAttribute('aria-disabled') === 'true') {
        break;
      }

      nextBtn.click();
      await wait(600); // wait for grid to re-render
      page++;

      // Safety cap — avoid infinite loops
      if (page > 500) {
        notify(`${name}: reached page limit (500), stopping`);
        break;
      }
    }

    notify(`${name}: done — ${allRows.length} total rows across ${page} page(s)`);
    return allRows;
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  const gridNames = ['Chain_List', 'Store_List', 'Invoice_List', 'Invoice_Detail'];
  const grids = document.querySelectorAll('[role="grid"]');

  if (!grids.length) {
    notify('No grids found on this page. Make sure you are on the Invoice Inquiry page.');
    try { chrome.runtime.sendMessage({ type: 'scrape-error', source: 'cb-inquiry', message: 'No ag-grid tables found on this page.' }); } catch (e) {}
    return;
  }

  notify(`Found ${grids.length} grid(s). Starting extraction...`);

  const output = {};
  let totalRows = 0;

  for (let i = 0; i < grids.length; i++) {
    const g = grids[i];
    const name = gridNames[i] || `Grid_${i + 1}`;
    const agEl = g.closest('.ag-root-wrapper') || g.parentElement;
    const comp = agEl.__agComponent;

    if (!comp) {
      notify(`${name}: no ag-grid component found — skipping`);
      output[name] = [];
      continue;
    }

    const api = comp.gridOptions.api;
    const colDefs = (comp.gridOptions.columnDefs || []).map(c => c.field).filter(Boolean);

    const rows = await extractAllPages(name, agEl, api, colDefs);
    output[name] = rows;
    totalRows += rows.length;
  }

  // Download as JSON
  const date = new Date().toISOString().slice(0, 10);
  const filename = `map-tracker-invoices-${date}.json`;
  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const summary = Object.entries(output).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  notify(`Downloaded ${filename} — ${summary}`);
  try {
    chrome.runtime.sendMessage({
      type: 'scrape-done',
      source: 'cb-inquiry',
      data: output,
      count: totalRows,
    });
  } catch (e) {}
})();

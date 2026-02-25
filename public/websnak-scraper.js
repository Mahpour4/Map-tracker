// WebSnak Store Maintenance Scraper v5
// Scrapes AG Grid store data, accumulates via sessionStorage,
// downloads Python-dict format as .txt file when done.

(function websnakScrape() {
  var K = 'websnak-scraper-data';

  function showToast(msg, color, persistent) {
    var topDoc = (window.top || window).document;
    var t = topDoc.getElementById('ws-scrape-toast');
    if (!t) {
      t = topDoc.createElement('div');
      t.id = 'ws-scrape-toast';
      t.style.cssText = 'position:fixed;top:20px;right:20px;padding:16px 24px;border-radius:8px;font-size:15px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);color:#fff;max-width:500px;line-height:1.4;';
      topDoc.body.appendChild(t);
    }
    t.style.background = color || '#3b82f6';
    t.innerHTML = msg;
    if (!persistent) setTimeout(function() { t.remove(); }, 8000);
  }

  /* ── Try AG Grid API first (gets ALL rows including virtual) ──────── */
  var allData = null;

  try {
    var gridEls = document.querySelectorAll('.ag-root-wrapper, [class*="ag-root"]');
    for (var gi = 0; gi < gridEls.length; gi++) {
      var el = gridEls[gi];
      // AG Grid stores component reference on the element
      var comp = el.__agComponent || el._agComponent;
      if (comp) {
        var api = comp.gridApi || comp.api || (comp.gridOptions && comp.gridOptions.api);
        if (api && api.forEachNode) {
          allData = [];
          api.forEachNode(function(node) {
            if (node.data) allData.push(node.data);
          });
          console.log('AG Grid API: got ' + allData.length + ' rows');
          if (allData.length > 0) {
            console.log('AG Grid columns:', Object.keys(allData[0]).join(', '));
          }
          break;
        }
      }
    }
  } catch(e) {
    console.log('AG Grid API not accessible:', e.message);
  }

  /* ── Fallback: DOM scrape AG Grid cells ──────────────────────────── */
  var pageStores = [];

  if (allData && allData.length > 0) {
    // Use API data — column keys may differ from display names
    for (var i = 0; i < allData.length; i++) {
      var d = allData[i];
      // Try common key patterns
      var storeId = d['STOREID'] || d['Store Id'] || d['StoreId'] || d['storeId'] || '';
      var name = d['NAME'] || d['Name'] || d['name'] || '';
      var route = d['ROUTENUM'] || d['Route/Jobber'] || d['RouteJobber'] || '';
      var address = d['SRCHADDRESS'] || d['Address'] || d['ADDRESS'] || d['address'] || '';
      var lastSale = d['LASTSALESDATE'] || d['Last Sale'] || d['LastSale'] || d['LASTSALE'] || '';

      if (storeId) {
        pageStores.push({
          'Store Id': String(storeId),
          'Name': String(name),
          'Route/Jobber': String(route),
          'Address': String(address),
          'Last Sale': String(lastSale),
        });
      }
    }
    console.log('From API: ' + pageStores.length + ' stores');
  } else {
    // DOM scraping fallback
    console.log('Using DOM scraping for AG Grid...');

    // Build column map: col-id attribute -> display name
    var headerCells = document.querySelectorAll('.ag-header-cell');
    var colMap = {};
    for (var hi = 0; hi < headerCells.length; hi++) {
      var colId = headerCells[hi].getAttribute('col-id') || '';
      var textSpan = headerCells[hi].querySelector('.ag-header-cell-text');
      var displayName = textSpan ? textSpan.textContent.trim() : '';
      if (colId && displayName) {
        colMap[colId] = displayName;
        console.log('  Column: col-id="' + colId + '" -> "' + displayName + '"');
      }
    }

    // Find all rendered rows
    var agRows = document.querySelectorAll('.ag-row');
    console.log('AG Grid: ' + agRows.length + ' rows rendered, ' + Object.keys(colMap).length + ' columns');

    for (var ri = 0; ri < agRows.length; ri++) {
      var row = agRows[ri];
      var agCells = row.querySelectorAll('.ag-cell');
      var store = {};

      for (var ci = 0; ci < agCells.length; ci++) {
        var cellColId = agCells[ci].getAttribute('col-id') || '';
        var colName = colMap[cellColId] || cellColId;
        store[colName] = agCells[ci].textContent.trim();
      }

      if (store['Store Id'] || store['Store ID'] || store['StoreId']) {
        var sid = store['Store Id'] || store['Store ID'] || store['StoreId'];
        pageStores.push({
          'Store Id': sid,
          'Name': store['Name'] || '',
          'Route/Jobber': store['Route/Jobber'] || '',
          'Address': store['Address'] || '',
          'Last Sale': store['Last Sale'] || '',
        });
      }
    }
    console.log('From DOM: ' + pageStores.length + ' stores');

    // If no rows found, might need to scroll. Log for debugging.
    if (pageStores.length === 0 && agRows.length === 0) {
      console.log('No AG Grid rows found. Grid might not be initialized.');
      console.log('ag-root-wrapper elements:', document.querySelectorAll('.ag-root-wrapper').length);
      console.log('ag-body elements:', document.querySelectorAll('.ag-body').length);
      console.log('ag-row elements:', document.querySelectorAll('[class*="ag-row"]').length);
    }
  }

  if (pageStores.length === 0) {
    showToast('No store rows found in the grid. Make sure the Search List tab is active and data is loaded.', '#ef4444');
    return;
  }

  /* ── Accumulate in sessionStorage ──────────────────────────────────── */
  var accumulated = [];
  try {
    var raw = sessionStorage.getItem(K);
    if (raw) accumulated = JSON.parse(raw);
  } catch(e) {}

  var existingIds = new Set(accumulated.map(function(s) { return s['Store Id']; }));
  var newStores = pageStores.filter(function(s) { return !existingIds.has(s['Store Id']); });
  accumulated = accumulated.concat(newStores);
  sessionStorage.setItem(K, JSON.stringify(accumulated));

  /* ── Check Next Page button (deferred 500ms for UI to settle) ──────── */
  showToast('Scraped ' + pageStores.length + ' stores (' + newStores.length + ' new). Checking pagination...', '#3b82f6', true);

  setTimeout(function() {
    var nextBtn = document.getElementById('cmdNxt');
    var nextEnabled = false;

    if (nextBtn) {
      nextEnabled = true;
      if (nextBtn.style.visibility === 'hidden' || nextBtn.style.display === 'none') nextEnabled = false;
      var src = (nextBtn.src || '').toLowerCase();
      if (src.indexOf('grey') >= 0 || src.indexOf('gray') >= 0 || src.indexOf('disabled') >= 0 || src.indexOf('_dn') >= 0) {
        nextEnabled = false;
      }
      // Check opacity (disabled buttons often have low opacity)
      var computedOpacity = window.getComputedStyle(nextBtn).opacity;
      if (parseFloat(computedOpacity) < 0.5) nextEnabled = false;
      // Check cursor style (disabled buttons often have default cursor)
      var computedCursor = window.getComputedStyle(nextBtn).cursor;
      if (computedCursor === 'default' || computedCursor === 'not-allowed') nextEnabled = false;
    }

    // If no new stores on this page, we've already scraped it — treat as last page
    if (newStores.length === 0 && accumulated.length > 0) {
      nextEnabled = false;
    }

    // Check page text for "Page: X of Y" — if on last page, disable Next
    var pageMatch = document.body.innerText.match(/Page:\s*(\d+)/);
    var currentPage = pageMatch ? parseInt(pageMatch[1]) : '?';
    var totalMatch = document.body.innerText.match(/Page:\s*\d+\s*(?:of|\/)\s*(\d+)/i);
    if (totalMatch) {
      var totalPages = parseInt(totalMatch[1]);
      if (currentPage !== '?' && currentPage >= totalPages) {
        nextEnabled = false;
      }
    }

    // Check if page didn't change after a previous Next click (stored in sessionStorage)
    var prevPage = sessionStorage.getItem(K + '-page');
    if (prevPage && currentPage !== '?' && String(currentPage) === prevPage) {
      nextEnabled = false;
      sessionStorage.removeItem(K + '-page');
    }

    console.log('Next btn: found=' + !!nextBtn + ' enabled=' + nextEnabled + ' newStores=' + newStores.length +
      ' page=' + currentPage + (totalMatch ? '/' + totalMatch[1] : '') +
      (nextBtn ? ' vis=' + nextBtn.style.visibility + ' src=' + (nextBtn.src || '') + ' opacity=' + computedOpacity + ' cursor=' + computedCursor : ''));

    if (nextEnabled) {
      if (currentPage !== '?') sessionStorage.setItem(K + '-page', String(currentPage));
      showToast(
        'Page ' + currentPage + ': scraped ' + pageStores.length + ' stores (' + newStores.length + ' new)<br>' +
        'Total so far: <strong>' + accumulated.length + '</strong><br>Auto-clicking Next...', '#3b82f6', true
      );
      setTimeout(function() { nextBtn.click(); }, 500);
    } else {
      if (accumulated.length === 0) {
        showToast('No stores found.', '#ef4444');
        return;
      }

      var pyLines = ['['];
      for (var pi = 0; pi < accumulated.length; pi++) {
        var s = accumulated[pi];
        var route = parseInt(s['Route/Jobber']);
        var routeVal = isNaN(route) ? "'" + s['Route/Jobber'] + "'" : String(route);
        pyLines.push("    {'Store Id': '" + s['Store Id'] + "', 'Name': '" +
          (s['Name'] || '').replace(/'/g, "\\'") + "', 'Route/Jobber': " + routeVal +
          ", 'Address': '" + (s['Address'] || '').replace(/'/g, "\\'") +
          "', 'Last Sale': '" + (s['Last Sale'] || '') + "'}" + (pi < accumulated.length - 1 ? ',' : ''));
      }
      pyLines.push(']');
      var pyText = pyLines.join('\n');

      // Download as .txt file
      var blob = new Blob([pyText], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var d = new Date();
      a.download = 'websnak-stores-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Done! <strong>' + accumulated.length + '</strong> stores downloaded!<br>Import the .txt file in Data Import.', '#22c55e', true);

      sessionStorage.removeItem(K);
      sessionStorage.removeItem(K + '-page');
    }
  }, 500);
})();

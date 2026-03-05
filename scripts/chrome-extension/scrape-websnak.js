// WebSnak store scraper — injected by the extension
// Same logic as websnak-scraper.js but sends data back to extension instead of downloading

(function() {
  var K = 'websnak-scraper-data';

  function notify(msg) {
    chrome.runtime.sendMessage({ type: 'scrape-progress', source: 'websnak', message: msg });
  }

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

  function scrapeCurrentPage() {
    var allData = null;
    try {
      var gridEls = document.querySelectorAll('.ag-root-wrapper, [class*="ag-root"]');
      for (var gi = 0; gi < gridEls.length; gi++) {
        var comp = gridEls[gi].__agComponent || gridEls[gi]._agComponent;
        if (comp) {
          var api = comp.gridApi || comp.api || (comp.gridOptions && comp.gridOptions.api);
          if (api && api.forEachNode) {
            allData = [];
            api.forEachNode(function(node) { if (node.data) allData.push(node.data); });
            if (allData.length > 0) break;
          }
        }
      }
    } catch(e) {}

    var pageStores = [];
    if (allData && allData.length > 0) {
      for (var i = 0; i < allData.length; i++) {
        var d = allData[i];
        var storeId = d['STOREID'] || d['Store Id'] || d['StoreId'] || d['storeId'] || '';
        if (storeId) {
          pageStores.push({
            'Store Id': String(storeId),
            'Name': String(d['NAME'] || d['Name'] || d['name'] || ''),
            'Route/Jobber': String(d['ROUTENUM'] || d['Route/Jobber'] || d['RouteJobber'] || ''),
            'Address': String(d['SRCHADDRESS'] || d['Address'] || d['ADDRESS'] || ''),
            'Last Sale': String(d['LASTSALESDATE'] || d['Last Sale'] || d['LastSale'] || ''),
          });
        }
      }
    } else {
      var headerCells = document.querySelectorAll('.ag-header-cell');
      var colMap = {};
      for (var hi = 0; hi < headerCells.length; hi++) {
        var colId = headerCells[hi].getAttribute('col-id') || '';
        var textSpan = headerCells[hi].querySelector('.ag-header-cell-text');
        if (colId && textSpan) colMap[colId] = textSpan.textContent.trim();
      }
      var agRows = document.querySelectorAll('.ag-row');
      for (var ri = 0; ri < agRows.length; ri++) {
        var agCells = agRows[ri].querySelectorAll('.ag-cell');
        var store = {};
        for (var ci = 0; ci < agCells.length; ci++) {
          var ccid = agCells[ci].getAttribute('col-id') || '';
          store[colMap[ccid] || ccid] = agCells[ci].textContent.trim();
        }
        var sid = store['Store Id'] || store['Store ID'] || store['StoreId'] || '';
        if (sid) {
          pageStores.push({
            'Store Id': sid, 'Name': store['Name'] || '',
            'Route/Jobber': store['Route/Jobber'] || '',
            'Address': store['Address'] || '', 'Last Sale': store['Last Sale'] || '',
          });
        }
      }
    }
    return pageStores;
  }

  function doScrape() {
    var pageStores = scrapeCurrentPage();
    if (pageStores.length === 0) {
      chrome.runtime.sendMessage({ type: 'scrape-error', source: 'websnak', message: 'No store rows found. Make sure the Search List tab is active.' });
      return;
    }

    /* Accumulate */
    var accumulated = [];
    try { var raw = sessionStorage.getItem(K); if (raw) accumulated = JSON.parse(raw); } catch(e) {}
    var existingIds = new Set(accumulated.map(function(s) { return s['Store Id']; }));
    var newStores = pageStores.filter(function(s) { return !existingIds.has(s['Store Id']); });
    accumulated = accumulated.concat(newStores);
    sessionStorage.setItem(K, JSON.stringify(accumulated));

    var pageMatch = document.body.innerText.match(/Page:\s*(\d+)/);
    var currentPage = pageMatch ? parseInt(pageMatch[1]) : '?';

    showToast('Page ' + currentPage + ': ' + pageStores.length + ' stores (' + newStores.length + ' new)<br>Total: <strong>' + accumulated.length + '</strong>', '#3b82f6', true);
    notify('Page ' + currentPage + ': ' + accumulated.length + ' total stores');

    /* Check Next button */
    setTimeout(function() {
      var nextBtn = document.getElementById('cmdNxt');
      var nextEnabled = false;
      if (nextBtn) {
        nextEnabled = true;
        if (nextBtn.style.visibility === 'hidden' || nextBtn.style.display === 'none') nextEnabled = false;
        var src = (nextBtn.src || '').toLowerCase();
        if (src.indexOf('grey') >= 0 || src.indexOf('gray') >= 0 || src.indexOf('disabled') >= 0 || src.indexOf('_dn') >= 0) nextEnabled = false;
        var computedOpacity = window.getComputedStyle(nextBtn).opacity;
        if (parseFloat(computedOpacity) < 0.5) nextEnabled = false;
      }
      if (newStores.length === 0 && accumulated.length > 0) nextEnabled = false;

      if (nextEnabled) {
        showToast('Page ' + currentPage + ': ' + pageStores.length + ' stores (' + newStores.length + ' new)<br>Total: <strong>' + accumulated.length + '</strong><br>Auto-clicking Next...', '#3b82f6', true);
        nextBtn.click();
        setTimeout(function() { doScrape(); }, 3000);
      } else {
        // Done scraping — send all data to extension
        if (accumulated.length === 0) {
          chrome.runtime.sendMessage({ type: 'scrape-error', source: 'websnak', message: 'No stores found.' });
          return;
        }

        // Build Python-dict format string (same as the app expects)
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

        var toast = document.getElementById('ws-scrape-toast');
        if (toast) {
          toast.style.background = '#22c55e';
          toast.innerHTML = 'Scraped <strong>' + accumulated.length + '</strong> stores! Sending to Map Tracker...';
          setTimeout(function() { toast.remove(); }, 5000);
        }

        chrome.runtime.sendMessage({
          type: 'scrape-done',
          source: 'websnak',
          data: pyLines.join('\n'),
          count: accumulated.length,
        });

        sessionStorage.removeItem(K);
      }
    }, 500);
  }

  sessionStorage.removeItem(K);
  doScrape();
})();

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import cityCoords from '../data/cityCoords';
import { geocodeAddress } from '../utils/geocodeAddress';
import { parseTransactions, matchCustomerToStore } from '../services/daoTransactionParser';
import { saveMapSnapshot } from '../services/githubService';
import { getGrade, getLatestDate, getDaysSinceVisit, getStatusCounts } from '../utils/driverMetrics';

// Known city names from cityCoords for address parsing
const KNOWN_CITIES = Object.keys(cityCoords).map(k => {
  const [city] = k.split(', ');
  return city;
});

// Geocode using cityCoords with spiral offset for multiple stores in same city
const geocodeCounter = {};
function geocodeCity(city, state) {
  if (!city) return { lat: 0, lng: 0 };
  const key = `${city.toUpperCase()}, ${state.toUpperCase()}`;
  const coords = cityCoords[key];
  if (!coords) return { lat: 0, lng: 0 };

  geocodeCounter[key] = (geocodeCounter[key] || 0) + 1;
  const offset = (geocodeCounter[key] - 1) * 0.003;
  const angle = (geocodeCounter[key] * 137.5 * Math.PI) / 180;
  return {
    lat: coords[0] + offset * Math.cos(angle),
    lng: coords[1] + offset * Math.sin(angle),
  };
}

// City-to-region mapping
const cityRegionMap = {
  'BALTIMORE': { region: 'Baltimore City', territory: 'Baltimore City', sub: 'Baltimore City' },
  'CHESTERTOWN': { region: 'Eastern Shore Maryland', territory: 'Chestertown', sub: 'Upper Shore' },
  'OCEAN CITY': { region: 'Eastern Shore Maryland', territory: 'Ocean City', sub: 'Ocean City & Coastal' },
  'BERLIN': { region: 'Eastern Shore Maryland', territory: 'Berlin', sub: 'Ocean City & Coastal' },
  'DENTON': { region: 'Eastern Shore Maryland', territory: 'Denton', sub: 'Upper Shore' },
  'STERLING': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'LEESBURG': { region: 'Northern Virginia', territory: 'Loudoun County', sub: 'Loudoun County' },
  'SALISBURY': { region: 'Eastern Shore Maryland', territory: 'Salisbury', sub: 'Lower Shore' },
  'FEDERALSBURG': { region: 'Eastern Shore Maryland', territory: 'Federalsburg', sub: 'Mid Shore' },
  'BRYANS ROAD': { region: "Charles County", territory: "Charles County", sub: "Charles County" },
  'NORTH EAST': { region: 'Cecil County', territory: 'Cecil County', sub: 'Cecil County' },
  'NOTTINGHAM': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'ROCKVILLE': { region: 'Montgomery County', territory: 'Montgomery County', sub: 'Montgomery County' },
  'MILLINGTON': { region: 'Eastern Shore Maryland', territory: 'Millington', sub: 'Upper Shore' },
  'SELBYVILLE': { region: 'Eastern Shore Delaware', territory: 'Selbyville', sub: 'Coastal Delaware' },
  'BRIDGEVILLE': { region: 'Eastern Shore Delaware', territory: 'Bridgeville', sub: 'Central Delaware' },
  'CENTREVILLE': { region: 'Eastern Shore Maryland', territory: 'Centerville', sub: 'Upper Shore' },
  'GLEN BURNIE': { region: 'Anne Arundel County', territory: 'Anne Arundel County', sub: 'Anne Arundel County' },
  'EDGEMERE': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'BETHANY BEACH': { region: 'Eastern Shore Delaware', territory: 'Bethany Beach', sub: 'Coastal Delaware' },
  'ABERDEEN': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'DUNDALK': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'WINCHESTER': { region: 'Shenandoah Valley', territory: 'Winchester', sub: 'Winchester' },
  'MARTINSBURG': { region: 'Eastern Panhandle WV', territory: 'Martinsburg', sub: 'Martinsburg' },
  'FRONT ROYAL': { region: 'Shenandoah Valley', territory: 'Front Royal', sub: 'Front Royal' },
  'STEPHENS CITY': { region: 'Shenandoah Valley', territory: 'Winchester', sub: 'Winchester' },
  'BERRYVILLE': { region: 'Shenandoah Valley', territory: 'Berryville', sub: 'Berryville' },
  'FORESTVILLE': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'ACCOKEEK': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'WASHINGTON': { region: 'Washington DC', territory: 'Washington DC', sub: 'Washington DC' },
  'CLINTON': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'LARGO': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'BOWIE': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'LAUREL': { region: "Prince George's County", territory: "Prince George's County", sub: "Prince George's County" },
  'ESSEX': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'PIKESVILLE': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'TOWSON': { region: 'Baltimore County', territory: 'Baltimore County', sub: 'Baltimore County' },
  'ELKTON': { region: 'Cecil County', territory: 'Cecil County', sub: 'Cecil County' },
  'BEL AIR': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'HAVRE DE GRACE': { region: 'Harford County', territory: 'Harford County', sub: 'Harford County' },
  'COLUMBIA': { region: 'Howard County', territory: 'Howard County', sub: 'Howard County' },
  'ELLICOTT CITY': { region: 'Howard County', territory: 'Howard County', sub: 'Howard County' },
  'FREDERICK': { region: 'Frederick County', territory: 'Frederick County', sub: 'Frederick County' },
  'EASTON': { region: 'Eastern Shore Maryland', territory: 'Easton', sub: 'Mid Shore' },
  'CAMBRIDGE': { region: 'Eastern Shore Maryland', territory: 'Cambridge', sub: 'Mid Shore' },
  'DOVER': { region: 'Eastern Shore Delaware', territory: 'Dover', sub: 'Dover Area' },
  'DUMFRIES': { region: 'Northern Virginia', territory: 'Prince William County', sub: 'Prince William County' },
  'MANASSAS': { region: 'Northern Virginia', territory: 'Prince William County', sub: 'Prince William County' },
  'WALDORF': { region: 'Charles County', territory: 'Charles County', sub: 'Charles County' },
  'LA PLATA': { region: 'Charles County', territory: 'Charles County', sub: 'Charles County' },
  'HANCOCK': { region: 'Western Maryland', territory: 'Hancock', sub: 'Hancock' },
};

function getRegionInfo(city) {
  return cityRegionMap[city.toUpperCase()] || { region: 'Unassigned', territory: 'Unassigned', sub: 'Unassigned' };
}

/** Parse Python-format or JSON stores list into JS objects */
function parsePythonFeed(text) {
  // Try JSON first (double-quoted keys)
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const valid = arr.filter(s => s['Store Id']);
      if (valid.length > 0) return valid;
    } catch (e) {
      // fall through to Python regex parser
    }
  }

  const stores = [];
  // Match each dict: {'key': 'value', ...}
  const dictRegex = /\{([^}]+)\}/g;
  let match;

  while ((match = dictRegex.exec(text)) !== null) {
    const dictStr = match[1];
    const store = {};

    // Match key-value pairs: 'Key': 'Value' or 'Key': None or 'Key': True/False or 'Key': 123
    const kvRegex = /'([^']+)'\s*:\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|None|True|False)/g;
    let kv;

    while ((kv = kvRegex.exec(dictStr)) !== null) {
      const key = kv[1];
      const val = kv[2] !== undefined ? kv[2] : kv[3] !== undefined ? kv[3] : kv[4] !== undefined ? parseFloat(kv[4]) : null;

      // Map to True/False
      const rawAfterColon = dictStr.substring(kv.index + kv[1].length + 4).trimStart();
      if (rawAfterColon.startsWith('True')) store[key] = true;
      else if (rawAfterColon.startsWith('False')) store[key] = false;
      else if (rawAfterColon.startsWith('None')) store[key] = null;
      else store[key] = val;
    }

    if (store['Store Id']) {
      stores.push(store);
    }
  }

  return stores;
}

/** Parse combined address into components */
function parseAddress(raw) {
  if (!raw || raw === ', .' || raw.trim().length < 3) {
    return { street: '', city: '', state: '', zip: '' };
  }

  // Extract state and zip: look for ", STATE. ZIP" pattern
  const stateMatch = raw.match(/,\s*([A-Za-z\s]+?)\.\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (!stateMatch) return { street: raw, city: '', state: '', zip: '' };

  let state = stateMatch[1].trim();
  if (state.toLowerCase() === 'maryland') state = 'MD';
  const zip = (stateMatch[2] || '').trim();

  // Everything before ", STATE." is street + city
  const beforeState = raw.substring(0, stateMatch.index).trim();

  // Try to find a known city at the end of beforeState
  const upperBefore = beforeState.toUpperCase();
  let foundCity = '';
  let street = beforeState;

  // Sort cities by length (longest first) to match multi-word cities first
  const sortedCities = [...KNOWN_CITIES].sort((a, b) => b.length - a.length);

  for (const city of sortedCities) {
    if (upperBefore.endsWith(city)) {
      const idx = upperBefore.lastIndexOf(city);
      // Make sure there's a space or start before the city name
      if (idx === 0 || beforeState[idx - 1] === ' ') {
        foundCity = beforeState.substring(idx);
        street = beforeState.substring(0, idx).trim();
        break;
      }
    }
  }

  // If no known city found, try the last word(s) before state
  if (!foundCity) {
    // Try last 2 words then last 1 word
    const words = beforeState.split(/\s+/);
    if (words.length >= 2) {
      const lastTwo = words.slice(-2).join(' ');
      if (cityRegionMap[lastTwo.toUpperCase()]) {
        foundCity = lastTwo;
        street = words.slice(0, -2).join(' ');
      }
    }
    if (!foundCity && words.length >= 1) {
      foundCity = words[words.length - 1];
      street = words.slice(0, -1).join(' ');
    }
  }

  return { street, city: foundCity, state, zip };
}

/** Convert MM/DD/YYYY to YYYY-MM-DD */
function parseLastSale(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function detectStoreType(name, id) {
  const n = (name || '').toLowerCase();
  if ((id || '').startsWith('CMW') || n.includes('commissary')) return 'military';
  if (n.includes('food lion')) return 'food-lion';
  if (n.includes('shoppers') || n.includes('shop rite')) return 'shoppers';
  if (n.includes('giant') || n.includes('martin')) return 'giant-martins';
  if (n.includes('weis')) return 'weis';
  if (n.includes('redner')) return 'redners';
  if (n.includes('acme')) return 'acme';
  return 'other';
}

export default function DataImport() {
  const { state, bulkImportStores, addImportEntry, setTransactions } = useApp();
  const { stores, importLog } = state;
  const transactions = state.transactions || [];

  const [rawInput, setRawInput] = useState('');
  const [parsed, setParsed] = useState(null);
  const [applied, setApplied] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState(null); // id of expanded log entry

  // Transaction import state
  const [txImporting, setTxImporting] = useState(false);
  const [txImportError, setTxImportError] = useState('');
  const [txDragOver, setTxDragOver] = useState(false);
  const [showTxSetup, setShowTxSetup] = useState(false);
  const [txSyncResult, setTxSyncResult] = useState(null);
  const txFileInputRef = useRef(null);
  const storeFileInputRef = useRef(null);

  // Publish Map state
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  // Chrome extension auto-import banner
  const [extImportResult, setExtImportResult] = useState(null);

  // Store lookup
  const storeMap = useMemo(() => {
    const map = {};
    stores.forEach(s => { map[s.id] = s; });
    return map;
  }, [stores]);

  // Listen for Chrome extension postMessage imports
  const handleExtensionImport = useCallback((event) => {
    if (event.data?.type !== 'MAP_TRACKER_IMPORT') return;
    const { source, data } = event.data;

    if (source === 'dao') {
      // DAO transaction import — same as txProcessFileData but with raw data
      let txData;
      try {
        txData = typeof data === 'string' ? JSON.parse(data) : data;
      } catch {
        setExtImportResult({ ok: false, message: 'Invalid DAO transaction data from extension.' });
        return;
      }
      if (!Array.isArray(txData) || txData.length === 0) {
        setExtImportResult({ ok: false, message: 'No transaction data received from extension.' });
        return;
      }
      const newIds = new Set(txData.map(d => d.id).filter(Boolean));
      const kept = transactions.filter(t => !t.id || !newIds.has(t.id));
      const merged = [...kept, ...txData];
      setTransactions(merged);

      // Auto-sync last sale dates from the new transactions
      const parsed = parseTransactions(txData);
      const invoices = parsed.filter(t => t.docType === 'Invoice' && !t.isVoid && (t.amount || 0) > 0);
      const latestByStore = {};
      for (const tx of invoices) {
        const store = matchCustomerToStore(tx.custName, tx.custNum, stores);
        if (!store) continue;
        const date = tx.settlementDate || tx.docDate?.date;
        if (!date) continue;
        if (!latestByStore[store.id] || date > latestByStore[store.id]) {
          latestByStore[store.id] = date;
        }
      }
      const updates = [];
      for (const [storeId, date] of Object.entries(latestByStore)) {
        const store = stores.find(s => s.id === storeId);
        if (!store) continue;
        if (!store.lastSaleDate || date > store.lastSaleDate) {
          updates.push({ id: storeId, lastSaleDate: date });
        }
      }
      if (updates.length > 0) bulkImportStores(updates, []);

      // Log the import
      const dates = parsed.map(t => t.settlementDate || t.docDate?.date || '').filter(Boolean).sort();
      const routes = [...new Set(parsed.map(t => t.route).filter(Boolean))].sort();
      addImportEntry({
        importType: 'transactions',
        totalInFeed: txData.length,
        parsedCount: parsed.length,
        newRecords: txData.length - (transactions.length - kept.length),
        duplicatesSkipped: transactions.length - kept.length,
        dateRange: dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : '',
        routes,
      });

      setExtImportResult({
        ok: true,
        message: `Imported ${txData.length} DAO transactions. Updated last sale on ${updates.length} store${updates.length !== 1 ? 's' : ''}.`,
      });
    }

    if (source === 'websnak') {
      // WebSnak store import — set the textarea content and trigger parse
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      setRawInput(text);
      setApplied(false);
      setParsed(null);
      // Notify user to review and apply
      setExtImportResult({
        ok: true,
        message: `Received ${typeof data === 'string' ? 'store' : ''} data from WebSnak. Review below and click "Apply" to import.`,
      });
    }
  }, [transactions, stores, setTransactions, bulkImportStores, addImportEntry]);

  useEffect(() => {
    window.addEventListener('message', handleExtensionImport);
    return () => window.removeEventListener('message', handleExtensionImport);
  }, [handleExtensionImport]);

  async function handleParse() {
    setApplied(false);
    const feedStores = parsePythonFeed(rawInput);

    if (feedStores.length === 0) {
      setParsed({ error: 'No stores found. Make sure the data is in the Python dict format.' });
      return;
    }

    const updates = [];
    const additions = [];
    const skipped = [];

    for (const fs of feedStores) {
      const id = fs['Store Id'];
      const name = fs['Name'] || '';
      const route = String(fs['Route/Jobber'] || '');
      const lastSale = parseLastSale(fs['Last Sale'] || '');
      const address = fs['Address'] || '';
      const existing = storeMap[id];

      if (existing) {
        // Update existing store
        const changes = {};
        if (lastSale && lastSale > (existing.lastSaleDate || '')) {
          changes.lastSaleDate = lastSale;
        }
        if (Object.keys(changes).length > 0) {
          updates.push({ id, ...changes, _displayName: existing.name });
        } else {
          skipped.push({ id, name: existing.name, reason: 'Already current' });
        }
      } else {
        // New store - try address-level geocoding first, fall back to city
        const addr = parseAddress(address);
        const region = getRegionInfo(addr.city);
        let coords = await geocodeAddress(addr.street, addr.city, addr.state, addr.zip);
        if (!coords) coords = geocodeCity(addr.city, addr.state);
        additions.push({
          id,
          storeNumber: id,
          name,
          address: addr.street,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          routeNumber: route,
          driver: `Route ${route} Driver`,
          region: region.region,
          territory: region.territory,
          subTerritory: region.sub,
          lat: coords.lat,
          lng: coords.lng,
          lastSaleDate: lastSale || null,
          lastVisited: null,
          type: detectStoreType(name, id),
          zoneId: null,
          subZoneId: null,
        });
      }
    }

    setParsed({ updates, additions, skipped, total: feedStores.length });
  }

  function handleApply() {
    if (!parsed || parsed.error) return;
    bulkImportStores(parsed.updates, parsed.additions);

    // Build import log entry
    const logStores = [
      ...parsed.updates.map(u => ({ id: u.id, name: u._displayName || u.id, date: u.lastSaleDate, type: 'update' })),
      ...parsed.additions.map(a => ({ id: a.id, name: a.name, date: a.lastSaleDate, type: 'new' })),
    ];
    addImportEntry({
      totalInFeed: parsed.total,
      updatedCount: parsed.updates.length,
      addedCount: parsed.additions.length,
      skippedCount: parsed.skipped.length,
      stores: logStores,
    });

    setApplied(true);
  }

  function handleClear() {
    setRawInput('');
    setParsed(null);
    setApplied(false);
  }

  // --- Transaction Import ---
  const txParsed = useMemo(() => parseTransactions(transactions), [transactions]);

  const bookmarkletCode = `javascript:void(async function(){function T(m,c){var t=document.getElementById('dao-scrape-toast');if(!t){t=document.createElement('div');t.id='dao-scrape-toast';t.style.cssText='position:fixed;top:20px;right:20px;padding:16px 24px;border-radius:8px;font-size:16px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);color:%23fff;max-width:400px';document.body.appendChild(t)}t.style.background=c||'%233b82f6';t.textContent=m}var hc=[];for(var tr of document.querySelectorAll('tr')){var ths=Array.from(tr.children).filter(function(c){return c.tagName==='TH'});if(ths.length<8)continue;var tx=ths.map(function(h){return h.textContent.trim()});if(tx.join(' ').includes('Document Type')&&(tx.join(' ').includes('Route')||tx.join(' ').includes('Cust'))){hc=tx;break}}if(!hc.length){alert('Could not find column headers. Make sure search results are loaded.');return}function gdr(){var r=Array.from(document.querySelectorAll('tr.rgRow,tr.rgAltRow'));if(r.length>0)return r;var bt=null,bc=0;for(var tbl of document.querySelectorAll('table')){var c=0;for(var tr of tbl.rows){if(tr.cells.length>=10&&!tr.querySelector('th'))c++}if(c>bc){bc=c;bt=tbl}}if(bt)r=Array.from(bt.rows).filter(function(tr){return tr.cells.length>=10&&!tr.querySelector('th')});return r}var fm={'Branch':'branch','Route':'route','Cust. Num.':'custNum','Cust. Name':'custName','Document Type':'docType','ID':'id','Document Date':'docDate','Settlement Date':'settlementDate','Amount':'amount','Delivery Amount':'deliveryAmount','Delivery Difference':'deliveryDifference','Invoice Type':'invoiceType','Void':'void','DSD':'dsd','Store Stamp':'storeStamp','DSD Store Stamp':'dsd','Doc Missing':'docMissing'};var cm={};hc.forEach(function(h,i){if(fm[h])cm[fm[h]]=i;else for(var k in fm){if(h.toLowerCase().includes(k.toLowerCase())&&!cm[fm[k]]){cm[fm[k]]=i;break}}});var kdt=['Invoice','Settle','Load','Truck Inventory','Route Order','Delivery'];function ex(rows,off){var d=[];for(var row of rows){var cells=row.cells||row.querySelectorAll('td');var rec={},ne=0;for(var f in cm){var ai=cm[f]+off;if(ai>=0&&ai<cells.length){var v=cells[ai].textContent.trim();if(['amount','deliveryAmount','deliveryDifference'].includes(f)){v=v.replace(/[\\$,]/g,'');var n=parseFloat(v);rec[f]=isNaN(n)?0:n;if(!isNaN(n)&&n!==0)ne++}else{rec[f]=v;if(v)ne++}}}if(ne>=3)d.push(rec)}return d}var bo=0,bs=0;var tRows=gdr();if(!tRows.length){alert('No data rows found.');return}for(var off=0;off<=3;off++){var sc=0;var sa=ex(tRows.slice(0,10),off);for(var r of sa){if(kdt.includes(r.docType))sc+=2;if(r.route&&/^\\d{5,6}$/.test(r.route))sc++;if(r.custName&&r.custName.length>2)sc++}if(sc>bs){bs=sc;bo=off}}var allData=ex(gdr(),bo);var tp=0;var pim=document.body.innerText.match(/(\\d+)\\s*items?\\s*in\\s*(\\d+)\\s*pages?/i);if(pim)tp=parseInt(pim[2]);if(!tp){var mv=1;for(var a of document.querySelectorAll('a[href*="Page"]')){var m=a.href&&a.href.match(/Page\\$(\\d+)/);if(m)mv=Math.max(mv,parseInt(m[1]))}for(var a of document.querySelectorAll('.rgNumPart a,.rgPager a')){var n=parseInt(a.textContent.trim());if(!isNaN(n))mv=Math.max(mv,n)}var hmi=false;for(var el of document.querySelectorAll('a,input[type=submit],input[type=button],button')){var et=(el.textContent||el.value||'').trim();if(et==='...'||et==='>'||et==='>>'||et==='>|'||et.toLowerCase()==='next'){hmi=true;break}}tp=hmi?mv*10:mv}T('Page 1/'+(tp>50?'?':tp)+' - '+allData.length+' rows');function gfrt(){var r=gdr();if(!r.length)return'';return Array.from(r[0].cells).map(function(c){return c.textContent.trim()}).join('|')}async function wfc(ot,ms){var t0=Date.now();while(Date.now()-t0<ms){await new Promise(function(r){setTimeout(r,400)});var c=gfrt();if(c&&c!==ot)return true}return false}for(var p=2;p<=tp;p++){var ot=gfrt();var lk=document.querySelector('a[title="Page '+p+'"]');if(!lk){for(var a of document.querySelectorAll('.rgNumPart a,.rgPager a')){if(a.textContent.trim()===String(p)){lk=a;break}}}if(!lk){for(var a of document.querySelectorAll('a[href*="Page"]')){if(a.href&&(a.href.includes('Page$'+p+"'")||a.href.includes('Page%24'+p))){lk=a;break}}}if(!lk){for(var a of document.querySelectorAll('a')){var et=a.textContent.trim();if(et==='...'||et==='\\u2026'){a.click();await new Promise(function(r){setTimeout(r,2000)});lk=document.querySelector('a[title="Page '+p+'"]');if(!lk){for(var a2 of document.querySelectorAll('a')){if(a2.textContent.trim()===String(p)){lk=a2;break}}}break}}}if(!lk){var ns=['.rgArrPart2 a[title="Next Pages"]','.rgArrPart2 a[title="Next Page"]','.rgArrPart2 a','a[title="Next Pages"]','a[title="Next Page"]','a[title="Next"]','input[title="Next Pages"]','input[title="Next Page"]'];for(var sel of ns){var el=document.querySelector(sel);if(el&&!el.classList.contains('rgDisabled')&&!el.disabled){lk=el;break}}}if(!lk){for(var el of document.querySelectorAll('input[type=submit],input[type=button]')){var v=(el.value||'').trim();if(!el.disabled&&(v==='>'||v==='\\u203A'||v==='\\u00BB'||v==='>>')){lk=el;break}}}if(!lk)break;T('Loading page '+p+'/'+(tp>50?'?':tp)+'...');lk.click();var ch=await wfc(ot,15000);if(!ch){var pl=document.querySelector('a[title="Page '+p+'"]');if(pl){pl.click();ch=await wfc(ot,10000)}}if(!ch)break;var pd=ex(gdr(),bo);allData=allData.concat(pd);T('Page '+p+'/'+(tp>50?'?':tp)+' - '+allData.length+' total')}if(!allData.length){alert('No transaction data found.');return}var json=JSON.stringify(allData);var blob=new Blob([json],{type:'text/plain'});var url=URL.createObjectURL(blob);var a=document.createElement('a');var now=new Date();a.href=url;a.download='dao-transactions-'+now.getFullYear()+('0'+(now.getMonth()+1)).slice(-2)+('0'+now.getDate()).slice(-2)+'.txt';a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(url)},2000);T('Downloaded '+allData.length+' transactions!','%2322c55e');setTimeout(function(){var el=document.getElementById('dao-scrape-toast');if(el)el.remove()},5000)}())`;
  const websnakBookmarklet = `javascript:void(function(){var K='websnak-scraper-data';function toast(m,c,p){var td=(window.top||window).document;var t=td.getElementById('ws-scrape-toast');if(!t){t=td.createElement('div');t.id='ws-scrape-toast';t.style.cssText='position:fixed;top:20px;right:20px;padding:16px 24px;border-radius:8px;font-size:15px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3);color:%23fff;max-width:500px;line-height:1.4';td.body.appendChild(t)}t.style.background=c||'%233b82f6';t.innerHTML=m;if(!p)setTimeout(function(){t.remove()},8000)}function scrape(){var ad=null;try{var gE=document.querySelectorAll('.ag-root-wrapper,[class*=ag-root]');for(var gi=0;gi<gE.length;gi++){var comp=gE[gi].__agComponent||gE[gi]._agComponent;if(comp){var api=comp.gridApi||comp.api||(comp.gridOptions&&comp.gridOptions.api);if(api&&api.forEachNode){ad=[];api.forEachNode(function(n){if(n.data)ad.push(n.data)});console.log('AG API: '+ad.length+' rows');break}}}}catch(e){}var ps=[];if(ad&&ad.length>0){for(var i=0;i<ad.length;i++){var d=ad[i];var sid=d['STOREID']||d['Store Id']||d['StoreId']||d['storeId']||'';if(sid)ps.push({'Store Id':String(sid),'Name':String(d['NAME']||d['Name']||d['name']||''),'Route/Jobber':String(d['ROUTENUM']||d['Route/Jobber']||d['RouteJobber']||''),'Address':String(d['SRCHADDRESS']||d['Address']||d['ADDRESS']||''),'Last Sale':String(d['LASTSALESDATE']||d['Last Sale']||d['LastSale']||'')})}}else{var hC=document.querySelectorAll('.ag-header-cell');var cM={};for(var hi=0;hi<hC.length;hi++){var cid=hC[hi].getAttribute('col-id')||'';var ts=hC[hi].querySelector('.ag-header-cell-text');if(cid&&ts)cM[cid]=ts.textContent.trim()}var rows=document.querySelectorAll('.ag-row');for(var ri=0;ri<rows.length;ri++){var rC=rows[ri].querySelectorAll('.ag-cell');var s={};for(var ci=0;ci<rC.length;ci++){var cc=rC[ci].getAttribute('col-id')||'';s[cM[cc]||cc]=rC[ci].textContent.trim()}var si=s['Store Id']||s['Store ID']||s['StoreId']||'';if(si)ps.push({'Store Id':si,'Name':s['Name']||'','Route/Jobber':s['Route/Jobber']||'','Address':s['Address']||'','Last Sale':s['Last Sale']||''})}}return ps}function run(){var ps=scrape();if(!ps.length){toast('No store rows found. Make sure the Search List tab is active.','%23ef4444');return}var ac=[];try{var rw=sessionStorage.getItem(K);if(rw)ac=JSON.parse(rw)}catch(e){}var ex=new Set(ac.map(function(s){return s['Store Id']}));var nw=ps.filter(function(s){return!ex.has(s['Store Id'])});ac=ac.concat(nw);sessionStorage.setItem(K,JSON.stringify(ac));var pm=document.body.innerText.match(/Page:\\s*(\\d+)/);var cp=pm?parseInt(pm[1]):'?';toast('Page '+cp+': '+ps.length+' stores ('+nw.length+' new)<br>Total: <b>'+ac.length+'</b>. Checking next...','%233b82f6',true);setTimeout(function(){var nb=document.getElementById('cmdNxt');var ne=false;if(nb){ne=true;if(nb.style.visibility==='hidden'||nb.style.display==='none')ne=false;var sr=(nb.src||'').toLowerCase();if(sr.indexOf('grey')>=0||sr.indexOf('gray')>=0||sr.indexOf('disabled')>=0||sr.indexOf('_dn')>=0)ne=false;var co=window.getComputedStyle(nb).opacity;if(parseFloat(co)<0.5)ne=false}if(nw.length===0&&ac.length>0)ne=false;console.log('Page '+cp+': '+nw.length+' new, next='+ne+(nb?' vis='+nb.style.visibility:'(no btn)'));if(ne){toast('Page '+cp+': '+ps.length+' stores ('+nw.length+' new)<br>Total: <b>'+ac.length+'</b><br>Auto-clicking Next...','%233b82f6',true);nb.click();setTimeout(function(){run()},3000)}else{if(!ac.length){toast('No stores found.','%23ef4444');return}console.log('Last page. Downloading '+ac.length+' stores...');var L=['['];for(var i=0;i<ac.length;i++){var s=ac[i];var rv=parseInt(s['Route/Jobber']);var rr=isNaN(rv)?"'"+s['Route/Jobber']+"'":String(rv);L.push("    {'Store Id': '"+s['Store Id']+"', 'Name': '"+(s['Name']||'').replace(/'/g,"\\\\'")+"', 'Route/Jobber': "+rr+", 'Address': '"+(s['Address']||'').replace(/'/g,"\\\\'")+"', 'Last Sale': '"+(s['Last Sale']||'')+"'}"+(i<ac.length-1?',':''))}L.push(']');var py=L.join('\\n');try{var blob=new Blob([py],{type:'text/plain'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;var dd=new Date();a.download='websnak-stores-'+dd.getFullYear()+('0'+(dd.getMonth()+1)).slice(-2)+('0'+dd.getDate()).slice(-2)+'.txt';a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){a.remove();URL.revokeObjectURL(url)},2000);toast('Done! <b>'+ac.length+'</b> stores downloaded!','%2322c55e',true);console.log('Download triggered: '+a.download)}catch(e){console.log('Download failed:',e);navigator.clipboard.writeText(py).then(function(){toast('Done! <b>'+ac.length+'</b> stores copied to clipboard!','%2322c55e',true)}).catch(function(){prompt('Copy this data:',py)})}sessionStorage.removeItem(K)}},500)}console.log('WebSnak v6 auto-paginating scraper');sessionStorage.removeItem(K);run()}())`;

  function txProcessFileData(text) {
    setTxImporting(true);
    setTxImportError('');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setTxImportError('File does not contain valid JSON. Make sure you exported it using the DAO bookmarklet.');
      setTxImporting(false);
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      setTxImportError('No transaction data found in the file.');
      setTxImporting(false);
      return;
    }
    const newIds = new Set(data.map(d => d.id).filter(Boolean));
    const kept = transactions.filter(t => !t.id || !newIds.has(t.id));
    const merged = [...kept, ...data];
    setTransactions(merged);

    // Log the transaction import
    const parsed = parseTransactions(data);
    const dates = parsed.map(t => t.settlementDate || t.docDate?.date || '').filter(Boolean).sort();
    const routes = [...new Set(parsed.map(t => t.route).filter(Boolean))].sort();
    addImportEntry({
      importType: 'transactions',
      totalInFeed: data.length,
      parsedCount: parsed.length,
      newRecords: data.length - (transactions.length - kept.length),
      duplicatesSkipped: transactions.length - kept.length,
      dateRange: dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : '',
      routes,
    });

    setTxImportError('');
    setTxImporting(false);
  }

  function txHandleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => txProcessFileData(reader.result);
    reader.onerror = () => { setTxImportError('Failed to read file.'); };
    reader.readAsText(file);
    e.target.value = '';
  }

  function txHandleDrop(e) {
    e.preventDefault();
    setTxDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => txProcessFileData(reader.result);
    reader.onerror = () => { setTxImportError('Failed to read file.'); };
    reader.readAsText(file);
  }

  function syncLastSaleFromTransactions() {
    if (stores.length === 0 || txParsed.length === 0) return;
    const invoices = txParsed.filter(t => t.docType === 'Invoice' && !t.isVoid && (t.amount || 0) > 0);
    const latestByStore = {};
    for (const tx of invoices) {
      const store = matchCustomerToStore(tx.custName, tx.custNum, stores);
      if (!store) continue;
      const date = tx.settlementDate || tx.docDate?.date;
      if (!date) continue;
      if (!latestByStore[store.id] || date > latestByStore[store.id]) {
        latestByStore[store.id] = date;
      }
    }
    const updates = [];
    for (const [storeId, date] of Object.entries(latestByStore)) {
      const store = stores.find(s => s.id === storeId);
      if (!store) continue;
      if (!store.lastSaleDate || date > store.lastSaleDate) {
        updates.push({ id: storeId, lastSaleDate: date });
      }
    }
    if (updates.length > 0) bulkImportStores(updates, []);
    setTxSyncResult({ updated: updates.length, total: Object.keys(latestByStore).length });
  }

  async function publishMap() {
    setPublishing(true);
    setPublishResult(null);
    try {
      // Build route metrics
      const routeMap = {};
      stores.forEach(s => {
        const r = s.routeNumber || '0';
        if (r === '0') return;
        if (!routeMap[r]) routeMap[r] = [];
        routeMap[r].push(s);
      });

      const routes = Object.entries(routeMap).map(([number, routeStores]) => {
        const counts = getStatusCounts(routeStores);
        const active = routeStores.length - counts.never - counts.dormant;
        const coverage = active > 0 ? (counts.onTrack / active) * 100 : 0;
        const grade = getGrade(coverage);
        return { number, grade: grade.letter, color: grade.color, coverage, storeCount: routeStores.length };
      });

      // Build snapshot
      const snapshot = {
        publishedAt: new Date().toISOString(),
        stores: stores.map(s => ({
          id: s.id, name: s.name, lat: s.lat, lng: s.lng,
          routeNumber: s.routeNumber || '0', type: s.type || 'other',
          address: s.address || '', city: s.city || '', state: s.state || '',
          lastVisited: getLatestDate(s) || '',
        })),
        routes,
        zones: (state.zones || []).map(z => ({
          id: z.id, name: z.name, color: z.color, bounds: z.bounds,
        })),
        subZones: (state.zones || []).flatMap(z =>
          (z.subZones || []).map(sz => ({
            id: sz.id, name: sz.name, color: sz.color, bounds: sz.bounds, parentZoneId: z.id,
          }))
        ),
      };

      await saveMapSnapshot(JSON.stringify(snapshot, null, 2));
      setPublishResult({ ok: true, count: stores.length, time: new Date().toLocaleTimeString() });
    } catch (e) {
      setPublishResult({ ok: false, error: e.message });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="data-import-page">
      <div className="data-import-header">
        <h2>Data Import</h2>
        <p className="data-import-desc">
          Paste Python-format store feed data to update last sale dates and add new stores.
        </p>
      </div>

      {/* Extension import result banner */}
      {extImportResult && (
        <div
          className={extImportResult.ok ? 'data-import-success' : 'data-import-error'}
          style={{ marginBottom: 12, cursor: 'pointer' }}
          onClick={() => setExtImportResult(null)}
        >
          {extImportResult.message} {' '}&times;
        </div>
      )}

      {/* Transaction Import Section */}
      <div className="data-import-geocode-section">
        <h3>Transaction Import (DAO Dashboard)</h3>
        <p className="data-import-desc" style={{ margin: '4px 0 10px' }}>
          Import weekly transaction data from the DAO Dashboard.
          {transactions.length > 0 && ` (${transactions.length} records, ${txParsed.length} parsed)`}
        </p>
        <input
          ref={txFileInputRef}
          type="file"
          accept=".txt,.json"
          onChange={txHandleFileSelect}
          style={{ display: 'none' }}
        />
        <div className="data-import-actions">
          <button className="btn btn-primary" onClick={() => txFileInputRef.current?.click()} disabled={txImporting}>
            {txImporting ? 'Importing...' : 'Import File'}
          </button>
          {txParsed.length > 0 && (
            <button className="btn btn-primary" onClick={syncLastSaleFromTransactions}
              title="Update each store's Last Sale date from the most recent Invoice in this transaction data">
              Sync Last Sale
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowTxSetup(s => !s)}>
            {showTxSetup ? 'Hide Setup' : 'Setup'}
          </button>
        </div>
        {txImportError && <div className="data-import-error" style={{ marginTop: 8 }}>{txImportError}</div>}
        {txSyncResult && (
          <div className="data-import-success" style={{ marginTop: 8, cursor: 'pointer' }} onClick={() => setTxSyncResult(null)}>
            {txSyncResult.updated > 0
              ? `Last Sale updated on ${txSyncResult.updated} store${txSyncResult.updated !== 1 ? 's' : ''} (${txSyncResult.total} matched from transactions)`
              : `No updates needed — all ${txSyncResult.total} matched stores already have current dates`}
            {' '}✕
          </div>
        )}
        {showTxSetup && (
          <div className="data-import-success" style={{ marginTop: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>How to import transactions from DAO Dashboard</h4>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              <li>Go to the <a href="https://dashboard.daogroup.com/Dashboards/DocumentViewer/DocumentViewerForm4.aspx" target="_blank" rel="noopener noreferrer">DAO Document Viewer</a></li>
              <li>Set your date range and filters, then click Search</li>
              <li>Set <strong>Max Rows</strong> to a high number (e.g., 500) so all data loads on one page</li>
              <li>
                Drag this link to your bookmarks bar:{' '}
                <a style={{ color: '#2563eb', fontWeight: 600, cursor: 'pointer' }} href={bookmarkletCode} onClick={e => {
                  e.preventDefault();
                  navigator.clipboard.writeText(bookmarkletCode).then(() => alert('Bookmarklet copied to clipboard! Paste it as a new bookmark URL.'));
                }}>
                  DAO Scraper
                </a>
              </li>
              <li>Click the bookmarklet — it downloads a <strong>.txt file</strong> with the transaction data</li>
              <li>Come back here, click <strong>"Import File"</strong> and select the downloaded .txt file</li>
            </ol>
          </div>
        )}
        {transactions.length === 0 && (
          <div
            className={`tx-dropzone${txDragOver ? ' drag-over' : ''}`}
            style={{ marginTop: 10 }}
            onDragOver={e => { e.preventDefault(); setTxDragOver(true); }}
            onDragLeave={() => setTxDragOver(false)}
            onDrop={txHandleDrop}
            onClick={() => txFileInputRef.current?.click()}
          >
            <p>Drop a .txt file here or click to import</p>
            <p className="tx-dropzone-hint">Click <strong>"Setup"</strong> above for instructions on exporting from the DAO dashboard</p>
          </div>
        )}
      </div>

      <div className="data-import-input-section">
        <h3>Store Feed Import</h3>
        <p className="data-import-desc" style={{ margin: '0 0 8px' }}>
          Import store data from WebSnak.{' '}
          <a style={{ color: '#2563eb', fontWeight: 600, cursor: 'pointer' }} href={websnakBookmarklet} onClick={e => {
            e.preventDefault();
            navigator.clipboard.writeText(websnakBookmarklet).then(() => alert('WebSnak Scraper copied to clipboard! Create a new bookmark and paste as the URL.'));
          }}>
            Copy WebSnak Scraper
          </a>
        </p>
        <input
          ref={storeFileInputRef}
          type="file"
          accept=".txt"
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => { setRawInput(reader.result); setApplied(false); setParsed(null); };
            reader.readAsText(file);
            e.target.value = '';
          }}
          style={{ display: 'none' }}
        />
        <div className="data-import-actions" style={{ marginBottom: 8 }}>
          <button className="btn btn-primary" onClick={() => storeFileInputRef.current?.click()} disabled={applied}>
            Import File
          </button>
        </div>
        <textarea
          className="data-import-textarea"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={`Or paste Python store data here, e.g.:\n\n[\n    {'Store Id': 'FLW00246', 'Name': 'FOOD LION 0246', 'Route/Jobber': 206, 'Address': '11801 COASTAL HWY OCEAN CITY, MD. 21842', 'Last Sale': '02/12/2026', ...},\n    ...\n]`}
          rows={10}
          disabled={applied}
        />
        <div className="data-import-actions">
          <button
            className="btn btn-primary"
            onClick={handleParse}
            disabled={!rawInput.trim() || applied}
          >
            Parse Data
          </button>
          {parsed && !parsed.error && !applied && (
            <button className="btn btn-success" onClick={handleApply}>
              Apply {parsed.updates.length + parsed.additions.length} Changes
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>

      {/* Parse error */}
      {parsed?.error && (
        <div className="data-import-error">{parsed.error}</div>
      )}

      {/* Applied success */}
      {applied && (
        <div className="data-import-success">
          Import complete! {parsed.updates.length} stores updated, {parsed.additions.length} new stores added.
          Changes will auto-sync to GitHub.
        </div>
      )}

      {/* Preview results */}
      {parsed && !parsed.error && (
        <div className="data-import-preview">
          <div className="data-import-summary">
            <div className="import-stat">
              <span className="import-stat-val">{parsed.total}</span>
              <span className="import-stat-label">Total in feed</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#3b82f6' }}>{parsed.updates.length}</span>
              <span className="import-stat-label">Updates</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#22c55e' }}>{parsed.additions.length}</span>
              <span className="import-stat-label">New stores</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-val" style={{ color: '#9ca3af' }}>{parsed.skipped.length}</span>
              <span className="import-stat-label">Skipped</span>
            </div>
          </div>

          {/* Updates table */}
          {parsed.updates.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title">Date Updates ({parsed.updates.length})</h3>
              <div className="import-table">
                <div className="import-table-header">
                  <span className="import-col-id">Store ID</span>
                  <span className="import-col-name">Name</span>
                  <span className="import-col-date">New Date</span>
                </div>
                {parsed.updates.map(u => (
                  <div key={u.id} className="import-table-row">
                    <span className="import-col-id">{u.id}</span>
                    <span className="import-col-name">{u._displayName}</span>
                    <span className="import-col-date">{u.lastSaleDate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New stores table */}
          {parsed.additions.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title">New Stores ({parsed.additions.length})</h3>
              <div className="import-table">
                <div className="import-table-header">
                  <span className="import-col-id">Store ID</span>
                  <span className="import-col-name">Name</span>
                  <span className="import-col-city">City</span>
                  <span className="import-col-route">Route</span>
                  <span className="import-col-date">Last Sale</span>
                </div>
                {parsed.additions.map(a => (
                  <div key={a.id} className="import-table-row import-row-new">
                    <span className="import-col-id">{a.id}</span>
                    <span className="import-col-name">{a.name}</span>
                    <span className="import-col-city">{a.city}, {a.state}</span>
                    <span className="import-col-route">{a.routeNumber}</span>
                    <span className="import-col-date">{a.lastSaleDate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skipped table */}
          {parsed.skipped.length > 0 && (
            <div className="import-section">
              <h3 className="import-section-title import-section-muted">Skipped ({parsed.skipped.length})</h3>
              <div className="import-table">
                {parsed.skipped.map(s => (
                  <div key={s.id} className="import-table-row import-row-skipped">
                    <span className="import-col-id">{s.id}</span>
                    <span className="import-col-name">{s.name}</span>
                    <span className="import-col-date">{s.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import History */}
      {importLog.length > 0 && (
        <div className="di-log-section">
          <h3 className="di-log-title">Import History ({importLog.length})</h3>
          <div className="di-log-list">
            {importLog.map((entry, idx) => {
              const isExpanded = expandedEntry === entry.id || (expandedEntry === null && idx === 0);
              const ts = new Date(entry.timestamp);
              const dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const timeStr = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const isTxImport = entry.importType === 'transactions';
              const lastStore = !isTxImport && entry.stores?.length > 0 ? entry.stores[entry.stores.length - 1] : null;

              return (
                <div key={entry.id} className="di-log-entry">
                  <div
                    className="di-log-entry-header"
                    onClick={() => setExpandedEntry(isExpanded ? '__none__' : entry.id)}
                  >
                    <div className="di-log-entry-left">
                      <span className={`al-chevron ${isExpanded ? 'expanded' : ''}`}>&#9654;</span>
                      <span className="di-log-entry-date">{dateStr} {timeStr}</span>
                      {isTxImport && <span className="di-log-pill" style={{ background: '#dbeafe', color: '#1e40af', marginLeft: 6 }}>Transactions</span>}
                      {!isTxImport && <span className="di-log-pill" style={{ background: '#dcfce7', color: '#166534', marginLeft: 6 }}>Store Feed</span>}
                    </div>
                    <div className="di-log-entry-pills">
                      {isTxImport ? (
                        <>
                          <span className="di-log-pill blue">{entry.totalInFeed} records</span>
                          {entry.parsedCount > 0 && <span className="di-log-pill green">{entry.parsedCount} parsed</span>}
                          {entry.duplicatesSkipped > 0 && <span className="di-log-pill gray">{entry.duplicatesSkipped} dupes</span>}
                        </>
                      ) : (
                        <>
                          {entry.updatedCount > 0 && <span className="di-log-pill blue">{entry.updatedCount} updated</span>}
                          {entry.addedCount > 0 && <span className="di-log-pill green">{entry.addedCount} new</span>}
                          {entry.skippedCount > 0 && <span className="di-log-pill gray">{entry.skippedCount} skipped</span>}
                          <span className="di-log-pill outline">{entry.totalInFeed} in feed</span>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded && isTxImport && (
                    <div className="di-log-entry-body">
                      <div className="di-log-last-banner">
                        {entry.dateRange && <><strong>Date range:</strong> {entry.dateRange}</>}
                        {entry.routes?.length > 0 && <> &nbsp;|&nbsp; <strong>Routes:</strong> {entry.routes.join(', ')}</>}
                      </div>
                    </div>
                  )}
                  {isExpanded && !isTxImport && entry.stores && (
                    <div className="di-log-entry-body">
                      {lastStore && (
                        <div className="di-log-last-banner">
                          Last entry: <strong>{lastStore.name}</strong> ({lastStore.id}) — {lastStore.date}
                        </div>
                      )}
                      <table className="di-log-table">
                        <thead>
                          <tr>
                            <th>Store ID</th>
                            <th>Name</th>
                            <th>Date</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.stores.map((s, si) => (
                            <tr key={s.id + si} className={si === entry.stores.length - 1 ? 'di-log-last-row' : ''}>
                              <td className="di-log-cell-id">{s.id}</td>
                              <td>{s.name}</td>
                              <td>{s.date}</td>
                              <td>
                                <span className={`di-log-type ${s.type}`}>
                                  {s.type === 'new' ? 'New' : 'Update'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Publish Map Section */}
      <div className="data-import-geocode-section" style={{ marginTop: 16 }}>
        <h3>Publish Map</h3>
        <p className="data-import-desc" style={{ margin: '4px 0 10px' }}>
          Publish a read-only map for coworkers. They can view it at:<br />
          <a href="https://mahpour4.github.io/Map-tracker/" target="_blank" rel="noopener noreferrer"
            style={{ color: '#3b82f6' }}>
            mahpour4.github.io/Map-tracker
          </a>
        </p>
        <div className="data-import-actions">
          <button className="btn btn-primary" onClick={publishMap} disabled={publishing || stores.length === 0}>
            {publishing ? 'Publishing...' : 'Publish Map'}
          </button>
        </div>
        {publishResult && publishResult.ok && (
          <div className="data-import-success" style={{ marginTop: 8, cursor: 'pointer' }} onClick={() => setPublishResult(null)}>
            Published {publishResult.count} stores at {publishResult.time}. Coworkers can refresh the page to see updates.
          </div>
        )}
        {publishResult && !publishResult.ok && (
          <div className="data-import-error" style={{ marginTop: 8 }}>
            Publish failed: {publishResult.error}
          </div>
        )}
        <p className="data-import-desc" style={{ margin: '8px 0 0', fontSize: 11, color: '#94a3b8' }}>
          First time? Enable GitHub Pages in repo Settings &rarr; Pages &rarr; Source: branch, folder: /docs
        </p>
      </div>
    </div>
  );
}

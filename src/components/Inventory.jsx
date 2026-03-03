import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { PRODUCT_CATALOG, PRODUCT_CATEGORIES } from '../data/productCatalog';
import seedInventory from '../data/inventoryData.json';

// Normalize SKU: strip leading zeros for comparison
const normSku = (sku) => String(parseInt(sku, 10));

// Build a lookup map: normalized SKU → catalog entry
const catalogByNormSku = Object.fromEntries(PRODUCT_CATALOG.map(p => [normSku(p.sku), p]));

export default function Inventory() {
  const { state, setInventory } = useApp();
  const { inventory, warehouseOrders } = state;
  const items = inventory?.items || {};
  const migrated = useRef(false);
  const lastReconciledOrders = useRef(null);
  const lastReconciledItems = useRef(null);

  // Migrate: if items lack deliveries OR seed data has been updated, re-merge from seed
  useEffect(() => {
    if (migrated.current || !inventory?.items) return;
    const entries = Object.values(inventory.items);
    const seedItems = seedInventory.items || {};
    const seedHasItems = Object.keys(seedItems).length > 0;
    const localEmpty = entries.length === 0;
    const seedOutdated = (inventory.seedVersion || 0) < (seedInventory.seedVersion || 0);
    // Populate from seed when: local is empty but seed has data, OR seed version bumped, OR deliveries missing
    if (localEmpty && !seedHasItems) return;
    if (!localEmpty && !seedOutdated) {
      const missingDeliveries = entries.some(it => !it.deliveries || it.deliveries.length === 0);
      if (!missingDeliveries) return;
    }
    migrated.current = true;
    // If seed is empty, do a full reset (clear all items)
    if (!seedHasItems) {
      setInventory({ ...inventory, items: {}, seedVersion: seedInventory.seedVersion || 0, customCatalog: seedInventory.customCatalog || [] });
      return;
    }
    const merged = {};
    // Start with all seed items (they have deliveries)
    for (const [sku, seedItem] of Object.entries(seedItems)) {
      const live = inventory.items[sku];
      merged[sku] = {
        ...seedItem,
        // Preserve any live sold/linkedSku/catalogEntry data
        sold: live?.sold ?? seedItem.sold ?? 0,
        linkedSku: live?.linkedSku || seedItem.linkedSku,
        catalogEntry: live?.catalogEntry || seedItem.catalogEntry,
      };
    }
    // Also keep any live items not in seed (user-added)
    for (const [sku, liveItem] of Object.entries(inventory.items)) {
      if (!merged[sku]) {
        merged[sku] = liveItem;
      }
    }
    setInventory({ ...inventory, items: merged, seedVersion: seedInventory.seedVersion || 0 });
  }, [inventory, setInventory]);

  // Reconcile: compute sold from all warehouse orders and sync with inventory
  const ordersRef = warehouseOrders?.orders;
  useEffect(() => {
    if (!inventory?.items || !ordersRef) return;

    // Build a fingerprint of linked SKUs so we re-reconcile when links change
    const linkFingerprint = Object.entries(inventory.items)
      .map(([k, v]) => `${k}:${v.linkedSku || ''}:${v.catalogEntry?.sku || ''}`)
      .join('|');

    // Skip if we already reconciled this exact orders array + link state (same render cycle)
    const ordersFingerprint = JSON.stringify((ordersRef || []).map(o => o.id + ':' + (o.updatedAt || o.createdAt)));
    if (lastReconciledOrders.current === ordersFingerprint && lastReconciledItems.current === linkFingerprint) return;
    lastReconciledOrders.current = ordersFingerprint;
    lastReconciledItems.current = linkFingerprint;

    const orders = ordersRef || [];

    // Build reverse lookup: catalog/linked SKU → inventory SKU
    // So order SKU "028441" can find inventory item "9928441" if it has linkedSku "028441"
    const linkedSkuMap = {}; // normalized linked/catalog SKU → inventory key
    for (const [invSku, item] of Object.entries(inventory.items)) {
      if (item.linkedSku) {
        linkedSkuMap[normSku(item.linkedSku)] = invSku;
      }
      if (item.catalogEntry?.sku) {
        linkedSkuMap[normSku(item.catalogEntry.sku)] = invSku;
      }
    }

    // Compute total cases sold per inventory SKU from all orders, tracking per line-item deductions
    const soldBySku = {};       // sku -> total cases
    const deductionsBySku = {}; // sku -> { "orderId:lineId": { orderId, lineId, sku, desc, cases, orderName, orderDate } }
    orders.forEach(order => {
      if (!order.id) return;
      (order.items || []).forEach(item => {
        const rawSku = item.sku.replace(/^0+/, '');
        // Match: direct SKU → linked/catalog SKU → null
        const key = inventory.items[rawSku] ? rawSku
          : (inventory.items[item.sku] ? item.sku
          : (linkedSkuMap[rawSku] || linkedSkuMap[normSku(item.sku)] || null));
        if (!key) return;
        const cases = item.cases || 0;
        soldBySku[key] = (soldBySku[key] || 0) + cases;
        if (!deductionsBySku[key]) deductionsBySku[key] = {};
        const deductKey = item.lineId ? `${order.id}:${item.lineId}` : order.id;
        deductionsBySku[key][deductKey] = {
          orderId: order.id,
          lineId: item.lineId || null,
          sku: item.sku,
          desc: item.desc || '',
          cases,
          orderName: order.name || '',
          orderDate: order.date || '',
          routeNumber: order.routeNumber || '',
        };
      });
    });

    // Update sold and orderDeductions for each inventory item — always rewrite to clear stale data
    const updatedItems = {};
    for (const [sku, item] of Object.entries(inventory.items)) {
      const computedSold = soldBySku[sku] || 0;
      const computedDeductions = deductionsBySku[sku] || {};
      updatedItems[sku] = { ...item, sold: computedSold, orderDeductions: computedDeductions };
    }
    const changed = JSON.stringify(updatedItems) !== JSON.stringify(inventory.items);

    if (changed) {
      setInventory({ ...inventory, items: updatedItems, lastUpdated: new Date().toISOString().split('T')[0] });
    }
  }, [inventory, ordersRef, setInventory]);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('remaining');
  const [sortDir, setSortDir] = useState('asc');
  const [editSku, setEditSku] = useState(null);
  const [editVal, setEditVal] = useState({});
  const [linkSearch, setLinkSearch] = useState('');
  const [linkDropdownOpen, setLinkDropdownOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState('');
  const [viewMode, setViewMode] = useState('dates'); // 'table' or 'dates'
  const [collapsedDates, setCollapsedDates] = useState({});
  const [stockExpanded, setStockExpanded] = useState({}); // which stock panel sections are expanded
  const [trailSku, setTrailSku] = useState(null); // which SKU's deduction trail is expanded
  const [collapsedSections, setCollapsedSections] = useState({}); // which table sections are collapsed
  const [categoryFilter, setCategoryFilter] = useState('all'); // price tier filter
  const [warningEditSku, setWarningEditSku] = useState(null); // which warning item is being edited
  const [warningEditQty, setWarningEditQty] = useState('');
  const [warningCollapsed, setWarningCollapsed] = useState(false);

  // Extract price tier from description — keyword checks first, then price fallback
  function getPriceTier(desc) {
    const dl = (desc || '').toLowerCase();
    // Keyword-based categories take priority over price
    if (dl.includes('kettle chip') && dl.includes('2.0 oz')) return 'Deep River Small';
    if (dl.includes('kettle chip') && dl.includes('1.3 oz')) return 'Deep River Grab & Go';
    if (dl.includes('kettle chip') && dl.includes('8 oz')) return 'Deep River Large';
    if (dl.includes('variety pack')) return 'Variety';
    if (/\bdips?\b/.test(dl) || dl.includes('nacho cheese')) return 'Dips';
    // Price-based categories
    const m = (desc || '').match(/^\$?([\d.]+)/);
    if (m) {
      const price = parseFloat(m[1]);
      if (!isNaN(price) && price > 0 && price < 100) return `$${price.toFixed(2)}`;
    }
    return 'Other';
  }

  // Collect all unique categories across items
  const allCategories = useMemo(() => {
    const catSet = new Set();
    Object.values(items).forEach(item => catSet.add(getPriceTier(item.description)));
    // Sort: dollar amounts first (numerically), then text categories
    return [...catSet].sort((a, b) => {
      const aNum = a.startsWith('$') ? parseFloat(a.slice(1)) : Infinity;
      const bNum = b.startsWith('$') ? parseFloat(b.slice(1)) : Infinity;
      if (aNum !== bNum) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [items]);

  // Collect all unique delivery dates across all items
  const allDates = useMemo(() => {
    const dateSet = new Set();
    Object.values(items).forEach(item => {
      (item.deliveries || []).forEach(d => dateSet.add(d.date));
    });
    return [...dateSet].sort();
  }, [items]);

  const todayStr = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0);
    return d.toISOString().split('T')[0];
  }, []);

  const rows = useMemo(() => {
    return Object.values(items)
      .map(item => {
        const deliveries = item.deliveries || [];
        const totalIncoming = item.incoming || deliveries.reduce((s, d) => s + d.qty, 0);
        const sold = item.sold || 0;

        // Only count units from deliveries that have arrived (date <= today)
        const arrivedUnits = deliveries.reduce((s, d) => d.date <= todayStr ? s + d.qty : s, 0);

        // When a date filter is active, show only that date's qty as "incoming"
        let filteredIncoming = totalIncoming;
        if (dateFilter !== 'all') {
          const match = deliveries.find(d => d.date === dateFilter);
          filteredIncoming = match ? match.qty : 0;
        }

        // Remaining = arrived stock minus what's been sold (not total pipeline)
        const remaining = arrivedUnits - sold;
        const pct = arrivedUnits > 0 ? Math.round((remaining / arrivedUnits) * 100) : 0;
        // Projected = in stock now + future deliveries
        const futureUnits = deliveries.reduce((s, d) => d.date > todayStr ? s + d.qty : s, 0);
        const projected = remaining + futureUnits;
        // Check: custom catalog entry > linked SKU > direct match
        const catalogMatch = item.catalogEntry
          || (item.linkedSku && catalogByNormSku[normSku(item.linkedSku)])
          || catalogByNormSku[normSku(item.sku)]
          || null;
        const priceTier = getPriceTier(item.description);
        return { ...item, incoming: totalIncoming, arrivedUnits, filteredIncoming, remaining, pct, sold, futureUnits, projected, deliveries, catalogMatch, priceTier };
      })
      .filter(item => {
        // Date filter: hide items that have no delivery on the selected date
        if (dateFilter !== 'all') {
          const hasDate = item.deliveries.some(d => d.date === dateFilter);
          if (!hasDate) return false;
        }
        // Category filter
        if (categoryFilter !== 'all' && item.priceTier !== categoryFilter) return false;
        // Search filter
        if (!search) return true;
        const q = search.toLowerCase();
        return item.description.toLowerCase().includes(q) || item.sku.includes(search);
      })
      .sort((a, b) => {
        let av = a[sortBy], bv = b[sortBy];
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [items, search, sortBy, sortDir, dateFilter, categoryFilter, todayStr]);

  // Items with zero or negative stock — inventory numbers need updating
  const problemItems = useMemo(() => {
    return rows.filter(r => r.remaining <= 0 && r.pct === 0).sort((a, b) => a.remaining - b.remaining);
  }, [rows]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.incoming += r.incoming;
      acc.filteredIncoming += r.filteredIncoming;
      acc.sold += r.sold;
      acc.remaining += r.remaining;
      acc.projected += r.projected;
      acc.hasFuture = acc.hasFuture || r.futureUnits > 0;
      return acc;
    }, { incoming: 0, filteredIncoming: 0, sold: 0, remaining: 0, projected: 0, hasFuture: false });
  }, [rows]);

  // Group rows by price tier for sectioned table view
  const rowsByTier = useMemo(() => {
    const groups = {};
    rows.forEach(item => {
      const tier = item.priceTier;
      if (!groups[tier]) groups[tier] = [];
      groups[tier].push(item);
    });
    // Sort: Deep River first (Small → Grab & Go → Large), then dollar amounts, then text
    const drOrder = { 'Deep River Small': 0, 'Deep River Grab & Go': 1, 'Deep River Large': 2 };
    return Object.entries(groups).sort(([a], [b]) => {
      const aDR = a.startsWith('Deep River');
      const bDR = b.startsWith('Deep River');
      if (aDR && bDR) return (drOrder[a] ?? 9) - (drOrder[b] ?? 9);
      if (aDR) return -1;
      if (bDR) return 1;
      const aNum = a.startsWith('$') ? parseFloat(a.slice(1)) : Infinity;
      const bNum = b.startsWith('$') ? parseFloat(b.slice(1)) : Infinity;
      if (aNum !== bNum) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [rows]);

  // Stock summary: what's here now vs what's coming
  const stockSummary = useMemo(() => {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const today = todayDate.toISOString().split('T')[0];
    // 1.5 weeks = 10.5 days, round to 11
    const forecastDate = new Date(todayDate.getTime() + 11 * 24 * 60 * 60 * 1000);
    const forecastStr = forecastDate.toISOString().split('T')[0];

    let inStockUnits = 0, totalSold = 0;
    let soldCost = 0, soldRetail = 0, soldCases = 0;
    const futureByDate = {};
    const inStockItems = []; // per-item breakdown
    const predictedItems = {}; // sku -> { desc, qty } predicted stock in 1.5 weeks
    let predictedTotal = 0;

    rows.forEach(item => {
      const sold = item.sold || 0; // sold is in cases
      totalSold += sold;
      const unitCost = item.catalogMatch?.price || 0;
      const unitRetail = item.catalogMatch?.retail || 0;
      const caseCount = item.caseCount || 1;
      soldCost += sold * caseCount * unitCost;
      soldRetail += sold * caseCount * unitRetail;
      soldCases += sold;
      let itemInStock = 0;
      let itemPredicted = 0;
      (item.deliveries || []).forEach(d => {
        if (d.date <= today) {
          inStockUnits += d.qty;
          itemInStock += d.qty;
          itemPredicted += d.qty;
        } else {
          if (!futureByDate[d.date]) futureByDate[d.date] = { date: d.date, qty: 0, po: d.po, items: [] };
          futureByDate[d.date].qty += d.qty;
          futureByDate[d.date].items.push({ sku: item.sku, desc: item.description, qty: d.qty });
          // Include in prediction if arriving within 1.5 weeks
          if (d.date <= forecastStr) {
            itemPredicted += d.qty;
          }
        }
      });
      const avail = itemInStock - sold;
      if (itemInStock > 0) {
        inStockItems.push({ sku: item.sku, desc: item.description, qty: itemInStock, sold, avail });
      }
      const predictedAvail = itemPredicted - sold;
      if (itemPredicted > 0) {
        predictedItems[item.sku] = { sku: item.sku, desc: item.description, qty: itemPredicted, avail: predictedAvail };
        predictedTotal += predictedAvail;
      }
    });

    const futureEntries = Object.values(futureByDate).sort((a, b) => a.date.localeCompare(b.date));
    const futureTotal = futureEntries.reduce((s, e) => s + e.qty, 0);
    const pipeline = inStockUnits + futureTotal;
    const predictedList = Object.values(predictedItems).sort((a, b) => b.avail - a.avail);
    const soldProfit = soldRetail - soldCost;

    return {
      inStockUnits, inStockAvail: inStockUnits - totalSold, totalSold,
      soldCases, soldCost, soldRetail, soldProfit,
      futureEntries, futureTotal, pipeline, inStockItems,
      forecastDate: forecastStr, predictedList, predictedTotal,
    };
  }, [rows]);

  // Weekly sales by price tier (Mon-Sun of current week) — sum directly from warehouse orders
  const allOrders = warehouseOrders?.orders || [];
  const weeklySalesByTier = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split('T')[0];
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const sundayStr = sunday.toISOString().split('T')[0];

    const tiers = { '$4.79': 0, '$0.50': 0, '$2.49': 0, deepRiver: 0 };
    allOrders.forEach(order => {
      if (!order.date || order.date < mondayStr || order.date > sundayStr) return;
      (order.items || []).forEach(item => {
        const cat = item.category || '';
        const cases = item.cases || 0;
        if (cat === '4.79 Products') tiers['$4.79'] += cases;
        else if (cat === '.50 Cents') tiers['$0.50'] += cases;
        else if (cat === '2.49 Products') tiers['$2.49'] += cases;
        if (cat === 'Deep River Small' || cat === 'Deep River Large') tiers.deepRiver += cases;
      });
    });
    return tiers;
  }, [allOrders]);

  // Group items by delivery date for the date-grouped view
  const dateGroups = useMemo(() => {
    const groups = {};
    Object.values(items).forEach(item => {
      (item.deliveries || []).forEach(d => {
        if (!groups[d.date]) groups[d.date] = { date: d.date, po: d.po, items: [], totalQty: 0, totalCases: 0, totalCost: 0 };
        const catalogMatch = item.catalogEntry
          || (item.linkedSku && catalogByNormSku[normSku(item.linkedSku)])
          || catalogByNormSku[normSku(item.sku)]
          || null;
        const unitPrice = catalogMatch?.price || 0;
        const retailPrice = catalogMatch?.retail || 0;
        const cases = item.caseCount ? Math.round(d.qty / item.caseCount) : d.qty;
        const lineCost = unitPrice * d.qty;
        groups[d.date].items.push({
          ...item,
          dateQty: d.qty,
          po: d.po,
          catalogMatch,
          cases,
          unitPrice,
          retailPrice,
          lineCost,
        });
        groups[d.date].totalQty += d.qty;
        groups[d.date].totalCases += cases;
        groups[d.date].totalCost += lineCost;
        // Collect unique POs
        if (d.po && !groups[d.date].po) groups[d.date].po = d.po;
      });
    });
    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }, [items]);

  function toggleDateCollapse(date) {
    setCollapsedDates(prev => ({ ...prev, [date]: !prev[date] }));
  }

  function collapseAllDates() {
    const all = {};
    dateGroups.forEach(g => { all[g.date] = true; });
    setCollapsedDates(all);
  }

  function expandAllDates() {
    setCollapsedDates({});
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  function sortIcon(col) {
    if (sortBy !== col) return ' \u2195';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  }

  function startEdit(item) {
    setEditSku(item.sku);
    const deliveries = item.deliveries || [];
    const arrivedUnits = deliveries.reduce((s, d) => d.date <= todayStr ? s + d.qty : s, 0);
    const currentStock = arrivedUnits - (item.sold || 0);
    setEditVal({
      incoming: item.incoming,
      sold: item.sold,
      arrivedUnits,
      currentStock: currentStock > 0 ? currentStock : 0,
      linkedSku: item.linkedSku || '',
      // For "Add new" catalog entry
      newCategory: item.catalogEntry?.category || '',
      newDesc: item.catalogEntry?.desc || item.description || '',
      newPrice: item.catalogEntry?.price || '',
      newRetail: item.catalogEntry?.retail || '',
      newUpc: item.catalogEntry?.upc || item.caseCount || '',
    });
    setLinkSearch('');
    setLinkDropdownOpen(false);
  }

  function saveEdit(sku) {
    const incoming = parseFloat(editVal.incoming) || 0;
    const sold = parseFloat(editVal.sold) || 0;
    const prevSold = items[sku]?.sold || 0;
    const updates = { incoming, sold };

    // Handle "Current Stock" — add a manual delivery to make the math work
    const currentStock = parseFloat(editVal.currentStock);
    if (!isNaN(currentStock) && currentStock >= 0) {
      const neededArrived = currentStock + sold; // what arrivedUnits should be
      const item = items[sku];
      const deliveries = [...(item?.deliveries || [])];
      const existingArrived = deliveries.reduce((s, d) => d.date <= todayStr ? s + d.qty : s, 0);
      const adjustment = neededArrived - existingArrived;
      if (adjustment !== 0) {
        // Add or update a stock count delivery for today
        const poLabel = `Stock count: ${currentStock} on floor`;
        const todayIdx = deliveries.findIndex(d => d.date === todayStr && (d.po || '').startsWith('Stock count'));
        if (todayIdx >= 0) {
          deliveries[todayIdx] = { ...deliveries[todayIdx], qty: adjustment, po: poLabel };
        } else {
          deliveries.push({ date: todayStr, qty: adjustment, po: poLabel });
        }
        updates.deliveries = deliveries;
        updates.incoming = deliveries.reduce((s, d) => s + d.qty, 0);
      }
    } else {
      // Track manual sold adjustments (only when not using current stock)
      if (sold !== prevSold) {
        const log = items[sku]?.adjustmentHistory || [];
        updates.adjustmentHistory = [...log, {
          type: 'manual', from: prevSold, to: sold, date: new Date().toISOString(),
          note: `Manual edit: ${prevSold} → ${sold}`,
        }];
      }
    }
    let newCustomCatalog = inventory.customCatalog || [];

    if (editVal.linkedSku === '__new__') {
      // Build the new catalog entry
      const entry = {
        sku: sku.padStart(6, '0'),
        category: editVal.newCategory || 'Uncategorized',
        type: 'CUSTOM',
        desc: editVal.newDesc || items[sku]?.description || '',
        price: parseFloat(editVal.newPrice) || 0,
        retail: parseFloat(editVal.newRetail) || 0,
        upc: parseInt(editVal.newUpc) || 1,
      };
      updates.catalogEntry = entry;
      updates.linkedSku = undefined;
      // Also add to customCatalog so WarehouseOrders can use it
      newCustomCatalog = [...newCustomCatalog.filter(c => c.sku !== entry.sku), entry];
    } else if (editVal.linkedSku) {
      updates.linkedSku = editVal.linkedSku;
      updates.catalogEntry = undefined;
    } else {
      updates.linkedSku = undefined;
      updates.catalogEntry = undefined;
    }
    setInventory({
      ...inventory,
      items: {
        ...items,
        [sku]: { ...items[sku], ...updates },
      },
      customCatalog: newCustomCatalog,
      lastUpdated: new Date().toISOString().split('T')[0],
    });
    setEditSku(null);
  }

  // Filtered catalog items for the link dropdown — also fuzzy-match against current item desc
  const linkResults = useMemo(() => {
    if (!linkSearch && editSku) {
      // Auto-suggest: use the inventory item's description words to find likely matches
      const item = items[editSku];
      if (item) {
        const words = (item.description || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
          const scored = PRODUCT_CATALOG.map(p => {
            const d = p.desc.toLowerCase();
            const hits = words.filter(w => d.includes(w)).length;
            return { ...p, score: hits };
          }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);
          if (scored.length > 0) return scored.slice(0, 30);
        }
      }
      return PRODUCT_CATALOG.slice(0, 30);
    }
    const q = (linkSearch || '').toLowerCase();
    return PRODUCT_CATALOG.filter(p =>
      p.desc.toLowerCase().includes(q) ||
      p.sku.includes(linkSearch) ||
      normSku(p.sku).includes(linkSearch) ||
      p.category.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [linkSearch, editSku, items]);

  function resetSold(sku) {
    const prev = items[sku]?.sold || 0;
    if (prev === 0) return;
    const log = items[sku]?.adjustmentHistory || [];
    const entry = { type: 'reset', from: prev, to: 0, date: new Date().toISOString(), note: 'Manual reset' };
    setInventory({
      ...inventory,
      items: { ...items, [sku]: { ...items[sku], sold: 0, adjustmentHistory: [...log, entry] } },
      lastUpdated: new Date().toISOString().split('T')[0],
    });
  }

  function saveWarningQty(sku) {
    const qty = parseInt(warningEditQty) || 0;
    if (qty <= 0) return;
    const item = items[sku];
    if (!item) return;
    const today = new Date().toISOString().split('T')[0];
    const deliveries = [...(item.deliveries || [])];
    // Add or update a delivery for today
    const todayIdx = deliveries.findIndex(d => d.date === today);
    if (todayIdx >= 0) {
      deliveries[todayIdx] = { ...deliveries[todayIdx], qty };
    } else {
      deliveries.push({ date: today, qty, po: 'Manual update' });
    }
    const totalIncoming = deliveries.reduce((s, d) => s + d.qty, 0);
    setInventory({
      ...inventory,
      items: { ...items, [sku]: { ...item, deliveries, incoming: totalIncoming } },
      lastUpdated: today,
    });
    setWarningEditSku(null);
    setWarningEditQty('');
  }

  function deleteItem(sku) {
    const copy = { ...items };
    delete copy[sku];
    setInventory({
      ...inventory,
      items: copy,
      lastUpdated: new Date().toISOString().split('T')[0],
    });
  }

  function deleteAll() {
    if (!window.confirm('Delete ALL inventory items? This cannot be undone.')) return;
    setInventory({ items: {}, lastUpdated: new Date().toISOString().split('T')[0] });
  }

  function exportInventory() {
    const blob = new Blob([JSON.stringify(inventory, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    setImportError('');
    setImportResult('');
    try {
      const data = JSON.parse(importText);
      // Support both Wise order format and raw inventory format
      let orderItems = [];
      let deliveryDate = new Date().toISOString().split('T')[0];
      let po = '';

      if (data.order_info && data.items) {
        // Wise order format
        const rawDate = data.order_info.delivery_date || '';
        if (rawDate) {
          const parts = rawDate.split('/');
          if (parts.length === 3) {
            deliveryDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }
        po = data.order_info.po_number || data.order_info.wise_order_number || '';
        orderItems = data.items.map(i => ({
          sku: i.item_number,
          description: i.description,
          caseCount: i.case_count,
          qty: i.order_quantity,
        }));
      } else if (data.items) {
        // Raw inventory format — merge directly
        const merged = { ...items };
        Object.entries(data.items).forEach(([sku, item]) => {
          merged[sku] = { ...item, sku };
        });
        setInventory({ ...inventory, items: merged, lastUpdated: new Date().toISOString().split('T')[0] });
        setImportResult(`Imported ${Object.keys(data.items).length} items`);
        setShowImport(false);
        setImportText('');
        return;
      } else {
        setImportError('Unrecognized format. Paste a Wise order JSON or inventory JSON.');
        return;
      }

      // Merge order items into inventory
      const merged = { ...items };
      let added = 0, updated = 0;
      for (const oi of orderItems) {
        const existing = merged[oi.sku];
        if (existing) {
          const deliveries = [...(existing.deliveries || [])];
          // Check if this date+po combo already exists
          const dupIdx = deliveries.findIndex(d => d.date === deliveryDate && d.po === po);
          if (dupIdx >= 0) {
            deliveries[dupIdx] = { ...deliveries[dupIdx], qty: oi.qty };
          } else {
            deliveries.push({ date: deliveryDate, qty: oi.qty, po });
          }
          const totalIncoming = deliveries.reduce((s, d) => s + d.qty, 0);
          merged[oi.sku] = { ...existing, incoming: totalIncoming, deliveries, caseCount: oi.caseCount };
          updated++;
        } else {
          merged[oi.sku] = {
            sku: oi.sku,
            description: oi.description,
            caseCount: oi.caseCount,
            incoming: oi.qty,
            sold: 0,
            deliveries: [{ date: deliveryDate, qty: oi.qty, po }],
          };
          added++;
        }
      }
      setInventory({ ...inventory, items: merged, lastUpdated: new Date().toISOString().split('T')[0] });
      setImportResult(`Imported: ${added} new, ${updated} updated (delivery ${deliveryDate}, PO ${po})`);
      setShowImport(false);
      setImportText('');
    } catch (e) {
      setImportError('Invalid JSON: ' + e.message);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }

  function statusClass(pct, remaining) {
    if (remaining <= 0) return 'inv-status-out';
    if (pct < 20) return 'inv-status-low';
    return 'inv-status-ok';
  }

  return (
    <div className="inv-page">
      <div className="inv-header">
        <div className="inv-title-row">
          <h2 className="inv-title">Inventory</h2>
          <span className="inv-updated">Last updated: {inventory?.lastUpdated || '\u2014'}</span>
        </div>

        {/* Toolbar */}
        <div className="inv-toolbar">
          <button className="inv-toolbar-btn inv-toolbar-import" onClick={() => { setShowImport(true); setImportError(''); setImportResult(''); }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 2a1 1 0 011 1v5.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 8.586V3a1 1 0 011-1z"/><path d="M3 14a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"/></svg>
            Import Order
          </button>
          <button className="inv-toolbar-btn inv-toolbar-export" onClick={exportInventory}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 18a1 1 0 01-1-1v-5.586l-2.293 2.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 11.414V17a1 1 0 01-1 1z"/><path d="M3 6a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"/></svg>
            Export
          </button>
          <button className="inv-toolbar-btn inv-toolbar-danger" onClick={deleteAll}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            Delete All
          </button>
        </div>

        {importResult && <div className="inv-import-result">{importResult}</div>}

        {/* View mode toggle */}
        <div className="inv-view-toggle">
          <button className={`inv-view-btn${viewMode === 'dates' ? ' active' : ''}`} onClick={() => setViewMode('dates')}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
            By Date
          </button>
          <button className={`inv-view-btn${viewMode === 'table' ? ' active' : ''}`} onClick={() => setViewMode('table')}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd"/></svg>
            Table
          </button>
        </div>

        {/* Summary cards */}
        <div className="inv-cards">
          <div className="inv-card inv-card-delivery">
            <div className="inv-card-label">Next Delivery</div>
            {stockSummary.futureEntries.length > 0 ? (<>
              <div className="inv-card-val">{new Date(stockSummary.futureEntries[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              <div className="inv-card-sub">{stockSummary.futureEntries[0].qty} cases{stockSummary.futureEntries[0].po ? ` · PO ${stockSummary.futureEntries[0].po}` : ''}</div>
            </>) : (
              <div className="inv-card-val">None</div>
            )}
          </div>
          <div className="inv-card inv-card-sold">
            <div className="inv-card-label">$4.79 Sold This Week</div>
            <div className="inv-card-val">{weeklySalesByTier['$4.79'].toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-sold">
            <div className="inv-card-label">$.50 Sold This Week</div>
            <div className="inv-card-val">{weeklySalesByTier['$0.50'].toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-sold">
            <div className="inv-card-label">$2.49 Sold This Week</div>
            <div className="inv-card-val">{weeklySalesByTier['$2.49'].toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-remaining">
            <div className="inv-card-label">Deep River This Week</div>
            <div className="inv-card-val">{weeklySalesByTier.deepRiver.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Warning panel: items with negative stock */}
      {problemItems.length > 0 && (
        <div className={`inv-warning-panel${warningCollapsed ? ' inv-warning-collapsed' : ''}`}>
          <div className="inv-warning-header" onClick={() => setWarningCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
            <span className="inv-warning-icon">!</span>
            <span className="inv-warning-title">{problemItems.length} item{problemItems.length > 1 ? 's' : ''} need inventory update</span>
            <span className="inv-warning-toggle">{warningCollapsed ? '\u25B6' : '\u25BC'}</span>
          </div>
          {!warningCollapsed && (
            <>
              <div className="inv-warning-desc">Sold more than what's in stock. Update the warehouse inventory count for these items:</div>
              <div className="inv-warning-list">
                {problemItems.map(item => (
                  <div key={item.sku} className={`inv-warning-item${warningEditSku === item.sku ? ' inv-warning-item-editing' : ''}`}
                    onClick={() => { if (warningEditSku !== item.sku) { setWarningEditSku(item.sku); setWarningEditQty(''); } }}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="inv-warning-item-sku">{item.sku}</span>
                    <span className="inv-warning-item-name">{item.description}</span>
                    <span className="inv-warning-item-detail">
                      arrived {item.arrivedUnits} &minus; sold {item.sold} = <strong>{item.remaining}</strong>
                    </span>
                    {warningEditSku === item.sku && (
                      <div className="inv-warning-edit" onClick={e => e.stopPropagation()}>
                        <label className="inv-warning-edit-label">Cases in stock:</label>
                        <input
                          className="inv-warning-edit-input"
                          type="number"
                          min="0"
                          placeholder="Enter qty..."
                          value={warningEditQty}
                          onChange={e => setWarningEditQty(e.target.value)}
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveWarningQty(item.sku); if (e.key === 'Escape') setWarningEditSku(null); }}
                        />
                        <button className="inv-warning-edit-save" onClick={() => saveWarningQty(item.sku)}>Save</button>
                        <button className="inv-warning-edit-cancel" onClick={() => setWarningEditSku(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Filter chips (table view only) */}
      {viewMode === 'table' && (
        <div className="inv-filter-bar">
          {allDates.length > 1 && (
            <div className="inv-date-filter">
              <span className="inv-date-filter-label">Delivery:</span>
              <button
                className={`inv-date-chip${dateFilter === 'all' ? ' active' : ''}`}
                onClick={() => setDateFilter('all')}
              >All</button>
              {allDates.map(d => (
                <button
                  key={d}
                  className={`inv-date-chip${dateFilter === d ? ' active' : ''}`}
                  onClick={() => setDateFilter(dateFilter === d ? 'all' : d)}
                >{formatDate(d)}</button>
              ))}
            </div>
          )}
          {allCategories.length > 1 && (
            <div className="inv-date-filter">
              <span className="inv-date-filter-label">Category:</span>
              <button
                className={`inv-date-chip${categoryFilter === 'all' ? ' active' : ''}`}
                onClick={() => setCategoryFilter('all')}
              >All</button>
              {allCategories.map(c => (
                <button
                  key={c}
                  className={`inv-date-chip inv-cat-chip${categoryFilter === c ? ' active' : ''}`}
                  onClick={() => setCategoryFilter(categoryFilter === c ? 'all' : c)}
                >{c}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="inv-controls">
        <input
          className="inv-search"
          type="text"
          placeholder="Search by SKU or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="inv-clear-search" onClick={() => setSearch('')}>Clear</button>}
      </div>

      <div className="inv-content-layout">
        <div className="inv-main-content">

      {/* Date-grouped collapsible view */}
      {viewMode === 'dates' && (
        <div className="inv-date-groups">
          <div className="inv-date-groups-toolbar">
            <button className="inv-date-groups-btn" onClick={expandAllDates}>Expand All</button>
            <button className="inv-date-groups-btn" onClick={collapseAllDates}>Collapse All</button>
            <span className="inv-date-groups-count">{dateGroups.length} delivery dates</span>
          </div>
          {dateGroups.map(group => {
            const isCollapsed = collapsedDates[group.date];
            const filteredItems = search
              ? group.items.filter(item => {
                  const q = search.toLowerCase();
                  return item.description.toLowerCase().includes(q) || item.sku.includes(search);
                })
              : group.items;
            if (search && filteredItems.length === 0) return null;
            const grpTotalQty = filteredItems.reduce((s, i) => s + i.dateQty, 0);
            const grpTotalCases = filteredItems.reduce((s, i) => s + i.cases, 0);
            const grpTotalCost = filteredItems.reduce((s, i) => s + i.lineCost, 0);
            const grpTotalRetail = filteredItems.reduce((s, i) => s + (i.retailPrice * i.dateQty), 0);
            // Determine availability: the delivery date itself
            const deliveryDate = new Date(group.date + 'T00:00:00');
            const today = new Date();
            today.setHours(0,0,0,0);
            const isAvailable = deliveryDate <= today;
            const daysUntil = Math.ceil((deliveryDate - today) / (1000 * 60 * 60 * 24));
            return (
              <div key={group.date} className={`inv-date-group${isCollapsed ? ' collapsed' : ''}`}>
                <button className="inv-date-group-header" onClick={() => toggleDateCollapse(group.date)}>
                  <span className="inv-date-group-arrow">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                  <span className="inv-date-group-date">{formatDate(group.date)}/{group.date.split('-')[0].slice(2)}</span>
                  <span className="inv-date-group-summary">
                    {filteredItems.length} items &middot; {grpTotalQty.toLocaleString()} units &middot; ${grpTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {group.po && <span className="inv-date-group-po">PO: {group.po}</span>}
                  <span className={`inv-date-group-avail ${isAvailable ? 'available' : 'pending'}`}>
                    {isAvailable ? 'Available' : `In ${daysUntil} days`}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="inv-date-group-body">
                    <div className="inv-date-group-table-wrap">
                      <table className="inv-date-group-table">
                        <thead>
                          <tr>
                            <th className="inv-dg-th">#</th>
                            <th className="inv-dg-th inv-dg-th-desc">Item</th>
                            <th className="inv-dg-th inv-dg-th-num">Price</th>
                            <th className="inv-dg-th inv-dg-th-num">Qty</th>
                            <th className="inv-dg-th inv-dg-th-num">Total Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredItems.map(item => (
                            <tr key={item.sku} className="inv-dg-row">
                              <td className="inv-dg-td inv-dg-td-sku">
                                {item.sku}
                                {item.catalogMatch
                                  ? <span className="inv-match-badge matched" title={item.catalogMatch.desc}>{item.linkedSku ? 'LNK' : 'WH'}</span>
                                  : <span className="inv-match-badge unmatched">?</span>
                                }
                              </td>
                              <td className="inv-dg-td inv-dg-td-desc">{item.description}</td>
                              <td className="inv-dg-td inv-dg-td-num">{item.unitPrice > 0 ? `$${item.unitPrice.toFixed(2)}` : '\u2014'}</td>
                              <td className="inv-dg-td inv-dg-td-num">{item.dateQty.toLocaleString()}</td>
                              <td className="inv-dg-td inv-dg-td-num">{item.lineCost > 0 ? `$${item.lineCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="inv-dg-totals">
                            <td colSpan="2" className="inv-dg-totals-label">Totals ({filteredItems.length} items)</td>
                            <td className="inv-dg-td inv-dg-td-num"></td>
                            <td className="inv-dg-td inv-dg-td-num">{grpTotalQty.toLocaleString()}</td>
                            <td className="inv-dg-td inv-dg-td-num">${grpTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="inv-date-group-sidebar">
                      <div className="inv-dg-stat">
                        <span className="inv-dg-stat-label">Total Units</span>
                        <span className="inv-dg-stat-val">{grpTotalQty.toLocaleString()}</span>
                      </div>
                      <div className="inv-dg-stat">
                        <span className="inv-dg-stat-label">Total Cases</span>
                        <span className="inv-dg-stat-val">{grpTotalCases.toLocaleString()}</span>
                      </div>
                      <div className="inv-dg-stat">
                        <span className="inv-dg-stat-label">Total Cost</span>
                        <span className="inv-dg-stat-val">${grpTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="inv-dg-stat">
                        <span className="inv-dg-stat-label">Retail Value</span>
                        <span className="inv-dg-stat-val">${grpTotalRetail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="inv-dg-stat inv-dg-stat-avail">
                        <span className="inv-dg-stat-label">Available</span>
                        <span className={`inv-dg-stat-val ${isAvailable ? 'inv-dg-available' : 'inv-dg-pending'}`}>
                          {isAvailable ? 'Now' : `${formatDate(group.date)}/${group.date.split('-')[0].slice(2)}`}
                        </span>
                      </div>
                      {group.po && (
                        <div className="inv-dg-stat">
                          <span className="inv-dg-stat-label">PO #</span>
                          <span className="inv-dg-stat-val">{group.po}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th className="inv-th-alert"></th>
              <th className="inv-th-sku" onClick={() => toggleSort('sku')}>SKU{sortIcon('sku')}</th>
              <th className="inv-th-catsku">WH#</th>
              <th className="inv-th-desc" onClick={() => toggleSort('description')}>Product{sortIcon('description')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('incoming')}>
                {dateFilter !== 'all' ? `${formatDate(dateFilter)} Order` : 'Total Ordered'}{sortIcon('incoming')}
              </th>
              {dateFilter !== 'all' && <th className="inv-th-num">All Orders</th>}
              <th className="inv-th-num" onClick={() => toggleSort('sold')}>Sold{sortIcon('sold')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('remaining')}>In Stock{sortIcon('remaining')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('projected')}>Projected{sortIcon('projected')}</th>
              <th className="inv-th-pct"></th>
              <th className="inv-th-deliveries">Arriving</th>
              <th className="inv-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let drHeaderShown = false;
              const drTiers = rowsByTier.filter(([t]) => t.startsWith('Deep River'));
              const drTotalItems = drTiers.reduce((s, [, items]) => s + items.length, 0);
              const drTotalUnits = drTiers.reduce((s, [, items]) => s + items.reduce((u, i) => u + i.incoming, 0), 0);
              return rowsByTier.map(([tier, tierItems]) => {
              const isDR = tier.startsWith('Deep River');
              const showDRParent = isDR && !drHeaderShown && drTiers.length > 0;
              if (showDRParent) drHeaderShown = true;
              return (
            <React.Fragment key={tier}>
              {showDRParent && rowsByTier.length > 1 && (
                <tr className="inv-section-row inv-section-parent" onClick={() => setCollapsedSections(prev => ({ ...prev, '__DR__': !prev['__DR__'] }))} style={{ cursor: 'pointer' }}>
                  <td colSpan={dateFilter !== 'all' ? 12 : 11} className="inv-section-cell inv-parent-cell">
                    <span className="inv-section-toggle">{collapsedSections['__DR__'] ? '\u25B6' : '\u25BC'}</span>
                    <span className="inv-section-label">DEEP RIVER</span>
                    <span className="inv-section-count">{drTotalItems} items &middot; {drTotalUnits.toLocaleString()} units</span>
                  </td>
                </tr>
              )}
              {!(isDR && collapsedSections['__DR__']) && rowsByTier.length > 1 && (
                <tr className={`inv-section-row${isDR ? ' inv-section-sub' : ''}`} onClick={() => setCollapsedSections(prev => ({ ...prev, [tier]: !prev[tier] }))} style={{ cursor: 'pointer' }}>
                  <td colSpan={dateFilter !== 'all' ? 12 : 11} className={`inv-section-cell${isDR ? ' inv-sub-cell' : ''}`}>
                    <span className="inv-section-toggle">{collapsedSections[tier] ? '\u25B6' : '\u25BC'}</span>
                    <span className="inv-section-label">{isDR ? tier.replace('Deep River ', '') : tier}</span>
                    <span className="inv-section-count">{tierItems.length} items &middot; {tierItems.reduce((s, i) => s + i.incoming, 0).toLocaleString()} units</span>
                  </td>
                </tr>
              )}
              {!collapsedSections[tier] && !(isDR && collapsedSections['__DR__']) && tierItems.map(item => (
              <React.Fragment key={item.sku}>
              <tr className={`inv-row ${statusClass(item.pct, item.remaining)}${trailSku === item.sku ? ' inv-row-open' : ''}`}>
                {editSku === item.sku ? (
                  <>
                    <td className="inv-td-alert"></td>
                    <td className="inv-td-sku">{item.sku}</td>
                    <td className="inv-td-desc" colSpan={dateFilter !== 'all' ? 8 : 7}>
                      <div className="inv-edit-row">
                        <div className="inv-edit-item-name">{item.description}</div>
                        <div className="inv-edit-fields">
                          <label className="inv-edit-label">Current Stock
                            <input className="inv-edit-input inv-edit-current-stock" type="number" min="0" placeholder="Count on floor..."
                              value={editVal.currentStock}
                              onChange={e => {
                                const val = e.target.value;
                                const cs = parseFloat(val);
                                const sold = parseFloat(editVal.sold) || 0;
                                // Back-calculate: neededArrived = currentStock + sold
                                const newIncoming = !isNaN(cs) ? cs + sold : editVal.incoming;
                                setEditVal(v => ({ ...v, currentStock: val, incoming: newIncoming }));
                              }}
                            />
                          </label>
                          <label className="inv-edit-label">Sold
                            <input className="inv-edit-input" type="number" value={editVal.sold} readOnly style={{ opacity: 0.6 }} title="Sold is computed from orders" />
                          </label>
                          <span className="inv-edit-remaining">= {(parseFloat(editVal.currentStock) || 0)} in stock</span>
                        </div>
                        <div className="inv-link-section">
                          <span className="inv-link-label">Catalog link:</span>
                          {editVal.linkedSku === '__new__' ? (
                            <div className="inv-new-entry">
                              <div className="inv-new-entry-row">
                                <label className="inv-edit-label">Category
                                  <select className="inv-new-select" value={editVal.newCategory} onChange={e => setEditVal(v => ({ ...v, newCategory: e.target.value }))}>
                                    <option value="">-- Pick --</option>
                                    {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </label>
                                <label className="inv-edit-label">Desc
                                  <input className="inv-edit-input inv-new-desc-input" type="text" value={editVal.newDesc} onChange={e => setEditVal(v => ({ ...v, newDesc: e.target.value }))} />
                                </label>
                              </div>
                              <div className="inv-new-entry-row">
                                <label className="inv-edit-label">Cost $
                                  <input className="inv-edit-input" type="number" step="0.01" value={editVal.newPrice} onChange={e => setEditVal(v => ({ ...v, newPrice: e.target.value }))} />
                                </label>
                                <label className="inv-edit-label">Retail $
                                  <input className="inv-edit-input" type="number" step="0.01" value={editVal.newRetail} onChange={e => setEditVal(v => ({ ...v, newRetail: e.target.value }))} />
                                </label>
                                <label className="inv-edit-label">UPC (per case)
                                  <input className="inv-edit-input" type="number" value={editVal.newUpc} onChange={e => setEditVal(v => ({ ...v, newUpc: e.target.value }))} />
                                </label>
                                <button className="inv-link-clear" onClick={() => setEditVal(v => ({ ...v, linkedSku: '' }))} title="Cancel new entry">&times;</button>
                              </div>
                            </div>
                          ) : editVal.linkedSku ? (
                            <span className="inv-link-current">
                              <span className="inv-link-current-sku">{editVal.linkedSku}</span>
                              {catalogByNormSku[normSku(editVal.linkedSku)]?.desc || ''}
                              <button className="inv-link-clear" onClick={() => setEditVal(v => ({ ...v, linkedSku: '' }))} title="Remove link">&times;</button>
                            </span>
                          ) : item.catalogMatch && !item.catalogEntry ? (
                            <span className="inv-link-auto">{item.catalogMatch.sku} {item.catalogMatch.desc} (auto-matched)</span>
                          ) : (
                            <div className="inv-link-dropdown-wrap">
                              <input
                                className="inv-link-search"
                                type="text"
                                placeholder="Search catalog to link..."
                                value={linkSearch}
                                onChange={e => { setLinkSearch(e.target.value); setLinkDropdownOpen(true); }}
                                onFocus={() => setLinkDropdownOpen(true)}
                              />
                              {linkDropdownOpen && (
                                <div className="inv-link-dropdown">
                                  {linkResults.map(p => (
                                    <button
                                      key={p.sku}
                                      className="inv-link-option"
                                      onClick={() => { setEditVal(v => ({ ...v, linkedSku: p.sku })); setLinkDropdownOpen(false); setLinkSearch(''); }}
                                    >
                                      <span className="inv-link-option-sku">{p.sku}</span>
                                      <span className="inv-link-option-desc">{p.desc}</span>
                                      <span className="inv-link-option-cat">{p.category}</span>
                                    </button>
                                  ))}
                                  <button
                                    className="inv-link-option inv-link-add-new"
                                    onClick={() => { setEditVal(v => ({ ...v, linkedSku: '__new__' })); setLinkDropdownOpen(false); setLinkSearch(''); }}
                                  >
                                    <span className="inv-link-option-sku">+</span>
                                    <span className="inv-link-option-desc">Add as new catalog item</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="inv-td-actions">
                      <button className="inv-btn inv-btn-save" onClick={() => saveEdit(item.sku)}>Save</button>
                      <button className="inv-btn inv-btn-cancel" onClick={() => { setEditSku(null); setLinkDropdownOpen(false); }}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="inv-td-alert">{item.remaining <= 30 ? <span className="inv-order-now">ORDER</span> : ''}</td>
                    <td className="inv-td-sku inv-td-clickable" onClick={() => setTrailSku(trailSku === item.sku ? null : item.sku)}>
                      {item.sku}
                      <span className="inv-row-expand-icon">{trailSku === item.sku ? '\u25B2' : '\u25BC'}</span>
                    </td>
                    <td className="inv-td-catsku">
                      {item.catalogMatch
                        ? <span className="inv-catsku-val" title={`${item.catalogMatch.desc} (${item.catalogMatch.category})`}>{item.catalogMatch.sku}</span>
                        : <span className="inv-catsku-none" title="Not linked to warehouse catalog">—</span>
                      }
                    </td>
                    <td className="inv-td-desc inv-td-clickable" onClick={() => setTrailSku(trailSku === item.sku ? null : item.sku)}>{item.description}</td>
                    <td className="inv-td-num">
                      {dateFilter !== 'all' ? item.filteredIncoming.toLocaleString() : item.incoming.toLocaleString()}
                    </td>
                    {dateFilter !== 'all' && <td className="inv-td-num" style={{ color: '#94a3b8' }}>{item.incoming.toLocaleString()}</td>}
                    <td className={`inv-td-num inv-sold`}>
                      {item.sold.toLocaleString()}
                    </td>
                    <td className={`inv-td-num inv-remaining ${item.remaining <= 0 ? 'inv-zero' : ''}`}>
                      {item.remaining.toLocaleString()}
                    </td>
                    <td className={`inv-td-num inv-projected${item.futureUnits > 0 ? ' inv-has-future' : ''}`}>
                      {item.futureUnits > 0 ? item.projected.toLocaleString() : '—'}
                    </td>
                    <td className="inv-td-pct">
                      <div className="inv-pct-bar-wrap">
                        <div className="inv-pct-bar" style={{ width: `${Math.max(0, item.pct)}%` }}></div>
                        <span className="inv-pct-label">{item.pct}%</span>
                      </div>
                    </td>
                    <td className="inv-td-deliveries">
                      <div className="inv-delivery-chips">
                        {item.deliveries.map((d, i) => (
                          <span
                            key={i}
                            className={`inv-del-chip${dateFilter === d.date ? ' active' : ''}`}
                            title={`PO: ${d.po || 'N/A'}`}
                          >
                            {formatDate(d.date)}: {d.qty}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="inv-td-actions">
                      <button className="inv-btn inv-btn-edit" onClick={(e) => { e.stopPropagation(); startEdit(item); }} title="Edit quantities">Edit</button>
                      {item.sold > 0 && (
                        <button className="inv-btn inv-btn-reset" onClick={(e) => { e.stopPropagation(); resetSold(item.sku); }} title="Reset sold to 0">Reset</button>
                      )}
                      <button className="inv-btn inv-btn-delete" onClick={(e) => { e.stopPropagation(); deleteItem(item.sku); }} title="Delete item">&times;</button>
                    </td>
                  </>
                )}
              </tr>
              {trailSku === item.sku && (() => {
                const deductions = item.orderDeductions || {};
                const adjustments = item.adjustmentHistory || [];
                const colCount = dateFilter !== 'all' ? 12 : 11;
                const entries = Object.entries(deductions).map(([key, val]) => {
                  if (typeof val === 'object' && val.orderId) return val;
                  return { orderId: key, units: typeof val === 'number' ? val : 0, orderName: '', orderDate: '', routeNumber: '', lineId: null };
                }).sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || ''));
                const deliveries = item.deliveries || [];
                {/* Build a single chronological activity log */}
                const activity = [];
                deliveries.forEach(d => {
                  const arrived = d.date <= todayStr;
                  const isStockCount = (d.po || '').startsWith('Stock count');
                  const type = isStockCount ? 'Stock Count' : (arrived ? 'Received' : 'Pending');
                  const detail = isStockCount ? d.po : (d.po ? `PO ${d.po}` : '');
                  activity.push({ date: d.date, type, detail, cases: d.qty });
                });
                entries.forEach(e => {
                  activity.push({ date: e.orderDate || '', type: 'Sold', detail: `${e.routeNumber || ''} ${e.orderName || ''}`.trim(), cases: -(e.cases || 0) });
                });
                adjustments.filter(a => a.type !== 'stock_count').forEach(a => {
                  activity.push({ date: a.date ? a.date.split('T')[0] : '', type: 'Adjustment', detail: a.note || '', cases: a.qty || 0 });
                });
                activity.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

                return (
                  <tr className="inv-trail-row">
                    <td colSpan={colCount} className="inv-trail-cell">
                      <div className="inv-trail-panel">
                        {activity.length > 0 ? (
                          <table className="inv-trail-table">
                            <thead>
                              <tr>
                                <th>Date</th><th>Type</th><th>Detail</th><th>Cases</th><th>Balance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                let balance = 0;
                                const totalSold = activity.filter(a => a.cases < 0).reduce((s, a) => s + a.cases, 0);
                                const rows = activity.map((a, i) => {
                                  balance += a.cases;
                                  return (
                                    <tr key={i}>
                                      <td>{a.date ? formatDate(a.date) : '—'}</td>
                                      <td><span className={`inv-trail-type inv-trail-type-${a.type.toLowerCase()}`}>{a.type}</span></td>
                                      <td>{a.detail || '—'}</td>
                                      <td className={`inv-trail-cases ${a.cases > 0 ? 'inv-trail-add' : 'inv-trail-sub'}`}>
                                        {a.cases > 0 ? '+' : ''}{a.cases.toLocaleString()}
                                      </td>
                                      <td className={`inv-trail-balance ${balance < 0 ? 'inv-trail-negative' : ''}`}>{balance.toLocaleString()}</td>
                                    </tr>
                                  );
                                });
                                const receivedTotal = activity.filter(a => a.type === 'Received').reduce((s, a) => s + a.cases, 0);
                                const inStockNow = receivedTotal + totalSold;
                                const pendingDates = activity.filter(a => a.type === 'Pending').map(a => a.date).sort();
                                const lastDate = pendingDates.length > 0 ? pendingDates[pendingDates.length - 1] : null;
                                rows.push(
                                  <tr key="totals" className="inv-trail-totals">
                                    <td colSpan="2"></td>
                                    <td style={{ fontWeight: 700 }}>Total Sold</td>
                                    <td className="inv-trail-sub" style={{ fontWeight: 700 }}>{totalSold.toLocaleString()}</td>
                                    <td style={{ fontWeight: 700 }}>In Stock: {inStockNow.toLocaleString()}</td>
                                  </tr>
                                );
                                if (lastDate) {
                                  rows.push(
                                    <tr key="expected" className="inv-trail-totals">
                                      <td colSpan="2"></td>
                                      <td style={{ fontWeight: 700 }}>Expected by {formatDate(lastDate)}</td>
                                      <td></td>
                                      <td style={{ fontWeight: 700, color: '#1976d2' }}>{balance.toLocaleString()}</td>
                                    </tr>
                                  );
                                }
                                return rows;
                              })()}
                            </tbody>
                          </table>
                        ) : (
                          <div className="inv-trail-empty">No history available</div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })()}
            </React.Fragment>
            ))}
            </React.Fragment>
            );})})()}
            {rows.length === 0 && (
              <tr>
                <td colSpan={dateFilter !== 'all' ? 12 : 11} className="inv-empty">No items found.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="inv-totals-row">
              <td colSpan="3" className="inv-totals-label">TOTALS ({rows.length} products)</td>
              <td className="inv-td-num">{(dateFilter !== 'all' ? totals.filteredIncoming : totals.incoming).toLocaleString()}</td>
              {dateFilter !== 'all' && <td className="inv-td-num" style={{ color: '#94a3b8' }}>{totals.incoming.toLocaleString()}</td>}
              <td className="inv-td-num inv-sold">{totals.sold.toLocaleString()}</td>
              <td className="inv-td-num inv-remaining">{totals.remaining.toLocaleString()}</td>
              <td className="inv-td-num inv-projected">{totals.hasFuture ? totals.projected.toLocaleString() : ''}</td>
              <td colSpan={dateFilter !== 'all' ? 3 : 2}></td>
            </tr>
          </tfoot>
        </table>
      </div>}

        </div>{/* end inv-main-content */}

        {/* Stock Summary Panel */}
        <div className="inv-stock-panel">
          <div className="inv-stock-section">
            <button className="inv-stock-section-header" onClick={() => setStockExpanded(p => ({ ...p, instock: !p.instock }))}>
              <span className="inv-stock-section-title">In Stock Now</span>
              <span className="inv-stock-section-toggle">{stockExpanded.instock ? '\u25BC' : '\u25B6'}</span>
            </button>
            <div className="inv-stock-big">{stockSummary.inStockAvail.toLocaleString()}</div>
            <div className="inv-stock-sub">{stockSummary.inStockItems.length} products available</div>
            {stockSummary.totalSold > 0 && (
              <div className="inv-stock-sub">{stockSummary.inStockUnits.toLocaleString()} cases received &minus; {stockSummary.totalSold.toLocaleString()} sold</div>
            )}
            {stockExpanded.instock && stockSummary.inStockItems.length > 0 && (
              <div className="inv-stock-items-list">
                {stockSummary.inStockItems.map(it => (
                  <div key={it.sku} className="inv-stock-item-row">
                    <span className="inv-stock-item-name" title={it.desc}>{it.desc}</span>
                    <span className="inv-stock-item-qty">{it.avail.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="inv-stock-divider" />

          <div className="inv-stock-section">
            <div className="inv-stock-section-title">Coming Soon</div>
            {stockSummary.futureEntries.length > 0 ? (
              stockSummary.futureEntries.map(e => (
                <div key={e.date}>
                  <button className="inv-stock-future-row inv-stock-date-toggle" onClick={() => setStockExpanded(p => ({ ...p, [e.date]: !p[e.date] }))}>
                    <span className="inv-stock-future-date">{formatDate(e.date)} <span className="inv-stock-section-toggle">{stockExpanded[e.date] ? '\u25BC' : '\u25B6'}</span></span>
                    <span className="inv-stock-future-qty">{e.qty.toLocaleString()}</span>
                  </button>
                  {stockExpanded[e.date] && e.items && (
                    <div className="inv-stock-items-list">
                      {e.items.map(it => (
                        <div key={it.sku} className="inv-stock-item-row">
                          <span className="inv-stock-item-name" title={it.desc}>{it.desc}</span>
                          <span className="inv-stock-item-qty">{it.qty.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="inv-stock-sub">No upcoming deliveries</div>
            )}
            {stockSummary.futureEntries.length > 0 && (
              <div className="inv-stock-future-row" style={{ borderTop: '1px solid #cbd5e1', marginTop: 4, paddingTop: 4 }}>
                <span className="inv-stock-future-date" style={{ fontWeight: 700 }}>Total</span>
                <span className="inv-stock-future-qty">{stockSummary.futureTotal.toLocaleString()}</span>
              </div>
            )}
          </div>

          <hr className="inv-stock-divider" />

          <div className="inv-stock-section">
            <button className="inv-stock-section-header" onClick={() => setStockExpanded(p => ({ ...p, predicted: !p.predicted }))}>
              <span className="inv-stock-section-title">Stock in 1.5 Weeks</span>
              <span className="inv-stock-section-toggle">{stockExpanded.predicted ? '\u25BC' : '\u25B6'}</span>
            </button>
            <div className="inv-stock-sub">by {formatDate(stockSummary.forecastDate)}</div>
            <div className="inv-stock-big">{stockSummary.predictedTotal.toLocaleString()}</div>
            <div className="inv-stock-sub">{stockSummary.predictedList.length} products expected</div>
            {stockExpanded.predicted && stockSummary.predictedList.length > 0 && (
              <div className="inv-stock-items-list">
                {stockSummary.predictedList.map(it => (
                  <div key={it.sku} className="inv-stock-item-row">
                    <span className="inv-stock-item-name" title={it.desc}>{it.desc}</span>
                    <span className="inv-stock-item-qty">{it.avail.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="inv-stock-divider" />

          <div className="inv-stock-section">
            <div className="inv-stock-section-title">Total Pipeline</div>
            <div className="inv-stock-big">{stockSummary.pipeline.toLocaleString()}</div>
            <div className="inv-stock-sub">total ordered</div>
            <div className="inv-stock-pipeline-row">
              <span className="inv-stock-pipeline-label">Sold</span>
              <span className="inv-stock-pipeline-val inv-stock-sold-val">{stockSummary.totalSold.toLocaleString()} cases</span>
            </div>
            {stockSummary.totalSold > 0 && (
              <>
                <div className="inv-stock-pipeline-row">
                  <span className="inv-stock-pipeline-label">Cases</span>
                  <span className="inv-stock-pipeline-val">{stockSummary.soldCases.toLocaleString()}</span>
                </div>
                <div className="inv-stock-pipeline-row">
                  <span className="inv-stock-pipeline-label">Cost</span>
                  <span className="inv-stock-pipeline-val">${stockSummary.soldCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="inv-stock-pipeline-row">
                  <span className="inv-stock-pipeline-label">Retail</span>
                  <span className="inv-stock-pipeline-val">${stockSummary.soldRetail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="inv-stock-pipeline-row">
                  <span className="inv-stock-pipeline-label">Gross Profit</span>
                  <span className="inv-stock-pipeline-val inv-stock-profit-val">${stockSummary.soldProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
            <div className="inv-stock-pipeline-row">
              <span className="inv-stock-pipeline-label">Available</span>
              <span className="inv-stock-pipeline-val inv-stock-avail-val">{(stockSummary.pipeline - stockSummary.totalSold).toLocaleString()} cases</span>
            </div>
          </div>
        </div>

      </div>{/* end inv-content-layout */}

      {/* Import modal */}
      {showImport && (
        <div className="inv-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}>
          <div className="inv-modal">
            <h3 className="inv-modal-title">Import Wise Order</h3>
            <p className="inv-modal-desc">Paste Wise order JSON below. Items will be merged into inventory with delivery date tracking.</p>
            <textarea
              className="inv-import-textarea"
              rows={12}
              placeholder='Paste Wise order JSON here...'
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportError(''); }}
            />
            {importError && <div className="inv-import-error">{importError}</div>}
            <div className="inv-modal-actions">
              <button className="inv-toolbar-btn inv-toolbar-import" onClick={handleImport} disabled={!importText.trim()}>Import</button>
              <button className="inv-toolbar-btn" onClick={() => setShowImport(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

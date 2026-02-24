import React, { useState, useMemo, useRef, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp } from '../context/AppContext';
import { parseTransactions, analyzeByRoute, analyzeByDay, analyzeByStore, analyzeWarehouseMatchup, dedup, STORAGE_ROUTES, matchCustomerToStore } from '../services/daoTransactionParser';

export default function Transactions() {
  const { state, setTransactions, bulkImportStores } = useApp();
  const transactions = state.transactions || [];
  const [importing, setImporting] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [expandedRoute, setExpandedRoute] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportRouteFilter, setReportRouteFilter] = useState('all');
  const fileInputRef = useRef(null);
  const reportMenuRef = useRef(null);

  const parsed = useMemo(() => parseTransactions(transactions), [transactions]);
  const allRouteAnalysis = useMemo(() => analyzeByRoute(parsed), [parsed]);

  // Separate warehouse (route 99) from delivery routes
  const warehouseData = useMemo(() => allRouteAnalysis.find(r => r.route === '99') || null, [allRouteAnalysis]);
  const routeAnalysis = useMemo(() => allRouteAnalysis.filter(r => r.route !== '99'), [allRouteAnalysis]);

  const totalStats = useMemo(() => {
    if (routeAnalysis.length === 0) return null;
    const loadTotal = routeAnalysis.reduce((s, r) => s + r.loadTotal, 0);
    const grossSales = routeAnalysis.reduce((s, r) => s + r.grossSales, 0);
    const credits = routeAnalysis.reduce((s, r) => s + r.credits, 0);
    const netSales = grossSales + credits;
    return {
      routes: routeAnalysis.length,
      loadTotal,
      grossSales,
      credits,
      netSales,
      sellThrough: loadTotal > 0 ? (netSales / loadTotal) * 100 : 0,
      totalTx: parsed.length,
      warehouseLoad: warehouseData ? warehouseData.loadTotal : 0,
    };
  }, [routeAnalysis, parsed, warehouseData]);

  function processFileData(text) {
    setImporting(true);
    setImportError('');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setImportError('File does not contain valid JSON. Make sure you exported it using the DAO bookmarklet.');
      setImporting(false);
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      setImportError('No transaction data found in the file.');
      setImporting(false);
      return;
    }
    // Merge with existing — dedup by ID, newer overwrites older
    const newIds = new Set(data.map(d => d.id).filter(Boolean));
    const kept = transactions.filter(t => !t.id || !newIds.has(t.id));
    setTransactions([...kept, ...data]);
    setImportError('');
    setImporting(false);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processFileData(reader.result);
    reader.onerror = () => { setImportError('Failed to read file.'); };
    reader.readAsText(file);
    e.target.value = ''; // Reset so same file can be re-imported
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processFileData(reader.result);
    reader.onerror = () => { setImportError('Failed to read file.'); };
    reader.readAsText(file);
  }

  function handleClear() {
    if (confirm('Clear all transaction data?')) {
      setTransactions([]);
      setExpandedRoute(null);
      setExpandedDay(null);
      setSyncResult(null);
    }
  }

  function syncLastSaleFromTransactions() {
    const stores = state.stores || [];
    if (stores.length === 0 || parsed.length === 0) return;

    // Only use non-void Invoice lines with a valid amount
    const invoices = parsed.filter(t =>
      t.docType === 'Invoice' && !t.isVoid && (t.amount || 0) > 0
    );

    // Build map: storeId → latest invoice date
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

    // Build a single batch of updates — only where transaction date is newer
    const updates = [];
    for (const [storeId, date] of Object.entries(latestByStore)) {
      const store = stores.find(s => s.id === storeId);
      if (!store) continue;
      if (!store.lastSaleDate || date > store.lastSaleDate) {
        updates.push({ id: storeId, lastSaleDate: date });
      }
    }
    if (updates.length > 0) bulkImportStores(updates, []);
    setSyncResult({ updated: updates.length, total: Object.keys(latestByStore).length });
  }

  function fmt(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  function pct(n) {
    return n.toFixed(1) + '%';
  }

  function sellClass(p) {
    if (p >= 80) return 'tx-sell-good';
    if (p >= 50) return 'tx-sell-warn';
    return 'tx-sell-bad';
  }

  // Detect available report periods from transaction data
  const reportPeriods = useMemo(() => {
    if (parsed.length === 0) return [];
    const dates = parsed.map(t => t.settlementDate || t.docDate?.date || '').filter(Boolean).sort();
    if (dates.length === 0) return [];

    const uniqueDates = [...new Set(dates)].sort();
    const firstDate = new Date(uniqueDates[0] + 'T12:00:00');
    const lastDate = new Date(uniqueDates[uniqueDates.length - 1] + 'T12:00:00');

    const periods = [];

    // Detect weeks (Sun-Sat blocks)
    const weeks = {};
    for (const ds of uniqueDates) {
      const d = new Date(ds + 'T12:00:00');
      // Find Sunday of this week
      const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
      const sun = new Date(d);
      sun.setDate(sun.getDate() - dayOfWeek);
      const sunStr = sun.toISOString().slice(0, 10);
      if (!weeks[sunStr]) weeks[sunStr] = [];
      weeks[sunStr].push(ds);
    }

    for (const [sunStr, weekDates] of Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0]))) {
      const sun = new Date(sunStr + 'T12:00:00');
      const sat = new Date(sun);
      sat.setDate(sat.getDate() + 6);
      const label = `Week of ${sun.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} - ${sat.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;
      periods.push({
        type: 'week',
        label,
        startDate: sunStr,
        endDate: sat.toISOString().slice(0, 10),
        dates: weekDates,
      });
    }

    // Add full month option(s)
    const months = {};
    for (const ds of uniqueDates) {
      const monthKey = ds.slice(0, 7); // "2026-02"
      if (!months[monthKey]) months[monthKey] = [];
      months[monthKey].push(ds);
    }

    for (const [monthKey, monthDates] of Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]))) {
      const d = new Date(monthKey + '-01T12:00:00');
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      periods.push({
        type: 'month',
        label,
        startDate: monthKey + '-01',
        endDate: lastDay.toISOString().slice(0, 10),
        dates: monthDates,
      });
    }

    return periods;
  }, [parsed]);

  // Generate PDF report for a given period, optionally filtered to one route
  const generateReport = useCallback((period, routeFilter) => {
    setShowReportMenu(false);

    // Filter transactions to the selected period
    const filteredTx = parsed.filter(t => {
      const d = t.settlementDate || t.docDate?.date || '';
      return d >= period.startDate && d <= period.endDate;
    });

    if (filteredTx.length === 0) return;

    const periodRoutes = analyzeByRoute(filteredTx);
    const warehouse = periodRoutes.find(r => r.route === '99') || null;
    const allDeliveryRoutes = periodRoutes.filter(r => r.route !== '99');
    const isSingleRoute = routeFilter && routeFilter !== 'all';

    // If filtering to a single route, only include that route
    const deliveryRoutes = isSingleRoute
      ? allDeliveryRoutes.filter(r => r.route === routeFilter)
      : allDeliveryRoutes;

    if (deliveryRoutes.length === 0) return;

    // For single-route warehouse matchup, filter to just that route
    const matchup = warehouse
      ? analyzeWarehouseMatchup(filteredTx).filter(m => !isSingleRoute || m.route === routeFilter)
      : [];

    // Compute totals
    const totals = {
      routes: deliveryRoutes.length,
      loadTotal: deliveryRoutes.reduce((s, r) => s + r.loadTotal, 0),
      grossSales: deliveryRoutes.reduce((s, r) => s + r.grossSales, 0),
      credits: deliveryRoutes.reduce((s, r) => s + r.credits, 0),
      netSales: deliveryRoutes.reduce((s, r) => s + r.netSales, 0),
      warehouseLoad: warehouse ? warehouse.loadTotal : 0,
    };
    totals.grossProfit = totals.netSales - totals.loadTotal;
    totals.margin = totals.netSales !== 0 ? (totals.grossProfit / totals.netSales * 100) : 0;

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const fmtPdf = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    const pctPdf = (n) => n.toFixed(1) + '%';

    const singleRouteObj = isSingleRoute ? deliveryRoutes[0] : null;
    const titleSuffix = isSingleRoute
      ? ` — Route ${singleRouteObj.displayRoute}${singleRouteObj.isStorage ? ' (Storage)' : ''}`
      : '';

    // ===== PAGE 1: SUMMARY =====
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`Transaction Report${titleSuffix}`, pageWidth / 2, 16, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(period.label, pageWidth / 2, 23, { align: 'center' });

    // Overall stats box
    let y = 32;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, y, pageWidth - 28, 22, 3, 3, 'F');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const statsItems = isSingleRoute
      ? [
          ['Load', fmtPdf(totals.loadTotal)],
          ['Gross', fmtPdf(totals.grossSales)],
          ['Credits', fmtPdf(totals.credits)],
          ['Revenue', fmtPdf(totals.netSales)],
          ['Gross Profit', fmtPdf(totals.grossProfit)],
          ['Margin', pctPdf(totals.margin)],
          ['Stores', String(singleRouteObj.storeCount)],
        ]
      : [
          ['Routes', String(totals.routes)],
          ['Load', fmtPdf(totals.loadTotal)],
          ['Gross', fmtPdf(totals.grossSales)],
          ['Credits', fmtPdf(totals.credits)],
          ['Revenue', fmtPdf(totals.netSales)],
          ['Gross Profit', fmtPdf(totals.grossProfit)],
          ['Margin', pctPdf(totals.margin)],
        ];
    if (!isSingleRoute && totals.warehouseLoad > 0) {
      statsItems.splice(1, 0, ['Warehouse', fmtPdf(totals.warehouseLoad)]);
    }

    const statSpacing = (pageWidth - 28) / statsItems.length;
    statsItems.forEach(([label, value], i) => {
      const x = 14 + statSpacing * i + statSpacing / 2;
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(label, x, y + 8, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      if (label === 'Credits') doc.setTextColor(220, 38, 38);
      else if (label === 'Gross Profit') doc.setTextColor(totals.grossProfit >= 0 ? 34 : 220, totals.grossProfit >= 0 ? 197 : 38, totals.grossProfit >= 0 ? 94 : 38);
      else if (label === 'Margin') doc.setTextColor(totals.margin >= 0 ? 34 : 220, totals.margin >= 0 ? 197 : 38, totals.margin >= 0 ? 94 : 38);
      else if (label === 'Revenue') doc.setTextColor(59, 130, 246);
      else if (label === 'Warehouse') doc.setTextColor(245, 158, 11);
      else doc.setTextColor(30, 41, 59);
      doc.text(value, x, y + 16, { align: 'center' });
    });

    doc.setTextColor(0, 0, 0);
    y += 28;

    // Route summary table (only for multi-route reports)
    if (!isSingleRoute) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Route Summary', 14, y);
      y += 2;

      const routeTableData = deliveryRoutes.map(r => {
        const gp = r.netSales - r.loadTotal;
        const margin = r.netSales !== 0 ? (gp / r.netSales * 100) : 0;
        return [
          r.isStorage ? `Rt ${r.displayRoute} (Storage)` : `Rt ${r.displayRoute}`,
          fmtPdf(r.loadTotal),
          fmtPdf(r.grossSales),
          fmtPdf(r.credits),
          fmtPdf(r.netSales),
          fmtPdf(gp),
          pctPdf(margin),
          String(r.storeCount),
          (r.dsdOk + r.dsdMissing) > 0 ? pctPdf(r.dsdCompliance) : '—',
        ];
      });

      // Add totals row
      routeTableData.push([
        'TOTAL',
        fmtPdf(totals.loadTotal),
        fmtPdf(totals.grossSales),
        fmtPdf(totals.credits),
        fmtPdf(totals.netSales),
        fmtPdf(totals.grossProfit),
        pctPdf(totals.margin),
        '',
        '',
      ]);

      autoTable(doc, {
        startY: y,
        head: [['Route', 'Load', 'Gross', 'Credits', 'Revenue', 'GP', 'Margin', 'Stores', 'DSD']],
        body: routeTableData,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 95], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 35, fontStyle: 'bold' },
          1: { cellWidth: 28, halign: 'right' },
          2: { cellWidth: 28, halign: 'right' },
          3: { cellWidth: 28, halign: 'right' },
          4: { cellWidth: 28, halign: 'right' },
          5: { cellWidth: 28, halign: 'right' },
          6: { cellWidth: 18, halign: 'center' },
          7: { cellWidth: 16, halign: 'center' },
          8: { cellWidth: 16, halign: 'center' },
        },
        margin: { left: 14, right: 14 },
        didParseCell: function (data) {
          if (data.section === 'body') {
            if (data.column.index === 3) data.cell.styles.textColor = [220, 38, 38];
            if (data.column.index === 5 || data.column.index === 6) {
              const routeIdx = data.row.index;
              if (routeIdx < deliveryRoutes.length) {
                const r = deliveryRoutes[routeIdx];
                const gp = r.netSales - r.loadTotal;
                data.cell.styles.textColor = gp >= 0 ? [34, 197, 94] : [220, 38, 38];
              } else {
                data.cell.styles.textColor = totals.grossProfit >= 0 ? [34, 197, 94] : [220, 38, 38];
              }
            }
            if (data.row.index === routeTableData.length - 1) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [241, 245, 249];
            }
          }
        },
      });
    }

    // ===== PER-ROUTE DETAIL =====
    // For single-route: daily breakdown goes on page 1 below the stats
    // For multi-route: each route gets its own page
    for (const r of deliveryRoutes) {
      const gp = r.netSales - r.loadTotal;
      const margin = r.netSales !== 0 ? (gp / r.netSales * 100) : 0;

      if (!isSingleRoute) {
        doc.addPage();

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 58, 95);
        const routeTitle = r.isStorage ? `Route ${r.displayRoute} (Storage)` : `Route ${r.displayRoute}`;
        doc.text(routeTitle, 14, 16);
        doc.setTextColor(0, 0, 0);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`${r.dateRange}  |  Load: ${fmtPdf(r.loadTotal)}  |  Revenue: ${fmtPdf(r.netSales)}  |  GP: ${fmtPdf(gp)}  |  Margin: ${pctPdf(margin)}  |  Stores: ${r.storeCount}`, 14, 22);
      }

      // Daily breakdown table
      const dayData = analyzeByDay(filteredTx, r.route);
      let yRoute = isSingleRoute ? y + 4 : 28;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Daily Breakdown', 14, yRoute);
      yRoute += 2;

      const dayTableData = dayData.map(d => {
        const dayGp = d.netSales - d.loadTotal;
        const dayMargin = d.netSales !== 0 ? (dayGp / d.netSales * 100) : 0;
        return [
          d.dateFormatted,
          fmtPdf(d.loadTotal),
          fmtPdf(d.grossSales),
          fmtPdf(d.credits),
          fmtPdf(d.netSales),
          fmtPdf(dayGp),
          pctPdf(dayMargin),
          String(d.storeCount),
          String(d.transactionCount),
        ];
      });

      autoTable(doc, {
        startY: yRoute,
        head: [['Date', 'Load', 'Gross', 'Credits', 'Revenue', 'GP', 'Margin', 'Stores', 'Txns']],
        body: dayTableData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 28, halign: 'right' },
          2: { cellWidth: 28, halign: 'right' },
          3: { cellWidth: 28, halign: 'right' },
          4: { cellWidth: 28, halign: 'right' },
          5: { cellWidth: 28, halign: 'right' },
          6: { cellWidth: 18, halign: 'center' },
          7: { cellWidth: 16, halign: 'center' },
          8: { cellWidth: 16, halign: 'center' },
        },
        margin: { left: 14, right: 14 },
        didParseCell: function (data) {
          if (data.section === 'body') {
            if (data.column.index === 3) data.cell.styles.textColor = [220, 38, 38];
            if (data.column.index === 5 || data.column.index === 6) {
              const d = dayData[data.row.index];
              if (d) {
                const dgp = d.netSales - d.loadTotal;
                data.cell.styles.textColor = dgp >= 0 ? [34, 197, 94] : [220, 38, 38];
              }
            }
          }
        },
      });

      yRoute = doc.lastAutoTable.finalY + 8;

      // Top stores (all stores for single-route, top 15 for multi)
      const allStores = {};
      for (const d of dayData) {
        const stores = analyzeByStore(filteredTx, r.route, d.date);
        for (const s of stores) {
          if (s.isRouteOps) continue;
          if (!allStores[s.custName]) allStores[s.custName] = { custName: s.custName, custNum: s.custNum, total: 0, visits: 0 };
          allStores[s.custName].total += s.total;
          allStores[s.custName].visits++;
        }
      }

      const topStores = Object.values(allStores).sort((a, b) => b.total - a.total).slice(0, isSingleRoute ? 30 : 15);

      if (topStores.length > 0) {
        if (yRoute + 20 > pageHeight - 15) { doc.addPage(); yRoute = 16; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(isSingleRoute ? 'Store Breakdown (by Revenue)' : 'Top Stores (by Revenue)', 14, yRoute);
        yRoute += 2;

        autoTable(doc, {
          startY: yRoute,
          head: [['Store', 'Cust #', 'Revenue', 'Visits']],
          body: topStores.map(s => [s.custName, s.custNum, fmtPdf(s.total), String(s.visits)]),
          theme: 'grid',
          headStyles: { fillColor: [34, 197, 94], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 25 },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 18, halign: 'center' },
          },
          margin: { left: 14, right: 14 },
        });

        yRoute = doc.lastAutoTable.finalY + 8;
      }

      // Payment method breakdown
      const pmEntries = Object.entries(r.paymentBreakdown || {});
      if (pmEntries.length > 0) {
        if (yRoute + 20 > pageHeight - 15) { doc.addPage(); yRoute = 16; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Payment Methods', 14, yRoute);
        yRoute += 2;

        const pmData = pmEntries.sort((a, b) => b[1].total - a[1].total).map(([method, data]) => [
          method,
          String(data.count),
          fmtPdf(data.total),
          r.netSales !== 0 ? pctPdf(data.total / r.netSales * 100) : '0.0%',
        ]);

        autoTable(doc, {
          startY: yRoute,
          head: [['Method', 'Invoices', 'Amount', '% of Revenue']],
          body: pmData,
          theme: 'grid',
          headStyles: { fillColor: [100, 116, 139], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
          bodyStyles: { fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 30, fontStyle: 'bold' },
            1: { cellWidth: 20, halign: 'center' },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 25, halign: 'center' },
          },
          margin: { left: 14, right: 14 },
        });
      }

      // Void transaction count
      if (r.voidCount > 0) {
        const voidY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 4 : yRoute + 4;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(150, 150, 150);
        doc.text(`${r.voidCount} void transaction${r.voidCount !== 1 ? 's' : ''} (${fmtPdf(r.voidTotal)}) excluded from totals`, 14, voidY);
        doc.setTextColor(0, 0, 0);
      }
    }

    // ===== WAREHOUSE MATCHUP PAGE =====
    if (matchup.length > 0) {
      doc.addPage();

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 83, 9);
      doc.text(isSingleRoute ? `Warehouse Matchup — Route ${routeFilter}` : 'Warehouse Matchup (Route 99)', 14, 16);
      doc.setTextColor(0, 0, 0);

      const mismatches = matchup.filter(m => !m.matched);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      if (warehouse) {
        const whLabel = isSingleRoute
          ? `${matchup.length} matchup${matchup.length !== 1 ? 's' : ''}  |  ${mismatches.length} mismatch${mismatches.length !== 1 ? 'es' : ''}`
          : `Warehouse Total: ${fmtPdf(warehouse.loadTotal)}  |  ${matchup.length} matchups  |  ${mismatches.length} mismatch${mismatches.length !== 1 ? 'es' : ''}`;
        doc.text(whLabel, 14, 22);
      }

      const matchupData = matchup.map(m => [
        `Rt ${m.route}`,
        m.custName ? m.custName.replace(/^\d+\s*-\s*/, '') : '—',
        m.hasWarehouse ? m.dateFormatted : '—',
        m.hasRouteLoad ? m.loadDateFormatted : '—',
        m.invoiceId || '—',
        m.hasWarehouse ? fmtPdf(m.warehouseAmount) : '—',
        m.hasRouteLoad ? fmtPdf(m.routeLoadAmount) : '—',
        Math.abs(m.difference) < 0.01 ? '$0.00' : fmtPdf(m.difference),
        m.matched ? 'OK' : !m.hasWarehouse ? 'No WH' : !m.hasRouteLoad ? 'No Load' : 'DIFF',
      ]);

      autoTable(doc, {
        startY: 28,
        head: [['Route', 'Driver', 'WH Date', 'Load Date', 'ID', 'WH Invoice', 'Route Load', 'Diff', 'Status']],
        body: matchupData,
        theme: 'grid',
        headStyles: { fillColor: [180, 83, 9], fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        bodyStyles: { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 18, fontStyle: 'bold' },
          1: { cellWidth: 35 },
          2: { cellWidth: 18 },
          3: { cellWidth: 18 },
          4: { cellWidth: 22 },
          5: { cellWidth: 28, halign: 'right' },
          6: { cellWidth: 28, halign: 'right' },
          7: { cellWidth: 24, halign: 'right' },
          8: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
        },
        margin: { left: 14, right: 14 },
        didParseCell: function (data) {
          if (data.section === 'body' && data.column.index === 8) {
            const val = data.cell.raw;
            if (val === 'OK') data.cell.styles.textColor = [34, 197, 94];
            else if (val === 'DIFF') data.cell.styles.textColor = [239, 68, 68];
            else data.cell.styles.textColor = [249, 115, 22];
          }
          if (data.section === 'body' && data.column.index === 7) {
            const m = matchup[data.row.index];
            if (m && Math.abs(m.difference) > 0.01) data.cell.styles.textColor = [220, 38, 38];
          }
        },
      });
    }

    // ===== FOOTER ON EVERY PAGE =====
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Map Tracker — Generated ${new Date().toLocaleDateString()} — Page ${i} of ${pageCount}`,
        pageWidth / 2, pageHeight - 5, { align: 'center' }
      );
    }

    // Save
    const routeSlug = isSingleRoute ? `_Route_${routeFilter}` : '';
    const filename = period.type === 'month'
      ? `Transaction_Report${routeSlug}_${period.label.replace(/\s+/g, '_')}.pdf`
      : `Transaction_Report${routeSlug}_${period.startDate}_to_${period.endDate}.pdf`;
    doc.save(filename);
  }, [parsed]);

  // Compute per-sub-route breakdown for combined routes
  function getSubRouteBreakdown(routeData) {
    if (!routeData.subRoutes || routeData.subRoutes.length === 0) return null;
    const allRoutes = [routeData.route, ...routeData.subRoutes];
    return allRoutes.map(rt => {
      const txs = routeData.transactions.filter(t => t.route === rt);
      if (txs.length === 0) return null;
      const invoices = txs.filter(t => t.docType === 'Invoice');
      const loads = txs.filter(t => t.docType === 'Load' || t.docType === 'Route Order');
      const loadTotal = loads.reduce((s, t) => s + t.amount, 0);
      const grossSales = invoices.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const credits = invoices.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const netSales = grossSales + credits;
      const sellThrough = loadTotal > 0 ? (netSales / loadTotal) * 100 : 0;
      const storeNames = new Set(invoices.filter(t => t.custName).map(t => t.custName));
      return { route: rt, loadTotal, grossSales, credits, netSales, sellThrough, storeCount: storeNames.size, txCount: txs.length };
    }).filter(Boolean);
  }

  const dayAnalysis = useMemo(() => {
    if (!expandedRoute) return [];
    return analyzeByDay(parsed, expandedRoute);
  }, [parsed, expandedRoute]);

  // Group day analysis by week (Sun-Sat) for weekly subtotals
  const weeklyDayAnalysis = useMemo(() => {
    if (dayAnalysis.length === 0) return [];
    const weekMap = {};
    const weeks = [];

    for (const day of dayAnalysis) {
      const d = new Date(day.date + 'T12:00:00');
      const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
      const sun = new Date(d);
      sun.setDate(sun.getDate() - dayOfWeek);
      const sunStr = sun.toISOString().slice(0, 10);

      if (!weekMap[sunStr]) {
        weekMap[sunStr] = { sunday: sunStr, days: [] };
        weeks.push(weekMap[sunStr]);
      }
      weekMap[sunStr].days.push(day);
    }

    weeks.sort((a, b) => a.sunday.localeCompare(b.sunday));

    return weeks.map((w, i) => {
      const loadTotal = w.days.reduce((s, d) => s + d.loadTotal, 0);
      const grossSales = w.days.reduce((s, d) => s + d.grossSales, 0);
      const credits = w.days.reduce((s, d) => s + d.credits, 0);
      const netSales = grossSales + credits;
      const transactionCount = w.days.reduce((s, d) => s + d.transactionCount, 0);
      // Unique stores across the week
      const allStores = new Set();
      for (const d of w.days) {
        for (const tx of d.transactions) {
          if (tx.docType === 'Invoice' && tx.custName) allStores.add(tx.custName);
        }
      }

      const sun = new Date(w.sunday + 'T12:00:00');
      const sat = new Date(sun);
      sat.setDate(sat.getDate() + 6);
      const label = `Week ${i + 1} (${sun.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} – ${sat.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })})`;

      return {
        weekNum: i + 1,
        label,
        sunday: w.sunday,
        days: w.days,
        loadTotal,
        grossSales,
        credits,
        netSales,
        storeCount: allStores.size,
        transactionCount,
      };
    });
  }, [dayAnalysis]);

  const storeAnalysis = useMemo(() => {
    if (!expandedRoute || !expandedDay) return [];
    return analyzeByStore(parsed, expandedRoute, expandedDay);
  }, [parsed, expandedRoute, expandedDay]);

  // Bookmarklet URL
  const bookmarkletCode = `javascript:void(fetch('${window.location.origin}/dao-bookmarklet.js').then(r=>r.text()).then(t=>eval(t)))`;

  return (
    <div className="tx-container">
      <div className="tx-header">
        <h2 title="Weekly transaction data imported from the DAO Dashboard — shows route sales performance, sell-through rates, and DSD compliance">Transactions</h2>
        <div className="tx-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.json"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button className="tx-btn tx-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importing}
            title="Import a .txt file exported from the DAO Dashboard using the bookmarklet">
            {importing ? 'Importing...' : 'Import File'}
          </button>
          {transactions.length > 0 && (
            <button className="tx-btn tx-btn-secondary" onClick={handleClear}
              title="Remove all imported transaction data">Clear</button>
          )}
          {parsed.length > 0 && (
            <button className="tx-btn tx-btn-primary" onClick={syncLastSaleFromTransactions}
              title="Update each store's Last Sale date from the most recent Invoice in this transaction data">
              Sync Last Sale
            </button>
          )}
          {reportPeriods.length > 0 && (
            <div className="tx-report-dropdown-wrap" ref={reportMenuRef}>
              <button className="tx-btn tx-btn-report" onClick={() => setShowReportMenu(m => !m)}
                title="Generate a PDF report for a specific week or month">
                Report ▾
              </button>
              {showReportMenu && (
                <div className="tx-report-menu">
                  <div className="tx-report-menu-route">
                    <select
                      value={reportRouteFilter}
                      onChange={e => setReportRouteFilter(e.target.value)}
                      className="tx-report-route-select"
                      title="Filter report to a specific route, or All Routes for the full report"
                    >
                      <option value="all">All Routes</option>
                      {routeAnalysis.map(r => (
                        <option key={r.route} value={r.route}>
                          Route {r.displayRoute}{r.isStorage ? ' (Storage)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="tx-report-menu-section">Weeks</div>
                  {reportPeriods.filter(p => p.type === 'week').map(p => (
                    <button key={p.startDate} className="tx-report-menu-item" onClick={() => generateReport(p, reportRouteFilter)}>
                      {p.label}
                    </button>
                  ))}
                  <div className="tx-report-menu-section">Full Month</div>
                  {reportPeriods.filter(p => p.type === 'month').map(p => (
                    <button key={p.startDate} className="tx-report-menu-item" onClick={() => generateReport(p, reportRouteFilter)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="tx-btn tx-btn-secondary" onClick={() => setShowSetup(s => !s)}
            title="Show instructions for exporting data from the DAO Dashboard">
            {showSetup ? 'Hide Setup' : 'Setup'}
          </button>
        </div>
      </div>

      {importError && <div className="tx-error">{importError}</div>}
      {syncResult && (
        <div className="tx-sync-result" onClick={() => setSyncResult(null)} style={{ cursor: 'pointer' }}>
          {syncResult.updated > 0
            ? `Last Sale updated on ${syncResult.updated} store${syncResult.updated !== 1 ? 's' : ''} (${syncResult.total} matched from transactions)`
            : `No updates needed — all ${syncResult.total} matched stores already have current dates`}
          {' '}✕
        </div>
      )}

      {showSetup && (
        <div className="tx-setup">
          <h3>How to import transactions from DAO Dashboard</h3>
          <ol>
            <li>Go to the <a href="https://dashboard.daogroup.com/Dashboards/DocumentViewer/DocumentViewerForm4.aspx" target="_blank" rel="noopener noreferrer">DAO Document Viewer</a></li>
            <li>Set your date range and filters, then click Search</li>
            <li>Set <strong>Max Rows</strong> to a high number (e.g., 500) so all data loads on one page</li>
            <li>
              Drag this link to your bookmarks bar:{' '}
              <a className="tx-bookmarklet-link" href={bookmarkletCode} onClick={e => e.preventDefault()}>
                DAO Scraper
              </a>
              <br />
              <small>Or paste the script from <code>public/dao-bookmarklet.js</code> into the browser console</small>
            </li>
            <li>Click the bookmarklet — it downloads a <strong>.txt file</strong> with the transaction data</li>
            <li>Come back here, click <strong>"Import File"</strong> and select the downloaded .txt file (or drag it onto the drop zone below)</li>
          </ol>
        </div>
      )}

      {totalStats && (
        <div className="tx-summary-bar" title="Route 99 (Warehouse) is the source — Load is liability (inventory sent out), Sales are the return/profit from stores">
          <div className="tx-stat" title="Number of delivery routes (excludes warehouse route 99)">
            <span className="tx-stat-label">Routes</span>
            <span className="tx-stat-value">{totalStats.routes}</span>
          </div>
          {totalStats.warehouseLoad > 0 && (
            <div className="tx-stat" title="Total value sourced from warehouse (Route 99) — this is your total liability, the inventory investment sent out to routes">
              <span className="tx-stat-label">Warehouse</span>
              <span className="tx-stat-value" style={{ color: '#f59e0b' }}>{fmt(totalStats.warehouseLoad)}</span>
            </div>
          )}
          <div className="tx-stat" title="Load — total inventory loaded onto route trucks from warehouse">
            <span className="tx-stat-label">Load</span>
            <span className="tx-stat-value">{fmt(totalStats.loadTotal)}</span>
          </div>
          <div className="tx-stat" title="Revenue — Gross Sales minus Credits = net amount received from stores">
            <span className="tx-stat-label">Revenue</span>
            <span className="tx-stat-value" style={{ color: '#3b82f6' }}>{fmt(totalStats.netSales)}</span>
          </div>
          <div className="tx-stat" title="Sum of all negative invoices — returns and credit memos that reduce your revenue">
            <span className="tx-stat-label">Credits</span>
            <span className="tx-stat-value tx-negative">{fmt(totalStats.credits)}</span>
          </div>
          <div className="tx-stat" title="Route GP = Revenue minus Route Load (internal transfer price). Shows route-level performance.">
            <span className="tx-stat-label">Route GP</span>
            <span className={`tx-stat-value ${totalStats.netSales - totalStats.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
              {fmt(totalStats.netSales - totalStats.loadTotal)}
            </span>
          </div>
          {totalStats.warehouseLoad > 0 && (
            <div className="tx-stat" title="True Profit = Revenue - Warehouse Cost (supplier cost) — matches DAO Gross Profit report 'Profit Amount'">
              <span className="tx-stat-label">True Profit</span>
              <span className={`tx-stat-value ${totalStats.netSales - totalStats.warehouseLoad >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                {fmt(totalStats.netSales - totalStats.warehouseLoad)}
              </span>
            </div>
          )}
          {totalStats.warehouseLoad > 0 && (
            <div className="tx-stat" title="True Margin = True Profit / Gross Sales — matches DAO Gross Profit report percentage">
              <span className="tx-stat-label">True Margin</span>
              <span className={`tx-stat-value ${totalStats.netSales - totalStats.warehouseLoad >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                {totalStats.grossSales > 0 ? pct((totalStats.netSales - totalStats.warehouseLoad) / totalStats.grossSales * 100) : '0.0%'}
              </span>
            </div>
          )}
          <div className="tx-stat" title="Route Margin — Route GP as a percentage of Revenue: ((Revenue - Route Load) / Revenue) x 100">
            <span className="tx-stat-label">Route Margin</span>
            <span className={`tx-stat-value ${totalStats.netSales - totalStats.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
              {totalStats.netSales !== 0 ? pct((totalStats.netSales - totalStats.loadTotal) / totalStats.netSales * 100) : '0.0%'}
            </span>
          </div>
        </div>
      )}

      {routeAnalysis.length === 0 ? (
        <div
          className={`tx-dropzone${dragOver ? ' drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <p>Drop a .txt file here or click to import</p>
          <p className="tx-dropzone-hint">Click <strong>"Setup"</strong> above for instructions on exporting from the DAO dashboard</p>
        </div>
      ) : (
        <div className="tx-routes">
          {/* Warehouse (Route 99) — source of all inventory */}
          {warehouseData && (
            <div className={`tx-route-card tx-warehouse-card${expandedRoute === '99' ? ' expanded' : ''}`}>
              <div className="tx-route-header" onClick={() => {
                setExpandedRoute(expandedRoute === '99' ? null : '99');
                setExpandedDay(null);
              }}>
                <div className="tx-route-title">
                  <span className="tx-route-num tx-warehouse-label" title="Route 99 — Warehouse source of all inventory. This is your total liability.">Warehouse (Rt 99)</span>
                  <span className="tx-route-dates">{warehouseData.dateRange}</span>
                  <span className="tx-route-count">{warehouseData.transactionCount} txns</span>
                </div>
                <div className="tx-route-metrics">
                  <span className="tx-metric" title="Total inventory loaded at the warehouse — this is the source liability distributed to routes">
                    <span className="tx-metric-label">Total Load</span>
                    <span className="tx-metric-value" style={{ color: '#f59e0b' }}>{fmt(warehouseData.loadTotal)}</span>
                  </span>
                  <span className="tx-metric" title="Gross invoices from warehouse">
                    <span className="tx-metric-label">Gross</span>
                    <span className="tx-metric-value">{fmt(warehouseData.grossSales)}</span>
                  </span>
                  <span className="tx-metric" title="Credits at warehouse level">
                    <span className="tx-metric-label">Credits</span>
                    <span className="tx-metric-value tx-negative">{fmt(warehouseData.credits)}</span>
                  </span>
                  <span className="tx-metric" title="Net invoiced out to routes from warehouse">
                    <span className="tx-metric-label">Invoiced Out</span>
                    <span className="tx-metric-value">{fmt(warehouseData.netSales)}</span>
                  </span>
                  {totalStats && (
                    <span className="tx-metric" title="True Profit = Total Route Revenue minus Warehouse Cost (what you paid the supplier)">
                      <span className="tx-metric-label">True Profit</span>
                      <span className={`tx-metric-value ${totalStats.netSales - warehouseData.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                        {fmt(totalStats.netSales - warehouseData.loadTotal)}
                      </span>
                    </span>
                  )}
                  {totalStats && (
                    <span className="tx-metric" title="True Margin = True Profit / Gross Sales — matches DAO Gross Profit report">
                      <span className="tx-metric-label">True Margin</span>
                      <span className={`tx-metric-value ${totalStats.netSales - warehouseData.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                        {totalStats.grossSales > 0 ? pct((totalStats.netSales - warehouseData.loadTotal) / totalStats.grossSales * 100) : '0.0%'}
                      </span>
                    </span>
                  )}
                </div>
                <span className="tx-expand-icon">{expandedRoute === '99' ? '\u25B2' : '\u25BC'}</span>
              </div>

              {expandedRoute === '99' && (() => {
                const matchup = analyzeWarehouseMatchup(parsed);
                const mismatches = matchup.filter(m => !m.matched);
                return (
                  <div className="tx-route-body">
                    {mismatches.length > 0 && (
                      <div className="tx-wh-alert">
                        {mismatches.length} mismatch{mismatches.length !== 1 ? 'es' : ''} found between warehouse invoices and route loads
                      </div>
                    )}
                    {(() => {
                      const whLoads = dedup(warehouseData.transactions.filter(t => !t.isVoid && (t.docType === 'Load' || t.docType === 'Route Order')));
                      if (whLoads.length === 0) return null;
                      const loadsByDate = {};
                      for (const tx of whLoads) {
                        const date = tx.settlementDate || tx.docDate?.date || '';
                        if (!date) continue;
                        if (!loadsByDate[date]) loadsByDate[date] = [];
                        loadsByDate[date].push(tx);
                      }
                      const sortedDates = Object.keys(loadsByDate).sort();
                      const fmtShort = (ds) => { const p = ds.split('-'); return parseInt(p[1]) + '/' + parseInt(p[2]); };
                      return (
                        <>
                          <div className="tx-wh-section-title" style={{ color: '#f59e0b' }}>Warehouse Loads</div>
                          <table className="tx-day-table tx-wh-loads-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th>ID</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedDates.map(date => {
                                const txs = loadsByDate[date];
                                return txs.map((tx, i) => (
                                  <tr key={tx.id || `${date}-${i}`}>
                                    {i === 0 ? <td rowSpan={txs.length} style={{ fontWeight: 600 }}>{fmtShort(date)}</td> : null}
                                    <td>{tx.docType}</td>
                                    <td className="tx-wh-id">{tx.id || '—'}</td>
                                    <td style={{ fontWeight: 600, color: '#f59e0b' }}>{fmt(tx.amount)}</td>
                                  </tr>
                                ));
                              })}
                              <tr className="tx-wh-loads-total">
                                <td colSpan={3} style={{ fontWeight: 700 }}>Total</td>
                                <td style={{ fontWeight: 700, color: '#f59e0b' }}>{fmt(whLoads.reduce((s, t) => s + t.amount, 0))}</td>
                              </tr>
                            </tbody>
                          </table>
                        </>
                      );
                    })()}

                    <div className="tx-wh-section-title" style={{ color: '#1e3a5f' }}>Invoice Matchup</div>
                    <div className="tx-wh-legend">
                      <span className="tx-wh-legend-title">Status Legend:</span>
                      <span className="tx-wh-legend-item"><span className="tx-wh-legend-dot" style={{ background: '#22c55e' }}></span><strong>OK</strong> — Match</span>
                      <span className="tx-wh-legend-item"><span className="tx-wh-legend-dot" style={{ background: '#ef4444' }}></span><strong>DIFF</strong> — Amounts differ</span>
                      <span className="tx-wh-legend-item"><span className="tx-wh-legend-dot" style={{ background: '#f97316' }}></span><strong>No WH</strong> — Route loaded but no warehouse invoice</span>
                      <span className="tx-wh-legend-item"><span className="tx-wh-legend-dot" style={{ background: '#f97316' }}></span><strong>No Load</strong> — Warehouse invoiced but route didn't record a load</span>
                    </div>
                    <table className="tx-day-table tx-wh-matchup-table">
                      <thead>
                        <tr>
                          <th title="Destination route for the warehouse invoice">Route</th>
                          <th title="Customer name on the warehouse invoice (route # - driver)">Driver</th>
                          <th title="Warehouse invoice date">WH Date</th>
                          <th title="Route load date (may be next day if loaded the evening before)">Load Date</th>
                          <th title="Warehouse invoice document ID">ID</th>
                          <th title="Amount invoiced by warehouse (Rt 99) for this route's load">WH Invoice</th>
                          <th title="Amount the route recorded as loaded from warehouse">Route Load</th>
                          <th title="Difference: WH Invoice minus Route Load. Should be $0 if loaded correctly">Diff</th>
                          <th title="Match status — green check if amounts match, red X if mismatch">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchup.map(m => (
                          <tr key={`${m.route}-${m.date}`} className={m.matched ? '' : 'tx-wh-mismatch-row'}>
                            <td style={{ fontWeight: 700 }}>Rt {m.route}</td>
                            <td className="tx-wh-driver">{m.custName.replace(/^\d+\s*-\s*/, '')}</td>
                            <td>{m.hasWarehouse ? m.dateFormatted : '—'}</td>
                            <td>{m.hasRouteLoad ? m.loadDateFormatted : '—'}</td>
                            <td className="tx-wh-id">{m.invoiceId || '—'}</td>
                            <td style={{ color: m.hasWarehouse ? '#f59e0b' : '#9ca3af', fontWeight: 600 }}>
                              {m.hasWarehouse ? fmt(m.warehouseAmount) : '—'}
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              {m.hasRouteLoad ? fmt(m.routeLoadAmount) : '—'}
                            </td>
                            <td className={Math.abs(m.difference) > 0.01 ? 'tx-negative' : ''} style={{ fontWeight: 600 }}>
                              {Math.abs(m.difference) < 0.01 ? '$0.00' : fmt(m.difference)}
                            </td>
                            <td>
                              {m.matched
                                ? <span style={{ color: '#22c55e', fontWeight: 700 }} title="Warehouse invoice matches route load">OK</span>
                                : !m.hasWarehouse
                                  ? <span style={{ color: '#f97316', fontWeight: 700 }} title="Route has a load but no matching warehouse invoice">No WH</span>
                                  : !m.hasRouteLoad
                                    ? <span style={{ color: '#f97316', fontWeight: 700 }} title="Warehouse invoiced this route but no load was recorded">No Load</span>
                                    : <span style={{ color: '#ef4444', fontWeight: 700 }} title={`Amounts differ by ${fmt(m.difference)}`}>DIFF</span>
                              }
                            </td>
                          </tr>
                        ))}
                        {matchup.length === 0 && (
                          <tr><td colSpan={9} className="tx-empty-cell">No warehouse invoice data to match</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          {routeAnalysis.map(r => (
            <div key={r.route} className={`tx-route-card${expandedRoute === r.route ? ' expanded' : ''}`}>
              <div className="tx-route-header" onClick={() => {
                setExpandedRoute(expandedRoute === r.route ? null : r.route);
                setExpandedDay(null);
              }}>
                <div className="tx-route-title">
                  <span className={`tx-route-num${r.isStorage ? ' tx-storage-label' : ''}`} title={r.isStorage ? `Route ${r.route} — Storage delivery truck. Loads are internal supply movements; only store invoices count for revenue.` : r.subRoutes.length > 0 ? `Route ${r.route} combined with sub-route${r.subRoutes.length > 1 ? 's' : ''} ${r.subRoutes.join(', ')} — click to expand daily breakdown` : `Route ${r.route} — click to expand daily breakdown`}>Route {r.displayRoute}{r.isStorage ? ' (Storage)' : ''}</span>
                  <span className="tx-route-dates" title="Date range of transactions for this route">{r.dateRange}</span>
                  <span className="tx-route-count" title="Total number of transaction records for this route">{r.transactionCount} txns</span>
                </div>
                <div className="tx-route-metrics">
                  <span className="tx-metric" title={r.isStorage ? "Storage route — loads are internal supply movements, not counted as COGS" : "Load — inventory loaded from warehouse onto the truck for this route"}>
                    <span className="tx-metric-label">Load</span>
                    <span className="tx-metric-value" style={r.isStorage ? { color: '#9ca3af', textDecoration: 'line-through' } : {}}>{r.isStorage ? fmt(r.rawLoadTotal) : fmt(r.loadTotal)}</span>
                  </span>
                  <span className="tx-metric" title="Gross revenue from store invoices before credits/returns">
                    <span className="tx-metric-label">Gross</span>
                    <span className="tx-metric-value">{fmt(r.grossSales)}</span>
                  </span>
                  <span className="tx-metric" title="Returns and credit memos that reduce revenue">
                    <span className="tx-metric-label">Credits</span>
                    <span className="tx-metric-value tx-negative">{fmt(r.credits)}</span>
                  </span>
                  <span className="tx-metric" title="Revenue — net amount from stores (Gross minus Credits)">
                    <span className="tx-metric-label">Revenue</span>
                    <span className="tx-metric-value" style={{ color: '#3b82f6' }}>{fmt(r.netSales)}</span>
                  </span>
                  <span className="tx-metric" title={`Gross Profit = Revenue minus Load: ${fmt(r.netSales - r.loadTotal)}`}>
                    <span className="tx-metric-label">GP</span>
                    <span className={`tx-metric-value ${r.netSales - r.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>{fmt(r.netSales - r.loadTotal)}</span>
                  </span>
                  <span className="tx-metric" title={`Gross Margin: ${totalStats ? pct((r.netSales - r.loadTotal) / (r.netSales || 1) * 100) : '0%'} — Gross Profit as % of Revenue`}>
                    <span className="tx-metric-label">Margin</span>
                    <span className={`tx-metric-value ${r.netSales - r.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                      {r.netSales !== 0 ? pct((r.netSales - r.loadTotal) / r.netSales * 100) : '0.0%'}
                    </span>
                  </span>
                  <span className="tx-metric" title="Number of unique stores/customers invoiced on this route">
                    <span className="tx-metric-label">Stores</span>
                    <span className="tx-metric-value">{r.storeCount}</span>
                  </span>
                  {(r.dsdOk + r.dsdMissing) > 0 && (
                    <span className="tx-metric" title={`DSD (Direct Store Delivery) compliance: ${r.dsdOk} OK, ${r.dsdMissing} Missing. Measures whether the driver properly scanned deliveries at the store`}>
                      <span className="tx-metric-label">DSD</span>
                      <span className={`tx-metric-value ${r.dsdCompliance >= 80 ? 'tx-sell-good' : 'tx-sell-bad'}`}>
                        {pct(r.dsdCompliance)}
                      </span>
                    </span>
                  )}
                  {r.voidCount > 0 && (
                    <span className="tx-metric" title={`${r.voidCount} void transaction${r.voidCount !== 1 ? 's' : ''} (${fmt(r.voidTotal)}) — not counted in totals`}>
                      <span className="tx-metric-label">Voids</span>
                      <span className="tx-metric-value" style={{ color: '#9ca3af' }}>{r.voidCount}</span>
                    </span>
                  )}
                </div>
                {Object.keys(r.paymentBreakdown).length > 1 && (
                  <div className="tx-payment-breakdown">
                    {Object.entries(r.paymentBreakdown).sort((a, b) => b[1].total - a[1].total).map(([method, data]) => (
                      <span key={method} className="tx-payment-item" title={`${method}: ${data.count} invoice${data.count !== 1 ? 's' : ''} totaling ${fmt(data.total)}`}>
                        <span className="tx-payment-method">{method}</span>
                        <span className="tx-payment-amount">{fmt(data.total)}</span>
                      </span>
                    ))}
                  </div>
                )}
                <span className="tx-expand-icon">{expandedRoute === r.route ? '\u25B2' : '\u25BC'}</span>
              </div>

              {r.subRoutes.length > 0 && (() => {
                const breakdown = getSubRouteBreakdown(r);
                if (!breakdown) return null;
                return (
                  <div className="tx-subroute-breakdown">
                    {breakdown.map(sub => (
                      <div key={sub.route} className="tx-subroute-row" title={`Individual data for route ${sub.route}`}>
                        <span className="tx-subroute-label">Rt {sub.route}</span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">Load</span> {fmt(sub.loadTotal)}
                        </span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">Sales</span> {fmt(sub.grossSales)}
                        </span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">Credits</span> <span className="tx-negative">{fmt(sub.credits)}</span>
                        </span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">Net</span> {fmt(sub.netSales)}
                        </span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">ST</span> <span className={sellClass(sub.sellThrough)}>{pct(sub.sellThrough)}</span>
                        </span>
                        <span className="tx-subroute-metric">
                          <span className="tx-subroute-name">Stores</span> {sub.storeCount}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {expandedRoute === r.route && (
                <div className="tx-route-body">
                  <table className="tx-day-table">
                    <thead>
                      <tr>
                        <th title="Settlement date — the date the transactions were finalized">Date</th>
                        <th title="Load — inventory loaded onto the truck that day">Load</th>
                        <th title="Sum of positive invoices — revenue before credits">Gross</th>
                        <th title="Sum of negative invoices — returns and adjustments">Credits</th>
                        <th title="Revenue — Gross minus Credits">Revenue</th>
                        <th title="Gross Profit = Revenue minus Load">GP</th>
                        <th title="Gross Margin — GP as percentage of Revenue">Margin</th>
                        <th title="Number of unique stores/customers invoiced that day">Stores</th>
                        <th title="Total transaction records for that day">Txns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyDayAnalysis.length > 1
                        ? weeklyDayAnalysis.map(week => (
                          <React.Fragment key={week.sunday}>
                            <tr className="tx-week-header-row">
                              <td colSpan={9}>{week.label}</td>
                            </tr>
                            {week.days.map(d => (
                              <React.Fragment key={d.date}>
                                <tr
                                  className={`tx-day-row${expandedDay === d.date ? ' expanded' : ''}`}
                                  onClick={() => setExpandedDay(expandedDay === d.date ? null : d.date)}
                                  title="Click to see individual store transactions for this day"
                                >
                                  <td>{d.dateFormatted}</td>
                                  <td>{fmt(d.loadTotal)}</td>
                                  <td>{fmt(d.grossSales)}</td>
                                  <td className="tx-negative">{fmt(d.credits)}</td>
                                  <td>{fmt(d.netSales)}</td>
                                  <td className={d.netSales - d.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>{fmt(d.netSales - d.loadTotal)}</td>
                                  <td className={d.netSales - d.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>
                                    {d.netSales !== 0 ? pct((d.netSales - d.loadTotal) / d.netSales * 100) : '0.0%'}
                                  </td>
                                  <td>{d.storeCount}</td>
                                  <td>{d.transactionCount}</td>
                                </tr>
                                {expandedDay === d.date && (
                                  <tr className="tx-store-detail-row">
                                    <td colSpan={9}>
                                      <table className="tx-store-table">
                                        <thead>
                                          <tr>
                                            <th title="Store or customer name from the DAO system">Customer</th>
                                            <th title="DAO customer number — unique identifier for this store">Cust #</th>
                                            <th title="Transaction type: Invoice (sale/credit), Delivery (proof of delivery), Load (truck loaded), Settle (day closed)">Type</th>
                                            <th title="DAO document ID — unique identifier for this transaction">ID</th>
                                            <th title="Dollar amount — positive = sale, negative = credit/return. Void transactions are shown but not counted in totals.">Amount</th>
                                            <th title="Payment method — Charge, Cash, Check, etc.">Pay</th>
                                            <th title="DSD (Direct Store Delivery) scan status: OK = scanned at store, Missing = not scanned, blank = not applicable">DSD</th>
                                            <th title="Time of day the transaction was recorded">Time</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {storeAnalysis.length > 0 ? storeAnalysis.map(s => (
                                            s.transactions.map((tx, i) => (
                                              <tr key={tx.id || i} className={`${tx.amount < 0 ? 'tx-credit-row' : ''}${tx.isVoid ? ' tx-void-row' : ''}`}>
                                                {i === 0 ? (
                                                  <td rowSpan={s.transactions.length} className="tx-store-name">{s.custName}</td>
                                                ) : null}
                                                {i === 0 ? (
                                                  <td rowSpan={s.transactions.length}>{s.custNum}</td>
                                                ) : null}
                                                <td title={{
                                                  'Invoice': 'Invoice — a sale (positive) or credit/return (negative) to the store',
                                                  'Delivery': 'Delivery — proof that product was physically delivered to the store',
                                                  'Load': 'Load — inventory loaded onto the truck at the warehouse',
                                                  'Settle': 'Settle — route settlement, closing out the day',
                                                  'Route Order': 'Route Order — order placed for truck loading',
                                                  'Truck Inventory': 'Truck Inventory — end-of-day truck inventory count',
                                                  'Dex Audit Trail': 'Dex Audit Trail — electronic data exchange audit record',
                                                }[tx.docType] || tx.docType}>{tx.docType}{tx.isVoid ? ' (VOID)' : ''}</td>
                                                <td className="tx-wh-id">{tx.id || '—'}</td>
                                                <td className={tx.isVoid ? 'tx-void-amount' : tx.amount < 0 ? 'tx-negative' : ''} title={tx.isVoid ? 'VOID — not counted in totals' : tx.amount < 0 ? 'Credit/return — this amount is subtracted from gross sales' : 'Sale amount invoiced to the store'}>{tx.isVoid ? <s>{fmt(tx.amount)}</s> : fmt(tx.amount)}</td>
                                                <td className="tx-payment-type" title={tx.invoiceType ? `Payment: ${tx.invoiceType}` : ''}>{tx.invoiceType || ''}</td>
                                                <td title={tx.dsd === 'OK' ? 'Driver scanned delivery at the store' : tx.dsd === 'Missing' ? 'Driver did NOT scan delivery — DSD compliance issue' : 'DSD scan not applicable for this transaction type'}>{tx.dsd}</td>
                                                <td title="Time the transaction was recorded in the DAO system">{tx.docDate?.time || ''}</td>
                                              </tr>
                                            ))
                                          )) : (
                                            <tr><td colSpan={8} className="tx-empty-cell">No store data for this day</td></tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                            <tr className="tx-week-total-row" title={`Weekly total for ${week.label}`}>
                              <td>{week.label.split(' (')[0]} Total</td>
                              <td>{fmt(week.loadTotal)}</td>
                              <td>{fmt(week.grossSales)}</td>
                              <td className="tx-negative">{fmt(week.credits)}</td>
                              <td>{fmt(week.netSales)}</td>
                              <td className={week.netSales - week.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>{fmt(week.netSales - week.loadTotal)}</td>
                              <td className={week.netSales - week.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>
                                {week.netSales !== 0 ? pct((week.netSales - week.loadTotal) / week.netSales * 100) : '0.0%'}
                              </td>
                              <td>{week.storeCount}</td>
                              <td>{week.transactionCount}</td>
                            </tr>
                          </React.Fragment>
                        ))
                        : dayAnalysis.map(d => (
                          <React.Fragment key={d.date}>
                            <tr
                              className={`tx-day-row${expandedDay === d.date ? ' expanded' : ''}`}
                              onClick={() => setExpandedDay(expandedDay === d.date ? null : d.date)}
                              title="Click to see individual store transactions for this day"
                            >
                              <td>{d.dateFormatted}</td>
                              <td>{fmt(d.loadTotal)}</td>
                              <td>{fmt(d.grossSales)}</td>
                              <td className="tx-negative">{fmt(d.credits)}</td>
                              <td>{fmt(d.netSales)}</td>
                              <td className={d.netSales - d.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>{fmt(d.netSales - d.loadTotal)}</td>
                              <td className={d.netSales - d.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}>
                                {d.netSales !== 0 ? pct((d.netSales - d.loadTotal) / d.netSales * 100) : '0.0%'}
                              </td>
                              <td>{d.storeCount}</td>
                              <td>{d.transactionCount}</td>
                            </tr>
                            {expandedDay === d.date && (
                              <tr className="tx-store-detail-row">
                                <td colSpan={9}>
                                  <table className="tx-store-table">
                                    <thead>
                                      <tr>
                                        <th title="Store or customer name from the DAO system">Customer</th>
                                        <th title="DAO customer number — unique identifier for this store">Cust #</th>
                                        <th title="Transaction type: Invoice (sale/credit), Delivery (proof of delivery), Load (truck loaded), Settle (day closed)">Type</th>
                                        <th title="DAO document ID — unique identifier for this transaction">ID</th>
                                        <th title="Dollar amount — positive = sale, negative = credit/return. Void transactions are shown but not counted in totals.">Amount</th>
                                        <th title="Payment method — Charge, Cash, Check, etc.">Pay</th>
                                        <th title="DSD (Direct Store Delivery) scan status: OK = scanned at store, Missing = not scanned, blank = not applicable">DSD</th>
                                        <th title="Time of day the transaction was recorded">Time</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {storeAnalysis.length > 0 ? storeAnalysis.map(s => (
                                        s.transactions.map((tx, i) => (
                                          <tr key={tx.id || i} className={`${tx.amount < 0 ? 'tx-credit-row' : ''}${tx.isVoid ? ' tx-void-row' : ''}`}>
                                            {i === 0 ? (
                                              <td rowSpan={s.transactions.length} className="tx-store-name">{s.custName}</td>
                                            ) : null}
                                            {i === 0 ? (
                                              <td rowSpan={s.transactions.length}>{s.custNum}</td>
                                            ) : null}
                                            <td title={{
                                              'Invoice': 'Invoice — a sale (positive) or credit/return (negative) to the store',
                                              'Delivery': 'Delivery — proof that product was physically delivered to the store',
                                              'Load': 'Load — inventory loaded onto the truck at the warehouse',
                                              'Settle': 'Settle — route settlement, closing out the day',
                                              'Route Order': 'Route Order — order placed for truck loading',
                                              'Truck Inventory': 'Truck Inventory — end-of-day truck inventory count',
                                              'Dex Audit Trail': 'Dex Audit Trail — electronic data exchange audit record',
                                            }[tx.docType] || tx.docType}>{tx.docType}{tx.isVoid ? ' (VOID)' : ''}</td>
                                            <td className="tx-wh-id">{tx.id || '—'}</td>
                                            <td className={tx.isVoid ? 'tx-void-amount' : tx.amount < 0 ? 'tx-negative' : ''} title={tx.isVoid ? 'VOID — not counted in totals' : tx.amount < 0 ? 'Credit/return — this amount is subtracted from gross sales' : 'Sale amount invoiced to the store'}>{tx.isVoid ? <s>{fmt(tx.amount)}</s> : fmt(tx.amount)}</td>
                                            <td className="tx-payment-type" title={tx.invoiceType ? `Payment: ${tx.invoiceType}` : ''}>{tx.invoiceType || ''}</td>
                                            <td title={tx.dsd === 'OK' ? 'Driver scanned delivery at the store' : tx.dsd === 'Missing' ? 'Driver did NOT scan delivery — DSD compliance issue' : 'DSD scan not applicable for this transaction type'}>{tx.dsd}</td>
                                            <td title="Time the transaction was recorded in the DAO system">{tx.docDate?.time || ''}</td>
                                          </tr>
                                        ))
                                      )) : (
                                        <tr><td colSpan={8} className="tx-empty-cell">No store data for this day</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* Totals footer */}
          {totalStats && (
            <div className="tx-totals-bar" title="Warehouse (Rt 99) is the source — Load = liability sent out, Revenue = profit returned from stores">
              <span className="tx-totals-label">TOTALS</span>
              <div className="tx-totals-metrics">
                {totalStats.warehouseLoad > 0 && (
                  <span className="tx-totals-item" title="Total warehouse (Rt 99) value — the source of all inventory">
                    <span className="tx-totals-name">Warehouse</span>
                    <span className="tx-totals-value" style={{ color: '#fbbf24' }}>{fmt(totalStats.warehouseLoad)}</span>
                  </span>
                )}
                <span className="tx-totals-item" title="Load — total inventory loaded from warehouse onto route trucks">
                  <span className="tx-totals-name">Load</span>
                  <span className="tx-totals-value">{fmt(totalStats.loadTotal)}</span>
                </span>
                <span className="tx-totals-item" title="Gross revenue from all store invoices before credits">
                  <span className="tx-totals-name">Gross</span>
                  <span className="tx-totals-value">{fmt(totalStats.grossSales)}</span>
                </span>
                <span className="tx-totals-item" title="Total credits/returns that reduce revenue">
                  <span className="tx-totals-name">Credits</span>
                  <span className="tx-totals-value tx-negative">{fmt(totalStats.credits)}</span>
                </span>
                <span className="tx-totals-item" title="Revenue — net amount from all stores (Gross minus Credits)">
                  <span className="tx-totals-name">Revenue</span>
                  <span className="tx-totals-value tx-totals-net">{fmt(totalStats.netSales)}</span>
                </span>
                <span className="tx-totals-item" title="Route GP = Revenue minus Route Load (internal transfer price)">
                  <span className="tx-totals-name">Route GP</span>
                  <span className={`tx-totals-value ${totalStats.netSales - totalStats.loadTotal >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                    {fmt(totalStats.netSales - totalStats.loadTotal)}
                  </span>
                </span>
                {totalStats.warehouseLoad > 0 && (
                  <span className="tx-totals-item" title="True Profit = Revenue minus Warehouse Cost (what you paid the supplier)">
                    <span className="tx-totals-name">True Profit</span>
                    <span className={`tx-totals-value ${totalStats.netSales - totalStats.warehouseLoad >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                      {fmt(totalStats.netSales - totalStats.warehouseLoad)}
                    </span>
                  </span>
                )}
                {totalStats.warehouseLoad > 0 && (
                  <span className="tx-totals-item" title="True Margin = True Profit / Gross Sales — matches DAO Gross Profit report">
                    <span className="tx-totals-name">True Margin</span>
                    <span className={`tx-totals-value ${totalStats.netSales - totalStats.warehouseLoad >= 0 ? 'tx-sell-good' : 'tx-negative'}`}>
                      {totalStats.grossSales > 0 ? pct((totalStats.netSales - totalStats.warehouseLoad) / totalStats.grossSales * 100) : '0.0%'}
                    </span>
                  </span>
                )}
                <span className="tx-totals-item" title="Credit rate — credits as a percentage of gross revenue">
                  <span className="tx-totals-name">Credit Rate</span>
                  <span className="tx-totals-value tx-negative">
                    {totalStats.grossSales > 0 ? pct(Math.abs(totalStats.credits) / totalStats.grossSales * 100) : '0.0%'}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

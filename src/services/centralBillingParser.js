import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// Extract text lines from PDF, grouped by y-coordinate (preserves columns)
async function extractTextLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  const allLines = [];

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const content = await page.getTextContent();

    // Group text items by y-coordinate (round to 3px tolerance)
    const map = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!map.has(y)) map.set(y, []);
      map.get(y).push({ x: item.transform[4], text: item.str });
    }

    // Sort by y descending (PDF coords go bottom-up), join items left-to-right
    const ys = [...map.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const parts = map.get(y).sort((a, b) => a.x - b.x);
      const line = parts.map(p => p.text.trim()).filter(Boolean).join(' ').trim();
      if (line) allLines.push(line);
    }
  }

  return allLines;
}

// Try parsing an invoice line in spaced-column format:
// "AMW00293  206  Acme  02932061219  03/13/2026  -24.70  -24.70  P"
function parseSpacedLine(line, currentChain, currentStore) {
  const m = line.match(
    /^([A-Z]{2,4}\d{4,7})\s+(\d{3})\s+(.+?)\s+(\d{5,15})\s+(\d{2}\/\d{2}\/\d{4})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+P\s*$/
  );
  if (!m) return null;
  return {
    chain: currentChain,
    storeId: m[1],
    route: m[2],
    storeName: m[3].trim(),
    invoiceNumber: m[4],
    date: m[5],
    netAmount: parseFloat(m[6].replace(/,/g, '')),
    cbAmount: parseFloat(m[7].replace(/,/g, '')),
    status: 'P',
  };
}

// Try parsing an invoice line where store header was on a previous line
// and this line is just: "invoiceNumber  date  netAmt  cbAmt  P"
function parseInvoiceOnlyLine(line, currentChain, currentStore) {
  if (!currentStore) return null;
  const m = line.match(
    /^(\d{5,15})\s+(\d{2}\/\d{2}\/\d{4})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+P\s*$/
  );
  if (!m) return null;
  return {
    chain: currentChain,
    storeId: currentStore.storeId,
    route: currentStore.route,
    storeName: currentStore.storeName,
    invoiceNumber: m[1],
    date: m[2],
    netAmount: parseFloat(m[3].replace(/,/g, '')),
    cbAmount: parseFloat(m[4].replace(/,/g, '')),
    status: 'P',
  };
}

// Try parsing a concatenated invoice line (pdf-parse style):
// "AMW00293206Acme 02932061219 03/13/2026-24.70-24.70P"
function parseConcatenatedLine(line, currentChain, currentStore) {
  // Anchor on date MM/DD/YYYY
  const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!dateMatch) return null;

  const dateIdx = line.indexOf(dateMatch[0]);
  const before = line.slice(0, dateIdx).trim();
  const after = line.slice(dateIdx + 10).trim();

  // After date: two amounts and P
  const amtMatch = after.match(/^(-?[\d,]+\.?\d*)\s*(-?[\d,]+\.?\d*)\s*P\s*$/);
  if (!amtMatch) return null;

  const netAmount = parseFloat(amtMatch[1].replace(/,/g, ''));
  const cbAmount = parseFloat(amtMatch[2].replace(/,/g, ''));

  // If we have a current store context, before is just the invoice number
  if (currentStore) {
    const numOnly = before.match(/^(\d{5,15})\s*$/);
    if (numOnly) {
      return {
        chain: currentChain,
        storeId: currentStore.storeId,
        route: currentStore.route,
        storeName: currentStore.storeName,
        invoiceNumber: numOnly[1],
        date: dateMatch[0],
        netAmount,
        cbAmount,
        status: 'P',
      };
    }
  }

  // before = storeId + route + storeName + invoiceNumber
  // storeId: [A-Z]{2,4}\d{4,7}, route: \d{3}
  const storeRouteM = before.match(/^([A-Z]{2,4}\d{4,7})(\d{3})(.*?)(\d{5,15})\s*$/);
  if (!storeRouteM) return null;

  return {
    chain: currentChain,
    storeId: storeRouteM[1],
    route: storeRouteM[2],
    storeName: storeRouteM[3].trim(),
    invoiceNumber: storeRouteM[4],
    date: dateMatch[0],
    netAmount,
    cbAmount,
    status: 'P',
  };
}

function parseInvoiceLine(line, currentChain, currentStore) {
  return (
    parseSpacedLine(line, currentChain, currentStore) ||
    parseInvoiceOnlyLine(line, currentChain, currentStore) ||
    parseConcatenatedLine(line, currentChain, currentStore)
  );
}

function parseLines(lines) {
  const result = {
    batchNumber: null,
    transmitFile: null,
    endDate: null,
    runDate: null,
    batchTotal: null,
    invoices: [],
    _debugLines: lines.slice(0, 40), // first 40 lines for debugging
  };

  let currentChain = '';
  let currentStore = null;

  const SKIP_PATTERNS = [
    /ACCT|ROUTE|STORE NAME|INVOICE|STAT|PAGE|NET AMT|CB AMT/i,
    /^\s*-+\s*$/, // separator lines
  ];

  for (const line of lines) {
    // Metadata
    const batchM = line.match(/BATCH\s+(\d+)/i);
    if (batchM && !result.batchNumber) result.batchNumber = batchM[1];

    const transM = line.match(/TRANS(?:MIT)?\s+FILE\s+([\w.]+)/i);
    if (transM) result.transmitFile = transM[1];

    const endM = line.match(/END\s+DATE\s+([\d/]+)/i);
    if (endM) result.endDate = endM[1];

    const runM = line.match(/RUN\s+DATE\s+([\d/]+)/i);
    if (runM) result.runDate = runM[1];

    const totM = line.match(/BATCH\s+TOTAL[:\s]+([\d,]+\.?\d*)/i);
    if (totM) result.batchTotal = parseFloat(totM[1].replace(/,/g, ''));

    // Skip header/separator lines
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;

    // Invoice line: contains a date and ends with P
    if (/\d{2}\/\d{2}\/\d{4}/.test(line) && /P\s*$/.test(line)) {
      const inv = parseInvoiceLine(line, currentChain, currentStore);
      if (inv) {
        result.invoices.push(inv);
        continue;
      }
    }

    // Store header: UPPERCASE+digits  route  Name (no date slash)
    if (!/\d{2}\/\d{2}\/\d{4}/.test(line)) {
      const storeM = line.match(/^([A-Z]{2,4}\d{4,7})\s+(\d{3})\s+(.+)$/);
      if (storeM) {
        currentStore = {
          storeId: storeM[1],
          route: storeM[2],
          storeName: storeM[3].trim(),
        };
        continue;
      }
    }

    // Chain header: mostly uppercase, no digits, reasonable length
    const trimmed = line.trim();
    if (
      /^[A-Z][A-Z\s&',.#-]+$/.test(trimmed) &&
      trimmed.length >= 3 &&
      trimmed.length <= 60 &&
      !/BATCH|TRANS|DATE|ROUTE|ACCT|TOTAL|PAGE|INVOICE|STAT|CENTRAL|BILL|LIST/i.test(trimmed)
    ) {
      currentChain = trimmed;
    }
  }

  return result;
}

export async function parseCentralBillingPdf(file) {
  const lines = await extractTextLines(file);
  const parsed = parseLines(lines);
  return parsed;
}

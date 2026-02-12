const fs = require('fs');

// Route 201 feed data
const feed = [
  { id: 'MTW06078', lastSale: '02/12/2026' },
  { id: 'MTW06102', lastSale: '02/06/2026' },
  { id: 'MTW06107', lastSale: '02/12/2026' },
  { id: 'MTW06282', lastSale: '02/12/2026' },
  { id: 'MTW06283', lastSale: '02/12/2026' },
  { id: 'MTW06295', lastSale: '02/12/2026' },
  { id: 'MTW06299', lastSale: '02/12/2026' },
  { id: 'MTW06557', lastSale: '02/10/2026' },
  { id: 'MTW06558', lastSale: '02/12/2026' },
  { id: 'MTW06560', lastSale: '02/03/2026' },
  { id: 'GTW06104', lastSale: '02/10/2026' },
  { id: 'GTW06275', lastSale: '02/10/2026' },
  { id: 'GTW06444', lastSale: '02/10/2026' },
  { id: 'GTW06556', lastSale: '02/10/2026' },
];

function parseLastSale(dateStr) {
  if (!dateStr) return '';
  const [m, d, y] = dateStr.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ---- Process stores.csv ----
const csvPath = 'src/data/stores.csv';
const lines = fs.readFileSync(csvPath, 'utf8').split('\n');

const feedMap = {};
feed.forEach(f => { feedMap[f.id] = f; });

let dateUpdated = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cols = lines[i].split(',');
  const currentId = cols[0];

  if (feedMap[currentId]) {
    const feedEntry = feedMap[currentId];
    if (feedEntry.lastSale) {
      const ymd = parseLastSale(feedEntry.lastSale);
      const currentLast = cols[cols.length - 1].trim();
      const currentYmd = currentLast ? currentLast.split('T')[0].split(' ')[0] : '';
      if (ymd !== currentYmd) {
        cols[cols.length - 1] = ymd;
        lines[i] = cols.join(',');
        dateUpdated++;
        console.log(`Date update: ${currentId} ${currentYmd || '(none)'} → ${ymd}`);
      } else {
        console.log(`Already current: ${currentId} = ${ymd}`);
      }
    }
  }
}

fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\n--- stores.csv summary ---`);
console.log(`Date updates: ${dateUpdated}`);

// ---- Process visitHistory.js ----
const vhPath = 'src/data/visitHistory.js';
let vhContent = fs.readFileSync(vhPath, 'utf8');

const startMatch = vhContent.indexOf('{');
const endMatch = vhContent.lastIndexOf('}');
const objStr = vhContent.substring(startMatch, endMatch + 1);

const entries = {};
const entryRegex = /'([^']+)'\s*:\s*\[([^\]]*)\]/g;
let match;
while ((match = entryRegex.exec(objStr)) !== null) {
  const id = match[1];
  const dates = match[2] ? match[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
  entries[id] = dates;
}

let vhUpdated = 0;
feed.forEach(f => {
  if (!f.lastSale) return;
  const ymd = parseLastSale(f.lastSale);
  if (!ymd) return;
  if (!entries[f.id]) entries[f.id] = [];
  if (!entries[f.id].includes(ymd)) {
    entries[f.id].push(ymd);
    entries[f.id].sort();
    vhUpdated++;
    console.log(`Visit history add: ${f.id} += ${ymd}`);
  } else {
    console.log(`Visit history exists: ${f.id} already has ${ymd}`);
  }
});

// Rebuild visitHistory.js
const sortedIds = Object.keys(entries).sort();
let newVh = `// Visit history data - maps store ID to array of visit dates (YYYY-MM-DD)
// Updated when new visit data is processed
const visitHistory = {\n`;
sortedIds.forEach((id, i) => {
  const dates = entries[id].map(d => `'${d}'`).join(', ');
  newVh += `  '${id}': [${dates}]${i < sortedIds.length - 1 ? ',' : ''}\n`;
});
newVh += `};\n\nexport default visitHistory;\n`;

fs.writeFileSync(vhPath, newVh);
console.log(`\nVisit history entries updated: ${vhUpdated}`);
console.log('Done!');

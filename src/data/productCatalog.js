/**
 * Warehouse Order Product Catalog
 * Source: "Warehouse Orders 2026" Google Sheet
 *
 * Each product: { sku, category, type, desc, price (cost per unit), retail (selling price per unit), upc (units per case) }
 * price = jobber cost per unit (what we pay)
 * retail = suggested retail / selling price per unit
 * upc = units per case (bags, bottles, etc.)
 */

export const PRODUCT_CATEGORIES = [
  'Deep River Small',
  'Deep River Grab & Go',
  'Deep River Large',
  '.50 Cents',
  '2.49 Products',
  '4.79 Products',
  'Salsa & Dips',
  'Variety Packs',
  'Crunch Time',
  'Candy',
  'Snacks',
  'Smoothies',
];

export const PRODUCT_CATALOG = [
  // ── DEEP RIVER SMALL ($1.49 retail, $1.05 cost) ──
  { sku: '000040', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Original Chips',          price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000042', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Salt & Vinegar',          price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000051', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Dill Pickle',             price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000043', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Jalapeno Chips',          price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000045', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR BBQ Chips',               price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000049', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Sour Cream & Onion',      price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000046', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Rosemary & Olive Oil',    price: 1.05, retail: 1.49, upc: 24 },
  { sku: '000041', category: 'Deep River Small', type: 'D/RIV/S', desc: 'DR Cracked Pepper & Sea Salt', price: 1.05, retail: 1.49, upc: 24 },

  // ── DEEP RIVER GRAB & GO ($1.15 retail, $0.62 cost) ──
  { sku: '020251', category: 'Deep River Grab & Go', type: 'D/RIV/GG', desc: 'DR Mesquite BBQ 1.3oz',       price: 0.62, retail: 1.15, upc: 24 },
  { sku: '020281', category: 'Deep River Grab & Go', type: 'D/RIV/GG', desc: 'DR Zesty Jalapeno 1.3oz',     price: 0.62, retail: 1.15, upc: 24 },

  // ── DEEP RIVER LARGE ($5.49 retail, $3.70 cost) ──
  { sku: '010008', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Orig Salted Kettle',      price: 3.70, retail: 5.49, upc: 12 },
  { sku: '010009', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Mesquite BBQ',            price: 3.70, retail: 5.49, upc: 12 },
  { sku: '010010', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Salt & Vinegar',          price: 3.70, retail: 5.49, upc: 12 },
  { sku: '010011', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Sweet Maui Onion',        price: 3.70, retail: 5.49, upc: 12 },
  { sku: '010012', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Zesty Jalapeno',          price: 3.70, retail: 5.49, upc: 12 },
  { sku: '010013', category: 'Deep River Large', type: 'D/RIV/L', desc: 'DR Sour Cream & Onion',      price: 3.70, retail: 5.49, upc: 12 },

  // ── .50 CENTS ($0.50 retail, $0.36 cost) ──
  { sku: '027124', category: '.50 Cents', type: 'CHIPS',   desc: 'Plain Chips',              price: 0.36, retail: 0.50, upc: 40 },
  { sku: '027185', category: '.50 Cents', type: 'CHIPS',   desc: 'Honey BBQ Chips',          price: 0.36, retail: 0.50, upc: 40 },
  { sku: '028748', category: '.50 Cents', type: 'CHIPS',   desc: 'Onion & Garlic Chips',     price: 0.36, retail: 0.50, upc: 40 },
  { sku: '027519', category: '.50 Cents', type: 'CHIPS',   desc: 'BBQ Chips',                price: 0.36, retail: 0.50, upc: 40 },
  { sku: '028749', category: '.50 Cents', type: 'RIDGIES', desc: 'Cheddar & SC Ridgies',     price: 0.36, retail: 0.50, upc: 40 },
  { sku: '027511', category: '.50 Cents', type: 'RIDGIES', desc: 'Sour Cream & Onion Ridgies', price: 0.36, retail: 0.50, upc: 40 },
  { sku: '028758', category: '.50 Cents', type: 'CHIPS',   desc: 'NY Deli Jalapeno',         price: 0.36, retail: 0.50, upc: 40 },
  { sku: '028757', category: '.50 Cents', type: 'CHIPS',   desc: 'Orig NY Deli',             price: 0.36, retail: 0.50, upc: 40 },
  { sku: '027197', category: '.50 Cents', type: 'POPCORN', desc: 'White Cheddar Popcorn',    price: 0.36, retail: 0.50, upc: 42 },
  { sku: '027036', category: '.50 Cents', type: 'POPCORN', desc: 'Butter Popcorn',           price: 0.36, retail: 0.50, upc: 42 },
  { sku: '028635', category: '.50 Cents', type: 'POPCORN', desc: 'Hot Cheese Popcorn',       price: 0.36, retail: 0.50, upc: 42 },
  { sku: '027064', category: '.50 Cents', type: 'DIPSY',   desc: 'Dipsy Doodles',            price: 0.36, retail: 0.50, upc: 42 },
  { sku: '028768', category: '.50 Cents', type: 'DIPSY',   desc: 'BBQ Dipsy Doodles',        price: 0.36, retail: 0.50, upc: 42 },
  { sku: '027388', category: '.50 Cents', type: 'DOODLE',  desc: 'Crunchy Doodles',          price: 0.36, retail: 0.50, upc: 42 },
  { sku: '028119', category: '.50 Cents', type: 'PUFF',    desc: 'BBQ Honey Puff',           price: 0.36, retail: 0.50, upc: 42 },
  { sku: '028786', category: '.50 Cents', type: 'PUFF',    desc: 'Fiery Ridgies',            price: 0.36, retail: 0.50, upc: 40 },
  { sku: '028750', category: '.50 Cents', type: 'PUFF',    desc: 'Hot Honey Puff',           price: 0.36, retail: 0.50, upc: 42 },
  { sku: '027043', category: '.50 Cents', type: 'PUFF',    desc: 'Puff Doodles',             price: 0.36, retail: 0.50, upc: 42 },
  { sku: '027074', category: '.50 Cents', type: 'ONION',   desc: 'Onion Rings',              price: 0.36, retail: 0.50, upc: 36 },

  // ── 2.49 PRODUCTS ($2.49 retail, $1.79 cost) ──
  { sku: '028725', category: '2.49 Products', type: 'CHIPS',   desc: 'Onion Garlic Chips',   price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028723', category: '2.49 Products', type: 'CHIPS',   desc: 'Plain Chips',          price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028724', category: '2.49 Products', type: 'CHIPS',   desc: 'Honey BBQ Chips',      price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028734', category: '2.49 Products', type: 'PUFF',    desc: 'Puff Doodles',         price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028736', category: '2.49 Products', type: 'PUFF',    desc: 'Hot & Honey Doodles',  price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028737', category: '2.49 Products', type: 'POPCORN', desc: 'White Cheddar Popcorn', price: 1.79, retail: 2.49, upc: 16 },
  { sku: '028739', category: '2.49 Products', type: 'POPCORN', desc: 'Hot Cheese Popcorn',   price: 1.79, retail: 2.49, upc: 16 },
  { sku: '028738', category: '2.49 Products', type: 'POPCORN', desc: 'Butter Popcorn',       price: 1.79, retail: 2.49, upc: 16 },
  { sku: '028732', category: '2.49 Products', type: 'RIDGIES', desc: 'SC & Onion Ridgies',   price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028731', category: '2.49 Products', type: 'RIDGIES', desc: 'Plain Ridgies',        price: 1.79, retail: 2.49, upc: 18 },
  { sku: '028740', category: '2.49 Products', type: 'ONION',   desc: 'Onion Rings',          price: 1.79, retail: 2.49, upc: 16 },

  // ── 4.79 PRODUCTS ($4.79 retail, $3.39 cost) ──
  { sku: '028469', category: '4.79 Products', type: 'DIPSY',   desc: 'Dipsy Doodles',        price: 3.39, retail: 4.79, upc: 10 },
  { sku: '028136', category: '4.79 Products', type: 'DIPSY',   desc: 'BBQ Dipsy Doodles',    price: 3.39, retail: 4.79, upc: 10 },
  { sku: '028441', category: '4.79 Products', type: 'DOODLE',  desc: 'Crunchy Doodles',      price: 3.39, retail: 4.79, upc: 9 },
  { sku: '028718', category: '4.79 Products', type: 'PUFF',    desc: 'Hot & Honey Puff',     price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028443', category: '4.79 Products', type: 'PUFF',    desc: 'Puff Doodles',         price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028754', category: '4.79 Products', type: 'RIDGIES', desc: 'Plain Ridgies',        price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028756', category: '4.79 Products', type: 'RIDGIES', desc: 'Cheddar & SC Ridgies', price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028755', category: '4.79 Products', type: 'RIDGIES', desc: 'SC & Onion Ridgies',   price: 3.39, retail: 4.79, upc: 12 },
  { sku: '027452', category: '4.79 Products', type: 'POPCORN', desc: 'White Cheddar Popcorn', price: 3.39, retail: 4.79, upc: 10 },
  { sku: '028290', category: '4.79 Products', type: 'POPCORN', desc: 'Hot Cheese Popcorn',   price: 3.39, retail: 4.79, upc: 10 },
  { sku: '027453', category: '4.79 Products', type: 'POPCORN', desc: 'Butter Popcorn',       price: 3.39, retail: 4.79, upc: 10 },
  { sku: '028666', category: '4.79 Products', type: 'CHIPS',   desc: 'BBQ Chips',            price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028667', category: '4.79 Products', type: 'CHIPS',   desc: 'Honey BBQ Chips',      price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028664', category: '4.79 Products', type: 'CHIPS',   desc: 'Lightly Salted Chips', price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028663', category: '4.79 Products', type: 'CHIPS',   desc: 'Gold Plain Chips',     price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028668', category: '4.79 Products', type: 'CHIPS',   desc: 'Onion & Garlic Chips', price: 3.39, retail: 4.79, upc: 12 },
  { sku: '028751', category: '4.79 Products', type: 'ONION',   desc: 'Onion Rings',          price: 3.39, retail: 4.79, upc: 12 },

  // ── SALSA & DIPS ──
  { sku: '028163', category: 'Salsa & Dips', type: 'Onion',  desc: 'French Onion Dip',          price: 3.59, retail: 4.99, upc: 12 },
  { sku: '028168', category: 'Salsa & Dips', type: 'Cheese', desc: 'Con Queso',                 price: 3.59, retail: 4.99, upc: 12 },
  { sku: '428819', category: 'Salsa & Dips', type: 'Tomato', desc: 'Chunky Salsa Medium',       price: 3.59, retail: 4.99, upc: 12 },
  { sku: '028818', category: 'Salsa & Dips', type: 'Tomato', desc: 'Chunky Salsa Mild',         price: 3.59, retail: 4.99, upc: 12 },
  { sku: '027657', category: 'Salsa & Dips', type: '',       desc: 'Ridged Kettle Chips',       price: 2.30, retail: 3.19, upc: 15 },
  { sku: '028200', category: 'Salsa & Dips', type: 'Cheese', desc: 'Nacho Cheese Dip',          price: 2.33, retail: 3.29, upc: 24 },
  { sku: '028206', category: 'Salsa & Dips', type: 'Onion',  desc: 'French Onion Dip',          price: 2.33, retail: 3.29, upc: 24 },
  { sku: '027078', category: 'Salsa & Dips', type: 'Onion',  desc: 'Green Onion Dip',           price: 0.88, retail: 0.99, upc: 12 },

  // ── VARIETY PACKS ──
  { sku: '028678', category: 'Variety Packs', type: 'V/PK', desc: 'Flavor Variety Pack',        price: 8.47, retail: 10.99, upc: 6 },
  { sku: '028677', category: 'Variety Packs', type: 'V/PK', desc: 'Variety Pack',               price: 8.47, retail: 10.99, upc: 6 },
  { sku: '027620', category: 'Variety Packs', type: 'V/PK', desc: '50 Count Variety Pack',      price: 14.90, retail: 19.99, upc: 1 },

  // ── CRUNCH TIME ──
  { sku: '200097', category: 'Crunch Time', type: 'Crunch T', desc: 'Caramel Popcorn',       price: 0.69, retail: 0.99, upc: 24 },
  { sku: '200100', category: 'Crunch Time', type: 'Crunch T', desc: 'Kettle Corn',           price: 0.69, retail: 0.99, upc: 24 },
  { sku: '200101', category: 'Crunch Time', type: 'Crunch T', desc: 'Cotton Candy Popcorn',  price: 0.69, retail: 0.99, upc: 24 },
  { sku: 'CT0004', category: 'Crunch Time', type: 'Crunch T', desc: 'Popcorn Candy',         price: 0.69, retail: 0.99, upc: 24 },

  // ── CANDY ──
  { sku: '777713', category: 'Candy', type: '', desc: 'Gummy Bears 6oz',       price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777720', category: 'Candy', type: '', desc: 'Watermelon 6oz',        price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777723', category: 'Candy', type: '', desc: 'Nordic Fish 6oz',       price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777771', category: 'Candy', type: '', desc: 'Strawberry 6oz',        price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777774', category: 'Candy', type: '', desc: 'Raspberry Belts',       price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777776', category: 'Candy', type: '', desc: 'Fun Wheels 6oz',        price: 2.50, retail: 3.99, upc: 16 },
  { sku: '777779', category: 'Candy', type: '', desc: 'Peach Hearts 6oz',      price: 2.50, retail: 3.99, upc: 16 },

  // ── SNACKS ──
  { sku: '1780528', category: 'Snacks', type: '', desc: 'Toffee Peanuts Snack',       price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780739', category: 'Snacks', type: '', desc: 'Crunchy Peanuts Snack',      price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780640', category: 'Snacks', type: '', desc: 'Tajin Peanuts Snack',        price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780916', category: 'Snacks', type: '', desc: 'Tangy Chili Snack',          price: 1.29, retail: 1.99, upc: 12 },
  { sku: 'SNK005', category: 'Snacks', type: '', desc: 'Tropical Trail Mix Snack',    price: 2.65, retail: 3.99, upc: 6 },
  { sku: 'SNK006', category: 'Snacks', type: '', desc: 'Yogurt Trail Mix Snack',      price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780460', category: 'Snacks', type: '', desc: 'Energizer Trail Mix Snack',  price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780904', category: 'Snacks', type: '', desc: 'Mango Rings Snack',          price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780589', category: 'Snacks', type: '', desc: 'Peach Ring Snack',           price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1780600', category: 'Snacks', type: '', desc: 'Watermelon Rings Snack',     price: 1.29, retail: 1.99, upc: 12 },
  { sku: '1721906', category: 'Snacks', type: '', desc: 'Gummy Bears Snack',          price: 2.65, retail: 3.99, upc: 6 },
  { sku: '1721419', category: 'Snacks', type: '', desc: 'Banana Chip Snack',          price: 2.65, retail: 3.99, upc: 6 },
  { sku: '1745460', category: 'Snacks', type: '', desc: 'Energizer Trail Mix Grab&Run', price: 0.99, retail: 1.49, upc: 12 },
  { sku: '1745454', category: 'Snacks', type: '', desc: 'Yogurt Trail Mix Grab&Run',  price: 0.99, retail: 1.49, upc: 12 },
  { sku: '1745528', category: 'Snacks', type: '', desc: 'Toffee Peanut Grab&Run',     price: 0.99, retail: 1.49, upc: 12 },
  { sku: '1745456', category: 'Snacks', type: '', desc: 'Fancy Trail Mix Grab&Run',   price: 0.99, retail: 1.49, upc: 12 },
  { sku: '1745643', category: 'Snacks', type: '', desc: 'Tajin Toasted Corn Grab&Run', price: 0.99, retail: 1.49, upc: 12 },
  { sku: '1745640', category: 'Snacks', type: '', desc: 'Tajin Peanuts Grab&Run',     price: 0.99, retail: 1.49, upc: 12 },

  // ── SMOOTHIES ──
  { sku: 'SM001', category: 'Smoothies', type: '', desc: 'Strawberry Smoothie',          price: 0, retail: 0, upc: 6 },
  { sku: 'SM002', category: 'Smoothies', type: '', desc: 'Mango Smoothie',               price: 0, retail: 0, upc: 6 },
  { sku: 'SM003', category: 'Smoothies', type: '', desc: 'Strawberry-Banana Smoothie',   price: 0, retail: 0, upc: 6 },
  { sku: 'SM004', category: 'Smoothies', type: '', desc: 'Watermelon Smoothie',          price: 0, retail: 0, upc: 6 },
  { sku: 'SM005', category: 'Smoothies', type: '', desc: 'Pina Colada Smoothie',         price: 0, retail: 0, upc: 6 },
  { sku: 'SM006', category: 'Smoothies', type: '', desc: 'Grape Smoothie',               price: 0, retail: 0, upc: 6 },
  { sku: 'SM007', category: 'Smoothies', type: '', desc: 'Guava Smoothie',               price: 0, retail: 0, upc: 6 },
];

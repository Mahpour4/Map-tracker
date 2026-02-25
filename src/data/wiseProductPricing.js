/**
 * Wise Foods Product Pricing Catalog — Jobber (Distributor) Level
 * Source: Wise Foods Price List PDF × Inventory Report, week of Feb 14–20, 2026
 *
 * Fields: id=item#, desc=description, uic=units/case, caseCost=jobber cost/case,
 *         retail=consumer retail price, caseRetail=uic×retail, gpCase=caseRetail−caseCost,
 *         gpPct=gpCase/caseRetail×100
 *
 * KEY FORMULA derived from this data:
 *   Case Cost = 71.4% of Case Retail consistently across all SKUs
 *   → GP = 28.6% of retail revenue ≈ 29%
 *   → In terms of load cost: Expected GP = Load × 0.408  (= Load × 29/71)
 *   → DAO Revenue is already post-promotion, so GP Efficiency < 100% is normal on promo routes
 */

export const WISE_PRODUCTS = [
  // ── $0.50 RETAIL ── UIC 36–42, caseCost $12.96–$15.12, GP $5.04–$5.88, 28%
  { id: '027036', desc: 'BUTTER POPCORN',          uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '027039', desc: 'PLAIN DIPSY DOODLES',      uic: 36, caseCost: 12.96, retail: 0.50, caseRetail: 18.00, gpCase: 5.04, gpPct: 28.0 },
  { id: '027043', desc: 'PUFF DOODLES',             uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '027064', desc: 'DIPSY DOODLES',            uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '027074', desc: 'ONION RINGS',              uic: 36, caseCost: 12.96, retail: 0.50, caseRetail: 18.00, gpCase: 5.04, gpPct: 28.0 },
  { id: '027075', desc: 'BBQ CHIPS',                uic: 36, caseCost: 12.96, retail: 0.50, caseRetail: 18.00, gpCase: 5.04, gpPct: 28.0 },
  { id: '027124', desc: 'PLAIN CHIPS',              uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '027181', desc: 'HONEY BBQ CHIPS',          uic: 36, caseCost: 12.96, retail: 0.50, caseRetail: 18.00, gpCase: 5.04, gpPct: 28.0 },
  { id: '027185', desc: 'HONEY BBQ CHIPS',          uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '027197', desc: 'WHITE CHEDDAR POPCORN',    uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '027217', desc: 'NY DELI JALAPENO',         uic: 36, caseCost: 12.96, retail: 0.50, caseRetail: 18.00, gpCase: 5.04, gpPct: 28.0 },
  { id: '027388', desc: 'CRUNCHY DOODLES',          uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '027511', desc: 'SOUR CREAM & ONION',       uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '027519', desc: 'BBQ CHIPS',                uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '028119', desc: 'HONEY BBQ PUFF DOODLE',    uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '028635', desc: 'HOT CHEESE POPCORN',       uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '028748', desc: 'ONION/GARLIC CHIPS',       uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '028749', desc: 'CHED & SC RIDGIES',        uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '028750', desc: 'HOT HONEY PUFF',           uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '028758', desc: 'NY DELI JALAPENO',         uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },
  { id: '028768', desc: 'BBQ DIPSY DOODLES',        uic: 42, caseCost: 15.12, retail: 0.50, caseRetail: 21.00, gpCase: 5.88, gpPct: 28.0 },
  { id: '028786', desc: 'FIERY RIDGIES',            uic: 40, caseCost: 14.40, retail: 0.50, caseRetail: 20.00, gpCase: 5.60, gpPct: 28.0 },

  // ── $2.49 RETAIL ── UIC 16–18, caseCost $28.64–$32.22, GP $11.20–$12.60, 28.1%
  { id: '028723', desc: 'PLAIN CHIPS',              uic: 18, caseCost: 32.22, retail: 2.49, caseRetail: 44.82, gpCase: 12.60, gpPct: 28.1 },
  { id: '028724', desc: 'HONEY BBQ CHIPS',          uic: 18, caseCost: 32.22, retail: 2.49, caseRetail: 44.82, gpCase: 12.60, gpPct: 28.1 },
  { id: '028725', desc: 'ONION GARLIC CHIPS',       uic: 18, caseCost: 32.22, retail: 2.49, caseRetail: 44.82, gpCase: 12.60, gpPct: 28.1 },
  { id: '028734', desc: 'PUFF DOODLES',             uic: 18, caseCost: 32.22, retail: 2.49, caseRetail: 44.82, gpCase: 12.60, gpPct: 28.1 },
  { id: '028736', desc: 'HOT N HONEY DOODLE',       uic: 18, caseCost: 32.22, retail: 2.49, caseRetail: 44.82, gpCase: 12.60, gpPct: 28.1 },
  { id: '028737', desc: 'WHITE CHEDDAR POPCORN',    uic: 16, caseCost: 28.64, retail: 2.49, caseRetail: 39.84, gpCase: 11.20, gpPct: 28.1 },
  { id: '028738', desc: 'BUTTER POPCORN',           uic: 16, caseCost: 28.64, retail: 2.49, caseRetail: 39.84, gpCase: 11.20, gpPct: 28.1 },
  { id: '028739', desc: 'HOT CHEESE POPCORN',       uic: 16, caseCost: 28.64, retail: 2.49, caseRetail: 39.84, gpCase: 11.20, gpPct: 28.1 },
  { id: '028740', desc: 'ONION RINGS',              uic: 16, caseCost: 28.64, retail: 2.49, caseRetail: 39.84, gpCase: 11.20, gpPct: 28.1 },

  // ── $3.29 RETAIL ── UIC 24, caseCost $55.92, GP $23.04, 29.2%
  { id: '028200', desc: 'NACHO CHEESE DIP',         uic: 24, caseCost: 55.92, retail: 3.29, caseRetail: 78.96, gpCase: 23.04, gpPct: 29.2 },
  { id: '028206', desc: 'FRENCH ONION DIP',         uic: 24, caseCost: 55.92, retail: 3.29, caseRetail: 78.96, gpCase: 23.04, gpPct: 29.2 },

  // ── $3.49 RETAIL ── UIC 10, caseCost $24.70, GP $10.20, 29.2%
  { id: '028453', desc: 'BUTTER POPCORN RF',        uic: 10, caseCost: 24.70, retail: 3.49, caseRetail: 34.90, gpCase: 10.20, gpPct: 29.2 },

  // ── $4.79 RETAIL ── UIC 9–12, caseCost $30.51–$40.68, GP $12.60–$16.80, 29.2%
  { id: '027452', desc: 'WHITE CHEDDAR POPCORN',    uic: 10, caseCost: 33.90, retail: 4.79, caseRetail: 47.90, gpCase: 14.00, gpPct: 29.2 },
  { id: '027453', desc: 'BUTTER POPCORN',           uic: 10, caseCost: 33.90, retail: 4.79, caseRetail: 47.90, gpCase: 14.00, gpPct: 29.2 },
  { id: '028136', desc: 'BBQ DIPSY DOODLES',        uic: 10, caseCost: 33.90, retail: 4.79, caseRetail: 47.90, gpCase: 14.00, gpPct: 29.2 },
  { id: '028290', desc: 'HOT CHEESE POPCORN',       uic: 10, caseCost: 33.90, retail: 4.79, caseRetail: 47.90, gpCase: 14.00, gpPct: 29.2 },
  { id: '028441', desc: 'CRUNCHY DOODLES',          uic:  9, caseCost: 30.51, retail: 4.79, caseRetail: 43.11, gpCase: 12.60, gpPct: 29.2 },
  { id: '028443', desc: 'PUFFED CHEEZ DOODLES',     uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028469', desc: 'DIPSY DOODLE CORN CHIPS',  uic: 10, caseCost: 33.90, retail: 4.79, caseRetail: 47.90, gpCase: 14.00, gpPct: 29.2 },
  { id: '028663', desc: 'PLAIN CHIPS',              uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028664', desc: 'LIGHTLY SALTED CHIPS',     uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028666', desc: 'BBQ CHIPS',                uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028667', desc: 'HONEY BBQ CHIPS',          uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028668', desc: 'ONION & GARLIC CHIPS',     uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028718', desc: 'HOT & HONEY PUFF',         uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028751', desc: 'ONION RINGS',              uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028754', desc: 'PLAIN RIDGIES',            uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028755', desc: 'SC & ONION RIDGIES',       uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },
  { id: '028756', desc: 'CHED/SC RIDGIES',          uic: 12, caseCost: 40.68, retail: 4.79, caseRetail: 57.48, gpCase: 16.80, gpPct: 29.2 },

  // ── $4.99 RETAIL ── UIC 12, caseCost $43.08, GP $16.80, 28.1%
  { id: '028163', desc: 'FRENCH ONION DIP',         uic: 12, caseCost: 43.08, retail: 4.99, caseRetail: 59.88, gpCase: 16.80, gpPct: 28.1 },
  { id: '028168', desc: 'SALSA CON QUESO',          uic: 12, caseCost: 43.08, retail: 4.99, caseRetail: 59.88, gpCase: 16.80, gpPct: 28.1 },

  // ── $10.99 RETAIL ── UIC 6, caseCost $50.82, GP $15.12, 22.9%
  { id: '028677', desc: 'VARIETY PACK 20CT',        uic:  6, caseCost: 50.82, retail: 10.99, caseRetail: 65.94, gpCase: 15.12, gpPct: 22.9 },
  { id: '028678', desc: 'FLAVOR VARIETY PACK 20CT', uic:  6, caseCost: 50.82, retail: 10.99, caseRetail: 65.94, gpCase: 15.12, gpPct: 22.9 },
];

/**
 * Expected GP benchmark constants — derived from Wise Foods Jobber pricing analysis.
 *
 * Case Cost = 71.4% of Case Retail across all SKUs.
 * GP = 28.6% of retail ≈ 29%.
 *
 * In terms of load cost:
 *   Expected Revenue = Load / 0.714 = Load × 1.401
 *   Expected GP = Expected Revenue − Load = Load × 0.401 ≈ Load × 0.408
 *
 * DAO Revenue is already POST-PROMOTION, so GP Efficiency < 100% is expected on promo-heavy routes.
 * A route hitting 70%+ GP Efficiency is performing well.
 * Below 40% efficiency likely indicates unsold inventory still on truck.
 */
export const EXPECTED_GP_ON_LOAD = 0.408;  // Load × 0.408 = expected GP at full retail, no promos
export const EXPECTED_GP_PCT = 29.0;       // Expected GP as % of revenue at full retail
export const COST_TO_RETAIL_RATIO = 0.714; // Case Cost / Case Retail

/** Get all unique retail price tiers from the catalog */
export function getPriceTiers() {
  const tiers = [...new Set(WISE_PRODUCTS.map(p => p.retail.toFixed(2)))];
  return tiers.sort((a, b) => parseFloat(a) - parseFloat(b));
}

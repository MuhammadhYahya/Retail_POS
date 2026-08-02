/**
 * Lightweight unit tests for Excel import mapping & validation (no Electron/SQLite).
 * Run: node src/main/services/importExport/selftest.mjs
 */

import { suggestColumnMapping, applyColumnMapping } from './columnMapper.js';
import { validateMappedRows, buildErrorReportRows } from './validationEngine.js';
import { PRODUCT_FIELDS, SAMPLE_PRODUCT_ROWS } from './productFields.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('columnMapper');
{
  const headers = [
    'Product Name',
    'Item Code',
    'Bar Code',
    'Buying Price',
    'Retail Price',
    'Qty',
    'Category',
    'Supplier',
    'VAT %',
    'Reorder',
    'Size',
    'Colour',
  ];
  const result = suggestColumnMapping(headers);
  assert(result.mapping['Product Name'] === 'productName', 'maps Product Name → productName');
  assert(result.mapping['Item Code'] === 'sku', 'maps Item Code → sku');
  assert(result.mapping['Bar Code'] === 'barcode', 'maps Bar Code → barcode');
  assert(result.mapping['Buying Price'] === 'costPrice', 'maps Buying Price → cost');
  assert(result.mapping['Retail Price'] === 'sellingPrice', 'maps Retail Price → selling');
  assert(result.mapping['Qty'] === 'stockOnHand', 'maps Qty → stock');
  assert(result.mapping['VAT %'] === 'taxRate', 'maps VAT % → taxRate');
  assert(result.mapping['Colour'] === 'color', 'maps Colour → color');
  assert(result.requiredMissing.length === 0, 'no required fields missing when Name mapped');

  const mapped = applyColumnMapping(
    [{ 'Product Name': 'Tea', Qty: '10', 'Retail Price': '150' }],
    result.mapping
  );
  assert(mapped[0].productName === 'Tea', 'apply mapping sets productName');
  assert(mapped[0].stockOnHand === '10', 'apply mapping sets stock');
}

console.log('validationEngine');
{
  const rows = [
    {
      __rowNumber: 2,
      productName: 'Valid Item',
      sku: 'SKU-1',
      barcode: '479111',
      sellingPrice: 100,
      costPrice: 50,
      stockOnHand: 5,
      taxRate: 18,
      categoryName: 'Drinks',
    },
    {
      __rowNumber: 3,
      productName: '',
      sku: 'SKU-2',
      sellingPrice: -10,
      stockOnHand: -1,
    },
    {
      __rowNumber: 4,
      productName: 'Dup',
      sku: 'SKU-1',
      barcode: '479111',
    },
    { __rowNumber: 5 },
  ];

  const { results, summary } = validateMappedRows(rows, {
    existingSkus: new Set(),
    existingBarcodes: new Set(),
    categoryNames: new Set(['drinks']),
    supplierNames: new Set(),
    categoryMode: 'auto',
    supplierMode: 'auto',
  });

  assert(results[0].status === 'valid' || results[0].status === 'warning', 'row 2 is importable');
  assert(results[1].status === 'error', 'missing name / negative values → error');
  assert(results[2].status === 'error', 'duplicate SKU/barcode in file → error');
  assert(results[3].skip === true, 'blank row skipped');
  assert(summary.error >= 2, 'summary counts errors');

  const report = buildErrorReportRows(results, []);
  assert(report.length > 0, 'error report has rows');
  assert(report[0].suggestedFix != null, 'error report includes suggestedFix');
}

console.log('productFields');
{
  assert(PRODUCT_FIELDS.some((f) => f.key === 'productName' && f.required), 'name is required');
  assert(SAMPLE_PRODUCT_ROWS.length >= 2, 'template has sample rows');
  const multi = SAMPLE_PRODUCT_ROWS.filter((r) => r.productName === 'Sample T-Shirt');
  assert(multi.length >= 2, 'sample includes multi-variant product');
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

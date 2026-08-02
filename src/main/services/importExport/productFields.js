/**
 * Canonical product/variant Excel fields for Zen POS import/export.
 * Aliases support common Sri Lankan retail spreadsheet headers.
 */

export const PRODUCT_FIELDS = [
  {
    key: 'productName',
    label: 'Name',
    required: true,
    type: 'text',
    maxLength: 200,
    aliases: [
      'name', 'product', 'product name', 'item name', 'item', 'description name',
      'නම', 'භාණ්ඩය',
    ],
    exportKey: 'productName',
  },
  {
    key: 'sku',
    label: 'SKU',
    required: false, // auto-generated when empty
    type: 'text',
    maxLength: 64,
    aliases: ['sku', 'item code', 'itemcode', 'code', 'product code', 'stock code'],
    exportKey: 'sku',
  },
  {
    key: 'barcode',
    label: 'Barcode',
    required: false,
    type: 'text',
    maxLength: 64,
    aliases: ['barcode', 'bar code', 'ean', 'upc', 'gtin', 'barcode number'],
    exportKey: 'barcode',
  },
  {
    key: 'costPrice',
    label: 'Cost',
    required: false,
    type: 'number',
    min: 0,
    aliases: [
      'cost', 'cost price', 'costprice', 'buying price', 'purchase price',
      'wholesale', 'wholesale price', 'buy price',
    ],
    exportKey: 'costPrice',
  },
  {
    key: 'sellingPrice',
    label: 'Selling Price',
    required: false,
    type: 'number',
    min: 0,
    aliases: [
      'selling price', 'sellingprice', 'price', 'sale price', 'retail',
      'retail price', 'mrp', 'sp',
    ],
    exportKey: 'sellingPrice',
  },
  {
    key: 'stockOnHand',
    label: 'Opening Stock',
    required: false,
    type: 'number',
    min: 0,
    aliases: [
      'opening stock', 'stock', 'qty', 'quantity', 'on hand', 'onhand',
      'stock on hand', 'stockonhand', 'available', 'balance',
    ],
    exportKey: 'stockOnHand',
  },
  {
    key: 'supplierName',
    label: 'Supplier',
    required: false,
    type: 'text',
    maxLength: 200,
    aliases: ['supplier', 'supplier name', 'vendor', 'vendor name'],
    exportKey: 'supplierName',
  },
  {
    key: 'categoryName',
    label: 'Category',
    required: false,
    type: 'text',
    maxLength: 120,
    aliases: ['category', 'category name', 'cat', 'department', 'group'],
    exportKey: 'categoryName',
  },
  {
    key: 'brand',
    label: 'Brand',
    required: false,
    type: 'text',
    maxLength: 120,
    aliases: ['brand', 'make', 'manufacturer'],
    exportKey: 'brand',
  },
  {
    key: 'description',
    label: 'Description',
    required: false,
    type: 'text',
    maxLength: 2000,
    aliases: ['description', 'details', 'notes', 'product description'],
    exportKey: 'description',
  },
  {
    key: 'taxRate',
    label: 'VAT',
    required: false,
    type: 'number',
    min: 0,
    max: 100,
    aliases: ['vat', 'vat %', 'vat rate', 'tax', 'tax rate', 'taxrate', 'gst'],
    exportKey: 'taxRate',
  },
  {
    key: 'lowStockAlert',
    label: 'Reorder Level',
    required: false,
    type: 'number',
    min: 0,
    aliases: [
      'reorder level', 'reorder', 'low stock', 'low stock alert', 'alert',
      'min stock', 'minimum stock', 'reorderlevel',
    ],
    exportKey: 'lowStockAlert',
  },
  {
    key: 'unit',
    label: 'Unit',
    required: false,
    type: 'text',
    maxLength: 40,
    aliases: ['unit', 'uom', 'unit of measure', 'measure'],
    exportKey: 'unit',
  },
  {
    key: 'variantName',
    label: 'Variant',
    required: false,
    type: 'text',
    maxLength: 120,
    aliases: ['variant', 'variant name', 'variation', 'option'],
    exportKey: 'variantName',
  },
  {
    key: 'size',
    label: 'Size',
    required: false,
    type: 'text',
    maxLength: 40,
    aliases: ['size', 'sizes'],
    exportKey: 'size',
  },
  {
    key: 'color',
    label: 'Color',
    required: false,
    type: 'text',
    maxLength: 40,
    aliases: ['color', 'colour', 'colors', 'colours'],
    exportKey: 'color',
  },
  {
    key: 'isActive',
    label: 'Active',
    required: false,
    type: 'boolean',
    aliases: ['active', 'is active', 'isactive', 'status', 'enabled'],
    exportKey: 'isActive',
  },
];

export const REQUIRED_FIELD_KEYS = PRODUCT_FIELDS.filter((f) => f.required).map((f) => f.key);

export const SAMPLE_PRODUCT_ROWS = [
  {
    productName: 'Sample T-Shirt',
    sku: 'TSH-001-M-BLK',
    barcode: '4790000000001',
    costPrice: 850,
    sellingPrice: 1490,
    stockOnHand: 24,
    supplierName: 'ABC Garments',
    categoryName: 'Apparel',
    brand: 'Zen Basics',
    description: 'Cotton crew neck tee',
    taxRate: 18,
    lowStockAlert: 5,
    unit: 'pcs',
    variantName: 'M / Black',
    size: 'M',
    color: 'Black',
    isActive: 1,
  },
  {
    productName: 'Sample T-Shirt',
    sku: 'TSH-001-L-BLK',
    barcode: '4790000000002',
    costPrice: 850,
    sellingPrice: 1490,
    stockOnHand: 18,
    supplierName: 'ABC Garments',
    categoryName: 'Apparel',
    brand: 'Zen Basics',
    description: 'Cotton crew neck tee',
    taxRate: 18,
    lowStockAlert: 5,
    unit: 'pcs',
    variantName: 'L / Black',
    size: 'L',
    color: 'Black',
    isActive: 1,
  },
  {
    productName: 'Mineral Water 1L',
    sku: 'WAT-1L',
    barcode: '',
    costPrice: 40,
    sellingPrice: 80,
    stockOnHand: 100,
    supplierName: 'Fresh Distributors',
    categoryName: 'Beverages',
    brand: 'AquaPure',
    description: '',
    taxRate: 0,
    lowStockAlert: 20,
    unit: 'bottle',
    variantName: 'Default',
    size: '',
    color: '',
    isActive: 1,
  },
];

export function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^a-z0-9%.\s\u0d80-\u0dff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getFieldByKey(key) {
  return PRODUCT_FIELDS.find((f) => f.key === key) || null;
}

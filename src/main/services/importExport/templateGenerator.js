import ExcelJS from 'exceljs';
import { PRODUCT_FIELDS, SAMPLE_PRODUCT_ROWS } from './productFields.js';

const INSTRUCTIONS = [
  'ZEN Product Import Template',
  '',
  'How to use:',
  '1. Fill the Products sheet. Keep the header row unchanged for easiest mapping.',
  '2. Required: Name (productName). SKU and Barcode are optional — Zen can auto-generate them.',
  '3. One row = one variant. Same product name on multiple rows creates multi-variant products (use Size/Color).',
  '4. Prices in LKR. VAT is a percentage (e.g. 18 for 18%).',
  '5. Opening Stock sets inventory on create/update.',
  '6. Category and Supplier names: choose Auto-create in the Import Wizard if they do not exist yet.',
  '7. Do not paste Excel formulas — use values only.',
  '8. Export products from Zen, edit in Excel, then re-import for bulk updates (match by SKU).',
  '',
  'Duplicate handling in the wizard: Create New / Update Existing / Skip / Replace / Merge.',
  'Admin login is required to import.',
];

/**
 * Build a downloadable .xlsx template buffer with Instructions + Products sheets.
 */
export async function buildProductTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zen POS';
  workbook.created = new Date();

  const instructions = workbook.addWorksheet('Instructions');
  INSTRUCTIONS.forEach((line, i) => {
    const row = instructions.addRow([line]);
    if (i === 0) {
      row.font = { bold: true, size: 14 };
    }
  });
  instructions.getColumn(1).width = 100;

  const fields = workbook.addWorksheet('Field Guide');
  fields.addRow(['Field', 'Required', 'Type', 'Notes']);
  fields.getRow(1).font = { bold: true };
  for (const f of PRODUCT_FIELDS) {
    fields.addRow([
      f.label,
      f.required ? 'Yes' : 'No',
      f.type,
      f.aliases.slice(0, 4).join(', '),
    ]);
  }
  fields.columns.forEach((col) => {
    col.width = 28;
  });

  const sheet = workbook.addWorksheet('Products');
  const headers = PRODUCT_FIELDS.map((f) => f.exportKey);
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF5' },
  };

  // Mark required columns
  PRODUCT_FIELDS.forEach((f, idx) => {
    if (f.required) {
      headerRow.getCell(idx + 1).font = { bold: true, color: { argb: 'FFB45309' } };
    }
  });

  for (const sample of SAMPLE_PRODUCT_ROWS) {
    sheet.addRow(PRODUCT_FIELDS.map((f) => sample[f.key] ?? ''));
  }

  // Dropdown hints for Active
  const activeCol = PRODUCT_FIELDS.findIndex((f) => f.key === 'isActive') + 1;
  if (activeCol > 0) {
    for (let r = 2; r <= 200; r += 1) {
      sheet.getCell(r, activeCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"1,0"'],
        showErrorMessage: true,
        errorTitle: 'Active',
        error: 'Use 1 (active) or 0 (inactive).',
      };
    }
  }

  PRODUCT_FIELDS.forEach((f, idx) => {
    sheet.getColumn(idx + 1).width = Math.max(12, Math.min(28, f.label.length + 6));
  });

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function writeProductTemplate(filePath) {
  const fs = await import('fs');
  const buf = await buildProductTemplateBuffer();
  fs.writeFileSync(filePath, buf);
  return { path: filePath, format: 'xlsx' };
}

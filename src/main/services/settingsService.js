import { getDb } from '../database/db.js';

function now() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : '';
}

function normalizeStaleDayPolicy(value) {
  return String(value ?? '').trim().toLowerCase() === 'warn' ? 'warn' : 'block';
}

function clampLabelMm(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

function mapSettings(row) {
  if (!row) {
    return {
      shopName: 'ZEN Store',
      shopAddress: '',
      shopPhone: '',
      shopTin: '',
      currency: 'LKR',
      language: 'en',
      vatRate: 18,
      nextInvoiceSeq: 0,
      invoicePrefix: 'POS',
      receiptHeader: '',
      receiptFooter: '',
      returnWithinDays: 7,
      printerPort: '',
      paperWidth: 80,
      labelWidthMm: 38,
      labelHeightMm: 25,
      cashierMaxDiscountPct: 10,
      managerMaxDiscountPct: 25,
      staleDayPolicy: 'block',
    };
  }

  return {
    shopName: !row.shop_name || row.shop_name === 'POSLY Store' ? 'ZEN Store' : row.shop_name,
    shopAddress: row.shop_address || '',
    shopPhone: row.shop_phone || '',
    shopTin: row.shop_tin || '',
    currency: row.currency || 'LKR',
    language: row.language || 'en',
    vatRate: toNumber(row.vat_rate, 18),
    nextInvoiceSeq: toNumber(row.next_invoice_seq, 0),
    invoicePrefix: row.invoice_prefix || 'POS',
    receiptHeader: row.receipt_header || '',
    receiptFooter: row.receipt_footer || '',
    returnWithinDays: Math.max(1, Math.floor(toNumber(row.return_within_days, 7))),
    printerPort: row.printer_port || '',
    paperWidth: toNumber(row.paper_width, 80),
    labelWidthMm: clampLabelMm(row.label_width_mm, 38, 20, 120),
    labelHeightMm: clampLabelMm(row.label_height_mm, 25, 15, 100),
    cashierMaxDiscountPct: toNumber(row.cashier_max_discount_pct, 10),
    managerMaxDiscountPct: toNumber(row.manager_max_discount_pct, 25),
    staleDayPolicy: normalizeStaleDayPolicy(row.stale_day_policy),
  };
}

const settingsService = {
  get() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return mapSettings(row);
  },

  update(payload = {}) {
    const db = getDb();
    const current = this.get();
    const next = {
      shopName: payload.shopName !== undefined ? cleanText(payload.shopName) || current.shopName : current.shopName,
      shopAddress: payload.shopAddress !== undefined ? cleanText(payload.shopAddress) : current.shopAddress,
      shopPhone: payload.shopPhone !== undefined ? cleanText(payload.shopPhone) : current.shopPhone,
      shopTin: payload.shopTin !== undefined ? cleanText(payload.shopTin) : current.shopTin,
      currency: payload.currency !== undefined ? cleanText(payload.currency) || current.currency : current.currency,
      language: payload.language !== undefined ? cleanText(payload.language) || current.language : current.language,
      vatRate:
        payload.vatRate !== undefined ? Math.max(0, toNumber(payload.vatRate, current.vatRate)) : current.vatRate,
      invoicePrefix:
        payload.invoicePrefix !== undefined
          ? cleanText(payload.invoicePrefix) || current.invoicePrefix
          : current.invoicePrefix,
      receiptHeader:
        payload.receiptHeader !== undefined ? String(payload.receiptHeader ?? '') : current.receiptHeader,
      receiptFooter:
        payload.receiptFooter !== undefined ? String(payload.receiptFooter ?? '') : current.receiptFooter,
      returnWithinDays:
        payload.returnWithinDays !== undefined
          ? Math.max(1, Math.floor(toNumber(payload.returnWithinDays, current.returnWithinDays)))
          : current.returnWithinDays,
      printerPort: payload.printerPort !== undefined ? cleanText(payload.printerPort) : current.printerPort,
      paperWidth:
        payload.paperWidth !== undefined
          ? Number(payload.paperWidth) === 58
            ? 58
            : 80
          : current.paperWidth,
      labelWidthMm:
        payload.labelWidthMm !== undefined
          ? clampLabelMm(payload.labelWidthMm, current.labelWidthMm, 20, 120)
          : current.labelWidthMm,
      labelHeightMm:
        payload.labelHeightMm !== undefined
          ? clampLabelMm(payload.labelHeightMm, current.labelHeightMm, 15, 100)
          : current.labelHeightMm,
      cashierMaxDiscountPct:
        payload.cashierMaxDiscountPct !== undefined
          ? Math.min(100, Math.max(0, toNumber(payload.cashierMaxDiscountPct, current.cashierMaxDiscountPct)))
          : current.cashierMaxDiscountPct,
      managerMaxDiscountPct:
        payload.managerMaxDiscountPct !== undefined
          ? Math.min(100, Math.max(0, toNumber(payload.managerMaxDiscountPct, current.managerMaxDiscountPct)))
          : current.managerMaxDiscountPct,
      staleDayPolicy:
        payload.staleDayPolicy !== undefined
          ? normalizeStaleDayPolicy(payload.staleDayPolicy)
          : current.staleDayPolicy,
    };

    if (next.managerMaxDiscountPct < next.cashierMaxDiscountPct) {
      throw new Error('Manager discount limit must be greater than or equal to cashier limit.');
    }

    db.prepare(`
      UPDATE settings SET
        shop_name = ?,
        shop_address = ?,
        shop_phone = ?,
        shop_tin = ?,
        currency = ?,
        language = ?,
        vat_rate = ?,
        invoice_prefix = ?,
        receipt_header = ?,
        receipt_footer = ?,
        return_within_days = ?,
        printer_port = ?,
        paper_width = ?,
        label_width_mm = ?,
        label_height_mm = ?,
        cashier_max_discount_pct = ?,
        manager_max_discount_pct = ?,
        stale_day_policy = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      next.shopName,
      next.shopAddress || null,
      next.shopPhone || null,
      next.shopTin || null,
      next.currency,
      next.language,
      next.vatRate,
      next.invoicePrefix,
      next.receiptHeader || null,
      next.receiptFooter || null,
      next.returnWithinDays,
      next.printerPort || null,
      next.paperWidth,
      next.labelWidthMm,
      next.labelHeightMm,
      next.cashierMaxDiscountPct,
      next.managerMaxDiscountPct,
      next.staleDayPolicy,
      now()
    );

    return this.get();
  },
};

export default settingsService;

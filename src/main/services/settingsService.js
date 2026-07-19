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

function mapSettings(row) {
  if (!row) {
    return {
      shopName: 'POSLY Store',
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
      printerPort: '',
      paperWidth: 80,
    };
  }

  return {
    shopName: row.shop_name || 'POSLY Store',
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
    printerPort: row.printer_port || '',
    paperWidth: toNumber(row.paper_width, 80),
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
      printerPort: payload.printerPort !== undefined ? cleanText(payload.printerPort) : current.printerPort,
      paperWidth:
        payload.paperWidth !== undefined
          ? Number(payload.paperWidth) === 58
            ? 58
            : 80
          : current.paperWidth,
    };

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
        printer_port = ?,
        paper_width = ?,
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
      next.printerPort || null,
      next.paperWidth,
      now()
    );

    return this.get();
  },
};

export default settingsService;

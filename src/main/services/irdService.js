import crypto from 'crypto';
import QRCode from 'qrcode';
import { getDb } from '../database/db.js';
import settingsService from './settingsService.js';
import saleService from './saleService.js';

function now() {
  return new Date().toISOString();
}

const irdService = {
  buildJson(sale, settings = null) {
    const shop = settings || settingsService.get();
    return {
      seller_tin: shop.shopTin || '',
      seller_name: shop.shopName || 'POSLY Store',
      invoice_no: sale.invoiceNumber,
      date: sale.saleDate,
      currency: shop.currency || 'LKR',
      payment_method: sale.paymentMethod,
      line_items: (sale.items || []).map((item) => ({
        name: item.productName,
        qty: item.quantity,
        unit_price: item.unitPrice,
        discount: item.discountAmount,
        tax_rate: item.taxRate,
        vat: item.vatAmount,
        line_total: item.lineTotal,
      })),
      subtotal: sale.subtotal,
      discount_total: sale.discountTotal,
      vat_total: sale.vatTotal,
      total: sale.total,
    };
  },

  async generateQR(invoiceData) {
    const payload = JSON.stringify({
      invoice_no: invoiceData.invoice_no || invoiceData.invoiceNumber,
      total: invoiceData.total,
      date: invoiceData.date || invoiceData.saleDate,
    });
    return QRCode.toDataURL(payload, { margin: 1, width: 200 });
  },

  async saveForSale(saleId) {
    const db = getDb();
    const sale = saleService.getById(saleId);
    const settings = settingsService.get();
    const payload = this.buildJson(sale, settings);
    const invoiceUuid = crypto.randomUUID();
    const qrData = await this.generateQR(payload);
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO ird_invoices (id, sale_id, invoice_uuid, payload_json, qr_data, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'generated', ?)
      ON CONFLICT(sale_id) DO UPDATE SET
        invoice_uuid = excluded.invoice_uuid,
        payload_json = excluded.payload_json,
        qr_data = excluded.qr_data,
        status = 'generated',
        created_at = excluded.created_at
    `).run(id, saleId, invoiceUuid, JSON.stringify(payload), qrData, now());

    saleService.updateIrdStatus(saleId, {
      irdStatus: sale.vatTotal > 0 ? 'generated' : 'none',
      irdUuid: invoiceUuid,
    });

    return {
      id,
      saleId,
      invoiceUuid,
      payload,
      qrData,
      status: 'generated',
    };
  },

  getBySaleId(saleId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM ird_invoices WHERE sale_id = ?
    `).get(saleId);
    if (!row) return null;
    return {
      id: row.id,
      saleId: row.sale_id,
      invoiceUuid: row.invoice_uuid,
      payload: JSON.parse(row.payload_json),
      qrData: row.qr_data,
      status: row.status,
      createdAt: row.created_at,
    };
  },
};

export default irdService;

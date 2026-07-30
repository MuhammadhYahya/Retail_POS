import fs from 'node:fs';
import settingsService from './settingsService.js';

function encodeText(text) {
  return Buffer.from(String(text ?? ''), 'utf8');
}

function line(text = '', width = 42) {
  const raw = String(text ?? '');
  if (raw.length <= width) return raw;
  return raw.slice(0, width);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function buildEscPosReceipt({ shop, sale, paperWidth = 80 }) {
  const chars = paperWidth >= 72 ? 48 : 32;
  const chunks = [];
  const ESC = 0x1b;
  const GS = 0x1d;

  // Init
  chunks.push(Buffer.from([ESC, 0x40]));
  // Center align
  chunks.push(Buffer.from([ESC, 0x61, 1]));
  chunks.push(encodeText(`${shop.shopName || 'Shop'}\n`));
  if (shop.shopAddress) chunks.push(encodeText(`${line(shop.shopAddress, chars)}\n`));
  if (shop.shopPhone) chunks.push(encodeText(`Tel: ${shop.shopPhone}\n`));
  if (shop.shopTin) chunks.push(encodeText(`TIN: ${shop.shopTin}\n`));
  chunks.push(encodeText(`${'-'.repeat(Math.min(chars, 32))}\n`));
  // Left
  chunks.push(Buffer.from([ESC, 0x61, 0]));
  chunks.push(encodeText(`Invoice: ${sale.invoiceNumber}\n`));
  chunks.push(encodeText(`Date: ${sale.saleDate}\n`));
  chunks.push(encodeText(`${'-'.repeat(Math.min(chars, 32))}\n`));

  for (const item of sale.items || []) {
    const name = line(item.productName || item.variantName || 'Item', chars - 10);
    chunks.push(encodeText(`${name}\n`));
    chunks.push(encodeText(
      `  ${item.quantity} x ${money(item.unitPrice)}  ${money(item.lineTotal)}\n`
    ));
  }

  chunks.push(encodeText(`${'-'.repeat(Math.min(chars, 32))}\n`));
  chunks.push(encodeText(`Subtotal: ${money(sale.subtotal)}\n`));
  if (sale.discountTotal) chunks.push(encodeText(`Discount: -${money(sale.discountTotal)}\n`));
  if (sale.vatTotal) chunks.push(encodeText(`VAT: ${money(sale.vatTotal)}\n`));
  chunks.push(encodeText(`TOTAL: Rs. ${money(sale.total)}\n`));
  chunks.push(encodeText(`Paid (${sale.paymentMethod}): ${money(sale.amountTendered)}\n`));
  if (sale.changeGiven) chunks.push(encodeText(`Change: ${money(sale.changeGiven)}\n`));
  chunks.push(encodeText(`${'-'.repeat(Math.min(chars, 32))}\n`));
  if (shop.receiptFooter) {
    chunks.push(Buffer.from([ESC, 0x61, 1]));
    chunks.push(encodeText(`${shop.receiptFooter}\n`));
  }
  chunks.push(encodeText('\n\n'));
  // Cut
  chunks.push(Buffer.from([GS, 0x56, 0x00]));
  return Buffer.concat(chunks);
}

function buildDrawerKick() {
  // ESC p m t1 t2 — pulse pin 2
  return Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

function resolvePrinterPath(port) {
  const raw = String(port || '').trim();
  if (!raw) return null;
  if (raw.startsWith('\\\\') || raw.includes('/') || raw.includes('\\')) return raw;
  // COM port shorthand
  if (/^COM\d+$/i.test(raw)) return `\\\\.\\${raw.toUpperCase()}`;
  return raw;
}

const printerService = {
  async printReceipt({ sale, openDrawer = true } = {}) {
    const shop = settingsService.get();
    const port = resolvePrinterPath(shop.printerPort);
    const buffer = buildEscPosReceipt({
      shop,
      sale,
      paperWidth: shop.paperWidth || 80,
    });

    if (!port) {
      return { success: false, fallback: 'html', error: 'No printer port configured.' };
    }

    try {
      const payload = openDrawer
        ? Buffer.concat([buffer, buildDrawerKick()])
        : buffer;
      await fs.promises.writeFile(port, payload);
      return { success: true, fallback: null };
    } catch (err) {
      return {
        success: false,
        fallback: 'html',
        error: err.message || 'Printer write failed.',
      };
    }
  },

  async openDrawer() {
    const shop = settingsService.get();
    const port = resolvePrinterPath(shop.printerPort);
    if (!port) {
      return { success: false, error: 'No printer port configured for cash drawer.' };
    }
    try {
      await fs.promises.writeFile(port, buildDrawerKick());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

export default printerService;

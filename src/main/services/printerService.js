import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import settingsService from './settingsService.js';
import { isRawEscPosPort } from '../lib/escposPort.js';
import { writeRawToWindowsPrinter } from '../lib/windowsRawPrint.js';

/** Match Windows RAW PowerShell timeout — avoid infinite "Printing…" on hung COM ports. */
const ESCPOS_PORT_TIMEOUT_MS = 20_000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** XP-80 (and most ESC/POS) expect single-byte text, not UTF-8. */
function toPrinterText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n\r\t]/g, '?')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function encodeText(text) {
  return Buffer.from(toPrinterText(text), 'latin1');
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

/** Word-wrap to column width (preserves newlines). */
function wrapLines(text, width = 42) {
  const raw = toPrinterText(text);
  const out = [];
  for (const paragraph of raw.split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(' ', width);
      if (breakAt < Math.floor(width / 2)) breakAt = width;
      out.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) out.push(remaining);
  }
  return out;
}

function pushWrapped(chunks, text, width) {
  for (const row of wrapLines(text, width)) {
    chunks.push(encodeText(`${row}\n`));
  }
}

function buildEscPosReceipt({ shop, sale, paperWidth = 80 }) {
  const chars = paperWidth >= 72 ? 42 : 32;
  const rule = '-'.repeat(chars);
  const chunks = [];
  const ESC = 0x1b;
  const GS = 0x1d;

  chunks.push(Buffer.from([ESC, 0x40])); // init
  chunks.push(Buffer.from([ESC, 0x74, 0])); // code page PC437
  chunks.push(Buffer.from([ESC, 0x52, 0])); // international char set USA
  chunks.push(Buffer.from([ESC, 0x4d, 0])); // Font A
  chunks.push(Buffer.from([ESC, 0x61, 1])); // center
  pushWrapped(chunks, shop.shopName || 'Shop', chars);
  if (shop.receiptHeader) pushWrapped(chunks, shop.receiptHeader, chars);
  if (shop.shopAddress) pushWrapped(chunks, shop.shopAddress, chars);
  if (shop.shopPhone) chunks.push(encodeText(`Tel: ${shop.shopPhone}\n`));
  if (shop.shopTin) chunks.push(encodeText(`TIN: ${shop.shopTin}\n`));
  chunks.push(encodeText(`${rule}\n`));
  chunks.push(Buffer.from([ESC, 0x61, 0])); // left
  chunks.push(encodeText(`Invoice: ${sale.invoiceNumber}\n`));
  chunks.push(encodeText(`Date: ${String(sale.saleDate || '').replace('T', ' ').slice(0, 19)}\n`));
  const soldBy = sale.cashierName || sale.cashierUsername;
  if (soldBy) chunks.push(encodeText(`Sold by: ${soldBy}\n`));
  chunks.push(encodeText(`${rule}\n`));

  for (const item of sale.items || []) {
    const productName = item.productName || 'Item';
    pushWrapped(chunks, productName, chars);
    if (item.variantName && item.variantName !== productName) {
      pushWrapped(chunks, `  ${item.variantName}`, chars);
    }
    if (item.barcode) {
      chunks.push(encodeText(`  BC: ${item.barcode}\n`));
    }
    const lineGross = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    chunks.push(encodeText(
      `  ${item.quantity} x ${money(item.unitPrice)}  ${money(lineGross)}\n`
    ));
  }

  chunks.push(encodeText(`${rule}\n`));
  chunks.push(encodeText(`Subtotal: ${money(sale.subtotal)}\n`));
  if (Number(sale.discountTotal) > 0) {
    chunks.push(encodeText(`Discount: -${money(sale.discountTotal)}\n`));
    chunks.push(Buffer.from([ESC, 0x61, 1]));
    chunks.push(encodeText('Discount applied to total purchase\n'));
    chunks.push(Buffer.from([ESC, 0x61, 0]));
  }
  if (Number(sale.vatTotal) > 0) {
    chunks.push(encodeText(`VAT: ${money(sale.vatTotal)}\n`));
  }
  chunks.push(encodeText(`TOTAL: Rs. ${money(sale.total)}\n`));
  chunks.push(encodeText(`Paid (${sale.paymentMethod || 'cash'}): ${money(sale.amountTendered)}\n`));
  if (Number(sale.changeGiven) > 0) {
    chunks.push(encodeText(`Change: ${money(sale.changeGiven)}\n`));
  }
  chunks.push(encodeText(`${rule}\n`));
  if (shop.receiptFooter) {
    chunks.push(Buffer.from([ESC, 0x61, 1]));
    pushWrapped(chunks, shop.receiptFooter, chars);
  }
  if (Number(shop.returnWithinDays) > 0) {
    chunks.push(Buffer.from([ESC, 0x61, 1]));
    chunks.push(encodeText(`Returns accepted within ${Math.floor(Number(shop.returnWithinDays))} days\n`));
  }

  // GS V 65 n — feed n units then partial cut (reliable on XP-80U vs cut-in-place)
  chunks.push(Buffer.from([GS, 0x56, 65, 0x40]));
  return Buffer.concat(chunks);
}

function formatSaleDate(value) {
  const raw = String(value || '').replace('T', ' ').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function formatRefundMethod(method) {
  const m = String(method || 'cash').toLowerCase();
  if (m === 'card') return 'Card';
  if (m === 'qr') return 'QR';
  return 'Cash';
}

function buildEscPosReturnReceipt({ shop, returnRecord, paperWidth = 80 }) {
  const chars = paperWidth >= 72 ? 42 : 32;
  const rule = '-'.repeat(chars);
  const chunks = [];
  const ESC = 0x1b;
  const GS = 0x1d;

  chunks.push(Buffer.from([ESC, 0x40])); // init
  chunks.push(Buffer.from([ESC, 0x74, 0])); // code page PC437
  chunks.push(Buffer.from([ESC, 0x52, 0])); // international char set USA
  chunks.push(Buffer.from([ESC, 0x4d, 0])); // Font A
  chunks.push(Buffer.from([ESC, 0x61, 1])); // center
  pushWrapped(chunks, shop.shopName || 'Shop', chars);
  if (shop.receiptHeader) pushWrapped(chunks, shop.receiptHeader, chars);
  if (shop.shopAddress) pushWrapped(chunks, shop.shopAddress, chars);
  if (shop.shopPhone) chunks.push(encodeText(`Tel: ${shop.shopPhone}\n`));
  if (shop.shopTin) chunks.push(encodeText(`TIN: ${shop.shopTin}\n`));
  chunks.push(encodeText(`${rule}\n`));
  chunks.push(encodeText('RETURN RECEIPT\n'));
  chunks.push(encodeText(`${rule}\n`));
  chunks.push(Buffer.from([ESC, 0x61, 0])); // left

  chunks.push(encodeText('Return No:\n'));
  chunks.push(encodeText(`${returnRecord.returnNumber || ''}\n`));
  chunks.push(encodeText('\n'));
  chunks.push(encodeText('Original Invoice:\n'));
  chunks.push(encodeText(`${returnRecord.invoiceNumber || ''}\n`));
  chunks.push(encodeText('\n'));
  const saleDate = formatSaleDate(returnRecord.saleDate);
  if (saleDate) {
    chunks.push(encodeText('Sale Date:\n'));
    chunks.push(encodeText(`${saleDate}\n`));
    chunks.push(encodeText('\n'));
  }
  chunks.push(encodeText('Processed by:\n'));
  chunks.push(encodeText(`${returnRecord.processedByName || 'Staff'}\n`));
  chunks.push(encodeText(`${rule}\n`));

  for (const item of returnRecord.items || []) {
    const productName = item.productName || 'Item';
    pushWrapped(chunks, productName, chars);
    if (item.variantName && item.variantName !== productName) {
      pushWrapped(chunks, item.variantName, chars);
    }
    chunks.push(encodeText('\n'));
    chunks.push(encodeText(`Returned: ${item.quantity}\n`));
    chunks.push(encodeText('\n'));
    const left = `Rs.${money(item.unitRefund)} x ${item.quantity}`;
    const right = `Rs.${money(item.lineRefund)}`;
    const pad = Math.max(1, chars - left.length - right.length);
    chunks.push(encodeText(`${left}${' '.repeat(pad)}${right}\n`));
    chunks.push(encodeText('\n'));
  }

  chunks.push(encodeText(`${rule}\n`));
  chunks.push(encodeText('Refund Total\n'));
  chunks.push(encodeText(`Rs. ${money(returnRecord.refundTotal)}\n`));
  chunks.push(encodeText('\n'));
  chunks.push(encodeText('Refund Method\n'));
  chunks.push(encodeText(`${formatRefundMethod(returnRecord.refundMethod)}\n`));
  const reason = String(returnRecord.reason || '').trim();
  if (reason) {
    chunks.push(encodeText('\n'));
    chunks.push(encodeText('Reason\n'));
    pushWrapped(chunks, reason, chars);
  }
  chunks.push(encodeText(`${rule}\n`));
  chunks.push(Buffer.from([ESC, 0x61, 1]));
  chunks.push(encodeText('Refund processed successfully.\n'));
  chunks.push(encodeText('\n'));
  chunks.push(encodeText('Thank you.\n'));
  if (shop.receiptFooter) {
    pushWrapped(chunks, shop.receiptFooter, chars);
  }

  // GS V 65 n — feed n units then partial cut
  chunks.push(Buffer.from([GS, 0x56, 65, 0x40]));
  return Buffer.concat(chunks);
}

function buildDrawerKick() {
  // ESC p m t1 t2 — pulse pin 2 (cash drawer on most XP-80 setups)
  return Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

function resolvePrinterPath(port) {
  const raw = String(port || '').trim();
  if (!raw) return null;
  if (raw.startsWith('\\\\') || raw.includes('/') || raw.includes('\\')) return raw;
  if (/^COM\d+$/i.test(raw)) return `\\\\.\\${raw.toUpperCase()}`;
  return raw;
}

function buildPayload({ shop, sale, paperWidth, openDrawer }) {
  const buffer = buildEscPosReceipt({ shop, sale, paperWidth });
  if (!openDrawer) return buffer;
  return Buffer.concat([buffer, buildDrawerKick()]);
}

function buildReturnPayload({ shop, returnRecord, paperWidth, openDrawer }) {
  const buffer = buildEscPosReturnReceipt({ shop, returnRecord, paperWidth });
  if (!openDrawer) return buffer;
  return Buffer.concat([buffer, buildDrawerKick()]);
}

function buildTestSale(shop) {
  return {
    invoiceNumber: 'TEST-PRINT',
    saleDate: new Date().toISOString(),
    cashierName: 'Test',
    paymentMethod: 'cash',
    amountTendered: 100,
    changeGiven: 0,
    subtotal: 100,
    discountTotal: 0,
    vatTotal: 0,
    total: 100,
    items: [
      {
        productName: 'Posly printer test — long name wraps on 80mm paper',
        variantName: 'Variant A',
        barcode: '1234567890123',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
    ],
  };
}

function buildTestReturn() {
  return {
    returnNumber: 'RET-TEST-0001',
    invoiceNumber: 'INV-TEST-0001',
    saleDate: new Date().toISOString(),
    processedByName: 'Test',
    refundTotal: 5500,
    refundMethod: 'cash',
    reason: 'Wrong size',
    items: [
      {
        productName: 'Leather Shoe Black — long name wraps on paper',
        variantName: 'Size 42',
        quantity: 1,
        unitRefund: 5500,
        lineRefund: 5500,
      },
    ],
  };
}

async function sendPayload(configured, payload) {
  if (isRawEscPosPort(configured)) {
    const port = resolvePrinterPath(configured);
    try {
      await withTimeout(
        fs.promises.writeFile(port, payload),
        ESCPOS_PORT_TIMEOUT_MS,
        `Printer timed out after ${ESCPOS_PORT_TIMEOUT_MS / 1000}s. Check the XP-80U is online and not paused.`
      );
      return { success: true, fallback: null, method: 'escpos-port' };
    } catch (err) {
      return {
        success: false,
        fallback: 'html',
        error: err.message || 'Printer port write failed.',
      };
    }
  }

  try {
    await writeRawToWindowsPrinter(configured, payload);
    return { success: true, fallback: null, method: 'escpos-windows' };
  } catch (err) {
    return {
      success: false,
      fallback: 'html',
      error: err.message || 'Windows raw print failed. Thermal printers need ESC/POS, not page print.',
      deviceName: configured,
    };
  }
}

const printerService = {
  async listPrintersAsync() {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return [];
    try {
      if (typeof win.webContents.getPrintersAsync === 'function') {
        return await win.webContents.getPrintersAsync();
      }
      return win.webContents.getPrinters?.() || [];
    } catch {
      return [];
    }
  },

  async printReceipt({ sale, openDrawer = true } = {}) {
    const shop = settingsService.get();
    const configured = String(shop.printerPort || '').trim();
    const paperWidth = shop.paperWidth || 80;

    if (!configured) {
      return {
        success: false,
        fallback: 'html',
        error: 'No receipt printer selected in Settings.',
      };
    }

    const payload = buildPayload({
      shop,
      sale,
      paperWidth,
      openDrawer: Boolean(openDrawer),
    });

    return sendPayload(configured, payload);
  },

  async printReturnReceipt({ returnRecord, openDrawer = false } = {}) {
    const shop = settingsService.get();
    const configured = String(shop.printerPort || '').trim();
    const paperWidth = shop.paperWidth || 80;

    if (!configured) {
      return {
        success: false,
        fallback: 'html',
        error: 'No receipt printer selected in Settings.',
      };
    }

    const payload = buildReturnPayload({
      shop,
      returnRecord,
      paperWidth,
      openDrawer: Boolean(openDrawer),
    });

    return sendPayload(configured, payload);
  },

  async testPrint() {
    const shop = settingsService.get();
    const configured = String(shop.printerPort || '').trim();
    const paperWidth = shop.paperWidth || 80;

    if (!configured) {
      return {
        success: false,
        error: 'No receipt printer selected in Settings.',
      };
    }

    const sale = buildTestSale(shop);
    const payload = buildPayload({
      shop: {
        ...shop,
        receiptHeader: shop.receiptHeader || 'Printer test page',
        receiptFooter: shop.receiptFooter || 'If you can read this, cut and feed are OK.',
      },
      sale,
      paperWidth,
      openDrawer: false,
    });

    return sendPayload(configured, payload);
  },

  async testReturnReceipt() {
    const shop = settingsService.get();
    const configured = String(shop.printerPort || '').trim();
    const paperWidth = shop.paperWidth || 80;

    if (!configured) {
      return {
        success: false,
        error: 'No receipt printer selected in Settings.',
      };
    }

    const payload = buildReturnPayload({
      shop: {
        ...shop,
        receiptHeader: shop.receiptHeader || 'Return printer test',
        receiptFooter: shop.receiptFooter || 'If you can read this, cut and feed are OK.',
      },
      returnRecord: buildTestReturn(),
      paperWidth,
      openDrawer: false,
    });

    return sendPayload(configured, payload);
  },

  async openDrawer() {
    const shop = settingsService.get();
    const configured = String(shop.printerPort || '').trim();
    if (!configured) {
      return { success: false, error: 'No receipt printer selected for cash drawer.' };
    }

    const kick = buildDrawerKick();

    if (isRawEscPosPort(configured)) {
      const port = resolvePrinterPath(configured);
      try {
        await fs.promises.writeFile(port, kick);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    try {
      await writeRawToWindowsPrinter(configured, kick);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

export default printerService;

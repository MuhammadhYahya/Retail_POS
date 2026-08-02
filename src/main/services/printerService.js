import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import settingsService from './settingsService.js';
import { isRawEscPosPort } from '../lib/escposPort.js';
import { writeRawToWindowsPrinter } from '../lib/windowsRawPrint.js';
import { pipelineLog } from '../lib/printPipelineLog.js';

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

function buildPayload({ shop, sale, paperWidth }) {
  // Never append drawer kick here — drawer is sent only after a confirmed receipt write.
  return buildEscPosReceipt({ shop, sale, paperWidth });
}

function buildReturnPayload({ shop, returnRecord, paperWidth }) {
  return buildEscPosReturnReceipt({ shop, returnRecord, paperWidth });
}

/**
 * Electron printer list status is a useful early signal on Windows, but USB-offline
 * false "ready" still happens — windowsRawPrint.js is the hard gate.
 */
async function electronPrinterNotReadyError(configured) {
  if (isRawEscPosPort(configured)) return null;
  try {
    const printers = await printerService.listPrintersAsync();
    const match = (printers || []).find(
      (p) => p.name === configured || p.displayName === configured
    );
    if (!match) return null;
    const status = Number(match.status || 0);
    const badMask =
      0x00000001 // paused
      | 0x00000002 // error
      | 0x00000008 // paper jam
      | 0x00000040 // paper out
      | 0x00000080 // offline
      | 0x00000800 // output bin full
      | 0x00001000 // not available
      | 0x00040000 // no toner
      | 0x00100000 // user intervention
      | 0x00400000; // door open
    if (status & badMask) {
      return `Printer not ready (status 0x${status.toString(16)}). Check power, USB, paper, and Settings.`;
    }
  } catch {
    // ignore — Win32 path still validates
  }
  return null;
}

async function sendReceiptThenMaybeDrawer(configured, receiptPayload, openDrawer) {
  pipelineLog('printerService.sendReceiptThenMaybeDrawer.enter', {
    configured,
    openDrawer: Boolean(openDrawer),
    receiptBytes: receiptPayload?.length || 0,
    isRawPort: isRawEscPosPort(configured),
  });

  const early = await electronPrinterNotReadyError(configured);
  if (early) {
    pipelineLog('printerService.sendReceiptThenMaybeDrawer.exit', {
      success: false,
      drawerOpened: false,
      drawerPulseSent: false,
      reason: 'electronPrinterNotReady',
      error: early,
    });
    return { success: false, fallback: 'html', error: early, drawerOpened: false };
  }

  const receiptResult = await sendPayload(configured, receiptPayload);
  pipelineLog('printerService.receiptResult', {
    success: Boolean(receiptResult.success),
    method: receiptResult.method || null,
    error: receiptResult.error || null,
    fallback: receiptResult.fallback || null,
  });
  if (!receiptResult.success) {
    pipelineLog('printerService.sendReceiptThenMaybeDrawer.exit', {
      success: false,
      drawerOpened: false,
      drawerPulseSent: false,
      reason: 'receiptFailed',
      error: receiptResult.error,
    });
    return { ...receiptResult, drawerOpened: false };
  }

  if (!openDrawer) {
    pipelineLog('printerService.sendReceiptThenMaybeDrawer.exit', {
      success: true,
      drawerOpened: false,
      drawerPulseSent: false,
      reason: 'openDrawerFalse',
    });
    return { ...receiptResult, drawerOpened: false };
  }

  // Separate job: never bundle ESC p with the receipt.
  pipelineLog('printerService.drawerKick.begin', { configured, bytes: buildDrawerKick().length });
  const drawerResult = await sendPayload(configured, buildDrawerKick());
  pipelineLog('printerService.drawerKick.result', {
    success: Boolean(drawerResult.success),
    error: drawerResult.error || null,
    drawerPulseSent: Boolean(drawerResult.success),
  });
  if (!drawerResult.success) {
    pipelineLog('printerService.sendReceiptThenMaybeDrawer.exit', {
      success: true,
      drawerOpened: false,
      drawerPulseSent: false,
      reason: 'drawerFailedAfterReceiptOk',
      drawerError: drawerResult.error,
    });
    return {
      ...receiptResult,
      drawerOpened: false,
      drawerError: drawerResult.error || 'Cash drawer kick failed.',
    };
  }
  pipelineLog('printerService.sendReceiptThenMaybeDrawer.exit', {
    success: true,
    drawerOpened: true,
    drawerPulseSent: true,
    reason: 'receiptAndDrawerOk',
  });
  return { ...receiptResult, drawerOpened: true };
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
  pipelineLog('printerService.sendPayload.enter', {
    configured,
    bytes: payload?.length || 0,
    path: isRawEscPosPort(configured) ? 'escpos-port' : 'escpos-windows',
  });
  if (isRawEscPosPort(configured)) {
    const port = resolvePrinterPath(configured);
    try {
      await withTimeout(
        fs.promises.writeFile(port, payload),
        ESCPOS_PORT_TIMEOUT_MS,
        `Printer timed out after ${ESCPOS_PORT_TIMEOUT_MS / 1000}s. Check the XP-80U is online and not paused.`
      );
      pipelineLog('printerService.sendPayload.exit', {
        success: true,
        method: 'escpos-port',
        port,
        bytes: payload?.length || 0,
      });
      return { success: true, fallback: null, method: 'escpos-port' };
    } catch (err) {
      pipelineLog('printerService.sendPayload.exit', {
        success: false,
        method: 'escpos-port',
        port,
        error: err.message,
      });
      return {
        success: false,
        fallback: 'html',
        error: err.message || 'Printer port write failed.',
      };
    }
  }

  try {
    const raw = await writeRawToWindowsPrinter(configured, payload);
    pipelineLog('printerService.sendPayload.exit', {
      success: true,
      method: 'escpos-windows',
      configured,
      written: raw?.written,
      bytesLen: raw?.bytesLen,
    });
    return { success: true, fallback: null, method: 'escpos-windows', ...raw };
  } catch (err) {
    pipelineLog('printerService.sendPayload.exit', {
      success: false,
      method: 'escpos-windows',
      configured,
      error: err.message,
    });
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
    pipelineLog('printerService.printReceipt.enter', {
      saleId: sale?.id,
      invoiceNumber: sale?.invoiceNumber,
      paymentMethod: sale?.paymentMethod,
      openDrawer: Boolean(openDrawer),
      configured,
      paperWidth,
    });

    if (!configured) {
      const result = {
        success: false,
        fallback: 'html',
        error: 'No receipt printer selected in Settings.',
        drawerOpened: false,
      };
      pipelineLog('printerService.printReceipt.exit', result);
      return result;
    }

    const payload = buildPayload({ shop, sale, paperWidth });
    const result = await sendReceiptThenMaybeDrawer(configured, payload, Boolean(openDrawer));
    pipelineLog('printerService.printReceipt.exit', {
      success: Boolean(result.success),
      drawerOpened: Boolean(result.drawerOpened),
      drawerPulseSent: Boolean(result.drawerOpened),
      error: result.error || null,
      method: result.method || null,
      returningSuccessToIpc: Boolean(result.success),
    });
    return result;
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
        drawerOpened: false,
      };
    }

    const payload = buildReturnPayload({ shop, returnRecord, paperWidth });
    return sendReceiptThenMaybeDrawer(configured, payload, Boolean(openDrawer));
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

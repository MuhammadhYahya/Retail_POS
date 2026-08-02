/**
 * Shared cashier-facing copy and HTML fallback helpers for bill-print recovery.
 * Manual reprint path only — no printer online/offline polling.
 */

import {
  buildThermalReceiptHtml,
  buildThermalReturnReceiptHtml,
} from './receiptHtml.js';

export const PRINT_FAILED_MESSAGE =
  'Receipt printing failed. Please check the printer.';

export const REPRINT_WHEN_READY_MESSAGE =
  "Receipt wasn't printed. Reprint when the printer is ready.";

export const HTML_FALLBACK_OPENED_NOTE = 'Opened browser print dialog.';

export const POPUP_BLOCKED_ERROR =
  'Pop-up blocked. Allow pop-ups to print the receipt.';

/**
 * Open an HTML receipt in a new window (optional autoPrint already in HTML).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function openHtmlReceiptWindow(html) {
  const win = window.open('', '_blank', 'width=360,height=640');
  if (!win) {
    return { ok: false, error: POPUP_BLOCKED_ERROR };
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return { ok: true };
}

/**
 * Build the status string shown after a thermal print failure.
 * Uses fixed cashier copy; technical errMsg is not shown to keep messaging clear.
 */
export function formatPrintFailureStatus({ fallbackOk, fallbackError } = {}) {
  if (fallbackOk) {
    return `${PRINT_FAILED_MESSAGE} ${HTML_FALLBACK_OPENED_NOTE} ${REPRINT_WHEN_READY_MESSAGE}`;
  }
  return `${PRINT_FAILED_MESSAGE} ${fallbackError || POPUP_BLOCKED_ERROR} ${REPRINT_WHEN_READY_MESSAGE}`;
}

export function openSaleHtmlFallback(sale, shopSettings) {
  const html = buildThermalReceiptHtml({
    shop: shopSettings || {},
    sale,
    paperWidth: shopSettings?.paperWidth || 80,
    autoPrint: true,
  });
  return openHtmlReceiptWindow(html);
}

export function openReturnHtmlFallback(returnRecord, shopSettings) {
  const html = buildThermalReturnReceiptHtml({
    shop: shopSettings || {},
    returnRecord,
    paperWidth: shopSettings?.paperWidth || 80,
    autoPrint: true,
  });
  return openHtmlReceiptWindow(html);
}

/** True when status text should be styled as a print failure. */
export function isPrintFailureStatus(status) {
  return /fail|error|block|wasn't printed|check the printer/i.test(String(status || ''));
}

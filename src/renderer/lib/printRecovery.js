/**
 * Shared bill-print recovery for sales and returns.
 *
 * EVERY Billing / Returns thermal print must go through
 * printSaleReceiptWithRecovery / printReturnReceiptWithRecovery.
 * Manual reprint only — no reconnect auto-print, no printer polling.
 */

import { invokeWithAuth } from './ipc.js';
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

function thermalSucceeded(printRes) {
  // IPC now bubbles thermal success to top-level; still accept nested data.success.
  if (!printRes) return false;
  if (printRes.success === false) return false;
  if (printRes.data && printRes.data.success === false) return false;
  return printRes.success === true && printRes.data?.success === true;
}

async function rendererPipelineLog(step, fields = {}) {
  try {
    await invokeWithAuth('printer:pipelineLog', { step, fields });
  } catch {
    // Investigation aid only — never block print flow.
  }
}

/**
 * Sale auto-print or reprint. On failure: HTML fallback + recovery message.
 * Reprint must pass openDrawer: false.
 *
 * @returns {{ ok: boolean, printFailed: boolean, drawerOpened: boolean, message: string }}
 */
export async function printSaleReceiptWithRecovery({
  saleId,
  sale,
  shopSettings,
  openDrawer = false,
  reprinted = false,
} = {}) {
  await rendererPipelineLog('printSaleReceiptWithRecovery.enter', {
    saleId,
    invoiceNumber: sale?.invoiceNumber,
    openDrawer: Boolean(openDrawer),
    reprinted: Boolean(reprinted),
  });
  try {
    const printRes = await invokeWithAuth('printer:printReceipt', {
      saleId,
      openDrawer: Boolean(openDrawer),
    });

    const ok = thermalSucceeded(printRes);
    await rendererPipelineLog('printSaleReceiptWithRecovery.ipcResult', {
      saleId,
      ipcSuccess: printRes?.success,
      dataSuccess: printRes?.data?.success,
      thermalSucceeded: ok,
      drawerOpened: Boolean(printRes?.data?.drawerOpened),
      error: printRes?.data?.error || printRes?.error || null,
      messageChosenWillBeSuccessPath: ok,
    });

    if (ok) {
      const drawerOpened = Boolean(printRes.data?.drawerOpened);
      let message = reprinted ? 'Receipt reprinted.' : 'Receipt printed.';
      if (!reprinted && openDrawer && drawerOpened) {
        message = 'Receipt printed. Cash drawer opened.';
      } else if (!reprinted && openDrawer && !drawerOpened) {
        message = 'Receipt printed. Cash drawer did not open.';
      }
      await rendererPipelineLog('printSaleReceiptWithRecovery.exit', {
        ok: true,
        printFailed: false,
        drawerOpened,
        successReturnedToBilling: true,
        message,
      });
      return {
        ok: true,
        printFailed: false,
        drawerOpened,
        message,
      };
    }

    const fallback = openSaleHtmlFallback(sale, shopSettings);
    const failure = {
      ok: false,
      printFailed: true,
      drawerOpened: false,
      message: formatPrintFailureStatus(fallback),
      technicalError: printRes?.data?.error || printRes?.error,
    };
    await rendererPipelineLog('printSaleReceiptWithRecovery.exit', {
      ...failure,
      successReturnedToBilling: false,
      htmlFallbackOk: Boolean(fallback.ok),
    });
    return failure;
  } catch (err) {
    const fallback = openSaleHtmlFallback(sale, shopSettings);
    const failure = {
      ok: false,
      printFailed: true,
      drawerOpened: false,
      message: formatPrintFailureStatus(fallback),
    };
    await rendererPipelineLog('printSaleReceiptWithRecovery.exit', {
      ...failure,
      successReturnedToBilling: false,
      thrown: err?.message || String(err),
    });
    return failure;
  }
}

/**
 * Return auto-print or Print Again. On failure: HTML fallback + recovery message.
 * Reprint must pass openDrawer: false.
 */
export async function printReturnReceiptWithRecovery({
  returnId,
  returnRecord,
  shopSettings,
  openDrawer = false,
  reprinted = false,
} = {}) {
  try {
    const printRes = await invokeWithAuth('printer:printReturnReceipt', {
      returnId,
      openDrawer: Boolean(openDrawer),
    });

    if (thermalSucceeded(printRes)) {
      const drawerOpened = Boolean(printRes.data?.drawerOpened);
      let message = reprinted ? 'Return receipt reprinted.' : 'Return receipt printed.';
      if (!reprinted && openDrawer && drawerOpened) {
        message = 'Return receipt printed. Cash drawer opened.';
      } else if (!reprinted && openDrawer && !drawerOpened) {
        message = 'Return receipt printed. Cash drawer did not open.';
      }
      return {
        ok: true,
        printFailed: false,
        drawerOpened,
        message,
      };
    }

    const fallback = openReturnHtmlFallback(returnRecord, shopSettings);
    return {
      ok: false,
      printFailed: true,
      drawerOpened: false,
      message: formatPrintFailureStatus(fallback),
      technicalError: printRes?.data?.error || printRes?.error,
    };
  } catch {
    const fallback = openReturnHtmlFallback(returnRecord, shopSettings);
    return {
      ok: false,
      printFailed: true,
      drawerOpened: false,
      message: formatPrintFailureStatus(fallback),
    };
  }
}

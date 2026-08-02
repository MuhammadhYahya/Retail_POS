#!/usr/bin/env node
/**
 * Turn print-pipeline-debug.jsonl into a readable timeline.
 * Usage: node scripts/analyze-print-pipeline-log.mjs [path/to/print-pipeline-debug.jsonl]
 */
import fs from 'node:fs';
import path from 'node:path';

const logPath = path.resolve(
  process.argv[2] || path.join(process.cwd(), 'print-pipeline-debug.jsonl')
);

if (!fs.existsSync(logPath)) {
  console.error(`Log not found: ${logPath}`);
  console.error('Complete one sale with the instrumented build, then re-run.');
  process.exit(1);
}

const lines = fs
  .readFileSync(logPath, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, step: 'parse-error', raw: line };
    }
  });

console.log(`# Print pipeline timeline`);
console.log(`Source: ${logPath}`);
console.log(`Events: ${lines.length}`);
console.log('');

let successDecision = null;

for (const e of lines) {
  const t = e.ts || '?';
  const step = e.step || '?';
  const bits = [];
  if (e.printerName) bits.push(`printer=${e.printerName}`);
  if (e.configured) bits.push(`configured=${e.configured}`);
  if (e.bytes != null) bits.push(`bytes=${e.bytes}`);
  if (e.bytesWritten != null) bits.push(`written=${e.bytesWritten}`);
  if (e.lastError != null) bits.push(`GetLastError=${e.lastError}`);
  if (e.printerState) bits.push(`state=${e.printerState}`);
  if (e.jobAddedToSpooler != null) bits.push(`spoolerAdd=${e.jobAddedToSpooler}`);
  if (e.jobCommittedToSpooler != null) bits.push(`spoolerCommit=${e.jobCommittedToSpooler}`);
  if (e.drawerPulseSent != null) bits.push(`drawerPulse=${e.drawerPulseSent}`);
  if (e.drawerOpened != null) bits.push(`drawerOpened=${e.drawerOpened}`);
  if (e.successReturnedToRenderer != null) {
    bits.push(`successToRenderer=${e.successReturnedToRenderer}`);
  }
  if (e.successReturnedToBilling != null) {
    bits.push(`successToBilling=${e.successReturnedToBilling}`);
  }
  if (e.uiShowsSuccess != null) bits.push(`uiShowsSuccess=${e.uiShowsSuccess}`);
  if (e.thermalSucceeded != null) bits.push(`thermalSucceeded=${e.thermalSucceeded}`);
  if (e.ok != null && step.includes('win32')) bits.push(`ok=${e.ok}`);
  if (e.error) bits.push(`error=${e.error}`);
  if (e.uiMessage) bits.push(`uiMessage=${JSON.stringify(e.uiMessage)}`);

  console.log(`${t}  ${step}${bits.length ? `  | ${bits.join(' ')}` : ''}`);

  if (
    !successDecision
    && (step === 'ipc.printer:printReceipt.exit' || step === 'printSaleReceiptWithRecovery.exit')
    && (e.successReturnedToRenderer === true || e.successReturnedToBilling === true)
  ) {
    successDecision = e;
  }
  if (!successDecision && step === 'BillingPage.handleCompleteSale.print.end' && e.uiShowsSuccess === true) {
    successDecision = e;
  }
}

console.log('');
if (successDecision) {
  console.log('## Incorrect success decision (first success signal)');
  console.log(JSON.stringify(successDecision, null, 2));
} else {
  console.log('## No successReturnedToRenderer/Billing=true found in this log.');
  console.log('If the UI still showed success, the running app may not be this instrumented build.');
}

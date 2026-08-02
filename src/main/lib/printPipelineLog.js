/**
 * Investigation-only print pipeline logger.
 * Does not change print success/failure behavior.
 *
 * Writes JSONL to:
 *   1) <cwd>/print-pipeline-debug.jsonl  (dev / easy to find)
 *   2) <userData>/print-pipeline-debug.jsonl when Electron app is ready
 *   3) console as [PRINT-PIPELINE]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const PRINT_PIPELINE_LOG_VERSION = 'investigate-1';

const require = createRequire(import.meta.url);

let sessionId = `sess_${Date.now().toString(36)}`;
let cwdLogPath = path.join(process.cwd(), 'print-pipeline-debug.jsonl');
let userDataLogPath = null;

function resolveUserDataPath() {
  if (userDataLogPath) return;
  try {
    // Lazy require so Node probes without electron still write the cwd log.
    const { app } = require('electron');
    if (app?.isReady?.()) {
      userDataLogPath = path.join(app.getPath('userData'), 'print-pipeline-debug.jsonl');
    }
  } catch {
    // ignore — cwd log still works
  }
}

export function getPrintPipelineLogPaths() {
  resolveUserDataPath();
  return {
    cwd: cwdLogPath,
    userData: userDataLogPath,
    sessionId,
    version: PRINT_PIPELINE_LOG_VERSION,
  };
}

export function resetPrintPipelineSession(reason = 'reset') {
  sessionId = `sess_${Date.now().toString(36)}`;
  pipelineLog('session.reset', { reason, sessionId });
  return sessionId;
}

export function pipelineLog(step, fields = {}) {
  resolveUserDataPath();
  const entry = {
    ts: new Date().toISOString(),
    tsm: Date.now(),
    sessionId,
    version: PRINT_PIPELINE_LOG_VERSION,
    step,
    ...fields,
  };
  const line = `${JSON.stringify(entry)}\n`;
  try {
    fs.appendFileSync(cwdLogPath, line, 'utf8');
  } catch (err) {
    console.error('[PRINT-PIPELINE] cwd log write failed', err.message);
  }
  if (userDataLogPath) {
    try {
      fs.appendFileSync(userDataLogPath, line, 'utf8');
    } catch (err) {
      console.error('[PRINT-PIPELINE] userData log write failed', err.message);
    }
  }
  console.log('[PRINT-PIPELINE]', step, JSON.stringify(fields));
  return entry;
}

/** Parse WIN32LOG|* lines emitted by the PowerShell/C# probe. */
export function ingestWin32LogLines(stdout) {
  const text = String(stdout || '');
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith('WIN32LOG|'));
  for (const line of lines) {
    const payload = line.slice('WIN32LOG|'.length);
    try {
      const parsed = JSON.parse(payload);
      pipelineLog(`win32.${parsed.api || 'event'}`, {
        source: 'windowsRawPrint.ps1',
        ...parsed,
      });
    } catch {
      pipelineLog('win32.raw', { source: 'windowsRawPrint.ps1', line: payload });
    }
  }
  return lines.length;
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

/** @type {Map<string, { cancelled: boolean }>} */
const jobs = new Map();

export const progressBus = new EventEmitter();
progressBus.setMaxListeners(50);

export function createJob(jobId = crypto.randomUUID()) {
  jobs.set(jobId, { cancelled: false });
  return jobId;
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

export function isCancelled(jobId) {
  return Boolean(jobs.get(jobId)?.cancelled);
}

export function finishJob(jobId) {
  jobs.delete(jobId);
}

export function emitProgress(jobId, payload) {
  progressBus.emit('progress', {
    jobId,
    channel: payload.channel || 'backup:progress',
    ...payload,
  });
}

export function assertNotCancelled(jobId) {
  if (jobId && isCancelled(jobId)) {
    const err = new Error('Backup cancelled.');
    err.code = 'CANCELLED';
    throw err;
  }
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function formatBackupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `ZEN_Backup_${stamp}.zenbackup`;
}

export function walkFiles(dirPath, base = dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, base));
    } else if (entry.isFile()) {
      files.push({
        absolutePath: full,
        relativePath: path.relative(base, full).split(path.sep).join('/'),
      });
    }
  }
  return files;
}

export function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function safeRmDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

export function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

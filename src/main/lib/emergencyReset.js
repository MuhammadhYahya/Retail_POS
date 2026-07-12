import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

const FILE_NAME = 'posly-emergency-reset.txt';
const CODE_TTL_MS = 10 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 30 * 1000;

/** @type {Map<string, { codeHash: string, expiresAt: number, lastRequestAt: number }>} */
const pendingByUserId = new Map();

export function getEmergencyResetFilePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

export function requestEmergencyCode(userId, username) {
  const now = Date.now();
  const existing = pendingByUserId.get(userId);

  if (existing && now - existing.lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_REQUEST_INTERVAL_MS - (now - existing.lastRequestAt)) / 1000);
    return {
      success: false,
      error: `Please wait ${waitSec}s before requesting another code.`,
    };
  }

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = now + CODE_TTL_MS;
  const filePath = getEmergencyResetFilePath();

  const contents = [
    'POSLY Emergency Admin PIN Reset',
    '================================',
    `Username: ${username}`,
    `Code: ${code}`,
    `Expires: ${new Date(expiresAt).toLocaleString()}`,
    '',
    'Enter this code in the Forgot PIN dialog to set a new PIN.',
    'This file is only valid on this computer.',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, contents, 'utf8');

  pendingByUserId.set(userId, {
    codeHash: hashCode(code),
    expiresAt,
    lastRequestAt: now,
  });

  console.log(`[emergency-reset] Code for ${username} written to ${filePath}`);
  console.log(`[emergency-reset] Code: ${code} (expires in 10 minutes)`);

  return {
    success: true,
    data: {
      filePath,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
    },
  };
}

export function verifyEmergencyCode(userId, code) {
  const pending = pendingByUserId.get(userId);
  if (!pending) {
    return { success: false, error: 'No emergency code requested. Request a new code first.' };
  }

  if (Date.now() > pending.expiresAt) {
    pendingByUserId.delete(userId);
    clearEmergencyResetFile();
    return { success: false, error: 'Emergency code expired. Request a new code.' };
  }

  if (hashCode(code) !== pending.codeHash) {
    return { success: false, error: 'Invalid emergency code.' };
  }

  return { success: true };
}

export function clearEmergencyReset(userId) {
  pendingByUserId.delete(userId);
  clearEmergencyResetFile();
}

function clearEmergencyResetFile() {
  const filePath = getEmergencyResetFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('[emergency-reset] Failed to delete code file:', err.message);
  }
}

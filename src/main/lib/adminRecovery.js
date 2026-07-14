import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

const FILE_NAME = 'posly-admin-recovery.txt';
const CODE_TTL_MS = 15 * 60 * 1000;

function formatExpiry(expiresAt) {
  return new Date(expiresAt).toLocaleString();
}

export function getAdminRecoveryFilePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

export function requestAdminRecoveryCode() {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + CODE_TTL_MS;
  const filePath = getAdminRecoveryFilePath();

  const contents = [
    'POSLY Admin Recovery',
    '====================',
    `Code: ${code}`,
    `ExpiresAt: ${expiresAt}`,
    `Expires: ${formatExpiry(expiresAt)}`,
    '',
    'Use this code in the admin recovery form to create a new administrator account.',
    'This code is valid only on this computer.',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, contents, 'utf8');

  return {
    success: true,
    data: {
      filePath,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
    },
  };
}

export function verifyAdminRecoveryCode(inputCode) {
  const filePath = getAdminRecoveryFilePath();

  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'No recovery code exists. Generate a new one first.' };
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const codeMatch = contents.match(/Code:\s*(\d{6})/);
  const expiresMatch = contents.match(/ExpiresAt:\s*(\d+)/);

  if (!codeMatch) {
    return { success: false, error: 'Recovery code file is invalid. Generate a new code.' };
  }

  const expectedCode = codeMatch[1];
  const expiresAt = expiresMatch ? Number(expiresMatch[1]) : NaN;

  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    clearAdminRecoveryCode();
    return { success: false, error: 'Recovery code expired. Generate a new one.' };
  }

  if (String(inputCode || '').trim() !== expectedCode) {
    return { success: false, error: 'Invalid recovery code.' };
  }

  return { success: true };
}

export function clearAdminRecoveryCode() {
  const filePath = getAdminRecoveryFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('[admin-recovery] Failed to delete recovery code file:', err.message);
  }
}

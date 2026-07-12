import crypto from 'crypto';
import { getDb } from '../database/db.js';

const FALLBACK_SECRET = 'posly-local-secret-2026-do-not-share';

export function getJwtSecret() {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM app_secrets WHERE key = 'jwt_secret'`).get();
  if (row?.value) return row.value;
  return process.env.JWT_SECRET || FALLBACK_SECRET;
}

export function ensureJwtSecret() {
  const db = getDb();
  const existing = db.prepare(`SELECT value FROM app_secrets WHERE key = 'jwt_secret'`).get();
  if (existing?.value) return existing.value;

  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO app_secrets (key, value, created_at)
    VALUES ('jwt_secret', ?, ?)
  `).run(secret, new Date().toISOString());
  return secret;
}

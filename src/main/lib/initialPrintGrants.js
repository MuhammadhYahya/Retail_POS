import crypto from 'node:crypto';

const grants = new Map();
const GRANT_TTL_MS = 2 * 60 * 1000;

export function issueInitialPrintGrant({ saleId, userId }) {
  const token = crypto.randomUUID();
  grants.set(token, { saleId, userId, expiresAt: Date.now() + GRANT_TTL_MS });
  return token;
}

export function consumeInitialPrintGrant(token, { saleId, userId } = {}) {
  const grant = grants.get(String(token || ''));
  if (!grant) return false;
  grants.delete(String(token));
  if (grant.expiresAt < Date.now()) return false;
  return grant.saleId === saleId && grant.userId === userId;
}

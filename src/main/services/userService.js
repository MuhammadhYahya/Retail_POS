import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../database/db.js';
import {
  normalizeAnswer,
  validateQuestionPair,
  hasSecurityQuestions,
} from '../lib/securityQuestions.js';

const PIN_REGEX = /^[0-9]{4}$/;

async function hashPin(pin) {
  return bcrypt.hash(String(pin).trim(), 12);
}

const userService = {
  getAll() {
    const db = getDb();
    return db.prepare(`
      SELECT id, username, display_name, role, is_active, failed_attempts, created_at, email, phone
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `).all();
  },

  getById(id) {
    const db = getDb();
    return db.prepare(`
      SELECT id, username, display_name, role, is_active, failed_attempts, deleted_at,
             security_q1, security_a1_hash, security_q2, security_a2_hash, email, phone
      FROM users
      WHERE id = ?
    `).get(id);
  },

  getByUsername(username) {
    const db = getDb();
    return db.prepare(`
      SELECT *
      FROM users
      WHERE username = ?
        AND deleted_at IS NULL
    `).get(String(username || '').trim());
  },

  countActiveAdmins(excludeId = null) {
    const db = getDb();
    if (excludeId) {
      return db.prepare(`
        SELECT COUNT(*) as count
        FROM users
        WHERE role = 'admin'
          AND is_active = 1
          AND deleted_at IS NULL
          AND id != ?
      `).get(excludeId).count;
    }
    return db.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE role = 'admin'
        AND is_active = 1
        AND deleted_at IS NULL
    `).get().count;
  },

  needsRecoverySetup(user) {
    if (!user || user.role !== 'admin') return false;
    return !hasSecurityQuestions(user);
  },

  async isPinUsed(pin, excludeUserId = null) {
    const db = getDb();
    const pinString = String(pin || '').trim();

    const rows = excludeUserId
      ? db.prepare(`
          SELECT id, pin_hash
          FROM users
          WHERE is_active = 1
            AND deleted_at IS NULL
            AND id != ?
        `).all(excludeUserId)
      : db.prepare(`
          SELECT id, pin_hash
          FROM users
          WHERE is_active = 1
            AND deleted_at IS NULL
        `).all();

    for (const row of rows) {
      const matches = await bcrypt.compare(pinString, row.pin_hash);
      if (matches) {
        return true;
      }
    }

    return false;
  },

  async create({
    username,
    pin,
    role,
    displayName,
    securityQ1,
    securityA1,
    securityQ2,
    securityA2,
    email,
    phone,
  }) {
    const db = getDb();
    const usernameClean = String(username || '').trim();
    const pinString = String(pin || '').trim();
    const normalizedRole = role === 'admin' ? 'admin' : 'cashier';

    if (!usernameClean || usernameClean.length < 2) {
      throw new Error('Username must be at least 2 characters.');
    }

    if (!PIN_REGEX.test(pinString)) {
      throw new Error('PIN must be exactly 4 numeric digits.');
    }

    let q1 = null;
    let a1Hash = null;
    let q2 = null;
    let a2Hash = null;

    if (normalizedRole === 'admin') {
      const questionError = validateQuestionPair(securityQ1, securityQ2);
      if (questionError) throw new Error(questionError);

      const a1 = normalizeAnswer(securityA1);
      const a2 = normalizeAnswer(securityA2);
      if (!a1 || !a2) {
        throw new Error('Security answers are required for admin accounts.');
      }

      q1 = securityQ1;
      q2 = securityQ2;
      a1Hash = await bcrypt.hash(a1, 12);
      a2Hash = await bcrypt.hash(a2, 12);
    }

    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(usernameClean);
    if (existing) {
      throw new Error('Username already exists.');
    }

    if (await userService.isPinUsed(pinString)) {
      throw new Error('PIN already exists for another active account. Please choose a different 4-digit PIN.');
    }

    const pinHash = await hashPin(pinString);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const emailClean = email ? String(email).trim() : null;
    const phoneClean = phone ? String(phone).trim() : null;

    db.prepare(`
      INSERT INTO users (
        id, username, display_name, pin_hash, role,
        is_active, failed_attempts, created_at, updated_at,
        security_q1, security_a1_hash, security_q2, security_a2_hash,
        email, phone
      )
      VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      usernameClean,
      displayName?.trim() || usernameClean,
      pinHash,
      normalizedRole,
      now,
      now,
      q1,
      a1Hash,
      q2,
      a2Hash,
      emailClean,
      phoneClean
    );

    return {
      id,
      username: usernameClean,
      display_name: displayName?.trim() || usernameClean,
      role: normalizedRole,
    };
  },

  softDelete(id) {
    const db = getDb();
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE users SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?
    `).run(now, now, id);
  },

  unlock(id) {
    const db = getDb();
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE users SET failed_attempts = 0, updated_at = ? WHERE id = ?
    `).run(now, id);
  },

  async resetPin(id, newPin) {
    const pinString = String(newPin || '').trim();
    if (!PIN_REGEX.test(pinString)) {
      throw new Error('PIN must be exactly 4 numeric digits.');
    }

    if (await userService.isPinUsed(pinString, id)) {
      throw new Error('PIN already exists for another active account. Please choose a different 4-digit PIN.');
    }

    const db = getDb();
    const pinHash = await hashPin(pinString);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE users
      SET pin_hash = ?, failed_attempts = 0, updated_at = ?
      WHERE id = ?
    `).run(pinHash, now, id);

    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  },

  async setSecurityQuestions(userId, {
    securityQ1,
    securityA1,
    securityQ2,
    securityA2,
    email,
    phone,
  }) {
    const questionError = validateQuestionPair(securityQ1, securityQ2);
    if (questionError) throw new Error(questionError);

    const a1 = normalizeAnswer(securityA1);
    const a2 = normalizeAnswer(securityA2);
    if (!a1 || !a2) {
      throw new Error('Security answers are required.');
    }

    const a1Hash = await bcrypt.hash(a1, 12);
    const a2Hash = await bcrypt.hash(a2, 12);
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(`
      UPDATE users
      SET security_q1 = ?,
          security_a1_hash = ?,
          security_q2 = ?,
          security_a2_hash = ?,
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          updated_at = ?
      WHERE id = ?
    `).run(
      securityQ1,
      a1Hash,
      securityQ2,
      a2Hash,
      email ? String(email).trim() : null,
      phone ? String(phone).trim() : null,
      now,
      userId
    );
  },
};

export default userService;

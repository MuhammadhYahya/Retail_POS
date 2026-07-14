import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../database/db.js';
import crypto from 'crypto';
import { getJwtSecret, ensureJwtSecret } from '../lib/jwtSecret.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { getRegistrationContext } from '../lib/registrationContext.js';
import {
  clearAdminRecoveryCode,
  requestAdminRecoveryCode,
  verifyAdminRecoveryCode,
} from '../lib/adminRecovery.js';
import {
  SECURITY_QUESTIONS,
  normalizeAnswer,
  validateQuestionPair,
  hasSecurityQuestions,
} from '../lib/securityQuestions.js';
import {
  requestEmergencyCode,
  verifyEmergencyCode,
  clearEmergencyReset,
  getEmergencyResetFilePath,
} from '../lib/emergencyReset.js';
import { validateSession, extractToken } from '../lib/sessionAuth.js';
import userService from '../services/userService.js';

const PIN_REGEX = /^[0-9]{4}$/;

function findActiveAdminByUsername(username) {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM users
    WHERE username = ?
      AND is_active = 1
      AND deleted_at IS NULL
  `).get(String(username || '').trim());
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    needsRecoverySetup: userService.needsRecoverySetup(user),
  };
}

export function registerAuthHandlers() {
  ensureJwtSecret();

  ipcMain.handle('auth:getRegistrationContext', () => {
    try {
      const context = getRegistrationContext();
      return {
        success: true,
        data: {
          ...context,
          securityQuestions: SECURITY_QUESTIONS,
        },
      };
    } catch (err) {
      console.error('[auth:getRegistrationContext] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:getSecurityQuestions', () => {
    return { success: true, data: SECURITY_QUESTIONS };
  });

  ipcMain.handle('auth:requestAdminRecovery', () => {
    try {
      const context = getRegistrationContext();
      if (context.mode !== 'recovery') {
        return { success: false, error: 'Admin recovery is only available when no active administrator exists.' };
      }

      return requestAdminRecoveryCode();
    } catch (err) {
      console.error('[auth:requestAdminRecovery] Error:', err.message);
      return { success: false, error: 'Failed to create recovery code.' };
    }
  });

  ipcMain.handle('auth:getUsers', () => {
    try {
      const db = getDb();
      const users = db.prepare(`
        SELECT id, username, display_name, role
        FROM users
        WHERE is_active = 1
          AND deleted_at IS NULL
        ORDER BY display_name ASC
      `).all();

      return { success: true, data: users };
    } catch (err) {
      console.error('[auth:getUsers] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:login', async (event, { username, pin }) => {
    try {
      const db = getDb();
      const usernameClean = String(username || '').trim();
      const pinString = String(pin || '').trim();

      if (!usernameClean) {
        return { success: false, message: 'Username is required.', error: 'Username is required.' };
      }

      if (!PIN_REGEX.test(pinString)) {
        return { success: false, message: 'Enter a valid 4 digit PIN.', error: 'Invalid PIN format.' };
      }

      const user = db.prepare(`
        SELECT *
        FROM users
        WHERE username   = ?
          AND is_active  = 1
          AND deleted_at IS NULL
      `).get(usernameClean);

      if (!user) {
        writeAuditLog(`login_failed:unknown_user:${usernameClean}`);
        return { success: false, message: 'User not found.', error: 'User not found.' };
      }

      if (user.failed_attempts >= 5) {
        return {
          success: false,
          error: 'Account locked after 5 wrong PINs. Ask admin to unlock.',
        };
      }

      const pinMatches = await bcrypt.compare(pinString, user.pin_hash);

      if (!pinMatches) {
        db.prepare(`
          UPDATE users
          SET failed_attempts = failed_attempts + 1,
              updated_at      = ?
          WHERE id = ?
        `).run(new Date().toISOString(), user.id);

        const attemptsLeft = Math.max(0, 4 - user.failed_attempts);
        writeAuditLog(`login_failed:wrong_pin:${user.username}`, user.id);

        if (user.failed_attempts + 1 >= 5) {
          writeAuditLog(`account_locked:${user.username}`, user.id);
        }

        return {
          success: false,
          message: `Incorrect PIN. ${attemptsLeft} attempts remaining.`,
          error: `Incorrect PIN. ${attemptsLeft} attempts remaining.`,
        };
      }

      db.prepare(`
        UPDATE users
        SET failed_attempts = 0,
            updated_at      = ?
        WHERE id = ?
      `).run(new Date().toISOString(), user.id);

      const token = jwt.sign(
        { userId: user.id, role: user.role },
        getJwtSecret(),
        { expiresIn: '8h' }
      );

      const now = new Date().toISOString();

      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);

      db.prepare(`
        INSERT INTO sessions (user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).run(
        user.id,
        token,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        now
      );

      writeAuditLog(`login_success:${user.username}`, user.id);

      return {
        success: true,
        token,
        user: publicUser(user),
      };
    } catch (err) {
      console.error('[auth:login] Error:', err.message);
      return { success: false, error: 'Login failed. Please try again.' };
    }
  });

  ipcMain.handle('auth:logout', (event, { token } = {}) => {
    try {
      const db = getDb();

      if (token) {
        const session = db.prepare(`SELECT user_id FROM sessions WHERE token = ?`).get(token);
        db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
        if (session?.user_id) {
          writeAuditLog('logout', session.user_id);
        }
      } else {
        db.prepare(`DELETE FROM sessions`).run();
        writeAuditLog('logout_all');
      }

      return { success: true };
    } catch (err) {
      console.error('[auth:logout] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:restore-session', (event) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      const session = db.prepare(`
        SELECT s.token, u.id, u.username, u.display_name, u.role,
               u.security_a1_hash, u.security_a2_hash
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ?
          AND u.is_active  = 1
          AND u.deleted_at IS NULL
        ORDER BY s.created_at DESC
        LIMIT 1
      `).get(now);

      if (!session) {
        return { success: false };
      }

      try {
        jwt.verify(session.token, getJwtSecret());
      } catch (jwtErr) {
        db.prepare(`DELETE FROM sessions WHERE token = ?`).run(session.token);
        return { success: false };
      }

      return {
        success: true,
        token: session.token,
        user: publicUser(session),
      };
    } catch (err) {
      console.error('[auth:restore-session] Error:', err.message);
      return { success: false };
    }
  });

  ipcMain.handle('auth:register', async (event, payload = {}) => {
    try {
      const {
        username,
        pin,
        role,
        securityQ1,
        securityA1,
        securityQ2,
        securityA2,
        email,
        phone,
      } = payload;

      const context = getRegistrationContext();
      const db = getDb();
      const usernameClean = String(username || '').trim();
      const pinString = String(pin || '').trim();
      const requestedRole = role === 'admin' ? 'admin' : 'cashier';
      const recoveryCode = String(payload.recoveryCode || '').trim();

      if (!usernameClean || usernameClean.length < 2) {
        return { success: false, message: 'Username must be at least 2 characters.' };
      }

      if (!PIN_REGEX.test(pinString)) {
        return { success: false, message: 'PIN must be exactly 4 numeric digits.' };
      }

      let allowedRole;
      if (context.mode === 'bootstrap' || context.mode === 'recovery') {
        allowedRole = 'admin';
      } else {
        allowedRole = 'cashier';
      }

      if (requestedRole !== allowedRole) {
        return {
          success: false,
          message: context.mode === 'bootstrap'
            ? 'First account must be an Admin.'
            : context.mode === 'recovery'
              ? 'Admin recovery is required before creating an administrator account.'
            : 'Public registration is limited to Cashier accounts.',
        };
      }

      if (allowedRole === 'admin') {
        if (context.mode === 'recovery') {
          const recoveryCheck = verifyAdminRecoveryCode(recoveryCode);
          if (!recoveryCheck.success) {
            return { success: false, message: recoveryCheck.error };
          }
        } else {
          const questionError = validateQuestionPair(securityQ1, securityQ2);
          if (questionError) {
            return { success: false, message: questionError };
          }
          if (!normalizeAnswer(securityA1) || !normalizeAnswer(securityA2)) {
            return { success: false, message: 'Security answers are required.' };
          }
        }
      }

      const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(usernameClean);
      if (existing) {
        return { success: false, message: 'Username already exists. Please choose a different name.' };
      }

      const pinAlreadyUsed = await userService.isPinUsed(pinString);
      if (pinAlreadyUsed) {
        return {
          success: false,
          message: 'PIN already exists for another active account. Please choose a different 4-digit PIN.',
        };
      }

      const pinHash = await bcrypt.hash(pinString, 12);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      let q1 = null;
      let a1Hash = null;
      let q2 = null;
      let a2Hash = null;

      if (allowedRole === 'admin') {
        q1 = securityQ1;
        q2 = securityQ2;
        a1Hash = await bcrypt.hash(normalizeAnswer(securityA1), 12);
        a2Hash = await bcrypt.hash(normalizeAnswer(securityA2), 12);
      }

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
        usernameClean,
        pinHash,
        allowedRole,
        now,
        now,
        q1,
        a1Hash,
        q2,
        a2Hash,
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null
      );

      if (allowedRole === 'admin' && context.mode === 'recovery') {
        clearAdminRecoveryCode();
      }

      writeAuditLog(`register:${usernameClean}:${allowedRole}`, id);

      return { success: true };
    } catch (err) {
      console.error('[auth:register] Error:', err.message);
      return { success: false, message: 'Registration failed. Please try again.' };
    }
  });

  ipcMain.handle('auth:getRecoveryInfo', (event, { username } = {}) => {
    try {
      const user = findActiveAdminByUsername(username);

      if (!user || user.role !== 'admin') {
        return { success: false, error: 'Recovery unavailable for this account.' };
      }

      if (hasSecurityQuestions(user)) {
        return {
          success: true,
          data: {
            mode: 'questions',
            questions: [user.security_q1, user.security_q2],
          },
        };
      }

      return {
        success: true,
        data: {
          mode: 'emergency',
          filePath: getEmergencyResetFilePath(),
        },
      };
    } catch (err) {
      console.error('[auth:getRecoveryInfo] Error:', err.message);
      return { success: false, error: 'Recovery unavailable.' };
    }
  });

  ipcMain.handle('auth:resetAdminPin', async (event, payload = {}) => {
    try {
      const { username, answer1, answer2, newPin, confirmPin } = payload;
      const user = findActiveAdminByUsername(username);

      if (!user || user.role !== 'admin' || !hasSecurityQuestions(user)) {
        return { success: false, error: 'Recovery unavailable for this account.' };
      }

      if (!PIN_REGEX.test(String(newPin || '').trim())) {
        return { success: false, error: 'PIN must be exactly 4 numeric digits.' };
      }

      if (String(newPin) !== String(confirmPin)) {
        return { success: false, error: 'PINs do not match.' };
      }

      const a1Ok = await bcrypt.compare(normalizeAnswer(answer1), user.security_a1_hash);
      const a2Ok = await bcrypt.compare(normalizeAnswer(answer2), user.security_a2_hash);

      if (!a1Ok || !a2Ok) {
        writeAuditLog(`admin_pin_reset_failed:${user.username}`, user.id);
        return { success: false, error: 'Security answers do not match.' };
      }

      await userService.resetPin(user.id, newPin);
      writeAuditLog(`admin_pin_reset_self:${user.username}`, user.id);

      return { success: true };
    } catch (err) {
      console.error('[auth:resetAdminPin] Error:', err.message);
      return { success: false, error: err.message || 'Failed to reset PIN.' };
    }
  });

  ipcMain.handle('auth:requestEmergencyReset', (event, { username } = {}) => {
    try {
      const user = findActiveAdminByUsername(username);

      if (!user || user.role !== 'admin') {
        return { success: false, error: 'Recovery unavailable for this account.' };
      }

      if (hasSecurityQuestions(user)) {
        return {
          success: false,
          error: 'Emergency reset is disabled. Use security questions instead.',
        };
      }

      return requestEmergencyCode(user.id, user.username);
    } catch (err) {
      console.error('[auth:requestEmergencyReset] Error:', err.message);
      return { success: false, error: 'Failed to create emergency code.' };
    }
  });

  ipcMain.handle('auth:confirmEmergencyReset', async (event, payload = {}) => {
    try {
      const { username, code, newPin, confirmPin } = payload;
      const user = findActiveAdminByUsername(username);

      if (!user || user.role !== 'admin') {
        return { success: false, error: 'Recovery unavailable for this account.' };
      }

      if (hasSecurityQuestions(user)) {
        return {
          success: false,
          error: 'Emergency reset is disabled. Use security questions instead.',
        };
      }

      if (!PIN_REGEX.test(String(newPin || '').trim())) {
        return { success: false, error: 'PIN must be exactly 4 numeric digits.' };
      }

      if (String(newPin) !== String(confirmPin)) {
        return { success: false, error: 'PINs do not match.' };
      }

      const verified = verifyEmergencyCode(user.id, String(code || '').trim());
      if (!verified.success) {
        return verified;
      }

      await userService.resetPin(user.id, newPin);
      clearEmergencyReset(user.id);
      writeAuditLog(`admin_emergency_pin_reset:${user.username}`, user.id);

      return { success: true };
    } catch (err) {
      console.error('[auth:confirmEmergencyReset] Error:', err.message);
      return { success: false, error: err.message || 'Failed to reset PIN.' };
    }
  });

  ipcMain.handle('auth:setSecurityQuestions', async (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      if (session.user.role !== 'admin') {
        return { success: false, error: 'Only admins can set security questions.', code: 'FORBIDDEN' };
      }

      await userService.setSecurityQuestions(session.user.id, payload);
      writeAuditLog('admin_security_questions_set', session.user.id);

      return { success: true };
    } catch (err) {
      console.error('[auth:setSecurityQuestions] Error:', err.message);
      return { success: false, error: err.message || 'Failed to save security questions.' };
    }
  });

  ipcMain.handle('auth:getRecoveryStatus', (event, payload = {}) => {
    try {
      const token = extractToken(payload);
      const session = validateSession(token);
      if (!session.success) return session;

      const user = userService.getById(session.user.id);
      return {
        success: true,
        data: {
          needsRecoverySetup: userService.needsRecoverySetup(user),
          securityQuestions: SECURITY_QUESTIONS,
          email: user?.email || '',
          phone: user?.phone || '',
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

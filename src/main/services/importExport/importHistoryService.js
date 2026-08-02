import crypto from 'crypto';
import { getDb } from '../../database/db.js';
import { tableExists } from './formatUtils.js';

function now() {
  return new Date().toISOString();
}

const importHistoryService = {
  isAvailable() {
    return tableExists('import_history');
  },

  record({
    entityId,
    fileName = null,
    userId = null,
    userName = null,
    mode = null,
    status = 'completed',
    importedCount = 0,
    updatedCount = 0,
    skippedCount = 0,
    failedCount = 0,
    durationMs = 0,
    errorReport = null,
    summary = null,
  } = {}) {
    if (!this.isAvailable()) return null;
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO import_history (
        id, entity_id, file_name, user_id, user_name, mode, status,
        imported_count, updated_count, skipped_count, failed_count,
        duration_ms, error_report_json, summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entityId,
      fileName,
      userId,
      userName,
      mode,
      status,
      importedCount,
      updatedCount,
      skippedCount,
      failedCount,
      durationMs,
      errorReport ? JSON.stringify(errorReport.slice(0, 500)) : null,
      summary ? JSON.stringify(summary) : null,
      now()
    );
    return id;
  },

  list({ limit = 50 } = {}) {
    if (!this.isAvailable()) return [];
    const db = getDb();
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return db
      .prepare(`
        SELECT
          id,
          entity_id AS entityId,
          file_name AS fileName,
          user_id AS userId,
          user_name AS userName,
          mode,
          status,
          imported_count AS importedCount,
          updated_count AS updatedCount,
          skipped_count AS skippedCount,
          failed_count AS failedCount,
          duration_ms AS durationMs,
          summary_json AS summaryJson,
          created_at AS createdAt
        FROM import_history
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(take)
      .map((row) => ({
        ...row,
        summary: row.summaryJson ? safeJson(row.summaryJson) : null,
        summaryJson: undefined,
      }));
  },

  getErrorReport(id) {
    if (!this.isAvailable()) return [];
    const db = getDb();
    const row = db
      .prepare(`SELECT error_report_json AS errorReportJson FROM import_history WHERE id = ?`)
      .get(id);
    if (!row?.errorReportJson) return [];
    return safeJson(row.errorReportJson) || [];
  },
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default importHistoryService;

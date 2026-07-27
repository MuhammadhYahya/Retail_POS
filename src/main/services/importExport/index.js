import path from 'path';
import { listEntities, getEntity } from './entityRegistry.js';
import { loadRowsFromFile, serializeRows, writePdfReport, writeJson, rowsToCsv } from './formatUtils.js';
import backupService from '../backup/index.js';
import { createJob, finishJob, emitProgress, assertNotCancelled, cancelJob } from '../backup/backupUtils.js';

const LARGE_IMPORT_THRESHOLD = 500;

const importExportService = {
  listEntities() {
    return listEntities();
  },

  createJob,
  cancelJob,

  async exportData({
    entityId,
    format = 'csv',
    filePath,
    reportType,
    date,
    jobId = null,
  } = {}) {
    const id = jobId || createJob();
    try {
      emitProgress(id, { stage: 'Preparing export...', percent: 10, channel: 'import:progress' });
      const entity = getEntity(entityId);
      if (!entity.export) {
        throw new Error(`${entity.label} cannot be exported.`);
      }

      assertNotCancelled(id);
      const rows = await Promise.resolve(
        entity.export({ reportType, date })
      );
      if (!Array.isArray(rows)) {
        throw new Error('Export did not return a row list.');
      }

      emitProgress(id, { stage: 'Writing file...', percent: 60, channel: 'import:progress' });
      assertNotCancelled(id);

      const fmt = String(format).toLowerCase();
      if (entityId === 'reports' && fmt === 'pdf') {
        const lines = rows.map((r) => JSON.stringify(r));
        await writePdfReport(filePath, { title: `POSLY ${reportType || 'Report'}`, lines });
        emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
        return { path: filePath, format: 'pdf', rowCount: rows.length };
      }

      if (entityId === 'reports' && fmt === 'json') {
        writeJson(filePath, rows);
        emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
        return { path: filePath, format: 'json', rowCount: rows.length };
      }

      const result = await serializeRows(rows, fmt, filePath, entity.label);
      emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
      return result;
    } catch (error) {
      emitProgress(id, {
        stage: 'Failed',
        percent: 0,
        channel: 'import:progress',
        error: error.message,
      });
      throw error;
    } finally {
      finishJob(id);
    }
  },

  async previewImport({ entityId, filePath, format }) {
    const entity = getEntity(entityId);
    if (!entity.import) {
      throw new Error(`${entity.label} cannot be imported.`);
    }
    const rows = await loadRowsFromFile(filePath, format);
    if (typeof entity.preview === 'function') {
      return entity.preview(rows);
    }
    return {
      total: rows.length,
      sample: rows.slice(0, 10),
      errors: typeof entity.validate === 'function' ? entity.validate(rows) : [],
    };
  },

  async importData({
    entityId,
    filePath,
    format,
    mode = 'insert',
    themePreference = null,
    jobId = null,
  } = {}) {
    const id = jobId || createJob();
    try {
      emitProgress(id, { stage: 'Preparing import...', percent: 5, channel: 'import:progress' });
      const entity = getEntity(entityId);
      if (!entity.import) {
        throw new Error(`${entity.label} cannot be imported.`);
      }

      const allowedModes = new Set(['insert', 'update', 'skip']);
      if (!allowedModes.has(mode)) {
        throw new Error('Invalid import mode. Use insert, update, or skip.');
      }

      const rows = await loadRowsFromFile(filePath, format);
      emitProgress(id, { stage: 'Validating...', percent: 25, channel: 'import:progress' });

      const errors = typeof entity.validate === 'function' ? entity.validate(rows) : [];
      const fatal = errors.filter((e) => e.fatal);
      if (fatal.length) {
        throw new Error(`Import validation failed: ${fatal[0].message}`);
      }

      if (rows.length >= LARGE_IMPORT_THRESHOLD) {
        emitProgress(id, { stage: 'Creating safety backup...', percent: 35, channel: 'import:progress' });
        await backupService.createSafetyBackup({
          type: 'pre_upgrade',
          themePreference,
        });
      }

      emitProgress(id, { stage: 'Importing...', percent: 55, channel: 'import:progress' });
      assertNotCancelled(id);

      let report;
      try {
        report = entity.import({ rows, mode });
      } catch (err) {
        // Entity imports use transactions; failure rolls back automatically
        throw new Error(`Import failed and was rolled back: ${err.message}`);
      }

      emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
      return {
        entityId,
        mode,
        rowCount: rows.length,
        report,
        validationErrors: errors.slice(0, 50),
      };
    } catch (error) {
      emitProgress(id, {
        stage: 'Failed',
        percent: 0,
        channel: 'import:progress',
        error: error.message,
      });
      throw error;
    } finally {
      finishJob(id);
    }
  },
};

export default importExportService;

import path from 'path';
import fs from 'fs';
import { listEntities, getEntity } from './entityRegistry.js';
import {
  loadRowsFromFile,
  serializeRows,
  writePdfReport,
  writeJson,
  parseXlsxFile,
} from './formatUtils.js';
import backupService from '../backup/index.js';
import { createJob, finishJob, emitProgress, assertNotCancelled, cancelJob } from '../backup/backupUtils.js';
import { suggestColumnMapping, applyColumnMapping, listMappableFields } from './columnMapper.js';
import { previewProductRows, importProductRows } from './productImporter.js';
import { writeProductTemplate, buildProductTemplateBuffer } from './templateGenerator.js';
import { buildErrorReportRows } from './validationEngine.js';
import importHistoryService from './importHistoryService.js';
import { PRODUCT_FIELDS } from './productFields.js';

const LARGE_IMPORT_THRESHOLD = 500;

function detectFormat(filePath, format) {
  if (format) return String(format).toLowerCase();
  return path.extname(filePath).replace('.', '').toLowerCase();
}

function readHeadersAndRows(filePath, format) {
  const fmt = detectFormat(filePath, format);
  return loadRowsFromFile(filePath, fmt).then(async (rows) => {
    // For empty files, try to still get headers from xlsx
    if (!rows.length && (fmt === 'xlsx' || fmt === 'excel')) {
      const workbookRows = await parseXlsxFile(filePath);
      return { rows: workbookRows, headers: workbookRows[0] ? Object.keys(workbookRows[0]) : [], format: fmt };
    }
    if (!rows.length && fmt === 'csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      const first = content.split(/\r?\n/).find((l) => l.trim());
      const headers = first ? first.split(',').map((h) => h.replace(/^"|"$/g, '').trim()) : [];
      return { rows: [], headers, format: fmt };
    }
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { rows, headers, format: fmt };
  });
}

const importExportService = {
  listEntities() {
    return listEntities();
  },

  listProductFields() {
    return listMappableFields();
  },

  createJob,
  cancelJob,

  async downloadTemplate({ filePath } = {}) {
    if (!filePath) {
      const buf = await buildProductTemplateBuffer();
      return { bufferBase64: buf.toString('base64'), format: 'xlsx', fileName: 'zen-product-import-template.xlsx' };
    }
    return writeProductTemplate(filePath);
  },

  async analyzeImportFile({ filePath, format } = {}) {
    const { rows, headers, format: fmt } = await readHeadersAndRows(filePath, format);
    const suggestion = suggestColumnMapping(headers);
    return {
      filePath,
      format: fmt,
      fileName: path.basename(filePath),
      headers,
      rowCount: rows.length,
      sampleRaw: rows.slice(0, 5),
      mapping: suggestion.mapping,
      suggestions: suggestion.suggestions,
      requiredMissing: suggestion.requiredMissing,
      unmappedHeaders: suggestion.unmappedHeaders,
      mappedFields: suggestion.mappedFields,
      fields: listMappableFields(),
    };
  },

  async previewMappedImport({
    filePath,
    format,
    mapping,
    entityId = 'products',
    categoryMode = 'auto',
    supplierMode = 'auto',
  } = {}) {
    if (entityId !== 'products') {
      // Fall back to legacy entity preview
      return this.previewImport({ entityId, filePath, format });
    }
    const { rows } = await readHeadersAndRows(filePath, format);
    const mappedRows = applyColumnMapping(rows, mapping);
    const preview = previewProductRows(mappedRows, { categoryMode, supplierMode });
    return {
      entityId,
      total: preview.summary.total,
      summary: preview.summary,
      sample: preview.sample,
      results: preview.results.slice(0, 200),
      unknownCategories: preview.unknownCategories,
      unknownSuppliers: preview.unknownSuppliers,
      errors: preview.results
        .filter((r) => r.status === 'error')
        .flatMap((r) =>
          (r.issues || []).map((i) => ({ row: r.rowNumber, message: i.message, suggestedFix: i.suggestedFix }))
        )
        .slice(0, 100),
    };
  },

  async exportData({
    entityId,
    format = 'csv',
    filePath,
    reportType,
    date,
    dateFrom,
    dateTo,
    filters = {},
    columns = null,
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
      let rows = await Promise.resolve(
        entity.export({ reportType, date, dateFrom, dateTo, filters })
      );
      if (!Array.isArray(rows)) {
        throw new Error('Export did not return a row list.');
      }

      // Optional column filter
      if (Array.isArray(columns) && columns.length && rows.length) {
        rows = rows.map((row) => {
          const next = {};
          for (const col of columns) {
            if (Object.prototype.hasOwnProperty.call(row, col)) next[col] = row[col];
          }
          return next;
        });
      }

      emitProgress(id, { stage: 'Writing file...', percent: 60, channel: 'import:progress' });
      assertNotCancelled(id);

      const fmt = String(format).toLowerCase();
      if (entityId === 'reports' && fmt === 'pdf') {
        const lines = rows.map((r) => JSON.stringify(r));
        await writePdfReport(filePath, { title: `ZEN ${reportType || 'Report'}`, lines });
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
    // Wizard options (products)
    mapping = null,
    duplicateMode = null,
    categoryMode = 'auto',
    supplierMode = 'auto',
    categoriesToCreate = [],
    suppliersToCreate = [],
    autoGenerateBarcode = true,
    autoGenerateSku = true,
    userId = null,
    userName = null,
  } = {}) {
    const id = jobId || createJob();
    const started = Date.now();
    try {
      emitProgress(id, { stage: 'Preparing import...', percent: 5, channel: 'import:progress' });

      // Enhanced product wizard path
      if (entityId === 'products' && mapping) {
        const { rows } = await readHeadersAndRows(filePath, format);
        const mappedRows = applyColumnMapping(rows, mapping);

        const dupMode =
          duplicateMode ||
          (mode === 'update' ? 'update' : mode === 'skip' ? 'skip' : 'create');

        if (mappedRows.length >= LARGE_IMPORT_THRESHOLD) {
          emitProgress(id, { stage: 'Creating safety backup...', percent: 20, channel: 'import:progress' });
          await backupService.createSafetyBackup({
            type: 'pre_upgrade',
            themePreference,
          });
        }

        emitProgress(id, { stage: 'Importing...', percent: 40, channel: 'import:progress' });
        assertNotCancelled(id);

        const result = importProductRows({
          mappedRows,
          duplicateMode: dupMode,
          categoryMode,
          supplierMode,
          categoriesToCreate,
          suppliersToCreate,
          autoGenerateBarcode,
          autoGenerateSku,
          userId,
          onProgress: (p) => emitProgress(id, { ...p, channel: 'import:progress' }),
        });

        const durationMs = Date.now() - started;
        const historyId = importHistoryService.record({
          entityId: 'products',
          fileName: path.basename(filePath),
          userId,
          userName,
          mode: dupMode,
          status: 'completed',
          importedCount: result.report.inserted,
          updatedCount: result.report.updated,
          skippedCount: result.report.skipped,
          failedCount: result.report.failed,
          durationMs,
          errorReport: result.errorReport,
          summary: { ...result.report, validation: result.validationSummary },
        });

        emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
        return {
          entityId,
          mode: dupMode,
          rowCount: mappedRows.length,
          report: result.report,
          validationSummary: result.validationSummary,
          errorReport: result.errorReport,
          historyId,
          durationMs,
        };
      }

      // Legacy entity import
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
        throw new Error(`Import failed and was rolled back: ${err.message}`);
      }

      const durationMs = Date.now() - started;
      importHistoryService.record({
        entityId,
        fileName: path.basename(filePath),
        userId,
        userName,
        mode,
        status: 'completed',
        importedCount: report.inserted || 0,
        updatedCount: report.updated || 0,
        skippedCount: report.skipped || 0,
        failedCount: (report.errors || []).length,
        durationMs,
        errorReport: report.errors || [],
        summary: report,
      });

      emitProgress(id, { stage: 'Completed', percent: 100, channel: 'import:progress' });
      return {
        entityId,
        mode,
        rowCount: rows.length,
        report,
        validationErrors: errors.slice(0, 50),
        durationMs,
      };
    } catch (error) {
      importHistoryService.record({
        entityId,
        fileName: filePath ? path.basename(filePath) : null,
        userId,
        userName,
        mode: duplicateMode || mode,
        status: 'failed',
        durationMs: Date.now() - started,
        errorReport: [{ row: 0, reason: error.message, suggestedFix: '' }],
        summary: { error: error.message },
      });
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

  async writeErrorReport({ filePath, format = 'xlsx', errorReport = [] } = {}) {
    const rows = Array.isArray(errorReport) ? errorReport : [];
    const normalized = rows.length
      ? rows
      : [{ row: '', severity: '', field: '', reason: 'No errors', suggestedFix: '', productName: '', sku: '' }];
    return serializeRows(normalized, format, filePath, 'Error Report');
  },

  listImportHistory(limit = 50) {
    return importHistoryService.list({ limit });
  },

  getImportErrorReport(historyId) {
    return importHistoryService.getErrorReport(historyId);
  },

  productFieldKeys() {
    return PRODUCT_FIELDS.map((f) => f.exportKey);
  },
};

export default importExportService;

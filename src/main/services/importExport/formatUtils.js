import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import ExcelJS from 'exceljs';
import { getDb } from '../../database/db.js';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

export function tableExists(name) {
  const db = getDb();
  return Boolean(
    db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
  );
}

export function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function parseCsv(content) {
  const lines = String(content).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function rowsToXlsxBuffer(rows, sheetName = 'Data') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (!rows.length) {
    sheet.addRow(['(no data)']);
  } else {
    const headers = Object.keys(rows[0]);
    sheet.addRow(headers);
    for (const row of rows) {
      sheet.addRow(headers.map((h) => row[h]));
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function parseXlsxFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  let headers = [];
  sheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1).map((v) => (v == null ? '' : String(v)));
    if (rowNumber === 1) {
      headers = values;
      return;
    }
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    rows.push(obj);
  });
  return rows;
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

export async function writePdfReport(filePath, { title, lines }) {
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).text(title || 'ZEN Report', { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    for (const line of lines || []) {
      doc.text(String(line));
    }
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

export async function serializeRows(rows, format, filePath, sheetName) {
  const fmt = String(format || 'json').toLowerCase();
  if (fmt === 'csv') {
    writeText(filePath, rowsToCsv(rows));
  } else if (fmt === 'xlsx' || fmt === 'excel') {
    const buf = await rowsToXlsxBuffer(rows, sheetName);
    fs.writeFileSync(filePath, buf);
  } else if (fmt === 'json') {
    writeJson(filePath, rows);
  } else if (fmt === 'pdf') {
    throw new Error('PDF is only supported for reports.');
  } else {
    throw new Error(`Unsupported export format: ${format}`);
  }
  return { path: filePath, format: fmt, rowCount: rows.length };
}

export async function loadRowsFromFile(filePath, format) {
  const fmt = String(format || path.extname(filePath).replace('.', '')).toLowerCase();
  if (fmt === 'csv') {
    return parseCsv(fs.readFileSync(filePath, 'utf8'));
  }
  if (fmt === 'xlsx' || fmt === 'excel') {
    return parseXlsxFile(filePath);
  }
  if (fmt === 'json') {
    const data = readJson(filePath);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.rows)) return data.rows;
    throw new Error('JSON file must be an array or { rows: [] }.');
  }
  throw new Error(`Unsupported import format: ${format}`);
}

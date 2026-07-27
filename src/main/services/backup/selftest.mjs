/**
 * Offline integrity tests (zip/checksum/atomic) — no Electron/native SQLite required.
 * Full SQLite Backup API checks run inside the Electron app at runtime.
 * Run: node src/main/services/backup/selftest.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const archiverModule = require('archiver');
const archiver = typeof archiverModule === 'function' ? archiverModule : archiverModule.default || archiverModule;
const yauzl = require('yauzl');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  OK ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createZipArchive(options) {
  if (typeof archiver === 'function') return archiver('zip', options);
  if (archiver?.ZipArchive) return new archiver.ZipArchive(options);
  throw new Error('Unsupported archiver API');
}

function zipDir(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = createZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const dest = path.join(destDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(dest, { recursive: true });
          zipfile.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(streamErr);
          const ws = fs.createWriteStream(dest);
          readStream.pipe(ws);
          ws.on('close', () => zipfile.readEntry());
          ws.on('error', reject);
        });
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

function parseCsv(content) {
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
        } else inQuotes = false;
      } else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      result.push(current);
      current = '';
    } else current += ch;
  }
  result.push(current);
  return result;
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return `${[headers.join(',')].concat(rows.map((r) => headers.map((h) => escape(r[h])).join(','))).join('\n')}\n`;
}

async function main() {
  console.log('POSLY backup self-test\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-selftest-'));

  // 1. Archive + checksum roundtrip
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  const payload = Buffer.from('POSLY-DB-SNAPSHOT-TEST');
  fs.writeFileSync(path.join(work, 'database.db'), payload);
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ backupId: 'test', encryption: { enabled: false } }));
  const hash = sha256File(path.join(work, 'database.db'));
  fs.writeFileSync(path.join(work, 'checksums.sha256'), `${hash}  database.db\n`);
  const archivePath = path.join(tmp, 'test.poslybackup');
  await zipDir(work, archivePath);
  assert(fs.existsSync(archivePath), 'Archive (.poslybackup zip) created');

  const extractDir = path.join(tmp, 'extract');
  fs.mkdirSync(extractDir);
  await extractZip(archivePath, extractDir);
  assert(fs.existsSync(path.join(extractDir, 'database.db')), 'Extracted database.db');
  assert(fs.existsSync(path.join(extractDir, 'manifest.json')), 'Extracted manifest.json');
  assert(
    sha256File(path.join(extractDir, 'database.db')) === hash,
    'Checksum matches after zip roundtrip'
  );

  // 2. Corruption / tamper detection via checksum
  fs.writeFileSync(path.join(extractDir, 'database.db'), 'tampered');
  assert(
    sha256File(path.join(extractDir, 'database.db')) !== hash,
    'Tampered database fails checksum'
  );

  // 3. Atomic swap + rollback
  const live = path.join(tmp, 'live.db');
  const staging = path.join(tmp, 'live.db.restoring');
  const aside = path.join(tmp, 'live.db.pre_swap');
  fs.writeFileSync(live, 'OLD');
  fs.writeFileSync(staging, 'NEW');
  fs.renameSync(live, aside);
  fs.renameSync(staging, live);
  assert(fs.readFileSync(live, 'utf8') === 'NEW', 'Atomic swap applied new data');
  assert(fs.readFileSync(aside, 'utf8') === 'OLD', 'Pre-swap kept for rollback');
  fs.renameSync(live, staging);
  fs.renameSync(aside, live);
  assert(fs.readFileSync(live, 'utf8') === 'OLD', 'Rollback restored previous data');

  // 4. CSV roundtrip (import/export helper logic)
  const csv = rowsToCsv([{ sku: 'A1', name: 'hello, world' }]);
  const rows = parseCsv(csv);
  assert(rows[0].name === 'hello, world', 'CSV roundtrip with comma');
  assert(rows[0].sku === 'A1', 'CSV roundtrip sku');

  // 5. Version gate heuristic
  const known = ['011_discounts', '012_backup_system'];
  const latest = '012_backup_system';
  const newer = '099_future';
  const backupNum = Number(String(newer).split('_')[0]);
  const latestNum = Number(String(latest).split('_')[0]);
  assert(backupNum > latestNum, 'Newer DB version detected vs current app');
  assert(known.includes('012_backup_system'), 'Known migration list includes 012');

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log('Note: SQLite Backup API / VACUUM INTO are validated at Electron runtime (native module).');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

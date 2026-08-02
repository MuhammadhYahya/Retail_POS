import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Extensible registry of filesystem roots included in backups.
 * Future modules register additional roots without changing backup core.
 */
const roots = [
  {
    id: 'assets',
    archivePath: 'assets',
    resolveAbsolute: () => path.join(app.getPath('userData'), 'assets'),
    includeIfExists: true,
  },
  {
    id: 'images',
    archivePath: 'images',
    resolveAbsolute: () => path.join(app.getPath('userData'), 'images'),
    includeIfExists: true,
  },
  {
    id: 'receipts',
    archivePath: 'receipts',
    resolveAbsolute: () => path.join(app.getPath('userData'), 'receipts'),
    includeIfExists: true,
  },
  {
    id: 'logs',
    archivePath: 'logs',
    resolveAbsolute: () => path.join(app.getPath('userData'), 'logs'),
    includeIfExists: true,
  },
  {
    id: 'uploads',
    archivePath: 'uploads',
    resolveAbsolute: () => path.join(app.getPath('userData'), 'uploads'),
    includeIfExists: true,
  },
];

export function registerDataRoot(root) {
  if (!root?.id || !root?.archivePath || typeof root.resolveAbsolute !== 'function') {
    throw new Error('Invalid data root registration.');
  }
  const existing = roots.findIndex((r) => r.id === root.id);
  if (existing >= 0) {
    roots[existing] = { includeIfExists: true, ...root };
  } else {
    roots.push({ includeIfExists: true, ...root });
  }
}

export function getDataRoots() {
  return [...roots];
}

export function listExistingDataRoots() {
  return roots
    .map((root) => {
      const absolutePath = root.resolveAbsolute();
      return {
        ...root,
        absolutePath,
        exists: fs.existsSync(absolutePath),
      };
    })
    .filter((root) => root.exists || !root.includeIfExists);
}

export function ensureReservedDataDirs() {
  for (const root of roots) {
    const absolutePath = root.resolveAbsolute();
    if (!fs.existsSync(absolutePath)) {
      fs.mkdirSync(absolutePath, { recursive: true });
      const marker = path.join(absolutePath, '.zenkeep');
      if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, `ZEN reserved directory: ${root.id}\n`, 'utf8');
      }
    }
  }
}

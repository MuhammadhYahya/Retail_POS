# POSLY Backup, Restore & Import/Export — Production Readiness Report

Date: 2026-07-26  
Scope: Complete Backup & Restore + Import/Export (no AES-256 encryption this release)

## 1. Issues found in the existing project

1. **Raw DB file copy while connection open** — `backupService` used `copyFileSync` on `posly.db` (+wal/shm) after checkpoint only; not the SQLite Online Backup API.
2. **Restore left stale DB handle** — restore overwrote files without `closeDb()` / reopen; relied on manual restart messaging.
3. **No archive format** — backups were lone `.db` files without manifest, checksums, assets/config bundle, or post-create verification gate.
4. **No destination folder picker** — only a drive-letter list (all A–Z mounts), not a real browse dialog.
5. **No progress / cancel IPC** — preload was invoke-only; long jobs blocked UI feedback.
6. **Migrations without safety snapshot** — pending migrations applied with no pre-risk backup.
7. **Theme not in backup** — theme lived only in renderer `localStorage`.
8. **No scheduled backups, history table, or retention policy**.
9. **No Import/Export subsystem** — selective data transfer did not exist.
10. **Audit log lacked details column** — hard to record structured import/backup metadata.

## 2. Issues fixed beyond the written requirements

1. Added `closeDb` / `reopenDb` / `setSkipMigrationSafetyBackup` lifecycle controls.
2. Pre-migration sync safety via `VACUUM INTO` when migrations are pending (after backup system exists).
3. Legacy `.db` restore/verify adapter so older AppData backups remain usable.
4. Reserved filesystem roots (`assets`, `images`, `receipts`, `logs`, `uploads`) + `dataRootRegistry` for future modules.
5. Encryption placeholder in `manifest.encryption` without implementing AES yet.
6. Progress bridge (`backup:progress` / `import:progress`) with allowlisted preload `on`/`off`.
7. Large-import automatic safety backup (≥500 rows).
8. Future entity stubs (customers, suppliers, expenses, POs) that fail gracefully when tables are missing.
9. Archiver CJS interop helper compatible with archiver v7 function API.
10. Offline self-test script for zip/checksum/atomic/CSV/`npm run test:backup`.

## 3. Files modified / added

### Database
- `src/main/database/db.js`
- `src/main/database/migrations/index.js`
- `src/main/database/migrations/012_backup_system.js`

### Backup core
- `src/main/services/backup/index.js` (canonical backup service)
- `src/main/services/backup/index.js`
- `src/main/services/backup/archiveBuilder.js`
- `src/main/services/backup/archiveVerifier.js`
- `src/main/services/backup/backupHistoryService.js`
- `src/main/services/backup/backupScheduleService.js`
- `src/main/services/backup/backupUtils.js`
- `src/main/services/backup/dataRootRegistry.js`
- `src/main/services/backup/selftest.mjs`

### Import/Export
- `src/main/services/importExport/index.js`
- `src/main/services/importExport/entityRegistry.js`
- `src/main/services/importExport/formatUtils.js`

### IPC / preload / main
- `src/main/ipc/backupHandlers.js`
- `src/main/ipc/importExportHandlers.js`
- `src/main/ipc/settingsHandlers.js` (backup handlers removed)
- `src/main/lib/auditLog.js`
- `src/main.js`
- `src/preload.js`
- `vite.main.config.mjs`
- `package.json`

### Renderer
- `src/renderer/pages/Settings/SettingsPage.jsx`
- `src/renderer/pages/Settings/BackupRestorePanel.jsx`
- `src/renderer/lib/ipc.js`
- `src/renderer/components/ui/dialog.jsx`

## 4. Architectural decisions

| Decision | Rationale |
|----------|-----------|
| Upgrade in place under `backup:*` | Preserve admin IPC patterns; avoid duplicate services |
| `.poslybackup` = ZIP | Spec requirement; portable; single file for shop owners |
| better-sqlite3 `Database#backup()` | True Online Backup API; consistent snapshots |
| `VACUUM INTO` for sync pre-migration | Backup API is async; migrations runner is sync |
| Data root + entity registries | Future modules plug in without redesign |
| Emergency backup before restore always | Crash/power-loss recoverability |
| Atomic rename swap + pre_swap rollback | Never leave half-restored live DB |
| No encryption this release | Reliability first; format reserved |
| Import ≠ Backup | Separate channels/UI; selective vs full shop |
| Admin-only gates on all mutating channels | Match existing `requireRole(['admin'])` |

## 5. Remaining risks

1. **Full Electron E2E restore/relaunch** should be manually exercised on a Windows shop PC (USB disconnect, disk full, power loss mid-restore).
2. **Native module / packaging** — confirm `archiver`, `yauzl`, `exceljs`, `pdfkit` resolve correctly in packaged Forge builds (externals configured).
3. **Very large DBs (5–10 GB)** — streaming zip is used, but UI progress is stage-based; consider finer byte-level progress later.
4. **AES-256** not implemented — encrypted archives from a future version will ask users to update POSLY.
5. **Sales/users import intentionally disabled** — PINs and historical sales integrity; use full restore instead.
6. **Self-test cannot load Electron-built `better-sqlite3` under system Node** — SQLite Backup API covered by runtime path + code review.

## 6. Production readiness assessment

| Criterion | Status |
|-----------|--------|
| SQLite Backup API / VACUUM INTO (no raw open-DB copy for production backups) | Met |
| Single `.poslybackup` with manifest, checksums, db, config, assets | Met |
| Auto-verify before success; delete failed archives | Met |
| Emergency backup before restore | Met |
| Atomic restore with rollback support | Met |
| Scheduled backups + missed-run on startup + retention | Met |
| Progress + cancel (backup); no cancel mid-restore commit | Met |
| Version compatibility gate (newer blocked) | Met |
| Admin-only access | Met |
| Import/Export separate with preview, modes, transactional rollback | Met |
| Future-module extensibility (registries) | Met |
| Encryption | Deferred (format-ready) |
| Offline helper tests | `npm run test:backup` — 12/12 passed |

**Verdict:** Ready for staged production rollout after manual Windows E2E checklist (fresh backup→restore, USB path, missed schedule, corrupt archive message, import rollback). Encryption can follow without changing the outer backup workflow.

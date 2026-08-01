# Posly Production Cleanup Report

**Date:** 2026-08-01  
**Rule:** Do **not** delete until this table is approved. Suggested Phase 3 batch is marked **Remove (approved in plan)**.

---

## Candidates

| File/Folder | Reason | Action |
|-------------|--------|--------|
| `debug-f5541e-last-receipt.bin` | Agent debug dump of raw ESC/POS; not needed in repo | Remove |
| `debug-f5541e.log` (if present) | Agent debug log | Remove |
| `.cursor/debug-f5541e.log` (if present) | Cursor debug session log | Remove / ignore |
| `#region agent log` in `src/main/services/printerService.js` | Posts to `127.0.0.1:7926`, writes hardcoded debug paths | Remove (code) |
| `#region agent log` in `src/main/lib/windowsRawPrint.js` | Same agent instrumentation | Remove (code) |
| `src/renderer.js` | Orphan Forge scaffold; real entry is `src/renderer/main.jsx` | Remove |
| `git` (repo root, 0-byte) | Junk empty file | Remove |
| `src/main/lib/receiptHtml.js` HTML builder | Near-duplicate of renderer; only `isRawEscPosPort` used from main | Move `isRawEscPosPort` → printer lib; delete unused HTML from main |
| `src/main/services/backupService.js` | Thin re-export; callers use `backup/index.js` directly | Remove |
| `tw-animate-css` (package.json) | Listed but never imported | Remove (`npm uninstall`) |
| Mock IPC block in `src/renderer/index.html` | Hardcoded demo users/PINs; dead when preload works; ships in HTML | Remove |
| `.gitignore` missing `debug-*` / `*.bin` | Debug artifacts can be committed | Update |
| `components.json` | Stale shadcn refs (`tailwind.config.js` missing) | Review / Keep |
| `scripts/v1-shop-simulation.mjs` | Dev simulation | Keep (dev script) |
| `src/main/services/backup/selftest.mjs` | Backup self-test | Keep |
| Import/export stubs (customers / purchase_orders) | Placeholder modules | Review / Keep for now |
| Large PNGs under `src/renderer/public/` | Branding assets in use | Keep |
| All routed pages under `src/renderer/pages/` | All wired in `App.jsx` | Keep |

---

## Security / quality (cleanup-adjacent)

| Item | Reason | Action |
|------|--------|--------|
| `src/main/lib/jwtSecret.js` `FALLBACK_SECRET` | Hardcoded JWT secret if DB row missing | Fail closed / require `ensureJwtSecret` |
| `src/main/lib/emergencyReset.js` console logs plaintext code | Code also written to file; console is unnecessary risk | Log path only, not code |
| Default Electron menu / DevTools in packaged app | Users can open DevTools in production | Set production menu when `app.isPackaged` |
| Google Fonts CDN in `index.html` | Offline POS dependency | Review (keep for now; document offline risk) |
| `package.json` description placeholder | `"My Electron application description"` | Review / update later |

---

## Suggested first removal batch (from audit plan)

1. Debug artifacts + gitignore patterns  
2. Agent debug regions (also part of print fix pass)  
3. `src/renderer.js`, empty `git`  
4. Unused `tw-animate-css`  
5. Deduplicate receipt HTML / relocate `isRawEscPosPort`  
6. Strip `index.html` mock IPC  
7. Remove unused `backupService.js` re-export  
8. JWT fallback + emergency reset logging + packaged DevTools menu  

**Status of this report:** Phase 3 suggested batch **executed** after plan approval (debug artifacts, scaffold junk, mock IPC, unused dep, receiptHtml dedupe, JWT/emergency/DevTools hardening).

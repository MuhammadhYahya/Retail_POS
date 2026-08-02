# Posly Production Readiness Report

**Date:** 2026-08-01  
**Application status: NOT READY**

---

## Application Status

| Domain | Status | Notes |
|--------|--------|-------|
| Printing (XP-80U) | Code ready — needs hardware sign-off | Feed-and-cut, wrap, debug strip, fallback, timeout, test print |
| Sales / billing | Ready (core) | Stock, VAT, discounts, payments OK |
| Returns | Partial | Logic OK; no print |
| Day close / Z | Partial | Browser print only |
| Backup / restore | Ready | Printer settings in DB survive restore |
| Security | Improved | JWT fail-closed; no emergency code console; packaged menu hidden |
| Code cleanliness | Improved | Debug/scaffold/mock IPC removed |
| Packaging | Untested in this audit | `npm run make` / fresh machine TBD |

**Overall: NOT READY** until XP-80U hardware sign-off on the print fix pass. Critical code blockers from this audit have been addressed (debug strip, feed-and-cut, wrap, timeout, fallback, cleanup, security hardening).

---

## Code Cleanup Summary

### Removed (executed)

- [x] `debug-f5541e*` artifacts  
- [x] Agent debug regions in printer stack  
- [x] `src/renderer.js`  
- [x] Empty root `git`  
- [x] `tw-animate-css`  
- [x] Main unused receipt HTML → `isRawEscPosPort` in `src/main/lib/escposPort.js`  
- [x] `src/main/services/backupService.js` re-export  
- [x] `index.html` mock IPC credentials  
- [x] JWT hardcoded fallback removed (fail closed + `ensureJwtSecret` at startup)  
- [x] Emergency reset plaintext console log removed  
- [x] Packaged-app menu / DevTools hardening (`Menu.setApplicationMenu(null)`, `autoHideMenuBar`)  

### Kept

- All routed React pages and UI components  
- Full `src/main/services/*` domain services (sales, products, backup, etc.)  
- Migrations `001`–`013`  
- ESC/POS printer service + Windows RAW spooler  
- Renderer `receiptHtml.js` (HTML fallback)  
- Dev scripts: `test:backup`, `test:v1-sim`  
- Branding assets (logo / splash)  

See [`PRODUCTION_CLEANUP_REPORT.md`](./PRODUCTION_CLEANUP_REPORT.md) for the full candidate table.

---

## Printing Summary

See [`PRINTING_PRODUCTION_AUDIT.md`](./PRINTING_PRODUCTION_AUDIT.md).

Critical path: Billing → IPC → `printerService` → COM or Windows RAW → XP-80U.

Blockers addressed in fix pass: debug instrumentation, feed-and-cut, line wrap, variant line, PowerShell timeout, auto HTML fallback, reprint debounce, Settings test print.

Deferred: thermal QR, return slips, Z ESC/POS, Sinhala/Tamil thermal fonts.

---

## Remaining Risks

1. **Hardware variance** — XP-80U firmware may still need cut `n` tuning after feed-and-cut change.  
2. **ASCII-only thermal text** — Non-English shop names print as `?`.  
3. **No thermal QR** — Fiscal/IRD QR only on screen / HTML.  
4. **Z-report popup blockers** — Browser print can fail silently if not handled.  
5. **Restored printer name** — May not exist on a different PC after restore.  
6. **PowerShell dependency** — Windows RAW path requires `powershell.exe`.  
7. **Offline fonts** — Google Fonts CDN may fail offline.  
8. **Fresh install / installer** — Not fully validated in this audit session.  

---

## Before Shipping Checklist

- [ ] Printer works (XP-80U USB)  
- [ ] Receipt complete (header through footer + cut)  
- [ ] Database migration works on fresh install  
- [ ] Backup restore works (incl. printer settings)  
- [ ] Installer works (`npm run make` / Squirrel)  
- [ ] No debug agent code / no `debug-f5541e*`  
- [ ] No unused scaffold / mock IPC secrets  
- [ ] No console errors on happy-path sale + print  
- [ ] Fresh installation tested on clean machine  
- [ ] Cash drawer opens on cash sale only once  
- [ ] Reprint works without double drawer kick  
- [ ] Printer failure recoverable (fixed message + HTML fallback + reprint CTA, no drawer; see PRINTING_PRODUCTION_AUDIT.md)  

---

## Related docs

- [`PRINTING_PRODUCTION_AUDIT.md`](./PRINTING_PRODUCTION_AUDIT.md)  
- [`PRODUCTION_CLEANUP_REPORT.md`](./PRODUCTION_CLEANUP_REPORT.md)  
- `src/main/services/backup/PRODUCTION_READINESS.md` (backup subsystem)

# Posly Printing Production Audit

**Date:** 2026-08-01  
**Target hardware:** Xprinter XP-80U (USB, 80mm), RJ11 cash drawer  
**Status: NOT READY**

---

## Current Status

| Area | Status |
|------|--------|
| Printer connect / detect | Works (Windows printer list + COM/path override) |
| ESC/POS sale receipt | Partial — prints but content/cut risks remain |
| Cash drawer kick | Implemented (`ESC p`), cash sales only |
| HTML fallback | Reprint only (before fix pass); auto-print had no fallback |
| Return receipts | Missing |
| Z-report thermal | Missing (browser print only) |
| Thermal QR / barcode | Missing on ESC/POS |
| Sinhala/Tamil on thermal | Not supported (ASCII → `?`) |
| Production debug stripped | Required before ship |

**Overall: NOT READY** for customer shipping until XP-80U hardware sign-off. Critical code fixes from this audit are implemented (debug strip, feed-and-cut, wrap, timeout, fallback, test print).

---

## Architecture

```
UI Button (Complete Sale / Reprint)
  → BillingPage.jsx (renderer)
  → invokeWithAuth('printer:printReceipt', { saleId, openDrawer })
  → preload.js allowlist
  → printerHandlers.js (session + role)
  → saleService.getById(saleId)
  → printerService.printReceipt({ sale, openDrawer })
       · settingsService.get() → printerPort, paperWidth, shop fields
       · buildEscPosReceipt() → Buffer
       · optional buildDrawerKick() appended
       · isRawEscPosPort(port)?
            yes → fs.writeFile(COM/UNC/path)
            no  → writeRawToWindowsPrinter() (PowerShell Win32 RAW)
  → XP-80U thermal printer
```

### Key files

| Layer | Path |
|-------|------|
| UI | `src/renderer/pages/Billing/BillingPage.jsx` |
| Settings | `src/renderer/pages/Settings/SettingsPage.jsx` |
| HTML fallback | `src/renderer/lib/receiptHtml.js` |
| Preload | `src/preload.js` |
| IPC | `src/main/ipc/printerHandlers.js` |
| ESC/POS service | `src/main/services/printerService.js` |
| Windows RAW | `src/main/lib/windowsRawPrint.js` |
| Port heuristic | `isRawEscPosPort` (was in `src/main/lib/receiptHtml.js`) |
| Settings persistence | `src/main/services/settingsService.js` + DB `settings.printer_port` / `paper_width` |

### IPC channels

| Channel | Purpose |
|---------|---------|
| `printer:list` | OS printer list |
| `printer:printReceipt` | Load sale, print ESC/POS, optional drawer |
| `printer:openDrawer` | Kick only (UI unused historically) |
| `printer:testPrint` | Settings test page (added in fix pass) |

### ESC/POS commands (sale receipt)

| Bytes | Meaning |
|-------|---------|
| `1B 40` | Initialize |
| `1B 74 00` | Code page PC437 |
| `1B 52 00` | International charset USA |
| `1B 4D 00` | Font A |
| `1B 61 01` / `00` | Align center / left |
| Text as latin1 + `\n` | Body (ASCII-sanitized) |
| Feed + cut | Prefer `GS V 65 n` (feed-and-cut) for XP-80U |
| `1B 70 00 19 FA` | Drawer kick pin 2 |

**Not used on thermal:** QR (`GS ( k`), barcode (`GS k`), raster logo, bold/double-width, Sinhala/Tamil code pages.

### Paper width

| Setting | ESC/POS columns | HTML page / content |
|---------|-----------------|---------------------|
| 80 mm | 42 | 80mm / 72mm |
| 58 mm | 32 | 58mm / 48mm |

### Character encoding

`toPrinterText()` NFKD-normalizes then strips non-ASCII to `?`. Thermal path cannot render Sinhala/Tamil. HTML fallback keeps Unicode.

### QR / barcode

| Path | Behavior |
|------|----------|
| IRD QR | Generated in `irdService`, shown on Billing success UI and HTML receipt |
| ESC/POS thermal | No QR (deferred) |
| Product barcode on receipt | Not printed |
| Labels page | Decorative CSS bars + browser print (not Code128) |

### Cash drawer

Order: receipt → feed/cut → `ESC p` kick. Gated on cash payment. Reprint should not re-kick (fix pass).

### Modules around printing

| Module | Creates data? | Prints? |
|--------|---------------|---------|
| Sale / Billing | Yes | Thermal + HTML fallback + reprint (no drawer) |
| Returns | Yes | Thermal + HTML fallback + Print Again (no drawer) |
| Day Close Z | Yes | Browser HTML only |
| X-report | Yes | **No** |
| Expenses | In Z cash math | Via Z HTML only |
| Backup/restore | Full DB | **Printer settings survive** |
| Labels | N/A | Browser only |

---

## Root cause: incomplete / early-stop receipts

| Rank | Cause | Evidence |
|------|-------|----------|
| 1 | Cut-in-place marginal on XP-80U | `ESC d 8` + `GS V 1` cuts at head; footer can remain above cutter |
| 2 | Software truncation looks like cut-off | `line()` sliced names/address with no wrap |
| 3 | Variant line hidden | `productName \|\| variantName` drops variant when product name set |
| 4 | Non-ASCII → `?` | Sinhala/Tamil shop text mangled |
| 5 | Expected QR absent on thermal | IRD QR not in ESC/POS; `getById` omits `ird.qrData` |
| 6 | Buffer truncate | Unlikely — Windows path checks full `WritePrinter` length |

Secondary: no auto HTML fallback, no reprint debounce, PowerShell hang without timeout, agent debug instrumentation in production path.

---

## Problems Found

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| Agent debug ingest + `debug-f5541e*` writes | Critical | `printerService.js`, `windowsRawPrint.js` | Strip all `#region agent log` |
| Feed/cut leaves bottom missing | Critical | `buildEscPosReceipt` | Use `GS V 65 n` feed-and-cut |
| Long lines truncated (no wrap) | High | `printerService.js` `line()` | Word-wrap to column width |
| Variant not printed | High | Item loop in ESC/POS | Print product + variant line |
| PowerShell RAW no timeout | High | `windowsRawPrint.js` `runPowerShell` | Kill after ~15–20s |
| Auto-print no HTML fallback | High | `BillingPage.jsx` | Same fallback as Reprint |
| Reprint spam + double drawer | High | `BillingPage.jsx` | Debounce; `openDrawer: false` on reprint |
| No Settings test print | Medium | Settings / IPC | Add `printer:testPrint` |
| Thermal QR missing | Medium | ESC/POS + sale load | Defer ESC/POS QR |
| Return receipt missing | Medium | Returns module | Defer |
| Z-report not thermal | Medium | `DayClosePage.jsx` | Defer (browser OK short-term) |
| Sinhala/Tamil thermal | Medium | Encoding | Defer / document ASCII-only |
| HTML `@media print { overflow: hidden }` | Low | `receiptHtml.js` | Prefer `overflow: visible` |
| `printer:list` swallows errors → `[]` | Low | `listPrintersAsync` | Surface error later |
| Separators capped at 32 on 80mm | Low | ESC/POS builder | Cosmetic |
| Dual `receiptHtml.js` drift | Low | main vs renderer | Dedupe in cleanup |

---

## Missing Features

- ESC/POS QR / barcode on thermal receipt
- Return slip printing
- Z / X report ESC/POS
- Historical Z reprint UI (IPC `cashSession:getZ` exists, no UI)
- Real Code128 label barcodes
- Standalone Open Drawer button in UI
- Multi-language thermal fonts / raster text
- Printer offline detection + auto-retry

---

## Recommended Fix Order

### Critical
1. Strip agent debug from printer path  
2. Reliable feed-and-cut for XP-80U  

### High
3. Word-wrap long lines; print variant  
4. PowerShell timeout  
5. Auto HTML fallback + reprint debounce (no drawer on reprint)  
6. Settings test print  

### Medium
7. Thermal QR  
8. Return receipts  
9. Z ESC/POS (optional if browser print accepted)  

### Low
10. HTML overflow; separator width; listPrinters errors; receiptHtml dedupe  

---

## Test Receipt Fixture

Print a sale containing:

**Header:** Business name, address, phone, TIN/VAT, invoice #, date/time, cashier  

**Products:**
- Normal product  
- Long product name (wrap expected)  
- Product with variant  
- Product with barcode (field stored; thermal text optional)  
- Discount item  
- VAT item / non-VAT item  
- Multiple quantities  

**Payment:** Cash and/or card; tendered + change  

**Footer:** Thank you / return policy; QR expected on HTML path (thermal deferred)  

**Verify:** Nothing cut off, all lines print, alignment OK, `Rs.` money formatting, English ASCII OK; Sinhala/Tamil → document limitation on thermal.

---

## Hardware Testing Checklist (XP-80U USB)

- [ ] Printer appears in Settings list  
- [ ] Test print completes, feeds, cuts  
- [ ] Sale receipt fully prints (header → footer)  
- [ ] Long names wrap, not silently truncated  
- [ ] Cash sale opens drawer once  
- [ ] Reprint does not open drawer again  
- [ ] Failed printer → clear error + HTML fallback  
- [ ] Barcode scanner adds items (unrelated path; regression)  
- [ ] Backup/restore keeps printer settings  
- [ ] Day close Z printable via browser  

---

## Printer failure recovery (manual reprint)

V1 uses **manual recovery only** (no online/offline polling).

**Runtime path (must stay true):**

```
Complete Sale / Process return / Reprint
  → printSaleReceiptWithRecovery / printReturnReceiptWithRecovery  (renderer/lib/printRecovery.js)
  → IPC printer:printReceipt | printer:printReturnReceipt
  → printerService.printReceipt / printReturnReceipt
       · receipt ESC/POS only (no drawer bytes in this buffer)
       · windowsRawPrint: refuse offline / abort job if offline after write
       · only if receipt confirmed AND openDrawer===true → separate drawer kick job
```

Billing and Returns must **not** call `printer:*` IPC directly for bills.

**Root cause of “success while unplugged + auto-print on reconnect”:**  
Windows spooler often accepts `WritePrinter` while USB is disconnected and queues the job. Reconnect then prints (and previously kicked the drawer because `ESC p` was appended to the same buffer). Fix: status checks + `AbortPrinter` / `SetJob(CANCEL)` on failure, and drawer kick only after confirmed receipt success.

**Expected flow (sale + return, auto-print and reprint):**

1. Transaction is saved successfully.  
2. Thermal print fails or times out (~20s COM or Windows RAW), or offline status / aborted queue job.  
3. UI shows: **Receipt printing failed. Please check the printer.**  
4. HTML receipt fallback opens automatically (browser print).  
5. Persistent guidance: **Receipt wasn't printed. Reprint when the printer is ready.**  
6. Cashier fixes hardware, clicks **Reprint Receipt** / **Print Again**.  
7. Same transaction reprints with **`openDrawer: false`** (drawer must not open).  
8. If reprint fails again, the same recovery path remains available.  
9. Reconnecting the printer must **not** auto-print a previously failed job (job aborted/cancelled).

**Never allow:** frozen UI, infinite “Printing…”, or silent failure. Print UI paths use `try/finally` so loading flags always clear.

| Scenario | Expected |
|----------|----------|
| Printer switched off | Fail within ~20s → fixed message → HTML fallback → Reprint CTA stays available (sale dialog auto-close paused) |
| USB cable removed | Same |
| Wrong printer selected | Same (Settings points at non-receipt device / missing name) |
| Paper finished | Fail when OS/driver reports it → same recovery. Note: some spoolers accept the job while paper is out; cashier still has Reprint + HTML fallback |

**Paths covered**

- Sale auto-print (`BillingPage` after `sale:create`)  
- Sale reprint (`openDrawer: false`)  
- Return auto-print (`ReturnsPage` after `return:create`)  
- Return reprint / Print Again (`openDrawer: false`)  

---

## Production Acceptance Checklist

A shop owner should be able to:

- [ ] Make sale  
- [ ] Print receipt  
- [ ] Receipt fully prints  
- [ ] Reprint receipt  
- [ ] Close day  
- [ ] Print reports (Z via browser)  
- [ ] Recover from printer failure (status + HTML fallback + reprint, no drawer)  

---

## POS function notes

### Sales
Invoice `PREFIX-YYYYMMDD-######`, discounts, VAT-inclusive totals, stock deduct, cash/card/qr payments — wired to thermal print after `sale:create`. On failure: HTML fallback + Reprint CTA; success dialog does not auto-close while print failed.

### Returns
Creates `RET-…`, stock `return_in`, refunds in Z math — thermal return receipt + HTML fallback; Print Again never opens drawer.

### Day Close / Z
Totals include cash/card/qr, refunds, expenses, variance — browser print only; popup block = silent fail historically.

### Expenses
Included in Z/X expected cash; not in `ReportsPage` daily summary.

### Backup / Restore
Full SQLite snapshot includes `settings.printer_port` / `paper_width` — **survives restore**. Restored printer name may not exist on a new PC.

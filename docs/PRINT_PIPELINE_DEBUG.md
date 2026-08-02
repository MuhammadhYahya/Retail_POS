# Print pipeline runtime investigation

Logging build marker: `investigate-1` (field `version` in every JSONL line).

## Log file locations

After **one Complete Sale** with this build:

1. Project cwd: `print-pipeline-debug.jsonl`
2. Electron userData: `%APPDATA%\posly\print-pipeline-debug.jsonl` (Windows packaged/dev)

Console also prints `[PRINT-PIPELINE] …`.

## Reproduce (Windows POS with XP-80)

1. Pull/build this branch and **fully quit** Posly (Task Manager: no leftover `posly` / Electron).
2. Start the app from this instrumented build.
3. Confirm Settings printer name is the XP-80.
4. Delete any existing `print-pipeline-debug.jsonl` in the project folder / userData (clean slate).
5. **Disconnect USB** printer (or power off).
6. Complete **one cash sale**.
7. Wait **20 seconds** (do not click Reprint).
8. **Reconnect USB**.
9. Observe whether the printer auto-prints / drawer opens.
10. Copy `print-pipeline-debug.jsonl` and run:

```bash
node scripts/analyze-print-pipeline-log.mjs print-pipeline-debug.jsonl
```

## What the log must prove

Find the first event where any of these become true while the printer was disconnected:

- `successReturnedToRenderer: true` (`ipc.printer:printReceipt.exit`)
- `successReturnedToBilling: true` / `thermalSucceeded: true`
- `uiShowsSuccess: true` (`BillingPage.handleCompleteSale.print.end`)
- Win32 `WritePrinter` / `EndDocPrinter` with `ok: true` and `printerState: "Ready"` while USB was out
- `jobCommittedToSpooler: true` then later auto-print on reconnect
- `drawerPulseSent: true`

If **no** `[PRINT-PIPELINE]` lines appear and `version` is missing, the running binary is **not** this instrumented build.

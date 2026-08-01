# AGENTS.md

## Cursor Cloud specific instructions

### What this is
`posly` (branded **ZEN**) is a single **Electron desktop Point‑of‑Sale app** — there is no server/backend service to run. The Electron main process (Node) owns a local **SQLite** database via `better-sqlite3` and exposes IPC handlers to a **React + Vite** renderer. Everything runs offline on one machine.

- Main process entry: `src/main.js` (registers IPC handlers, runs DB migrations on launch).
- Renderer: `src/renderer/` (React Router, Zustand stores, Tailwind).
- DB lives at Electron `userData`: `~/.config/posly/posly.db`. Migrations in `src/main/database/migrations/` run automatically on every launch. Delete that file to reset to a clean install (you'll re-do the first‑admin bootstrap).

### Running the app (GUI)
Use the live desktop display so `computerUse` can see the window:

```
DISPLAY=:1 npm start
```

- `npm start` = `electron-forge start` (Vite dev server on `:5173` + Electron; hot reload for renderer, `rs`↵ in its terminal restarts the main process). Do NOT wrap the interactive app in `xvfb-run` — `computerUse` watches `:1`, and a private Xvfb display would be invisible to it.
- Harmless log noise: `Failed to connect to the bus` / `dbus` / `Avahi` warnings (no D‑Bus daemon in the VM). Not errors.

### Tests / lint (see `package.json` scripts)
- `npm run test:backup` — backup/restore self-test, pure **Node** (does not load the native module). Fast, no display needed.
- `npm run test:v1-sim` — full shop-loop simulation (products→GRN→sales→returns→Z-report) that runs under **Electron**, so it needs a display: `xvfb-run -a npm run test:v1-sim`. It writes/overwrites `docs/V1_SIMULATION_LOG.md` (a generated artifact — don't commit it).
- `npm run lint` — intentionally a no-op (`echo "No linting configured"`); there is no linter in this repo.

### Native module + Electron binary gotchas (important)
- `better-sqlite3` is a native addon and must be compiled for **Electron's** ABI, not Node's. A plain `npm install` builds it for Node, which makes `test:v1-sim` (and any raw `electron script.mjs`) fail with `NODE_MODULE_VERSION` mismatch. The startup update script fixes this with `npx @electron/rebuild -w better-sqlite3`. Note: `electron-forge start` also auto-rebuilds native modules, so the GUI works even if the ABI drifts — but the standalone Electron scripts do not, so keep the rebuild in place.
- In this VM, `npm install` does **not** download the Electron binary (`node_modules/electron/dist` stays empty even on a fresh install). `node node_modules/electron/install.js` provisions it; the startup update script runs this.

### POS flow gotchas (for manual/e2e testing)
- First run has no accounts → use **"Create Admin Account"** on the login page (bootstrap requires username, 4‑digit PIN, and two different security questions). Then log in via the on-screen PIN keypad.
- A sale is blocked unless the **cash day is open** (Day Open/Close → set opening float) AND the product has a **barcode**, a **selling price > 0**, and **stock** (opening stock or a posted Purchases/GRN) when inventory tracking is on. Add products under a category (create one first).

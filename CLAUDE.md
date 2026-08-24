# ZEN POS — Project Context for Claude Code

## What this is
ZEN POS (formerly POSLY) is an offline-first hybrid point-of-sale system for small and
medium businesses in Sri Lanka. Solo-developed. No cloud sync, by design.

## Tech stack
Electron, React, Vite, better-sqlite3, bcryptjs, JWT, Zustand, HashRouter,
Tailwind/shadcn (manual install only — the shadcn CLI is a known failed approach, do not
suggest it again).

## Golden Rule — non-negotiable
Strict main/renderer/preload IPC boundary. Every IPC channel used in the renderer must be
explicitly allow-listed in `preload.js`, and have a matching handler in main. A large class
of past bugs in this project (blocked channels, "feature exists but doesn't work") came
from channels registered in main but never added to preload. Always check both sides when
wiring or debugging IPC.

## Architecture principles
- Variant-first product architecture: products have one or more sellable variants, not a
  single flat SKU. Pack-size/measured-quantity variants (litres, kg, metres) are being
  added alongside existing size/colour variants — same mechanism, different unit type.
- Per-variant perpetual WAC (weighted-average costing), recalculated on every posted GRN
  receipt. Sales store the WAC at sale time and never get rewritten retroactively.
- Customer returns (restock at original sale-time cost) are a completely separate workflow
  from supplier purchase returns (linked to a posted GRN, valued at current WAC). Do not
  merge these two flows.
- Avoid dual sources of truth for any calculated value. This project was previously burned
  by a duplicate discount-calculation bug (two copies of the same logic in renderer and
  main, drifting apart) — treat this as the cautionary example for every future
  calculation: cost, margin, stock quantity, WAC, MRP.
- WAL-mode SQLite (`zen.db`), single local database, no multi-branch sync in this phase.

## Known failed approaches — do not re-suggest
- Native bcrypt (use bcryptjs)
- shadcn CLI (manual component install only)
- Separate/duplicate login UI
- One fixed ESC/POS command set for all printers (printer behavior varies — reuse the
  existing printer service/adapter pattern rather than hardcoding a new one)

## Working style
- Always distinguish CONFIRMED/implemented behavior from PROPOSED/planned behavior.
  Verify against the actual repo before claiming something exists or is fixed — don't
  assume from a prior conversation or doc.
- Explain root cause before proposing a fix.
- Prefer minimal, targeted changes over rewrites.
- For financial/calculation code (cost, WAC, margin, MRP, stock quantity) — flag changes
  clearly and prefer extra caution over speed. This is the one category where a rushed
  change has real financial consequences for shop owners using the app.
- The developer is time-constrained (roughly 2–4 hours/day, solo). Sequence work into
  small reviewable steps rather than one large change.
- Beginner-friendly, analogy-first explanations are preferred for hardware/Electron-
  specific concepts.

## Current known state (update this section as things change)
- Naming resolved as "ZEN" (not "Sequel").
- B11 duplicate discount calculation: two copies exist (renderer + main), intentionally
  left as-is for now. Future plan: refactor into a shared `calculateCartTotals()`
  function plus broader discount improvements. Do not touch without discussing first.
- Data-lifecycle installer flow (Delete All Data / Start Fresh / Use Existing Data) was
  removed entirely. Installer now auto-detects existing data and opens it, or installs
  fresh if none exists.
- Backup/restore confirmed working, including full credential and data restoration.
- Inventory/purchasing redesign (WAC, GRN, purchase returns, expiry visibility, MRP
  pricing modes) is an active, multi-phase build — see project conversation history for
  the full approved design if not already reflected in code.

## Instructions for Claude Code
1. Before making changes, check whether this file's "current known state" section matches
   the actual repo — if it doesn't, flag the mismatch rather than assuming this file is
   current.
2. When fixing a bug, state the confirmed root cause before proposing the fix.
3. When a change touches cost/price/stock/WAC/MRP calculations, explicitly call this out
   and prefer a smaller, more reviewable diff.
4. Keep this file updated as the project's source of truth changes — treat it as living
   documentation, not a one-time snapshot.

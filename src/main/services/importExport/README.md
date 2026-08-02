# Excel Import & Export (Zen POS)

Admin-only tools under **Settings → Product Import Wizard / Export Data**.

## Product import (wizard)

1. Download the Excel template (or export products first for round-trip edits).
2. Start Import Wizard → select `.xlsx` / `.csv`.
3. Confirm column mapping (auto-suggested from common retail headers).
4. Choose duplicate mode (create / update / skip / replace / merge), category & supplier creation, barcode/SKU auto-generate.
5. Preview colour-coded rows (green / yellow / red). Error rows are skipped; others import.
6. Confirm → progress → summary + optional error report download.

Matching key: **SKU**, then **barcode**. Same product name on multiple rows creates variants (use Size/Color).

## Export

Supports products, inventory, categories, suppliers, sales, purchases (GRN), returns, expenses, users, stock adjustments, low stock, and report slices (daily/VAT/profit). Formats: `.xlsx`, CSV, JSON (PDF for some reports).

## History

Import runs are stored in `import_history` (migration `015_import_export`).

## Dev test

```bash
npm run test:import-export
```

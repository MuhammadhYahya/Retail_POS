# AGENTS.md — POS System Design & Coding Guidelines

These are the standing interface and coding rules for this POS (point-of-sale) project.
Claude (and any other coding agent) must follow these when generating, reviewing, or editing UI code in this repo. Treat this file as binding, not optional style preference.

Context: this is a lightweight, offline-first POS built for Sri Lankan SMEs, with a small online dashboard add-on for remote monitoring. Staff using it are on the shop floor — often on a budget tablet, phone, or older PC, sometimes on a slow or unstable connection. Speed, reliability, and "hard to mis-tap" design matter more than visual flourish.

## 1. Interactions

- **Keyboard-operable everywhere.** Every screen (sale entry, checkout, inventory, settings) must be fully usable via keyboard alone, since some counters use a barcode scanner + keyboard rather than a mouse.
- **Visible focus states.** Every focusable element (product row, quantity field, discount box, pay button) shows a clear focus ring. Use `:focus-visible` so it doesn't distract touchscreen cashiers.
- **Big hit targets.** Minimum 44px tap targets on any touchscreen surface (checkout buttons, numpad, product grid). Never rely on a target smaller than that just because it "looks fine" on desktop.
- **Loading buttons keep their label.** "Charge Rs. 2,450" becomes a spinner + same label, not a generic "Loading…" — the cashier needs to know what's still in flight.
- **Optimistic UI for sales, reconciled after.** When a cashier taps "Add to cart" or "Complete Sale," update the screen immediately; sync to the local DB / cloud dashboard in the background. On failure, show a clear error and offer retry — never silently lose a sale.
- **Confirm destructive actions.** Voiding a sale, deleting a product, or clearing the cart needs a confirmation step or an undo window — these are real money mistakes if wrong.
- **No dead taps.** If a row, card, or button looks tappable, it must be tappable. Cashiers work fast; ambiguous UI causes ring-up errors.
- **Enter/scan submits.** Barcode scanners act as keyboard input ending in Enter — every scan-to-add flow must work from a single Enter keystroke, no mouse needed.

## 2. Offline-first & sync (project-specific)

- **Local operations never block on network.** Every sale, inventory update, and receipt print must complete against the local system first. Cloud dashboard sync is a background concern.
- **Clear sync status.** Show a small, persistent, non-intrusive indicator (e.g., "Synced" / "Syncing…" / "Offline — will sync later") rather than failing silently or popping error dialogs during a sale.
- **Never lose data on connection loss.** Queue unsynced transactions locally; retry automatically when connectivity returns.

## 3. Forms & data entry

- **Numeric keypad by default** for price, quantity, and discount fields (`inputmode="numeric"` / `type="number"` as appropriate) so mobile/tablet keyboards show the right layout.
- **Don't block typing.** Let the cashier type freely in price/qty fields and validate after, rather than silently rejecting keystrokes.
- **Don't pre-disable "Complete Sale."** Let them attempt checkout with an incomplete cart or missing customer info if applicable, and show the specific validation error next to the field — don't just block the button with no explanation.
- **Errors guide the fix.** Instead of "Invalid input," say what's wrong and what to do: "Quantity can't exceed stock (12 left)."
- **Tabular numbers for prices.** Use `font-variant-numeric: tabular-nums` (or a mono font) anywhere prices/totals are compared line by line, so digits align.
- **Currency formatting is consistent.** Always show Rs. amounts with the same number of decimal places throughout the app — don't mix "Rs. 250" and "Rs. 250.00" in the same screen.

## 4. Content & feedback

- **Redundant status cues.** Don't rely on color alone for "in stock / low stock / out of stock," "paid / unpaid," "synced / not synced" — pair color with a text label or icon, since lighting on shop-floor screens varies.
- **All states designed.** Explicitly design empty states (no products yet, empty cart), sparse states (1–2 items), dense states (long receipt, huge inventory list), and error states (payment failed, sync failed, printer offline).
- **Plain, encouraging error language.** "Something went wrong — try printing again or check the printer connection" beats "Print Error 0x004."
- **Resilient to real content.** Product names, especially local-language ones, vary wildly in length — layouts must not break on very short or very long names.

## 5. Performance

- **Fast local response.** Any tap-to-feedback interaction (adding an item, opening a product) should feel instant (<100ms) since this is a local-first app, not waiting on network round-trips.
- **Network calls (cloud sync, dashboard) budgeted under ~500ms** where possible; never block the sale screen on them.
- **Virtualize long lists.** Large product catalogs or sales history lists should be virtualized rather than rendering hundreds of DOM rows.
- **No layout shift.** Reserve space for images (product photos, receipts) so the cart/checkout view doesn't jump while loading.

## 6. Accessibility

- **Icon-only buttons get a label.** Print, delete, void, and refresh icons all need an `aria-label` even if there's no visible text.
- **Native elements first.** Use real `<button>`, `<a>`, `<label>`, `<table>` elements before reaching for custom widgets or raw `aria-*` attributes.
- **Labels for every input**, including numpad and search fields, for screen readers and for label-click-to-focus behavior.

## 7. Design

- **Minimum contrast for shop-floor lighting.** Text and key action buttons (Pay, Complete Sale, Void) need strong contrast — assume screens are viewed in bright ambient light, not a dim office.
- **Interactive states are visibly different.** Hover/active/focus/pressed states on buttons should look clearly different from rest state, since a cashier taps fast and needs confirmation a tap registered.
- **Consistent visual language.** Keep spacing, radii, and color meaning (e.g., red = void/delete, green = complete/paid) consistent across every screen so staff don't have to relearn the app per module.

## 8. Copywriting

- **Second person, active voice, action-oriented.** "Add discount" not "A discount can be added here."
- **Title Case for headings/buttons**, plain sentence case for helper text.
- **Numerals for counts and money.** "8 items," "Rs. 2,450," not spelled out.
- **Specific labels.** "Save changes" or "Complete sale," never a bare "Continue" or "OK" when a more specific action name is possible.

---

## How Claude should use this file

- Before writing or editing any UI code in this repo, apply the rules above.
- When reviewing existing screens (cart, checkout, inventory, dashboard), check them against this list and flag violations before proceeding.
- If a request conflicts with one of these rules (e.g., "hide the sync status to keep it clean"), say so and ask before dropping a rule that affects reliability, money-handling, or accessibility.

/** Asia/Colombo (UTC+5:30) helpers for shop “today” and report bounds. */

const COLOMBO_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Calendar date/time parts in Asia/Colombo for an instant (default now). */
export function colomboParts(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    return colomboParts(new Date());
  }
  const shifted = new Date(d.getTime() + COLOMBO_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Calendar date YYYY-MM-DD in Asia/Colombo for an instant (default now). */
export function colomboDateString(dateInput = new Date()) {
  const parts = colomboParts(dateInput);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Minutes since midnight in Asia/Colombo (0–1439). */
export function colomboMinutesSinceMidnight(dateInput = new Date()) {
  const parts = colomboParts(dateInput);
  return parts.hour * 60 + parts.minute;
}

/** Compact YYYYMMDD for invoice numbers. */
export function colomboDayCompact(dateInput = new Date()) {
  return colomboDateString(dateInput).replace(/-/g, '');
}

/**
 * Inclusive ISO bounds for a Colombo calendar day stored as UTC instants.
 * Shop day 2026-07-30 → 2026-07-29T18:30:00.000Z .. 2026-07-30T18:29:59.999Z
 */
export function colomboDayBounds(dateInput) {
  const raw = String(dateInput || colomboDateString()).slice(0, 10);
  const [y, m, d] = raw.split('-').map((x) => Number(x));
  const startUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - COLOMBO_OFFSET_MS;
  const endUtc = Date.UTC(y, m - 1, d, 23, 59, 59, 999) - COLOMBO_OFFSET_MS;
  return {
    date: raw,
    start: new Date(startUtc).toISOString(),
    end: new Date(endUtc).toISOString(),
  };
}

export function nowIso() {
  return new Date().toISOString();
}

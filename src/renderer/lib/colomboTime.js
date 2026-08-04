/** Asia/Colombo (UTC+5:30) helpers for renderer UI (matches main process). */

const COLOMBO_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

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

export function colomboDateString(dateInput = new Date()) {
  const parts = colomboParts(dateInput);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function colomboMinutesSinceMidnight(dateInput = new Date()) {
  const parts = colomboParts(dateInput);
  return parts.hour * 60 + parts.minute;
}

/** True when an open cash session started on a prior Colombo calendar day. */
export function isStaleOpenSession(session) {
  if (!session?.openedAt) return false;
  return colomboDateString(session.openedAt) !== colomboDateString();
}

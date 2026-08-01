/**
 * Heuristic: treat value as a direct ESC/POS port/path (COM, UNC, file)
 * rather than a Windows printer display name for the spooler.
 */
export function isRawEscPosPort(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/^COM\d+$/i.test(raw)) return true;
  if (raw.startsWith('\\\\.\\COM') || raw.startsWith('\\\\.\\com')) return true;
  if (raw.startsWith('\\\\') || raw.includes('/') || /[\\/]/.test(raw)) return true;
  return false;
}

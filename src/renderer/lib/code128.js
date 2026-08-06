/**
 * Minimal Code128-B encoder → SVG for thermal label printing.
 * Includes quiet zones (≥10 modules each side).
 */

/** Code128 patterns: 11 modules each (BWBWBW), values 0–106. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
const QUIET_MODULES = 10;

function charValue(ch) {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error(`Code128-B cannot encode character code ${code}`);
  }
  return code - 32;
}

/**
 * Encode text as Code128-B module widths (alternating bar/space starting with bar).
 * @param {string} text
 * @returns {number[]}
 */
export function encodeCode128B(text) {
  const raw = String(text ?? '');
  if (!raw) return [];

  const values = [START_B];
  for (let i = 0; i < raw.length; i += 1) {
    values.push(charValue(raw[i]));
  }

  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);
  values.push(STOP);

  const modules = [];
  for (const value of values) {
    const pattern = PATTERNS[value];
    for (const digit of pattern) {
      modules.push(Number(digit));
    }
  }
  return modules;
}

/**
 * Build an inline SVG barcode for a label.
 * @param {string} text
 * @param {{ widthMm?: number, heightMm?: number, moduleMm?: number }} [opts]
 * @returns {string} SVG markup (empty string if text empty)
 */
export function code128Svg(text, opts = {}) {
  const raw = String(text ?? '');
  if (!raw) return '';

  let modules;
  try {
    modules = encodeCode128B(raw);
  } catch {
    // Fallback: replace non-encodable chars so labels still print.
    const safe = raw.replace(/[^\x20-\x7E]/g, '?');
    try {
      modules = encodeCode128B(safe);
    } catch {
      return '';
    }
  }

  if (!modules.length) return '';

  const dataModules = modules.reduce((sum, n) => sum + n, 0);
  const totalModules = dataModules + QUIET_MODULES * 2;

  const targetWidthMm = Math.max(10, Number(opts.widthMm) || 34);
  const heightMm = Math.max(4, Number(opts.heightMm) || 7);
  const minModuleMm = Number(opts.moduleMm) > 0 ? Number(opts.moduleMm) : 0.25;
  const moduleMm = Math.max(minModuleMm, targetWidthMm / totalModules);
  const svgWidthMm = totalModules * moduleMm;

  let x = QUIET_MODULES * moduleMm;
  const rects = [];
  let isBar = true;
  for (const width of modules) {
    const w = width * moduleMm;
    if (isBar) {
      rects.push(
        `<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${heightMm}" fill="#000"/>`
      );
    }
    x += w;
    isBar = !isBar;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidthMm.toFixed(3)}mm" height="${heightMm}mm" viewBox="0 0 ${svgWidthMm.toFixed(3)} ${heightMm}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects.join('')}</svg>`;
}

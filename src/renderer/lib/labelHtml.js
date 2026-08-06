/**
 * Thermal / gap label HTML for XP-365B-style printers (one label per page).
 */

import { code128Svg } from './code128.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function clampMm(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {{
 *   labels?: Array<{ name?: string, price?: number, barcode?: string }>,
 *   widthMm?: number,
 *   heightMm?: number,
 *   autoPrint?: boolean,
 * }} [opts]
 */
export function buildLabelPrintHtml({
  labels = [],
  widthMm = 38,
  heightMm = 25,
  autoPrint = true,
} = {}) {
  const w = clampMm(widthMm, 38, 20, 120);
  const h = clampMm(heightMm, 25, 15, 100);
  const pad = 1;
  const innerW = Math.max(10, w - pad * 2);
  const barcodeHeightMm = Math.min(8, Math.max(5, h * 0.28));
  const barcodeWidthMm = innerW * 0.92;

  const cards = (labels || [])
    .map((label, index) => {
      const name = escapeHtml(label.name || '');
      const price = escapeHtml(money(label.price));
      const code = escapeHtml(label.barcode || '');
      const svg = code128Svg(label.barcode || '', {
        widthMm: barcodeWidthMm,
        heightMm: barcodeHeightMm,
        moduleMm: 0.25,
      });
      const isLast = index === labels.length - 1;
      return `<div class="label${isLast ? ' last' : ''}">
  <div class="name">${name}</div>
  <div class="price">${price}</div>
  <div class="bars">${svg}</div>
  <div class="code">${code}</div>
</div>`;
    })
    .join('\n');

  const autoPrintScript = autoPrint
    ? `<script>window.onload=function(){window.print();}</script>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Barcode Labels</title>
  <style>
    @page {
      size: ${w}mm ${h}mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
    }
    .label {
      width: ${w}mm;
      height: ${h}mm;
      max-width: ${w}mm;
      max-height: ${h}mm;
      padding: ${pad}mm;
      margin: 0;
      overflow: hidden;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4mm;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .label.last {
      page-break-after: auto;
      break-after: auto;
    }
    .name {
      font-size: 2.4mm;
      font-weight: 700;
      line-height: 1.15;
      max-height: 5.6mm;
      overflow: hidden;
      width: 100%;
      word-break: break-word;
    }
    .price {
      font-size: 3.2mm;
      font-weight: 800;
      line-height: 1.1;
      width: 100%;
    }
    .bars {
      width: 100%;
      height: ${barcodeHeightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .bars svg {
      display: block;
      max-width: 100%;
      height: ${barcodeHeightMm}mm;
    }
    .code {
      font-size: 2mm;
      letter-spacing: 0.15mm;
      line-height: 1.1;
      width: 100%;
    }
    @media screen {
      body {
        background: #e8e8e8;
        padding: 12px;
      }
      .label {
        background: #fff;
        margin: 0 auto 12px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      }
    }
  </style>
</head>
<body>
${cards}
${autoPrintScript}
</body>
</html>`;
}

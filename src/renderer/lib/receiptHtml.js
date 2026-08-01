/**
 * Thermal receipt HTML for 58/80mm printers (renderer fallback / dialog print).
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

export function buildThermalReceiptHtml({
  shop = {},
  sale = {},
  paperWidth = 80,
  autoPrint = false,
} = {}) {
  const widthMm = Number(paperWidth) === 58 ? 58 : 80;
  const contentMm = widthMm === 58 ? 48 : 72;
  const shopName = escapeHtml(shop.shopName || 'Shop');
  const address = escapeHtml(shop.shopAddress || '');
  const phone = escapeHtml(shop.shopPhone || '');
  const tin = escapeHtml(shop.shopTin || '');
  const footer = escapeHtml(shop.receiptFooter || 'Thank you');
  const header = escapeHtml(shop.receiptHeader || '');
  const invoice = escapeHtml(sale.invoiceNumber || '');
  const soldBy = escapeHtml(sale.cashierName || sale.cashierUsername || '');
  const saleDate = sale.saleDate
    ? escapeHtml(new Date(sale.saleDate).toLocaleString())
    : '';

  const itemRows = (sale.items || [])
    .map((item) => {
      const name = escapeHtml(item.productName || item.variantName || 'Item');
      const qty = escapeHtml(item.quantity);
      const price = money(item.unitPrice);
      const total = money(Number(item.quantity || 0) * Number(item.unitPrice || 0));
      return `<div class="item">
        <div class="name">${name}</div>
        <div class="line"><span>${qty} x ${price}</span><span>${total}</span></div>
      </div>`;
    })
    .join('');

  const qr = sale.ird?.qrData
    ? `<img class="qr" src="${sale.ird.qrData}" alt="QR" />`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${invoice || 'Receipt'}</title>
  <style>
    @page {
      size: ${widthMm}mm auto;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      width: ${widthMm}mm;
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
    }
    body {
      width: ${contentMm}mm;
      max-width: ${contentMm}mm;
      margin: 0 auto;
      padding: 2mm 1.5mm 4mm;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 11px;
      line-height: 1.25;
    }
    h1 {
      font-size: 13px;
      margin: 0 0 2px;
      text-align: center;
    }
    .center { text-align: center; }
    .muted { color: #222; font-size: 10px; }
    .rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    .item { margin: 3px 0; }
    .name { word-break: break-word; }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }
    .totals .line { margin: 1px 0; }
    .total { font-weight: 700; font-size: 12px; }
    .qr {
      display: block;
      width: 28mm;
      height: 28mm;
      margin: 4px auto 0;
    }
    @media print {
      html, body {
        width: ${widthMm}mm;
        height: auto !important;
        overflow: visible;
      }
      body { padding-bottom: 8mm; }
    }
  </style>
</head>
<body>
  <h1>${shopName}</h1>
  ${header ? `<p class="center muted">${header}</p>` : ''}
  ${address ? `<p class="center muted">${address}</p>` : ''}
  ${phone ? `<p class="center muted">Tel: ${phone}</p>` : ''}
  ${tin ? `<p class="center muted">TIN: ${tin}</p>` : ''}
  <hr class="rule" />
  <div><strong>${invoice}</strong></div>
  ${saleDate ? `<div class="muted">${saleDate}</div>` : ''}
  ${soldBy ? `<div class="muted">Sold by: ${soldBy}</div>` : ''}
  <hr class="rule" />
  ${itemRows || '<div class="muted">No items</div>'}
  <hr class="rule" />
  <div class="totals">
    <div class="line"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
    <div class="line"><span>Discount</span><span>${Number(sale.discountTotal) > 0 ? '-' : ''}${money(sale.discountTotal)}</span></div>
    ${Number(sale.discountTotal) > 0 ? '<div class="muted">Discount applied to total purchase</div>' : ''}
    <div class="line"><span>VAT</span><span>${money(sale.vatTotal)}</span></div>
    <div class="line total"><span>TOTAL</span><span>Rs. ${money(sale.total)}</span></div>
    <div class="line"><span>Paid (${escapeHtml(sale.paymentMethod || 'cash')})</span><span>${money(sale.amountTendered)}</span></div>
    <div class="line"><span>Change</span><span>${money(sale.changeGiven)}</span></div>
  </div>
  ${qr}
  <p class="center muted" style="margin-top:6px">${footer}</p>
  ${Number(shop.returnWithinDays) > 0 ? `<p class="center muted">Returns accepted within ${Math.floor(Number(shop.returnWithinDays))} days</p>` : ''}
  ${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print();},50);}</script>' : ''}
</body>
</html>`;
}

function formatSaleDateHtml(value) {
  const raw = String(value || '').replace('T', ' ').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function formatRefundMethodHtml(method) {
  const m = String(method || 'cash').toLowerCase();
  if (m === 'card') return 'Card';
  if (m === 'qr') return 'QR';
  return 'Cash';
}

export function buildThermalReturnReceiptHtml({
  shop = {},
  returnRecord = {},
  paperWidth = 80,
  autoPrint = false,
} = {}) {
  const widthMm = Number(paperWidth) === 58 ? 58 : 80;
  const contentMm = widthMm === 58 ? 48 : 72;
  const shopName = escapeHtml(shop.shopName || 'Shop');
  const address = escapeHtml(shop.shopAddress || '');
  const phone = escapeHtml(shop.shopPhone || '');
  const tin = escapeHtml(shop.shopTin || '');
  const footer = escapeHtml(shop.receiptFooter || '');
  const header = escapeHtml(shop.receiptHeader || '');
  const returnNumber = escapeHtml(returnRecord.returnNumber || '');
  const invoice = escapeHtml(returnRecord.invoiceNumber || '');
  const saleDate = escapeHtml(formatSaleDateHtml(returnRecord.saleDate));
  const processedBy = escapeHtml(returnRecord.processedByName || 'Staff');
  const reason = String(returnRecord.reason || '').trim();
  const reasonHtml = reason ? escapeHtml(reason) : '';

  const itemRows = (returnRecord.items || [])
    .map((item) => {
      const name = escapeHtml(item.productName || 'Item');
      const variant = item.variantName && item.variantName !== item.productName
        ? `<div class="muted">${escapeHtml(item.variantName)}</div>`
        : '';
      const qty = escapeHtml(item.quantity);
      const unit = money(item.unitRefund);
      const total = money(item.lineRefund);
      return `<div class="item">
        <div class="name">${name}</div>
        ${variant}
        <div style="margin-top:4px">Returned: ${qty}</div>
        <div class="line" style="margin-top:4px"><span>Rs.${unit} x ${qty}</span><span>Rs.${total}</span></div>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${returnNumber || 'Return Receipt'}</title>
  <style>
    @page {
      size: ${widthMm}mm auto;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      width: ${widthMm}mm;
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
    }
    body {
      width: ${contentMm}mm;
      max-width: ${contentMm}mm;
      margin: 0 auto;
      padding: 2mm 1.5mm 4mm;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 11px;
      line-height: 1.25;
    }
    h1 {
      font-size: 13px;
      margin: 0 0 2px;
      text-align: center;
    }
    h2 {
      font-size: 12px;
      margin: 0;
      text-align: center;
      font-weight: 700;
    }
    .center { text-align: center; }
    .muted { color: #222; font-size: 10px; }
    .label { margin-top: 6px; font-size: 10px; }
    .value { margin-bottom: 2px; word-break: break-word; }
    .rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    .item { margin: 6px 0; }
    .name { word-break: break-word; }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }
    .total { font-weight: 700; font-size: 12px; }
    @media print {
      html, body {
        width: ${widthMm}mm;
        height: auto !important;
        overflow: visible;
      }
      body { padding-bottom: 8mm; }
    }
  </style>
</head>
<body>
  <h1>${shopName}</h1>
  ${header ? `<p class="center muted">${header}</p>` : ''}
  ${address ? `<p class="center muted">${address}</p>` : ''}
  ${phone ? `<p class="center muted">Tel: ${phone}</p>` : ''}
  ${tin ? `<p class="center muted">TIN: ${tin}</p>` : ''}
  <hr class="rule" />
  <h2>RETURN RECEIPT</h2>
  <hr class="rule" />
  <div class="label">Return No:</div>
  <div class="value"><strong>${returnNumber}</strong></div>
  <div class="label">Original Invoice:</div>
  <div class="value">${invoice}</div>
  ${saleDate ? `<div class="label">Sale Date:</div><div class="value">${saleDate}</div>` : ''}
  <div class="label">Processed by:</div>
  <div class="value">${processedBy}</div>
  <hr class="rule" />
  ${itemRows || '<div class="muted">No items</div>'}
  <hr class="rule" />
  <div class="label">Refund Total</div>
  <div class="value total">Rs. ${money(returnRecord.refundTotal)}</div>
  <div class="label">Refund Method</div>
  <div class="value">${escapeHtml(formatRefundMethodHtml(returnRecord.refundMethod))}</div>
  ${reasonHtml ? `<div class="label">Reason</div><div class="value">${reasonHtml}</div>` : ''}
  <hr class="rule" />
  <p class="center" style="margin-top:6px">Refund processed successfully.</p>
  <p class="center muted">Thank you.</p>
  ${footer ? `<p class="center muted">${footer}</p>` : ''}
  ${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print();},50);}</script>' : ''}
</body>
</html>`;
}

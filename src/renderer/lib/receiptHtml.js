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
      const disc = Number(item.discountAmount || 0);
      const total = money(item.lineTotal);
      return `<div class="item">
        <div class="name">${name}</div>
        <div class="line"><span>${qty} x ${price}${disc ? ` -${money(disc)}` : ''}</span><span>${total}</span></div>
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
    <div class="line"><span>Discount</span><span>${money(sale.discountTotal)}</span></div>
    <div class="line"><span>VAT</span><span>${money(sale.vatTotal)}</span></div>
    <div class="line total"><span>TOTAL</span><span>Rs. ${money(sale.total)}</span></div>
    <div class="line"><span>Paid (${escapeHtml(sale.paymentMethod || 'cash')})</span><span>${money(sale.amountTendered)}</span></div>
    <div class="line"><span>Change</span><span>${money(sale.changeGiven)}</span></div>
  </div>
  ${qr}
  <p class="center muted" style="margin-top:6px">${footer}</p>
  ${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print();},50);}</script>' : ''}
</body>
</html>`;
}

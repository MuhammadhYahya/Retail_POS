import { create } from 'zustand';

function lineKey(variantId) {
  return String(variantId);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function inclusiveVat(amount, taxRate) {
  const rate = Number(taxRate || 0);
  const total = Number(amount || 0);
  if (rate <= 0 || total <= 0) return 0;
  return roundMoney((total * rate) / (100 + rate));
}

export const useCartStore = create((set, get) => ({
  items: [],
  lastSale: null,

  addItem(productLike, qty = 1) {
    const variantId = productLike.variantId || productLike.id;
    if (!variantId) return;

    const quantity = Number(qty) || 1;
    const existing = get().items.find((item) => item.variantId === variantId);

    if (existing) {
      set({
        items: get().items.map((item) =>
          item.variantId === variantId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        ),
      });
      return;
    }

    set({
      items: [
        ...get().items,
        {
          key: lineKey(variantId),
          variantId,
          productId: productLike.productId || productLike.product?.id,
          productName: productLike.productName || productLike.product?.name || productLike.name || 'Item',
          variantName: productLike.variantName || productLike.name || '',
          sku: productLike.sku || '',
          barcode: productLike.barcode || '',
          unitPrice: Number(productLike.unitPrice ?? productLike.sellingPrice ?? 0),
          taxRate: Number(productLike.taxRate ?? productLike.product?.taxRate ?? 0),
          discountAmount: 0,
          quantity,
        },
      ],
    });
  },

  removeItem(variantId) {
    set({ items: get().items.filter((item) => item.variantId !== variantId) });
  },

  updateQty(variantId, quantity) {
    const qty = Math.max(0, Number(quantity) || 0);
    if (qty <= 0) {
      get().removeItem(variantId);
      return;
    }
    set({
      items: get().items.map((item) =>
        item.variantId === variantId ? { ...item, quantity: qty } : item
      ),
    });
  },

  applyDiscount(variantId, discountAmount) {
    set({
      items: get().items.map((item) =>
        item.variantId === variantId
          ? { ...item, discountAmount: Math.max(0, Number(discountAmount) || 0) }
          : item
      ),
    });
  },

  clear() {
    set({ items: [] });
  },

  setLastSale(sale) {
    set({ lastSale: sale });
  },

  getTotals() {
    const items = get().items;
    let subtotal = 0;
    let discountTotal = 0;
    let vatTotal = 0;

    const lines = items.map((item) => {
      const gross = roundMoney(item.quantity * item.unitPrice);
      const discountAmount = Math.max(0, Number(item.discountAmount) || 0);
      const lineTotal = roundMoney(Math.max(0, gross - discountAmount));
      const vatAmount = inclusiveVat(lineTotal, item.taxRate);
      subtotal = roundMoney(subtotal + gross);
      discountTotal = roundMoney(discountTotal + discountAmount);
      vatTotal = roundMoney(vatTotal + vatAmount);
      return { ...item, lineTotal, vatAmount };
    });

    return {
      lines,
      subtotal,
      discountTotal,
      vatTotal,
      total: roundMoney(subtotal - discountTotal),
    };
  },
}));

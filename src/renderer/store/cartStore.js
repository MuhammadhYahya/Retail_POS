import { create } from 'zustand';

const DISCOUNT_NONE = 'none';
const DISCOUNT_FIXED = 'fixed';
const DISCOUNT_PERCENT = 'percent';

function lineKey(variantId) {
  return String(variantId);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDiscountType(type) {
  const value = String(type || DISCOUNT_NONE).toLowerCase();
  if (value === DISCOUNT_FIXED || value === DISCOUNT_PERCENT) return value;
  return DISCOUNT_NONE;
}

function computeDiscountAmount(baseAmount, type, value) {
  const base = Math.max(0, toNumber(baseAmount, 0));
  const discountType = normalizeDiscountType(type);
  const discountValue = Math.max(0, toNumber(value, 0));
  if (discountType === DISCOUNT_NONE || discountValue <= 0 || base <= 0) return 0;
  if (discountType === DISCOUNT_PERCENT) {
    return roundMoney(Math.min(base, (base * Math.min(discountValue, 100)) / 100));
  }
  return roundMoney(Math.min(base, discountValue));
}

function inclusiveVat(amount, taxRate) {
  const rate = Number(taxRate || 0);
  const total = Number(amount || 0);
  if (rate <= 0 || total <= 0) return 0;
  return roundMoney((total * rate) / (100 + rate));
}

export const useCartStore = create((set, get) => ({
  items: [],
  saleDiscountType: DISCOUNT_NONE,
  saleDiscountValue: 0,
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
          costPrice: Number(productLike.costPrice ?? 0),
          taxRate: Number(productLike.taxRate ?? productLike.product?.taxRate ?? 0),
          discountType: DISCOUNT_NONE,
          discountValue: 0,
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

  /**
   * Apply a per-item discount. Clears any sale-level discount (not combined).
   * type: 'fixed' | 'percent' | 'none'
   */
  applyItemDiscount(variantId, type, value) {
    const discountType = normalizeDiscountType(type);
    const discountValue = discountType === DISCOUNT_NONE ? 0 : Math.max(0, toNumber(value, 0));

    set({
      saleDiscountType: DISCOUNT_NONE,
      saleDiscountValue: 0,
      items: get().items.map((item) =>
        item.variantId === variantId
          ? {
              ...item,
              discountType,
              discountValue,
              discountAmount: 0,
            }
          : item
      ),
    });
  },

  /** @deprecated Prefer applyItemDiscount — kept for compatibility */
  applyDiscount(variantId, discountAmount) {
    get().applyItemDiscount(variantId, DISCOUNT_FIXED, discountAmount);
  },

  /**
   * Apply a whole-sale discount. Clears all item discounts (not combined).
   */
  applySaleDiscount(type, value) {
    const discountType = normalizeDiscountType(type);
    const discountValue = discountType === DISCOUNT_NONE ? 0 : Math.max(0, toNumber(value, 0));

    set({
      saleDiscountType: discountType,
      saleDiscountValue: discountValue,
      items: get().items.map((item) => ({
        ...item,
        discountType: DISCOUNT_NONE,
        discountValue: 0,
        discountAmount: 0,
      })),
    });
  },

  clearSaleDiscount() {
    set({ saleDiscountType: DISCOUNT_NONE, saleDiscountValue: 0 });
  },

  clear() {
    set({
      items: [],
      saleDiscountType: DISCOUNT_NONE,
      saleDiscountValue: 0,
    });
  },

  setLastSale(sale) {
    set({ lastSale: sale });
  },

  getTotals() {
    const items = get().items;
    const saleDiscountType = normalizeDiscountType(get().saleDiscountType);
    const saleDiscountValue = toNumber(get().saleDiscountValue, 0);
    const useSaleDiscount = saleDiscountType !== DISCOUNT_NONE && saleDiscountValue > 0;

    let subtotal = 0;
    let discountTotal = 0;
    let vatTotal = 0;
    let costTotal = 0;

    const rawLines = items.map((item) => {
      const gross = roundMoney(item.quantity * item.unitPrice);
      const lineDiscountType = useSaleDiscount
        ? DISCOUNT_NONE
        : normalizeDiscountType(item.discountType);
      const lineDiscountValue = useSaleDiscount ? 0 : toNumber(item.discountValue, 0);
      const itemDiscountAmount = computeDiscountAmount(gross, lineDiscountType, lineDiscountValue);
      const lineTotalBeforeSale = roundMoney(Math.max(0, gross - itemDiscountAmount));
      const unitCost = toNumber(item.costPrice, 0);

      subtotal = roundMoney(subtotal + gross);
      costTotal = roundMoney(costTotal + unitCost * item.quantity);

      return {
        ...item,
        gross,
        discountType: lineDiscountType,
        discountValue: lineDiscountValue,
        itemDiscountAmount,
        lineTotalBeforeSale,
        unitCost,
      };
    });

    let saleDiscountAmount = 0;
    if (useSaleDiscount && subtotal > 0) {
      // Sale discount applies to total after item prices (items have no discounts when sale disc active)
      saleDiscountAmount = computeDiscountAmount(subtotal, saleDiscountType, saleDiscountValue);
    }

    const lines = rawLines.map((line) => {
      let allocatedSaleDiscount = 0;
      if (useSaleDiscount && subtotal > 0 && saleDiscountAmount > 0) {
        allocatedSaleDiscount = roundMoney((line.gross / subtotal) * saleDiscountAmount);
      }

      const discountAmount = useSaleDiscount
        ? allocatedSaleDiscount
        : line.itemDiscountAmount;
      const lineTotal = roundMoney(Math.max(0, line.gross - discountAmount));
      const vatAmount = inclusiveVat(lineTotal, line.taxRate);
      discountTotal = roundMoney(discountTotal + discountAmount);
      vatTotal = roundMoney(vatTotal + vatAmount);

      const originalLineTotal = line.gross;
      const profit = roundMoney(lineTotal - line.unitCost * line.quantity);

      return {
        ...line,
        discountAmount,
        lineTotal,
        vatAmount,
        originalLineTotal,
        profit,
        saleDiscountAllocated: allocatedSaleDiscount,
      };
    });

    // Fix rounding drift on last allocated sale discount line
    if (useSaleDiscount && lines.length) {
      const allocated = roundMoney(lines.reduce((sum, line) => sum + line.discountAmount, 0));
      const drift = roundMoney(saleDiscountAmount - allocated);
      if (Math.abs(drift) >= 0.01) {
        const last = lines[lines.length - 1];
        last.discountAmount = roundMoney(last.discountAmount + drift);
        last.lineTotal = roundMoney(Math.max(0, last.gross - last.discountAmount));
        last.vatAmount = inclusiveVat(last.lineTotal, last.taxRate);
        discountTotal = saleDiscountAmount;
        vatTotal = roundMoney(lines.reduce((sum, line) => sum + line.vatAmount, 0));
      }
    }

    const total = roundMoney(subtotal - discountTotal);
    const originalProfit = roundMoney(subtotal - costTotal);
    const discountedProfit = roundMoney(total - costTotal);

    return {
      lines,
      subtotal,
      discountTotal,
      vatTotal,
      total,
      costTotal,
      originalProfit,
      discountedProfit,
      saleDiscountType: useSaleDiscount ? saleDiscountType : DISCOUNT_NONE,
      saleDiscountValue: useSaleDiscount ? saleDiscountValue : 0,
      saleDiscountAmount: useSaleDiscount ? saleDiscountAmount : 0,
      hasItemDiscounts: !useSaleDiscount && lines.some((line) => line.discountAmount > 0),
    };
  },
}));

import { create } from 'zustand';
import {
  DISCOUNT_TYPES,
  roundMoney,
  toNumber,
  normalizeDiscountType,
  computeDiscountAmount,
} from '../lib/discountUtils.js';

const DISCOUNT_NONE = DISCOUNT_TYPES.NONE;

function lineKey(variantId) {
  return String(variantId);
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
          unit: productLike.unit || '',
          unitPrice: Number(productLike.unitPrice ?? productLike.sellingPrice ?? 0),
          costPrice: Number(productLike.costPrice ?? 0),
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
      discountTotal = roundMoney(discountTotal + discountAmount);

      const originalLineTotal = line.gross;
      const profit = roundMoney(lineTotal - line.unitCost * line.quantity);

      return {
        ...line,
        discountAmount,
        lineTotal,
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
        discountTotal = saleDiscountAmount;
      }
    }

    const total = roundMoney(subtotal - discountTotal);
    const originalProfit = roundMoney(subtotal - costTotal);
    const discountedProfit = roundMoney(total - costTotal);

    return {
      lines,
      subtotal,
      discountTotal,
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

import { getDb } from '../database/db.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function dayBounds(dateInput) {
  const raw = String(dateInput || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return {
    start: `${raw}T00:00:00.000Z`,
    end: `${raw}T23:59:59.999Z`,
    date: raw,
  };
}

const reportService = {
  dailySummary(dateInput) {
    const db = getDb();
    const { start, end, date } = dayBounds(dateInput);

    const totals = db.prepare(`
      SELECT
        COUNT(*) AS sale_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN subtotal ELSE 0 END), 0) AS original_revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN vat_total ELSE 0 END), 0) AS vat_total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_total ELSE 0 END), 0) AS discount_total,
        COALESCE(SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END), 0) AS void_count,
        COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
        COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
        COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'qr' THEN total ELSE 0 END), 0) AS qr_total
      FROM sales
      WHERE deleted_at IS NULL
        AND sale_date >= ?
        AND sale_date <= ?
    `).get(start, end);

    const itemsSold = db.prepare(`
      SELECT COALESCE(SUM(si.quantity), 0) AS items_sold
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.deleted_at IS NULL
        AND s.status = 'completed'
        AND s.sale_date >= ?
        AND s.sale_date <= ?
    `).get(start, end);

    const margin = db.prepare(`
      SELECT
        COALESCE(SUM(si.unit_cost * si.quantity), 0) AS cost_total,
        COALESCE(SUM(si.original_line_total), 0) AS original_line_total,
        COALESCE(SUM(si.line_total), 0) AS discounted_line_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.deleted_at IS NULL
        AND s.status = 'completed'
        AND s.sale_date >= ?
        AND s.sale_date <= ?
    `).get(start, end);

    const costTotal = toNumber(margin.cost_total);
    const originalRevenue = toNumber(totals.original_revenue);
    const discountedRevenue = toNumber(totals.revenue);
    const originalProfit = roundMoney(originalRevenue - costTotal);
    const discountedProfit = roundMoney(discountedRevenue - costTotal);

    return {
      date,
      saleCount: toNumber(totals.sale_count),
      revenue: discountedRevenue,
      originalRevenue,
      vatTotal: toNumber(totals.vat_total),
      discountTotal: toNumber(totals.discount_total),
      voidCount: toNumber(totals.void_count),
      itemsSold: toNumber(itemsSold.items_sold),
      cashTotal: toNumber(totals.cash_total),
      cardTotal: toNumber(totals.card_total),
      qrTotal: toNumber(totals.qr_total),
      costTotal,
      originalProfit,
      discountedProfit,
      marginPct:
        discountedRevenue > 0
          ? roundMoney((discountedProfit / discountedRevenue) * 100)
          : 0,
    };
  },

  topProducts(days = 7, limit = 10) {
    const db = getDb();
    const lookback = Math.max(1, toNumber(days, 7));
    const take = Math.min(Math.max(toNumber(limit, 10), 1), 50);
    const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000).toISOString();

    return db.prepare(`
      SELECT
        si.product_id AS productId,
        si.product_name AS productName,
        SUM(si.quantity) AS quantity,
        SUM(si.line_total) AS revenue,
        SUM(si.original_line_total) AS originalRevenue,
        SUM(si.unit_cost * si.quantity) AS costTotal
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.deleted_at IS NULL
        AND s.status = 'completed'
        AND s.sale_date >= ?
      GROUP BY si.product_id, si.product_name
      ORDER BY quantity DESC
      LIMIT ?
    `).all(since, take).map((row, index) => {
      const revenue = toNumber(row.revenue);
      const costTotal = toNumber(row.costTotal);
      const profit = roundMoney(revenue - costTotal);
      return {
        rank: index + 1,
        productId: row.productId,
        productName: row.productName,
        quantity: toNumber(row.quantity),
        revenue,
        originalRevenue: toNumber(row.originalRevenue),
        costTotal,
        profit,
        marginPct: revenue > 0 ? roundMoney((profit / revenue) * 100) : 0,
      };
    });
  },

  salesByDay(fromDate, toDate) {
    const db = getDb();
    const from = String(fromDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const to = String(toDate || from).slice(0, 10);

    return db.prepare(`
      SELECT
        substr(sale_date, 1, 10) AS day,
        COUNT(*) AS sale_count,
        COALESCE(SUM(total), 0) AS revenue
      FROM sales
      WHERE deleted_at IS NULL
        AND status = 'completed'
        AND substr(sale_date, 1, 10) >= ?
        AND substr(sale_date, 1, 10) <= ?
      GROUP BY substr(sale_date, 1, 10)
      ORDER BY day ASC
    `).all(from, to).map((row) => ({
      date: row.day,
      saleCount: toNumber(row.sale_count),
      revenue: toNumber(row.revenue),
    }));
  },

  recentSales({ date = null, limit = 50 } = {}) {
    const db = getDb();
    const take = Math.min(Math.max(toNumber(limit, 50), 1), 200);
    const day = date ? String(date).slice(0, 10) : null;

    const rows = day
      ? db.prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.sale_date,
            s.subtotal,
            s.discount_total,
            s.total,
            s.payment_method,
            s.status,
            s.cashier_id,
            u.display_name AS cashier_name,
            u.username AS cashier_username,
            COALESCE((
              SELECT SUM(si.unit_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id
            ), 0) AS cost_total
          FROM sales s
          LEFT JOIN users u ON u.id = s.cashier_id
          WHERE s.deleted_at IS NULL
            AND substr(s.sale_date, 1, 10) = ?
          ORDER BY s.sale_date DESC
          LIMIT ?
        `).all(day, take)
      : db.prepare(`
          SELECT
            s.id,
            s.invoice_number,
            s.sale_date,
            s.subtotal,
            s.discount_total,
            s.total,
            s.payment_method,
            s.status,
            s.cashier_id,
            u.display_name AS cashier_name,
            u.username AS cashier_username,
            COALESCE((
              SELECT SUM(si.unit_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id
            ), 0) AS cost_total
          FROM sales s
          LEFT JOIN users u ON u.id = s.cashier_id
          WHERE s.deleted_at IS NULL
          ORDER BY s.sale_date DESC
          LIMIT ?
        `).all(take);

    return rows.map((row) => {
      const total = toNumber(row.total);
      const subtotal = toNumber(row.subtotal);
      const costTotal = toNumber(row.cost_total);
      return {
        id: row.id,
        invoiceNumber: row.invoice_number,
        saleDate: row.sale_date,
        subtotal,
        discountTotal: toNumber(row.discount_total),
        total,
        paymentMethod: row.payment_method,
        status: row.status,
        cashierId: row.cashier_id,
        cashierName: row.cashier_name || row.cashier_username || 'Unknown',
        costTotal,
        originalProfit: roundMoney(subtotal - costTotal),
        discountedProfit: roundMoney(total - costTotal),
      };
    });
  },
};

export default reportService;

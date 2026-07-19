import { getDb } from '../database/db.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

    return {
      date,
      saleCount: toNumber(totals.sale_count),
      revenue: toNumber(totals.revenue),
      vatTotal: toNumber(totals.vat_total),
      discountTotal: toNumber(totals.discount_total),
      voidCount: toNumber(totals.void_count),
      itemsSold: toNumber(itemsSold.items_sold),
      cashTotal: toNumber(totals.cash_total),
      cardTotal: toNumber(totals.card_total),
      qrTotal: toNumber(totals.qr_total),
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
        SUM(si.line_total) AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.deleted_at IS NULL
        AND s.status = 'completed'
        AND s.sale_date >= ?
      GROUP BY si.product_id, si.product_name
      ORDER BY quantity DESC
      LIMIT ?
    `).all(since, take).map((row, index) => ({
      rank: index + 1,
      productId: row.productId,
      productName: row.productName,
      quantity: toNumber(row.quantity),
      revenue: toNumber(row.revenue),
    }));
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
};

export default reportService;

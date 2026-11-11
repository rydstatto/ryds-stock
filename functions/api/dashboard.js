import { errorResponse, json, requireReadAccess } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    requireReadAccess(request, env);
    const [inventory, sales, lowStock, recentSales, topProducts, dailySales, categories] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS product_count,
                COALESCE(SUM(stock * cost_cents), 0) AS inventory_cost_cents,
                COALESCE(SUM(stock * price_cents), 0) AS inventory_retail_cents
         FROM stock_products WHERE active = 1`,
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS sale_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
         FROM stock_sales WHERE date(created_at) = date('now')`,
      ).first(),
      env.DB.prepare(
        `SELECT id, name, sku, stock, min_stock
         FROM stock_products
         WHERE active = 1 AND stock <= min_stock
         ORDER BY stock ASC, name COLLATE NOCASE
         LIMIT 8`,
      ).all(),
      env.DB.prepare(
        `SELECT s.id, s.customer_name, s.total_cents, s.created_at,
                COALESCE(group_concat(i.product_name || ' × ' || i.quantity, ', '), '') AS items
         FROM stock_sales s
         LEFT JOIN stock_sale_items i ON i.sale_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT 6`,
      ).all(),
      env.DB.prepare(
        `SELECT i.product_name, SUM(i.quantity) AS units_sold,
                SUM(i.line_total_cents) AS revenue_cents
         FROM stock_sale_items i
         JOIN stock_sales s ON s.id = i.sale_id
         WHERE date(s.created_at) >= date('now', '-29 days')
         GROUP BY i.product_id, i.product_name
         ORDER BY units_sold DESC, revenue_cents DESC
         LIMIT 5`,
      ).all(),
      env.DB.prepare(
        `SELECT date(created_at) AS day, SUM(total_cents) AS revenue_cents
         FROM stock_sales
         WHERE date(created_at) >= date('now', '-6 days')
         GROUP BY date(created_at)
         ORDER BY day`,
      ).all(),
      env.DB.prepare(
        `SELECT category, COUNT(*) AS product_count
         FROM stock_products WHERE active = 1
         GROUP BY category ORDER BY product_count DESC, category`,
      ).all(),
    ]);

    return json({
      product_count: inventory.product_count,
      inventory_cost_cents: inventory.inventory_cost_cents,
      inventory_retail_cents: inventory.inventory_retail_cents,
      today_sale_count: sales.sale_count,
      today_revenue_cents: sales.revenue_cents,
      low_stock: lowStock.results,
      recent_sales: recentSales.results,
      top_products: topProducts.results,
      daily_sales: dailySales.results,
      categories: categories.results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

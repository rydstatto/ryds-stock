import {
  errorResponse,
  HttpError,
  json,
  readJson,
  requireAuth,
  validateDate,
  validateSale,
} from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    requireAuth(request, env);
    const url = new URL(request.url);
    const from = validateDate(url.searchParams.get("from"), "La fecha inicial");
    const to = validateDate(url.searchParams.get("to"), "La fecha final");
    if (from && to && from > to) throw new HttpError(422, "La fecha inicial debe ser anterior a la fecha final.");
    const requestedLimit = Number(url.searchParams.get("limit") || 200);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 2000) : 200;
    let query = `SELECT s.id, s.customer_name, s.note, s.total_cents, s.created_at,
      COALESCE((
        SELECT group_concat(i.product_name || ' × ' || i.quantity, ', ')
        FROM stock_sale_items i WHERE i.sale_id = s.id
      ), '') AS items,
      COALESCE((
        SELECT SUM(i.quantity) FROM stock_sale_items i WHERE i.sale_id = s.id
      ), 0) AS units_sold,
      COALESCE((
        SELECT SUM((i.unit_price_cents - i.unit_cost_cents) * i.quantity)
        FROM stock_sale_items i WHERE i.sale_id = s.id
      ), 0) AS gross_profit_cents
      FROM stock_sales s WHERE 1 = 1`;
    const params = [];
    if (from) {
      query += " AND date(s.created_at) >= date(?)";
      params.push(from);
    }
    if (to) {
      query += " AND date(s.created_at) <= date(?)";
      params.push(to);
    }
    query += " ORDER BY s.created_at DESC LIMIT ?";
    params.push(limit);
    const result = await env.DB.prepare(query).bind(...params).all();
    return json(result.results);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireAuth(request, env);
    const sale = validateSale(await readJson(request));
    const products = [];
    for (const item of sale.items) {
      const product = await env.DB.prepare(
        "SELECT id, name, cost_cents, price_cents, stock, active FROM stock_products WHERE id = ?",
      ).bind(item.product_id).first();
      if (!product || !product.active) throw new HttpError(422, "Uno de los productos no está disponible.");
      if (product.stock < item.quantity) {
        throw new HttpError(409, `Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
      }
      products.push({ ...product, quantity: item.quantity });
    }
    const total = products.reduce((sum, product) => sum + product.price_cents * product.quantity, 0);
    const saleId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const statements = [
      env.DB.prepare(
        "INSERT INTO stock_sales (id, customer_name, note, total_cents, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(saleId, sale.customer_name, sale.note, total, createdAt),
      ...products.map(product =>
        env.DB.prepare(
          `INSERT INTO stock_sale_items (
            id, sale_id, product_id, product_name, quantity, unit_price_cents,
            unit_cost_cents, line_total_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          saleId,
          product.id,
          product.name,
          product.quantity,
          product.price_cents,
          product.cost_cents,
          product.price_cents * product.quantity,
        ),
      ),
    ];
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (String(error).includes("INSUFFICIENT_STOCK")) {
        throw new HttpError(409, "El stock cambió mientras se registraba la venta. Actualiza el inventario e inténtalo otra vez.");
      }
      throw error;
    }
    return json({
      id: saleId,
      customer_name: sale.customer_name,
      note: sale.note,
      total_cents: total,
      created_at: createdAt,
      items: products.map(product => ({
        product_id: product.id,
        product_name: product.name,
        quantity: product.quantity,
        unit_price_cents: product.price_cents,
        line_total_cents: product.price_cents * product.quantity,
      })),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

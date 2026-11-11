import {
  errorResponse,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireAdmin,
  validateStockAdjustment,
} from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    requireAuth(request, env);
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50;
    const result = await env.DB.prepare(
      `SELECT m.id, m.product_id, p.name AS product_name, p.sku,
              m.quantity_delta, m.reason, m.reference, m.created_at
       FROM stock_movements m
       JOIN stock_products p ON p.id = m.product_id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ?`,
    ).bind(limit).all();
    return json(result.results);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireAdmin(request, env);
    const movement = validateStockAdjustment(await readJson(request));
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO stock_movements (
          id, product_id, quantity_delta, reason, reference, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        movement.product_id,
        movement.quantity_delta,
        movement.reason,
        movement.reference,
        new Date().toISOString(),
      ).run();
    } catch (error) {
      if (String(error).includes("INSUFFICIENT_STOCK")) {
        throw new HttpError(409, "El ajuste dejaría el inventario en negativo.");
      }
      throw error;
    }
    const result = await env.DB.prepare(
      `SELECT m.id, m.product_id, p.name AS product_name, p.stock,
              m.quantity_delta, m.reason, m.reference, m.created_at
       FROM stock_movements m JOIN stock_products p ON p.id = m.product_id
       WHERE m.id = ?`,
    ).bind(id).first();
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

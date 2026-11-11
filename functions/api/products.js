import {
  errorResponse,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireAdmin,
  validateProduct,
} from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    requireAuth(request, env);
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") || "").trim().slice(0, 100);
    const category = (url.searchParams.get("category") || "").trim().slice(0, 60);
    let query = "SELECT * FROM stock_products WHERE 1 = 1";
    const params = [];
    if (search) {
      query += " AND (name LIKE ? OR sku LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      query += " AND category = ?";
      params.push(category);
    }
    query += " ORDER BY active DESC, name COLLATE NOCASE";
    const result = await env.DB.prepare(query).bind(...params).all();
    return json(result.results);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireAdmin(request, env);
    const product = validateProduct(await readJson(request));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      const statements = [
        env.DB.prepare(
          `INSERT INTO stock_products (
          id, name, sku, category, cost_cents, price_cents, stock, min_stock,
          active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        ).bind(
          id,
          product.name,
          product.sku,
          product.category,
          product.cost_cents,
          product.price_cents,
          product.min_stock,
          product.active,
          now,
          now,
        ),
      ];
      if (product.stock > 0) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO stock_movements (
              id, product_id, quantity_delta, reason, reference, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            id,
            product.stock,
            "Entrada",
            "Stock inicial del producto",
            now,
          ),
        );
      }
      await env.DB.batch(statements);
    } catch (error) {
      if (String(error).includes("stock_products.sku")) {
        throw new HttpError(409, "Ya existe un producto con ese SKU.");
      }
      throw error;
    }
    const result = await env.DB.prepare("SELECT * FROM stock_products WHERE id = ?").bind(id).first();
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

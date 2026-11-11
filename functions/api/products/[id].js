import {
  errorResponse,
  HttpError,
  json,
  readJson,
  requireAdmin,
  validateProduct,
} from "../_shared.js";

export async function onRequestPut({ request, env, params }) {
  try {
    requireAdmin(request, env);
    const product = validateProduct(await readJson(request));
    try {
      const result = await env.DB.prepare(
        `UPDATE stock_products
         SET name = ?, sku = ?, category = ?, cost_cents = ?, price_cents = ?,
             min_stock = ?, active = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        product.name,
        product.sku,
        product.category,
        product.cost_cents,
        product.price_cents,
        product.min_stock,
        product.active,
        new Date().toISOString(),
        params.id,
      ).run();
      if (!result.meta.changes) throw new HttpError(404, "El producto no existe.");
    } catch (error) {
      if (String(error).includes("stock_products.sku")) {
        throw new HttpError(409, "Ya existe otro producto con ese SKU.");
      }
      throw error;
    }
    return json(await env.DB.prepare("SELECT * FROM stock_products WHERE id = ?").bind(params.id).first());
  } catch (error) {
    return errorResponse(error);
  }
}

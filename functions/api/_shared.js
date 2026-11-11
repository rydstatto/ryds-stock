export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export function errorResponse(error) {
  if (error instanceof HttpError) return json({ detail: error.message }, error.status);
  console.error("Ryds Stock API request failed:", error);
  return json({ detail: "Ocurrió un error interno. Inténtalo más tarde." }, 500);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "El cuerpo de la solicitud debe ser JSON válido.");
  }
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function requireAuth(request, env) {
  const adminUsername = env.ADMIN_USERNAME;
  const adminPassword = env.ADMIN_PASSWORD;
  const staffUsername = env.STAFF_USERNAME || "";
  const staffPassword = env.STAFF_PASSWORD || "";
  if (!adminUsername) throw new HttpError(503, "Falta configurar ADMIN_USERNAME.");
  if (typeof adminPassword !== "string") {
    throw new HttpError(503, "Falta configurar ADMIN_PASSWORD.");
  }
  if (!adminPassword.length) {
    throw new HttpError(503, "ADMIN_PASSWORD está configurada, pero vacía.");
  }
  if (Boolean(staffUsername) !== Boolean(staffPassword)) {
    throw new HttpError(503, "La cuenta de vendedor no está configurada correctamente.");
  }

  const header = request.headers.get("Authorization") || "";
  const match = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(header);
  const decoded = match ? decodeBase64(match[1]) : null;
  const separator = decoded?.indexOf(":") ?? -1;
  const suppliedUsername = separator >= 0 ? decoded.slice(0, separator) : "";
  const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
  const adminMatch =
    constantTimeEqual(suppliedUsername, adminUsername) &&
    constantTimeEqual(suppliedPassword, adminPassword);
  const staffMatch = staffUsername
    ? constantTimeEqual(suppliedUsername, staffUsername) &&
      constantTimeEqual(suppliedPassword, staffPassword)
    : false;
  if (adminMatch) return "admin";
  if (staffMatch) return "staff";
  throw new HttpError(401, "Usuario o contraseña incorrectos.");
}

export function requireReadAccess(request, env) {
  if (!request.headers.get("Authorization")) return "demo";
  return requireAuth(request, env);
}

export function requireAdmin(request, env) {
  const role = requireAuth(request, env);
  if (role !== "admin") throw new HttpError(403, "Esta acción requiere permisos de administrador.");
}

function requireRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(422, "Los datos enviados no son válidos.");
  }
}

export function parseMoney(value, field = "precio") {
  const normalized = typeof value === "number" ? String(value) : value;
  if (
    typeof normalized !== "string" ||
    !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(normalized.trim())
  ) {
    throw new HttpError(422, `El ${field} debe ser un importe válido con hasta dos decimales.`);
  }
  const [whole, fraction = ""] = normalized.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function parseInteger(value, field, minimum = 0, maximum = 100000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(422, `${field} debe ser un número entero entre ${minimum} y ${maximum}.`);
  }
  return number;
}

export function validateProduct(body) {
  requireRecord(body);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sku = typeof body.sku === "string" ? body.sku.trim().toUpperCase() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(422, "El nombre del producto debe tener entre 2 y 100 caracteres.");
  }
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku)) {
    throw new HttpError(422, "El SKU debe tener entre 2 y 40 caracteres: letras, números, punto, guion o guion bajo.");
  }
  if (category.length < 2 || category.length > 60) {
    throw new HttpError(422, "La categoría debe tener entre 2 y 60 caracteres.");
  }
  return {
    name,
    sku,
    category,
    cost_cents: parseMoney(body.cost, "costo"),
    price_cents: parseMoney(body.price, "precio"),
    min_stock: parseInteger(body.min_stock, "El stock mínimo"),
    stock: parseInteger(body.stock, "El stock"),
    active: body.active === false ? 0 : 1,
  };
}

export function validateSale(body) {
  requireRecord(body);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40) {
    throw new HttpError(422, "La venta debe incluir entre 1 y 40 productos.");
  }
  const quantities = new Map();
  for (const item of body.items) {
    requireRecord(item);
    if (typeof item.product_id !== "string" || item.product_id.length > 80) {
      throw new HttpError(422, "Hay un producto no válido en la venta.");
    }
    const quantity = parseInteger(item.quantity, "La cantidad", 1, 999);
    quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + quantity);
  }
  if ([...quantities.values()].some(quantity => quantity > 999)) {
    throw new HttpError(422, "La cantidad de un producto no puede superar 999 unidades.");
  }

  const customerName =
    typeof body.customer_name === "string" && body.customer_name.trim()
      ? body.customer_name.trim()
      : "Venta mostrador";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (customerName.length > 100 || note.length > 240) {
    throw new HttpError(422, "El nombre del cliente o la nota son demasiado largos.");
  }
  return {
    customer_name: customerName,
    note: note || null,
    items: [...quantities].map(([product_id, quantity]) => ({ product_id, quantity })),
  };
}

export function validateDate(value, field) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(422, `${field} debe ser una fecha válida.`);
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(422, `${field} debe ser una fecha válida.`);
  }
  return value;
}

export function validateStockAdjustment(body) {
  requireRecord(body);
  if (typeof body.product_id !== "string" || body.product_id.length > 80) {
    throw new HttpError(422, "Selecciona un producto válido.");
  }
  const quantity = parseInteger(body.quantity, "La cantidad", 1, 100000);
  if (!["entrada", "ajuste"].includes(body.type)) {
    throw new HttpError(422, "El tipo de movimiento no es válido.");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 2 || reason.length > 120) {
    throw new HttpError(422, "Indica un motivo de entre 2 y 120 caracteres.");
  }
  return {
    product_id: body.product_id,
    quantity_delta: body.type === "entrada" ? quantity : -quantity,
    reason: body.type === "entrada" ? "Entrada" : "Ajuste",
    reference: reason,
  };
}

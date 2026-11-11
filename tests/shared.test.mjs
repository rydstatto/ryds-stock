import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  parseMoney,
  requireAdmin,
  requireAuth,
  validateDate,
  validateProduct,
  validateSale,
  validateStockAdjustment,
} from "../functions/api/_shared.js";
import { onRequestPost as createProduct } from "../functions/api/products.js";
import {
  onRequestGet as listSales,
  onRequestPost as createSale,
} from "../functions/api/sales.js";

test("parseMoney converts valid amounts to integer cents", () => {
  assert.equal(parseMoney("12"), 1200);
  assert.equal(parseMoney("12.3"), 1230);
  assert.equal(parseMoney("12.34"), 1234);
});

test("parseMoney rejects values with unsupported precision or format", () => {
  for (const value of ["-1", "1.234", "01", "1,20", "not a price"]) {
    assert.throws(() => parseMoney(value), HttpError);
  }
});

test("validateProduct normalizes SKU and preserves a valid opening quantity", () => {
  const product = validateProduct({
    name: "  Café molido ",
    sku: "caf-500",
    category: "Alimentos",
    cost: "4.20",
    price: "7.50",
    min_stock: 3,
    stock: 12,
    active: true,
  });
  assert.equal(product.sku, "CAF-500");
  assert.equal(product.cost_cents, 420);
  assert.equal(product.price_cents, 750);
  assert.equal(product.stock, 12);
});

test("validateSale consolidates repeated product quantities and validates customer fields", () => {
  const sale = validateSale({
    items: [
      { product_id: "product-1", quantity: 2 },
      { product_id: "product-1", quantity: 1 },
    ],
    customer_name: " Cliente ",
  });
  assert.deepEqual(sale.items, [{ product_id: "product-1", quantity: 3 }]);
  assert.equal(sale.customer_name, "Cliente");
  assert.throws(() => validateSale({ items: [{ product_id: "p", quantity: 1000 }] }), HttpError);
});

test("date and stock adjustment validators reject invalid input", () => {
  assert.equal(validateDate("2026-03-10", "fecha"), "2026-03-10");
  assert.throws(() => validateDate("2026-02-30", "fecha"), HttpError);
  assert.deepEqual(
    validateStockAdjustment({
      product_id: "product-1",
      quantity: 4,
      type: "ajuste",
      reason: "Conteo físico",
    }),
    {
      product_id: "product-1",
      quantity_delta: -4,
      reason: "Ajuste",
      reference: "Conteo físico",
    },
  );
  assert.throws(() => validateStockAdjustment({
    product_id: "product-1",
    quantity: 1,
    type: "unknown",
    reason: "Prueba",
  }), HttpError);
});

test("basic authentication distinguishes admin and staff permissions", () => {
  const env = {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "clave-á",
    STAFF_USERNAME: "staff",
    STAFF_PASSWORD: "staff-password",
  };
  const requestFor = credentials => {
    const bytes = new TextEncoder().encode(credentials);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    return new Request("https://example.test/api/auth", {
      headers: { Authorization: `Basic ${btoa(binary)}` },
    });
  };

  assert.equal(requireAuth(requestFor("staff:staff-password"), env), "staff");
  assert.equal(requireAuth(requestFor("admin:clave-á"), env), "admin");
  assert.throws(
    () => requireAdmin(requestFor("staff:staff-password"), env),
    error => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () => requireAuth(requestFor("staff:wrong"), env),
    error => error instanceof HttpError && error.status === 401,
  );
});

test("authentication reports incomplete account configuration", () => {
  const request = new Request("https://example.test/api/auth");
  assert.throws(
    () => requireAuth(request, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "password", STAFF_USERNAME: "staff" }),
    error => error instanceof HttpError && error.status === 503,
  );
});

test("staff can read sales reports including estimated gross profit", async () => {
  const request = new Request("https://example.test/api/sales?limit=10", {
    headers: { Authorization: `Basic ${btoa("staff:staff-password")}` },
  });
  const response = await listSales({
    request,
    env: {
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "admin-password",
      STAFF_USERNAME: "staff",
      STAFF_PASSWORD: "staff-password",
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async all() {
              return { results: [{ gross_profit_cents: 500 }] };
            },
          };
        },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ gross_profit_cents: 500 }]);
});

test("staff can register a sale and the API calculates its total", async () => {
  const request = new Request("https://example.test/api/sales", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa("staff:staff-password")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_name: "Venta mostrador",
      items: [{ product_id: "product-1", quantity: 2 }],
    }),
  });
  const response = await createSale({
    request,
    env: {
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "admin-password",
      STAFF_USERNAME: "staff",
      STAFF_PASSWORD: "staff-password",
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async first() {
              return {
                id: "product-1",
                name: "Café de prueba",
                cost_cents: 400,
                price_cents: 750,
                stock: 5,
                active: 1,
              };
            },
          };
        },
        async batch() {},
      },
    },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).total_cents, 1500);
});

test("product creation records opening stock in the same D1 batch", async () => {
  const batchedStatements = [];
  const prepared = [];
  const env = {
    ADMIN_USERNAME: "ryds",
    ADMIN_PASSWORD: "test-password",
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          values: [],
          bind(...values) {
            this.values = values;
            return this;
          },
          async first() {
            return { id: this.values[0], stock: 8 };
          },
        };
        prepared.push(statement);
        return statement;
      },
      async batch(statements) {
        batchedStatements.push(...statements);
      },
    },
  };
  const request = new Request("https://example.test/api/products", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa("ryds:test-password")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Café de prueba",
      sku: "CAF-TEST",
      category: "Alimentos",
      cost: "4.20",
      price: "7.50",
      min_stock: 2,
      stock: 8,
      active: true,
    }),
  });
  const result = await createProduct({
    request,
    env,
  });
  assert.equal(result.status, 201);
  assert.equal(batchedStatements.length, 2);
  assert.match(batchedStatements[1].sql, /INSERT INTO stock_movements/);
  assert.equal(batchedStatements[1].values[2], 8);
  assert.equal(batchedStatements[1].values[3], "Entrada");
  assert.equal(prepared.at(-1).sql, "SELECT * FROM stock_products WHERE id = ?");
});

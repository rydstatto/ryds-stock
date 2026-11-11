CREATE TABLE IF NOT EXISTS stock_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0),
    min_stock INTEGER NOT NULL CHECK (min_stock >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_products_active_name
    ON stock_products (active, name);

CREATE INDEX IF NOT EXISTS stock_products_category
    ON stock_products (category);

CREATE TABLE IF NOT EXISTS stock_sales (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    note TEXT,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_sales_created_at
    ON stock_sales (created_at);

CREATE TABLE IF NOT EXISTS stock_sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES stock_sales(id),
    product_id TEXT NOT NULL REFERENCES stock_products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
    line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS stock_sale_items_sale_id
    ON stock_sale_items (sale_id);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES stock_products(id),
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
    reason TEXT NOT NULL,
    reference TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stock_movements_product_created
    ON stock_movements (product_id, created_at);

CREATE TRIGGER IF NOT EXISTS stock_sale_item_validate
BEFORE INSERT ON stock_sale_items
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM stock_products
            WHERE id = NEW.product_id AND active = 1 AND stock >= NEW.quantity
        )
        THEN RAISE(ABORT, 'INSUFFICIENT_STOCK')
    END;
END;

CREATE TRIGGER IF NOT EXISTS stock_sale_item_apply
AFTER INSERT ON stock_sale_items
BEGIN
    UPDATE stock_products
    SET stock = stock - NEW.quantity, updated_at = datetime('now')
    WHERE id = NEW.product_id;

    INSERT INTO stock_movements (
        id, product_id, quantity_delta, reason, reference, created_at
    ) VALUES (
        lower(hex(randomblob(16))), NEW.product_id, -NEW.quantity,
        'Venta', NEW.sale_id, datetime('now')
    );
END;

CREATE TRIGGER IF NOT EXISTS stock_movement_validate
BEFORE INSERT ON stock_movements
WHEN NEW.reason != 'Venta'
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM stock_products
            WHERE id = NEW.product_id AND stock + NEW.quantity_delta >= 0
        )
        THEN RAISE(ABORT, 'INSUFFICIENT_STOCK')
    END;
END;

CREATE TRIGGER IF NOT EXISTS stock_movement_apply
AFTER INSERT ON stock_movements
WHEN NEW.reason != 'Venta'
BEGIN
    UPDATE stock_products
    SET stock = stock + NEW.quantity_delta, updated_at = datetime('now')
    WHERE id = NEW.product_id;
END;

INSERT OR IGNORE INTO stock_products (
    id, name, sku, category, cost_cents, price_cents, stock, min_stock, active,
    created_at, updated_at
) VALUES
    ('demo-prod-001', 'Café molido 500 g', 'CAF-500', 'Alimentos', 420, 750, 26, 8, 1, datetime('now'), datetime('now')),
    ('demo-prod-002', 'Taza térmica', 'TAZ-001', 'Hogar', 850, 1590, 13, 4, 1, datetime('now'), datetime('now')),
    ('demo-prod-003', 'Libreta de puntos', 'LIB-014', 'Papelería', 275, 590, 8, 5, 1, datetime('now'), datetime('now')),
    ('demo-prod-004', 'Bolsa reutilizable', 'BOL-002', 'Accesorios', 190, 450, 3, 6, 1, datetime('now'), datetime('now')),
    ('demo-prod-005', 'Chocolate oscuro', 'CHO-070', 'Alimentos', 210, 390, 21, 6, 1, datetime('now'), datetime('now')),
    ('demo-prod-006', 'Vela aromática', 'VEL-008', 'Hogar', 510, 990, 0, 3, 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO stock_sales (id, customer_name, note, total_cents, created_at) VALUES
    ('demo-sale-001', 'Venta mostrador', 'Venta de demostración', 2280, datetime('now', '-1 day')),
    ('demo-sale-002', 'Cliente de prueba', 'Datos ficticios', 1590, datetime('now', '-2 day')),
    ('demo-sale-003', 'Venta mostrador', 'Venta de demostración', 980, datetime('now', '-3 day'));

INSERT OR IGNORE INTO stock_sale_items (
    id, sale_id, product_id, product_name, quantity, unit_price_cents, unit_cost_cents, line_total_cents
) VALUES
    ('demo-item-001', 'demo-sale-001', 'demo-prod-001', 'Café molido 500 g', 2, 750, 420, 1500),
    ('demo-item-002', 'demo-sale-001', 'demo-prod-005', 'Chocolate oscuro', 2, 390, 210, 780),
    ('demo-item-003', 'demo-sale-002', 'demo-prod-002', 'Taza térmica', 1, 1590, 850, 1590),
    ('demo-item-004', 'demo-sale-003', 'demo-prod-003', 'Libreta de puntos', 1, 590, 275, 590),
    ('demo-item-005', 'demo-sale-003', 'demo-prod-005', 'Chocolate oscuro', 1, 390, 210, 390);

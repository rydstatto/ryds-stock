const state = {
  authorization: "",
  role: "",
  products: [],
  dashboard: null,
  sales: [],
  movements: [],
  cart: new Map(),
  reportSales: [],
};

const viewTitles = {
  dashboard: "Resumen",
  products: "Productos",
  sales: "Ventas",
  inventory: "Movimientos",
  reports: "Informes",
};

const money = cents => new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format((Number(cents) || 0) / 100);

const formatDate = value => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

const byId = id => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(state.authorization ? { Authorization: state.authorization } : {}),
      ...options.headers,
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("El servidor devolvió una respuesta no válida.");
  }
  if (!response.ok) {
    if (response.status === 401) signOut();
    throw new Error(payload.detail || "No fue posible completar la solicitud.");
  }
  return payload;
}

function showMessage(elementId, message = "") {
  byId(elementId).textContent = message;
}

function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.textContent = message;
  byId("toast-region").append(element);
  window.setTimeout(() => element.remove(), 4200);
}

function setBusy(button, busy, busyText = "Guardando...") {
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function basicAuthorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  return `Basic ${btoa(binary)}`;
}

async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId("login-button");
  const data = new FormData(form);
  state.authorization = basicAuthorization(data.get("username"), data.get("password"));
  showMessage("login-message");
  setBusy(button, true, "Validando...");
  try {
    const session = await api("/api/auth");
    state.role = session.role;
    byId("account-role").textContent = state.role === "admin" ? "Administrador" : "Vendedor";
    byId("account-permissions").textContent = state.role === "admin" ? "Acceso completo" : "Ventas y consultas";
    document.querySelectorAll("[data-admin-only]").forEach(element => {
      element.hidden = state.role !== "admin";
    });
    byId("login-password").value = "";
    byId("login-screen").hidden = true;
    byId("app-shell").hidden = false;
    await refreshAll();
  } catch (error) {
    state.authorization = "";
    state.role = "";
    showMessage("login-message", error.message);
  } finally {
    setBusy(button, false);
  }
}

function signOut() {
  state.authorization = "";
  state.products = [];
  state.cart.clear();
  byId("app-shell").hidden = true;
  byId("login-screen").hidden = false;
  byId("login-password").value = "";
  showMessage("login-message", "La sesión terminó. Ingresa de nuevo.");
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
}

async function refreshAll() {
  try {
    const [products, dashboard] = await Promise.all([
      api("/api/products"),
      api("/api/dashboard"),
    ]);
    state.products = products;
    state.dashboard = dashboard;
    renderProducts();
    renderDashboard();
    renderProductOptions();
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(now.getDate() - 29);
    byId("sales-from").value = dateInputValue(monthAgo);
    byId("sales-to").value = dateInputValue(now);
    byId("report-from").value = dateInputValue(monthAgo);
    byId("report-to").value = dateInputValue(now);
    await Promise.all([loadSales(), loadMovements()]);
    await loadReport();
  } catch (error) {
    toast(error.message, true);
  }
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function switchView(name) {
  if (!viewTitles[name]) return;
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll(".nav-link[data-view]").forEach(link => link.classList.toggle("active", link.dataset.view === name));
  byId("page-title").textContent = viewTitles[name];
  byId("sidebar").classList.remove("open");
  byId("mobile-menu").setAttribute("aria-expanded", "false");
  if (name === "sales") loadSales();
  if (name === "inventory") loadMovements();
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;
  const inventoryValue = money(data.inventory_cost_cents);
  const metricCards = [
    { label: "Productos activos", value: data.product_count, hint: "En el catálogo", icon: "◫" },
    { label: "Ventas de hoy", value: data.today_sale_count, hint: "Operaciones registradas", icon: "↗" },
    { label: "Ingresos de hoy", value: money(data.today_revenue_cents), hint: "Total bruto vendido", icon: "$" },
    { label: "Valor del inventario", value: inventoryValue, hint: "A costo de compra", icon: "▣" },
  ];
  byId("metrics").innerHTML = metricCards.map(item => `
    <article class="metric-card">
      <div class="metric-top"><span>${escapeHtml(item.label)}</span><span class="metric-icon">${item.icon}</span></div>
      <div class="metric-value">${escapeHtml(item.value)}</div>
      <div class="metric-hint">${escapeHtml(item.hint)}</div>
    </article>`).join("");
  renderChart(data.daily_sales || []);
  const lowStock = data.low_stock || [];
  byId("low-stock-list").innerHTML = lowStock.length ? lowStock.map(product => `
    <div class="compact-item">
      <span class="item-avatar">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span>
      <span class="compact-copy"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · mínimo ${product.min_stock}</small></span>
      <span class="stock-level">${product.stock} uds.</span>
    </div>`).join("") : '<div class="empty-state">Todo en orden: no hay productos por reponer.</div>';
  const recent = data.recent_sales || [];
  byId("recent-sales").innerHTML = recent.length ? recent.map(sale => `
    <tr><td><strong>${escapeHtml(sale.id.slice(0, 8).toUpperCase())}</strong></td>
    <td>${escapeHtml(sale.customer_name)}</td><td>${escapeHtml(formatDate(sale.created_at))}</td>
    <td class="align-right"><strong>${money(sale.total_cents)}</strong></td></tr>`).join("") :
    '<tr><td colspan="4" class="empty-state">Todavía no hay ventas registradas.</td></tr>';
  const top = data.top_products || [];
  byId("top-products").innerHTML = top.length ? top.map((product, index) => `
    <div class="compact-item">
      <span class="item-avatar">${String(index + 1).padStart(2, "0")}</span>
      <span class="compact-copy"><strong>${escapeHtml(product.product_name)}</strong><small>${product.units_sold} unidades vendidas</small></span>
      <span class="stock-level">${money(product.revenue_cents)}</span>
    </div>`).join("") : '<div class="empty-state">Aún no hay suficientes ventas para mostrar este resumen.</div>';
}

function renderChart(days) {
  const dataByDay = new Map(days.map(item => [item.day, Number(item.revenue_cents) || 0]));
  const values = [];
  const today = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    values.push({ date, day, value: dataByDay.get(day) || 0 });
  }
  const max = Math.max(...values.map(item => item.value), 1);
  byId("sales-chart").innerHTML = values.map(item => `
    <div class="chart-column" title="${escapeHtml(item.day)}: ${escapeHtml(money(item.value))}">
      <div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(3, (item.value / max) * 100)}%"></div></div>
      <span class="chart-label">${escapeHtml(new Intl.DateTimeFormat("es-CO", { weekday: "short" }).format(item.date).replace(".", ""))}</span>
    </div>`).join("");
}

function productStockBadge(product) {
  if (!product.active) return '<span class="status-badge inactive">Archivado</span>';
  return Number(product.stock) <= Number(product.min_stock)
    ? '<span class="status-badge warning">Stock bajo</span>'
    : '<span class="status-badge">Activo</span>';
}

function renderProducts() {
  const search = byId("product-search").value.trim().toLocaleLowerCase("es");
  const category = byId("category-filter").value;
  const status = byId("status-filter").value;
  const filtered = state.products.filter(product => {
    const matchesText = !search || `${product.name} ${product.sku}`.toLocaleLowerCase("es").includes(search);
    const matchesCategory = !category || product.category === category;
    const matchesStatus = status === "all" || (status === "active" ? product.active : !product.active);
    return matchesText && matchesCategory && matchesStatus;
  });
  byId("products-table").innerHTML = filtered.length ? filtered.map(product => `
    <tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.sku)}</td>
    <td>${escapeHtml(product.category)}</td><td class="align-right">${money(product.cost_cents)}</td>
    <td class="align-right"><strong>${money(product.price_cents)}</strong></td>
    <td>${product.stock} uds. <span style="color:#637a91">/ mín. ${product.min_stock}</span></td>
    <td>${productStockBadge(product)}</td>
    <td>${state.role === "admin" ? `<button class="row-action" data-edit-product="${escapeHtml(product.id)}">Editar</button>` : ""}</td></tr>`).join("") :
    '<tr><td colspan="8" class="empty-state">No se encontraron productos.</td></tr>';
  byId("products-count").textContent = `${filtered.length} de ${state.products.length} productos`;
  const categories = [...new Set(state.products.map(product => product.category))].sort((a, b) => a.localeCompare(b, "es"));
  const selected = byId("category-filter").value;
  byId("category-filter").innerHTML = '<option value="">Todas las categorías</option>' +
    categories.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  byId("category-filter").value = categories.includes(selected) ? selected : "";
  byId("category-options").innerHTML = categories.map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function renderProductOptions() {
  const available = state.products.filter(product => product.active);
  byId("sale-product").innerHTML = available.length
    ? available.map(product => `<option value="${escapeHtml(product.id)}" ${product.stock < 1 ? "disabled" : ""}>${escapeHtml(product.name)} · ${money(product.price_cents)} · ${product.stock} disp.</option>`).join("")
    : '<option value="">No hay productos activos</option>';
  byId("stock-product").innerHTML = state.products.length
    ? state.products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${product.stock} uds.</option>`).join("")
    : '<option value="">No hay productos</option>';
}

async function loadSales() {
  if (!state.authorization) return;
  const from = byId("sales-from").value;
  const to = byId("sales-to").value;
  const query = new URLSearchParams({ limit: "200" });
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  try {
    state.sales = await api(`/api/sales?${query}`);
    renderSales();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSales() {
  const sales = state.sales;
  byId("sales-table").innerHTML = sales.length ? sales.map(sale => `
    <tr><td><strong>${escapeHtml(sale.id.slice(0, 8).toUpperCase())}</strong></td>
    <td>${escapeHtml(sale.customer_name)}</td><td>${escapeHtml(sale.items || "—")}</td>
    <td>${escapeHtml(formatDate(sale.created_at))}</td><td class="align-right"><strong>${money(sale.total_cents)}</strong></td></tr>`).join("") :
    '<tr><td colspan="5" class="empty-state">No hay ventas en el periodo seleccionado.</td></tr>';
  byId("sales-count").textContent = `${sales.length} ventas`;
}

async function loadMovements() {
  if (!state.authorization) return;
  try {
    state.movements = await api("/api/stock?limit=200");
    byId("movements-table").innerHTML = state.movements.length ? state.movements.map(item => `
      <tr><td>${escapeHtml(formatDate(item.created_at))}</td><td><strong>${escapeHtml(item.product_name)}</strong><br><span style="color:#637a91">${escapeHtml(item.sku)}</span></td>
      <td><span class="${item.quantity_delta > 0 ? "stock-level" : ""}" style="${item.quantity_delta < 0 ? "color:#f07885" : ""}">${item.quantity_delta > 0 ? "+" : ""}${item.quantity_delta} uds.</span></td>
      <td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.reference || "—")}</td></tr>`).join("") :
      '<tr><td colspan="5" class="empty-state">Aún no hay movimientos de inventario.</td></tr>';
    byId("movements-count").textContent = `${state.movements.length} movimientos recientes`;
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadReport() {
  if (!state.authorization) return;
  const query = new URLSearchParams({ limit: "2000" });
  if (byId("report-from").value) query.set("from", byId("report-from").value);
  if (byId("report-to").value) query.set("to", byId("report-to").value);
  try {
    state.reportSales = await api(`/api/sales?${query}`);
    const revenue = state.reportSales.reduce((sum, sale) => sum + Number(sale.total_cents), 0);
    const grossProfit = state.reportSales.reduce((sum, sale) => sum + Number(sale.gross_profit_cents || 0), 0);
    const units = state.reportSales.reduce((sum, sale) => sum + Number(sale.units_sold || 0), 0);
    byId("report-metrics").innerHTML = [
      ["Ventas registradas", state.reportSales.length],
      ["Ingresos brutos", money(revenue)],
      ["Utilidad bruta estimada", money(grossProfit)],
      ["Unidades vendidas", units],
    ].map(([label, value]) => `<div class="report-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    byId("reports-table").innerHTML = state.reportSales.length ? state.reportSales.map(sale => `
      <tr><td>${escapeHtml(formatDate(sale.created_at))}</td><td>${escapeHtml(sale.customer_name)}</td>
        <td>${escapeHtml(sale.items || "—")}</td><td>${escapeHtml(sale.note || "—")}</td>
        <td class="align-right">${money(sale.gross_profit_cents)}</td>
      <td class="align-right"><strong>${money(sale.total_cents)}</strong></td></tr>`).join("") :
      '<tr><td colspan="6" class="empty-state">No hay ventas en el rango indicado.</td></tr>';
      byId("reports-count").textContent = `${state.reportSales.length} registros mostrados (máximo 2.000) · Utilidad calculada con el costo guardado al vender`;
  } catch (error) {
    toast(error.message, true);
  }
}

function openProductModal(product = null) {
  const form = byId("product-form");
  form.reset();
  showMessage("product-message");
  form.elements.id.value = product?.id || "";
  form.elements.name.value = product?.name || "";
  form.elements.sku.value = product?.sku || "";
  form.elements.category.value = product?.category || "";
  form.elements.cost.value = product ? (product.cost_cents / 100).toFixed(2) : "";
  form.elements.price.value = product ? (product.price_cents / 100).toFixed(2) : "";
  form.elements.min_stock.value = product?.min_stock ?? 0;
  form.elements.stock.value = product?.stock ?? 0;
  form.elements.active.checked = product ? Boolean(product.active) : true;
  form.elements.stock.disabled = Boolean(product);
  byId("initial-stock-field").classList.toggle("sr-only", Boolean(product));
  byId("product-modal-title").textContent = product ? "Editar producto" : "Añadir producto";
  byId("product-save").textContent = product ? "Guardar cambios" : "Guardar producto";
  byId("product-modal").showModal();
}

function openSaleModal() {
  state.cart.clear();
  byId("sale-form").reset();
  showMessage("sale-message");
  renderCart();
  byId("sale-modal").showModal();
}

function renderCart() {
  const items = [...state.cart.values()];
  byId("cart-list").innerHTML = items.length ? items.map(item => `
    <div class="cart-row">
      <span class="cart-product"><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} × ${money(item.price_cents)}</small></span>
      <span class="cart-line-total">${money(item.quantity * item.price_cents)}</span>
      <button class="cart-remove" type="button" data-remove-cart="${escapeHtml(item.id)}" aria-label="Quitar ${escapeHtml(item.name)}">×</button>
    </div>`).join("") : '<div class="empty-state">Añade productos para crear la venta.</div>';
  const total = items.reduce((sum, item) => sum + item.quantity * item.price_cents, 0);
  byId("sale-total").textContent = money(total);
  byId("sale-submit").disabled = items.length === 0;
}

async function submitProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const payload = {
    name: form.elements.name.value,
    sku: form.elements.sku.value,
    category: form.elements.category.value,
    cost: form.elements.cost.value,
    price: form.elements.price.value,
    min_stock: Number(form.elements.min_stock.value),
    stock: Number(form.elements.stock.value),
    active: form.elements.active.checked,
  };
  const button = byId("product-save");
  setBusy(button, true);
  showMessage("product-message");
  try {
    await api(id ? `/api/products/${encodeURIComponent(id)}` : "/api/products", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    byId("product-modal").close();
    toast(id ? "Producto actualizado." : "Producto añadido al catálogo.");
    await refreshAll();
  } catch (error) {
    showMessage("product-message", error.message);
  } finally {
    setBusy(button, false);
  }
}

async function submitSale(event) {
  event.preventDefault();
  const items = [...state.cart.values()].map(item => ({ product_id: item.id, quantity: item.quantity }));
  const form = event.currentTarget;
  const button = byId("sale-submit");
  const payload = {
    customer_name: form.elements.customer_name.value.trim(),
    note: form.elements.note.value.trim(),
    items,
  };
  setBusy(button, true, "Registrando...");
  showMessage("sale-message");
  try {
    await api("/api/sales", { method: "POST", body: JSON.stringify(payload) });
    byId("sale-modal").close();
    toast("Venta registrada y stock actualizado.");
    await refreshAll();
  } catch (error) {
    showMessage("sale-message", error.message);
  } finally {
    setBusy(button, false);
  }
}

async function submitStock(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  payload.quantity = Number(payload.quantity);
  const button = byId("stock-submit");
  setBusy(button, true);
  showMessage("stock-message");
  try {
    await api("/api/stock", { method: "POST", body: JSON.stringify(payload) });
    byId("stock-modal").close();
    toast("Movimiento registrado correctamente.");
    await refreshAll();
  } catch (error) {
    showMessage("stock-message", error.message);
  } finally {
    setBusy(button, false);
  }
}

function addCartItem() {
  const id = byId("sale-product").value;
  const product = state.products.find(item => item.id === id);
  const quantity = Number(byId("sale-quantity").value);
  if (!product || !Number.isSafeInteger(quantity) || quantity < 1) {
    showMessage("sale-message", "Selecciona un producto y una cantidad válida.");
    return;
  }
  const current = state.cart.get(id)?.quantity || 0;
  if (current + quantity > product.stock) {
    showMessage("sale-message", `Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
    return;
  }
  state.cart.set(id, { id, name: product.name, price_cents: product.price_cents, quantity: current + quantity });
  showMessage("sale-message");
  byId("sale-quantity").value = "1";
  renderCart();
}

function exportCsv() {
  const rows = [
    ["Fecha", "Cliente", "Productos", "Nota", "Utilidad bruta estimada", "Total"],
    ...state.reportSales.map(sale => [
      sale.created_at,
      sale.customer_name,
      sale.items,
      sale.note || "",
      (Number(sale.gross_profit_cents) / 100).toFixed(2),
      (Number(sale.total_cents) / 100).toFixed(2),
    ]),
  ];
  const csv = `\uFEFF${rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ryds-stock-ventas-${dateInputValue(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("click", event => {
  const viewLink = event.target.closest("[data-view]");
  const navigateLink = event.target.closest("[data-navigate]");
  const action = event.target.closest("[data-action]");
  const edit = event.target.closest("[data-edit-product]");
  const remove = event.target.closest("[data-remove-cart]");
  const close = event.target.closest("[data-close]");
  if (viewLink) switchView(viewLink.dataset.view);
  if (navigateLink) switchView(navigateLink.dataset.navigate);
  if (edit) openProductModal(state.products.find(item => item.id === edit.dataset.editProduct));
  if (remove) {
    state.cart.delete(remove.dataset.removeCart);
    renderCart();
  }
  if (close) byId(close.dataset.close).close();
  if (action?.dataset.action === "new-product") openProductModal();
  if (action?.dataset.action === "new-sale") openSaleModal();
  if (action?.dataset.action === "stock-adjust") {
    renderProductOptions();
    byId("stock-form").reset();
    showMessage("stock-message");
    byId("stock-modal").showModal();
  }
});

byId("login-form").addEventListener("submit", signIn);
byId("logout-button").addEventListener("click", signOut);
byId("product-form").addEventListener("submit", submitProduct);
byId("sale-form").addEventListener("submit", submitSale);
byId("stock-form").addEventListener("submit", submitStock);
byId("add-to-cart").addEventListener("click", addCartItem);
byId("mobile-menu").addEventListener("click", () => {
  const isOpen = byId("sidebar").classList.toggle("open");
  byId("mobile-menu").setAttribute("aria-expanded", String(isOpen));
});
byId("product-search").addEventListener("input", renderProducts);
byId("category-filter").addEventListener("change", renderProducts);
byId("status-filter").addEventListener("change", renderProducts);
byId("sales-filter").addEventListener("click", loadSales);
byId("report-filter").addEventListener("click", loadReport);
byId("export-csv").addEventListener("click", exportCsv);

document.querySelectorAll(".modal").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
});

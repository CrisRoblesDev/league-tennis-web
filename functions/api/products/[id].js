import { gRead, gWrite, requireAuth, jsonResponse, PRODUCT_CATEGORIES } from "../../_helpers.js";

function validImage(value) {
  return typeof value === "string" && value.trim().length <= 500 &&
    (/^\//.test(value.trim()) || /^https:\/\//i.test(value.trim()));
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.some(user => user.id === userId && user.role === "admin")) {
    return jsonResponse({ error: "No autorizado" }, 403);
  }
  const id = params.id;
  const products = await gRead(env, "products");
  const idx = products.findIndex(p => p.id === id);
  if (idx < 0) return jsonResponse({ error: "No encontrado" }, 404);
  let updates;
  try {
    updates = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return jsonResponse({ error: "Actualización inválida" }, 400);
  }
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || !updates.name.trim()) return jsonResponse({ error: "Nombre inválido" }, 400);
    products[idx].name = updates.name.trim();
  }
  if (updates.price !== undefined) {
    if (!Number.isSafeInteger(updates.price) || updates.price < 1) return jsonResponse({ error: "Precio inválido" }, 400);
    products[idx].price = updates.price;
  }
  if (updates.description !== undefined) {
    if (typeof updates.description !== "string") return jsonResponse({ error: "Descripción inválida" }, 400);
    products[idx].description = updates.description.trim();
  }
  if (updates.type !== undefined) {
    if (!["digital", "subscription"].includes(updates.type)) return jsonResponse({ error: "Tipo inválido" }, 400);
    products[idx].type = updates.type;
  }
  if (updates.category !== undefined) {
    if (typeof updates.category !== "string" || !PRODUCT_CATEGORIES.includes(updates.category)) {
      return jsonResponse({ error: "Categoría inválida" }, 400);
    }
    products[idx].category = updates.category;
  }
  if (updates.interval !== undefined) {
    if (!["month", "year"].includes(updates.interval)) return jsonResponse({ error: "Intervalo inválido" }, 400);
    products[idx].interval = updates.interval;
  }
  if (updates.active !== undefined) {
    if (typeof updates.active !== "boolean") return jsonResponse({ error: "Estado inválido" }, 400);
    products[idx].active = updates.active;
  }
  if (updates.image !== undefined) {
    if (!validImage(updates.image)) return jsonResponse({ error: "Imagen inválida" }, 400);
    products[idx].image = updates.image.trim() || null;
  }
  await gWrite(env, "products", products);
  return jsonResponse(products[idx]);
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.some(user => user.id === userId && user.role === "admin")) {
    return jsonResponse({ error: "No autorizado" }, 403);
  }
  const id = params.id;
  const products = await gRead(env, "products");
  const idx = products.findIndex(p => p.id === id);
  if (idx >= 0) products.splice(idx, 1);
  await gWrite(env, "products", products);
  return jsonResponse({ ok: true });
}

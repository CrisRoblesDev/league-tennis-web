import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const products = (await gRead(env, "products")).filter(p => p.active);
  return jsonResponse(products);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.some(user => user.id === userId && user.role === "admin")) {
    return jsonResponse({ error: "No autorizado" }, 403);
  }
  let b;
  try {
    b = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return jsonResponse({ error: "Producto inválido" }, 400);
  }
  if (typeof b.name !== "string" || !b.name.trim() || !Number.isSafeInteger(b.price) || b.price < 1 ||
      !["digital", "subscription"].includes(b.type || "digital")) {
    return jsonResponse({ error: "Nombre, precio entero positivo y tipo válido son requeridos" }, 400);
  }
  const products = await gRead(env, "products");
  const product = {
    id: `prod-${crypto.randomUUID()}`,
    name: b.name.trim(),
    price: b.price,
    type: b.type || "digital",
    description: typeof b.description === "string" ? b.description.trim() : "",
    active: b.active !== false,
    ...(b.type === "subscription" ? { interval: ["month", "year"].includes(b.interval) ? b.interval : "month" } : {})
  };
  products.push(product);
  await gWrite(env, "products", products);
  return jsonResponse(product);
}

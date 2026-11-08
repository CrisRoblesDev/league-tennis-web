import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  const orders = await gRead(env, "orders");
  return jsonResponse(orders.map(o => {
    const user = users.find(u => u.id === o.userId);
    return { ...o, userName: user?.name || "", userEmail: user?.email || "" };
  }).sort((a, b) => new Date(b.created) - new Date(a.created)));
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Solicitud JSON inválida" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.orderId !== "string") {
    return jsonResponse({ error: "Solicitud inválida" }, 400);
  }

  const orders = await gRead(env, "orders");
  const index = orders.findIndex(o => o.id === body.orderId);
  if (index < 0) return jsonResponse({ error: "Compra no encontrada" }, 404);

  if (body.status !== undefined && ["pending", "paid", "cancelled", "refunded"].includes(body.status)) {
    orders[index].status = body.status;
  }
  if (body.productName !== undefined && typeof body.productName === "string" && body.productName.trim()) {
    orders[index].productName = body.productName.trim();
  }
  if (typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount >= 0) {
    orders[index].amount = Math.round(body.amount * 100);
  }

  await gWrite(env, "orders", orders);
  const user = users.find(u => u.id === orders[index].userId);
  return jsonResponse({ ...orders[index], userName: user?.name || "", userEmail: user?.email || "" });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Solicitud JSON inválida" }, 400); }
  if (!body || typeof body.orderId !== "string") {
    return jsonResponse({ error: "Solicitud inválida" }, 400);
  }

  const orders = await gRead(env, "orders");
  const index = orders.findIndex(o => o.id === body.orderId);
  if (index < 0) return jsonResponse({ error: "Compra no encontrada" }, 404);
  orders.splice(index, 1);
  await gWrite(env, "orders", orders);
  return jsonResponse({ ok: true });
}

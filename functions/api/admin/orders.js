import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

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

import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const orders = (await gRead(env, "orders")).filter(o => o.userId === userId);
  return jsonResponse(orders.sort((a, b) => new Date(b.created) - new Date(a.created)));
}

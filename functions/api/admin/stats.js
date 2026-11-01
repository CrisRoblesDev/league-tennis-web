import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  const players = await gRead(env, "players");
  const orders = await gRead(env, "orders");
  const subs = await gRead(env, "subscriptions");
  return jsonResponse({
    totalUsers: users.length, totalPlayers: players.length, totalOrders: orders.length,
    revenue: orders.reduce((s, o) => s + (o.amount || 0), 0),
    activeSubscriptions: subs.filter(s => s.status === "active").length
  });
}

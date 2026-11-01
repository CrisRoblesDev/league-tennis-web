import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const players = (await gRead(env, "players")).sort((a, b) => b.points - a.points);
  return jsonResponse({ players: players.slice(0, 16), total: players.length });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const players = await gRead(env, "players");
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  if (players.find(p => p.userId === userId)) return jsonResponse({ ok: true, message: "Ya inscrito" });
  players.push({ id: "player-" + Date.now(), userId, name: user.name, level: user.level || "3.0", zone: user.zone || "Aventura / Sunny Isles", matches: 0, points: 0, created: new Date().toISOString() });
  await gWrite(env, "players", players);
  return jsonResponse({ ok: true });
}

import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  return jsonResponse((await gRead(env, "players")).sort((a, b) => b.points - a.points));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const b = await request.json();
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  const players = await gRead(env, "players");
  if (players.find(p => p.userId === userId)) return jsonResponse({ error: "Ya tienes perfil" }, 400);
  players.push({ id: "player-" + Date.now(), userId, name: b.name || user.name, level: b.level || user.level || "3.0", zone: b.zone || user.zone || "Aventura / Sunny Isles", matches: 0, points: 0, created: new Date().toISOString() });
  await gWrite(env, "players", players);
  return jsonResponse(players[players.length - 1]);
}

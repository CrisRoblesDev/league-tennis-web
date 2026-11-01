import { gRead, gWrite, rankPlayers, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const [players, results] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "challenges")
  ]);
  return jsonResponse(rankPlayers(players, results));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  let b;
  try {
    b = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return jsonResponse({ error: "Perfil inválido" }, 400);
  }
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  const players = await gRead(env, "players");
  if (players.find(p => p.userId === userId)) return jsonResponse({ error: "Ya tienes perfil" }, 400);
  if (!user) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  const levels = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
  const zones = ["Aventura / Sunny Isles", "North Miami / Miami Gardens", "Downtown / Brickell", "Kendall / Doral"];
  if ((b.level && !levels.includes(b.level)) || (b.zone && !zones.includes(b.zone))) {
    return jsonResponse({ error: "Nivel o zona inválidos" }, 400);
  }
  players.push({
    id: `player-${crypto.randomUUID()}`,
    userId,
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 100) : user.name,
    level: b.level || user.level || "3.0",
    zone: b.zone || user.zone || "Aventura / Sunny Isles",
    matches: 0,
    points: 0,
    created: new Date().toISOString()
  });
  await gWrite(env, "players", players);
  return jsonResponse(players[players.length - 1]);
}

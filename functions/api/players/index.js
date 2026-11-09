import { gRead, gWrite, buildRanking, requireAuth, jsonResponse, MATCH_CATEGORIES, MODALITIES } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  let scope = "all";
  try {
    scope = new URL(request.url).searchParams.get("ranking") || "all";
  } catch {
    scope = "all";
  }
  const [players, results, tournaments] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "challenges"),
    gRead(env, "tournaments")
  ]);
  const tournamentId = scope && scope !== "all" ? scope.slice(0, 120) : "";
  return jsonResponse(buildRanking(players, results, tournaments, tournamentId));
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
  const category = MATCH_CATEGORIES.includes(b.category) ? b.category : "singles";
  const gender = MODALITIES.includes(b.gender) ? b.gender : "hombres";
  const photoUrl = typeof b.photoUrl === "string" && b.photoUrl.trim() ? b.photoUrl.trim() : null;
  players.push({
    id: `player-${crypto.randomUUID()}`,
    userId,
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 100) : user.name,
    level: b.level || user.level || "3.0",
    zone: b.zone || user.zone || "Aventura / Sunny Isles",
    category,
    gender,
    country: typeof b.country === "string" ? b.country.trim() : null,
    bio: typeof b.bio === "string" ? b.bio.trim().slice(0, 300) : null,
    photo: photoUrl,
    matches: 0,
    points: 0,
    created: new Date().toISOString()
  });
  await gWrite(env, "players", players);
  return jsonResponse(players[players.length - 1]);
}

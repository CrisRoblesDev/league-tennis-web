import { gRead, gWrite, requireAuth, jsonResponse, MATCH_CATEGORIES, MODALITIES } from "../../_helpers.js";

export async function onRequestPatch({ request, env, params }) {
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);

  const playerId = params.id;
  if (!playerId) return jsonResponse({ error: "ID de jugador requerido" }, 400);

  let b;
  try {
    b = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return jsonResponse({ error: "Datos inválidos" }, 400);
  }

  const players = await gRead(env, "players");
  const idx = players.findIndex(p => p.id === playerId);
  if (idx < 0) return jsonResponse({ error: "Jugador no encontrado" }, 404);
  if (players[idx].userId !== userId) return jsonResponse({ error: "No puedes editar este perfil" }, 403);

  const player = players[idx];
  if (typeof b.name === "string" && b.name.trim()) player.name = b.name.trim().slice(0, 100);
  const validLevels = ["2.5","3.0","3.5","4.0","4.5","5.0"];
  if (b.level && validLevels.includes(b.level)) player.level = b.level;
  const validZones = ["Aventura / Sunny Isles","North Miami / Miami Gardens","Downtown / Brickell","Kendall / Doral"];
  if (b.zone && validZones.includes(b.zone)) player.zone = b.zone;
  if (MATCH_CATEGORIES.includes(b.category)) player.category = b.category;
  if (MODALITIES.includes(b.gender)) player.gender = b.gender;
  if (typeof b.country === "string") player.country = b.country.trim() || null;
  if (typeof b.bio === "string") player.bio = b.bio.trim().slice(0, 300) || null;
  if (typeof b.photoUrl === "string") player.photo = b.photoUrl.trim() || null;

  await gWrite(env, "players", players);
  return jsonResponse(player);
}

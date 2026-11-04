import { gRead, gWrite, rankPlayers, requireAdmin, jsonResponse, MATCH_CATEGORIES, MODALITIES } from "../../_helpers.js";

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const ZONES = [
  "Aventura / Sunny Isles",
  "North Miami / Miami Gardens",
  "Downtown / Brickell",
  "Kendall / Doral"
];

async function authorize(request, env) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return { response: jsonResponse({ error: "No autenticado" }, 401) };
  if (!user) return { response: jsonResponse({ error: "No autorizado" }, 403) };
  return { userId };
}

export async function onRequestGet({ request, env }) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;
  const [players, users, results] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "users"),
    gRead(env, "challenges")
  ]);
  const userById = new Map(users.map(user => [user.id, user]));
  return jsonResponse(rankPlayers(players, results).map(player => ({
    ...player,
    email: userById.get(player.userId)?.email || ""
  })));
}

export async function onRequestPost({ request, env }) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.userId !== "string" || typeof body.name !== "string" ||
      !body.name.trim() || body.name.trim().length > 100 ||
      !LEVELS.includes(body.level) || !ZONES.includes(body.zone)) {
    return jsonResponse({ error: "Cuenta, nombre, nivel y zona válidos son requeridos." }, 400);
  }
  const [players, users] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "users")
  ]);
  if (!users.some(user => user.id === body.userId)) {
    return jsonResponse({ error: "Cuenta de usuario no encontrada" }, 404);
  }
  if (players.some(player => player.userId === body.userId)) {
    return jsonResponse({ error: "Esta cuenta ya tiene un perfil de jugador." }, 409);
  }
  const player = {
    id: `player-${crypto.randomUUID()}`,
    userId: body.userId,
    name: body.name.trim(),
    level: body.level,
    zone: body.zone,
    category: MATCH_CATEGORIES.includes(body.category) ? body.category : "singles",
    gender: MODALITIES.includes(body.gender) ? body.gender : "hombres",
    matches: 0,
    points: 0,
    created: new Date().toISOString()
  };
  players.push(player);
  await gWrite(env, "players", players);
  return jsonResponse({ ok: true, player }, 201);
}

export async function onRequestPatch({ request, env }) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.playerId !== "string" ||
      !body.updates || typeof body.updates !== "object" || Array.isArray(body.updates)) {
    return jsonResponse({ error: "Actualización de jugador inválida" }, 400);
  }

  const [players, users] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "users")
  ]);
  const player = players.find(item => item.id === body.playerId);
  if (!player) return jsonResponse({ error: "Jugador no encontrado" }, 404);
  const updates = body.updates;
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || !updates.name.trim() || updates.name.trim().length > 100) {
      return jsonResponse({ error: "El nombre debe tener entre 1 y 100 caracteres." }, 400);
    }
    player.name = updates.name.trim();
  }
  if (updates.level !== undefined) {
    if (!LEVELS.includes(updates.level)) return jsonResponse({ error: "Nivel inválido." }, 400);
    player.level = updates.level;
  }
  if (updates.zone !== undefined) {
    if (!ZONES.includes(updates.zone)) return jsonResponse({ error: "Zona inválida." }, 400);
    player.zone = updates.zone;
  }
  if (updates.category !== undefined) {
    if (!MATCH_CATEGORIES.includes(updates.category)) return jsonResponse({ error: "Categoría inválida." }, 400);
    player.category = updates.category;
  }
  if (updates.gender !== undefined) {
    if (!MODALITIES.includes(updates.gender)) return jsonResponse({ error: "Modalidad inválida." }, 400);
    player.gender = updates.gender;
  }
  if (updates.manualPoints !== undefined) {
    const manualPoints = Number(updates.manualPoints);
    if (!Number.isInteger(manualPoints) || manualPoints < 0 || manualPoints > 1000000) {
      return jsonResponse({ error: "Los puntos manuales deben ser un entero entre 0 y 1.000.000." }, 400);
    }
    player.manualPoints = manualPoints;
  }
  const user = users.find(item => item.id === player.userId);
  if (user) {
    user.level = player.level;
    user.zone = player.zone;
  }
  await gWrite(env, "players", players);
  if (user) await gWrite(env, "users", users);
  return jsonResponse({ ok: true, player });
}

export async function onRequestDelete({ request, env }) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body.playerId !== "string") {
    return jsonResponse({ error: "Jugador inválido" }, 400);
  }

  const [players, tournaments, results, challenges] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "tournaments"),
    gRead(env, "challenges"),
    gRead(env, "leagueChallenges")
  ]);
  const index = players.findIndex(player => player.id === body.playerId);
  if (index < 0) return jsonResponse({ error: "Jugador no encontrado" }, 404);
  const referencedInTournament = tournaments.some(tournament =>
    (tournament.entries || []).some(entry => entry.playerId === body.playerId) ||
    (tournament.matches || []).some(match =>
      [match.playerAId, match.playerBId, match.winnerId].includes(body.playerId)
    )
  );
  const referencedInResult = results.some(result =>
    [result.winnerId, result.loserId].includes(body.playerId)
  );
  const referencedInChallenge = challenges.some(challenge =>
    [challenge.playerId, challenge.acceptedPlayerId].includes(body.playerId)
  );
  if (referencedInTournament || referencedInResult || referencedInChallenge) {
    return jsonResponse({
      error: "No se puede eliminar: el perfil tiene historial en torneos, partidos o desafíos. Actualiza el perfil o conserva el registro."
    }, 409);
  }

  players.splice(index, 1);
  await gWrite(env, "players", players);
  return jsonResponse({ ok: true });
}

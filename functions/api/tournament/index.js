import { gRead, gWrite, rankPlayers, requireAuth, jsonResponse } from "../../_helpers.js";

function isMonthlyTournament(item) {
  return Boolean(item && String(item.id || "").startsWith("monthly-"));
}

export async function onRequestGet(context) {
  const { env } = context;
  const [players, results, tournaments] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "challenges"),
    gRead(env, "tournaments")
  ]);
  const rankedPlayers = rankPlayers(players, results);
  const month = new Date().toISOString().slice(0, 7);
  const playerById = new Map(players.map(player => [player.id, player]));
  const publicTournaments = tournaments
    .filter(item => !isMonthlyTournament(item))
    .map(item => ({
      ...item,
      entries: (item.entries || []).map(entry => ({
        playerId: entry.playerId,
        userId: entry.userId || null,
        name: playerById.get(entry.playerId)?.name || "Jugador",
        level: playerById.get(entry.playerId)?.level || ""
      })),
      matches: (item.matches || []).map(match => ({
        ...match,
        playerAName: playerById.get(match.playerAId)?.name || "Por definir",
        playerBName: playerById.get(match.playerBId)?.name || "Por definir",
        winnerName: playerById.get(match.winnerId)?.name || null
      }))
    }))
    .sort((left, right) => right.month.localeCompare(left.month));
  return jsonResponse({
    players: rankedPlayers.slice(0, 16),
    total: rankedPlayers.length,
    tournament: publicTournaments.find(item => ["registration", "scheduled", "in_progress"].includes(item.status)) || null,
    tournaments: publicTournaments
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para retirarte del torneo" }, 401);

  const [players, tournaments] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "tournaments")
  ]);
  const player = players.find(item => item.userId === userId);
  if (!player) return jsonResponse({ error: "No tienes perfil de jugador" }, 400);

  const requestedId = new URL(request.url).searchParams.get("tournamentId");
  const month = new Date().toISOString().slice(0, 7);
  const tournament = requestedId
    ? tournaments.find(item => item.id === requestedId)
    : tournaments.find(item => item.month === month);
  if (!tournament) return jsonResponse({ error: "No hay torneo abierto este mes" }, 404);
  if (tournament.status !== "registration") {
    return jsonResponse({ error: "Las inscripciones de este torneo ya están cerradas" }, 409);
  }
  const entries = tournament.entries || [];
  if (!entries.some(entry => entry.userId === userId || entry.playerId === player.id)) {
    return jsonResponse({ error: "No estás inscrito en este torneo" }, 404);
  }
  if ((tournament.matches || []).some(match =>
    [match.playerAId, match.playerBId].includes(player.id)
  )) {
    return jsonResponse({ error: "Ya tienes partidos en el cuadro; pide al administrador que te retire." }, 409);
  }

  tournament.entries = entries.filter(entry => entry.userId !== userId && entry.playerId !== player.id);
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ ok: true, message: "Te retiraste del torneo" });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const [players, users, tournaments] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "users"),
    gRead(env, "tournaments")
  ]);
  const user = users.find(u => u.id === userId);
  if (!user) return jsonResponse({ error: "Usuario no encontrado" }, 404);

  let player = players.find(item => item.userId === userId);
  if (!player) {
    player = {
      id: `player-${crypto.randomUUID()}`,
      userId,
      name: user.name,
      level: user.level || "3.0",
      zone: user.zone || "Aventura / Sunny Isles",
      matches: 0,
      points: 0,
      created: new Date().toISOString()
    };
    players.push(player);
    await gWrite(env, "players", players);
  }

  let body = {};
  try { body = await request.json(); } catch { /* backward-compatible empty body */ }
  const requestedId = typeof body.tournamentId === "string" ? body.tournamentId : "";
  const month = new Date().toISOString().slice(0, 7);
  let tournament = requestedId
    ? tournaments.find(item => item.id === requestedId)
    : tournaments.find(item => item.month === month && !isMonthlyTournament(item));
  if (!tournament) {
    return jsonResponse({ error: "No hay torneo disponible para este mes" }, 404);
  }
  if (tournament.status !== "registration") {
    return jsonResponse({ error: "Las inscripciones para este torneo ya están cerradas" }, 409);
  }
  if ((tournament.entries || []).some(entry => entry.userId === userId || entry.playerId === player.id)) {
    return jsonResponse({ ok: true, message: `Ya estás inscrito en ${tournament.title || month}` });
  }
  if (Number.isInteger(tournament.maxParticipants) && tournament.maxParticipants > 0 &&
      (tournament.entries || []).length >= tournament.maxParticipants) {
    return jsonResponse({ error: "El torneo ya completó todos sus cupos." }, 409);
  }
  if (Array.isArray(tournament.levels) && tournament.levels.length && !tournament.levels.includes(player.level)) {
    return jsonResponse({ error: `Este torneo no tiene categoría abierta para nivel ${player.level}` }, 409);
  }
  tournament.entries.push({ userId, playerId: player.id, created: new Date().toISOString() });
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ ok: true, message: `Inscripción confirmada para ${tournament.title || month}`, remainingSlots: Number.isInteger(tournament.maxParticipants) ? Math.max(0, tournament.maxParticipants - tournament.entries.length) : null });
}

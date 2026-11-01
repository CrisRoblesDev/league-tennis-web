import { gRead, gWrite, rankPlayers, requireAuth, jsonResponse } from "../../_helpers.js";

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
    .map(item => ({
      ...item,
      entries: (item.entries || []).map(entry => ({
        playerId: entry.playerId,
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
    tournament: publicTournaments.find(item => item.month === month) || null,
    tournaments: publicTournaments
  });
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

  const month = new Date().toISOString().slice(0, 7);
  let tournament = tournaments.find(item => item.month === month);
  if (!tournament) {
    tournament = {
      id: `monthly-${month}`,
      title: `Campeonato mensual · ${month}`,
      month,
      description: "Inscripción abierta para jugadores de League Tennis Aventura.",
      levels: ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"],
      startDate: "",
      endDate: "",
      venue: "",
      format: "Eliminación directa · Best of 3",
      status: "registration",
      entries: [],
      matches: [],
      created: new Date().toISOString()
    };
    tournaments.push(tournament);
  }
  if (tournament.status !== "registration") {
    return jsonResponse({ error: "Las inscripciones para este torneo ya están cerradas" }, 409);
  }
  if (Array.isArray(tournament.levels) && tournament.levels.length && !tournament.levels.includes(player.level)) {
    return jsonResponse({ error: `Este torneo no tiene categoría abierta para nivel ${player.level}` }, 409);
  }
  if (tournament.entries.some(entry => entry.userId === userId)) {
    return jsonResponse({ ok: true, message: "Ya estás inscrito en el torneo de este mes" });
  }
  tournament.entries.push({ userId, playerId: player.id, created: new Date().toISOString() });
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ ok: true, message: `Inscripción confirmada para ${month}` });
}

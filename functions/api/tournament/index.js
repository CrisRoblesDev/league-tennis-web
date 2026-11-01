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
  return jsonResponse({
    players: rankedPlayers.slice(0, 16),
    total: rankedPlayers.length,
    tournament: tournaments.find(item => item.month === month) || null
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
      month,
      status: "registration",
      entries: [],
      created: new Date().toISOString()
    };
    tournaments.push(tournament);
  }
  if (tournament.status !== "registration") {
    return jsonResponse({ error: "Las inscripciones para este torneo ya están cerradas" }, 409);
  }
  if (tournament.entries.some(entry => entry.userId === userId)) {
    return jsonResponse({ ok: true, message: "Ya estás inscrito en el torneo de este mes" });
  }
  tournament.entries.push({ userId, playerId: player.id, created: new Date().toISOString() });
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ ok: true, message: `Inscripción confirmada para ${month}` });
}

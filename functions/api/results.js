import { gRead, gWrite, requireAuth, validateMatchScore, jsonResponse, MATCH_CATEGORIES, awardRankingPoint } from "../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const [results, players] = await Promise.all([
    gRead(env, "challenges"),
    gRead(env, "players")
  ]);
  const names = new Map(players.map(player => [player.id, player.name]));
  const owners = new Map(players.map(player => [player.id, player.userId]));
  return jsonResponse(results
    .map(result => ({
      ...result,
      winnerName: names.get(result.winnerId) || "Jugador",
      loserName: names.get(result.loserId) || "Jugador",
      winnerUserId: owners.get(result.winnerId),
      loserUserId: owners.get(result.loserId)
    }))
    .sort((left, right) => new Date(right.created) - new Date(left.created)));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para registrar un resultado" }, 401);

  // Los administradores pueden registrar resultados de cualquier partido;
  // los usuarios comunes solo pueden registrar los suyos propios.
  const users = await gRead(env, "users");
  const isAdmin = users.some(u => u.id === userId && u.role === "admin");

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Resultado inválido" }, 400);
  }
  const score = typeof body.score === "string" ? body.score.trim() : "";
  const scoreResult = validateMatchScore(score);
  if (typeof body.winnerId !== "string" || typeof body.loserId !== "string" ||
      body.winnerId === body.loserId || !scoreResult) {
    return jsonResponse({ error: "Ingresa un marcador válido al mejor de 3 sets (por ejemplo 6-4, 4-6, 10-7)." }, 400);
  }

  const [players, results] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "challenges")
  ]);
  const winner = players.find(player => player.id === body.winnerId);
  const loser = players.find(player => player.id === body.loserId);
  if (!winner || !loser) return jsonResponse({ error: "Jugador no encontrado" }, 404);
  if (scoreResult.winnerIndex !== 0) {
    return jsonResponse({ error: "El ganador seleccionado debe coincidir con el marcador ingresado." }, 400);
  }
  if (!isAdmin && ![winner.userId, loser.userId].includes(userId)) {
    return jsonResponse({ error: "Solo los participantes pueden registrar este resultado" }, 403);
  }
  if (results.some(result =>
    result.status === "pending" &&
    [result.winnerId, result.loserId].includes(winner.id) &&
    [result.winnerId, result.loserId].includes(loser.id)
  )) {
    return jsonResponse({ error: "Ya existe un resultado pendiente entre estos jugadores" }, 409);
  }

  const result = {
    id: `result-${crypto.randomUUID()}`,
    winnerId: winner.id,
    loserId: loser.id,
    category: MATCH_CATEGORIES.includes(body.category) ? body.category : (winner.category || "singles"),
    tournamentId: typeof body.tournamentId === "string" ? body.tournamentId : null,
    matchId: typeof body.matchId === "string" ? body.matchId : null,
    score,
    playedAt: typeof body.playedAt === "string" ? body.playedAt : new Date().toISOString(),
    reportedBy: userId,
    status: "pending",
    created: new Date().toISOString()
  };
  results.push(result);
  await gWrite(env, "challenges", results);
  return jsonResponse({ ok: true, result }, 201);
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para responder al resultado" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Respuesta de resultado inválida" }, 400);
  }
  if (typeof body.resultId !== "string" || !["confirm", "dispute"].includes(body.action)) {
    return jsonResponse({ error: "Respuesta de resultado inválida" }, 400);
  }

  const [results, players] = await Promise.all([
    gRead(env, "challenges"),
    gRead(env, "players")
  ]);
  const result = results.find(item => item.id === body.resultId);
  if (!result) return jsonResponse({ error: "Resultado no encontrado" }, 404);
  if (result.status !== "pending") return jsonResponse({ error: "Este resultado ya fue procesado" }, 409);

  const winner = players.find(player => player.id === result.winnerId);
  const loser = players.find(player => player.id === result.loserId);
  if (!winner || !loser) return jsonResponse({ error: "No se encontraron ambos jugadores" }, 409);
  const respondingPlayer = [winner, loser].find(player => player.userId === userId);
  if (!respondingPlayer || result.reportedBy === userId) {
    return jsonResponse({ error: "Solo el rival que no informó el resultado puede responder" }, 403);
  }

  result.status = body.action === "confirm" ? "confirmed" : "disputed";
  result.respondedBy = userId;
  result.respondedAt = new Date().toISOString();
  await gWrite(env, "challenges", results);
  if (result.status === "confirmed") {
    await awardRankingPoint(env, result);
    // Sincronizar el partido del torneo (main draw) si el resultado lo referencia.
    if (result.matchId && result.tournamentId) {
      try {
        const players = await gRead(env, "players");
        const byUserId = new Map(players.map(p => [p.userId, p]));
        // Referencia (main draw): tournaments-reference
        for (const key of ["tournamentsReference", "tournaments"]) {
          const list = await gRead(env, key);
          if (!Array.isArray(list)) continue;
          const tIndex = list.findIndex(t => t && t.id === result.tournamentId);
          if (tIndex < 0) continue;
          const tournament = list[tIndex];
          const match = (tournament.matches || []).find(m => m && m.id === result.matchId);
          if (!match) continue;
          const playerA = byUserId.get(match.a) || players.find(p => p.id === match.playerAId);
          const playerB = byUserId.get(match.b) || players.find(p => p.id === match.playerBId);
          if (!playerA || !playerB) continue; // sin perfiles no se puede mapear el lado
          const aIsWinner = playerA.id === result.winnerId;
          const sets = String(result.score || "").split(",").map(s => s.trim()).filter(Boolean);
          let sa = 0, sb = 0;
          for (const set of sets) {
            const m = set.match(/^(\d{1,2})-(\d{1,2})/);
            if (!m) continue;
            const x = Number(m[1]), y = Number(m[2]);
            if (x === y) continue;
            if (aIsWinner) { if (x > y) sa++; else sb++; }
            else { if (y > x) sa++; else sb++; }
          }
          if (sa + sb > 0) {
            match.sa = sa;
            match.sb = sb;
            match.score = result.score;
            tournament.updated = new Date().toISOString();
            await gWrite(env, key, list);
          }
          break;
        }
      } catch { /* no bloquear la confirmación */ }
    }
  }
  return jsonResponse({ ok: true, status: result.status });
}

export async function onRequestDelete({ request, env }) {
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body.resultId !== "string") {
    return jsonResponse({ error: "Resultado inválido" }, 400);
  }

  const [results] = await Promise.all([
    gRead(env, "challenges"),
    gRead(env, "players")
  ]);
  const result = results.find(item => item.id === body.resultId);
  if (!result) return jsonResponse({ error: "Resultado no encontrado" }, 404);
  if (result.reportedBy !== userId || result.status !== "pending") {
    return jsonResponse({ error: "Solo puedes eliminar tus propios resultados pendientes" }, 403);
  }

  const index = results.findIndex(item => item.id === body.resultId);
  results.splice(index, 1);
  await gWrite(env, "challenges", results);
  return jsonResponse({ ok: true });
}

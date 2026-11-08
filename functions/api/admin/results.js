import { gRead, gWrite, requireAdmin, validateMatchScore, jsonResponse, awardRankingPoint } from "../../_helpers.js";

export async function onRequestPatch({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.resultId !== "string" || !["confirm", "dispute", "reject", "edit"].includes(body.action)) {
    return jsonResponse({ error: "Acción de moderación inválida" }, 400);
  }

  const [results, players] = await Promise.all([
    gRead(env, "challenges"),
    gRead(env, "players")
  ]);
  const result = results.find(item => item.id === body.resultId);
  if (!result) return jsonResponse({ error: "Resultado no encontrado" }, 404);
  if (body.action === "edit") {
    const winner = players.find(player => player.id === body.winnerId);
    const loser = players.find(player => player.id === body.loserId);
    const score = typeof body.score === "string" ? body.score.trim() : "";
    const parsedScore = validateMatchScore(score);
    if (!winner || !loser || winner.id === loser.id || !parsedScore || parsedScore.winnerIndex !== 0) {
      return jsonResponse({ error: "Verifica los jugadores y el marcador válido al mejor de 3 sets." }, 400);
    }
    result.winnerId = winner.id;
    result.loserId = loser.id;
    result.category = body.category || result.category || "singles";
    result.tournamentId = body.tournamentId !== undefined ? body.tournamentId : result.tournamentId;
    result.matchId = body.matchId !== undefined ? body.matchId : result.matchId;
    result.score = score;
    if (body.playedAt !== undefined) {
      if (typeof body.playedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.playedAt) ||
          new Date(`${body.playedAt}T00:00:00Z`).toISOString().slice(0, 10) !== body.playedAt) {
        return jsonResponse({ error: "Fecha del partido inválida." }, 400);
      }
      result.playedAt = body.playedAt;
    }
    result.status = "pending";
    result.reportedBy = userId;
    result.respondedBy = null;
    result.respondedAt = null;
    result.moderatedBy = userId;
    result.moderatedAt = new Date().toISOString();
    await gWrite(env, "challenges", results);
    return jsonResponse({ ok: true, status: result.status });
  }
  if (!["pending", "disputed"].includes(result.status)) {
    return jsonResponse({ error: "Este resultado ya no requiere moderación" }, 409);
  }

  result.status = body.action === "confirm" ? "confirmed" :
    body.action === "dispute" ? "disputed" : "rejected";
  result.moderatedBy = userId;
  result.moderatedAt = new Date().toISOString();
  await gWrite(env, "challenges", results);
  if (result.status === "confirmed") {
    await awardRankingPoint(env, result);
  }
  return jsonResponse({ ok: true, status: result.status });
}

export async function onRequestDelete({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body.resultId !== "string") {
    return jsonResponse({ error: "Resultado inválido" }, 400);
  }
  const results = await gRead(env, "challenges");
  const index = results.findIndex(item => item.id === body.resultId);
  if (index < 0) return jsonResponse({ error: "Resultado no encontrado" }, 404);
  results.splice(index, 1);
  await gWrite(env, "challenges", results);
  return jsonResponse({ ok: true });
}

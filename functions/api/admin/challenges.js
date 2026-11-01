import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

export async function onRequestGet({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const [challenges, players] = await Promise.all([
    gRead(env, "leagueChallenges"),
    gRead(env, "players")
  ]);
  const playerById = new Map(players.map(player => [player.id, player]));
  return jsonResponse(challenges.map(challenge => ({
    ...challenge,
    playerName: playerById.get(challenge.playerId)?.name || "Jugador",
    acceptedPlayerName: playerById.get(challenge.acceptedPlayerId)?.name || ""
  })).sort((left, right) => new Date(right.created) - new Date(left.created)));
}

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
  if (!body || typeof body.challengeId !== "string" ||
      !["open", "accepted", "closed"].includes(body.status)) {
    return jsonResponse({ error: "Estado de desafío inválido" }, 400);
  }
  const challenges = await gRead(env, "leagueChallenges");
  const challenge = challenges.find(item => item.id === body.challengeId);
  if (!challenge) return jsonResponse({ error: "Desafío no encontrado" }, 404);
  challenge.status = body.status;
  challenge.updated = new Date().toISOString();
  await gWrite(env, "leagueChallenges", challenges);
  return jsonResponse({ ok: true, status: challenge.status });
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
  if (!body || typeof body.challengeId !== "string") {
    return jsonResponse({ error: "Desafío inválido" }, 400);
  }
  const challenges = await gRead(env, "leagueChallenges");
  const index = challenges.findIndex(challenge => challenge.id === body.challengeId);
  if (index < 0) return jsonResponse({ error: "Desafío no encontrado" }, 404);
  challenges.splice(index, 1);
  await gWrite(env, "leagueChallenges", challenges);
  return jsonResponse({ ok: true });
}

import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const [challenges, players] = await Promise.all([
    gRead(env, "leagueChallenges"),
    gRead(env, "players")
  ]);
  const playerById = new Map(players.map(player => [player.id, player]));
  return jsonResponse(challenges
    .filter(challenge => challenge.status === "open" || challenge.status === "accepted")
    .map(challenge => ({
      ...challenge,
      creatorName: playerById.get(challenge.playerId)?.name || "Jugador",
      level: playerById.get(challenge.playerId)?.level || "",
      zone: playerById.get(challenge.playerId)?.zone || ""
    }))
    .sort((left, right) => new Date(right.created) - new Date(left.created)));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para publicar un desafío" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Desafío inválido" }, 400);
  }
  const availability = typeof body.availability === "string" ? body.availability.trim() : "";
  if (!availability || availability.length > 200) {
    return jsonResponse({ error: "Indica tu disponibilidad (máximo 200 caracteres)" }, 400);
  }

  const [players, challenges] = await Promise.all([
    gRead(env, "players"),
    gRead(env, "leagueChallenges")
  ]);
  const player = players.find(item => item.userId === userId);
  if (!player) return jsonResponse({ error: "Crea tu perfil de jugador antes de publicar un desafío" }, 400);
  if (challenges.some(item => item.playerId === player.id && item.status === "open")) {
    return jsonResponse({ error: "Ya tienes un desafío abierto" }, 409);
  }

  const challenge = {
    id: `challenge-${crypto.randomUUID()}`,
    playerId: player.id,
    creatorUserId: userId,
    availability,
    status: "open",
    created: new Date().toISOString()
  };
  challenges.push(challenge);
  await gWrite(env, "leagueChallenges", challenges);
  return jsonResponse({ ok: true, challenge }, 201);
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para aceptar un desafío" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Desafío inválido" }, 400);
  }
  if (typeof body.challengeId !== "string") {
    return jsonResponse({ error: "Desafío inválido" }, 400);
  }

  const challenges = await gRead(env, "leagueChallenges");
  const challenge = challenges.find(item => item.id === body.challengeId);
  if (!challenge) return jsonResponse({ error: "Desafío no encontrado" }, 404);
  if (challenge.status !== "open") return jsonResponse({ error: "El desafío ya no está disponible" }, 409);
  if (challenge.creatorUserId === userId) return jsonResponse({ error: "No puedes aceptar tu propio desafío" }, 403);

  const players = await gRead(env, "players");
  const acceptingPlayer = players.find(item => item.userId === userId);
  if (!acceptingPlayer) return jsonResponse({ error: "Crea tu perfil de jugador antes de aceptar un desafío" }, 400);
  challenge.status = "accepted";
  challenge.acceptedBy = userId;
  challenge.acceptedPlayerId = acceptingPlayer.id;
  challenge.acceptedAt = new Date().toISOString();
  await gWrite(env, "leagueChallenges", challenges);
  return jsonResponse({ ok: true, status: challenge.status });
}

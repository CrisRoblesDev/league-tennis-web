import { gRead, gWrite, requireAuth, jsonResponse } from "../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const b = await request.json();
  const players = await gRead(env, "players");
  const challenger = players.find(p => p.userId === userId);
  if (!challenger) return jsonResponse({ error: "No tienes perfil" }, 400);
  const winner = b.winnerId === challenger.id ? challenger : players.find(p => p.id === b.winnerId);
  if (winner) { winner.points = (winner.points || 0) + 100; winner.matches = (winner.matches || 0) + 1; }
  const loser = winner === challenger ? players.find(p => p.id === b.opponentId) : challenger;
  if (loser) loser.matches = (loser.matches || 0) + 1;
  await gWrite(env, "players", players);
  const ch = await gRead(env, "challenges");
  ch.push({ id: "res-" + Date.now(), winnerId: winner?.id, loserId: loser?.id, score: b.score || "6-4,6-4", confirmed: false, created: new Date().toISOString() });
  await gWrite(env, "challenges", ch);
  return jsonResponse({ ok: true, players: players.sort((a, b) => b.points - a.points) });
}

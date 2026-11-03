import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const ranking = await gRead(env, "ranking2026");
  const sorted = (Array.isArray(ranking) ? ranking : [])
    .filter(entry => entry && typeof entry.player === "string" && Number.isFinite(entry.points))
    .sort((a, b) => b.points - a.points);
  let lastPoints = null;
  let lastPos = 0;
  return jsonResponse(sorted.map((entry, index) => {
    const pos = entry.points === lastPoints ? lastPos : index + 1;
    lastPoints = entry.points;
    lastPos = pos;
    return { pos, player: entry.player, points: entry.points };
  }));
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  const player = typeof body?.player === "string" ? body.player.trim() : "";
  const points = Number(body?.points);
  if (!player) return jsonResponse({ error: "Jugador requerido" }, 400);
  if (!Number.isFinite(points)) return jsonResponse({ error: "Puntos inválidos" }, 400);
  const ranking = await gRead(env, "ranking2026");
  const entry = (Array.isArray(ranking) ? ranking : []).find(item => item.player === player);
  if (!entry) return jsonResponse({ error: "Jugador no encontrado en el ranking" }, 404);
  entry.points = points;
  await gWrite(env, "ranking2026", ranking);
  return jsonResponse({ ok: true });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  const player = typeof body?.player === "string" ? body.player.trim() : "";
  const points = Number(body?.points);
  if (!player) return jsonResponse({ error: "Jugador requerido" }, 400);
  if (!Number.isFinite(points)) return jsonResponse({ error: "Puntos inválidos" }, 400);
  const ranking = await gRead(env, "ranking2026");
  const entries = Array.isArray(ranking) ? ranking : [];
  if (entries.some(item => item.player === player)) {
    return jsonResponse({ error: "El jugador ya existe en el ranking" }, 409);
  }
  entries.push({ player, points });
  await gWrite(env, "ranking2026", entries);
  return jsonResponse({ ok: true }, 201);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const player = new URL(request.url).searchParams.get("player") || "";
  if (!player) return jsonResponse({ error: "Jugador requerido" }, 400);
  const ranking = await gRead(env, "ranking2026");
  const entries = (Array.isArray(ranking) ? ranking : []).filter(item => item.player !== player);
  await gWrite(env, "ranking2026", entries);
  return jsonResponse({ ok: true });
}

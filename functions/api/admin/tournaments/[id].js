import { gRead, gWrite, requireAdmin, validateMatchScore, jsonResponse } from "../../../_helpers.js";

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const STATUSES = ["registration", "scheduled", "in_progress", "completed", "cancelled"];
const MATCH_STATUSES = ["scheduled", "completed", "cancelled"];

function validDate(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function onRequestPut({ request, env, params }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Actualización inválida" }, 400);
  }

  const tournaments = await gRead(env, "tournaments");
  const tournament = tournaments.find(item => item.id === params.id);
  if (!tournament) return jsonResponse({ error: "Torneo no encontrado" }, 404);

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) {
      return jsonResponse({ error: "Nombre del torneo inválido" }, 400);
    }
    tournament.title = body.title.trim();
  }
  if (body.month !== undefined) {
    if (typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
      return jsonResponse({ error: "Mes inválido" }, 400);
    }
    tournament.month = body.month;
  }
  if (body.levels !== undefined) {
    if (!Array.isArray(body.levels) || !body.levels.length || body.levels.some(level => !LEVELS.includes(level))) {
      return jsonResponse({ error: "Niveles inválidos" }, 400);
    }
    tournament.levels = [...new Set(body.levels)];
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return jsonResponse({ error: "Estado inválido" }, 400);
    tournament.status = body.status;
  }
  for (const field of ["startDate", "endDate"]) {
    if (body[field] !== undefined) {
      if (!validDate(body[field])) return jsonResponse({ error: "Fecha inválida" }, 400);
      tournament[field] = body[field];
    }
  }
  for (const field of ["description", "venue", "format"]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || body[field].length > 500) {
        return jsonResponse({ error: `Campo ${field} inválido` }, 400);
      }
      tournament[field] = body[field].trim();
    }
  }
  if (tournament.startDate && tournament.endDate && tournament.startDate > tournament.endDate) {
    return jsonResponse({ error: "La fecha de término debe ser igual o posterior al inicio." }, 400);
  }
  if (body.match !== undefined) {
    const match = body.match;
    if (!match || typeof match !== "object" ||
        typeof match.playerAId !== "string" || typeof match.playerBId !== "string" ||
        match.playerAId === match.playerBId ||
        !tournament.entries?.some(entry => entry.playerId === match.playerAId) ||
        !tournament.entries?.some(entry => entry.playerId === match.playerBId) ||
        typeof match.round !== "string" || !match.round.trim() ||
        !validDate(match.date || "") ||
        !MATCH_STATUSES.includes(match.status || "scheduled")) {
      return jsonResponse({ error: "Partido inválido: ambos jugadores deben estar inscritos en este torneo." }, 400);
    }
    const score = typeof match.score === "string" ? match.score.trim() : "";
    const parsedScore = match.status === "completed" ? validateMatchScore(score) : null;
    if (match.status === "completed" &&
        (!parsedScore || ![match.playerAId, match.playerBId].includes(match.winnerId) ||
          parsedScore.winnerIndex !== (match.winnerId === match.playerAId ? 0 : 1))) {
      return jsonResponse({ error: "Marcador final inválido o ganador no coincide con el marcador." }, 400);
    }
    tournament.matches ||= [];
    const matchIndex = match.id === undefined ? -1 : tournament.matches.findIndex(item => item.id === match.id);
    if (match.id !== undefined && matchIndex < 0) return jsonResponse({ error: "Partido no encontrado" }, 404);
    const matchRecord = {
      id: matchIndex >= 0 ? tournament.matches[matchIndex].id : `match-${crypto.randomUUID()}`,
      round: match.round.trim().slice(0, 80),
      playerAId: match.playerAId,
      playerBId: match.playerBId,
      date: match.date || "",
      court: typeof match.court === "string" ? match.court.trim().slice(0, 120) : "",
      status: match.status || "scheduled",
      score,
      winnerId: match.status === "completed" ? match.winnerId : null
    };
    if (matchIndex >= 0) tournament.matches[matchIndex] = matchRecord;
    else tournament.matches.push(matchRecord);
  }

  tournament.updated = new Date().toISOString();
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ tournament });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const tournaments = await gRead(env, "tournaments");
  const index = tournaments.findIndex(item => item.id === params.id);
  if (index < 0) return jsonResponse({ error: "Torneo no encontrado" }, 404);
  tournaments.splice(index, 1);
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ ok: true });
}

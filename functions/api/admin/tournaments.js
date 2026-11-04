import { gRead, gWrite, requireAdmin, jsonResponse, MATCH_CATEGORIES } from "../../_helpers.js";

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const STATUSES = ["registration", "scheduled", "in_progress", "completed", "cancelled"];
const TOURNAMENT_GENDERS = ["hombres", "mujeres", "mixto"];
const FORMAT_TYPES = ["knockout", "league", "round_robin", "groups_knockout"];

function validDate(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateTournament(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Datos del torneo inválidos.";
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) {
    return "El torneo necesita un nombre de hasta 120 caracteres.";
  }
  if (typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
    return "Selecciona un mes válido.";
  }
  if (!Array.isArray(body.levels) || !body.levels.length || body.levels.some(level => !LEVELS.includes(level))) {
    return "Selecciona al menos un nivel válido.";
  }
  if (!STATUSES.includes(body.status)) return "Estado del torneo inválido.";
  const startDate = body.startDate === undefined ? "" : body.startDate;
  const endDate = body.endDate === undefined ? "" : body.endDate;
  if (!validDate(startDate) || !validDate(endDate)) return "La fecha del torneo no es válida.";
  if (startDate && endDate && startDate > endDate) {
    return "La fecha de término debe ser igual o posterior al inicio.";
  }
  for (const field of ["description", "venue", "format"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > 500)) {
      return `El campo ${field} no es válido.`;
    }
  }
  if (body.category !== undefined && !MATCH_CATEGORIES.includes(body.category)) {
    return "La categoría del torneo no es válida.";
  }
  if (body.gender !== undefined && !TOURNAMENT_GENDERS.includes(body.gender)) {
    return "La modalidad del torneo no es válida.";
  }
  if (body.formatType !== undefined && !FORMAT_TYPES.includes(body.formatType)) {
    return "El tipo de competición no es válido.";
  }
  if (body.maxParticipants !== undefined && body.maxParticipants !== null && body.maxParticipants !== "") {
    const value = Number(body.maxParticipants);
    if (!Number.isInteger(value) || value < 2 || value > 256) {
      return "La cantidad de participantes debe ser un número entre 2 y 256.";
    }
  }
  return null;
}

function publicTournament(tournament, playerById) {
  const { entries = [], matches = [], createdBy, ...details } = tournament;
  return {
    ...details,
    entries: entries.map(entry => ({
      playerId: entry.playerId,
      name: playerById.get(entry.playerId)?.name || entry.playerName || entry.name || "Jugador",
      level: playerById.get(entry.playerId)?.level || entry.level || ""
    })),
    matches: matches.map(match => ({
      ...match,
      playerAName: playerById.get(match.playerAId)?.name || entries.find(entry => entry.playerId === match.playerAId)?.playerName || "Por definir",
      playerBName: playerById.get(match.playerBId)?.name || entries.find(entry => entry.playerId === match.playerBId)?.playerName || "Por definir"
    }))
  };
}

export async function onRequestGet({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const [tournaments, players] = await Promise.all([
    gRead(env, "tournaments"),
    gRead(env, "players")
  ]);
  const playerById = new Map(players.map(player => [player.id, player]));
  return jsonResponse(tournaments
    .map(tournament => publicTournament({
      ...tournament,
      entries: (tournament.entries || []).map(entry => ({
        ...entry,
        playerName: playerById.get(entry.playerId)?.name || "Jugador",
        level: playerById.get(entry.playerId)?.level || ""
      }))
    }, playerById))
    .sort((left, right) => right.month.localeCompare(left.month)));
}

export async function onRequestPost({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  const error = validateTournament(body);
  if (error) return jsonResponse({ error }, 400);

  const [tournaments, players] = await Promise.all([
    gRead(env, "tournaments"),
    gRead(env, "players")
  ]);
  const playerById = new Map(players.map(player => [player.id, player]));
  const entries = [];
  if (body.entries !== undefined) {
    if (!Array.isArray(body.entries)) {
      return jsonResponse({ error: "Lista de inscripciones inválida" }, 400);
    }
    const seen = new Set();
    for (const raw of body.entries) {
      const playerId = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? raw.playerId : null);
      if (typeof playerId !== "string") {
        return jsonResponse({ error: "Participante inválido en las inscripciones" }, 400);
      }
      if (seen.has(playerId)) continue;
      const player = playerById.get(playerId);
      if (!player) {
        return jsonResponse({ error: "Uno de los participantes no existe en la liga" }, 400);
      }
      seen.add(playerId);
      entries.push({ playerId: player.id, userId: player.userId, created: new Date().toISOString() });
    }
  }
  if (Number.isInteger(Number(body.maxParticipants)) && Number(body.maxParticipants) > 0 && entries.length > Number(body.maxParticipants)) {
    return jsonResponse({ error: "Los participantes superan los cupos disponibles." }, 409);
  }

  const tournament = {
    id: `tournament-${crypto.randomUUID()}`,
    title: body.title.trim(),
    month: body.month,
    description: (body.description || "").trim(),
    levels: [...new Set(body.levels)],
    startDate: body.startDate === undefined ? "" : body.startDate,
    endDate: body.endDate === undefined ? "" : body.endDate,
    venue: (body.venue || "").trim(),
    format: (body.format || (
      ["league", "round_robin"].includes(body.formatType) ? "Round Robin · todos contra todos" :
      body.formatType === "groups_knockout" ? "Fase de grupos + eliminación directa" :
      "Eliminación directa · Best of 3"
    )).trim(),
    category: MATCH_CATEGORIES.includes(body.category) ? body.category : "singles",
    gender: TOURNAMENT_GENDERS.includes(body.gender) ? body.gender : "mixto",
    formatType: FORMAT_TYPES.includes(body.formatType) ? body.formatType : "knockout",
    maxParticipants: body.maxParticipants ? Number(body.maxParticipants) : null,
    status: body.status,
    entries,
    stageNames: body.stageNames && typeof body.stageNames === "object" ? {
      groups: typeof body.stageNames.groups === "string" ? body.stageNames.groups.trim().slice(0, 80) : "Fase de grupos",
      playoff: typeof body.stageNames.playoff === "string" ? body.stageNames.playoff.trim().slice(0, 80) : "Eliminatorias"
    } : null,
    matches: [],
    createdBy: userId,
    created: new Date().toISOString()
  };
  tournaments.push(tournament);
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ tournament }, 201);
}

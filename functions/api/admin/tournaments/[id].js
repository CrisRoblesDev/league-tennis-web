import { gRead, gWrite, requireAdmin, validateMatchScore, jsonResponse, MATCH_CATEGORIES } from "../../../_helpers.js";

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const STATUSES = ["registration", "scheduled", "in_progress", "completed", "cancelled"];
const MATCH_STATUSES = ["scheduled", "completed", "cancelled"];
const TOURNAMENT_GENDERS = ["hombres", "mujeres", "mixto"];
const FORMAT_TYPES = ["knockout", "league"];

function roundName(totalRounds, roundIndex) {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinales";
  if (remaining === 3) return "Cuartos de final";
  if (remaining === 4) return "Octavos de final";
  return `Ronda ${roundIndex + 1}`;
}

function buildKnockoutDraw(playerIds) {
  const size = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(playerIds.length, 2))));
  const slots = [...playerIds];
  while (slots.length < size) slots.push(null);
  // Mezcla aleatoria para el cuadro inicial
  for (let index = slots.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [slots[index], slots[swap]] = [slots[swap], slots[index]];
  }
  const totalRounds = Math.log2(size);
  const matches = [];
  let previousRound = null;
  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const count = size / (2 ** (roundIndex + 1));
    const currentRound = [];
    for (let index = 0; index < count; index++) {
      const match = {
        id: `match-${crypto.randomUUID()}`,
        round: roundName(totalRounds, roundIndex),
        playerAId: roundIndex === 0 ? slots[index * 2] : null,
        playerBId: roundIndex === 0 ? slots[index * 2 + 1] : null,
        date: "",
        court: "",
        status: "scheduled",
        score: "",
        winnerId: null,
        auto: true
      };
      currentRound.push(match);
      matches.push(match);
    }
    if (previousRound) {
      previousRound.forEach((match, index) => {
        match.nextMatchId = currentRound[Math.floor(index / 2)].id;
        match.nextSlot = index % 2 === 0 ? "A" : "B";
      });
    }
    previousRound = currentRound;
  }
  return matches;
}

function buildLeagueSchedule(playerIds) {
  const ids = [...playerIds];
  if (ids.length % 2 === 1) ids.push(null);
  const rounds = ids.length - 1;
  const matches = [];
  let rotation = [...ids];
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    for (let index = 0; index < ids.length / 2; index++) {
      const playerA = rotation[index];
      const playerB = rotation[rotation.length - 1 - index];
      if (playerA === null || playerB === null) continue;
      matches.push({
        id: `match-${crypto.randomUUID()}`,
        round: `Jornada ${roundIndex + 1}`,
        playerAId: roundIndex % 2 === 0 ? playerA : playerB,
        playerBId: roundIndex % 2 === 0 ? playerB : playerA,
        date: "",
        court: "",
        status: "scheduled",
        score: "",
        winnerId: null,
        auto: true
      });
    }
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    rest.unshift(rest.pop());
    rotation = [fixed, ...rest];
  }
  return matches;
}

function advanceWinner(tournament, completedMatch) {
  if (tournament.formatType !== "knockout" || !completedMatch.nextMatchId || !completedMatch.winnerId) return;
  const next = (tournament.matches || []).find(match => match.id === completedMatch.nextMatchId);
  if (!next) return;
  if (completedMatch.nextSlot === "B") next.playerBId = completedMatch.winnerId;
  else next.playerAId = completedMatch.winnerId;
  next.updated = new Date().toISOString();
}

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
  if (body.category !== undefined) {
    if (!MATCH_CATEGORIES.includes(body.category)) return jsonResponse({ error: "Categoría inválida" }, 400);
    tournament.category = body.category;
  }
  if (body.gender !== undefined) {
    if (!TOURNAMENT_GENDERS.includes(body.gender)) return jsonResponse({ error: "Modalidad inválida" }, 400);
    tournament.gender = body.gender;
  }
  if (body.formatType !== undefined) {
    if (!FORMAT_TYPES.includes(body.formatType)) return jsonResponse({ error: "Tipo de competición inválido" }, 400);
    tournament.formatType = body.formatType;
  }
  if (body.maxParticipants !== undefined) {
    if (body.maxParticipants === null || body.maxParticipants === "") {
      tournament.maxParticipants = null;
    } else {
      const value = Number(body.maxParticipants);
      if (!Number.isInteger(value) || value < 2 || value > 256) {
        return jsonResponse({ error: "Cantidad de participantes inválida" }, 400);
      }
      tournament.maxParticipants = value;
    }
  }
  if (body.generateDraw === true) {
    const entries = (tournament.entries || []).map(entry => entry.playerId);
    if (entries.length < 2) {
      return jsonResponse({ error: "Se necesitan al menos 2 jugadores inscritos para generar el cuadro." }, 409);
    }
    tournament.formatType ||= "knockout";
    tournament.matches = tournament.formatType === "league"
      ? buildLeagueSchedule(entries)
      : buildKnockoutDraw(entries);
    tournament.groups = null;
    tournament.groupCount = null;
  }
  if (body.generateGroups === true) {
    const entries = (tournament.entries || []).map(entry => entry.playerId);
    const groupCount = Math.max(1, Math.floor(Number(body.groupCount) || 2));
    if (groupCount < 2 || groupCount > 16) {
      return jsonResponse({ error: "El número de grupos debe estar entre 2 y 16." }, 400);
    }
    if (entries.length < groupCount * 2) {
      return jsonResponse({ error: "No hay suficientes participantes para crear los grupos." }, 409);
    }
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const groups = Array.from({ length: groupCount }, () => []);
    shuffled.forEach((playerId, index) => groups[index % groupCount].push(playerId));
    tournament.formatType = "league";
    tournament.groupCount = groupCount;
    tournament.groups = groups.map((group, index) => ({
      name: `Grupo ${String.fromCharCode(65 + index)}`,
      entryPlayerIds: group
    }));
    const matches = [];
    groups.forEach((group, groupIndex) => {
      group = [...group];
      if (group.length % 2 === 1) group.push(null);
      const rounds = group.length - 1;
      const rotation = [...group];
      for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
        for (let index = 0; index < group.length / 2; index++) {
          const playerA = rotation[index];
          const playerB = rotation[rotation.length - 1 - index];
          if (playerA === null || playerB === null) continue;
          matches.push({
            id: `match-${crypto.randomUUID()}`,
            round: `Grupo ${String.fromCharCode(65 + groupIndex)} · Jornada ${roundIndex + 1}`,
            playerAId: playerA,
            playerBId: playerB,
            date: "",
            court: "",
            status: "scheduled",
            score: "",
            winnerId: null,
            auto: true
          });
        }
        const fixed = rotation[0];
        const rest = rotation.slice(1);
        rest.unshift(rest.pop());
        rotation.splice(0, rotation.length, fixed, ...rest);
      }
    });
    tournament.matches = matches;
  }
  if (tournament.startDate && tournament.endDate && tournament.startDate > tournament.endDate) {
    return jsonResponse({ error: "La fecha de término debe ser igual o posterior al inicio." }, 400);
  }
  if (body.deleteMatchId !== undefined) {
    if (typeof body.deleteMatchId !== "string") {
      return jsonResponse({ error: "Partido inválido" }, 400);
    }
    const matches = tournament.matches || [];
    const matchIndex = matches.findIndex(match => match.id === body.deleteMatchId);
    if (matchIndex < 0) return jsonResponse({ error: "Partido no encontrado" }, 404);
    matches.splice(matchIndex, 1);
    tournament.matches = matches;
  }
  if (body.removeEntryPlayerId !== undefined) {
    if (typeof body.removeEntryPlayerId !== "string") {
      return jsonResponse({ error: "Inscripción inválida" }, 400);
    }
    if ((tournament.matches || []).some(match =>
      [match.playerAId, match.playerBId].includes(body.removeEntryPlayerId)
    )) {
      return jsonResponse({ error: "No se puede retirar a un jugador que ya tiene partidos en el cuadro." }, 409);
    }
    const entries = tournament.entries || [];
    const entryIndex = entries.findIndex(entry => entry.playerId === body.removeEntryPlayerId);
    if (entryIndex < 0) return jsonResponse({ error: "Inscripción no encontrada" }, 404);
    entries.splice(entryIndex, 1);
    tournament.entries = entries;
  }
  if (body.addEntryPlayerId !== undefined) {
    if (typeof body.addEntryPlayerId !== "string" || tournament.status !== "registration") {
      return jsonResponse({ error: "Solo se pueden agregar jugadores durante la inscripción." }, 409);
    }
    const players = await gRead(env, "players");
    const player = players.find(item => item.id === body.addEntryPlayerId);
    if (!player) return jsonResponse({ error: "Jugador no encontrado" }, 404);
    if (!tournament.levels?.includes(player.level)) {
      return jsonResponse({ error: "El nivel del jugador no está habilitado para este torneo." }, 409);
    }
    tournament.entries ||= [];
    if (tournament.entries.some(entry => entry.playerId === player.id)) {
      return jsonResponse({ error: "El jugador ya está inscrito." }, 409);
    }
    tournament.entries.push({
      playerId: player.id,
      userId: player.userId,
      created: new Date().toISOString()
    });
  }
  if (body.match !== undefined) {
    const match = body.match;
    const isPlaceholder = match.playerAId === null && match.playerBId === null;
    if (!match || typeof match !== "object" ||
        (!isPlaceholder && (typeof match.playerAId !== "string" || typeof match.playerBId !== "string" ||
          match.playerAId === match.playerBId ||
          !tournament.entries?.some(entry => entry.playerId === match.playerAId) ||
          !tournament.entries?.some(entry => entry.playerId === match.playerBId))) ||
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
      playerAId: isPlaceholder ? null : match.playerAId,
      playerBId: isPlaceholder ? null : match.playerBId,
      date: match.date || "",
      court: typeof match.court === "string" ? match.court.trim().slice(0, 120) : "",
      status: match.status || "scheduled",
      score,
      winnerId: match.status === "completed" ? match.winnerId : null
    };
    const existing = matchIndex >= 0 ? tournament.matches[matchIndex] : null;
    if (existing) {
      matchRecord.nextMatchId = existing.nextMatchId;
      matchRecord.nextSlot = existing.nextSlot;
      matchRecord.auto = existing.auto;
    }
    if (matchIndex >= 0) tournament.matches[matchIndex] = matchRecord;
    else tournament.matches.push(matchRecord);
    if (matchRecord.status === "completed") advanceWinner(tournament, matchRecord);
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

import { gRead, gWrite, requireAdmin, validateMatchScore, jsonResponse, MATCH_CATEGORIES } from "../../../_helpers.js";
import { validateTennisMatch, tennisScoreString, computeStandings } from "../tennis-scoring.js";

const LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const STATUSES = ["registration", "scheduled", "in_progress", "completed", "cancelled"];
const MATCH_STATUSES = ["scheduled", "completed", "cancelled"];
const TOURNAMENT_GENDERS = ["hombres", "mujeres", "mixto"];
const FORMAT_TYPES = ["knockout", "league", "round_robin", "groups_knockout"];

function roundName(totalRounds, roundIndex) {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinales";
  if (remaining === 3) return "Cuartos de final";
  if (remaining === 4) return "Octavos de final";
  return `Ronda ${roundIndex + 1}`;
}

function computeBracketSize(n_players, preferredSize) {
  if (preferredSize && Number.isInteger(preferredSize) && preferredSize >= 2 && (preferredSize & (preferredSize - 1)) === 0) {
    let size = preferredSize;
    while (size < n_players) size *= 2;
    return size;
  }
  if (n_players < 2) return 0;
  let size = 1;
  while (size < n_players) size *= 2;
  return size;
}

function distributeByes(players, bracketSize) {
  const nByes = bracketSize - players.length;
  if (nByes > players.length) {
    const slots = Array(bracketSize).fill(null);
    players.forEach((playerId, index) => { slots[index] = playerId; });
    return slots;
  }
  const seeding = [];
  for (let i = 0; i < nByes; i++) {
    seeding.push(players[i], null);
  }
  for (let i = nByes; i < players.length; i++) {
    seeding.push(players[i]);
  }
  return seeding;
}

// Calendario de liga dentro de grupos personalizados (wizard por etapas).
function buildGroupMatches(groups) {
  const matches = [];
  groups.forEach(group => {
    let groupPlayers = [...group.entryPlayerIds];
    if (groupPlayers.length % 2 === 1) groupPlayers.push(null);
    const totalRounds = groupPlayers.length - 1;
    const rotation = [...groupPlayers];
    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
      for (let index = 0; index < groupPlayers.length / 2; index++) {
        const playerA = rotation[index];
        const playerB = rotation[rotation.length - 1 - index];
        if (playerA === null || playerB === null) continue;
        matches.push({
          id: `match-${crypto.randomUUID()}`,
          stageId: "groups",
          round: `${group.name} · Jornada ${roundIndex + 1}`,
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
  return matches;
}

function buildKnockoutDraw(playerIds, options = {}) {
  const size = computeBracketSize(playerIds.length, options.bracketSize);
  const shuffled = options.doShuffle === false
    ? [...playerIds]
    : [...playerIds].sort(() => Math.random() - 0.5);
  const seeding = distributeByes(shuffled, size);
  const totalRounds = Math.log2(size);
  const matches = [];
  let previousRound = null;
  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const count = size / (2 ** (roundIndex + 1));
    const currentRound = [];
    for (let index = 0; index < count; index++) {
      const match = {
        id: `match-${crypto.randomUUID()}`,
        ...(options.stageId ? { stageId: options.stageId } : {}),
        round: roundName(totalRounds, roundIndex),
        playerAId: null,
        playerBId: null,
        date: "",
        court: "",
        status: "scheduled",
        score: "",
        winnerId: null,
        auto: true
      };
      if (roundIndex === 0) {
        match.playerAId = seeding[index * 2];
        match.playerBId = seeding[index * 2 + 1];
        if (!match.playerAId && match.playerBId) {
          match.status = "completed";
          match.winnerId = match.playerBId;
          match.score = "BYE";
        } else if (!match.playerBId && match.playerAId) {
          match.status = "completed";
          match.winnerId = match.playerAId;
          match.score = "BYE";
        }
      }
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
        stageId: "groups",
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
  const isPlayoff = tournament.formatType === "knockout" ||
    (completedMatch.stageId === "playoff" && Array.isArray(tournament.groups) && tournament.groups.length > 0);
  if (!isPlayoff || !completedMatch.nextMatchId || !completedMatch.winnerId) return;
  const next = (tournament.matches || []).find(match => match.id === completedMatch.nextMatchId);
  if (!next) return;
  if (completedMatch.nextSlot === "B") next.playerBId = completedMatch.winnerId;
  else next.playerAId = completedMatch.winnerId;
  next.updated = new Date().toISOString();
}

function autoAdvanceByes(tournament) {
  for (const match of tournament.matches || []) {
    if (match.stageId === "groups") continue;
    const hasA = Boolean(match.playerAId);
    const hasB = Boolean(match.playerBId);
    if (match.status !== "completed" && hasA !== hasB) {
      match.status = "completed";
      match.winnerId = hasA ? match.playerAId : match.playerBId;
      match.score = "BYE";
    }
    if (match.status === "completed" && match.score === "BYE" && match.winnerId) {
      advanceWinner(tournament, match);
    }
  }
}

function clearAdvancedWinner(tournament, sourceMatch, previousWinner) {
  let source = sourceMatch;
  let winner = previousWinner;
  const visited = new Set();
  while (source?.nextMatchId && !visited.has(source.nextMatchId)) {
    visited.add(source.nextMatchId);
    const next = (tournament.matches || []).find(match => match.id === source.nextMatchId);
    if (!next) return;
    const field = source.nextSlot === "B" ? "playerBId" : "playerAId";
    if (next[field] === winner) next[field] = null;
    const downstreamWinner = next.winnerId;
    next.winnerId = null;
    next.score = "";
    next.sets = null;
    next.status = "scheduled";
    next.updated = new Date().toISOString();
    source = next;
    winner = downstreamWinner;
    if (!winner) return;
  }
}

// Reconecta el cuadro por etapas: agrupa los partidos por ronda, empareja cada
// etapa con la siguiente cuando el número de partidos encaja a la mitad y
// repropaga los ganadores completados. Así los partidos creados a mano, por
// etapas, se conectan como un Main Draw generado.
function relinkBracket(tournament) {
  const isMultiStage = Array.isArray(tournament.groups) && tournament.groups.length > 0;
  if ((tournament.formatType || "knockout") !== "knockout" && !isMultiStage) return;
  const allMatches = tournament.matches || [];
  const matches = isMultiStage
    ? allMatches.filter(match => match.stageId !== "groups" && !String(match.round || "").startsWith("Grupo "))
    : allMatches;
  if (!matches.length) return;
  const matchIds = new Set(matches.map(match => match.id));
  // Limpia enlaces colgantes (partidos eliminados).
  matches.forEach(match => {
    if (match.nextMatchId && !matchIds.has(match.nextMatchId)) {
      delete match.nextMatchId;
      delete match.nextSlot;
    }
  });
  // Agrupa por etapa respetando el orden existente (la generación ya ordena
  // de primeras rondas a la final).
  const stageMap = new Map();
  matches.forEach(match => {
    const stage = String(match.round || "Ronda").trim();
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage).push(match);
  });
  const storedStages = (tournament.stages || []).map(stage =>
    typeof stage === "string" ? stage.trim() : String(stage?.name || "").trim()
  ).filter(Boolean);
  const present = [...stageMap.keys()];
  const ordered = [
    ...storedStages.filter(stage => stageMap.has(stage)),
    ...present.filter(stage => !storedStages.includes(stage))
  ];
  for (let index = 0; index < ordered.length - 1; index++) {
    const current = stageMap.get(ordered[index]);
    const next = stageMap.get(ordered[index + 1]);
    if (!current || !next) continue;
    // Solo conecta cuando la etapa siguiente tiene exactamente la mitad de partidos.
    if (next.length !== Math.floor(current.length / 2)) continue;
    current.forEach((match, matchIndex) => {
      // Nunca reubiques enlaces existentes al añadir un partido: eso cambia
      // qué participantes avanzan. Solo conecta partidos que todavía no tienen destino.
      if (match.nextMatchId || matchIndex >= next.length * 2) return;
      match.nextMatchId = next[Math.floor(matchIndex / 2)].id;
      match.nextSlot = matchIndex % 2 === 0 ? "A" : "B";
    });
  }
  // Repropaga los ganadores a sus casillas del partido siguiente.
  matches.forEach(match => {
    if (match.status === "completed" && match.winnerId) advanceWinner(tournament, match);
  });
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
  if (body.stageNames !== undefined) {
    if (!body.stageNames || typeof body.stageNames !== "object" || Array.isArray(body.stageNames) ||
        ["groups", "playoff"].some(key => body.stageNames[key] !== undefined &&
          (typeof body.stageNames[key] !== "string" || body.stageNames[key].trim().length > 80))) {
      return jsonResponse({ error: "Los nombres de las etapas no son válidos." }, 400);
    }
    tournament.stageNames = {
      groups: body.stageNames.groups?.trim() || "Fase de grupos",
      playoff: body.stageNames.playoff?.trim() || "Eliminatorias"
    };
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
  if (body.bracketSize !== undefined) {
    if (body.bracketSize === null || body.bracketSize === "") {
      tournament.bracketSize = null;
    } else {
      const value = Number(body.bracketSize);
      if (!Number.isInteger(value) || value < 4 || value > 64 || (value & (value - 1)) !== 0) {
        return jsonResponse({ error: "El tamaño del cuadro debe ser 4, 8, 16, 32 o 64." }, 400);
      }
      tournament.bracketSize = value;
    }
  }
  if (Array.isArray(body.saveSeed) && body.saveSeed.length >= 2) {
    const seedPlayerIds = body.saveSeed.filter(id => typeof id === "string");
    if (seedPlayerIds.length < 2) {
      return jsonResponse({ error: "El sembrado necesita al menos 2 jugadores." }, 400);
    }
    const validPlayerIds = new Set((tournament.entries || []).map(entry => entry.playerId));
    if (!seedPlayerIds.every(id => validPlayerIds.has(id))) {
      return jsonResponse({ error: "Sembrado contiene jugadores incompletos." }, 400);
    }
    tournament.matches = buildKnockoutDraw(seedPlayerIds, { doShuffle: false, bracketSize: body.bracketSize || tournament.bracketSize });
    autoAdvanceByes(tournament);
  }
  if (body.generateDraw === true) {
    const entries = (tournament.entries || []).map(entry => entry.playerId);
    if (entries.length < 2) {
      return jsonResponse({ error: "Se necesitan al menos 2 jugadores inscritos para generar el cuadro." }, 409);
    }
    tournament.formatType ||= "knockout";
    if (tournament.formatType === "groups_knockout" && tournament.groups?.length) {
      tournament.matches = buildGroupMatches(tournament.groups);
      tournament.formatType = "groups_knockout";
    } else {
      tournament.matches = ["league", "round_robin"].includes(tournament.formatType)
      ? buildLeagueSchedule(entries)
      : buildKnockoutDraw(entries, { bracketSize: tournament.bracketSize });
    }
    if (["knockout", "groups_knockout"].includes(tournament.formatType)) autoAdvanceByes(tournament);
    tournament.groups = null;
    tournament.groupCount = null;
    delete tournament.stages;
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
    if (!["groups_knockout", "round_robin"].includes(tournament.formatType)) tournament.formatType = "league";
    tournament.groupCount = groupCount;
    tournament.groups = groups.map((group, index) => ({
      name: `Grupo ${String.fromCharCode(65 + index)}`,
      entryPlayerIds: group
    }));
    tournament.matches = buildGroupMatches(tournament.groups);
    tournament.stages = [{ id: "groups", name: tournament.stageNames?.groups || "Fase de grupos", type: "groups" }];
  }
  if (body.groups !== undefined) {
    // Grupos personalizados (creador de Main Draw por etapas): conserva los
    // grupos definidos y genera el calendario de liga dentro de cada uno.
    if (!Array.isArray(body.groups) || !body.groups.length) {
      return jsonResponse({ error: "Grupos inválidos." }, 400);
    }
    const entryIds = new Set((tournament.entries || []).map(entry => entry.playerId));
    const used = new Set();
    const customGroups = [];
    for (const raw of body.groups) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
          typeof raw.name !== "string" || !Array.isArray(raw.entryPlayerIds)) {
        return jsonResponse({ error: "Grupo inválido." }, 400);
      }
      const ids = [];
      for (const playerId of raw.entryPlayerIds) {
        if (typeof playerId !== "string" || !entryIds.has(playerId) || used.has(playerId)) continue;
        used.add(playerId);
        ids.push(playerId);
      }
      if (ids.length > 64) {
        return jsonResponse({ error: "Un grupo no puede tener más de 64 jugadores." }, 400);
      }
      customGroups.push({ name: raw.name.trim().slice(0, 60) || "Grupo", entryPlayerIds: ids });
    }
    if (!customGroups.length) return jsonResponse({ error: "Crea al menos una etapa/grupo." }, 400);
    if (!["groups_knockout", "round_robin"].includes(tournament.formatType)) tournament.formatType = "league";
    tournament.groupCount = customGroups.length;
    tournament.groups = customGroups;
    tournament.matches = buildGroupMatches(customGroups);
    tournament.stages = [{ id: "groups", name: tournament.stageNames?.groups || "Fase de grupos", type: "groups" }];
  }
  if (body.advanceGroups !== undefined) {
    const config = body.advanceGroups === true ? {} : body.advanceGroups;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return jsonResponse({ error: "Configuración de clasificación inválida." }, 400);
    }
    const groups = tournament.groups || [];
    if (groups.length < 2) return jsonResponse({ error: "Crea al menos dos grupos antes de generar las eliminatorias." }, 409);
    const qualifiersPerGroup = Number(config.qualifiersPerGroup || 2);
    if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1 || qualifiersPerGroup > 4) {
      return jsonResponse({ error: "Clasifican de 1 a 4 jugadores por grupo." }, 400);
    }
    const players = await gRead(env, "players");
    const entries = tournament.entries || [];
    const groupResults = groups.map(group => {
      const groupMatches = (tournament.matches || []).filter(match =>
        (match.stageId === "groups" || !match.stageId) && String(match.round || "").startsWith(`${group.name} ·`)
      );
      return {
        group,
        matches: groupMatches,
        standings: computeStandings(group.entryPlayerIds.map(playerId => {
          const entry = entries.find(item => item.playerId === playerId) || {};
          const player = players.find(item => item.id === playerId) || {};
          return { id: playerId, name: player.name || entry.playerName || playerId, level: player.level || entry.level || "" };
        }), groupMatches)
      };
    });
    if (groupResults.some(result => !result.matches.length)) {
      return jsonResponse({ error: "Genera el calendario para todos los grupos antes de clasificar." }, 409);
    }
    const unfinished = groupResults.flatMap(result => result.matches.filter(match => match.status !== "completed"));
    if (unfinished.length) {
      return jsonResponse({ error: `Quedan ${unfinished.length} partido(s) de grupo sin finalizar.` }, 409);
    }
    if (groupResults.some(result => result.standings.length < qualifiersPerGroup)) {
      return jsonResponse({ error: "Algún grupo no tiene suficientes participantes para esta clasificación." }, 409);
    }

    // Cruza los clasificados por puesto y revierte los grupos en puestos pares,
    // evitando que dos jugadores del mismo grupo se enfrenten en primera ronda.
    const rankedGroups = groupResults.map(result => result.standings.slice(0, qualifiersPerGroup));
    const seedPlayerIds = [];
    for (let groupIndex = 0; groupIndex < rankedGroups.length; groupIndex++) {
      seedPlayerIds.push(rankedGroups[groupIndex][0].id);
      if (qualifiersPerGroup >= 2) {
        seedPlayerIds.push(rankedGroups[(groupIndex + 1) % rankedGroups.length][1].id);
      }
    }
    for (let place = 2; place < qualifiersPerGroup; place++) {
      const order = place % 2 === 0 ? rankedGroups : [...rankedGroups].reverse();
      order.forEach(standings => seedPlayerIds.push(standings[place].id));
    }
    const playoffMatches = buildKnockoutDraw(seedPlayerIds, {
      doShuffle: false,
      bracketSize: config.bracketSize || tournament.bracketSize,
      stageId: "playoff"
    });
    tournament.matches = [
      ...(tournament.matches || []).filter(match => match.stageId !== "playoff"),
      ...playoffMatches
    ];
    tournament.formatType = "groups_knockout";
    tournament.stages = [
      { id: "groups", name: tournament.stageNames?.groups || "Fase de grupos", type: "groups" },
      { id: "playoff", name: tournament.stageNames?.playoff || "Eliminatorias", type: "knockout" }
    ];
    tournament.qualifiedPlayerIds = seedPlayerIds;
    tournament.groupStandings = groupResults.map(result => ({
      name: result.group.name,
      standings: result.standings,
      qualifiedPlayerIds: result.standings.slice(0, qualifiersPerGroup).map(row => row.id)
    }));
    tournament.qualifiersPerGroup = qualifiersPerGroup;
    autoAdvanceByes(tournament);
  }
  if (body.bracketSlotUpdate !== undefined) {
    const update = body.bracketSlotUpdate;
    if (!update || typeof update !== "object" || Array.isArray(update) ||
        typeof update.matchId !== "string" || !["A", "B"].includes(update.slot)) {
      return jsonResponse({ error: "Actualización de participante inválida." }, 400);
    }
    const match = (tournament.matches || []).find(item => item.id === update.matchId);
    if (!match || match.stageId === "groups") return jsonResponse({ error: "Partido de cuadro no encontrado." }, 404);
    const field = update.slot === "A" ? "playerAId" : "playerBId";
    const newPlayerId = update.playerId === null || update.playerId === "" ? null : update.playerId;
    if (newPlayerId && !(tournament.entries || []).some(entry => entry.playerId === newPlayerId)) {
      return jsonResponse({ error: "El jugador no está inscrito en este torneo." }, 400);
    }
    if (newPlayerId && newPlayerId === match[update.slot === "A" ? "playerBId" : "playerAId"]) {
      return jsonResponse({ error: "Un jugador no puede ocupar ambos lados del partido." }, 400);
    }
    const previousWinner = match.winnerId;
    const previousPlayerId = match[field];
    const stageId = match.stageId || "knockout";
    const otherSlotMatch = newPlayerId && (tournament.matches || []).find(candidate =>
      candidate.id !== match.id &&
      (candidate.stageId || "knockout") === stageId &&
      candidate.round === match.round &&
      [candidate.playerAId, candidate.playerBId].includes(newPlayerId)
    );
    if (otherSlotMatch) {
      const otherField = otherSlotMatch.playerAId === newPlayerId ? "playerAId" : "playerBId";
      const otherWinner = otherSlotMatch.winnerId;
      otherSlotMatch[otherField] = previousPlayerId || null;
      otherSlotMatch.status = "scheduled";
      otherSlotMatch.winnerId = null;
      otherSlotMatch.score = "";
      otherSlotMatch.sets = null;
      otherSlotMatch.updated = new Date().toISOString();
      if (otherWinner && otherSlotMatch.nextMatchId) clearAdvancedWinner(tournament, otherSlotMatch, otherWinner);
    }
    match[field] = newPlayerId;
    match.status = "scheduled";
    match.winnerId = null;
    match.score = "";
    match.sets = null;
    match.updated = new Date().toISOString();
    if (previousWinner && previousWinner !== newPlayerId && match.nextMatchId) {
      clearAdvancedWinner(tournament, match, previousWinner);
    }
  }
  if (body.bracketSlotSwap !== undefined) {
    const swap = body.bracketSlotSwap;
    if (!swap || typeof swap !== "object" || !swap.from || !swap.to ||
        typeof swap.from.matchId !== "string" || typeof swap.to.matchId !== "string" ||
        !["A", "B"].includes(swap.from.slot) || !["A", "B"].includes(swap.to.slot)) {
      return jsonResponse({ error: "Intercambio de sembrado inválido." }, 400);
    }
    const fromMatch = (tournament.matches || []).find(match => match.id === swap.from.matchId);
    const toMatch = (tournament.matches || []).find(match => match.id === swap.to.matchId);
    if (!fromMatch || !toMatch || fromMatch.stageId === "groups" || toMatch.stageId === "groups") {
      return jsonResponse({ error: "No se encontraron las casillas del cuadro." }, 404);
    }
    const fromField = swap.from.slot === "A" ? "playerAId" : "playerBId";
    const toField = swap.to.slot === "A" ? "playerAId" : "playerBId";
    const fromWinner = fromMatch.winnerId;
    const toWinner = toMatch.winnerId;
    [fromMatch[fromField], toMatch[toField]] = [toMatch[toField], fromMatch[fromField]];
    if ((fromMatch.playerAId && fromMatch.playerAId === fromMatch.playerBId) ||
        (toMatch.playerAId && toMatch.playerAId === toMatch.playerBId)) {
      [fromMatch[fromField], toMatch[toField]] = [toMatch[toField], fromMatch[fromField]];
      return jsonResponse({ error: "Un jugador no puede ocupar ambos lados del mismo partido." }, 400);
    }
    for (const [match, previousWinner] of [[fromMatch, fromWinner], [toMatch, toWinner]]) {
      match.status = "scheduled";
      match.winnerId = null;
      match.score = "";
      match.sets = null;
      match.updated = new Date().toISOString();
      if (previousWinner && match.nextMatchId) clearAdvancedWinner(tournament, match, previousWinner);
    }
  }
  if (body.matchScheduleUpdate !== undefined) {
    const update = body.matchScheduleUpdate;
    if (!update || typeof update !== "object" || Array.isArray(update) || typeof update.matchId !== "string") {
      return jsonResponse({ error: "Actualización de partido inválida." }, 400);
    }
    const match = (tournament.matches || []).find(item => item.id === update.matchId);
    if (!match) return jsonResponse({ error: "Partido no encontrado." }, 404);
    if (update.date !== undefined) {
      if (!validDate(update.date || "")) return jsonResponse({ error: "Fecha inválida." }, 400);
      match.date = update.date || "";
    }
    if (update.court !== undefined) {
      if (typeof update.court !== "string" || update.court.length > 120) return jsonResponse({ error: "Cancha inválida." }, 400);
      match.court = update.court.trim();
    }
    match.updated = new Date().toISOString();
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
    if (Number.isInteger(tournament.maxParticipants) && tournament.entries.length >= tournament.maxParticipants) {
      return jsonResponse({ error: "El torneo ya completó todos sus cupos." }, 409);
    }
    if (tournament.entries.some(entry => entry.playerId === player.id)) {
      return jsonResponse({ error: "El jugador ya está inscrito." }, 409);
    }
    tournament.entries.push({
      playerId: player.id,
      userId: player.userId,
      created: new Date().toISOString()
    });
  }
  let savedMatchId = null;
  if (body.matchResult !== undefined) {
    const r = body.matchResult;
    if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.matchId !== "string") {
      return jsonResponse({ error: "Resultado de partido inválido" }, 400);
    }
    const matchIndex = (tournament.matches || []).findIndex(m => m.id === r.matchId);
    if (matchIndex < 0) return jsonResponse({ error: "Partido no encontrado" }, 404);
    const match = tournament.matches[matchIndex];
    const entryA = (tournament.entries || []).find(e => e.playerId === match.playerAId);
    const entryB = (tournament.entries || []).find(e => e.playerId === match.playerBId);
    if (!entryA || !entryB) return jsonResponse({ error: "Partido sin jugadores válidos" }, 400);

    const status = r.status || "completed";
    if (!MATCH_STATUSES.includes(status)) return jsonResponse({ error: "Estado inválido" }, 400);

    let parsed = null;
    let winnerId = null;
    let score = "";
    if (status === "completed") {
      const superTiebreak = Boolean(r.superTiebreak);
      parsed = validateTennisMatch(r.sets || [], superTiebreak);
      if (!parsed) return jsonResponse({ error: "Marcador de tenis inválido (mejor de 3 sets, set a 6 con diferencia 2, tie-break a 7)." }, 400);
      winnerId = match.playerAId === match.playerBId ? null : (parsed.winnerId === 0 ? match.playerAId : match.playerBId);
      score = tennisScoreString(parsed.sets);
    }

    const updated = {
      ...match,
      date: typeof r.date === "string" ? r.date.trim() : match.date,
      court: typeof r.court === "string" ? r.court.trim().slice(0, 120) : match.court,
      status,
      score,
      winnerId: status === "completed" ? winnerId : null,
      sets: parsed ? parsed.sets : null,
      superTiebreak: status === "completed" ? Boolean(r.superTiebreak) : match.superTiebreak,
      updated: new Date().toISOString()
    };
    if (!validDate(updated.date || "")) return jsonResponse({ error: "Fecha inválida." }, 400);
    if (match.winnerId && match.winnerId !== winnerId && match.nextMatchId) {
      clearAdvancedWinner(tournament, match, match.winnerId);
    }
    tournament.matches[matchIndex] = updated;
    if (status !== "completed" && updated.nextMatchId) {
      const nextMatch = (tournament.matches || []).find(match => match.id === updated.nextMatchId);
      if (nextMatch && nextMatch.status !== "completed") {
        if (updated.nextSlot === "B") nextMatch.playerBId = null;
        else nextMatch.playerAId = null;
      }
    }
    if (status === "completed") advanceWinner(tournament, updated);
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
      stageId: match.stageId || (match.round.trim().startsWith("Grupo ") || ["league", "round_robin"].includes(tournament.formatType) ? "groups" : (tournament.groups?.length ? "playoff" : "knockout")),
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
    savedMatchId = matchRecord.id;
    if (existing) {
      matchRecord.stageId = existing.stageId || matchRecord.stageId;
      matchRecord.nextMatchId = existing.nextMatchId;
      matchRecord.nextSlot = existing.nextSlot;
      matchRecord.auto = existing.auto;
      const changed = existing.playerAId !== matchRecord.playerAId || existing.playerBId !== matchRecord.playerBId ||
        existing.winnerId !== matchRecord.winnerId || matchRecord.status !== "completed";
      if (changed && existing.winnerId && existing.nextMatchId) clearAdvancedWinner(tournament, existing, existing.winnerId);
    }
    if (matchIndex >= 0) tournament.matches[matchIndex] = matchRecord;
    else tournament.matches.push(matchRecord);
    if (matchRecord.status === "completed") advanceWinner(tournament, matchRecord);
  }

  if (body.stageCreate !== undefined) {
    if ((tournament.formatType || "knockout") !== "knockout") {
      return jsonResponse({ error: "Las etapas solo aplican a torneos de eliminación directa." }, 400);
    }
    if (typeof body.stageCreate !== "string" || !body.stageCreate.trim()) {
      return jsonResponse({ error: "Nombre de etapa inválido." }, 400);
    }
    const stageName = body.stageCreate.trim().slice(0, 60);
    const stages = Array.isArray(tournament.stages) ? tournament.stages.filter(stage => stage !== stageName) : [];
    stages.push(stageName);
    tournament.stages = stages.slice(-32);
  }
  if (body.stageRemove !== undefined) {
    if ((tournament.formatType || "knockout") !== "knockout") {
      return jsonResponse({ error: "Las etapas solo aplican a torneos de eliminación directa." }, 400);
    }
    if (typeof body.stageRemove !== "string" || !body.stageRemove.trim()) {
      return jsonResponse({ error: "Etapa inválida." }, 400);
    }
    const stageName = body.stageRemove.trim().slice(0, 60);
    // Limpia las casillas fed por la etapa eliminada (evita fantasmas en rondas posteriores).
    (tournament.matches || [])
      .filter(match => String(match.round || "").trim() === stageName && match.nextMatchId)
      .forEach(source => {
        const target = (tournament.matches || []).find(match => match.id === source.nextMatchId);
        if (target && target.status !== "completed") {
          if (source.nextSlot === "B") target.playerBId = null;
          else target.playerAId = null;
        }
      });
    tournament.stages = (Array.isArray(tournament.stages) ? tournament.stages : []).filter(stage => stage !== stageName);
    tournament.matches = (tournament.matches || []).filter(match => String(match.round || "").trim() !== stageName);
  }
  relinkBracket(tournament);
  tournament.updated = new Date().toISOString();
  await gWrite(env, "tournaments", tournaments);
  return jsonResponse({ tournament, ...(savedMatchId ? { matchId: savedMatchId } : {}) });
}

export async function onRequestGet({ request, env, params }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const [tournaments, players] = await Promise.all([gRead(env, "tournaments"), gRead(env, "players")]);
  const tournament = tournaments.find(item => item.id === params.id);
  if (!tournament) return jsonResponse({ error: "Torneo no encontrado" }, 404);
  const playerById = new Map(players.map(p => [p.id, p]));
  const entriesWithNames = (tournament.entries || []).map(e => ({
    ...e,
    name: playerById.get(e.playerId)?.name || "Jugador",
    level: playerById.get(e.playerId)?.level || ""
  }));
  let standings = null;
  let groupStandings = tournament.groupStandings || [];
  if (["league", "round_robin", "groups_knockout"].includes(tournament.formatType)) {
    const groupResults = (tournament.groups || []).map(group => {
      const matches = (tournament.matches || []).filter(match =>
        String(match.round || "").startsWith(`${group.name} ·`)
      );
      return {
        name: group.name,
        standings: computeStandings(group.entryPlayerIds.map(playerId => {
          const entry = entriesWithNames.find(item => item.playerId === playerId) || {};
          return { id: playerId, name: entry.name || "Jugador", level: entry.level || "" };
        }), matches),
        qualifiedPlayerIds: (tournament.groupStandings || []).find(item => item.name === group.name)?.qualifiedPlayerIds || []
      };
    });
    groupStandings = groupResults;
    standings = tournament.groups?.length ? null : computeStandings(entriesWithNames, tournament.matches || []);
  }
  return jsonResponse({ tournament: { ...tournament, entries: entriesWithNames }, standings, groupStandings });
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

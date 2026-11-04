import { gRead, gWrite, requireAdmin, requireAuth, jsonResponse } from "../../_helpers.js";

const MODES = ["robin", "knockout", "groups", "double", "league"];
const STATUSES = ["abierto", "en proceso", "cerrado"];
const STAGE_KINDS = ["groups", "bracket"];
const MAX_TOURNAMENTS = 200;
const MAX_STAGES = 20;
const MAX_GROUPS = 32;
const MAX_MATCHES = 400;

function cleanText(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function cleanId(value, prefix = "x") {
  if (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)) return value;
  return `${prefix}-${crypto.randomUUID()}`;
}

function cleanDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : "";
}

function cleanDateTime(value) {
  if (typeof value !== "string") return "";
  return value.slice(0, 40);
}

function cleanSets(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 5 ? number : null;
}

function normalizeTournament(raw, userById) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Datos del torneo inválidos.");
  }

  const name = cleanText(raw.name, 120);
  if (!name) throw new Error("El torneo necesita un nombre.");

  const mode = MODES.includes(raw.mode) ? raw.mode : "knockout";
  const status = STATUSES.includes(raw.status) ? raw.status : "abierto";
  const capacityValue = Number(raw.capacity);
  const capacity = Number.isInteger(capacityValue) ? Math.min(128, Math.max(2, capacityValue)) : 8;

  const participants = [];
  if (Array.isArray(raw.participants)) {
    const seen = new Set();
    for (const value of raw.participants) {
      if (typeof value !== "string" || !userById.has(value) || seen.has(value)) continue;
      seen.add(value);
      participants.push(value);
    }
  }
  if (participants.length > capacity) {
    throw new Error("Los participantes superan los cupos disponibles.");
  }

  const participantSet = new Set(participants);
  const requests = [];
  if (Array.isArray(raw.requests)) {
    const seen = new Set();
    for (const value of raw.requests) {
      if (typeof value !== "string" || !userById.has(value) || participantSet.has(value) || seen.has(value)) continue;
      seen.add(value);
      requests.push(value);
    }
  }

  const stages = [];
  if (Array.isArray(raw.stages)) {
    for (const stage of raw.stages.slice(0, MAX_STAGES)) {
      if (!stage || typeof stage !== "object") continue;
      const stageName = cleanText(stage.name, 80);
      if (!stageName) continue;
      stages.push({
        id: cleanId(stage.id, "stage"),
        name: stageName,
        kind: STAGE_KINDS.includes(stage.kind) ? stage.kind : "bracket"
      });
    }
  }
  if (!stages.length) {
    stages.push({ id: cleanId(null, "stage"), name: "Final", kind: "bracket" });
  }

  const groups = [];
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups.slice(0, MAX_GROUPS)) {
      if (!group || typeof group !== "object") continue;
      const groupName = cleanText(group.name, 80);
      if (!groupName) continue;
      groups.push({ id: cleanId(group.id, "group"), name: groupName });
    }
  }

  const stageById = new Map(stages.map(stage => [stage.id, stage]));
  const groupIds = new Set(groups.map(group => group.id));
  const matches = [];
  if (Array.isArray(raw.matches)) {
    const seen = new Set();
    for (const match of raw.matches.slice(0, MAX_MATCHES)) {
      if (!match || typeof match !== "object") continue;
      const stageId = typeof match.stageId === "string" && stageById.has(match.stageId) ? match.stageId : null;
      if (!stageId) continue;
      const groupId = typeof match.groupId === "string" && groupIds.has(match.groupId) ? match.groupId : null;
      const a = typeof match.a === "string" && participantSet.has(match.a) ? match.a : null;
      const b = typeof match.b === "string" && participantSet.has(match.b) ? match.b : null;
      const sa = cleanSets(match.sa);
      const sb = cleanSets(match.sb);
      const hasResult = sa !== null && sb !== null;
      const slot = Number.isInteger(Number(match.slot)) && match.slot !== null && match.slot !== ""
        ? Math.max(0, Number(match.slot))
        : null;
      const id = cleanId(match.id, "match");
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push({
        id,
        stageId,
        groupId,
        a,
        b,
        date: cleanDateTime(match.date),
        sa: hasResult && sa !== sb ? sa : null,
        sb: hasResult && sa !== sb ? sb : null,
        slot
      });
    }
  }

  const date = cleanDate(raw.date);
  let end = cleanDate(raw.end);
  if (date && end && end < date) end = date;

  return {
    id: cleanId(raw.id, "tournament"),
    name,
    mode,
    capacity,
    date,
    end,
    venue: cleanText(raw.venue, 120),
    category: cleanText(raw.category, 80),
    description: cleanText(raw.description, 600),
    status,
    stages,
    groups,
    participants,
    requests,
    matches
  };
}

async function currentUser(request, env) {
  try {
    const userId = await requireAuth(request, env);
    if (!userId) return { userId: null, user: null };
    const users = await gRead(env, "users");
    return { userId, user: users.find(item => item.id === userId) || null };
  } catch {
    return { userId: null, user: null };
  }
}

export async function onRequestGet({ request, env }) {
  const [tournaments, users] = await Promise.all([
    gRead(env, "tournamentsReference"),
    gRead(env, "users")
  ]);
  const { userId, user } = await currentUser(request, env);
  return jsonResponse({
    tournaments: Array.isArray(tournaments) ? tournaments : [],
    users: (Array.isArray(users) ? users : []).map(item => ({
      id: item.id,
      name: String(item.name || "Jugador"),
      role: "miembro"
    })),
    currentUserId: userId,
    isAdmin: user?.role === "admin"
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Solicitud inválida" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "save";

  if (action === "save") {
    const { user } = await requireAdmin(request, env);
    if (!user) return jsonResponse({ error: "No autorizado" }, 403);

    const [tournaments, users] = await Promise.all([
      gRead(env, "tournamentsReference"),
      gRead(env, "users")
    ]);
    const list = Array.isArray(tournaments) ? tournaments : [];
    if (list.length >= MAX_TOURNAMENTS) {
      return jsonResponse({ error: "Se alcanzó el límite de torneos guardados." }, 409);
    }
    const userById = new Map((Array.isArray(users) ? users : []).map(item => [item.id, item]));
    let tournament;
    try {
      tournament = normalizeTournament(body.tournament, userById);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    const index = list.findIndex(item => item.id === tournament.id);
    if (index >= 0) list[index] = tournament;
    else list.unshift(tournament);
    await gWrite(env, "tournamentsReference", list);
    return jsonResponse({ tournament });
  }

  if (!["enroll", "withdraw", "cancel-request"].includes(action)) {
    return jsonResponse({ error: "Acción no válida" }, 400);
  }

  const userId = await requireAuth(request, env).catch(() => null);
  if (!userId) return jsonResponse({ error: "Inicia sesión para continuar" }, 401);
  const users = await gRead(env, "users");
  const user = (Array.isArray(users) ? users : []).find(item => item.id === userId);
  if (!user || !["member", "admin"].includes(user.role)) {
    return jsonResponse({ error: "Solo los miembros pueden inscribirse en torneos" }, 403);
  }

  const tournamentId = typeof body.tournamentId === "string" ? body.tournamentId : "";
  const tournaments = await gRead(env, "tournamentsReference");
  const list = Array.isArray(tournaments) ? tournaments : [];
  const tournament = list.find(item => item.id === tournamentId);
  if (!tournament) return jsonResponse({ error: "El torneo ya no está disponible" }, 404);

  const participants = Array.isArray(tournament.participants) ? tournament.participants : [];
  const requests = Array.isArray(tournament.requests) ? tournament.requests : [];

  if (action === "enroll") {
    if (tournament.status !== "abierto") {
      return jsonResponse({ error: "Las inscripciones no están abiertas." }, 409);
    }
    if (participants.includes(userId)) {
      return jsonResponse({ tournament, message: "Ya estás inscrito en este torneo." });
    }
    if (participants.length >= Number(tournament.capacity || 0)) {
      return jsonResponse({ error: "No quedan cupos disponibles." }, 409);
    }
    if (!requests.includes(userId)) requests.push(userId);
    tournament.requests = requests;
    await gWrite(env, "tournamentsReference", list);
    return jsonResponse({ tournament, message: "Solicitud enviada; pendiente de aprobación." });
  }

  if (action === "cancel-request") {
    tournament.requests = requests.filter(id => id !== userId);
    await gWrite(env, "tournamentsReference", list);
    return jsonResponse({ tournament, message: "Solicitud retirada." });
  }

  tournament.participants = participants.filter(id => id !== userId);
  tournament.requests = requests.filter(id => id !== userId);
  if (Array.isArray(tournament.matches)) {
    tournament.matches = tournament.matches.filter(match => match.a !== userId && match.b !== userId);
  }
  await gWrite(env, "tournamentsReference", list);
  return jsonResponse({ tournament, message: "Inscripción retirada." });
}

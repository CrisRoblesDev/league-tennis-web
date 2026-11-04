// Shared helpers for Cloudflare Pages Functions

export const GH_API = "https://api.github.com";

export const PRODUCT_CATEGORIES = ["", "libros", "ropa"];
export const MATCH_CATEGORIES = ["singles", "dobles", "dobles_mixtos"];
export const MODALITIES = ["hombres", "mujeres"];

const FILES = {
  users: "users.json",
  products: "products.json",
  orders: "orders.json",
  players: "players.json",
  subscriptions: "subscriptions.json",
  challenges: "results.json",
  leagueChallenges: "challenges.json",
  tournaments: "tournaments.json",
  settings: "settings.json",
  ranking2026: "ranking2026.json"
};

const DEFAULTS = {
  users: [],
  products: [
    { id: "book-1", name: "Estrategia para competir", price: 1500, type: "digital", active: true, description: "Guía digital" },
    { id: "book-2", name: "Entrenamiento inteligente", price: 1000, type: "digital", active: true, description: "Guía digital" },
    { id: "member-1", name: "League Member", price: 999, type: "subscription", active: true, description: "Suscripción mensual", interval: "month" }
  ],
  orders: [],
  players: [],
  subscriptions: [],
  challenges: [],
  leagueChallenges: [],
  tournaments: [],
  settings: { whatsappUrl: "" },
  ranking2026: []
};

function assertGitHubConfig(env) {
  const missing = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].filter(key => !env[key]);
  if (missing.length) {
    throw new Error(`Missing Cloudflare environment variables: ${missing.join(", ")}`);
  }
}

export function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "league-tennis-app"
  };
}

function githubFileUrl(env, fileKey) {
  const file = FILES[fileKey];
  if (!file) throw new Error(`Unknown data file: ${fileKey}`);
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  return `${GH_API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/data/${file}?ref=${branch}`;
}

function githubContentsUrl(env, repoPath) {
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  return `${GH_API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${repoPath}?ref=${branch}`;
}

function decodeContent(content) {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, "")), character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeContent(content) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function githubError(response, action) {
  const detail = await response.text();
  throw new Error(`GitHub ${action} failed (${response.status}): ${detail.slice(0, 300)}`);
}

export async function gRead(env, fileKey) {
  assertGitHubConfig(env);
  const url = githubFileUrl(env, fileKey);
  const response = await fetch(url, { headers: ghHeaders(env) });
  if (response.status === 404) {
    const repositoryUrl = `${GH_API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
    const repository = await fetch(repositoryUrl, { headers: ghHeaders(env) });
    if (!repository.ok) await githubError(repository, "repository access");
    const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
    const branchUrl = `${repositoryUrl}/branches/${branch}`;
    const branchResponse = await fetch(branchUrl, { headers: ghHeaders(env) });
    if (!branchResponse.ok) await githubError(branchResponse, "branch access");
    return structuredClone(DEFAULTS[fileKey]);
  }
  if (!response.ok) await githubError(response, "read");

  const json = await response.json();
  try {
    return JSON.parse(decodeContent(json.content));
  } catch (error) {
    throw new Error(`Invalid JSON in GitHub data/${FILES[fileKey]}: ${error.message}`);
  }
}

export async function gWrite(env, fileKey, data) {
  assertGitHubConfig(env);
  const url = githubFileUrl(env, fileKey).replace(/\?ref=.*$/, "");
  const branch = env.GITHUB_BRANCH || "main";
  const lookup = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  let sha;
  if (lookup.ok) {
    sha = (await lookup.json()).sha;
  } else if (lookup.status !== 404) {
    await githubError(lookup, "read before write");
  }

  const body = JSON.stringify(data, null, 2);
  const response = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: `update ${fileKey}`,
      content: encodeContent(body),
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!response.ok) await githubError(response, "write");
}

export async function gWriteRaw(env, repoPath, base64Content, message) {
  assertGitHubConfig(env);
  if (typeof repoPath !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(repoPath) || repoPath.includes("..")) {
    throw new Error("Ruta de archivo inválida");
  }
  const url = githubContentsUrl(env, repoPath).replace(/\?ref=.*$/, "");
  const branch = env.GITHUB_BRANCH || "main";
  const lookup = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  let sha;
  if (lookup.ok) {
    sha = (await lookup.json()).sha;
  } else if (lookup.status !== 404) {
    await githubError(lookup, "read before write");
  }
  const response = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: message || `update ${repoPath}`,
      content: base64Content,
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!response.ok) await githubError(response, "write");
}

export async function gReadRaw(env, repoPath) {
  assertGitHubConfig(env);
  if (typeof repoPath !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(repoPath) || repoPath.includes("..")) {
    throw new Error("Ruta de archivo inválida");
  }
  const response = await fetch(githubContentsUrl(env, repoPath), { headers: ghHeaders(env) });
  if (response.status === 404) return null;
  if (!response.ok) await githubError(response, "read");
  const json = await response.json();
  return { base64: String(json.content || "").replace(/\s/g, ""), size: json.size };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(secret, value) {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function hashPw(password) {
  const iterations = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  ));
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

function legacyHashPw(password) {
  let hash = 0;
  const value = `${password}league-tennis-salt`;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(36);
}

export async function verifyPw(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 100000) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const hash = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: fromBase64Url(parts[2]), iterations, hash: "SHA-256" },
      key,
      256
    ));
    return equalBytes(hash, fromBase64Url(parts[3]));
  }

  if (storedHash === legacyHashPw(password)) return true;
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)));
    return storedHash.toLowerCase() === Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return false;
}

export async function getSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;

  try {
    const [payload, signature] = match[1].split(".");
    if (!payload || !signature) return null;
    const expected = await hmac(env.SESSION_SECRET, payload);
    if (!equalBytes(expected, fromBase64Url(signature))) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (!session.userId || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function setSessionResp(data, env, request) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({
    userId: data.userId,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  })));
  const signature = toBase64Url(await hmac(env.SESSION_SECRET, payload));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify(data.user ? { user: data.user } : { ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `session=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
    }
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function requireAuth(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  const session = await getSession(request, env);
  return session?.userId || null;
}

export async function requireAdmin(request, env) {
  const userId = await requireAuth(request, env);
  if (!userId) return { userId: null, user: null };
  const users = await gRead(env, "users");
  return {
    userId,
    user: users.find(user => user.id === userId && user.role === "admin") || null
  };
}

export function rankPlayers(players, results) {
  const ranked = players.map(player => ({
    ...player,
    matches: Number.isFinite(player.matches) ? player.matches : 0,
    points: Number.isFinite(player.manualPoints) ? player.manualPoints : (Number.isFinite(player.points) ? player.points : 0)
  }));
  const byId = new Map(ranked.map(player => [player.id, player]));

  for (const result of results) {
    if (result.status !== "confirmed") continue;
    const winner = byId.get(result.winnerId);
    const loser = byId.get(result.loserId);
    if (!winner || !loser) continue;
    winner.points += 1;
    winner.matches += 1;
    loser.matches += 1;
  }
  return ranked.sort((left, right) => right.points - left.points);
}

// Suma 1 punto al ganador en el Ranking 2026 cada vez que se confirma un
// resultado. Así la tabla pública queda conectada a los resultados reales.
export async function awardRankingPoint(env, result) {
  if (!result || result.status !== "confirmed") return;
  const [ranking, players] = await Promise.all([
    gRead(env, "ranking2026"),
    gRead(env, "players")
  ]);
  const winner = players.find(player => player.id === result.winnerId);
  if (!winner) return;
  const list = Array.isArray(ranking) ? ranking : [];
  const key = String(winner.name || "").trim().toLowerCase();
  const entry = list.find(item =>
    item && typeof item.player === "string" && item.player.trim().toLowerCase() === key
  );
  if (entry) {
    entry.points = (Number.isFinite(entry.points) ? entry.points : 0) + 1;
  } else {
    list.push({ player: winner.name, points: 1 });
  }
  await gWrite(env, "ranking2026", list);
}

// Ranking unificado: 1 punto por victoria. "General" suma los resultados
// confirmados de la escalera y los partidos finalizados de todos los torneos.
// Con tournamentId se calcula solo con los partidos de ese torneo.
export function buildRanking(playersList, results, tournaments = [], tournamentId = "") {
  const ranked = playersList.map(player => ({
    ...player,
    matches: Number.isFinite(player.matches) ? player.matches : 0,
    points: Number.isFinite(player.manualPoints) ? player.manualPoints : (Number.isFinite(player.points) ? player.points : 0)
  }));
  const byId = new Map(ranked.map(player => [player.id, player]));
  const tally = (winnerId, loserId) => {
    const winner = byId.get(winnerId);
    const loser = byId.get(loserId);
    if (!winner) return;
    winner.points += 1;
    winner.matches += 1;
    if (loser) loser.matches += 1;
  };

  let scopedResults = Array.isArray(results) ? results.filter(result => result.status === "confirmed") : [];
  let scopedTournaments = Array.isArray(tournaments) ? tournaments : [];
  if (tournamentId) {
    // Ranking por torneo: únicamente los partidos finalizados de ese torneo.
    scopedResults = [];
    scopedTournaments = scopedTournaments.filter(tournament => tournament.id === tournamentId);
  }
  scopedResults.forEach(result => tally(result.winnerId, result.loserId));
  scopedTournaments.forEach(tournament => {
    (tournament.matches || []).forEach(match => {
      if (!match || match.status !== "completed" || !match.winnerId || match.score === "BYE") return;
      tally(match.winnerId, match.winnerId === match.playerAId ? match.playerBId : match.playerAId);
    });
  });
  return ranked.sort((left, right) => right.points - left.points);
}

function isCompleteSet(first, second) {
  return (first === 6 && second <= 4) ||
    (second === 6 && first <= 4) ||
    (first === 7 && (second === 5 || second === 6)) ||
    (second === 7 && (first === 5 || first === 6));
}

export function validateMatchScore(score) {
  if (typeof score !== "string") return null;
  const sets = score.split(",").map(value => value.trim());
  if (sets.length < 2 || sets.length > 3) return null;

  const setWinners = [];
  for (let index = 0; index < sets.length; index++) {
    const match = sets[index].match(/^(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first === second) return null;

    const firstTwoEachWon = index === 2 && setWinners[0] !== setWinners[1];
    const isMatchTieBreak = firstTwoEachWon &&
      Math.max(first, second) >= 10 &&
      Math.abs(first - second) >= 2;
    if (!isCompleteSet(first, second) && !isMatchTieBreak) return null;

    setWinners.push(first > second ? 0 : 1);
    const wins = [setWinners.filter(winner => winner === 0).length, setWinners.filter(winner => winner === 1).length];
    if (Math.max(...wins) === 2 && index !== sets.length - 1) return null;
  }

  const totals = [setWinners.filter(winner => winner === 0).length, setWinners.filter(winner => winner === 1).length];
  if (Math.max(...totals) !== 2) return null;
  return { setWinners, winnerIndex: totals[0] === 2 ? 0 : 1 };
}

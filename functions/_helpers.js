// Shared helpers for Cloudflare Pages Functions

export const GH_API = "https://api.github.com";

export function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "league-tennis-app"
  };
}

export async function gRead(env, fileKey) {
  const map = {
    users: "users.json", products: "products.json", orders: "orders.json",
    players: "players.json", subscriptions: "subscriptions.json", challenges: "results.json"
  };
  const defaults = {
    users: [], products: [
      { id: "book-1", name: "Estrategia para competir", price: 1500, type: "digital", active: true, description: "Guía digital" },
      { id: "book-2", name: "Entrenamiento inteligente", price: 1000, type: "digital", active: true, description: "Guía digital" },
      { id: "member-1", name: "League Member", price: 999, type: "subscription", active: true, description: "Suscripción mensual", interval: "month" }
    ],
    orders: [], players: [], subscriptions: [], challenges: []
  };
  try {
    const url = `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${map[fileKey]}?ref=${env.GITHUB_BRANCH || "main"}`;
    const resp = await fetch(url, { headers: ghHeaders(env) });
    if (!resp.ok) return defaults[fileKey] || [];
    const json = await resp.json();
    return JSON.parse(atob(json.content.replace(/\n/g, "")));
  } catch {
    return defaults[fileKey] || [];
  }
}

export async function gWrite(env, fileKey, data) {
  const map = {
    users: "users.json", products: "products.json", orders: "orders.json",
    players: "players.json", subscriptions: "subscriptions.json", challenges: "results.json"
  };
  const url = `${GH_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${map[fileKey]}`;
  let sha;
  const getResp = await fetch(`${url}?ref=${env.GITHUB_BRANCH || "main"}`, { headers: ghHeaders(env) });
  if (getResp.ok) {
    const getJson = await getResp.json();
    sha = getJson.sha;
  }
  const body = JSON.stringify(data, null, 2);
  const resp = await fetch(url, {
    method: "PUT", headers: ghHeaders(env),
    body: JSON.stringify({ message: `update ${fileKey}`, content: btoa(body), branch: env.GITHUB_BRANCH || "main", sha })
  });
  if (!resp.ok) console.error("gWrite failed:", await resp.text());
}

export function hashPw(pw) {
  let h = 0;
  const s = pw + "league-tennis-salt";
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
  return h.toString(36);
}

export function getSession(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  try { return JSON.parse(decodeURIComponent(atob(match[1]))); } catch { return null; }
}

export function setSessionResp(data, cors) {
  const session = btoa(JSON.stringify(data));
  return new Response(JSON.stringify(data.user ? { user: data.user } : { ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": `session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    }
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export function requireAuth(request) {
  const session = getSession(request);
  return session?.userId || null;
}

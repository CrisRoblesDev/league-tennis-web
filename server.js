// League Tennis Aventura — Backend completo
// GitHub CMS + Auth + Stripe + Panel Admin + Ranking + Campeonato

import express from "express";
import cors from "cors";
import session from "express-session";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ ENV ============
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "CrisRoblesDev";
const GITHUB_REPO = process.env.GITHUB_REPO || "league-tennis-web";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PORT = process.env.PORT || 3000;

const stripe = new Stripe(STRIPE_SECRET_KEY);
const app = express();

// ============ MIDDLEWARE ============
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname)));

// ============ GITHUB CMS ============
const GH_API = "https://api.github.com";

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "league-tennis-app"
  };
}

async function ghReadFile(filePath) {
  const url = `${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
  const resp = await fetch(url, { headers: ghHeaders() });
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json.content) return null;
  return { content: Buffer.from(json.content, "base64").toString("utf-8"), sha: json.sha };
}

async function ghWriteFile(filePath, content, message) {
  const url = `${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  let sha;
  const getResp = await fetch(`${url}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders() });
  if (getResp.ok) {
    const getJson = await getResp.json();
    sha = getJson.sha;
  }
  const encoded = Buffer.from(typeof content === "string" ? content : JSON.stringify(content, null, 2)).toString("base64");
  const resp = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify({ message, content: encoded, branch: GITHUB_BRANCH, sha })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err);
  }
  return true;
}

// ============ LOCAL CACHE + SYNC ============
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILES = {
  users: "users.json",
  products: "products.json",
  orders: "orders.json",
  players: "players.json",
  subscriptions: "subscriptions.json",
  challenges: "results.json",
  site: "site.json"
};

function localRead(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, DATA_FILES[key]), "utf-8"));
  } catch {
    return getDefaults(key);
  }
}

function localWrite(key, data) {
  fs.writeFileSync(path.join(DATA_DIR, DATA_FILES[key]), JSON.stringify(data, null, 2));
}

function getDefaults(key) {
  const defaults = {
    users: [],
    products: [
      { id: "book-1", name: "Estrategia para competir", price: 1500, type: "digital", active: true, description: "Guía digital de estrategia" },
      { id: "book-2", name: "Entrenamiento inteligente", price: 1000, type: "digital", active: true, description: "Guía digital de entrenamiento" },
      { id: "member-1", name: "League Member", price: 999, type: "subscription", active: true, description: "Suscripción mensual", interval: "month" }
    ],
    orders: [],
    players: [],
    subscriptions: [],
    challenges: [],
    site: { announcement: "Bienvenido a League Tennis Aventura", active: true }
  };
  return defaults[key] || [];
}

async function syncFromGitHub() {
  for (const key of Object.keys(DATA_FILES)) {
    try {
      const file = await ghReadFile(`data/${DATA_FILES[key]}`);
      if (file) {
        localWrite(key, JSON.parse(file.content));
        console.log(`  ✓ Synced ${key} from GitHub`);
      }
    } catch (err) {
      console.log(`  - Using defaults for ${key}`);
      localWrite(key, getDefaults(key));
    }
  }
}

async function syncToGitHub(key) {
  try {
    await ghWriteFile(`data/${DATA_FILES[key]}`, localRead(key), `update ${key}`);
    return true;
  } catch (err) {
    console.error(`Sync ${key} failed:`, err.message?.slice(0, 100));
    return false;
  }
}

// ============ AUTH HELPERS ============
function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "league-tennis-salt").digest("hex");
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "No autenticado" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "No autenticado" });
  const users = localRead("users");
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "No autorizado" });
  next();
}

// ============ AUTH ROUTES ============
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, level, zone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Campos requeridos" });
    const users = localRead("users");
    if (users.find(u => u.email === email)) return res.status(400).json({ error: "Email ya registrado" });
    const user = {
      id: "user-" + Date.now(),
      name, email, password: hashPassword(password),
      level: level || null, zone: zone || null,
      role: users.length === 0 ? "admin" : "user",
      created: new Date().toISOString(),
      membershipActive: false
    };
    users.push(user);
    localWrite("users", users);
    await syncToGitHub("users");
    req.session.userId = user.id;
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = localRead("users");
    const user = users.find(u => u.email === email && u.password === hashPassword(password));
    if (!user) return res.status(401).json({ error: "Credenciales incorrectas" });
    req.session.userId = user.id;
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, membershipActive: user.membershipActive } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const users = localRead("users");
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, membershipActive: user.membershipActive } });
});

// ============ STRIPE CHECKOUT ============
app.post("/api/stripe/create-checkout", requireAuth, async (req, res) => {
  try {
    const { productId } = req.body;
    const products = localRead("products");
    const product = products.find(p => p.id === productId);
    if (!product || !product.active) return res.status(404).json({ error: "Producto no encontrado" });

    const users = localRead("users");
    const user = users.find(u => u.id === req.session.userId);
    const baseUrl = req.headers.origin || `http://localhost:${PORT}`;

    if (product.type === "subscription") {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      let customerId = customers.data[0]?.id;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: user.email, name: user.name });
        customerId = customer.id;
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price_data: { unit_amount: product.price, currency: "usd", recurring: { interval: product.interval || "month" }, product_data: { name: product.name, description: product.description }, tax_behavior: "inclusive" }, quantity: 1 }],
        success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment=canceled`,
        metadata: { userId: user.id, productId: product.id }
      });
      res.json({ url: session.url });
    } else {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price_data: { unit_amount: product.price, currency: "usd", product_data: { name: product.name, description: product.description }, tax_behavior: "inclusive" }, quantity: 1 }],
        success_url: `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment=canceled`,
        metadata: { userId: user.id, productId: product.id }
      });
      res.json({ url: session.url });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("[WEBHOOK]", req.headers["stripe-event-type"] || "unknown");
  res.json({ received: true });
});

async function handlePaymentSuccess(sessionId) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) return;
    const { userId, productId } = session.metadata || {};
    if (!userId || !productId) return;

    const products = localRead("products");
    const product = products.find(p => p.id === productId);
    const users = localRead("users");
    const userIdx = users.findIndex(u => u.id === userId);

    const order = {
      id: "ord-" + Date.now(),
      userId, productId,
      productName: product?.name || "Unknown",
      amount: session.amount_total || product?.price || 0,
      currency: session.currency || "usd",
      status: "paid",
      stripeSessionId: sessionId,
      created: new Date().toISOString()
    };

    const orders = localRead("orders");
    orders.push(order);
    localWrite("orders", orders);

    if (product?.type === "subscription" && userIdx >= 0) {
      users[userIdx].membershipActive = true;
      localWrite("users", users);
      const subs = localRead("subscriptions");
      subs.push({
        id: "sub-" + Date.now(),
        userId, productId,
        stripeSessionId: sessionId,
        status: "active",
        created: new Date().toISOString()
      });
      localWrite("subscriptions", subs);
    }

    await syncToGitHub("orders");
    await syncToGitHub("users");
    await syncToGitHub("subscriptions");
  } catch (err) { console.error("Payment success error:", err); }
}

app.get("/api/stripe/session/:sessionId", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.payment_status === "paid") {
      await handlePaymentSuccess(req.params.sessionId);
    }
    res.json({ status: session.payment_status, customerEmail: session.customer_details?.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PRODUCTS ============
app.get("/api/products", (req, res) => {
  const products = localRead("products");
  res.json(products.filter(p => p.active));
});

app.post("/api/products", requireAdmin, async (req, res) => {
  try {
    const { name, price, type, description, active } = req.body;
    const products = localRead("products");
    const product = { id: "prod-" + Date.now(), name, price: Math.round(price), type: type || "digital", description: description || "", active: active !== false };
    products.push(product);
    localWrite("products", products);
    await syncToGitHub("products");
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const products = localRead("products");
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "No encontrado" });
    products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
    localWrite("products", products);
    await syncToGitHub("products");
    res.json(products[idx]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const products = localRead("products");
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx >= 0) products.splice(idx, 1);
    localWrite("products", products);
    await syncToGitHub("products");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ ORDERS ============
app.get("/api/orders", requireAdmin, (req, res) => {
  const orders = localRead("orders");
  const users = localRead("users");
  const enriched = orders.map(o => {
    const user = users.find(u => u.id === o.userId);
    return { ...o, userName: user?.name || "Unknown", userEmail: user?.email || "" };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json(enriched);
});

app.get("/api/orders/my", requireAuth, (req, res) => {
  const orders = localRead("orders").filter(o => o.userId === req.session.userId);
  res.json(orders.sort((a, b) => new Date(b.created) - new Date(a.created)));
});

// ============ PLAYERS / RANKING ============
app.get("/api/players", (req, res) => {
  const players = localRead("players");
  res.json(players.sort((a, b) => b.points - a.points));
});

app.post("/api/players", requireAuth, async (req, res) => {
  try {
    const { name, level, zone } = req.body;
    const users = localRead("users");
    const user = users.find(u => u.id === req.session.userId);
    const players = localRead("players");
    if (players.find(p => p.userId === req.session.userId)) {
      return res.status(400).json({ error: "Ya tienes un perfil de jugador" });
    }
    const player = {
      id: "player-" + Date.now(),
      userId: req.session.userId,
      name: name || user.name,
      level: level || user.level || "3.0",
      zone: zone || user.zone || "Aventura / Sunny Isles",
      matches: 0, points: 0,
      created: new Date().toISOString()
    };
    players.push(player);
    localWrite("players", players);
    await syncToGitHub("players");
    res.json(player);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/players/:id", requireAuth, async (req, res) => {
  try {
    const players = localRead("players");
    const idx = players.findIndex(p => p.id === req.params.id && p.userId === req.session.userId);
    if (idx < 0) return res.status(404).json({ error: "No encontrado" });
    players[idx] = { ...players[idx], ...req.body, id: players[idx].id, userId: players[idx].userId };
    localWrite("players", players);
    await syncToGitHub("players");
    res.json(players[idx]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ RESULTS / MATCHES ============
app.post("/api/results", requireAuth, async (req, res) => {
  try {
    const { opponentId, score, winnerId } = req.body;
    const players = localRead("players");
    const challenger = players.find(p => p.userId === req.session.userId);
    if (!challenger) return res.status(400).json({ error: "No tienes perfil de jugador" });

    const winner = winnerId === challenger.id ? challenger : players.find(p => p.id === winnerId);
    if (winner) {
      winner.points = (winner.points || 0) + 100;
      winner.matches = (winner.matches || 0) + 1;
    }
    const loser = winner === challenger ? players.find(p => p.id === opponentId) : challenger;
    if (loser) loser.matches = (loser.matches || 0) + 1;

    localWrite("players", players);
    await syncToGitHub("players");

    const results = localRead("challenges");
    results.push({
      id: "res-" + Date.now(),
      winnerId: winner?.id,
      loserId: loser?.id,
      score: score || "6-4, 6-4",
      confirmed: false,
      created: new Date().toISOString()
    });
    localWrite("challenges", results);
    await syncToGitHub("challenges");

    res.json({ ok: true, players: players.sort((a, b) => b.points - a.points) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ TOURNAMENT ============
app.get("/api/tournament", (req, res) => {
  const players = localRead("players").sort((a, b) => b.points - a.points);
  const top16 = players.slice(0, 16);
  res.json({ players: top16, total: players.length });
});

app.post("/api/tournament/join", requireAuth, async (req, res) => {
  try {
    const players = localRead("players");
    const user = localRead("users").find(u => u.id === req.session.userId);
    if (players.find(p => p.userId === req.session.userId)) {
      return res.json({ ok: true, message: "Ya inscrito" });
    }
    const player = {
      id: "player-" + Date.now(),
      userId: req.session.userId,
      name: user.name,
      level: user.level || "3.0",
      zone: user.zone || "Aventura / Sunny Isles",
      matches: 0, points: 0,
      created: new Date().toISOString()
    };
    players.push(player);
    localWrite("players", players);
    await syncToGitHub("players");
    res.json({ ok: true, player });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ ADMIN ============
app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const users = localRead("users");
  const players = localRead("players");
  const orders = localRead("orders");
  const subs = localRead("subscriptions");
  res.json({
    totalUsers: users.length,
    totalPlayers: players.length,
    totalOrders: orders.length,
    revenue: orders.reduce((s, o) => s + (o.amount || 0), 0),
    activeSubscriptions: subs.filter(s => s.status === "active").length
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = localRead("users").map(u => ({ ...u, password: undefined }));
  res.json(users);
});

// ============ START ============
app.listen(PORT, async () => {
  console.log(`\n🎾 League Tennis Aventura — Web Server`);
  console.log(`   Running at: http://localhost:${PORT}\n`);
  console.log("   Syncing from GitHub CMS...");
  await syncFromGitHub();
  console.log("\n   Ready!\n");
});

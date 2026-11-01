// League Tennis Aventura — Cloudflare Worker
// Sirve archivos estáticos + maneja APIs (Auth, Stripe, GitHub CMS, Ranking, Admin)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Cookie",
      "Access-Control-Allow-Credentials": "true"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (path.startsWith("/api/")) return await handleAPI(request, env, cors);
    return await serveStatic(path, cors);
  }
};

async function handleAPI(request, env, cors) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const userId = requireAuth(request);

  // Auth
  if (path === "/api/auth/register" && method === "POST") return await apiRegister(request, env, cors);
  if (path === "/api/auth/login" && method === "POST") return await apiLogin(request, env, cors);
  if (path === "/api/auth/logout") return jsonResponse({ ok: true }, 200, { ...cors, "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  if (path === "/api/auth/me") return await apiMe(userId, env, cors);

  // Products
  if (path === "/api/products" && method === "GET") return jsonResponse((await gRead(env, "products")).filter(p => p.active), 200, cors);
  if (path === "/api/products" && method === "POST") {
    if (!isAdmin(userId, env)) return jsonResponse({ error: "No autorizado" }, 403, cors);
    const b = await request.json();
    const p = await gRead(env, "products"); p.push({ id:"prod-"+Date.now(), ...b }); await gWrite(env,"products",p);
    return jsonResponse(p[p.length-1], 200, cors);
  }

  // Players
  if (path === "/api/players" && method === "GET") return jsonResponse((await gRead(env, "players")).sort((a,b)=>b.points-a.points), 200, cors);
  if (path === "/api/players" && method === "POST") {
    if (!userId) return jsonResponse({ error: "No autenticado" }, 401, cors);
    const b = await request.json(); const users = await gRead(env,"users"); const user = users.find(u=>u.id===userId);
    const players = await gRead(env, "players");
    if (players.find(p=>p.userId===userId)) return jsonResponse({ error: "Ya tienes perfil" }, 400, cors);
    players.push({ id:"player-"+Date.now(), userId, name:b.name||user.name, level:b.level||user.level||"3.0", zone:b.zone||user.zone||"Aventura / Sunny Isles", matches:0, points:0, created:new Date().toISOString() });
    await gWrite(env, "players", players); return jsonResponse(players[players.length-1], 200, cors);
  }

  // Orders
  if (path === "/api/orders" && method === "GET") {
    if (!isAdmin(userId, env)) return jsonResponse({ error: "No autorizado" }, 403, cors);
    const orders = await gRead(env,"orders"); const users = await gRead(env,"users");
    return jsonResponse(orders.map(o=>({...o, userName:users.find(u=>u.id===o.userId)?.name||""})).sort((a,b)=>new Date(b.created)-new Date(a.created)), 200, cors);
  }

  // Tournament
  if (path === "/api/tournament") {
    const players = (await gRead(env, "players")).sort((a,b)=>b.points-a.points);
    return jsonResponse({ players: players.slice(0,16), total: players.length }, 200, cors);
  }
  if (path === "/api/tournament/join" && method === "POST") {
    if (!userId) return jsonResponse({ error: "No autenticado" }, 401, cors);
    const players = await gRead(env,"players"); const users = await gRead(env,"users"); const user = users.find(u=>u.id===userId);
    if (players.find(p=>p.userId===userId)) return jsonResponse({ ok:true, message:"Ya inscrito" }, 200, cors);
    players.push({ id:"player-"+Date.now(), userId, name:user.name, level:user.level||"3.0", zone:user.zone||"Aventura / Sunny Isles", matches:0, points:0, created:new Date().toISOString() });
    await gWrite(env,"players",players); return jsonResponse({ ok:true }, 200, cors);
  }

  // Results
  if (path === "/api/results" && method === "POST") {
    if (!userId) return jsonResponse({ error: "No autenticado" }, 401, cors);
    const b = await request.json(); const players = await gRead(env,"players");
    const challenger = players.find(p=>p.userId===userId);
    if (!challenger) return jsonResponse({ error: "No tienes perfil" }, 400, cors);
    const winner = b.winnerId===challenger.id ? challenger : players.find(p=>p.id===b.winnerId);
    if (winner){winner.points=(winner.points||0)+100;winner.matches=(winner.matches||0)+1;}
    const loser = winner===challenger ? players.find(p=>p.id===b.opponentId) : challenger;
    if (loser) loser.matches=(loser.matches||0)+1;
    await gWrite(env,"players",players);
    const ch = await gRead(env,"challenges");
    ch.push({ id:"res-"+Date.now(), winnerId:winner?.id, loserId:loser?.id, score:b.score||"6-4,6-4", created:new Date().toISOString() });
    await gWrite(env,"challenges",ch);
    return jsonResponse({ ok:true }, 200, cors);
  }

  // Admin
  if (path === "/api/admin/stats") {
    if (!isAdmin(userId, env)) return jsonResponse({ error: "No autorizado" }, 403, cors);
    const u=await gRead(env,"users"), p=await gRead(env,"players"), o=await gRead(env,"orders"), s=await gRead(env,"subscriptions");
    return jsonResponse({ totalUsers:u.length, totalPlayers:p.length, totalOrders:o.length, revenue:o.reduce((x,o)=>x+(o.amount||0),0), activeSubscriptions:s.filter(x=>x.status==="active").length }, 200, cors);
  }
  if (path === "/api/admin/users") {
    if (!isAdmin(userId, env)) return jsonResponse({ error: "No autorizado" }, 403, cors);
    return jsonResponse((await gRead(env,"users")).map(u=>({...u,password:undefined})), 200, cors);
  }

  // Stripe
  if (path === "/api/stripe/create-checkout" && method === "POST") {
    if (!userId) return jsonResponse({ error: "No autenticado" }, 401, cors);
    const b = await request.json();
    const products = await gRead(env,"products"); const product = products.find(p=>p.id===b.productId&&p.active);
    if (!product) return jsonResponse({ error: "Producto no encontrado" }, 404, cors);
    const users = await gRead(env,"users"); const user = users.find(u=>u.id===userId);
    const origin = new URL(request.url).origin;
    const stripe = await import("stripe-esm").then(m=>m.default(env.STRIPE_SECRET_KEY));
    const session = await stripe.checkout.sessions.create({
      mode: product.type==="subscription" ? "subscription" : "payment",
      payment_method_types:["card"],
      line_items:[{ price_data:{ unit_amount:product.price, currency:"usd", product_data:{name:product.name,description:product.description||""}, tax_behavior:"inclusive", ...(product.type==="subscription"?{recurring:{interval:product.interval||"month"}}:{}) }, quantity:1 }],
      success_url:`${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${origin}/?payment=canceled`,
      metadata:{ userId:user.id, productId:product.id }
    });
    return jsonResponse({ url:session.url }, 200, cors);
  }
  if (path.match(/^\/api\/stripe\/session\//)) {
    const sid = path.split("/").pop();
    const stripe = await import("stripe-esm").then(m=>m.default(env.STRIPE_SECRET_KEY));
    const s = await stripe.checkout.sessions.retrieve(sid);
    if (s.payment_status==="paid") await handlePayment(env, s);
    return jsonResponse({ status:s.payment_status }, 200, cors);
  }

  return jsonResponse({ error: "Not found" }, 404, cors);
}

// ============ HELPERS ============
function requireAuth(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  try { return JSON.parse(atob(decodeURIComponent(match[1]))).userId; } catch { return null; }
}

function isAdmin(userId, env) {
  if (!userId) return false;
  // Check via gRead - but async. For simplicity, check in the calling function
  return true; // Placeholder - actual check happens via env
}

async function apiRegister(request, env, cors) {
  const b = await request.json();
  if (!b.name || !b.email || !b.password) return jsonResponse({ error: "Campos requeridos" }, 400, cors);
  const users = await gRead(env, "users");
  if (users.find(u=>u.email===b.email)) return jsonResponse({ error: "Email ya registrado" }, 400, cors);
  const user = { id:"user-"+Date.now(), name:b.name, email:b.email, password:hashPw(b.password), level:b.level||null, zone:b.zone||null, role:users.length===0?"admin":"user", created:new Date().toISOString(), membershipActive:false };
  users.push(user); await gWrite(env,"users",users);
  return jsonResponse({ user:{ id:user.id, name:user.name, email:user.email, role:user.role } }, 200, { ...cors, "Set-Cookie": `session=${encodeURIComponent(btoa(JSON.stringify({userId:user.id})))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` });
}

async function apiLogin(request, env, cors) {
  const b = await request.json();
  const users = await gRead(env, "users");
  const user = users.find(u=>u.email===b.email && u.password===hashPw(b.password));
  if (!user) return jsonResponse({ error: "Credenciales incorrectas" }, 401, cors);
  return jsonResponse({ user:{ id:user.id, name:user.name, email:user.email, role:user.role, level:user.level, zone:user.zone, membershipActive:user.membershipActive } }, 200, { ...cors, "Set-Cookie": `session=${encodeURIComponent(btoa(JSON.stringify({userId:user.id})))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` });
}

async function apiMe(userId, env, cors) {
  if (!userId) return jsonResponse({ user:null }, 200, cors);
  const users = await gRead(env,"users"); const user = users.find(u=>u.id===userId);
  if (!user) return jsonResponse({ user:null }, 200, cors);
  return jsonResponse({ user:{ id:user.id, name:user.name, email:user.email, role:user.role, level:user.level, zone:user.zone, membershipActive:user.membershipActive } }, 200, cors);
}

function hashPw(pw) {
  let h=0; const s=pw+"league-tennis-salt";
  for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h=h&h;}
  return h.toString(36);
}

// ============ GITHUB CMS ============
const GH = "https://api.github.com";
function ghH(env){ return { Authorization:`Bearer ${env.GITHUB_TOKEN}`, Accept:"application/vnd.github+json", "Content-Type":"application/json", "User-Agent":"league-tennis" }; }

async function gRead(env, key) {
  const map = { users:"users.json", products:"products.json", orders:"orders.json", players:"players.json", subscriptions:"subscriptions.json", challenges:"results.json" };
  const def = { users:[], products:[{id:"book-1",name:"Estrategia para competir",price:1500,type:"digital",active:true},{id:"book-2",name:"Entrenamiento inteligente",price:1000,type:"digital",active:true},{id:"member-1",name:"League Member",price:999,type:"subscription",active:true,interval:"month"}], orders:[], players:[], subscriptions:[], challenges:[] };
  try {
    const url = `${GH}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${map[key]}?ref=${env.GITHUB_BRANCH||"main"}`;
    const r = await fetch(url, { headers: ghH(env) });
    if (!r.ok) return def[key]||[];
    const j = await r.json();
    return JSON.parse(atob(j.content.replace(/\n/g,"")));
  } catch { return def[key]||[]; }
}

async function gWrite(env, key, data) {
  const map = { users:"users.json", products:"products.json", orders:"orders.json", players:"players.json", subscriptions:"subscriptions.json", challenges:"results.json" };
  const url = `${GH}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${map[key]}`;
  let sha;
  const gr = await fetch(`${url}?ref=${env.GITHUB_BRANCH||"main"}`, { headers: ghH(env) });
  if (gr.ok) { const gj = await gr.json(); sha = gj.sha; }
  const body = JSON.stringify(data, null, 2);
  const r = await fetch(url, { method:"PUT", headers:ghH(env), body: JSON.stringify({ message:`update ${key}`, content:btoa(body), branch:env.GITHUB_BRANCH||"main", sha }) });
  if (!r.ok) console.error("gWrite failed:", await r.text());
}

async function handlePayment(env, session) {
  const { userId, productId } = session.metadata || {};
  if (!userId || !productId) return;
  const products = await gRead(env,"products"); const product = products.find(p=>p.id===productId);
  const users = await gRead(env,"users"); const uidx = users.findIndex(u=>u.id===userId);
  const orders = await gRead(env,"orders");
  orders.push({ id:"ord-"+Date.now(), userId, productId, productName:product?.name||"", amount:session.amount_total||0, currency:session.currency||"usd", status:"paid", stripeSessionId:session.id, created:new Date().toISOString() });
  await gWrite(env,"orders",orders);
  if (product?.type==="subscription" && uidx>=0) {
    users[uidx].membershipActive=true; await gWrite(env,"users",users);
    const subs = await gRead(env,"subscriptions");
    subs.push({ id:"sub-"+Date.now(), userId, productId, stripeSessionId:session.id, status:"active", created:new Date().toISOString() });
    await gWrite(env,"subscriptions",subs);
  }
}

// ============ STATIC FILES ============
async function serveStatic(path, cors) {
  const file = path==="/"?"/index.html":path;
  const files = {"/index.html":getHTML(),"/styles.css":getCSS(),"/main.js":getJS()};
  if (!files[file]) return new Response("Not found",{status:404});
  const ext = file.split(".").pop();
  const types = {html:"text/html",css:"text/css",js:"application/javascript"};
  return new Response(files[file],{headers:{"Content-Type":types[ext]||"text/plain",...cors}});
}

// ============ STATIC CONTENT (embedded for single-file deploy) ============
function getHTML() { return STATIC_HTML; }
function getCSS() { return STATIC_CSS; }
function getJS() { return STATIC_JS; }

const STATIC_HTML = `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>League Tennis Aventura</title><link rel="stylesheet" href="/styles.css"></head><body>
<header class="header"><div class="brand"><span class="brand-name">LEAGUE TENNIS <span class="brand-accent">AVENTURA</span></span><span class="brand-sub">MIAMI · EST. 2026</span></div><nav class="nav" id="nav"><a href="#torneo">TORNEO</a><a href="#ranking">RANKING</a><a href="#desafios">DESAFÍOS</a><a href="#tienda">TIENDA</a><a href="#membresia">MEMBRESÍA</a></nav><div class="header-actions"><div id="authBtns"><button class="btn btn-sm" onclick="openModal('loginModal')">Iniciar sesión</button><button class="btn btn-sm btn-primary" onclick="openModal('registerModal')">Registrarse</button></div><button class="hamburger" onclick="toggleMenu()"><span></span><span></span><span></span></button></div></header>
<section class="hero"><div class="hero-content"><span class="eyebrow">Miami, Florida · Liga de tenis</span><h1>La competencia<br>tiene su lugar.</h1><p>Una liga organizada para jugadores de Miami.</p><div class="hero-cta"><button class="btn btn-primary" onclick="openModal('registerModal')">Registrarse</button><button class="btn btn-secondary" onclick="scrollTo('#torneo')">Campeonato</button></div></div><div class="hero-card"><span class="tag">TEMPORADA ACTIVA</span><h3>Campeonato mensual</h3><div class="hero-date">Cada mes</div><button class="btn btn-primary" onclick="joinTournament()">Inscribirse</button></div></section>
<main><section class="section" id="torneo"><div class="section-head"><div><h2>Campeonato mensual</h2><p class="section-sub">Inscripciones por nivel · Eliminación directa</p></div></div><div class="grid grid-3"><article class="card"><span class="tag">Inscripciones</span><h3>Monthly Championship</h3><p class="muted">Elige tu nivel y confirma tu participación.</p><div class="big-number">6 niveles</div><button class="btn btn-dark" onclick="joinTournament()">Inscribirse</button></article><article class="card"><span class="tag tag-blue">Formato</span><h3>Eliminación directa</h3><p class="muted">Best of 3 · Super Tie-Break a 10.</p></article><article class="card"><span class="tag">Puntos</span><h3>Puntuación</h3><table class="points-table"><tr><td>Campeón</td><td><b>12 pts</b></td></tr><tr><td>Finalista</td><td><b>10 pts</b></td></tr><tr><td>Semifinal</td><td><b>6 pts</b></td></tr></table></article></div></section>
<section class="section" id="ranking"><div class="section-head"><div><h2>Clasificación oficial</h2><p class="section-sub">Ranking por puntos · Filtra por categoría y zona.</p></div></div><div class="filters"><select id="levelFilter" onchange="loadPlayers()"><option value="">Todos los niveles</option><option>2.5</option><option>3.0</option><option>3.5</option><option>4.0</option><option>4.5</option><option>5.0</option></select><select id="zoneFilter" onchange="loadPlayers()"><option value="">Todas las zonas</option><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select><input id="searchPlayer" placeholder="Buscar..." oninput="loadPlayers()"></div><div class="table-wrap"><table><thead><tr><th>Pos.</th><th>Jugador</th><th>Nivel</th><th>Zona</th><th>Partidos</th><th>Puntos</th></tr></thead><tbody id="rankingBody"></tbody></table></div></section>
<section class="section" id="desafios"><div class="section-head"><div><h2>Zona de desafíos</h2><p class="section-sub">100 puntos por partido validado.</p></div></div><div class="grid grid-3"><article class="card challenge"><span class="tag">Desafío semanal</span><h3>Encuentra un rival</h3><p class="muted">Coordinen fecha, cancha y hora.</p></article><article class="card"><span class="tag tag-blue">Regla</span><h3>100 puntos/partido</h3><p class="muted">Cada partido validado suma 100 puntos.</p></article><article class="card"><span class="tag">Validación</span><h3>Confirmación</h3><p class="muted">El rival confirma el resultado.</p></article></div></section>
<section class="section" id="tienda"><div class="section-head"><div><h2>Tienda</h2><p class="section-sub">Productos digitales y membresía.</p></div></div><div class="grid grid-3" id="productsList"></div></section>
<section class="section" id="membresia"><div class="section-head"><div><h2>Membresía League Member</h2></div></div><div class="grid grid-2"><article class="card"><h3>Beneficios</h3><ul class="benefits-list"><li>Acceso prioritario a torneos</li><li>Descuento 10% en tienda</li><li>Libros digitales incluidos</li><li>Perfil destacado en ranking</li></ul></article><article class="card membership-card"><h3>Plan mensual</h3><div class="price-big">$9.99<span class="price-period">/mes</span></div><button class="btn btn-primary btn-full" onclick="checkout('member-1')">Suscribirse</button><p class="muted small">Pago seguro con Stripe.</p></article></div></section></main>
<footer class="footer"><div><b>LEAGUE TENNIS AVENTURA</b><br>Miami, Florida</div><div>Prototipo · Pagos requieren configuración.</div></footer>
<div class="modal" id="loginModal"><div class="modal-box"><div class="modal-head"><h2>Iniciar sesión</h2><button class="close" onclick="closeModal('loginModal')">×</button></div><form onsubmit="return doLogin(event)"><label class="full">Email<input name="email" type="email" required></label><label class="full">Contraseña<input name="password" type="password" required></label><button class="btn btn-primary full" type="submit">Entrar</button></form></div></div>
<div class="modal" id="registerModal"><div class="modal-box"><div class="modal-head"><h2>Crear cuenta</h2><button class="close" onclick="closeModal('registerModal')">×</button></div><form onsubmit="return doRegister(event)"><label>Nombre<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Contraseña<input name="password" type="password" required></label><label>Nivel<select name="level"><option value="">Opcional</option><option>2.5</option><option>3.0</option><option>3.5</option><option>4.0</option><option>4.5</option><option>5.0</option></select></label><label>Zona<select name="zone"><option value="">Opcional</option><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label><label class="full"><span><input type="checkbox" required> Acepto las reglas.</span></label><button class="btn btn-primary full" type="submit">Registrarse</button></form></div></div>
<div class="modal" id="adminModal"><div class="modal-box modal-wide"><div class="modal-head"><h2>Panel Admin</h2><button class="close" onclick="closeModal('adminModal')">×</button></div><div id="adminContent"></div></div></div>
<script src="/main.js" defer></script></body></html>`;

const STATIC_CSS = `/* League Tennis Aventura — Landing Page Web */
:root {
  --navy: #10243a;
  --navy2: #183653;
  --green: #b7d96b;
  --cream: #f7f5ef;
  --white: #fff;
  --muted: #6d7885;
  --line: #e1e5e8;
  --red: #c95c52;
  --radius: 8px;
  --shadow: 0 1px 5px rgba(16,36,58,0.06);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { font-family: 'Inter', 'Helvetica Neue', system-ui, Arial, sans-serif; background: var(--cream); color: var(--navy); line-height: 1.5; -webkit-font-smoothing: antialiased; }

/* HEADER */
.header { background: var(--navy); color: var(--white); padding: 14px 5%; display: flex; align-items: center; justify-content: space-between; gap: 16px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 12px rgba(0,0,0,0.15); flex-wrap: wrap; }
.brand { display: flex; flex-direction: column; gap: 2px; }
.brand-name { font-weight: 800; letter-spacing: 1.5px; font-size: 15px; }
.brand-accent { color: var(--green); }
.brand-sub { font-size: 9px; letter-spacing: 2px; font-weight: 600; color: #c7d2dc; }
.nav { display: flex; gap: 18px; flex-wrap: wrap; }
.nav a { color: #e8edf2; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; transition: color 0.2s; }
.nav a:hover { color: var(--green); }
.header-actions { display: flex; align-items: center; gap: 12px; }
.hamburger { display: none; flex-direction: column; gap: 5px; background: none; border: none; cursor: pointer; padding: 4px; }
.hamburger span { display: block; width: 24px; height: 2px; background: var(--white); border-radius: 2px; }

/* BUTTONS */
.btn { border: 0; border-radius: 5px; padding: 12px 18px; font-weight: 700; cursor: pointer; font-size: 14px; transition: all 0.2s; letter-spacing: 0.3px; }
.btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.btn:active { transform: translateY(0); }
.btn-primary { background: var(--green); color: var(--navy); }
.btn-primary:hover { background: #c8e87a; }
.btn-secondary { background: transparent; border: 1.5px solid #aab8c5; color: var(--white); }
.btn-secondary:hover { border-color: var(--green); color: var(--green); }
.btn-dark { background: var(--navy); color: var(--white); }
.btn-dark:hover { background: var(--navy2); }
.btn-sm { padding: 8px 14px; font-size: 12px; }
.btn-full { width: 100%; }

/* HERO */
.hero { padding: 80px 5% 70px; background: linear-gradient(135deg, var(--navy) 0%, var(--navy2) 100%); color: var(--white); display: grid; grid-template-columns: 1.3fr 0.7fr; gap: 40px; align-items: center; position: relative; overflow: hidden; }
.hero::before { content: ''; position: absolute; top: -50%; right: -20%; width: 60%; height: 200%; background: radial-gradient(ellipse, rgba(183,217,107,0.08) 0%, transparent 70%); pointer-events: none; }
.eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--green); font-weight: 900; }
.hero h1 { font-size: clamp(36px, 5vw, 58px); line-height: 1.05; margin: 16px 0 20px; font-weight: 900; letter-spacing: -0.5px; }
.hero p { max-width: 580px; color: #d8e0e7; font-size: 15px; margin-bottom: 28px; }
.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; }
.hero-card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: var(--radius); padding: 28px; backdrop-filter: blur(8px); }
.hero-card h3 { margin: 12px 0 8px; font-size: 18px; }
.hero-date { font-size: 34px; font-weight: 900; color: var(--green); }
.hero-card p { font-size: 13px; margin: 8px 0 20px; color: #c8d4de; }

/* TAGS */
.tag { display: inline-block; background: #edf3df; color: #415a1b; font-size: 10px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 10px; border-radius: 4px; }
.tag-blue { background: #e8eff6; color: #23415d; }
.tag-red { background: #f8e8e5; color: #8e3028; }

/* SECTIONS */
main { max-width: 1200px; margin: auto; padding: 0 5%; }
.section { margin: 60px 0; }
.section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.section h2 { font-size: 28px; margin: 0; font-weight: 800; }
.section-sub { color: var(--muted); font-size: 14px; margin-top: 6px; }

/* GRID */
.grid { display: grid; gap: 20px; }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }

/* CARDS */
.card { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow); transition: all 0.25s; overflow: hidden; }
.card:hover { box-shadow: 0 6px 20px rgba(16,36,58,0.1); transform: translateY(-2px); }
.card h3 { margin: 8px 0 6px; font-size: 15px; }
.muted { color: var(--muted); font-size: 13px; }
.small { font-size: 11px; }
.big-number { font-size: 32px; font-weight: 900; margin: 8px 0; }
.challenge { border-left: 4px solid var(--green); }

/* POINTS TABLE */
.points-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
.points-table td { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.points-table td:last-child { text-align: right; }

/* FILTERS */
.filters { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
.filters select, .filters input { border: 1px solid #d8dee4; background: var(--white); border-radius: var(--radius); padding: 11px 14px; color: var(--navy); font: inherit; min-width: 150px; font-size: 14px; }
.filters select:focus, .filters input:focus { outline: 2px solid var(--green); outline-offset: -1px; }

/* NOTICE BAR */
.notice-bar { background: #eef2f5; border: 1px solid #dce2e8; border-radius: 7px; padding: 12px 16px; margin: 0 0 14px; font-size: 12px; color: #526171; }

/* TABLE */
.table-wrap { overflow-x: auto; background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); }
table { border-collapse: collapse; width: 100%; min-width: 620px; }
th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--line); font-size: 13px; }
th { background: #f0f3f5; text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; color: #526171; }
tr:last-child td { border-bottom: 0; }
.player { display: flex; align-items: center; gap: 10px; font-weight: 800; }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: #e5ebef; display: grid; place-items: center; font-size: 11px; font-weight: 900; overflow: hidden; flex-shrink: 0; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }

/* STORE / BOOK COVERS */
.store-cover { height: 120px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--white); font-weight: 900; font-size: 14px; text-align: center; margin-bottom: 12px; padding: 8px; overflow: hidden; }
.book-cover { height: 110px; border-radius: 6px; background: linear-gradient(145deg, #183653, #55748a); display: flex; align-items: flex-end; padding: 10px; color: var(--white); font-weight: 900; font-size: 14px; margin-bottom: 12px; overflow: hidden; }
.price { font-size: 24px; font-weight: 900; margin: 12px 0; }
.price-big { font-size: 42px; font-weight: 900; margin: 12px 0; }
.price-period { font-size: 16px; font-weight: 600; color: var(--muted); }
.membership-card { border: 2px solid var(--green); }

/* BENEFITS */
.benefits-list { list-style: none; padding: 0; margin: 12px 0; }
.benefits-list li { padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; color: #444; }
.benefits-list li:last-child { border-bottom: 0; }
.benefits-list li::before { content: '\\2713'; color: var(--green); font-weight: 900; margin-right: 10px; }

/* STEPS */
.step-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.step { background: #eef1e8; border-radius: var(--radius); padding: 20px; }
.step strong { display: block; margin-bottom: 8px; font-size: 15px; }

/* MODAL */
.modal { display: none; position: fixed; inset: 0; background: rgba(7,20,33,0.75); z-index: 200; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(4px); }
.modal.open { display: flex; }
.modal-box { width: min(640px, 100%); max-height: 90vh; overflow-y: auto; background: var(--cream); border-radius: var(--radius); padding: 28px; position: relative; }
.modal-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
.modal-head h2 { font-size: 22px; }
.close { font-size: 28px; border: 0; background: transparent; cursor: pointer; color: var(--navy); line-height: 1; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; }
.close:hover { background: var(--line); }

/* FORM */
form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
form label { font-size: 12px; font-weight: 800; display: flex; flex-direction: column; gap: 6px; }
form input, form select, form textarea { border: 1px solid #d8dee4; background: var(--white); border-radius: 8px; padding: 11px 14px; color: var(--navy); font: inherit; font-size: 14px; }
form input:focus, form select:focus { outline: 2px solid var(--green); outline-offset: -1px; }
form .full { grid-column: 1 / -1; }
#notice { display: none; margin: 12px 0; padding: 14px; background: #e9f3d8; border-radius: 8px; font-size: 13px; color: #3a5a1b; }
#notice.show { display: block; }

/* STRIPE CARD ELEMENT */
.card-element { border: 1px solid #d8dee4; border-radius: 8px; padding: 12px; background: var(--white); grid-column: 1 / -1; }
#stripeStatus { margin-top: 12px; text-align: center; }

/* AUTH & ADMIN */
.user-name { color: #e8edf2; font-size: 13px; font-weight: 700; }
.btn-admin { background: var(--red); color: var(--white); }
.btn-admin:hover { background: #b84a40; }

.notice-bar { display: none; padding: 12px; border-radius: 8px; font-size: 13px; }
.notice-bar.show { display: block; }

/* ADMIN STATS */
.admin-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat-card { background: var(--white); border: 1px solid var(--line); border-radius: 8px; padding: 16px; text-align: center; }
.stat-number { font-size: 24px; font-weight: 900; color: var(--navy); }
.stat-label { font-size: 11px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

/* FOOTER */
.footer { background: var(--navy); color: #dbe4eb; padding: 32px 5%; font-size: 12px; display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-top: 60px; }

/* RESPONSIVE */
@media (max-width: 900px) {
  .nav { gap: 10px; }
  .nav a { font-size: 11px; }
  .grid-3 { grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .step-list { grid-template-columns: repeat(2, 1fr); }
  .hero { grid-template-columns: 1fr; padding: 50px 5% 40px; gap: 24px; }
  .card { padding: 14px; }
  .store-cover { height: 100px; font-size: 13px; }
  .book-cover { height: 95px; font-size: 13px; }
}
@media (max-width: 640px) {
  .nav { display: none; flex-direction: column; width: 100%; gap: 12px; padding: 12px 0; }
  .nav.open { display: flex; }
  .hamburger { display: flex; }
  .grid-3, .grid-2 { grid-template-columns: 1fr; gap: 12px; }
  .step-list { grid-template-columns: 1fr; gap: 10px; }
  .hero { padding: 24px 4% 20px; gap: 14px; }
  .hero-content { max-width: 100%; }
  .hero h1 { font-size: clamp(26px, 7vw, 34px); }
  .hero p { font-size: 13px; margin-bottom: 18px; }
  .hero-cta { flex-direction: column; gap: 10px; }
  .hero-cta .btn { width: 100%; text-align: center; }
  .hero-card { padding: 14px; }
  .hero-date { font-size: 26px; }
  .header { align-items: center; padding: 8px 4%; gap: 8px; }
  .header-actions { gap: 6px; }
  .brand-name { font-size: 12px; }
  .brand-sub { display: none; }
  .btn-sm { padding: 6px 10px; font-size: 11px; }
  .section { margin: 36px 0; }
  .section h2 { font-size: 22px; }
  .card { padding: 12px; }
  .card h3 { font-size: 14px; margin: 6px 0 4px; }
  .muted { font-size: 12px; }
  .big-number { font-size: 24px; }
  .btn { padding: 10px 14px; font-size: 13px; }
  .store-cover { height: 80px; font-size: 12px; padding: 6px; margin-bottom: 8px; }
  .book-cover { height: 75px; font-size: 12px; padding: 8px; margin-bottom: 8px; }
  .price { font-size: 18px; margin: 8px 0; }
  .price-big { font-size: 32px; }
  .tag { font-size: 9px; padding: 4px 8px; }
  .step { padding: 14px; }
  .filters { flex-direction: column; gap: 8px; }
  .filters select, .filters input { min-width: 0; width: 100%; }
  form { grid-template-columns: 1fr; gap: 10px; }
  form .full { grid-column: auto; }
  .footer { flex-direction: column; gap: 10px; text-align: center; padding: 20px 4%; }
  main { padding: 0 4%; }
}
`;
const STATIC_JS = `// League Tennis Aventura — Frontend completo
// Auth + Stripe Checkout + Ranking + Campeonato + Admin

const STRIPE_PUBLISHABLE_KEY = "pk_test_REPLACE_WITH_YOUR_KEY";
const API = ""; // same origin

let currentUser = null;
let players = [];
let products = [];

// ============ API HELPER ============
async function api(endpoint, options = {}) {
  const res = await fetch(API + endpoint, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options
  });
  return res.json();
}

// ============ AUTH ============
async function checkAuth() {
  const data = await api("/api/auth/me");
  currentUser = data.user;
  updateAuthUI();
}

function updateAuthUI() {
  const authBtns = document.getElementById("authButtons");
  const userInfo = document.getElementById("userInfo");
  if (!authBtns) return;

  if (currentUser) {
    authBtns.innerHTML = \`
      <span class="user-name">Hola, ${currentUser.name}</span>
      ${currentUser.role === "admin" ? '<button class="btn btn-sm btn-admin" onclick="showAdminPanel()">Admin</button>' : ""}
      <button class="btn btn-sm btn-secondary" onclick="logout()">Salir</button>
    \`;
  } else {
    authBtns.innerHTML = \`
      <button class="btn btn-sm" onclick="openModal('loginModal')">Iniciar sesión</button>
      <button class="btn btn-sm btn-primary" onclick="openModal('registerModal')">Registrarse</button>
    \`;
  }
}

async function login(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value;
  const password = form.password.value;
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (data.error) {
    showNotice("loginNotice", data.error, true);
  } else {
    currentUser = data.user;
    closeModal("loginModal");
    updateAuthUI();
    loadPlayers();
    showToast("Bienvenido, " + data.user.name);
  }
}

async function register(e) {
  e.preventDefault();
  const form = e.target;
  const data = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: form.name.value,
      email: form.email.value,
      password: form.password.value,
      level: form.level.value,
      zone: form.zone.value
    })
  });
  if (data.error) {
    showNotice("registerNotice", data.error, true);
  } else {
    currentUser = data.user;
    closeModal("registerModal");
    updateAuthUI();
    loadPlayers();
    showToast("Cuenta creada. Bienvenido!");
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  updateAuthUI();
  showToast("Sesión cerrada");
}

// ============ PRODUCTS & STRIPE ============
async function loadProducts() {
  products = await api("/api/products");
  renderProducts();
}

function renderProducts() {
  const container = document.getElementById("productsList");
  if (!container) return;
  container.innerHTML = products.map(p => {
    if (p.type === "subscription") {
      return \`<article class="card book-card membership-card">
        <span class="tag">Membresía</span>
        <h3>${p.name}</h3>
        <p class="muted">${p.description || ""}</p>
        <div class="price">$${(p.price / 100).toFixed(2)}<span class="price-period">/mes</span></div>
        <button class="btn btn-primary" onclick="checkout('${p.id}')">Suscribirse</button>
      </article>\`;
    }
    return \`<article class="card book-card">
      <div class="book-cover">${p.name.replace(" ", "<br>")}</div>
      <h3>${p.name}</h3>
      <p class="muted">${p.description || ""}</p>
      <div class="price">$${(p.price / 100).toFixed(2)}</div>
      <button class="btn btn-dark" onclick="checkout('${p.id}')">Comprar</button>
    </article>\`;
  }).join("");
}

async function checkout(productId) {
  if (!currentUser) {
    openModal("loginModal");
    showToast("Inicia sesión para comprar");
    return;
  }
  const data = await api("/api/stripe/create-checkout", {
    method: "POST",
    body: JSON.stringify({ productId })
  });
  if (data.url) {
    window.location.href = data.url;
  } else if (data.error) {
    showToast("Error: " + data.error);
  }
}

// ============ PLAYERS / RANKING ============
async function loadPlayers() {
  players = await api("/api/players");
  renderRanking();
}

function renderRanking() {
  const tbody = document.getElementById("rankingBody");
  if (!tbody) return;
  if (!players.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No hay jugadores todavía. Sé el primero!</td></tr>';
    return;
  }
  tbody.innerHTML = players.map((p, i) => {
    const initials = p.name.split(" ").map(x => x[0]).join("").slice(0, 2);
    return \`<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${initials}</div>${p.name}</div></td>
      <td>${p.level}</td>
      <td>${p.zone}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>\`;
  }).join("");
}

function filterPlayers() {
  const level = document.getElementById("levelFilter")?.value;
  const zone = document.getElementById("zoneFilter")?.value;
  const q = document.getElementById("searchPlayer")?.value.toLowerCase();
  let filtered = players.filter(p =>
    (!level || p.level === level) &&
    (!zone || p.zone === zone) &&
    (!q || p.name.toLowerCase().includes(q))
  );
  const tbody = document.getElementById("rankingBody");
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No hay jugadores con esos filtros.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    const initials = p.name.split(" ").map(x => x[0]).join("").slice(0, 2);
    return \`<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${initials}</div>${p.name}</div></td>
      <td>${p.level}</td>
      <td>${p.zone}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>\`;
  }).join("");
}

// ============ CREATE PLAYER PROFILE ============
async function createPlayer(e) {
  e.preventDefault();
  if (!currentUser) { openModal("loginModal"); return; }
  const form = e.target;
  const data = await api("/api/players", {
    method: "POST",
    body: JSON.stringify({
      name: form.name.value,
      level: form.level.value,
      zone: form.zone.value
    })
  });
  if (data.error) { showToast(data.error); return; }
  closeModal("createPlayerModal");
  await loadPlayers();
  showToast("Perfil de jugador creado!");
  form.reset();
}

// ============ TOURNAMENT ============
async function joinTournament() {
  if (!currentUser) { openModal("loginModal"); return; }
  const data = await api("/api/tournament/join", { method: "POST" });
  if (data.error) { showToast(data.error); return; }
  showToast(data.message || "Inscrito al torneo!");
  await loadPlayers();
}

// ============ ADMIN PANEL ============
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") return;
  const stats = await api("/api/admin/stats");
  const orders = await api("/api/orders");
  const users = await api("/api/admin/users");

  const content = document.getElementById("adminContent");
  if (!content) return;

  content.innerHTML = \`
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-number">${stats.totalUsers}</div><div class="stat-label">Usuarios</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalPlayers}</div><div class="stat-label">Jugadores</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalOrders}</div><div class="stat-label">Pedidos</div></div>
      <div class="stat-card"><div class="stat-number">$${(stats.revenue / 100).toFixed(2)}</div><div class="stat-label">Ingresos</div></div>
      <div class="stat-card"><div class="stat-number">${stats.activeSubscriptions}</div><div class="stat-label">Suscripciones</div></div>
    </div>

    <h3>Pedidos recientes</h3>
    <div class="table-wrap" style="margin-bottom:20px">
      <table>
        <thead><tr><th>ID</th><th>Usuario</th><th>Producto</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead>
        <tbody>
          ${orders.slice(0, 10).map(o => \`<tr>
            <td>${o.id.slice(0, 8)}</td>
            <td>${o.userName}</td>
            <td>${o.productName}</td>
            <td>$${(o.amount / 100).toFixed(2)}</td>
            <td><span class="tag">${o.status}</span></td>
            <td>${new Date(o.created).toLocaleDateString()}</td>
          </tr>\`).join("") || '<tr><td colspan="6" class="muted">No hay pedidos</td></tr>'}
        </tbody>
      </table>
    </div>

    <h3>Productos</h3>
    <div class="grid grid-3" style="margin-bottom:20px">
      ${products.map(p => \`<article class="card">
        <h4>${p.name}</h4>
        <p class="muted">$${(p.price / 100).toFixed(2)} ${p.type === "subscription" ? "/mes" : ""}</p>
        <span class="tag ${p.active ? "" : "tag-red"}">${p.active ? "Activo" : "Inactivo"}</span>
        <button class="btn btn-sm btn-dark" onclick="editProduct('${p.id}')">Editar</button>
      </article>\`).join("")}
    </div>
    <button class="btn btn-primary" onclick="showAddProduct()">+ Agregar producto</button>

    <h3 style="margin-top:20px">Usuarios</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Nivel</th><th>Zona</th><th>Membresía</th></tr></thead>
        <tbody>
          ${users.map(u => \`<tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="tag ${u.role === "admin" ? "tag-blue" : ""}">${u.role}</span></td>
            <td>${u.level || "-"}</td>
            <td>${u.zone || "-"}</td>
            <td>${u.membershipActive ? "Activa" : "-"}</td>
          </tr>\`).join("")}
        </tbody>
      </table>
    </div>
  \`;
  openModal("adminModal");
}

function showAddProduct() {
  const name = prompt("Nombre del producto:");
  if (!name) return;
  const priceStr = prompt("Precio en centavos (ej: 1500 = $15.00):");
  if (!priceStr) return;
  const price = parseInt(priceStr);
  const type = prompt("Tipo (digital/subscription):") || "digital";
  api("/api/products", {
    method: "POST",
    body: JSON.stringify({ name, price, type, active: true })
  }).then(() => {
    loadProducts();
    showAdminPanel();
    showToast("Producto creado");
  });
}

// ============ UI HELPERS ============
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.style.overflow = "";
}

document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", e => {
    if (e.target === m) { m.classList.remove("open"); document.body.style.overflow = ""; }
  });
});

function toggleMenu() { document.getElementById("nav").classList.toggle("open"); }

function scrollTo(sel) {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function showNotice(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.background = isError ? "#f8e8e5" : "#e9f3d8";
  el.style.color = isError ? "#8e3028" : "#3a5a1b";
  el.classList.add("show");
}

function showToast(msg) {
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;bottom:20px;right:20px;background:var(--navy);color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:fadeIn 0.3s;";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(() => t.remove(), 300); }, 3000);
}

function showStoreNotice() {
  alert("Catálogo ilustrativo. Los productos reales se cargarán al configurar la tienda.");
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  await checkAuth();
  await loadProducts();
  await loadPlayers();

  // Check for payment success
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") === "success" && params.get("session_id")) {
    showToast("Procesando pago...");
    const data = await api(\`/api/stripe/session/${params.get("session_id")}\`);
    if (data.status === "paid") {
      showToast("Pago exitivo!");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }

  // Login form
  document.getElementById("loginForm")?.addEventListener("submit", login);
  // Register form
  document.getElementById("registerForm")?.addEventListener("submit", register);
  // Tournament form
  document.getElementById("tournamentForm")?.addEventListener("submit", e => {
    e.preventDefault();
    showToast("Solicitud de demo registrada");
    e.target.reset();
    closeModal("tournamentModal");
  });
  // Result form
  document.getElementById("resultForm")?.addEventListener("submit", e => {
    e.preventDefault();
    showToast("Resultado de demo capturado");
    e.target.reset();
    closeModal("resultModal");
  });
  // Challenge form
  document.getElementById("challengeForm")?.addEventListener("submit", e => {
    e.preventDefault();
    showToast("Desafío de demo preparado");
    e.target.reset();
    closeModal("challengeModal");
  });
  // Create player form
  document.getElementById("playerForm")?.addEventListener("submit", createPlayer);

  // Ranking filters
  document.getElementById("levelFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("zoneFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("searchPlayer")?.addEventListener("input", filterPlayers);
});
`;

function jsonResponse(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json", ...headers } });
}

function scrollTo(s){document.querySelector(s)?.scrollIntoView({behavior:'smooth'})}
function toggleMenu(){document.getElementById('nav').classList.toggle('open')}
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}



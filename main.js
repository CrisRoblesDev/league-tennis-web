// League Tennis Aventura — Frontend completo
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
    authBtns.innerHTML = `
      <span class="user-name">Hola, ${currentUser.name}</span>
      ${currentUser.role === "admin" ? '<button class="btn btn-sm btn-admin" onclick="showAdminPanel()">Admin</button>' : ""}
      <button class="btn btn-sm btn-secondary" onclick="logout()">Salir</button>
    `;
  } else {
    authBtns.innerHTML = `
      <button class="btn btn-sm" onclick="openModal('loginModal')">Iniciar sesión</button>
      <button class="btn btn-sm btn-primary" onclick="openModal('registerModal')">Registrarse</button>
    `;
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
      return `<article class="card book-card membership-card">
        <span class="tag">Membresía</span>
        <h3>${p.name}</h3>
        <p class="muted">${p.description || ""}</p>
        <div class="price">$${(p.price / 100).toFixed(2)}<span class="price-period">/mes</span></div>
        <button class="btn btn-primary" onclick="checkout('${p.id}')">Suscribirse</button>
      </article>`;
    }
    return `<article class="card book-card">
      <div class="book-cover">${p.name.replace(" ", "<br>")}</div>
      <h3>${p.name}</h3>
      <p class="muted">${p.description || ""}</p>
      <div class="price">$${(p.price / 100).toFixed(2)}</div>
      <button class="btn btn-dark" onclick="checkout('${p.id}')">Comprar</button>
    </article>`;
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
    return `<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${initials}</div>${p.name}</div></td>
      <td>${p.level}</td>
      <td>${p.zone}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>`;
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
    return `<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${initials}</div>${p.name}</div></td>
      <td>${p.level}</td>
      <td>${p.zone}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>`;
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

  content.innerHTML = `
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
          ${orders.slice(0, 10).map(o => `<tr>
            <td>${o.id.slice(0, 8)}</td>
            <td>${o.userName}</td>
            <td>${o.productName}</td>
            <td>$${(o.amount / 100).toFixed(2)}</td>
            <td><span class="tag">${o.status}</span></td>
            <td>${new Date(o.created).toLocaleDateString()}</td>
          </tr>`).join("") || '<tr><td colspan="6" class="muted">No hay pedidos</td></tr>'}
        </tbody>
      </table>
    </div>

    <h3>Productos</h3>
    <div class="grid grid-3" style="margin-bottom:20px">
      ${products.map(p => `<article class="card">
        <h4>${p.name}</h4>
        <p class="muted">$${(p.price / 100).toFixed(2)} ${p.type === "subscription" ? "/mes" : ""}</p>
        <span class="tag ${p.active ? "" : "tag-red"}">${p.active ? "Activo" : "Inactivo"}</span>
        <button class="btn btn-sm btn-dark" onclick="editProduct('${p.id}')">Editar</button>
      </article>`).join("")}
    </div>
    <button class="btn btn-primary" onclick="showAddProduct()">+ Agregar producto</button>

    <h3 style="margin-top:20px">Usuarios</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Nivel</th><th>Zona</th><th>Membresía</th></tr></thead>
        <tbody>
          ${users.map(u => `<tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="tag ${u.role === "admin" ? "tag-blue" : ""}">${u.role}</span></td>
            <td>${u.level || "-"}</td>
            <td>${u.zone || "-"}</td>
            <td>${u.membershipActive ? "Activa" : "-"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
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
    const data = await api(`/api/stripe/session/${params.get("session_id")}`);
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

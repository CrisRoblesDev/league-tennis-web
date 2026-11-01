// League Tennis Aventura — Frontend completo
// Auth + Stripe Checkout + Ranking + Campeonato + Admin

const API = ""; // same origin

let currentUser = null;
let players = [];
let products = [];
let matchResults = [];
let leagueChallenges = [];

// ============ API HELPER ============
async function api(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(API + endpoint, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      credentials: "include"
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Revisa la configuración y vuelve a intentar.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status})`);
  return data;
}

// ============ AUTH ============
async function checkAuth() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
  } catch (error) {
    currentUser = null;
    showToast(error.message);
  } finally {
    updateAuthUI();
  }
}

function updateAuthUI() {
  const authBtns = document.getElementById("authButtons");
  const userInfo = document.getElementById("userInfo");
  if (!authBtns) return;

  if (currentUser) {
    authBtns.innerHTML = `
      <span class="user-name">Hola, ${escapeHtml(currentUser.name)}</span>
      ${players.some(player => player.userId === currentUser.id) ? "" : '<button class="btn btn-sm" onclick="openModal(\'createPlayerModal\')">Crear perfil</button>'}
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
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    currentUser = data.user;
    closeModal("loginModal");
    updateAuthUI();
    await loadPlayers();
    showToast("Bienvenido, " + data.user.name);
  } catch (error) {
    showNotice("loginNotice", error.message, true);
  }
}

async function register(e) {
  e.preventDefault();
  const form = e.target;
  try {
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
    currentUser = data.user;
    closeModal("registerModal");
    updateAuthUI();
    await loadPlayers();
    showToast("Cuenta creada. Bienvenido!");
  } catch (error) {
    showNotice("registerNotice", error.message, true);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
    currentUser = null;
    updateAuthUI();
    renderResults();
    renderChallenges();
    showToast("Sesión cerrada");
  } catch (error) {
    showToast(error.message);
  }
}

// ============ PRODUCTS & STRIPE ============
async function loadProducts() {
  try {
    products = await api("/api/products");
    renderProducts();
  } catch (error) {
    showToast(`No se pudo cargar la tienda: ${error.message}`);
  }
}

function renderProducts() {
  const container = document.getElementById("productsList");
  if (!container) return;
  container.innerHTML = products.map(p => {
    if (p.type === "subscription") {
      return `<article class="card book-card membership-card">
        <span class="tag">Membresía</span>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="muted">${escapeHtml(p.description || "")}</p>
        <div class="price">$${(p.price / 100).toFixed(2)}<span class="price-period">/${p.interval === "year" ? "año" : "mes"}</span></div>
        <button class="btn btn-primary" onclick="checkout('${p.id}')">Suscribirse</button>
      </article>`;
    }
    return `<article class="card book-card">
      <div class="book-cover">${escapeHtml(p.name).replace(" ", "<br>")}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <p class="muted">${escapeHtml(p.description || "")}</p>
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
  try {
    const data = await api("/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ productId })
    });
    window.location.href = data.url;
  } catch (error) {
    showToast(`No se pudo iniciar el pago: ${error.message}`);
  }
}

// ============ PLAYERS / RANKING ============
async function loadPlayers() {
  try {
    players = await api("/api/players");
    renderRanking();
    updateAuthUI();
    await Promise.all([loadResults(), loadChallenges()]);
  } catch (error) {
    showToast(`No se pudo cargar el ranking: ${error.message}`);
  }
}

async function loadResults() {
  try {
    matchResults = await api("/api/results");
    renderResults();
  } catch (error) {
    showToast(`No se pudieron cargar los resultados: ${error.message}`);
  }
}

function renderResults() {
  const container = document.getElementById("resultsList");
  if (!container) return;
  const pending = matchResults.filter(result => result.status === "pending");
  if (!pending.length) {
    container.innerHTML = '<p class="muted">No hay resultados pendientes de confirmación.</p>';
    return;
  }
  container.innerHTML = `<h3>Resultados por confirmar</h3>${pending.map(result => {
    const canRespond = currentUser &&
      [result.winnerUserId, result.loserUserId].includes(currentUser.id) &&
      result.reportedBy !== currentUser.id;
    return `<article class="card result-card">
      <p><b>${escapeHtml(result.winnerName)}</b> vs <b>${escapeHtml(result.loserName)}</b></p>
      <p class="muted">${escapeHtml(result.score)} · ${new Date(result.playedAt).toLocaleDateString()}</p>
      ${canRespond ? `<button class="btn btn-primary" onclick="respondToResult('${escapeHtml(result.id)}','confirm')">Confirmar</button>
        <button class="btn btn-secondary" onclick="respondToResult('${escapeHtml(result.id)}','dispute')">Desacuerdo</button>` : '<span class="tag">Pendiente de confirmación</span>'}
    </article>`;
  }).join("")}`;
}

async function respondToResult(resultId, action) {
  try {
    await api("/api/results", {
      method: "PATCH",
      body: JSON.stringify({ resultId, action })
    });
    await Promise.all([loadPlayers(), loadResults()]);
    showToast(action === "confirm" ? "Resultado confirmado; se actualizó el ranking." : "Resultado marcado para revisión.");
  } catch (error) {
    showToast(error.message);
  }
}

function openResultModal() {
  if (!currentUser) {
    openModal("loginModal");
    showToast("Inicia sesión para registrar un resultado.");
    return;
  }
  const player = players.find(item => item.userId === currentUser.id);
  if (!player) {
    openModal("createPlayerModal");
    showToast("Crea tu perfil de jugador primero.");
    return;
  }
  const options = players.map(item =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.level)}</option>`
  ).join("");
  document.querySelectorAll("#resultForm select").forEach(select => {
    select.innerHTML = `<option value="">Seleccionar</option>${options}`;
  });
  openModal("resultModal");
}

async function submitResult(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/results", {
      method: "POST",
      body: JSON.stringify({
        winnerId: form.winnerId.value,
        loserId: form.loserId.value,
        score: form.score.value,
        playedAt: form.date.value
      })
    });
    closeModal("resultModal");
    form.reset();
    await loadResults();
    showToast("Resultado enviado; el rival debe confirmarlo para actualizar el ranking.");
  } catch (error) {
    showNotice("resultNotice", error.message, true);
  }
}

async function loadChallenges() {
  try {
    leagueChallenges = await api("/api/challenges");
    renderChallenges();
  } catch (error) {
    showToast(`No se pudieron cargar los desafíos: ${error.message}`);
  }
}

function renderChallenges() {
  const container = document.getElementById("challengesList");
  if (!container) return;
  if (!leagueChallenges.length) {
    container.innerHTML = '<p class="muted">Aún no hay desafíos publicados.</p>';
    return;
  }
  container.innerHTML = leagueChallenges.map(challenge => {
    const canAccept = currentUser && currentUser.id !== challenge.creatorUserId && challenge.status === "open";
    return `<article class="card">
      <span class="tag">${challenge.status === "open" ? "Abierto" : "Aceptado"}</span>
      <h3>${escapeHtml(challenge.creatorName)} · ${escapeHtml(challenge.level)}</h3>
      <p class="muted">${escapeHtml(challenge.zone)} · ${escapeHtml(challenge.availability)}</p>
      ${canAccept ? `<button class="btn btn-dark" onclick="acceptChallenge('${escapeHtml(challenge.id)}')">Aceptar desafío</button>` : ""}
    </article>`;
  }).join("");
}

async function acceptChallenge(challengeId) {
  try {
    await api("/api/challenges", {
      method: "PATCH",
      body: JSON.stringify({ challengeId })
    });
    await loadChallenges();
    showToast("Desafío aceptado. Coordina fecha y cancha con el rival.");
  } catch (error) {
    showToast(error.message);
  }
}

async function submitChallenge(event) {
  event.preventDefault();
  if (!currentUser) {
    openModal("loginModal");
    showToast("Inicia sesión para publicar un desafío.");
    return;
  }
  if (!players.some(player => player.userId === currentUser.id)) {
    openModal("createPlayerModal");
    showToast("Crea tu perfil de jugador primero.");
    return;
  }
  try {
    await api("/api/challenges", {
      method: "POST",
      body: JSON.stringify({ availability: event.target.availability.value })
    });
    closeModal("challengeModal");
    event.target.reset();
    await loadChallenges();
    showToast("Desafío publicado.");
  } catch (error) {
    showNotice("challengeNotice", error.message, true);
  }
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
      <td><div class="player"><div class="avatar">${escapeHtml(initials)}</div>${escapeHtml(p.name)}</div></td>
      <td>${escapeHtml(p.level)}</td>
      <td>${escapeHtml(p.zone)}</td>
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
      <td><div class="player"><div class="avatar">${escapeHtml(initials)}</div>${escapeHtml(p.name)}</div></td>
      <td>${escapeHtml(p.level)}</td>
      <td>${escapeHtml(p.zone)}</td>
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
  try {
    await api("/api/players", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.value,
        level: form.level.value,
        zone: form.zone.value
      })
    });
    closeModal("createPlayerModal");
    await loadPlayers();
    showToast("Perfil de jugador creado!");
    form.reset();
  } catch (error) {
    showToast(error.message);
  }
}

// ============ TOURNAMENT ============
async function joinTournament() {
  if (!currentUser) { openModal("loginModal"); return; }
  try {
    const data = await api("/api/tournament", { method: "POST" });
    showToast(data.message || "Inscrito al torneo!");
    await loadPlayers();
  } catch (error) {
    showToast(error.message);
  }
}

// ============ ADMIN PANEL ============
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") return;
  let stats;
  let orders;
  let users;
  try {
    [stats, orders, users] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/orders"),
      api("/api/admin/users")
    ]);
  } catch (error) {
    showToast(`No se pudo abrir administración: ${error.message}`);
    return;
  }

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
            <td>${escapeHtml(o.userName)}</td>
            <td>${escapeHtml(o.productName)}</td>
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
        <h4>${escapeHtml(p.name)}</h4>
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
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="tag ${u.role === "admin" ? "tag-blue" : ""}">${escapeHtml(u.role)}</span></td>
            <td>${escapeHtml(u.level || "-")}</td>
            <td>${escapeHtml(u.zone || "-")}</td>
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
  }).catch(error => {
    showToast(`No se pudo crear el producto: ${error.message}`);
  });
}

async function editProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  const name = prompt("Nombre del producto:", product.name);
  if (name === null) return;
  const priceValue = prompt("Precio en centavos:", String(product.price));
  if (priceValue === null) return;
  const price = Number(priceValue);
  if (!Number.isSafeInteger(price) || price < 1) {
    showToast("El precio debe ser un entero positivo en centavos.");
    return;
  }
  try {
    await api(`/api/products/${encodeURIComponent(product.id)}`, {
      method: "PUT",
      body: JSON.stringify({ name, price })
    });
    await loadProducts();
    await showAdminPanel();
    showToast("Producto actualizado");
  } catch (error) {
    showToast(`No se pudo actualizar: ${error.message}`);
  }
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showToast(msg) {
  const t = document.createElement("div");
  t.style.cssText = "position:fixed;bottom:20px;right:20px;background:var(--navy);color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:fadeIn 0.3s;";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(() => t.remove(), 300); }, 3000);
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
    try {
      const data = await api(`/api/stripe/session/${encodeURIComponent(params.get("session_id"))}`);
      if (data.status === "paid") {
        showToast("Pago confirmado. ¡Gracias por tu compra!");
      } else {
        showToast(`El pago aún figura como ${data.status || "pendiente"}.`);
      }
    } catch (error) {
      showToast(`No se pudo verificar el pago: ${error.message}`);
    } finally {
      window.history.replaceState({}, "", window.location.pathname);
    }
  } else if (params.get("payment") === "canceled") {
    showToast("Pago cancelado. No se realizó ningún cargo.");
    window.history.replaceState({}, "", window.location.pathname);
  }

  // Login form
  document.getElementById("loginForm")?.addEventListener("submit", login);
  // Register form
  document.getElementById("registerForm")?.addEventListener("submit", register);
  document.getElementById("resultForm")?.addEventListener("submit", submitResult);
  document.getElementById("challengeForm")?.addEventListener("submit", submitChallenge);
  // Create player form
  document.getElementById("playerForm")?.addEventListener("submit", createPlayer);

  // Ranking filters
  document.getElementById("levelFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("zoneFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("searchPlayer")?.addEventListener("input", filterPlayers);
});

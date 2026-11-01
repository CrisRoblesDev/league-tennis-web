// League Tennis Aventura — Frontend completo
// Auth + Stripe Checkout + Ranking + Campeonato + Admin

const API = ""; // same origin

let currentUser = null;
let players = [];
let products = [];
let matchResults = [];
let leagueChallenges = [];
let tournaments = [];

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
        name: form.elements.namedItem("name").value,
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
  const membershipPlan = document.getElementById("membershipPlan");
  const membership = products.find(product => product.type === "subscription");
  if (membershipPlan) {
    membershipPlan.innerHTML = membership ? `
      <h3>${escapeHtml(membership.name)}</h3>
      <div class="price-big">$${(membership.price / 100).toFixed(2)}<span class="price-period">/${membership.interval === "year" ? "año" : "mes"}</span></div>
      <p class="muted">${escapeHtml(membership.description || "Cancela cuando quieras.")}</p>
      <button class="btn btn-primary btn-full" onclick="checkout('${escapeHtml(membership.id)}')">Suscribirse ahora</button>
      <p class="muted small">Pago seguro procesado por Stripe.</p>` :
      '<h3>Planes de membresía</h3><p class="muted">No hay una suscripción disponible en este momento.</p>';
  }
  if (!products.length) {
    container.innerHTML = '<p class="muted">No hay productos disponibles en este momento.</p>';
    return;
  }
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
  document.getElementById("resultForm").date.value = new Date().toISOString().slice(0, 10);
  showNotice("resultNotice", "", false);
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
        name: form.elements.namedItem("name").value,
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
    await loadTournaments();
  } catch (error) {
    showToast(error.message);
  }
}

// ============ PUBLIC TOURNAMENTS ============
async function loadTournaments() {
  try {
    const data = await api("/api/tournament");
    tournaments = data.tournaments || [];
    renderTournaments();
    const featured = tournaments.find(item => item.month === new Date().toISOString().slice(0, 7)) ||
      tournaments.find(item => ["registration", "scheduled", "in_progress"].includes(item.status)) ||
      tournaments[0];
    if (featured) {
      document.getElementById("heroTournamentTitle").textContent = featured.title || `Campeonato · ${featured.month}`;
      document.getElementById("heroTournamentDate").textContent =
        featured.startDate ? new Date(`${featured.startDate}T00:00:00`).toLocaleDateString() : featured.month;
      document.getElementById("heroTournamentSummary").textContent =
        featured.description || `${(featured.entries || []).length} inscritos · ${featured.format || "Formato por anunciar"}`;
    }
  } catch (error) {
    showToast(`No se pudieron cargar los torneos: ${error.message}`);
  }
}

function renderTournaments() {
  const container = document.getElementById("tournamentsList");
  if (!container) return;
  if (!tournaments.length) {
    container.innerHTML = '<article class="card"><span class="tag">Próximamente</span><h3>Calendario de torneos</h3><p class="muted">Los próximos torneos se publicarán aquí.</p></article>';
    return;
  }
  const statusLabels = {
    registration: "Inscripciones abiertas",
    scheduled: "Programado",
    in_progress: "En curso",
    completed: "Finalizado",
    cancelled: "Cancelado"
  };
  container.innerHTML = tournaments.map(tournament => {
    const entries = tournament.entries || [];
    const matches = tournament.matches || [];
    const status = statusLabels[tournament.status] || "Estado por confirmar";
    const dates = [tournament.startDate, tournament.endDate].filter(Boolean).join(" – ");
    const month = tournament.month || "";
    const canJoin = tournament.status === "registration" &&
      month === new Date().toISOString().slice(0, 7);
    return `<article class="card tournament-card">
      <span class="tag ${tournament.status === "registration" ? "tag-blue" : ""}">${escapeHtml(status)}</span>
      <h3>${escapeHtml(tournament.title || `Campeonato · ${month}`)}</h3>
      <p class="muted">${escapeHtml(tournament.description || "")}</p>
      <p><b>${escapeHtml(month)}</b>${dates ? ` · ${escapeHtml(dates)}` : ""}</p>
      ${tournament.venue ? `<p class="muted">Cancha: ${escapeHtml(tournament.venue)}</p>` : ""}
      <p class="muted">${escapeHtml(tournament.format || "Formato por anunciar")}</p>
      <p><b>${entries.length}</b> inscritos${tournament.levels?.length ? ` · Niveles ${escapeHtml(tournament.levels.join(", "))}` : ""}</p>
      ${entries.length ? `<details><summary>Ver jugadores inscritos</summary><ul class="tournament-entries">${entries.map(entry =>
        `<li>${escapeHtml(entry.name)} <span class="muted">${escapeHtml(entry.level)}</span></li>`
      ).join("")}</ul></details>` : ""}
      ${matches.length ? `<div class="tournament-matches"><b>Partidos</b>${matches.map(match =>
        `<p><span>${escapeHtml(match.round || "Ronda")}</span><br>${escapeHtml(match.playerAName)} vs ${escapeHtml(match.playerBName)}${match.score ? ` · ${escapeHtml(match.score)}` : ""}${match.date ? ` · ${escapeHtml(match.date)}` : ""}${match.status === "cancelled" ? " · Cancelado" : ""}</p>`
      ).join("")}</div>` : ""}
      ${canJoin ? '<button class="btn btn-dark" onclick="joinTournament()">Inscribirse</button>' : ""}
    </article>`;
  }).join("");
}

// ============ ADMIN PANEL ============
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") return;
  let stats;
  let orders;
  let users;
  let allProducts;
  let allTournaments;
  let results;
  try {
    [stats, orders, users, allProducts, allTournaments, results] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/orders"),
      api("/api/admin/users"),
      api("/api/admin/products"),
      api("/api/admin/tournaments"),
      api("/api/results")
    ]);
  } catch (error) {
    showToast(`No se pudo abrir administración: ${error.message}`);
    return;
  }

  const content = document.getElementById("adminContent");
  if (!content) return;
  products = allProducts;
  tournaments = allTournaments;
  matchResults = results;
  const levels = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];

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

    <h3>Torneos</h3>
    <form id="adminTournamentForm" class="admin-form">
      <input type="hidden" name="id">
      <label>Nombre<input name="title" maxlength="120" required></label>
      <label>Mes<input name="month" type="month" required></label>
      <label>Niveles<select name="levels" multiple required>${levels.map(level => `<option value="${level}">${level}</option>`).join("")}</select></label>
      <label>Estado<select name="status"><option value="registration">Inscripciones</option><option value="scheduled">Programado</option><option value="in_progress">En curso</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label>
      <label>Fecha de inicio<input name="startDate" type="date"></label>
      <label>Fecha de término<input name="endDate" type="date"></label>
      <label>Cancha / sede<input name="venue" maxlength="120"></label>
      <label>Formato<input name="format" maxlength="120" value="Eliminación directa · Best of 3"></label>
      <label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar torneo</button><button class="btn btn-secondary" type="button" onclick="resetTournamentForm()">Limpiar</button></div>
    </form>
    <div class="grid grid-2 admin-records">
      ${allTournaments.map(tournament => renderAdminTournament(tournament)).join("") || '<p class="muted">Aún no hay torneos. Usa el formulario para crear el primero.</p>'}
    </div>

    <h3>Productos y suscripciones</h3>
    <form id="adminProductForm" class="admin-form">
      <input type="hidden" name="id">
      <label>Nombre<input name="name" maxlength="120" required></label>
      <label>Precio (USD)<input name="price" type="number" min="0.01" step="0.01" required></label>
      <label>Tipo<select name="type"><option value="digital">Producto digital</option><option value="subscription">Suscripción</option></select></label>
      <label>Frecuencia<select name="interval"><option value="month">Mensual</option><option value="year">Anual</option></select></label>
      <label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label>
      <label class="full"><span><input name="active" type="checkbox" checked> Disponible en la tienda</span></label>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar producto</button><button class="btn btn-secondary" type="button" onclick="resetProductForm()">Limpiar</button></div>
    </form>
    <div class="grid grid-3 admin-records">
      ${allProducts.map(product => `<article class="card admin-record">
        <h4>${escapeHtml(product.name)}</h4>
        <p class="muted">$${(product.price / 100).toFixed(2)}${product.type === "subscription" ? ` /${product.interval === "year" ? "año" : "mes"}` : ""}</p>
        <span class="tag ${product.active ? "" : "tag-red"}">${product.active ? "Activo" : "Inactivo"}</span>
        <p class="muted">${escapeHtml(product.description || "")}</p>
        <button class="btn btn-sm btn-dark" onclick="editProduct('${escapeHtml(product.id)}')">Editar</button>
      </article>`).join("") || '<p class="muted">No hay productos configurados.</p>'}
    </div>

    <h3>Resultados por moderar</h3>
    <div class="grid grid-2 admin-records">
      ${results.filter(result => ["pending", "disputed"].includes(result.status)).map(result => `<article class="card admin-record">
        <span class="tag ${result.status === "disputed" ? "tag-red" : ""}">${result.status === "disputed" ? "En disputa" : "Pendiente"}</span>
        <h4>${escapeHtml(result.winnerName)} vs ${escapeHtml(result.loserName)}</h4>
        <p class="muted">${escapeHtml(result.score)} · ${escapeHtml(result.playedAt || "")}</p>
        <div class="admin-form-actions">
          <button class="btn btn-primary" onclick="moderateResult('${escapeHtml(result.id)}','confirm')">Confirmar</button>
          <button class="btn btn-secondary" onclick="moderateResult('${escapeHtml(result.id)}','reject')">Rechazar</button>
        </div>
      </article>`).join("") || '<p class="muted">No hay resultados pendientes.</p>'}
    </div>

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
  document.getElementById("adminTournamentForm").addEventListener("submit", saveTournament);
  document.getElementById("adminProductForm").addEventListener("submit", saveProduct);
  resetTournamentForm();
  resetProductForm();
  openModal("adminModal");
}

function renderAdminTournament(tournament) {
  const entrants = tournament.entries || [];
  return `<article class="card admin-record">
    <div class="admin-record-head"><div><span class="tag">${escapeHtml(tournament.status)}</span><h4>${escapeHtml(tournament.title || tournament.month)}</h4></div>
      <div class="admin-form-actions"><button class="btn btn-sm btn-dark" onclick="editTournament('${escapeHtml(tournament.id)}')">Editar</button>
      <button class="btn btn-sm btn-secondary" onclick="deleteTournament('${escapeHtml(tournament.id)}')">Eliminar</button></div>
    </div>
    <p class="muted">${escapeHtml(tournament.month)} · ${entrants.length} inscritos · ${escapeHtml(tournament.venue || "Sede por definir")}</p>
    <p>${entrants.map(entry => escapeHtml(entry.name)).join(", ") || "Sin inscritos"}</p>
    ${entrants.length >= 2 ? `<form id="admin-match-form-${escapeHtml(tournament.id)}" class="admin-match-form" onsubmit="saveTournamentMatch(event,'${escapeHtml(tournament.id)}')">
      <input type="hidden" name="matchId">
      <b class="full">Programar partido</b>
      <label>Jugador A<select name="playerAId" required>${entrants.map(entry => `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
      <label>Jugador B<select name="playerBId" required>${entrants.map(entry => `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
      <label>Ronda<input name="round" required placeholder="Final"></label>
      <label>Fecha<input name="date" type="date"></label>
      <label>Estado<select name="status"><option value="scheduled">Programado</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label>
      <label>Ganador<select name="winnerId"><option value="">Elegir al cerrar</option>${entrants.map(entry =>
        `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`
      ).join("")}</select></label>
      <label>Marcador desde Jugador A<input name="score" placeholder="6-4, 4-6, 10-7"></label>
      <label>Cancha<input name="court" maxlength="120"></label>
      <button class="btn btn-primary full">Guardar partido</button>
    </form>` : ""}
    ${(tournament.matches || []).map(match => `<div class="admin-match-row">
      <p class="muted">${escapeHtml(match.round)}: ${escapeHtml(match.playerAName || match.playerAId)} vs ${escapeHtml(match.playerBName || match.playerBId)}${match.score ? ` · ${escapeHtml(match.score)}` : ""}</p>
      <button class="btn btn-sm btn-dark" onclick="editTournamentMatch('${escapeHtml(tournament.id)}','${escapeHtml(match.id)}')">Editar partido</button>
    </div>`).join("")}
  </article>`;
}

function editTournament(tournamentId) {
  const tournament = tournaments.find(item => item.id === tournamentId);
  if (!tournament) return;
  const form = document.getElementById("adminTournamentForm");
  form.elements.namedItem("id").value = tournament.id;
  form.elements.namedItem("title").value = tournament.title || "";
  form.elements.namedItem("month").value = tournament.month || "";
  form.elements.namedItem("status").value = tournament.status || "registration";
  form.elements.namedItem("startDate").value = tournament.startDate || "";
  form.elements.namedItem("endDate").value = tournament.endDate || "";
  form.elements.namedItem("venue").value = tournament.venue || "";
  form.elements.namedItem("format").value = tournament.format || "";
  form.elements.namedItem("description").value = tournament.description || "";
  Array.from(form.elements.namedItem("levels").options).forEach(option => {
    option.selected = (tournament.levels || []).includes(option.value);
  });
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editTournamentMatch(tournamentId, matchId) {
  const tournament = tournaments.find(item => item.id === tournamentId);
  const match = tournament?.matches?.find(item => item.id === matchId);
  const form = document.getElementById(`admin-match-form-${tournamentId}`);
  if (!match || !form) return;
  form.elements.namedItem("matchId").value = match.id;
  form.elements.namedItem("playerAId").value = match.playerAId;
  form.elements.namedItem("playerBId").value = match.playerBId;
  form.elements.namedItem("round").value = match.round;
  form.elements.namedItem("date").value = match.date || "";
  form.elements.namedItem("court").value = match.court || "";
  form.elements.namedItem("status").value = match.status || "scheduled";
  form.elements.namedItem("winnerId").value = match.winnerId || "";
  form.elements.namedItem("score").value = match.score || "";
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetTournamentForm() {
  const form = document.getElementById("adminTournamentForm");
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("month").value = new Date().toISOString().slice(0, 7);
  form.elements.namedItem("format").value = "Eliminación directa · Best of 3";
}

async function saveTournament(event) {
  event.preventDefault();
  const form = event.target;
  const body = {
    title: form.elements.namedItem("title").value,
    month: form.elements.namedItem("month").value,
    levels: Array.from(form.elements.namedItem("levels").selectedOptions, option => option.value),
    status: form.elements.namedItem("status").value,
    startDate: form.elements.namedItem("startDate").value,
    endDate: form.elements.namedItem("endDate").value,
    venue: form.elements.namedItem("venue").value,
    format: form.elements.namedItem("format").value,
    description: form.elements.namedItem("description").value
  };
  try {
    const id = form.elements.namedItem("id").value;
    await api(id ? `/api/admin/tournaments/${encodeURIComponent(id)}` : "/api/admin/tournaments", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    await loadTournaments();
    await showAdminPanel();
    showToast(id ? "Torneo actualizado" : "Torneo creado");
  } catch (error) {
    showToast(`No se pudo guardar el torneo: ${error.message}`);
  }
}

async function deleteTournament(tournamentId) {
  if (!window.confirm("¿Eliminar este torneo y su cuadro?")) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, { method: "DELETE" });
    await loadTournaments();
    await showAdminPanel();
    showToast("Torneo eliminado");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
  }
}

async function saveTournamentMatch(event, tournamentId) {
  event.preventDefault();
  const form = event.target;
  const playerAId = form.elements.namedItem("playerAId").value;
  const playerBId = form.elements.namedItem("playerBId").value;
  if (playerAId === playerBId) {
    showToast("Elige dos jugadores distintos.");
    return;
  }
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({
        match: {
          ...(form.elements.namedItem("matchId").value ?
            { id: form.elements.namedItem("matchId").value } : {}),
          playerAId,
          playerBId,
          round: form.elements.namedItem("round").value,
          date: form.elements.namedItem("date").value,
          court: form.elements.namedItem("court").value,
          status: form.elements.namedItem("status").value,
          winnerId: form.elements.namedItem("winnerId").value,
          score: form.elements.namedItem("score").value
        }
      })
    });
    await loadTournaments();
    await showAdminPanel();
    showToast("Partido programado");
  } catch (error) {
    showToast(`No se pudo programar: ${error.message}`);
  }
}

function editProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  const form = document.getElementById("adminProductForm");
  form.elements.namedItem("id").value = product.id;
  form.elements.namedItem("name").value = product.name;
  form.elements.namedItem("price").value = (product.price / 100).toFixed(2);
  form.elements.namedItem("type").value = product.type || "digital";
  form.elements.namedItem("interval").value = product.interval || "month";
  form.elements.namedItem("description").value = product.description || "";
  form.elements.namedItem("active").checked = product.active !== false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
  const form = document.getElementById("adminProductForm");
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("active").checked = true;
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  const amount = Number(form.elements.namedItem("price").value);
  const price = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(price)) {
    showToast("Ingresa un precio válido en dólares.");
    return;
  }
  const body = {
    name: form.elements.namedItem("name").value,
    price,
    type: form.elements.namedItem("type").value,
    interval: form.elements.namedItem("interval").value,
    description: form.elements.namedItem("description").value,
    active: form.elements.namedItem("active").checked
  };
  const id = form.elements.namedItem("id").value;
  try {
    await api(id ? `/api/products/${encodeURIComponent(id)}` : "/api/products", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    await loadProducts();
    await showAdminPanel();
    showToast(id ? "Producto actualizado" : "Producto creado");
  } catch (error) {
    showToast(`No se pudo guardar el producto: ${error.message}`);
  }
}

async function moderateResult(resultId, action) {
  try {
    await api("/api/admin/results", {
      method: "PATCH",
      body: JSON.stringify({ resultId, action })
    });
    await Promise.all([loadPlayers(), loadResults()]);
    await showAdminPanel();
    showToast(action === "confirm" ? "Resultado confirmado y ranking actualizado." : "Resultado rechazado.");
  } catch (error) {
    showToast(`No se pudo moderar el resultado: ${error.message}`);
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
  await loadTournaments();

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

// League Tennis Aventura — Frontend completo
// Auth + Stripe Checkout + Ranking + Campeonato + Admin

const API = ""; // same origin
const isAdminPage = /\/admin(?:\.html)?\/?$/.test(window.location.pathname);
// Enlace provisional; el definitivo se configura desde el panel de administración.
const WHATSAPP_GROUP_URL_FALLBACK = "https://chat.whatsapp.com/";
let whatsappGroupUrl = "";

const CATEGORY_LABELS = {
  singles: "Singles",
  dobles: "Dobles",
  dobles_mixtos: "Dobles Mixtos"
};
const GENDER_LABELS = {
  hombres: "Hombres",
  mujeres: "Mujeres"
};

let currentUser = null;
let players = [];
let products = [];
let matchResults = [];
let leagueChallenges = [];
let tournaments = [];
let adminUsers = [];
let adminOrdersChecked = false;
let paymentNoticeState = null;

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
      ${!isAdminPage && !players.some(player => player.userId === currentUser.id) ? '<button class="btn btn-sm" onclick="openModal(\'createPlayerModal\')">Crear perfil</button>' : ""}
      ${currentUser.role === "admin" ? `<a class="btn btn-sm btn-admin" href="${isAdminPage ? "/" : "/admin.html"}">${isAdminPage ? "Página pública" : "Administración"}</a>` : ""}
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
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  const email = form.email.value;
  const password = form.password.value;
  submitButton.disabled = true;
  submitButton.textContent = "Iniciando sesión...";
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
    if (paymentNoticeState?.sessionId) {
      await verifyPaymentReturn(paymentNoticeState.sessionId);
    }
  } catch (error) {
    showNotice("loginNotice", error.message, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
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
        phone: form.elements.namedItem("phone").value.trim(),
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
    window.location.replace("/");
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
  const ropaContainer = document.getElementById("productsRopaList");
  const librosContainer = document.getElementById("productsLibrosList");
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
  if (!ropaContainer && !librosContainer) return;
  const shopProducts = products.filter(product => product.type !== "subscription");
  const ropa = shopProducts.filter(product =>
    product.category === "ropa" || (!product.category && product.type !== "digital"));
  const libros = shopProducts.filter(product =>
    product.category === "libros" || (!product.category && product.type === "digital"));
  if (ropaContainer) {
    ropaContainer.innerHTML = ropa.map(renderProductCard).join("") ||
      '<p class="muted">No hay productos de ropa y accesorios disponibles en este momento.</p>';
  }
  if (librosContainer) {
    librosContainer.innerHTML = libros.map(renderProductCard).join("") ||
      '<p class="muted">No hay libros disponibles en este momento.</p>';
  }
}

function renderProductCard(p) {
  return `<article class="card book-card">
    ${p.image ? `<div class="book-cover"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy"></div>` : `<div class="book-cover">${escapeHtml(p.name).replace(" ", "<br>")}</div>`}
    <h3>${escapeHtml(p.name)}</h3>
    <p class="muted">${escapeHtml(p.description || "")}</p>
    <div class="price">$${(p.price / 100).toFixed(2)}</div>
    <button class="btn btn-dark" onclick="checkout('${p.id}')">Comprar</button>
  </article>`;
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

async function donate(amountCents, recurring) {
  if (!currentUser) {
    openModal("loginModal");
    showToast("Inicia sesión para donar");
    return;
  }
  try {
    const data = await api("/api/stripe/checkout", {
      method: "POST",
      body: JSON.stringify({ donation: { amountCents, recurring: recurring || null } })
    });
    window.location.href = data.url;
  } catch (error) {
    showToast(`No se pudo iniciar la donación: ${error.message}`);
  }
}

function applyWhatsAppLinks() {
  const url = whatsappGroupUrl || WHATSAPP_GROUP_URL_FALLBACK;
  document.querySelectorAll("[data-whatsapp-link]").forEach(link => {
    link.href = url;
  });
  const fab = document.querySelector(".whatsapp-fab");
  if (fab) fab.href = url;
}

async function loadWhatsAppSettings() {
  try {
    const data = await api("/api/settings");
    whatsappGroupUrl = typeof data.whatsappUrl === "string" ? data.whatsappUrl.trim() : "";
  } catch {
    whatsappGroupUrl = "";
  }
  applyWhatsAppLinks();
  const fab = document.querySelector(".whatsapp-fab");
  if (!whatsappGroupUrl && fab) fab.remove();
}

async function setupRanking3d() {
  const container = document.getElementById("ranking3d");
  if (!container || container.dataset.initialized === "true") return;
  container.dataset.initialized = "true";
  try {
    const module = await import("./ranking3d.js");
    window.__ranking3dUpdate = players => module.updateRanking3d(players);
    await module.initRanking3d(container, players);
  } catch {
    container.dataset.initialized = "";
    container.innerHTML = '<p class="muted" style="padding:20px">La vista 3D no está disponible en este navegador.</p>';
  }
}

function setRankingView(mode) {
  const container = document.getElementById("ranking3d");
  const table = document.getElementById("rankingTableWrap");
  if (!container || !table) return;
  document.querySelectorAll("[data-ranking-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.rankingView === mode);
  });
  if (mode === "3d") {
    table.hidden = true;
    container.hidden = false;
    setupRanking3d();
  } else {
    container.hidden = true;
    table.hidden = false;
  }
}

const WHATSAPP_PROMOS = [
  "Únete al grupo de WhatsApp de la liga y no te pierdas ningún desafío.",
  "Coordina partidos y desafíos al instante en nuestro grupo de WhatsApp.",
  "¡La comunidad te espera! Entra al grupo de WhatsApp de League Tennis."
];

const HEADER_MOBILE_MEDIA = window.matchMedia("(max-width: 1080px)");

function syncHeaderLayout() {
  const header = document.querySelector(".header");
  const nav = document.getElementById("nav");
  const actions = document.querySelector(".header-actions");
  if (!header || !nav || !actions) return;
  if (HEADER_MOBILE_MEDIA.matches) {
    if (actions.parentElement !== nav) nav.appendChild(actions);
  } else if (actions.parentElement !== header) {
    header.appendChild(actions);
  }
}

function initWhatsAppPromos() {
  if (isAdminPage || !whatsappGroupUrl) return;
  const fab = document.createElement("a");
  fab.className = "whatsapp-fab";
  fab.href = whatsappGroupUrl;
  fab.target = "_blank";
  fab.rel = "noopener";
  fab.setAttribute("aria-label", "Grupo de WhatsApp");
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.09c-.24.68-1.4 1.3-1.93 1.35-.53.05-1.03.24-3.47-.72-2.94-1.16-4.78-4.22-4.93-4.42-.14-.2-1.16-1.55-1.16-2.96 0-1.4.73-2.09 1-2.38.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.56.8 1.95.87 2.09.07.15.12.32.02.51-.1.2-.15.32-.29.49-.15.17-.31.39-.44.52-.15.15-.3.31-.13.6.17.29.75 1.24 1.61 2.01 1.11.99 2.04 1.3 2.33 1.44.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.19-.29.39-.24.65-.15.27.1 1.69.8 1.98.94.29.15.48.22.55.34.07.12.07.7-.17 1.38Z"/></svg>';
  document.body.appendChild(fab);

  const bubble = document.createElement("div");
  bubble.className = "whatsapp-bubble";
  bubble.hidden = true;
  bubble.innerHTML = `
    <button type="button" class="whatsapp-bubble-close" aria-label="Cerrar">×</button>
    <p></p>
    <a class="btn btn-whatsapp btn-sm" href="${whatsappGroupUrl}" target="_blank" rel="noopener">Unirme al grupo</a>`;
  document.body.appendChild(bubble);

  let promoIndex = 0;
  let hideTimer;
  const showBubble = () => {
    if (sessionStorage.getItem("whatsapp-joined")) return;
    if (!bubble.hidden) return;
    bubble.querySelector("p").textContent = WHATSAPP_PROMOS[promoIndex % WHATSAPP_PROMOS.length];
    promoIndex++;
    bubble.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { bubble.hidden = true; }, 10000);
  };
  bubble.querySelector(".whatsapp-bubble-close").addEventListener("click", () => {
    clearTimeout(hideTimer);
    bubble.hidden = true;
  });
  bubble.querySelector("a").addEventListener("click", () => {
    sessionStorage.setItem("whatsapp-joined", "1");
    clearTimeout(hideTimer);
    bubble.hidden = true;
  });
  setTimeout(showBubble, 6000);
  setInterval(showBubble, 90000);
}

function filterAdminUsers() {
  const query = document.getElementById("adminUserSearch").value.trim().toLowerCase();
  document.querySelectorAll("#adminUsersBody tr").forEach(row => {
    row.hidden = !row.textContent.toLowerCase().includes(query);
  });
}

function editAdminUser(userId) {
  const user = adminUsers.find(item => item.id === userId);
  if (!user) return;
  const form = document.getElementById("adminUserForm");
  form.elements.namedItem("userId").value = user.id;
  form.elements.namedItem("identity").value = `${user.name} · ${user.email}`;
  form.elements.namedItem("email").value = user.email || "";
  form.elements.namedItem("password").value = "";
  form.elements.namedItem("role").value = user.role || "user";
  form.elements.namedItem("level").value = user.level || "";
  form.elements.namedItem("zone").value = user.zone || "";
  form.elements.namedItem("phone").value = user.phone || "";
  form.elements.namedItem("membershipActive").checked = user.membershipActive === true;
  document.getElementById("adminUserSelection").textContent = `Editando: ${user.name}`;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetAdminUserForm() {
  const form = document.getElementById("adminUserForm");
  form.reset();
  form.elements.namedItem("userId").value = "";
  form.elements.namedItem("identity").value = "";
  form.elements.namedItem("password").value = "";
  document.getElementById("adminUserSelection").textContent = "Selecciona un usuario en la tabla para editarlo.";
}

function resetAdminUserCreateForm() {
  document.getElementById("adminUserCreateForm")?.reset();
}

async function fillAdminSettingsForm() {
  const form = document.getElementById("adminSettingsForm");
  if (!form) return;
  try {
    const data = await api("/api/admin/settings");
    form.elements.namedItem("whatsappUrl").value = data.whatsappUrl || "";
  } catch (error) {
    showToast(`No se pudo cargar la configuración: ${error.message}`);
  }
}

async function saveAdminSettings(event) {
  event.preventDefault();
  const form = event.target;
  try {
    const data = await api("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ whatsappUrl: form.elements.namedItem("whatsappUrl").value.trim() })
    });
    whatsappGroupUrl = data.whatsappUrl || "";
    applyWhatsAppLinks();
    showToast("Ajustes guardados.");
  } catch (error) {
    showToast(`No se pudo guardar la configuración: ${error.message}`);
  }
}

async function createAdminUser(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        name: form.elements.namedItem("name").value,
        email: form.elements.namedItem("email").value,
        password: form.elements.namedItem("password").value,
        role: form.elements.namedItem("role").value
      })
    });
    form.reset();
    await showAdminPanel();
    showToast("Cuenta creada.");
  } catch (error) {
    showToast(`No se pudo crear la cuenta: ${error.message}`);
  }
}

async function saveAdminUser(event) {
  event.preventDefault();
  const form = event.target;
  const userId = form.elements.namedItem("userId").value;
  if (!userId) {
    showToast("Selecciona un usuario de la tabla antes de guardar.");
    return;
  }
  const updates = {
    role: form.elements.namedItem("role").value,
    level: form.elements.namedItem("level").value,
    zone: form.elements.namedItem("zone").value,
    phone: form.elements.namedItem("phone").value.trim() || null,
    membershipActive: form.elements.namedItem("membershipActive").checked
  };
  const email = form.elements.namedItem("email").value.trim();
  if (email) updates.email = email;
  const password = form.elements.namedItem("password").value;
  if (password) updates.password = password;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ userId, updates })
    });
    await showAdminPanel();
    showToast("Usuario actualizado.");
  } catch (error) {
    showToast(`No se pudo actualizar el usuario: ${error.message}`);
  }
}

function editAdminPlayer(playerId) {
  const player = players.find(item => item.id === playerId);
  if (!player) return;
  const form = document.getElementById("adminPlayerForm");
  form.elements.namedItem("playerId").value = player.id;
  const accountSelect = form.elements.namedItem("accountId");
  if (!Array.from(accountSelect.options).some(option => option.value === player.userId)) {
    const option = new Option(`${player.name} · perfil existente`, player.userId);
    accountSelect.add(option);
  }
  accountSelect.value = player.userId;
  accountSelect.disabled = true;
  form.elements.namedItem("name").value = player.name;
  form.elements.namedItem("level").value = player.level;
  form.elements.namedItem("category").value = player.category || "singles";
  form.elements.namedItem("gender").value = player.gender || "hombres";
  form.elements.namedItem("zone").value = player.zone;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetAdminPlayerForm() {
  const form = document.getElementById("adminPlayerForm");
  form.reset();
  form.elements.namedItem("playerId").value = "";
  form.elements.namedItem("accountId").disabled = false;
}

async function saveAdminPlayer(event) {
  event.preventDefault();
  const form = event.target;
  const playerId = form.elements.namedItem("playerId").value;
  try {
    if (playerId) {
      await api("/api/admin/players", {
        method: "PATCH",
        body: JSON.stringify({
          playerId,
          updates: {
            name: form.elements.namedItem("name").value,
            level: form.elements.namedItem("level").value,
            zone: form.elements.namedItem("zone").value,
            category: form.elements.namedItem("category").value,
            gender: form.elements.namedItem("gender").value
          }
        })
      });
    } else {
      const userId = form.elements.namedItem("accountId").value;
      if (!userId) {
        showToast("Selecciona una cuenta para crearle un perfil.");
        return;
      }
      await api("/api/admin/players", {
        method: "POST",
        body: JSON.stringify({
          userId,
          name: form.elements.namedItem("name").value,
          level: form.elements.namedItem("level").value,
          zone: form.elements.namedItem("zone").value,
          category: form.elements.namedItem("category").value,
          gender: form.elements.namedItem("gender").value
        })
      });
    }
    await Promise.all([loadPlayers(), showAdminPanel()]);
    showToast(playerId ? "Perfil de jugador actualizado." : "Perfil de jugador creado.");
  } catch (error) {
    showToast(`No se pudo actualizar el perfil: ${error.message}`);
  }
}

async function deleteAdminPlayer(playerId) {
  const player = players.find(item => item.id === playerId);
  if (!player || !window.confirm(`¿Eliminar el perfil de ${player.name}? No se borrará la cuenta. El historial deportivo impide borrar perfiles asociados a partidos o torneos.`)) return;
  try {
    await api("/api/admin/players", {
      method: "DELETE",
      body: JSON.stringify({ playerId })
    });
    await Promise.all([loadPlayers(), showAdminPanel()]);
    showToast("Perfil de jugador eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
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
      <p class="muted">${escapeHtml(result.score)} · ${formatLocalDate(result.playedAt)}</p>
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
        category: form.elements.namedItem("category").value,
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
    const container = document.getElementById("challengesList");
    const count = document.getElementById("challengeCount");
    if (count) count.textContent = "No disponible";
    if (container) {
      container.innerHTML = `
        <div class="challenge-load-error" role="alert">
          <p>No se pudieron cargar las propuestas: ${escapeHtml(error.message)}</p>
          <button class="btn btn-secondary" type="button" onclick="loadChallenges()">Intentar de nuevo</button>
        </div>`;
    }
    showToast(`No se pudieron cargar los desafíos: ${error.message}`);
  }
}

function renderChallenges() {
  const container = document.getElementById("challengesList");
  if (!container) return;
  const count = document.getElementById("challengeCount");
  if (count) {
    const open = leagueChallenges.filter(challenge => challenge.status === "open").length;
    count.textContent = open ?
      `${open} ${open === 1 ? "desafío disponible" : "desafíos disponibles"}` :
      `${leagueChallenges.length} ${leagueChallenges.length === 1 ? "partido coordinado" : "partidos coordinados"}`;
  }
  if (!leagueChallenges.length) {
    container.innerHTML = `
      <div class="challenge-empty">
        <div class="challenge-empty-copy">
          <span class="tag tag-blue">EJEMPLOS VISUALES</span>
          <h3>Así se verá la zona cuando haya propuestas</h3>
          <p>Estas tarjetas son solo una muestra del diseño; no son jugadores ni desafíos publicados.</p>
        </div>
        <div class="challenge-preview-grid">
          ${renderChallengePreview("3.0", "Aventura / Sunny Isles", "Tardes entre semana", "A")}
          ${renderChallengePreview("3.5", "Downtown / Brickell", "Sábado por la mañana", "B")}
          ${renderChallengePreview("4.0", "North Miami / Miami Gardens", "Flexible · coordinar horario", "C")}
        </div>
      </div>`;
    return;
  }
  container.innerHTML = leagueChallenges.map(challenge => {
    const canAccept = currentUser && currentUser.id !== challenge.creatorUserId && challenge.status === "open";
    const initials = (challenge.creatorName || "Jugador").split(" ").map(part => part[0]).join("").slice(0, 2);
    return `<article class="challenge-card">
      <div class="challenge-card-top">
        <div class="challenge-player">
          <span class="challenge-avatar">${escapeHtml(initials)}</span>
          <div><small>PROPUESTA DE</small><h3>${escapeHtml(challenge.creatorName)}</h3></div>
        </div>
        <span class="challenge-status ${challenge.status === "accepted" ? "is-accepted" : ""}">${challengeStatusLabel(challenge.status)}</span>
      </div>
      <div class="challenge-card-details">
        <div><span class="challenge-detail-icon">NIVEL</span><b>${escapeHtml(challenge.level || "Por definir")}</b></div>
        <div><span class="challenge-detail-icon">ZONA</span><b>${escapeHtml(challenge.zone || "Miami")}</b></div>
      </div>
      <div class="challenge-availability"><span aria-hidden="true">◷</span><div><small>DISPONIBILIDAD</small><p>${escapeHtml(challenge.availability)}</p></div></div>
      ${canAccept ? `<button class="btn btn-dark challenge-accept" onclick="acceptChallenge('${escapeHtml(challenge.id)}')">Aceptar desafío <span aria-hidden="true">→</span></button>` :
        challenge.status === "accepted" ? '<p class="challenge-coordinating">Los jugadores están coordinando el partido.</p>' : ""}
    </article>`;
  }).join("") + [
    ["3.0", "Aventura / Sunny Isles", "Tardes entre semana", "A"],
    ["3.5", "Downtown / Brickell", "Sábado por la mañana", "B"],
    ["4.0", "North Miami / Miami Gardens", "Flexible · coordinar horario", "C"]
  ].slice(0, Math.max(0, 3 - leagueChallenges.length))
    .map(example => renderChallengePreview(...example)).join("");
}

function renderChallengePreview(level, zone, availability, initials) {
  return `<article class="challenge-card challenge-card-preview">
    <div class="challenge-card-top">
      <div class="challenge-player">
        <span class="challenge-avatar">${initials}</span>
        <div><small>JUGADOR/A DE EJEMPLO</small><h3>Tenista de la liga</h3></div>
      </div>
      <span class="challenge-status">Busca rival</span>
    </div>
    <div class="challenge-card-details">
      <div><span class="challenge-detail-icon">NIVEL</span><b>${level}</b></div>
      <div><span class="challenge-detail-icon">ZONA</span><b>${zone}</b></div>
    </div>
    <div class="challenge-availability"><span aria-hidden="true">◷</span><div><small>DISPONIBILIDAD</small><p>${availability}</p></div></div>
    <span class="challenge-example-label">Muestra · no publicado</span>
  </article>`;
}

function challengeStatusLabel(status) {
  if (status === "open") return "Busca rival";
  if (status === "accepted") return "Partido coordinado";
  if (status === "closed") return "Cerrado";
  return "Desafío";
}

function tournamentStatusLabel(status) {
  return ({
    registration: "Inscripciones abiertas",
    scheduled: "Programado",
    in_progress: "En curso",
    completed: "Finalizado",
    cancelled: "Cancelado"
  })[status] || "Sin estado";
}

function resultStatusLabel(status) {
  return ({
    pending: "Pendiente",
    disputed: "En revisión",
    confirmed: "Confirmado",
    rejected: "Rechazado"
  })[status] || "Sin estado";
}

function orderStatusLabel(status) {
  return ({
    paid: "Pagado",
    pending: "Pendiente",
    failed: "Fallido",
    refunded: "Reembolsado"
  })[status] || status || "Sin estado";
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
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No hay jugadores todavía. Sé el primero!</td></tr>';
    return;
  }
  tbody.innerHTML = players.map((p, i) => {
    const initials = p.name.split(" ").map(x => x[0]).join("").slice(0, 2);
    return `<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${escapeHtml(initials)}</div>${escapeHtml(p.name)}</div></td>
      <td>${escapeHtml(p.level)}</td>
      <td>${escapeHtml(CATEGORY_LABELS[p.category || "singles"] || "Singles")}</td>
      <td>${escapeHtml(GENDER_LABELS[p.gender || "hombres"] || "Hombres")}</td>
      <td>${escapeHtml(p.zone)}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>`;
  }).join("");
  window.__ranking3dUpdate?.(players);
}

function filterPlayers() {
  const level = document.getElementById("levelFilter")?.value;
  const zone = document.getElementById("zoneFilter")?.value;
  const category = document.getElementById("categoryFilter")?.value;
  const gender = document.getElementById("genderFilter")?.value;
  const q = document.getElementById("searchPlayer")?.value.toLowerCase();
  let filtered = players.filter(p =>
    (!level || p.level === level) &&
    (!zone || p.zone === zone) &&
    (!category || (p.category || "singles") === category) &&
    (!gender || (p.gender || "hombres") === gender) &&
    (!q || p.name.toLowerCase().includes(q))
  );
  const tbody = document.getElementById("rankingBody");
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No hay jugadores con esos filtros.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    const initials = p.name.split(" ").map(x => x[0]).join("").slice(0, 2);
    return `<tr>
      <td><b>${i + 1}</b></td>
      <td><div class="player"><div class="avatar">${escapeHtml(initials)}</div>${escapeHtml(p.name)}</div></td>
      <td>${escapeHtml(p.level)}</td>
      <td>${escapeHtml(CATEGORY_LABELS[p.category || "singles"] || "Singles")}</td>
      <td>${escapeHtml(GENDER_LABELS[p.gender || "hombres"] || "Hombres")}</td>
      <td>${escapeHtml(p.zone)}</td>
      <td>${p.matches}</td>
      <td><b>${p.points.toLocaleString()}</b></td>
    </tr>`;
  }).join("");
  window.__ranking3dUpdate?.(players);
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
        zone: form.zone.value,
        category: form.elements.namedItem("category").value,
        gender: form.elements.namedItem("gender").value
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
      const title = document.getElementById("heroTournamentTitle");
      const date = document.getElementById("heroTournamentDate");
      const summary = document.getElementById("heroTournamentSummary");
      if (title) title.textContent = featured.title || `Campeonato · ${featured.month}`;
      if (date) {
        date.textContent = featured.startDate ?
          formatLocalDate(new Date(`${featured.startDate}T00:00:00`)) : featured.month;
      }
      if (summary) {
        summary.textContent = featured.description ||
          `${(featured.entries || []).length} inscritos · ${featured.format || "Formato por anunciar"}`;
      }
    }
  } catch (error) {
    showToast(`No se pudieron cargar los torneos: ${error.message}`);
  }
}

function renderTournamentMatches(matches, entries = []) {
  if (!matches || !matches.length) {
    if (entries.length >= 2) {
      return '<p class="muted draw-pending">El cuadro se publicará cuando se programen los partidos.</p>';
    }
    return "";
  }
  const rounds = new Map();
  matches.forEach(match => {
    const key = match.round || "Ronda";
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key).push(match);
  });
  return `<div class="draw-written"><b class="draw-written-title">Main draw</b><div class="draw-written-rounds">${[...rounds.entries()].map(([round, roundMatches]) => `
    <div class="draw-round"><h4>${escapeHtml(round)}</h4>${roundMatches.map(match => `
      <div class="draw-match${match.status === "completed" ? " is-completed" : ""}${match.status === "cancelled" ? " is-cancelled" : ""}">
        <span>${escapeHtml(match.playerAName || match.playerAId || "Por definir")}</span>
        <span>${escapeHtml(match.playerBName || match.playerBId || "Por definir")}</span>
        ${match.score ? `<b>${escapeHtml(match.score)}</b>` : `<small>${match.status === "cancelled" ? "Cancelado" : "Por jugar"}</small>`}
        ${match.date ? `<small>${escapeHtml(match.date)}</small>` : ""}
      </div>`).join("")}</div>`).join("")}</div></div>`;
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
      ${(tournament.category && tournament.category !== "singles") || (tournament.gender && tournament.gender !== "mixto") ?
        `<p class="muted">${escapeHtml(CATEGORY_LABELS[tournament.category || "singles"] || "Singles")}${tournament.gender && tournament.gender !== "mixto" ? ` · ${escapeHtml(GENDER_LABELS[tournament.gender] || tournament.gender)}` : ""}</p>` : ""}
      ${(tournament.matches || []).length || entries.length >= 2 ? renderTournamentMatches(tournament.matches, entries) : ""}
      ${canJoin ? '<button class="btn btn-dark" onclick="joinTournament()">Inscribirse</button>' : ""}
    </article>`;
  }).join("");
}

// ============ ADMIN PANEL ============
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") return;
  const content = document.getElementById("adminContent");
  let orderSyncMessage = "";
  if (!adminOrdersChecked) {
    adminOrdersChecked = true;
    try {
      const sync = await api("/api/admin/orders/reconcile", { method: "POST" });
      if (sync.added) {
        orderSyncMessage = `Se recuperaron ${sync.added} compra(s) faltante(s) desde Stripe.`;
      }
    } catch (error) {
      orderSyncMessage = `No se pudo sincronizar con Stripe: ${error.message}`;
    }
  }
  let stats;
  let orders;
  let users;
  let allProducts;
  let allTournaments;
  let results;
  let allChallenges;
  try {
    [stats, orders, users, allProducts, allTournaments, results, allChallenges] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/orders"),
      api("/api/admin/users"),
      api("/api/admin/products"),
      api("/api/admin/tournaments"),
      api("/api/results"),
      api("/api/admin/challenges")
    ]);
  } catch (error) {
    if (content) {
      content.innerHTML = `
        <div class="admin-load-error" role="alert">
          <p>No se pudo cargar el panel: ${escapeHtml(error.message)}</p>
          <button class="btn btn-primary" type="button" onclick="showAdminPanel()">Reintentar</button>
        </div>`;
    }
    showToast(`No se pudo abrir administración: ${error.message}`);
    return;
  }

  if (!content) return;
  products = allProducts;
  tournaments = allTournaments;
  matchResults = results;
  adminUsers = users;
  let allPlayers;
  try {
    allPlayers = await api("/api/admin/players");
  } catch (error) {
    content.innerHTML = `
      <div class="admin-load-error" role="alert">
        <p>No se pudieron cargar los perfiles de jugadores: ${escapeHtml(error.message)}</p>
        <button class="btn btn-primary" type="button" onclick="showAdminPanel()">Reintentar</button>
      </div>`;
    showToast(`No se pudieron cargar los perfiles de jugadores: ${error.message}`);
    return;
  }
  players = allPlayers;
  const levels = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
  const pendingResults = results.filter(result => ["pending", "disputed"].includes(result.status));
  const playersWithoutProfile = adminUsers.filter(user =>
    !allPlayers.some(player => player.userId === user.id)
  );

  content.innerHTML = `
    <div class="admin-welcome">
      <div>
        <span class="section-kicker">CENTRO DE CONTROL</span>
        <h2>¿Qué quieres hacer hoy?</h2>
        <p>Elige una tarea para empezar. Los cambios se guardan al pulsar el botón de guardar.</p>
      </div>
      <div class="admin-quick-actions">
        <button type="button" onclick="scrollAdminTo('admin-tournaments')"><span>01</span><b>Organizar un torneo</b><small>Fechas, niveles y partidos</small></button>
        <button type="button" onclick="scrollAdminTo('admin-results')"><span>02</span><b>Revisar resultados</b><small>${pendingResults.length} por revisar</small></button>
        <button type="button" onclick="scrollAdminTo('admin-players')"><span>03</span><b>Gestionar jugadores</b><small>Perfiles y clasificación</small></button>
        <button type="button" onclick="scrollAdminTo('admin-products')"><span>04</span><b>Editar la tienda</b><small>Productos y membresías</small></button>
      </div>
    </div>
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-number">${stats.totalUsers}</div><div class="stat-label">Cuentas registradas</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalPlayers}</div><div class="stat-label">Perfiles de jugador</div></div>
      <div class="stat-card"><div class="stat-number">${stats.totalOrders}</div><div class="stat-label">Compras realizadas</div></div>
      <div class="stat-card"><div class="stat-number">$${(stats.revenue / 100).toFixed(2)}</div><div class="stat-label">Ingresos totales</div></div>
      <div class="stat-card"><div class="stat-number">${stats.activeSubscriptions}</div><div class="stat-label">Membresías activas</div></div>
      <div class="stat-card"><div class="stat-number">${pendingResults.length}</div><div class="stat-label">Resultados por revisar</div></div>
    </div>

    <nav class="admin-nav" aria-label="Secciones de administración">
      <button type="button" onclick="scrollAdminTo('admin-tournaments')">Torneos</button>
      <button type="button" onclick="scrollAdminTo('admin-players')">Jugadores</button>
      <button type="button" onclick="scrollAdminTo('admin-results')">Resultados</button>
      <button type="button" onclick="scrollAdminTo('admin-challenges')">Desafíos</button>
      <button type="button" onclick="scrollAdminTo('admin-products')">Tienda</button>
      <button type="button" onclick="scrollAdminTo('admin-orders')">Compras</button>
      <button type="button" onclick="scrollAdminTo('admin-users')">Cuentas</button>
      <button type="button" onclick="scrollAdminTo('admin-settings')">Ajustes</button>
    </nav>

    <section class="admin-section" id="admin-orders"><h3>Compras recientes</h3>
    <div class="admin-order-tools">
      <p class="admin-section-help">Consulta las compras y pagos realizados en la tienda.</p>
      <button class="btn btn-secondary btn-sm" type="button" onclick="syncAdminOrders()">Sincronizar pagos con Stripe</button>
    </div>
    ${orderSyncMessage ? `<p class="admin-order-sync-message" role="status">${escapeHtml(orderSyncMessage)}</p>` : ""}
    <div class="table-wrap" style="margin-bottom:20px">
      <table>
        <thead><tr><th>ID</th><th>Usuario</th><th>Producto</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead>
        <tbody>
          ${orders.map(o => `<tr>
            <td title="${escapeHtml(o.id)}">${escapeHtml(o.id.slice(0, 8))}</td>
            <td>${escapeHtml(o.userName)}</td>
            <td>${escapeHtml(o.productName)}</td>
            <td>$${(o.amount / 100).toFixed(2)}</td>
            <td><span class="tag">${escapeHtml(orderStatusLabel(o.status))}</span></td>
            <td>${o.created ? formatLocalDate(o.created) : "-"}</td>
          </tr>`).join("") || '<tr><td colspan="6" class="muted">No hay pedidos</td></tr>'}
        </tbody>
      </table>
    </div>
    </section>

    <section class="admin-section" id="admin-tournaments"><h3>Torneos y partidos</h3>
    <p class="admin-section-help">Crea el torneo y define sus niveles. Después podrás inscribir jugadores y organizar partidos.</p>
    <form id="adminTournamentForm" class="admin-form">
      <input type="hidden" name="id">
      <h4 class="full admin-form-title">Datos del torneo</h4>
      <label>Nombre del torneo<input name="title" maxlength="120" required placeholder="Ej. Copa de noviembre"></label>
      <label>Mes del torneo<input name="month" type="month" required></label>
      <fieldset class="admin-level-select full">
        <legend>Niveles participantes</legend>
        <p>Selecciona uno o más niveles de juego.</p>
        <div>${levels.map(level => `<label><input type="checkbox" name="levels" value="${level}"><span>${level}</span></label>`).join("")}</div>
      </fieldset>
      <label>Estado del torneo<select name="status"><option value="registration">Inscripciones abiertas</option><option value="scheduled">Programado</option><option value="in_progress">En curso</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label>
      <label>Categoría<select name="category"><option value="singles">Singles</option><option value="dobles">Dobles</option><option value="dobles_mixtos">Dobles Mixtos</option></select></label>
      <label>Modalidad<select name="gender"><option value="mixto">Mixto</option><option value="hombres">Hombres</option><option value="mujeres">Mujeres</option></select></label>
      <label>Fecha de inicio<input name="startDate" type="date"></label>
      <label>Fecha de término<input name="endDate" type="date"></label>
      <label>Sede o cancha<input name="venue" maxlength="120" placeholder="Ej. Aventura Tennis Center"></label>
      <label>Formato del torneo<input name="format" maxlength="120" value="Eliminación directa · Best of 3"></label>
      <label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar torneo</button><button class="btn btn-secondary" type="button" onclick="resetTournamentForm()">Limpiar formulario</button></div>
    </form>
    <div class="grid grid-2 admin-records">
      ${allTournaments.map(tournament => renderAdminTournament(tournament)).join("") || '<div class="admin-empty-state"><b>Aún no hay torneos</b><p>Completa el formulario de arriba para publicar el primero.</p></div>'}
    </div>
    </section>

    <section class="admin-section" id="admin-challenges"><h3>Desafíos publicados</h3>
    <p class="muted">Revisa la actividad de la comunidad, cierra publicaciones resueltas o elimina contenido inválido.</p>
    <div class="grid grid-3 admin-records">
      ${allChallenges.map(challenge => `<article class="card admin-record">
        <span class="tag ${challenge.status === "accepted" ? "tag-blue" : ""}">${escapeHtml(challengeStatusLabel(challenge.status))}</span>
        <h4>${escapeHtml(challenge.playerName)}</h4>
        <p>${escapeHtml(challenge.availability || "")}</p>
        ${challenge.acceptedPlayerName ? `<p class="muted">Aceptado por ${escapeHtml(challenge.acceptedPlayerName)}</p>` : ""}
        <p class="muted">${challenge.created ? formatLocalDate(challenge.created) : ""}</p>
        <div class="admin-form-actions">
          ${challenge.status !== "closed" ? `<button class="btn btn-sm btn-dark" onclick="setChallengeStatus('${escapeHtml(challenge.id)}','closed')">Cerrar</button>` : ""}
          ${challenge.status === "closed" ? `<button class="btn btn-sm btn-secondary" onclick="setChallengeStatus('${escapeHtml(challenge.id)}','open')">Reabrir</button>` : ""}
          <button class="btn btn-sm btn-danger" onclick="deleteAdminChallenge('${escapeHtml(challenge.id)}')">Eliminar</button>
        </div>
      </article>`).join("") || '<p class="muted">No hay desafíos publicados.</p>'}
    </div>
    </section>

    <section class="admin-section" id="admin-products"><h3>Tienda y membresías</h3>
    <p class="admin-section-help">Lo que esté marcado como disponible se mostrará en la página principal.</p>
    <form id="adminProductForm" class="admin-form">
      <input type="hidden" name="id">
      <label>Nombre<input name="name" maxlength="120" required></label>
      <label>Precio (USD)<input name="price" type="number" min="0.01" step="0.01" required></label>
      <label>Tipo<select name="type"><option value="digital">Producto digital</option><option value="subscription">Suscripción</option></select></label>
      <label>Frecuencia<select name="interval"><option value="month">Mensual</option><option value="year">Anual</option></select></label>
      <label>Categoría<select name="category"><option value="">General</option><option value="libros">Libros digitales</option><option value="ropa">Ropa y accesorios</option></select></label>
      <label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label>
      <label class="full">Imagen del producto<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp" onchange="previewProductImageFile(this)"></label>
      <input type="hidden" name="image">
      <div class="full"><img id="productImagePreview" alt="" style="display:none; width:100%; max-height:160px; object-fit:cover; border-radius:8px; border:1px solid var(--line);"></div>
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
        <button class="btn btn-sm btn-secondary" onclick="toggleProduct('${escapeHtml(product.id)}')">${product.active ? "Desactivar" : "Activar"}</button>
        <button class="btn btn-sm btn-secondary" onclick="deleteProduct('${escapeHtml(product.id)}')">Eliminar</button>
      </article>`).join("") || '<p class="muted">No hay productos configurados.</p>'}
    </div>
    </section>

    <section class="admin-section" id="admin-results"><h3>Resultados de partidos</h3>
    <p class="muted">Confirma, rechaza o elimina un reporte. Los resultados confirmados impactan el ranking.</p>
    <div class="grid grid-2 admin-records">
      ${pendingResults.map(result => `<article class="card admin-record">
        <span class="tag ${result.status === "disputed" ? "tag-red" : ""}">${result.status === "disputed" ? "En disputa" : "Pendiente"}</span>
        <h4>${escapeHtml(result.winnerName)} vs ${escapeHtml(result.loserName)}</h4>
        <p class="muted">${escapeHtml(result.score)} · ${escapeHtml(result.playedAt || "")}</p>
        <div class="admin-form-actions">
          <button class="btn btn-primary" onclick="moderateResult('${escapeHtml(result.id)}','confirm')">Confirmar</button>
          <button class="btn btn-secondary" onclick="moderateResult('${escapeHtml(result.id)}','reject')">Rechazar</button>
          <button class="btn btn-sm btn-dark" onclick="editAdminResult('${escapeHtml(result.id)}')">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAdminResult('${escapeHtml(result.id)}')">Eliminar</button>
        </div>
      </article>`).join("") || '<p class="muted">No hay resultados pendientes.</p>'}
    </div>
    <details class="admin-history">
      <summary>Historial de resultados (${results.length})</summary>
      <div class="table-wrap">
        <table><thead><tr><th>Partido</th><th>Marcador</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>
          ${results.map(result => `<tr><td>${escapeHtml(result.winnerName)} vs ${escapeHtml(result.loserName)}</td><td>${escapeHtml(result.score)}</td><td>${escapeHtml(resultStatusLabel(result.status))}</td><td>${result.playedAt ? formatLocalDate(result.playedAt) : "-"}</td><td><button class="btn btn-sm btn-dark" onclick="editAdminResult('${escapeHtml(result.id)}')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminResult('${escapeHtml(result.id)}')">Eliminar</button></td></tr>`).join("") || '<tr><td colspan="5">Sin resultados</td></tr>'}
        </tbody></table>
      </div>
    </details>
    <form id="adminResultForm" class="admin-form admin-result-form" hidden>
      <input type="hidden" name="resultId">
      <h4 class="full">Editar resultado reportado</h4>
      <p class="full muted">Al guardar, volverá a estado pendiente para que el rival confirme el cambio.</p>
      <label>Ganador<select name="winnerId" required>${allPlayers.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")}</select></label>
      <label>Rival<select name="loserId" required>${allPlayers.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")}</select></label>
      <label>Marcador desde el ganador<input name="score" required placeholder="6-4, 4-6, 10-7"></label>
      <label>Fecha<input name="playedAt" type="date" required></label>
      <div class="admin-form-actions full"><button class="btn btn-primary">Guardar y solicitar confirmación</button><button type="button" class="btn btn-secondary" onclick="cancelAdminResultEdit()">Cancelar</button></div>
    </form>
    </section>

    <section class="admin-section" id="admin-players"><h3>Jugadores de la liga</h3>
    <p class="admin-section-help">Administra el nombre, nivel y zona que aparecen en la clasificación. Los perfiles con historial deportivo no se pueden borrar.</p>
    <form id="adminPlayerForm" class="admin-form">
      <input type="hidden" name="playerId">
      <label class="full">Cuenta vinculada<select name="accountId" required>
        <option value="">Selecciona una cuenta sin perfil</option>
        ${playersWithoutProfile.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join("")}
      </select></label>
      <label>Nombre público<input name="name" maxlength="100" required></label>
      <label>Nivel<select name="level" required>${levels.map(level => `<option value="${level}">${level}</option>`).join("")}</select></label>
      <label>Categoría<select name="category" required><option value="singles">Singles</option><option value="dobles">Dobles</option><option value="dobles_mixtos">Dobles Mixtos</option></select></label>
      <label>Modalidad<select name="gender" required><option value="hombres">Hombres</option><option value="mujeres">Mujeres</option></select></label>
      <label class="full">Zona<select name="zone" required><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label>
      <div class="admin-form-actions full"><button class="btn btn-primary">Guardar perfil</button><button type="button" class="btn btn-secondary" onclick="resetAdminPlayerForm()">Cancelar</button></div>
    </form>
    <div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Email</th><th>Nivel</th><th>Categoría</th><th>Modalidad</th><th>Zona</th><th>Partidos</th><th>Puntos</th><th>Acciones</th></tr></thead>
      <tbody>${allPlayers.map(player => `<tr>
        <td>${escapeHtml(player.name)}</td><td>${escapeHtml(player.email || "-")}</td><td>${escapeHtml(player.level)}</td>
        <td>${escapeHtml(CATEGORY_LABELS[player.category || "singles"] || "Singles")}</td>
        <td>${escapeHtml(GENDER_LABELS[player.gender || "hombres"] || "Hombres")}</td>
        <td>${escapeHtml(player.zone)}</td><td>${Number(player.matches) || 0}</td><td>${Number(player.points) || 0}</td>
        <td><button class="btn btn-sm btn-dark" onclick="editAdminPlayer('${escapeHtml(player.id)}')">Editar</button>
        <button class="btn btn-sm btn-danger" onclick="deleteAdminPlayer('${escapeHtml(player.id)}')">Eliminar</button></td>
      </tr>`).join("") || '<tr><td colspan="9">No hay perfiles de jugador.</td></tr>'}</tbody>
    </table></div>
    </section>

    <section class="admin-section" id="admin-users"><h3>Cuentas registradas</h3>
    <p class="admin-section-help">Crea cuentas, gestiona emails y contraseñas, permisos y membresías. Por seguridad, las contraseñas nunca se muestran.</p>
    <label class="admin-search">Buscar usuario
      <input id="adminUserSearch" type="search" placeholder="Nombre o email">
    </label>
    <form id="adminUserCreateForm" class="admin-form">
      <h4 class="full admin-form-title">Crear cuenta nueva</h4>
      <label>Nombre<input name="name" maxlength="100" required></label>
      <label>Email<input name="email" type="email" required></label>
      <label>Contraseña<input name="password" type="password" minlength="8" maxlength="128" required placeholder="Mínimo 8 caracteres"></label>
      <label>Rol<select name="role"><option value="user">Usuario</option><option value="admin">Administrador</option></select></label>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Crear cuenta</button><button class="btn btn-secondary" type="button" onclick="resetAdminUserCreateForm()">Limpiar</button></div>
    </form>
    <form id="adminUserForm" class="admin-form">
      <input type="hidden" name="userId">
      <p class="full muted" id="adminUserSelection">Selecciona un usuario en la tabla para editarlo.</p>
      <label>Usuario<input name="identity" readonly></label>
      <label>Email<input name="email" type="email"></label>
      <label>Nueva contraseña<input name="password" type="password" minlength="8" maxlength="128" placeholder="Dejar vacío para no cambiar"></label>
      <label>Rol<select name="role"><option value="user">Usuario</option><option value="admin">Administrador</option></select></label>
      <label>Nivel<select name="level"><option value="">Sin nivel</option>${levels.map(level => `<option value="${level}">${level}</option>`).join("")}</select></label>
      <label>Zona<select name="zone"><option value="">Sin zona</option><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label>
      <label>Teléfono<input name="phone" type="tel" placeholder="Ej. +1 305 555 0123"></label>
      <label class="full"><span><input name="membershipActive" type="checkbox"> Membresía activa</span></label>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar usuario</button><button class="btn btn-secondary" type="button" onclick="resetAdminUserForm()">Cancelar</button></div>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Nivel</th><th>Zona</th><th>Membresía</th><th>Acciones</th></tr></thead>
        <tbody id="adminUsersBody">
          ${users.map(u => `<tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.phone || "-")}</td>
            <td><span class="tag ${u.role === "admin" ? "tag-blue" : ""}">${u.role === "admin" ? "Administrador" : "Jugador"}</span></td>
            <td>${escapeHtml(u.level || "-")}</td>
            <td>${escapeHtml(u.zone || "-")}</td>
            <td>${u.membershipActive ? "Activa" : "-"}</td>
            <td><button class="btn btn-sm btn-dark" onclick="editAdminUser('${escapeHtml(u.id)}')">Editar</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    </section>

    <section class="admin-section" id="admin-settings"><h3>Ajustes del sitio</h3>
    <p class="admin-section-help">Configura el enlace del grupo de WhatsApp que aparece en la página pública.</p>
    <form id="adminSettingsForm" class="admin-form">
      <label class="full">Enlace del grupo de WhatsApp
        <input name="whatsappUrl" type="url" placeholder="https://chat.whatsapp.com/... o https://wa.me/...">
      </label>
      <p class="full muted">Acepta enlaces de invitación (chat.whatsapp.com/...) o enlaces por número (wa.me/...). Déjalo vacío para ocultar el botón flotante.</p>
      <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar ajustes</button></div>
    </form>
    </section>
  `;
  document.getElementById("adminTournamentForm").addEventListener("submit", saveTournament);
  document.getElementById("adminProductForm").addEventListener("submit", saveProduct);
  document.getElementById("adminUserForm").addEventListener("submit", saveAdminUser);
  document.getElementById("adminUserCreateForm").addEventListener("submit", createAdminUser);
  document.getElementById("adminPlayerForm").addEventListener("submit", saveAdminPlayer);
  document.getElementById("adminResultForm").addEventListener("submit", saveAdminResult);
  document.getElementById("adminUserSearch").addEventListener("input", filterAdminUsers);
  document.getElementById("adminSettingsForm").addEventListener("submit", saveAdminSettings);
  resetAdminUserForm();
  resetTournamentForm();
  resetProductForm();
  fillAdminSettingsForm();
  if (document.getElementById("adminModal")) openModal("adminModal");
}

async function syncAdminOrders() {
  try {
    const result = await api("/api/admin/orders/reconcile", { method: "POST" });
    adminOrdersChecked = true;
    showToast(result.added
      ? `Se recuperaron ${result.added} compra(s) desde Stripe.`
      : "Stripe está sincronizado; no hay compras faltantes.");
    await showAdminPanel();
  } catch (error) {
    showToast(`No se pudieron sincronizar los pagos: ${error.message}`);
  }
}

function renderAdminTournament(tournament) {
  const entrants = tournament.entries || [];
  const availablePlayers = players.filter(player =>
    !(tournament.entries || []).some(entry => entry.playerId === player.id) &&
    (tournament.levels || []).includes(player.level)
  );
  return `<article class="card admin-record">
    <div class="admin-record-head"><div><span class="tag">${escapeHtml(tournamentStatusLabel(tournament.status))}</span><h4>${escapeHtml(tournament.title || tournament.month)}</h4></div>
      <div class="admin-form-actions"><button class="btn btn-sm btn-dark" onclick="editTournament('${escapeHtml(tournament.id)}')">Editar</button>
      <button class="btn btn-sm btn-secondary" onclick="deleteTournament('${escapeHtml(tournament.id)}')">Eliminar</button></div>
    </div>
    <p class="muted">${escapeHtml(tournament.month)} · ${entrants.length} inscritos · ${escapeHtml(tournament.venue || "Sede por definir")}</p>
    <ul class="admin-entrant-list">${entrants.map(entry => `<li>
      <span>${escapeHtml(entry.name)} <small>${escapeHtml(entry.level || "")}</small></span>
      <button class="btn btn-sm btn-danger" onclick="removeTournamentEntry('${escapeHtml(tournament.id)}','${escapeHtml(entry.playerId)}')">Retirar</button>
    </li>`).join("") || '<li class="muted">Sin inscritos</li>'}</ul>
    ${tournament.status === "registration" && availablePlayers.length ? `<form class="admin-entry-form" onsubmit="addTournamentEntry(event,'${escapeHtml(tournament.id)}')">
      <label class="full">Agregar jugador inscrito
        <select name="playerId">${availablePlayers.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.level)}</option>`).join("")}</select>
      </label>
      <button class="btn btn-sm btn-dark full">Agregar participante</button>
    </form>` : ""}
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
      <button class="btn btn-sm btn-danger" onclick="deleteTournamentMatch('${escapeHtml(tournament.id)}','${escapeHtml(match.id)}')">Eliminar partido</button>
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
  form.elements.namedItem("category").value = tournament.category || "singles";
  form.elements.namedItem("gender").value = tournament.gender || "mixto";
  form.elements.namedItem("startDate").value = tournament.startDate || "";
  form.elements.namedItem("endDate").value = tournament.endDate || "";
  form.elements.namedItem("venue").value = tournament.venue || "";
  form.elements.namedItem("format").value = tournament.format || "";
  form.elements.namedItem("description").value = tournament.description || "";
  form.querySelectorAll('input[name="levels"]').forEach(input => {
    input.checked = (tournament.levels || []).includes(input.value);
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
    levels: Array.from(form.querySelectorAll('input[name="levels"]:checked'), input => input.value),
    status: form.elements.namedItem("status").value,
    category: form.elements.namedItem("category").value,
    gender: form.elements.namedItem("gender").value,
    startDate: form.elements.namedItem("startDate").value,
    endDate: form.elements.namedItem("endDate").value,
    venue: form.elements.namedItem("venue").value,
    format: form.elements.namedItem("format").value,
    description: form.elements.namedItem("description").value
  };
  if (!body.levels.length) {
    showToast("Selecciona al menos un nivel para el torneo.");
    form.querySelector('fieldset input[type="checkbox"]')?.focus();
    return;
  }
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

async function addTournamentEntry(event, tournamentId) {
  event.preventDefault();
  const playerId = event.target.elements.namedItem("playerId").value;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ addEntryPlayerId: playerId })
    });
    await Promise.all([loadTournaments(), showAdminPanel()]);
    showToast("Participante agregado al torneo.");
  } catch (error) {
    showToast(`No se pudo agregar al participante: ${error.message}`);
  }
}

async function removeTournamentEntry(tournamentId, playerId) {
  if (!window.confirm("¿Retirar este jugador del torneo? No se puede retirar si ya tiene partidos en el cuadro.")) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ removeEntryPlayerId: playerId })
    });
    await Promise.all([loadTournaments(), showAdminPanel()]);
    showToast("Inscripción retirada.");
  } catch (error) {
    showToast(`No se pudo retirar la inscripción: ${error.message}`);
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

async function deleteTournamentMatch(tournamentId, matchId) {
  if (!window.confirm("¿Eliminar este partido del cuadro?")) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ deleteMatchId: matchId })
    });
    await Promise.all([loadTournaments(), showAdminPanel()]);
    showToast("Partido eliminado del cuadro.");
  } catch (error) {
    showToast(`No se pudo eliminar el partido: ${error.message}`);
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
  form.elements.namedItem("category").value = product.category || "";
  form.elements.namedItem("description").value = product.description || "";
  form.elements.namedItem("active").checked = product.active !== false;
  const imageInput = form.elements.namedItem("image");
  imageInput.value = product.image || "";
  const preview = document.getElementById("productImagePreview");
  if (preview) {
    preview.style.display = imageInput.value ? "block" : "none";
    if (imageInput.value) preview.src = imageInput.value;
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function previewProductImageFile(input) {
  const preview = document.getElementById("productImagePreview");
  const file = input.files && input.files[0];
  if (!preview) return;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    preview.style.display = "block";
  };
  reader.readAsDataURL(file);
}

async function compressProductImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Formato de imagen no soportado."));
    element.src = dataUrl;
  });
  const maxSize = 800;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function uploadProductImage(form) {
  const fileInput = form.elements.namedItem("imageFile");
  const file = fileInput?.files?.[0];
  if (!file) return form.elements.namedItem("image").value.trim();
  const compressed = await compressProductImage(file);
  const uploaded = await api("/api/admin/uploads", {
    method: "POST",
    body: JSON.stringify({ image: compressed, filename: file.name })
  });
  return uploaded.url;
}

function resetProductForm() {
  const form = document.getElementById("adminProductForm");
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("image").value = "";
  const preview = document.getElementById("productImagePreview");
  if (preview) preview.style.display = "none";
  form.elements.namedItem("category").value = "";
  form.elements.namedItem("active").checked = true;
}async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  const amount = Number(form.elements.namedItem("price").value);
  const price = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(price)) {
    showToast("Ingresa un precio válido en dólares.");
    return;
  }
  let imageUrl;
  try {
    imageUrl = await uploadProductImage(form);
  } catch (error) {
    showToast(`No se pudo subir la imagen: ${error.message}`);
    return;
  }
  const body = {
    name: form.elements.namedItem("name").value,
    price,
    type: form.elements.namedItem("type").value,
    interval: form.elements.namedItem("interval").value,
    category: form.elements.namedItem("category").value,
    description: form.elements.namedItem("description").value,
    image: imageUrl,
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

async function toggleProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  try {
    await api(`/api/products/${encodeURIComponent(product.id)}`, {
      method: "PUT",
      body: JSON.stringify({ active: !product.active })
    });
    await loadProducts();
    await showAdminPanel();
    showToast(product.active ? "Producto desactivado; se conserva el historial de ventas." : "Producto activado.");
  } catch (error) {
    showToast(`No se pudo cambiar el estado: ${error.message}`);
  }
}

async function deleteProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product || !window.confirm(`¿Eliminar "${product.name}" permanentemente? Para conservar registros de compra, es mejor desactivarlo.`)) return;
  try {
    await api(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    await loadProducts();
    await showAdminPanel();
    showToast("Producto eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
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

function editAdminResult(resultId) {
  const result = matchResults.find(item => item.id === resultId);
  const form = document.getElementById("adminResultForm");
  if (!result || !form) return;
  form.hidden = false;
  form.elements.namedItem("resultId").value = result.id;
  form.elements.namedItem("winnerId").value = result.winnerId;
  form.elements.namedItem("loserId").value = result.loserId;
  form.elements.namedItem("score").value = result.score;
  form.elements.namedItem("playedAt").value = (result.playedAt || result.created || "").slice(0, 10);
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelAdminResultEdit() {
  const form = document.getElementById("adminResultForm");
  form.reset();
  form.hidden = true;
}

async function saveAdminResult(event) {
  event.preventDefault();
  const form = event.target;
  if (form.elements.namedItem("winnerId").value === form.elements.namedItem("loserId").value) {
    showToast("El ganador y el rival deben ser distintos.");
    return;
  }
  try {
    await api("/api/admin/results", {
      method: "PATCH",
      body: JSON.stringify({
        action: "edit",
        resultId: form.elements.namedItem("resultId").value,
        winnerId: form.elements.namedItem("winnerId").value,
        loserId: form.elements.namedItem("loserId").value,
        score: form.elements.namedItem("score").value,
        playedAt: form.elements.namedItem("playedAt").value
      })
    });
    await Promise.all([loadPlayers(), loadResults(), showAdminPanel()]);
    showToast("Resultado corregido; falta confirmación del rival.");
  } catch (error) {
    showToast(`No se pudo corregir el resultado: ${error.message}`);
  }
}

async function deleteAdminResult(resultId) {
  if (!window.confirm("¿Eliminar este resultado definitivamente? Si estaba confirmado, dejará de contar en el ranking.")) return;
  try {
    await api("/api/admin/results", {
      method: "DELETE",
      body: JSON.stringify({ resultId })
    });
    await Promise.all([loadPlayers(), loadResults(), showAdminPanel()]);
    showToast("Resultado eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar el resultado: ${error.message}`);
  }
}

async function setChallengeStatus(challengeId, status) {
  try {
    await api("/api/admin/challenges", {
      method: "PATCH",
      body: JSON.stringify({ challengeId, status })
    });
    await showAdminPanel();
    showToast(status === "closed" ? "Desafío cerrado." : "Desafío reabierto.");
  } catch (error) {
    showToast(`No se pudo actualizar el desafío: ${error.message}`);
  }
}

async function deleteAdminChallenge(challengeId) {
  if (!window.confirm("¿Eliminar este desafío definitivamente?")) return;
  try {
    await api("/api/admin/challenges", {
      method: "DELETE",
      body: JSON.stringify({ challengeId })
    });
    await showAdminPanel();
    showToast("Desafío eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
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

function toggleMenu() {
  document.getElementById("nav")?.classList.toggle("open");
}

function closeNavMenu() {
  document.getElementById("nav")?.classList.remove("open");
}

function scrollToSection(sel) {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

function scrollAdminTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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

function formatLocalDate(value) {
  return new Date(value).toLocaleDateString(window.leagueI18n?.locale || "es");
}

function renderPaymentReturnNotice() {
  const notice = document.getElementById("paymentReturnNotice");
  if (!notice || !paymentNoticeState) return;
  notice.hidden = false;
  notice.className = `payment-return-notice is-${paymentNoticeState.type || "pending"}`;
  notice.replaceChildren();
  const message = document.createElement("p");
  message.textContent = window.leagueI18n?.translate(paymentNoticeState.message) || paymentNoticeState.message;
  notice.append(message);
  if (paymentNoticeState.detail) {
    const detail = document.createElement("small");
    detail.textContent = paymentNoticeState.detail;
    notice.append(detail);
  }
  if (paymentNoticeState.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-dark";
    button.textContent = window.leagueI18n?.translate(paymentNoticeState.action.label) || paymentNoticeState.action.label;
    button.addEventListener("click", paymentNoticeState.action.run);
    notice.append(button);
  }
}

function clearPaymentReturnParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function verifyPaymentReturn(sessionId) {
  paymentNoticeState = { message: "Procesando pago...", type: "pending", sessionId };
  renderPaymentReturnNotice();
  try {
    const data = await api(`/api/stripe/session/${encodeURIComponent(sessionId)}`);
    if (data.status === "paid") {
      paymentNoticeState = { message: "Pago confirmado. ¡Gracias por tu compra!", type: "success" };
      clearPaymentReturnParams();
    } else {
      paymentNoticeState = {
        message: "Tu pago está pendiente de confirmación.",
        type: "pending",
        sessionId,
        action: { label: "Volver a verificar", run: () => verifyPaymentReturn(sessionId) }
      };
    }
  } catch (error) {
    const requiresLogin = /inicia sesión|no autenticado/i.test(error.message);
    paymentNoticeState = {
      message: "No pudimos verificar el pago.",
      type: "error",
      detail: error.message,
      sessionId,
      action: requiresLogin
        ? { label: "Iniciar sesión para verificar", run: () => openModal("loginModal") }
        : { label: "Volver a verificar", run: () => verifyPaymentReturn(sessionId) }
    };
  }
  renderPaymentReturnNotice();
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment");
  if (paymentStatus === "success") {
    const sessionId = params.get("session_id");
    if (!sessionId) {
      paymentNoticeState = { message: "No pudimos verificar el pago.", type: "error" };
      renderPaymentReturnNotice();
      return;
    }
    verifyPaymentReturn(sessionId);
  } else if (paymentStatus === "canceled") {
    paymentNoticeState = { message: "Pago cancelado. No se realizó ningún cargo.", type: "info" };
    renderPaymentReturnNotice();
    clearPaymentReturnParams();
  }
}

document.addEventListener("languagechange", () => {
  renderPaymentReturnNotice();
  if (isAdminPage) {
    if (currentUser?.role === "admin") showAdminPanel();
    return;
  }
  renderProducts();
  renderRanking();
  renderResults();
  renderChallenges();
  renderTournaments();
});

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("registerForm")?.addEventListener("submit", register);
  document.getElementById("resultForm")?.addEventListener("submit", submitResult);
  document.getElementById("challengeForm")?.addEventListener("submit", submitChallenge);
  document.getElementById("playerForm")?.addEventListener("submit", createPlayer);
  document.getElementById("levelFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("zoneFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("categoryFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("genderFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("searchPlayer")?.addEventListener("input", filterPlayers);
  syncHeaderLayout();
  HEADER_MOBILE_MEDIA.addEventListener("change", syncHeaderLayout);
  initWhatsAppPromos();
  loadWhatsAppSettings();

  const nav = document.getElementById("nav");
  nav?.addEventListener("click", event => {
    if (event.target.closest("a")) closeNavMenu();
  });
  window.matchMedia("(max-width: 1080px)").addEventListener("change", event => {
    if (!event.matches) closeNavMenu();
  });

  if (!isAdminPage) handlePaymentReturn();
  await checkAuth();
  if (!isAdminPage) await loadWhatsAppSettings();
  if (isAdminPage) {
    if (!currentUser) {
      window.location.replace("/?admin=login");
      return;
    }
    if (currentUser.role !== "admin") {
      window.location.replace("/");
      return;
    }
    await showAdminPanel();
    return;
  }
  await Promise.all([loadProducts(), loadPlayers(), loadTournaments()]);
  if (new URLSearchParams(window.location.search).get("admin") === "login") {
    openModal("loginModal");
  }
});

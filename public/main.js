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
let adminTournaments = [];
let adminOrdersChecked = false;
let paymentNoticeState = null;
let currentAdminModule = "tournaments";
const isStorePage = /\/tienda(?:\.html)?\/?$/.test(window.location.pathname);

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
    promptPhoneIfNeeded();
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
    const publishBtn = document.getElementById("publishChallengeBtn");
    if (publishBtn) {
      const canPublish = ["member", "admin"].includes(currentUser.role);
      publishBtn.hidden = !canPublish;
      publishBtn.disabled = !canPublish;
    }
  } else {
    authBtns.innerHTML = `
      <button class="btn btn-sm" onclick="openModal('loginModal')">Iniciar sesión</button>
      <button class="btn btn-sm btn-primary" onclick="openModal('registerModal')">Registrarse</button>
    `;
    const publishBtn = document.getElementById("publishChallengeBtn");
    if (publishBtn) { publishBtn.hidden = true; publishBtn.disabled = true; }
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
    closeNavMenu();
    updateAuthUI();
    promptPhoneIfNeeded();
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
        zone: form.zone.value,
        nationality: form.elements.namedItem("nationality") ? form.elements.namedItem("nationality").value.trim() : ""
      })
    });
    currentUser = data.user;
    closeModal("registerModal");
    closeNavMenu();
    updateAuthUI();
    promptPhoneIfNeeded();
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
    closeNavMenu();
    window.location.replace("/");
  } catch (error) {
    showToast(error.message);
  }
}

function openRecoveryModal() {
  closeModal("loginModal");
  showNotice("recoveryNotice", "", false);
  openModal("recoveryModal");
}

async function recoverPassword(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        email: form.elements.namedItem("email").value,
        phoneLast4: form.elements.namedItem("phoneLast4").value.trim(),
        newPassword: form.elements.namedItem("newPassword").value
      })
    });
    form.reset();
    showNotice("recoveryNotice", "Contraseña restablecida. Ya puedes iniciar sesión con tu nueva clave.", false);
    setTimeout(() => {
      closeModal("recoveryModal");
      openModal("loginModal");
    }, 1800);
  } catch (error) {
    showNotice("recoveryNotice", error.message, true);
  }
}

function ensurePhoneRequiredModal() {
  if (document.getElementById("phoneRequiredModal")) return;
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "phoneRequiredModal";
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><h2>Registra tu teléfono</h2></div>
      <p>Para recuperar tu contraseña necesitamos tu número de celular. Regístralo ahora; solo te lo pediremos una vez.</p>
      <form id="phoneRequiredForm" class="admin-form">
        <label class="full">Teléfono<input name="phone" type="tel" required placeholder="Ej. +1 305 555 0123"></label>
        <div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar teléfono</button></div>
      </form>
      <p id="phoneRequiredNotice" class="notice"></p>
    </div>`;
  document.body.appendChild(modal);
}

async function saveRequiredPhone(event) {
  event.preventDefault();
  const form = event.target;
  const phone = form.elements.namedItem("phone").value.trim();
  const notice = document.getElementById("phoneRequiredNotice");
  try {
    const data = await api("/api/auth/phone", {
      method: "POST",
      body: JSON.stringify({ phone })
    });
    currentUser = data.user || currentUser;
    if (currentUser) currentUser.phone = phone;
    closeModal("phoneRequiredModal");
    updateAuthUI();
    showToast("Teléfono registrado correctamente.");
  } catch (error) {
    if (notice) showNotice("phoneRequiredNotice", error.message, true);
  }
}

function promptPhoneIfNeeded() {
  if (!currentUser || currentUser.phone) return;
  ensurePhoneRequiredModal();
  const form = document.getElementById("phoneRequiredForm");
  if (form && !form.dataset.bound) {
    form.addEventListener("submit", saveRequiredPhone);
    form.dataset.bound = "1";
  }
  openModal("phoneRequiredModal");
}

// ============ PRODUCTS & STRIPE ============`
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

function isStoreMember() {
  return !!currentUser && (currentUser.role === "member" || currentUser.role === "admin" || currentUser.membershipActive === true);
}
function renderProductCard(p) {
  const isBook = p.category === "libros" || (!p.category && p.type === "digital");
  const member = isStoreMember();
  const priceHtml = member && isBook
    ? `<div class="price">Gratis para miembros</div><p class="muted small">Precio de referencia: $${(p.price / 100).toFixed(2)}</p>`
    : `<div class="price">$${(p.price / 100).toFixed(2)}</div>`;
  const buttonHtml = member && isBook
    ? `<button class="btn btn-secondary" disabled>Incluido en tu membresia</button>`
    : `<button class="btn btn-dark" onclick="checkout('${p.id}')">Comprar</button>`;
  return `<article class="card book-card">
    ${p.image ? `<div class="book-cover"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy"></div>` : `<div class="book-cover">${escapeHtml(p.name).replace(" ", "<br>")}</div>`}
    <h3>${escapeHtml(p.name)}</h3>
    <p class="muted">${escapeHtml(p.description || "")}</p>
    ${priceHtml}
    ${buttonHtml}
  </article>`;
}

function setStoreTab(tab) {
  document.querySelectorAll("[data-store-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.storeTab === tab);
  });
  document.querySelectorAll("[data-store-panel]").forEach(panel => {
    panel.hidden = panel.dataset.storePanel !== tab;
  });
  if (location.hash !== `#${tab}`) {
    history.replaceState(null, "", `#${tab}`);
  }
}

function renderStorePage() {
  const ropaContainer = document.getElementById("storeRopaList");
  const librosContainer = document.getElementById("storeLibrosList");
  if (!ropaContainer || !librosContainer) return;
  const shopProducts = products.filter(product => product.type !== "subscription");
  const ropa = shopProducts.filter(product =>
    product.category === "ropa" || (!product.category && product.type !== "digital"));
  const libros = shopProducts.filter(product =>
    product.category === "libros" || (!product.category && product.type === "digital"));
  ropaContainer.innerHTML = ropa.map(renderProductCard).join("") ||
    '<p class="muted">No hay productos de ropa y accesorios disponibles en este momento.</p>';
  librosContainer.innerHTML = libros.map(renderProductCard).join("") ||
    '<p class="muted">No hay libros disponibles en este momento.</p>';
  const initialTab = location.hash === "#libros" ? "libros" : "ropa";
  setStoreTab(initialTab);
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
  const query = (document.getElementById("adminUserSearch")?.value || "").trim().toLowerCase();
  const roleFilter = document.getElementById("adminUserRoleFilter")?.value || "all";
  const phoneFilter = document.getElementById("adminUserPhoneFilter")?.value || "all";
  document.querySelectorAll("#adminUsersBody tr").forEach(row => {
    const matchesQuery = !query || row.textContent.toLowerCase().includes(query);
    const matchesRole = roleFilter === "all" || row.dataset.role === roleFilter;
    const matchesPhone = phoneFilter === "all" ||
      (phoneFilter === "with" && row.dataset.hasPhone === "true") ||
      (phoneFilter === "without" && row.dataset.hasPhone === "false");
    row.hidden = !(matchesQuery && matchesRole && matchesPhone);
  });
}

function editAdminUser(userId) {
  const user = adminUsers.find(item => item.id === userId);
  if (!user) return;
  const form = document.getElementById("adminUserForm");
  if (!form) return;
  form.elements.namedItem("userId").value = user.id;
  form.elements.namedItem("identity").value = `${user.name} · ${user.email}`;
  form.elements.namedItem("email").value = user.email || "";
  form.elements.namedItem("password").value = "";
  form.elements.namedItem("role").value = user.role || "user";
  form.elements.namedItem("level").value = user.level || "";
  form.elements.namedItem("zone").value = user.zone || "";
  form.elements.namedItem("phone").value = user.phone || "";
  if (form.elements.namedItem("nationality")) form.elements.namedItem("nationality").value = user.nationality || "";
  form.elements.namedItem("membershipActive").checked = user.membershipActive === true;
  document.getElementById("adminUserSelection").textContent = `Editando: ${user.name}`;
  openModal("adminUserEditModal");
}

async function deleteAdminUser(userId) {
  const user = adminUsers.find(item => item.id === userId);
  if (!user) return;
  if (!window.confirm(`¿Eliminar la cuenta de ${user.name}? Esta acción no se puede deshacer.`)) return;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "delete", userId })
    });
    await showAdminPanel();
    showToast("Usuario eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
  }
}

function resetAdminUserForm() {
  const form = document.getElementById("adminUserForm");
  if (!form) return;
  form.reset();
  form.elements.namedItem("userId").value = "";
  form.elements.namedItem("identity").value = "";
  form.elements.namedItem("password").value = "";
  document.getElementById("adminUserSelection").textContent = "Selecciona un usuario en la tabla para editarlo.";
  closeModal("adminUserEditModal");
}

async function fillAdminSettingsForm() {
  const form = document.getElementById("adminSettingsForm");
  if (!form) return;
  try {
    const data = await api("/api/admin/settings");
    if (form.elements.namedItem("whatsappPhone")) form.elements.namedItem("whatsappPhone").value = data.whatsappPhone || "";
  if (form.elements.namedItem("whatsappMessage")) form.elements.namedItem("whatsappMessage").value = data.whatsappMessage || "";
  if (form.elements.namedItem("whatsappUrl")) form.elements.namedItem("whatsappUrl").value = data.whatsappUrl || "";
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
      body: JSON.stringify({ whatsappPhone: form.elements.namedItem("whatsappPhone") ? form.elements.namedItem("whatsappPhone").value.trim() : "", whatsappMessage: form.elements.namedItem("whatsappMessage") ? form.elements.namedItem("whatsappMessage").value.trim() : "", whatsappUrl: form.elements.namedItem("whatsappUrl") ? form.elements.namedItem("whatsappUrl").value.trim() : "" })
    });
    whatsappGroupUrl = data.whatsappUrl || "";
    if (form.elements.namedItem("whatsappPhone")) form.elements.namedItem("whatsappPhone").value = data.whatsappPhone || "";
    if (form.elements.namedItem("whatsappMessage")) form.elements.namedItem("whatsappMessage").value = data.whatsappMessage || "";
    if (form.elements.namedItem("whatsappUrl")) form.elements.namedItem("whatsappUrl").value = data.whatsappUrl || "";
    applyWhatsAppLinks();
    showToast("Ajustes guardados.");
  } catch (error) {
    showToast(`No se pudo guardar la configuración: ${error.message}`);
  }
}

let adminRanking = [];
let adminRankingScope = "all";

function fillAdminRankingScope(select) {
  if (!select) return;
  select.innerHTML = '<option value="all">Ranking general</option>' +
    (adminTournaments || []).map(tournament =>
      `<option value="${escapeHtml(tournament.id)}">${escapeHtml(tournament.title || `Torneo ${tournament.month}`)}</option>`
    ).join("");
  select.value = adminRankingScope;
}

// El ranking se calcula solo (1 punto por victoria confirmada, incluye
// partidos de torneos). Este módulo es un visor por torneo o general.
async function renderAdminRanking(scope = adminRankingScope) {
  const wanted = scope || "all";
  adminRankingScope = wanted;
  const body = document.getElementById("adminRankingBody");
  if (!body) return;
  try {
    const url = wanted === "all"
      ? "/api/players"
      : `/api/players?ranking=${encodeURIComponent(wanted)}`;
    adminRanking = await api(url);
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No se pudo cargar el ranking: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (adminRankingScope !== wanted) return;
  fillAdminRankingScope(document.getElementById("adminRankingScope"));
  let lastPoints = null;
  let lastPos = 0;
  body.innerHTML = adminRanking.map((player, index) => {
    const pos = player.points === lastPoints ? lastPos : index + 1;
    lastPoints = player.points;
    lastPos = pos;
    return `<tr>
      <td><b>${pos}</b></td>
      <td>${escapeHtml(player.name)}</td>
      <td>${escapeHtml(player.level || "-")}</td>
      <td>${player.matches || 0}</td>
      <td class="ranking-manual-control"><input id="manual-points-${escapeHtml(player.id)}" type="number" min="0" max="1000000" step="1" value="${Number.isFinite(player.manualPoints) ? player.manualPoints : (Number(player.points) || 0)}" aria-label="Puntos manuales para ${escapeHtml(player.name)}"><button class="btn btn-sm btn-secondary" type="button" onclick="saveManualRankingPoints('${escapeHtml(player.id)}')">Guardar</button></td>
      <td><b>${player.points || 0}</b></td>
    </tr>`;
  }).join("") || '<tr><td colspan="6" class="muted">Todavía no hay jugadores registrados.</td></tr>';
}

async function saveManualRankingPoints(playerId) {
  const input = document.getElementById(`manual-points-${playerId}`);
  const manualPoints = Number(input?.value);
  if (!Number.isInteger(manualPoints) || manualPoints < 0 || manualPoints > 1000000) {
    showToast("Ingresa puntos manuales entre 0 y 1.000.000.");
    return;
  }
  try {
    await api("/api/admin/players", {
      method: "PATCH",
      body: JSON.stringify({ playerId, updates: { manualPoints } })
    });
    await renderAdminRanking();
    showToast("Puntos manuales guardados; el total conserva los puntos automáticos.");
  } catch (error) {
    showToast(`No se pudieron guardar los puntos: ${error.message}`);
  }
}

function openCreateUserModal() {
  document.getElementById("adminUserCreateForm")?.reset();
  openModal("adminUserCreateModal");
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
        role: form.elements.namedItem("role").value,
        nationality: form.elements.namedItem("nationality") ? form.elements.namedItem("nationality").value.trim() : ""
      })
    });
    form.reset();
    closeModal("adminUserCreateModal");
    await showAdminPanel();
    showToast("Cuenta creada.");
  } catch (error) {
    showToast(`No se pudo crear la cuenta: ${error.message}`);
  }
}

function resetAdminUserCreateForm() {
  document.getElementById("adminUserCreateForm")?.reset();
  closeModal("adminUserCreateModal");
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
    nationality: form.elements.namedItem("nationality") ? (form.elements.namedItem("nationality").value.trim() || null) : undefined,
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
    closeModal("adminUserEditModal");
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
  if (!form) return;
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
  if (!form) return;
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

async function loadChallenges() {  try {
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
    container.innerHTML = '<p class="muted challenge-empty-note">Aún no hay desafíos publicados. ¡Publica el primero y encuentra tu rival!</p>';
    return;
  }
  container.innerHTML = leagueChallenges.map(challenge => {
    const canAccept = currentUser && currentUser.id !== challenge.creatorUserId && challenge.status === "open";
    const canDeleteOwn = currentUser && currentUser.id === challenge.creatorUserId && challenge.status === "open";
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
      ${canDeleteOwn ? '<button class="btn btn-secondary challenge-own-delete" onclick="deleteOwnChallenge(\'' + escapeHtml(challenge.id) + '\')">Eliminar mi desafío</button>' : ""}
    </article>`;
  }).join("");
}

function challengeStatusLabel(status) {
  if (status === "open") return "Busca rival";
  if (status === "accepted") return "Partido coordinado";
  if (status === "closed") return "Cerrado";
  return "Desafío";
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

async function deleteOwnChallenge(challengeId) {
  if (!window.confirm("¿Eliminar tu desafío? Dejará de aparecer en la zona de desafíos.")) return;
  try {
    await api(`/api/challenges?challengeId=${encodeURIComponent(challengeId)}`, { method: "DELETE" });
    await loadChallenges();
    showToast("Desafío eliminado.");
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

// Ranking real: ordena por puntos (desc) para que la tabla y el podio 3D
// reflejen la misma clasificación que el ranking.
function sortByRanking(list) {
  return [...list].sort((a, b) =>
    ((b.points || 0) - (a.points || 0)) ||
    ((b.matches || 0) - (a.matches || 0)) ||
    String(a.name).localeCompare(String(b.name))
  );
}

// Ranking unificado con filtro: "all" (general: retos confirmados + torneos)
// o el id de un torneo (solo los partidos de ese torneo).
let rankingScope = "all";
let rankingData = [];

async function loadRanking(scope = rankingScope) {
  const wanted = scope || "all";
  rankingScope = wanted;
  const tbody = document.getElementById("rankingBody");
  try {
    rankingData = wanted === "all"
      ? players.slice()
      : await api(`/api/players?ranking=${encodeURIComponent(wanted)}`);
  } catch (error) {
    rankingData = [];
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No se pudo cargar el ranking: ${escapeHtml(error.message)}</td></tr>`;
    }
    return;
  }
  if (rankingScope !== wanted) return;
  updateRankingScopeOptions();
  filterPlayers();
}

function updateRankingScopeOptions() {
  const select = document.getElementById("rankingScopeFilter");
  if (!select) return;
  select.innerHTML = '<option value="all">Ranking general</option>' +
    (tournaments || []).map(tournament =>
      `<option value="${escapeHtml(tournament.id)}">${escapeHtml(tournament.title || `Torneo ${tournament.month}`)}</option>`
    ).join("");
  select.value = rankingScope;
}

async function onRankingScopeChange(value) {
  await loadRanking(value);
}

function renderRanking() {
  loadRanking();
}

function filterPlayers() {
  const tbody = document.getElementById("rankingBody");
  if (!tbody) return;
  if (!rankingData.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">Todavía no hay jugadores para mostrar.</td></tr>';
    window.__ranking3dUpdate?.([]);
    return;
  }
  const level = document.getElementById("levelFilter")?.value;
  const zone = document.getElementById("zoneFilter")?.value;
  const category = document.getElementById("categoryFilter")?.value;
  const gender = document.getElementById("genderFilter")?.value;
  const q = document.getElementById("searchPlayer")?.value.toLowerCase();
  const filtered = sortByRanking(rankingData.filter(p =>
    (!level || p.level === level) &&
    (!zone || p.zone === zone) &&
    (!category || (p.category || "singles") === category) &&
    (!gender || (p.gender || "hombres") === gender) &&
    (!q || p.name.toLowerCase().includes(q))
  ));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">No hay jugadores con esos filtros.</td></tr>';
    window.__ranking3dUpdate?.([]);
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
      <td>${p.matches || 0}</td>
      <td><b>${(p.points || 0).toLocaleString()}</b></td>
    </tr>`;
  }).join("");
  window.__ranking3dUpdate?.(filtered);
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

// ============ PUBLIC TOURNAMENTS ============
async function loadTournaments() {
  try {
    const data = await api("/api/tournament");
    tournaments = data.tournaments || [];
    updateRankingScopeOptions();
    const featured = tournaments.find(item => item.month === new Date().toISOString().slice(0, 7)) ||
      tournaments.find(item => ["registration", "scheduled", "in_progress"].includes(item.status)) ||
      tournaments[0];
    if (featured) {
      const title = document.getElementById("heroTournamentTitle");
      const date = document.getElementById("heroTournamentDate");
      const summary = document.getElementById("heroTournamentSummary");
      if (title) title.textContent = featured.title || `Campeonato · ${featured.month}`;
      if (date) date.textContent = featured.startDate ? formatLocalDate(new Date(`${featured.startDate}T00:00:00`)) : featured.month;
      if (summary) summary.textContent = featured.description || `${(featured.entries || []).length} inscritos · ${featured.format || "Formato por anunciar"}`;
    }
  } catch (error) {
    showToast(`No se pudieron cargar los torneos: ${error.message}`);
  }
  mountPublicTournament();
}

function mountPublicTournament() {
  const root = document.getElementById("tournamentPublicMount");
  if (!root || !window.TournamentApp) return;
  window.TournamentApp.mount(root, {
    mode: "public",
    currentUserId: currentUser?.id || null,
    showRankings: false
  });
}

function mountAdminTournament() {
  const root = document.getElementById("tournamentAdminMount");
  if (!root || !window.TournamentApp) return;
  window.TournamentApp.mount(root, {
    mode: "admin",
    isAdmin: true,
    currentUserId: currentUser?.id || null,
    showRankings: false
  });
}

// ========================================
// TORNEOS - MODERNIZACIÓN COMPLETA
// ========================================

function setAdminModule(moduleId) {
  currentAdminModule = moduleId;
  document.querySelectorAll(".admin-module").forEach(section => {
    section.hidden = section.dataset.module !== moduleId;
  });
  document.querySelectorAll("[data-module-btn]").forEach(button => {
    button.classList.toggle("active", button.dataset.moduleBtn === moduleId);
  });
  document.querySelector(".admin-nav")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

// ========================================
// PANEL DE ADMINISTRACIÓN - ORQUESTADOR
// ========================================
async function showAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") return;
  const content = document.getElementById("adminContent");
  let orderSyncMessage = "";
  try {
    const sync = await api("/api/admin/orders/reconcile", { method: "POST" });
    if (sync.added) {
      orderSyncMessage = "Se recuperaron " + sync.added + " compra(s) faltante(s) desde Stripe.";
    }
  } catch (error) {
    orderSyncMessage = "No se pudo sincronizar con Stripe: " + escapeHtml(error.message);
  }
  let stats, orders, users, allProducts, allTournaments, results, allChallenges;
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
      content.innerHTML =
        '<div class="admin-load-error" role="alert">' +
        '<p>No se pudo cargar el panel: ' + escapeHtml(error.message) + '</p>' +
        '<button class="btn btn-primary" type="button" onclick="showAdminPanel()">Reintentar</button>' +
        '</div>';
    }
    showToast("No se pudo abrir administración: " + error.message);
    return;
  }
  if (!content) return;
  products = allProducts;
  tournaments = allTournaments;
  adminTournaments = allTournaments;
  matchResults = results;
  adminUsers = users;
  let allPlayers;
  try {
    allPlayers = await api("/api/admin/players");
  } catch (error) {
    content.innerHTML =
      '<div class="admin-load-error" role="alert">' +
      '<p>No se pudieron cargar los perfiles de jugadores: ' + escapeHtml(error.message) + '</p>' +
      '<button class="btn btn-primary" type="button" onclick="showAdminPanel()">Reintentar</button>' +
      '</div>';
    showToast("No se pudieron cargar los perfiles de jugadores: " + error.message);
    return;
  }
  players = allPlayers;
  const levels = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
  const pendingResults = results.filter(function(result) {
    return ["pending", "disputed"].includes(result.status);
  });
  const playersWithoutProfile = adminUsers.filter(function(user) {
    return !allPlayers.some(function(player) { return player.userId === user.id; });
  });

  var html = '';
  html += '<div class="admin-welcome">';
  html += '<div>';
  html += '<span class="section-kicker">CENTRO DE CONTROL</span>';
  html += '<h2>¿Qué quieres hacer hoy?</h2>';
  html += '<p>Elige una tarea para empezar. Los cambios se guardan al pulsar el botón de guardar.</p>';
  html += '</div>';
  html += '<div class="admin-quick-actions">';
  html += '<button type="button" onclick="setAdminModule(\'tournaments\')"><span>01</span><b>Organizar un torneo</b><small>Fechas, niveles y partidos</small></button>';
  html += '<button type="button" onclick="setAdminModule(\'results\')"><span>02</span><b>Revisar resultados</b><small>' + pendingResults.length + ' por revisar</small></button>';
  html += '<button type="button" onclick="setAdminModule(\'players\')"><span>03</span><b>Gestionar jugadores</b><small>Perfiles y clasificación</small></button>';
  html += '<button type="button" onclick="setAdminModule(\'products\')"><span>04</span><b>Editar la tienda</b><small>Productos y membresías</small></button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="admin-stats">';
  html += '<div class="stat-card"><div class="stat-number">' + stats.totalUsers + '</div><div class="stat-label">Cuentas registradas</div></div>';
  html += '<div class="stat-card"><div class="stat-number">' + stats.totalPlayers + '</div><div class="stat-label">Perfiles de jugador</div></div>';
  html += '<div class="stat-card"><div class="stat-number">' + stats.totalOrders + '</div><div class="stat-label">Compras realizadas</div></div>';
  html += '<div class="stat-card"><div class="stat-number">$' + (stats.revenue / 100).toFixed(2) + '</div><div class="stat-label">Ingresos totales</div></div>';
  html += '<div class="stat-card"><div class="stat-number">' + stats.activeSubscriptions + '</div><div class="stat-label">Membresías activas</div></div>';
  html += '<div class="stat-card"><div class="stat-number">' + pendingResults.length + '</div><div class="stat-label">Resultados por revisar</div></div>';
  html += '</div>';

  html += '<div class="admin-layout">';
  html += '<nav class="admin-nav" aria-label="Módulos de administración">';
  html += '<button type="button" data-module-btn="tournaments" onclick="setAdminModule(\'tournaments\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/></svg>Torneos</button>';
  html += '<button type="button" data-module-btn="players" onclick="setAdminModule(\'players\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>Jugadores</button>';
  html += '<button type="button" data-module-btn="results" onclick="setAdminModule(\'results\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21h18M7 17V9M12 17V5M17 17v-6"/></svg>Resultados</button>';
  html += '<button type="button" data-module-btn="challenges" onclick="setAdminModule(\'challenges\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>Desafíos</button>';
  html += '<button type="button" data-module-btn="products" onclick="setAdminModule(\'products\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>Tienda</button>';
  html += '<button type="button" data-module-btn="orders" onclick="setAdminModule(\'orders\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>Compras</button>';
  html += '<button type="button" data-module-btn="users" onclick="setAdminModule(\'users\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87"/></svg>Cuentas</button>';
  html += '<button type="button" data-module-btn="ranking" onclick="setAdminModule(\'ranking\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21h18M7 17V9M12 17V5M17 17v-6"/></svg>Ranking</button>';
  html += '<button type="button" data-module-btn="settings" onclick="setAdminModule(\'settings\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>Ajustes</button>';
  html += '</nav>';

  // Sección de torneos
  html += '<section class="admin-section admin-module" data-module="tournaments" hidden>';
  html += '<div id="tournamentAdminMount"></div>';
  html += '</section>';

  // Sección de pedidos / compras
  html += '<section class="admin-section admin-module" data-module="orders" hidden><h3>Compras recientes</h3><div class="admin-order-tools"><p class="admin-section-help">Consulta las compras y pagos realizados en la tienda.</p><button class="btn btn-secondary btn-sm" type="button" onclick="syncAdminOrders()">Sincronizar pagos con Stripe</button></div>' + (orderSyncMessage ? '<p class="admin-order-sync-message" role="status">' + escapeHtml(orderSyncMessage) + '</p>' : "") + '<div class="table-wrap" style="margin-bottom:20px"><table><thead><tr><th>ID</th><th>Usuario</th><th>Producto</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>' + orders.map(function(o) { return '<tr><td title="' + escapeHtml(o.id) + '">' + escapeHtml(o.id.slice(0, 8)) + '</td><td>' + escapeHtml(o.userName) + '</td><td>' + escapeHtml(o.productName) + '</td><td>$' + (o.amount / 100).toFixed(2) + '</td><td><span class="tag">' + escapeHtml(orderStatusLabel(o.status)) + '</span></td><td>' + (o.created ? formatLocalDate(o.created) : '-') + '</td></tr>'; }).join("") + '</tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="results" hidden><h3>Resultados de partidos</h3><p class="admin-section-help">Confirma, rechaza o elimina un reporte. Los resultados confirmados impactan el ranking.</p><div class="grid grid-2 admin-records">' + (pendingResults.length ? pendingResults.map(function(r) {
    return '<article class="card admin-record"><span class="tag ' + (r.status === "disputed" ? "tag-red" : "") + '">' + (r.status === "disputed" ? "En disputa" : "Pendiente") + '</span><h4>' + escapeHtml(r.winnerName) + ' vs ' + escapeHtml(r.loserName) + '</h4><p class="muted">' + escapeHtml(r.score) + '</p><div class="admin-form-actions"><button class="btn btn-primary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'confirm\')">Confirmar</button><button class="btn btn-secondary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'reject\')">Rechazar</button><button class="btn btn-dark" onclick="editAdminResult(\'' + escapeHtml(r.id) + '\')">Editar</button><button class="btn btn-danger" onclick="deleteAdminResult(\'' + escapeHtml(r.id) + '\')">Eliminar</button></div></article>';
  }).join("") : '<p class="muted">No hay resultados pendientes.</p>') + '</div><details class="admin-history"><summary>Historial de resultados (' + results.length + ')</summary><div class="table-wrap"><table><thead><tr><th>Partido</th><th>Marcador</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>' + results.map(function(r) { return '<tr><td>' + escapeHtml(r.winnerName) + ' vs ' + escapeHtml(r.loserName) + '</td><td>' + escapeHtml(r.score) + '</td><td>' + r.status + '</td><td>' + (r.playedAt ? formatLocalDate(r.playedAt) : '-') + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminResult(\'' + escapeHtml(r.id) + '\')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminResult(\'' + escapeHtml(r.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></details>' + '<form id="adminResultForm" class="admin-form admin-result-form" hidden><input type="hidden" name="resultId"><h4 class="full admin-form-title">Editar resultado reportado</h4><p class="full muted">Al guardar, volverá a estado pendiente para que el rival confirme el cambio.</p><label>Ganador<select name="winnerId" required>' + allPlayers.map(function(player) { return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + '</option>'; }).join("") + '</select></label><label>Rival<select name="loserId" required>' + allPlayers.map(function(player) { return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + '</option>'; }).join("") + '</select></label><label>Marcador desde el ganador<input name="score" required placeholder="6-4, 4-6, 10-7"></label><label>Fecha<input name="playedAt" type="date" required></label><div class="admin-form-actions full"><button class="btn btn-primary">Guardar y solicitar confirmación</button><button type="button" class="btn btn-secondary" onclick="cancelAdminResultEdit()">Cancelar</button></div></form></section>';

  html += '<section class="admin-section admin-module" data-module="players" hidden><h3>Jugadores de la liga</h3><p class="admin-section-help">Administra el nombre, nivel y zona que aparecen en la clasificación. Los perfiles con historial deportivo no se pueden borrar.</p><form id="adminPlayerForm" class="admin-form"><input type="hidden" name="playerId"><label class="full">Cuenta vinculada<select name="accountId" required><option value="">Selecciona una cuenta sin perfil</option>' + playersWithoutProfile.map(function(user) { return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + ' · ' + escapeHtml(user.email) + '</option>'; }).join("") + '</select></label><label>Nombre público<input name="name" maxlength="100" required></label><label>Nivel<select name="level" required>' + levels.map(function(level) { return '<option value="' + level + '">' + level + '</option>'; }).join("") + '</select></label><label>Categoría<select name="category" required><option value="singles">Singles</option><option value="dobles">Dobles</option><option value="dobles_mixtos">Dobles Mixtos</option></select></label><label>Modalidad<select name="gender" required><option value="hombres">Hombres</option><option value="mujeres">Mujeres</option></select></label><label class="full">Zona<select name="zone" required><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label><div class="admin-form-actions full"><button class="btn btn-primary">Guardar perfil</button><button type="button" class="btn btn-secondary" onclick="resetAdminPlayerForm()">Cancelar</button></div></form><div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Email</th><th>Nivel</th><th>Categoría</th><th>Modalidad</th><th>Zona</th><th>Partidos</th><th>Puntos</th><th>Acciones</th></tr></thead><tbody>' + players.map(function(player) { return '<tr><td>' + escapeHtml(player.name) + '</td><td>' + escapeHtml(player.email || '-') + '</td><td>' + escapeHtml(player.level) + '</td><td>' + escapeHtml(CATEGORY_LABELS[player.category || "singles"] || "Singles") + '</td><td>' + escapeHtml(GENDER_LABELS[player.gender || "hombres"] || "Hombres") + '</td><td>' + escapeHtml(player.zone) + '</td><td>' + Number(player.matches) + '</td><td>' + Number(player.points) + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminPlayer(\'' + escapeHtml(player.id) + '\')">Editar</button><button class="btn btn-sm btn-danger" onclick="deleteAdminPlayer(\'' + escapeHtml(player.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="products" hidden><h3>Tienda y membresías</h3><p class="admin-section-help">Lo que esté marcado como disponible se mostrará en la página principal.</p><form id="adminProductForm" class="admin-form"><input type="hidden" name="id"><label>Nombre<input name="name" maxlength="120" required></label><label>Precio (USD)<input name="price" type="number" min="0.01" step="0.01" required></label><label>Tipo<select name="type"><option value="digital">Producto digital</option><option value="subscription">Suscripción</option></select></label><label>Frecuencia<select name="interval"><option value="month">Mensual</option><option value="year">Anual</option></select></label><label>Categoría<select name="category"><option value="">General</option><option value="libros">Libros digitales</option><option value="ropa">Ropa y accesorios</option></select></label><label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label><label class="full">Imagen del producto<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp" onchange="previewProductImageFile(this)"></label><input type="hidden" name="image"><div class="full"><img id="productImagePreview" alt="" style="display:none; width:100%; max-height:160px; object-fit:cover; border-radius:8px; border:1px solid var(--line);"></div><label class="full"><span><input name="active" type="checkbox" checked> Disponible en la tienda</span></label><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar producto</button><button class="btn btn-secondary" type="button" onclick="resetProductForm()">Limpiar</button></div></form><div class="grid grid-3 admin-records">' + allProducts.map(function(product) { return '<article class="card admin-record"><h4>' + escapeHtml(product.name) + '</h4><p class="muted">$' + (product.price / 100).toFixed(2) + (product.type === "subscription" ? ' /' + (product.interval === "year" ? "año" : "mes") : "") + '</p><span class="tag ' + (product.active ? "" : "tag-red") + '">' + (product.active ? "Activo" : "Inactivo") + '</span><p class="muted">' + escapeHtml(product.description || "") + '</p><div class="admin-form-actions"><button class="btn btn-sm btn-dark" onclick="editProduct(\'' + escapeHtml(product.id) + '\')">Editar</button><button class="btn btn-sm btn-secondary" onclick="toggleProduct(\'' + escapeHtml(product.id) + '\')">' + (product.active ? "Desactivar" : "Activar") + '</button><button class="btn btn-sm btn-secondary" onclick="deleteProduct(\'' + escapeHtml(product.id) + '\')">Eliminar</button></div></article>'; }).join("") + '</div></section>';

  html += '<section class="admin-section admin-module" data-module="challenges" hidden><h3>Desafíos publicados</h3><p class="admin-section-help">Revisa la actividad de la comunidad, cierra publicaciones resueltas o elimina contenido inválido.</p><div class="grid grid-3 admin-records">' + allChallenges.map(function(challenge) { return '<article class="card admin-record"><span class="tag ' + (challenge.status === "accepted" ? "tag-blue" : "") + '">' + challengeStatusLabel(challenge.status) + '</span><h4>' + escapeHtml(challenge.playerName) + '</h4><p>' + escapeHtml(challenge.availability || "") + '</p>' + (challenge.acceptedPlayerName ? '<p class="muted">Aceptado por ' + escapeHtml(challenge.acceptedPlayerName) + '</p>' : "") + '<p class="muted">' + (challenge.created ? formatLocalDate(challenge.created) : "") + '</p><div class="admin-form-actions">' + (challenge.status !== "closed" ? '<button class="btn btn-sm btn-dark" onclick="setChallengeStatus(\'' + escapeHtml(challenge.id) + '\',\'closed\')">Cerrar</button>' : "") + (challenge.status === "closed" ? '<button class="btn btn-sm btn-secondary" onclick="setChallengeStatus(\'' + escapeHtml(challenge.id) + '\',\'open\')">Reabrir</button>' : "") + '<button class="btn btn-sm btn-danger" onclick="deleteAdminChallenge(\'' + escapeHtml(challenge.id) + '\')">Eliminar</button>' + '</div></article>'; }).join("") + '</div></section>';

  html += '<section class="admin-section admin-module" data-module="users" hidden><h3>Cuentas registradas</h3><p class="admin-section-help">Crea cuentas, gestiona emails y contraseñas, permisos y membresías. Por seguridad, las contraseñas nunca se muestran.</p><label class="admin-search">Buscar usuario<input id="adminUserSearch" type="search" placeholder="Nombre o email"></label><div class="grid grid-2"><label>Rol<select id="adminUserRoleFilter"><option value="all">Todos</option><option value="user">Usuario</option><option value="member">Miembro</option><option value="admin">Administrador</option></select></label><label>Teléfono<select id="adminUserPhoneFilter"><option value="all">Todos</option><option value="with">Con teléfono</option><option value="without">Sin teléfono</option></select></label></div><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Nivel</th><th>Zona</th><th>Membresía</th><th>Acciones</th></tr></thead><tbody id="adminUsersBody">' + users.map(function(u) { return '<tr data-role="' + (u.role || "user") + '" data-has-phone="' + (u.phone ? "true" : "false") + '"><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + escapeHtml(u.phone || '-') + '</td><td><span class="tag ' + (u.role === "admin" ? "tag-blue" : "") + '">' + (u.role === "admin" ? "Administrador" : u.role === "member" ? "Miembro" : "Usuario") + '</span></td><td>' + escapeHtml(u.level || '-') + '</td><td>' + escapeHtml(u.zone || '-') + '</td><td>' + (u.membershipActive ? "Activa" : "-") + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminUser(\'' + escapeHtml(u.id) + '\')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminUser(\'' + escapeHtml(u.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="ranking" hidden><h3>Ranking</h3><p class="admin-section-help">Ajusta la base manual de puntos por jugador. El total suma esa base y los puntos automáticos de victorias confirmadas. Filtra por torneo o general.</p><div class="admin-form" style="margin-bottom:10px"><label>Vista del ranking<select id="adminRankingScope" onchange="renderAdminRanking(this.value)"></select></label></div><div class="table-wrap"><table><thead><tr><th>Pos.</th><th>Jugador</th><th>Nivel</th><th>Partidos</th><th>Puntos manuales</th><th>Total</th></tr></thead><tbody id="adminRankingBody"></tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="settings" hidden><h3>Ajustes del sitio</h3><p class="admin-section-help">Configura el botón de WhatsApp de la página pública. Ingresa solo el número y el mensaje; el enlace se crea automáticamente.</p><form id="adminSettingsForm" class="admin-form"><label>Número de WhatsApp<input name="whatsappPhone" type="tel" placeholder="Ej. +1 305 555 0123"></label><label class="full">Mensaje predeterminado<textarea name="whatsappMessage" rows="2" maxlength="500" placeholder="Hola, quiero información sobre la liga"></textarea></label><label class="full">Enlace generado (opcional, solo lectura)<input name="whatsappUrl" type="url" readonly placeholder="Se genera automáticamente"></label><p class="full muted">Déjalo vacío para ocultar el botón flotante. También puedes pegar un enlace completo de WhatsApp si lo prefieres.</p><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar ajustes</button></div></form></section>';
  html += '</div>';
  html += '</div>';

  content.innerHTML = html;
  mountAdminTournament();
  document.getElementById("adminUserCreateForm")?.addEventListener("submit", createAdminUser);
  document.getElementById("adminUserSearch")?.addEventListener("input", filterAdminUsers);
  document.getElementById("adminUserRoleFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminUserPhoneFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminProductForm")?.addEventListener("submit", saveProduct);
  document.getElementById("adminUserForm")?.addEventListener("submit", saveAdminUser);
  document.getElementById("adminPlayerForm")?.addEventListener("submit", saveAdminPlayer);
  document.getElementById("adminResultForm")?.addEventListener("submit", saveAdminResult);
  document.getElementById("adminSettingsForm")?.addEventListener("submit", saveAdminSettings);
  resetAdminUserForm();
  resetProductForm();
  fillAdminSettingsForm();
  renderAdminRanking();
  setAdminModule(currentAdminModule);
  if (document.getElementById("adminModal")) openModal("adminModal");
}

function editProduct(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;
  const form = document.getElementById("adminProductForm");
  if (!form) return;
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
  if (!form) return;
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
});

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  try {
    document.getElementById("loginForm")?.addEventListener("submit", login);
  document.getElementById("registerForm")?.addEventListener("submit", register);
  document.getElementById("recoveryForm")?.addEventListener("submit", recoverPassword);
  document.getElementById("resultForm")?.addEventListener("submit", submitResult);
  document.getElementById("challengeForm")?.addEventListener("submit", submitChallenge);
  document.getElementById("playerForm")?.addEventListener("submit", createPlayer);
  document.getElementById("levelFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("zoneFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("categoryFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("genderFilter")?.addEventListener("change", filterPlayers);
  document.getElementById("searchPlayer")?.addEventListener("input", filterPlayers);
  document.getElementById("adminUserForm")?.addEventListener("submit", saveAdminUser);
  document.getElementById("adminUserCreateForm")?.addEventListener("submit", createAdminUser);

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

  if (!isAdminPage && !isStorePage) handlePaymentReturn();
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
  if (isStorePage) {
    await loadProducts();
    renderStorePage();
    return;
  }
  await Promise.all([loadProducts(), loadPlayers(), loadTournaments()]);
  loadRanking();
  if (new URLSearchParams(window.location.search).get("admin") === "login") {
    openModal("loginModal");
  }
  } catch (error) {
    console.error("Error inicializando la aplicación:", error);
    showToast("Error al cargar la aplicación: " + error.message);
  }
});

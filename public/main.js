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
        zone: form.zone.value
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

function renderProductCard(p) {
  return `<article class="card book-card">
    ${p.image ? `<div class="book-cover"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy"></div>` : `<div class="book-cover">${escapeHtml(p.name).replace(" ", "<br>")}</div>`}
    <h3>${escapeHtml(p.name)}</h3>
    <p class="muted">${escapeHtml(p.description || "")}</p>
    <div class="price">$${(p.price / 100).toFixed(2)}</div>
    <button class="btn btn-dark" onclick="checkout('${p.id}')">Comprar</button>
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

let adminRanking = [];

async function renderAdminRanking() {
  const body = document.getElementById("adminRankingBody");
  if (!body) return;
  try {
    adminRanking = await api("/api/admin/ranking2026");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No se pudo cargar el ranking: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  const sorted = [...adminRanking].sort((a, b) => b.points - a.points);
  let lastPoints = null;
  let lastPos = 0;
  const rows = sorted.map((entry, index) => {
    const pos = entry.points === lastPoints ? lastPos : index + 1;
    lastPoints = entry.points;
    lastPos = pos;
    return `<tr>
      <td><b>${pos}</b></td>
      <td>${escapeHtml(entry.player)}</td>
      <td><b>${entry.points}</b></td>
      <td><button class="btn btn-sm btn-dark" onclick="editAdminRanking('${escapeHtml(entry.player)}')">Editar</button>
      <button class="btn btn-sm btn-danger" onclick="deleteAdminRanking('${escapeHtml(entry.player)}')">Eliminar</button></td>
    </tr>`;
  });
  body.innerHTML = rows.join("") || '<tr><td colspan="4" class="muted">El ranking está vacío.</td></tr>';
}

function resetAdminRankingForm() {
  const form = document.getElementById("adminRankingForm");
  form.reset();
  form.elements.namedItem("mode").value = "add";
  document.getElementById("adminRankingSubmit").textContent = "Agregar al ranking";
  document.getElementById("adminRankingCancel").hidden = true;
}

function editAdminRanking(player) {
  const entry = adminRanking.find(item => item.player === player);
  const form = document.getElementById("adminRankingForm");
  if (!entry || !form) return;
  form.elements.namedItem("mode").value = "edit";
  form.elements.namedItem("player").value = entry.player;
  form.elements.namedItem("player").readOnly = true;
  form.elements.namedItem("points").value = entry.points;
  document.getElementById("adminRankingSubmit").textContent = "Actualizar puntos";
  document.getElementById("adminRankingCancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveAdminRanking(event) {
  event.preventDefault();
  const form = event.target;
  const mode = form.elements.namedItem("mode").value;
  const payload = {
    player: form.elements.namedItem("player").value.trim(),
    points: Number(form.elements.namedItem("points").value)
  };
  try {
    if (mode === "edit") {
      await api("/api/admin/ranking2026", { method: "PUT", body: JSON.stringify(payload) });
      showToast("Puntos actualizados.");
    } else {
      await api("/api/admin/ranking2026", { method: "POST", body: JSON.stringify(payload) });
      showToast("Jugador agregado al ranking.");
    }
    resetAdminRankingForm();
    await renderAdminRanking();
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  }
}

async function deleteAdminRanking(player) {
  if (!window.confirm(`¿Eliminar a ${player} del ranking 2026?`)) return;
  try {
    await api(`/api/admin/ranking2026?player=${encodeURIComponent(player)}`, { method: "DELETE" });
    await renderAdminRanking();
    showToast("Jugador eliminado del ranking.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
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
        role: form.elements.namedItem("role").value
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

async function loadRanking2026() {
  const container = document.getElementById("ranking2026List");
  if (!container) return;
  try {
    const ranking = await api("/api/ranking2026");
    if (!ranking.length) {
      container.innerHTML = '<p class="muted">El ranking 2026 se publicará pronto.</p>';
      return;
    }
    container.innerHTML = `<div class="ranking2026-grid">${ranking.map(entry => {
      const badge = entry.pos === 1 ? "gold" : entry.pos === 2 ? "silver" : entry.pos === 3 ? "bronze" : "blue";
      return `<div class="ranking2026-row">
        <span class="r26-pos"><b class="r26-badge ${badge}">${entry.pos}</b></span>
        <span class="r26-player">${escapeHtml(entry.player)}</span>
        <span class="r26-points">${entry.points}</span>
      </div>`;
    }).join("")}</div>`;
  } catch (error) {
    container.innerHTML = `<p class="muted">No se pudo cargar el ranking 2026: ${escapeHtml(error.message)}</p>`;
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

async function withdrawTournament() {
  if (!window.confirm("¿Retirarte de este torneo? Podrás volver a inscribirte mientras las inscripciones estén abiertas.")) return;
  try {
    const data = await api("/api/tournament", { method: "DELETE" });
    showToast(data.message || "Te retiraste del torneo.");
    await loadTournaments();
  } catch (error) {
    showToast(error.message);
  }
}

// ========================================
// TORNEOS - MODERNIZACIÓN COMPLETA
// ========================================

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
  html += '<button type="button" data-module-btn="ranking" onclick="setAdminModule(\'ranking\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21h18M7 17V9M12 17V5M17 17v-6"/></svg>Ranking 2026</button>';
  html += '<button type="button" data-module-btn="settings" onclick="setAdminModule(\'settings\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>Ajustes</button>';
  html += '</nav>';

  // Sección de torneos
  html += '<section class="admin-section admin-module" data-module="tournaments" hidden>';
  html += '<div class="admin-section-head">';
  html += '<div>';
  html += '<h3>Torneos y campeonatos</h3>';
  html += '<p class="admin-section-help">Crea torneos, inscribe jugadores, genera cuadros eliminatorios con BYEs o grupos Round Robin, programa partidos y visualiza el Main Draw.</p>';
  html += '</div>';
  html += '<button class="btn btn-primary" type="button" onclick="openTournamentWizard()">Crear torneo</button>';
  html += '</div>';
  html += '<div class="admin-tournament-grid">';
  if (allTournaments.length === 0) {
    html += '<div class="admin-empty-state" style="grid-column:1/-1; text-align:center; padding:40px;"><b>Aún no hay torneos</b><p style="color:rgba(31,41,55,.6); margin-top:8px;">Pulsa "Crear torneo" para publicar el primer campeonato.</p></div>';
  } else {
    allTournaments.forEach(function(tournament) {
      var entrants = tournament.entries || [];
      var matches = tournament.matches || [];
      var completed = matches.filter(function(m) { return m.status === "completed"; }).length;
      var pct = matches.length ? Math.round((completed / matches.length) * 100) : 0;
      var statusLabel = {
        registration: "Inscripciones abiertas",
        scheduled: "Programado",
        in_progress: "En curso",
        completed: "Finalizado",
        cancelled: "Cancelado"
      }[tournament.status] || "Estado";
      var tid = escapeHtml(tournament.id);
      html += '<article class="card admin-tournament-card public">';
      html += '<div class="admin-record-head">';
      html += '<div>';
      html += '<span class="tag ' + (tournament.status === "registration" ? "tag-blue" : tournament.status === "completed" ? "tag-green" : "tag-red") + '">' + escapeHtml(statusLabel) + '</span>';
      html += '<h4>' + escapeHtml(tournament.title || tournament.month) + '</h4>';
      html += '</div>';
      html += '<div class="admin-form-actions">';
      html += '<button class="btn btn-sm btn-dark" onclick="openTournamentManage(\'' + tid + '\')">Gestionar</button>';
      html += '<button class="btn btn-sm btn-danger" onclick="deleteTournament(\'' + tid + '\')">Eliminar</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="tournament-meta">';
      html += '<div><b>' + escapeHtml(tournament.month) + '</b> · ' + escapeHtml(tournament.formatType === "league" ? "Liga · todos contra todos" : "Eliminación directa") + '</div>';
      html += '<div>' + escapeHtml(CATEGORY_LABELS[tournament.category || "singles"] || "Singles");
      if (tournament.gender && tournament.gender !== "mixto") {
        html += ' · ' + escapeHtml(GENDER_LABELS[tournament.gender] || tournament.gender);
      }
      html += '</div>';
      html += '<div>' + escapeHtml(tournament.venue || "Sede por definir") + '</div>';
      html += '<div><b>' + entrants.length + '</b> inscritos';
      if (tournament.maxParticipants) { html += ' / ' + tournament.maxParticipants; }
      if (tournament.levels && tournament.levels.length) { html += ' · Niveles ' + escapeHtml(tournament.levels.join(", ")); }
      html += '</div>';
      html += '</div>';
      html += '<div class="tournament-progress">';
      html += '<div class="tournament-progress-track"><div class="tournament-progress-bar" style="width:' + pct + '%"></div></div>';
      html += '<span class="tournament-progress-label">' + completed + ' / ' + matches.length + ' partidos finalizados</span>';
      html += '</div>';
      html += '<div class="admin-form-actions full">';
      if (entrants.length < (tournament.maxParticipants || 999) && tournament.status === "registration") {
        html += '<button class="btn btn-sm btn-secondary" onclick="openTournamentManage(\'' + tid + '\')">Ver inscritos</button>';
      }
      if (matches.length) {
        html += '<button class="btn btn-sm btn-dark" onclick="openDrawModal(\'' + tid + '\')">Ver Main Draw</button>';
      }
      html += '</div>';
      html += '</article>';
    });
  }
  html += '</div>';
  html += '</section>';

  // Otras secciones (simplificadas)
  html += '<section class="admin-section admin-module" data-module="results" hidden><h3>Resultados de partidos</h3><p class="muted">Gestiona los resultados reportados.</p><div class="grid grid-2 admin-records">' + (pendingResults.length ? pendingResults.map(function(r) {
    return '<article class="card admin-record"><span class="tag ' + (r.status === "disputed" ? "tag-red" : "") + '">' + (r.status === "disputed" ? "En disputa" : "Pendiente") + '</span><h4>' + escapeHtml(r.winnerName) + ' vs ' + escapeHtml(r.loserName) + '</h4><p class="muted">' + escapeHtml(r.score) + '</p><div class="admin-form-actions"><button class="btn btn-primary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'confirm\')">Confirmar</button><button class="btn btn-secondary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'reject\')">Rechazar</button></div></article>';
  }).join("") : '<p class="muted">No hay resultados pendientes.</p>') + '</div></section>';

  html += '<section class="admin-section admin-module" data-module="players" hidden><h3>Jugadores de la liga</h3><p class="muted">Administra perfiles de jugador.</p></section>';
  html += '<section class="admin-section admin-module" data-module="products" hidden><h3>Tienda y membresías</h3><p class="muted">Gestiona productos de la tienda.</p></section>';
  html += '<section class="admin-section admin-module" data-module="challenges" hidden><h3>Desafíos publicados</h3><p class="muted">Gestiona desafíos.</p></section>';
  html += '<section class="admin-section admin-module" data-module="users" hidden><h3>Cuentas registradas</h3><p class="muted">Gestiona cuentas de usuario.</p></section>';
  html += '<section class="admin-section admin-module" data-module="ranking" hidden><h3>Ranking 2026</h3><p class="muted">Controla el ranking de temporada.</p></section>';
  html += '<section class="admin-section admin-module" data-module="settings" hidden><h3>Ajustes del sitio</h3><p class="muted">Configura el sitio.</p></section>';

  html += '</div>';
  html += '</div>';

  content.innerHTML = html;

  document.getElementById("adminTournamentForm")?.addEventListener("submit", saveTournament);
  document.getElementById("adminUserCreateForm")?.addEventListener("submit", createAdminUser);
  document.getElementById("adminUserSearch")?.addEventListener("input", filterAdminUsers);
  document.getElementById("adminUserRoleFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminUserPhoneFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminProductForm").addEventListener("submit", saveProduct);
  document.getElementById("adminUserForm")?.addEventListener("submit", saveAdminUser);
  document.getElementById("adminPlayerForm").addEventListener("submit", saveAdminPlayer);
  document.getElementById("adminResultForm").addEventListener("submit", saveAdminResult);
  document.getElementById("adminSettingsForm").addEventListener("submit", saveAdminSettings);
  document.getElementById("adminRankingForm").addEventListener("submit", saveAdminRanking);
  resetAdminUserForm();
  resetTournamentForm();
  resetProductForm();
  fillAdminSettingsForm();
  renderAdminRanking();
  setAdminModule(currentAdminModule);
  if (document.getElementById("adminModal")) openModal("adminModal");
}

function renderModernBracket(matches, formatType = "knockout", entries = []) {
  if (!matches || !matches.length) {
    return entries.length >= 2 ? '<p class="muted draw-pending">El cuadro se escribirá cuando se programen los partidos.</p>' : "";
  }
  if (formatType === "league") {
    return renderTournamentMatches(matches, entries, "league");
  }
  const rounds = [];
  matches.forEach(match => {
    const round = match.round || "Ronda";
    let bucket = rounds.find(item => item.name === round);
    if (!bucket) { bucket = { name: round, matches: [] }; rounds.push(bucket); }
    bucket.matches.push(match);
  });
  const entryById = new Map(entries.map(entry => [entry.playerId, entry]));
  const slotHtml = (playerId, winner) => {
    const entry = entryById.get(playerId);
    const name = entry?.name || (playerId ? `Jugador ${String(playerId).slice(-4)}` : "Por definir");
    const level = entry?.level || "";
    return `<div class="mb-slot${winner ? " is-winner" : ""}${!playerId ? " is-placeholder" : ""}">
      ${level ? `<span class="mb-level">${escapeHtml(level)}</span>` : ""}
      <span class="mb-name">${escapeHtml(name)}</span>
    </div>`;
  };
  return `<div class="modern-bracket-wrap"><div class="modern-bracket">${rounds.map((round, ri) => `
    <div class="mb-round">
      <h4>${escapeHtml(round.name)}</h4>
      <div class="mb-round-body">${round.matches.map(match => {
        const winnerA = match.status === "completed" && match.winnerId && match.winnerId === match.playerAId;
        const winnerB = match.status === "completed" && match.winnerId && match.winnerId === match.playerBId;
        const score = match.score || "";
        return `<div class="mb-match${match.status === "completed" ? " is-completed" : ""}${match.status === "cancelled" ? " is-cancelled" : ""}">
          ${slotHtml(match.playerAId, winnerA)}
          ${slotHtml(match.playerBId, winnerB)}
          <div class="mb-meta">${score ? `<b>${escapeHtml(score)}</b>` : `<span>${escapeHtml(match.date || (match.status === "cancelled" ? "Cancelado" : "Por jugar"))}</span>`}</div>
        </div>`;
      }).join("")}</div>
    </div>`).join("")}</div></div>`;
}

function renderMatchesListHtml(matches) {
  if (!matches || !matches.length) return '<p class="muted">Aún no hay partidos programados.</p>';
  return `<div class="manage-match-list">${matches.map(match => `<div class="admin-match-row">
    <div class="match-header">
      <span class="match-round">${escapeHtml(match.round)}</span>
      <span class="match-status ${match.status}">${match.status === "completed" ? "Finalizado" : match.status === "cancelled" ? "Cancelado" : "Programado"}</span>
    </div>
    <div class="match-teams">
      <span class="match-team${match.status === "completed" && match.winnerId === match.playerAId ? " is-winner" : ""}">${escapeHtml(match.playerAName || match.playerAId || "Por definir")}</span>
      <span class="match-vs">vs</span>
      <span class="match-team${match.status === "completed" && match.winnerId === match.playerBId ? " is-winner" : ""}">${escapeHtml(match.playerBName || match.playerBId || "Por definir")}</span>
    </div>
    <div class="match-score">${match.score ? escapeHtml(match.score) : ""}<span class="match-meta">${match.date ? escapeHtml(match.date) : ""}${match.court ? ` · ${escapeHtml(match.court)}` : ""}</span></div>
    <div class="match-actions">
      <button class="btn btn-sm btn-dark" onclick="editTournamentMatch('${escapeHtml(match.tournamentId || "")}','${escapeHtml(match.id)}')">Editar</button>
      ${match.status !== "completed" ? `<button class="btn btn-sm btn-primary" onclick="quickScoreMatch('${escapeHtml(match.tournamentId || "")}','${escapeHtml(match.id)}')">Marcar resultado</button>` : ""}
      <button class="btn btn-sm btn-danger" onclick="deleteTournamentMatch('${escapeHtml(match.tournamentId || "")}','${escapeHtml(match.id)}')">Eliminar</button>
    </div>
  </div>`).join("")}</div>`;
}

function openDrawModal(tournamentId) {
  const tournament = tournaments.find(item => item.id === tournamentId);
  if (!tournament) return;
  const title = document.getElementById("drawModalTitle");
  const container = document.getElementById("drawModalContainer");
  if (title) title.textContent = tournament.title || `Campeonato · ${tournament.month}`;
  if (container) {
    const formatType = tournament.formatType || "knockout";
    container.innerHTML = `
      <div class="draw-tabs" role="tablist">
        <button type="button" class="is-active" data-draw-tab="bracket">Main Draw</button>
        <button type="button" data-draw-tab="matches">Partidos</button>
      </div>
      <div class="draw-panel" data-draw-panel="bracket">${(formatType === "knockout") ? '<canvas id="publicDrawCanvas" class="draw-canvas"></canvas>' : renderModernBracket(tournament.matches, formatType, tournament.entries || [])}</div>
      <div class="draw-panel" data-draw-panel="matches" hidden>${renderMatchesListHtml(tournament.matches)}</div>
    `;
    container.querySelectorAll("[data-draw-tab]").forEach(button => {
      button.addEventListener("click", () => {
        const tab = button.dataset.drawTab;
        container.querySelectorAll("[data-draw-tab]").forEach(b => b.classList.toggle("is-active", b === button));
        container.querySelectorAll("[data-draw-panel]").forEach(panel => { panel.hidden = panel.dataset.drawPanel !== tab; });
        if (tab === "bracket" && formatType === "knockout") {
          const canvas = document.getElementById("publicDrawCanvas");
          if (canvas) drawUsOpenBracket(canvas, tournament, false);
        }
      });
    });
    if (formatType === "knockout") {
      const canvas = document.getElementById("publicDrawCanvas");
      if (canvas) drawUsOpenBracket(canvas, tournament, false);
    }
  }
  openModal("drawModal");
}

function drawUsOpenBracket(canvas, tournament, interactive = false) {
  if (!canvas) return;
  const matches = tournament.matches || [];
  const rounds = [];
  matches.forEach(match => {
    const round = match.round || "Ronda";
    let bucket = rounds.find(item => item.name === round);
    if (!bucket) { bucket = { name: round, matches: [] }; rounds.push(bucket); }
    bucket.matches.push(match);
  });
  if (!rounds.length) {
    canvas.height = 140;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, Math.max(480, canvas.width), canvas.height);
    ctx.fillStyle = "#4b5563";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Aún no hay partidos en el cuadro.", 20, 70);
    return;
  }

  const ctx = canvas.getContext("2d");
  const rowH = 24;
  const matchGap = 10;
  const roundGap = 86;
  const colWidth = 250;
  const marginTop = 58;
  const marginLeft = 24;

  const roundMatchCounts = rounds.map(round => round.matches.length);
  const maxMatches = Math.max(...roundMatchCounts);
  const totalHeight = marginTop + maxMatches * (rowH * 2 + matchGap) + 30;
  const totalWidth = marginLeft * 2 + rounds.length * (colWidth + roundGap) - roundGap;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(480, totalWidth) * dpr;
  canvas.height = Math.max(260, totalHeight) * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${Math.max(260, totalHeight)}px`;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, Math.max(480, totalWidth), Math.max(260, totalHeight));

  ctx.fillStyle = "#101d2d";
  ctx.font = "800 15px system-ui, sans-serif";
  ctx.fillText("MAIN DRAW", marginLeft, 20);
  ctx.fillStyle = "rgba(16,29,45,.55)";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(tournament.title || "", marginLeft, 36);

  rounds.forEach((round, ri) => {
    const x = marginLeft + ri * (colWidth + roundGap);
    ctx.fillStyle = "#101d2d";
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillText(round.name.toUpperCase(), x, 56);
  });

  const positions = new Map();
  let prevY = [];
  rounds.forEach((round, ri) => {
    const x = marginLeft + ri * (colWidth + roundGap);
    const ys = [];
    round.matches.forEach((match, mi) => {
      let y;
      if (ri === 0) {
        y = marginTop + mi * (rowH * 2 + matchGap);
      } else {
        const a = prevY[mi * 2];
        const b = prevY[mi * 2 + 1];
        y = (a !== undefined && b !== undefined) ? (a + b) / 2 : (prevY[mi] || marginTop);
      }
      positions.set(match.id, { x, y, match });
      ys.push(y);
    });
    prevY = ys;
  });

  const slotLine = (x, y, w) => {
    ctx.strokeStyle = "rgba(15,30,46,.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + rowH);
    ctx.lineTo(x + w, y + rowH);
    ctx.stroke();
  };

  ctx.strokeStyle = "#0f1e2e";
  ctx.lineWidth = 1.4;
  matches.forEach(match => {
    if (!match.nextMatchId) return;
    const from = positions.get(match.id);
    const to = positions.get(match.nextMatchId);
    if (!from || !to) return;
    const startX = from.x + colWidth;
    const fromCenterY = from.y + rowH;
    const endX = to.x;
    const endCenterY = to.y + rowH;
    const midX = startX + (endX - startX) / 2;
    ctx.beginPath();
    ctx.moveTo(startX, fromCenterY);
    ctx.lineTo(midX, fromCenterY);
    ctx.lineTo(midX, endCenterY);
    ctx.lineTo(endX, endCenterY);
    ctx.stroke();
  });

  positions.forEach(({ x, y, match }) => {
    const winnerA = match.status === "completed" && match.winnerId && match.winnerId === match.playerAId;
    const winnerB = match.status === "completed" && match.winnerId && match.winnerId === match.playerBId;
    const drawSlot = (playerId, winner, slotY) => {
      const name = playerId ? playerName(playerId, tournament) : "Por definir";
      const level = playerLevel(playerId, tournament);
      ctx.fillStyle = winner ? "#0e6b3d" : "#101d2d";
      ctx.font = winner ? "700 12px system-ui, sans-serif" : "500 12px system-ui, sans-serif";
      ctx.fillText(`${level ? level + "  " : ""}${truncate(name, 24)}${winner ? "  ✓" : ""}`, x, slotY + 16);
      slotLine(x, slotY, colWidth - 14);
    };
    drawSlot(match.playerAId, winnerA, y);
    drawSlot(match.playerBId, winnerB, y + rowH);
    ctx.fillStyle = "rgba(16,29,45,.55)";
    ctx.font = "500 10px system-ui, sans-serif";
    const note = match.score ? `Resultado: ${match.score}` : (match.date ? `Fecha: ${match.date}` : "");
    if (note) ctx.fillText(truncate(note, 30), x, y + rowH * 2 + 12);
  });

  if (interactive) {
    canvas.style.cursor = "pointer";
    canvas._hitAreas = [...positions.values()].map(({ x, y, match }) => ({ x, y, w: colWidth, h: rowH * 2, id: match.id }));
    canvas.onclick = null;
    canvas.addEventListener("click", event => {
      if (!canvas._hitAreas) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = canvas._hitAreas.find(area => x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h);
      if (hit) editTournamentMatch(tournament.id, hit.id);
    });
  }
}

function playerName(playerId, tournament) {
  const entry = (tournament.entries || []).find(e => e.playerId === playerId);
  return entry?.name || `Jugador ${String(playerId).slice(-4)}`;
}

function playerLevel(playerId, tournament) {
  const entry = (tournament.entries || []).find(e => e.playerId === playerId);
  return entry?.level ? String(entry.level) : "";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------- Modales de torneo ----------------

async function openTournamentFormModal(tournamentId) {
  resetTournamentForm();
  const modal = document.getElementById("tournamentFormModal");
  if (!modal) return;
  if (tournamentId) {
    const tournament = adminTournaments.find(item => item.id === tournamentId);
    if (tournament) editTournament(tournament);
  }
  openModal("tournamentFormModal");
}

async function openTournamentManage(tournamentId) {
  const content = document.getElementById("tournamentManageContent");
  const title = document.getElementById("tournamentManageTitle");
  if (title) title.textContent = "Cargando torneo...";
  if (!content) return;
  let tournament;
  try {
    const res = await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`);
    const data = await res.json();
    tournament = data.tournament;
  } catch (error) {
    content.innerHTML = `<div class="manage-summary"><p class="muted">No se pudo cargar el torneo: ${escapeHtml(error.message)}</p></div>`;
    openModal("tournamentManageModal");
    return;
  }
  if (!tournament) return;
  if (title) title.textContent = `Gestionar · ${tournament.title || tournament.month}`;
  const entrants = tournament.entries || [];
  const matches = tournament.matches || [];
  const standings = data.standings || null;
  const availablePlayers = players.filter(player =>
    !(tournament.entries || []).some(entry => entry.playerId === player.id) &&
    (tournament.levels || []).includes(player.level)
  );
  const completed = matches.filter(m => m.status === "completed").length;
  const total = matches.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  content.innerHTML = `
    <div class="manage-header">
      <div>
        <h2 class="manage-title">${escapeHtml(tournament.title || tournament.month)}</h2>
        <p class="manage-subtitle">${escapeHtml(tournament.month)} · ${escapeHtml(tournament.venue || "Sede por definir")} · ${escapeHtml(tournament.formatType === "league" ? "Liga · todos contra todos" : "Eliminación directa")}</p>
      </div>
      <div class="admin-form-actions">
        ${tournament.status === "registration" && entrants.length < (tournament.maxParticipants || 999) ? `<button class="btn btn-dark btn-sm" onclick="openTournamentFormModal('${escapeHtml(tournament.id)}')">Editar torneo</button>` : ""}
        <button class="btn btn-secondary btn-sm" onclick="closeModal('tournamentManageModal')">Cerrar</button>
      </div>
    </div>
    <div class="manage-summary">
      <span class="tag ${tournament.status === "registration" ? "tag-blue" : tournament.status === "completed" ? "tag-green" : "tag-red"}">${escapeHtml(tournamentStatusLabel(tournament.status))}</span>
      <p class="muted">${escapeHtml(tournament.month)} · ${escapeHtml(tournament.venue || "Sede por definir")} · ${escapeHtml(tournament.formatType === "league" ? "Liga · todos contra todos" : "Eliminación directa")} · ${entrants.length}/${tournament.maxParticipants || "∞"} inscritos</p>
      <div class="stats">
        <div class="manage-stat"><b>${entrants.length}</b><span>Inscritos</span></div>
        <div class="manage-stat"><b>${total}</b><span>Partidos</span></div>
        <div class="manage-stat"><b>${completed}</b><span>Finalizados</span></div>
      </div>
      <div class="manage-progress">
        <div class="manage-progress-track"><div class="manage-progress-bar" style="width:${pct}%"></div></div>
        <span class="manage-progress-text">${completed} / ${total} partidos finalizados</span>
      </div>
    </div>
    <div class="manage-tabs" role="tablist">
      <button type="button" class="is-active" data-manage-tab="participants">Participantes (${entrants.length})</button>
      <button type="button" data-manage-tab="matches">Partidos (${total})</button>
      ${standings ? `<button type="button" data-manage-tab="standings">Clasificación (${standings.length})</button>` : ""}
      <button type="button" data-manage-tab="draw">Main Draw</button>
    </div>

    <div class="manage-panel" data-manage-panel="participants">
      <div class="manage-toolbar">
        ${entrants.length >= 2 ? `<button class="btn btn-primary btn-sm" onclick="generateTournamentDraw('${escapeHtml(tournament.id)}')">${matches.some(match => match.auto) ? "Regenerar cuadro" : "Generar cuadro"}</button>` : ""}
        ${entrants.length >= 4 ? `<button class="btn btn-secondary btn-sm" onclick="createTournamentGroups('${escapeHtml(tournament.id)}')">Crear grupos</button>` : ""}
      </div>
      <ul class="admin-entrant-list manage-entrant-list">${entrants.map(entry => `<li>
        <span class="entrant-info">${escapeHtml(entry.name)} <small>${escapeHtml(entry.level || "")}</small></span>
        <button class="btn btn-sm btn-danger" onclick="removeTournamentEntry('${escapeHtml(tournament.id)}','${escapeHtml(entry.playerId)}')">Retirar</button>
      </li>`).join("") || '<li class="muted">Sin inscritos</li>'}</ul>
      ${tournament.status === "registration" && availablePlayers.length ? `<form class="admin-entry-form panel-form" onsubmit="addTournamentEntry(event,'${escapeHtml(tournament.id)}')">
        <label class="full">Agregar jugador
          <select name="playerId" required>${availablePlayers.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.level)}</option>`).join("")}</select>
        </label>
        <button class="btn btn-dark full" type="submit">Agregar participante</button>
      </form>` : ""}
    </div>

    <div class="manage-panel" data-manage-panel="matches" hidden>
      ${entrants.length >= 2 ? `<form id="admin-match-form-${escapeHtml(tournament.id)}" class="admin-match-form panel-form" onsubmit="saveTournamentMatch(event,'${escapeHtml(tournament.id)}')">
        <input type="hidden" name="matchId">
        <b class="full">Programar partido</b>
        <label>Jugador A<select name="playerAId" required>${entrants.map(entry => `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
        <label>Jugador B<select name="playerBId" required>${entrants.map(entry => `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
        <label>Ronda<input name="round" required placeholder="Final"></label>
        <label>Fecha<input name="date" type="date"></label>
        <label>Estado<select name="status"><option value="scheduled">Programado</option><option value="completed">Finalizado</option><option value="cancelled">Cancelado</option></select></label>
        <label>Ganador<select name="winnerId"><option value="">Elegir al cerrar</option>${entrants.map(entry => `<option value="${escapeHtml(entry.playerId)}">${escapeHtml(entry.name)}</option>`).join("")}</select></label>
        <label>Marcador (ej. 6-4, 4-6, 7-6*)<input name="score" placeholder="6-4, 4-6, 7-6*"></label>
        <label>Cancha<input name="court" maxlength="120"></label>
        <button class="btn btn-primary full" type="submit">Guardar partido</button>
      </form>` : '<p class="muted">Inscribe al menos 2 jugadores para programar partidos.</p>'}
      <div class="manage-match-list">${matches.map(match => {
        const isCompleted = match.status === "completed";
        const setsHtml = match.sets && match.sets.length ? `<div class="match-sets">${match.sets.map((s, i) => `<span class="match-set${isCompleted && match.winnerId === match.playerAId && i === match.sets.length - 1 ? " is-winner-set" : ""}${isCompleted && match.winnerId === match.playerBId && i === match.sets.length - 1 ? " is-loser-set" : ""}">${s[0]}-${s[1]}${s[2] ? "*" : ""}</span>`).join("")}</div>` : "";
        return `<div class="admin-match-row">
          <div class="match-header">
            <span class="match-round">${escapeHtml(match.round)}</span>
            <span class="match-status ${match.status}">${match.status === "completed" ? "Finalizado" : match.status === "cancelled" ? "Cancelado" : "Programado"}</span>
          </div>
          <div class="match-teams">
            <span class="match-team${isCompleted && match.winnerId === match.playerAId ? " is-winner" : ""}">${escapeHtml(match.playerAName || match.playerAId || "Por definir")}</span>
            <span class="match-vs">vs</span>
            <span class="match-team${isCompleted && match.winnerId === match.playerBId ? " is-winner" : ""}">${escapeHtml(match.playerBName || match.playerBId || "Por definir")}</span>
          </div>
          <div class="match-score">${setsHtml || (match.score ? escapeHtml(match.score) : "")}<span class="match-meta">${match.date ? escapeHtml(match.date) : ""}${match.court ? ` · ${escapeHtml(match.court)}` : ""}</span></div>
          <div class="match-actions">
            <button class="btn btn-sm btn-dark" onclick="editTournamentMatch('${escapeHtml(tournament.id)}','${escapeHtml(match.id)}')">Editar</button>
            ${!isCompleted ? `<button class="btn btn-sm btn-primary" onclick="quickScoreMatch('${escapeHtml(tournament.id)}','${escapeHtml(match.id)}')">Marcar resultado</button>` : ""}
            <button class="btn btn-sm btn-danger" onclick="deleteTournamentMatch('${escapeHtml(tournament.id)}','${escapeHtml(match.id)}')">Eliminar</button>
          </div>
        </div>`;
      }).join("") || '<p class="muted">Aún no hay partidos programados.</p>'}</div>
    </div>

    ${standings ? `<div class="manage-panel" data-manage-panel="standings" hidden>
      <table class="standings-table"><thead><tr><th>Pos.</th><th>Jugador</th><th>PJ</th><th>G</th><th>P</th><th>Sets</th><th>Juegos</th><th>Pts</th></tr></thead><tbody>
        ${standings.map(s => `<tr class="pos-${s.position}">
          <td><b>${s.position}</b></td>
          <td>${escapeHtml(s.name)}<small>${s.level ? ` · ${escapeHtml(s.level)}` : ""}</small></td>
          <td>${s.played}</td><td>${s.won}</td><td>${s.lost}</td>
          <td>${s.setsWon}-${s.setsLost}</td>
          <td>${s.gamesWon}-${s.gamesLost}</td>
          <td><b>${s.points}</b></td>
        </tr>`).join("")}
      </tbody></table>
    </div>` : ""}

    <div class="manage-panel" data-manage-panel="draw" hidden>
      ${(tournament.formatType || "knockout") === "knockout"
        ? '<canvas id="manageDrawCanvas" class="draw-canvas"></canvas>'
        : renderModernBracket(matches, tournament.formatType || "league", entrants)}
      <details class="matching-details"><summary>Ver lista de partidos</summary>${renderMatchesListHtml(matches)}</details>
    </div>
  `;

  content.querySelectorAll("[data-manage-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.manageTab;
      content.querySelectorAll("[data-manage-tab]").forEach(b => b.classList.toggle("is-active", b === button));
      content.querySelectorAll("[data-manage-panel]").forEach(panel => { panel.hidden = panel.dataset.managePanel !== tab; });
      if (tab === "draw" && (tournament.formatType || "knockout") === "knockout") {
        const canvas = document.getElementById("manageDrawCanvas");
        if (canvas) {
          drawUsOpenBracket(canvas, tournament, true);
        }
      }
    });
  });
  bindManageForms(content, tournament);
  openModal("tournamentManageModal");
}

function bindManageForms(content, tournament) {
  const matchForm = content.querySelector('.admin-match-form');
  if (matchForm) matchForm.addEventListener("submit", event => saveTournamentMatch(event, tournament.id));
}

function editTournament(tournamentId) {
  const tournament = adminTournaments.find(item => item.id === tournamentId);
  if (!tournament) return;
  const form = document.getElementById("adminTournamentForm");
  if (!form) return;
  form.elements.namedItem("id").value = tournament.id;
  form.elements.namedItem("title").value = tournament.title || "";
  form.elements.namedItem("month").value = tournament.month || "";
  form.elements.namedItem("status").value = tournament.status || "registration";
  form.elements.namedItem("formatType").value = tournament.formatType || "knockout";
  form.elements.namedItem("category").value = tournament.category || "singles";
  form.elements.namedItem("gender").value = tournament.gender || "mixto";
  form.elements.namedItem("startDate").value = tournament.startDate || "";
  form.elements.namedItem("endDate").value = tournament.endDate || "";
  form.elements.namedItem("maxParticipants").value = tournament.maxParticipants || "";
  form.elements.namedItem("venue").value = tournament.venue || "";
  form.elements.namedItem("description").value = tournament.description || "";
  form.querySelectorAll('input[name="levels"]').forEach(input => {
    input.checked = (tournament.levels || []).includes(input.value);
  });
}

function editTournamentMatch(tournamentId, matchId) {
  const tournament = adminTournaments.find(item => item.id === tournamentId);
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
  form.elements.namedItem("formatType").value = "knockout";
}

async function saveTournament(event) {
  event.preventDefault();
  const form = event.target;
  const formatType = form.elements.namedItem("formatType").value;
  const body = {
    title: form.elements.namedItem("title").value,
    month: form.elements.namedItem("month").value,
    levels: Array.from(form.querySelectorAll('input[name="levels"]:checked'), input => input.value),
    status: form.elements.namedItem("status").value,
    formatType,
    format: formatType === "league" ? "Liga · todos contra todos" : "Eliminación directa · Best of 3",
    category: form.elements.namedItem("category").value,
    gender: form.elements.namedItem("gender").value,
    startDate: form.elements.namedItem("startDate").value,
    endDate: form.elements.namedItem("endDate").value,
    maxParticipants: form.elements.namedItem("maxParticipants").value || null,
    venue: form.elements.namedItem("venue").value,
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
    closeModal("tournamentFormModal");
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

async function generateTournamentDraw(tournamentId) {
  if (!window.confirm("Se reemplazarán los partidos actuales por el cuadro generado con los inscritos. ¿Continuar?")) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ generateDraw: true })
    });
    await refreshTournamentManage(tournamentId);
    showToast("Cuadro generado. Al registrar resultados, los ganadores avanzan solos.");
  } catch (error) {
    showToast(`No se pudo generar el cuadro: ${error.message}`);
  }
}

async function createTournamentGroups(tournamentId) {
  const groupCount = Number(window.prompt("¿Cuántos grupos quieres crear?", "2") || "0");
  if (!Number.isInteger(groupCount) || groupCount < 2) {
    showToast("Indica un número de grupos válido (mínimo 2).");
    return;
  }
  if (!window.confirm(`Se crearán ${groupCount} grupos y se reemplazarán los partidos actuales. ¿Continuar?`)) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ generateGroups: true, groupCount })
    });
    await refreshTournamentManage(tournamentId);
    showToast("Grupos creados.");
  } catch (error) {
    showToast(`No se pudieron crear los grupos: ${error.message}`);
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
    await refreshTournamentManage(tournamentId);
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
    await refreshTournamentManage(tournamentId);
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
  const status = form.elements.namedItem("status").value;
  const scoreRaw = form.elements.namedItem("score").value.trim();
  let matchResult = null;
  if (status === "completed" && scoreRaw) {
    const sets = scoreRaw.split(",").map(s => {
      const t = s.trim().split("-");
      const tb = s.trim().includes("*");
      return [Number(t[0]), Number(t[1]), tb];
    }).filter(s => s.length === 2 && !isNaN(s[0]) && !isNaN(s[1]));
    if (sets.length < 1 || sets.length > 3) {
      showToast("Marcador inválido. Usa hasta 3 sets (ej. 6-4, 4-6, 7-6*).");
      return;
    }
    matchResult = { matchId: form.elements.namedItem("matchId").value || undefined, sets, superTiebreak: false, status: "completed" };
  }
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify(matchResult ? { matchResult } : {
        match: {
          ...(form.elements.namedItem("matchId").value ?
            { id: form.elements.namedItem("matchId").value } : {}),
          playerAId,
          playerBId,
          round: form.elements.namedItem("round").value,
          date: form.elements.namedItem("date").value,
          court: form.elements.namedItem("court").value,
          status,
          winnerId: form.elements.namedItem("winnerId").value,
          score: scoreRaw
        }
      })
    });
    await refreshTournamentManage(tournamentId);
    showToast(status === "completed" ? "Resultado registrado." : "Partido programado");
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  }
}

async function deleteTournamentMatch(tournamentId, matchId) {
  if (!window.confirm("¿Eliminar este partido del cuadro?")) return;
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ deleteMatchId: matchId })
    });
    await refreshTournamentManage(tournamentId);
    showToast("Partido eliminado del cuadro.");
  } catch (error) {
    showToast(`No se pudo eliminar el partido: ${error.message}`);
  }
}

async function refreshTournamentManage(tournamentId) {
  await loadTournaments();
  await showAdminPanel();
  const tournament = adminTournaments.find(item => item.id === tournamentId);
  if (tournament) openTournamentManage(tournamentId);
}

async function quickScoreMatch(tournamentId, matchId) {
  const tournament = adminTournaments.find(item => item.id === tournamentId);
  if (!tournament) return;
  const match = (tournament.matches || []).find(m => m.id === matchId);
  if (!match) return;
  const sets = prompt("Marcador (sets separados por coma, ej. 6-4, 4-6, 7-6*):", match.score || "");
  if (sets === null) return;
  const parsed = sets.split(",").map(s => {
    const t = s.trim().split("-");
    const tb = s.trim().includes("*");
    return [Number(t[0]), Number(t[1]), tb];
  }).filter(s => s.length === 2 && !isNaN(s[0]) && !isNaN(s[1]));
  if (parsed.length < 1 || parsed.length > 3) {
    showToast("Marcador inválido. Usa hasta 3 sets.");
    return;
  }
  const superTiebreak = confirm("¿Es super tie-break (10 puntos) en el tercer set?");
  try {
    await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: "PUT",
      body: JSON.stringify({ matchResult: { matchId, sets: parsed, superTiebreak, status: "completed" } })
    });
    showToast("Resultado registrado.");
    openTournamentManage(tournamentId);
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  }
}

// ========================================
// FIN TORNEOS
// ========================================

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
  document.getElementById("adminTournamentForm")?.addEventListener("submit", saveTournament);

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
  loadRanking2026();
  if (new URLSearchParams(window.location.search).get("admin") === "login") {
    openModal("loginModal");
  }
  } catch (error) {
    console.error("Error inicializando la aplicación:", error);
    showToast("Error al cargar la aplicación: " + error.message);
  }
});

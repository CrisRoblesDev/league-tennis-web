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

const COUNTRIES = [
  { name: "Argentina", flag: "🇦🇷" }, { name: "Bolivia", flag: "🇧🇴" }, { name: "Brasil", flag: "🇧🇷" },
  { name: "Canadá", flag: "🇨🇦" }, { name: "Chile", flag: "🇨🇱" }, { name: "Colombia", flag: "🇨🇴" },
  { name: "Costa Rica", flag: "🇨🇷" }, { name: "Cuba", flag: "🇨🇺" }, { name: "Ecuador", flag: "🇪🇨" },
  { name: "El Salvador", flag: "🇸🇻" }, { name: "España", flag: "🇪🇸" }, { name: "Estados Unidos", flag: "🇺🇸" },
  { name: "Guatemala", flag: "🇬🇹" }, { name: "Honduras", flag: "🇭🇳" }, { name: "México", flag: "🇲🇽" },
  { name: "Nicaragua", flag: "🇳🇮" }, { name: "Panamá", flag: "🇵🇦" }, { name: "Paraguay", flag: "🇵🇾" },
  { name: "Perú", flag: "🇵🇪" }, { name: "Puerto Rico", flag: "🇵🇷" }, { name: "República Dominicana", flag: "🇩🇴" },
  { name: "Uruguay", flag: "🇺🇾" }, { name: "Venezuela", flag: "🇻🇪" }, { name: "Alemania", flag: "🇩🇪" },
  { name: "Francia", flag: "🇫🇷" }, { name: "Italia", flag: "🇮🇹" }, { name: "Portugal", flag: "🇵🇹" },
  { name: "Reino Unido", flag: "🇬🇧" }, { name: "Otro", flag: "🏳️" }
];

let currentUser = null;
let pendingProfilePhotoFile = null;
let players = [];
let resultUsers = [];
let products = [];
let matchResults = [];
let leagueChallenges = [];
let tournaments = [];
let adminUsers = [];
let adminTournaments = [];
let adminOrdersChecked = false;
let adminOrders = [];
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
      <button class="btn btn-sm" onclick="openProfileEditModal()">Mi perfil</button>
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
  const membershipLink = membership ? (membership.link || membership.url) : "";
  if (membershipPlan) {
    const membershipImage = membership?.image
      ? `<div class="membership-image"><img src="${escapeHtml(membership.image)}" alt="${escapeHtml(membership.name)}" loading="lazy"></div>`
      : "";
    membershipPlan.innerHTML = membership ? `
      ${membershipImage}
      <h3>${escapeHtml(membership.name)}</h3>
      <div class="price-big">$${(membership.price / 100).toFixed(2)}<span class="price-period">/${membership.interval === "year" ? "año" : "mes"}</span></div>
      <p class="muted">${escapeHtml(membership.description || "Cancela cuando quieras.")}</p>
      ${membershipLink ? `<button class="btn btn-primary btn-full" onclick="window.open('${escapeHtml(membershipLink)}','_blank','noopener,noreferrer')">Suscribirse ahora</button>` : `<button class="btn btn-primary btn-full" onclick="checkout('${escapeHtml(membership.id)}')">Suscribirse ahora</button>`}
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
    const featuredLibros = libros.slice(0, 3);
    librosContainer.innerHTML = featuredLibros.map(renderProductCard).join("") ||
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
  const productLink = p.link || p.url;
  const buttonHtml = member && isBook
    ? (productLink
        ? `<button class="btn btn-primary" onclick="window.open('${escapeHtml(productLink)}','_blank','noopener,noreferrer')">Descargar</button>`
        : `<button class="btn btn-secondary" disabled>Incluido en tu membresia</button>`)
    : productLink
      ? `<button class="btn btn-dark" onclick="window.open('${escapeHtml(productLink)}','_blank','noopener,noreferrer')">Comprar</button>`
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
  if (!isAdminPage && whatsappGroupUrl && !document.querySelector(".whatsapp-fab")) {
    initWhatsAppPromos();
  }
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
  form.elements.namedItem("name").value = user.name;
  form.elements.namedItem("email").value = user.email || "";
  form.elements.namedItem("password").value = "";
  form.elements.namedItem("role").value = user.role || "user";
  form.elements.namedItem("level").value = user.level || "";
  form.elements.namedItem("zone").value = user.zone || "";
  form.elements.namedItem("phone").value = user.phone || "";
  if (form.elements.namedItem("nationality")) form.elements.namedItem("nationality").value = user.nationality || "";
  form.elements.namedItem("membershipActive").checked = user.membershipActive === true;
  openAdminDynamicEditModal("adminUserForm", "Editar usuario");
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
  closeAdminDynamicEditModal();
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

async function saveAdminUser(event) {
  event.preventDefault();
  const form = event.target;
  const userId = form.elements.namedItem("userId").value;
  const name = form.elements.namedItem("name").value.trim();
  const email = form.elements.namedItem("email").value.trim();
  const password = form.elements.namedItem("password").value;
  const role = form.elements.namedItem("role").value;
  const level = form.elements.namedItem("level").value;
  const zone = form.elements.namedItem("zone").value;
  const phone = form.elements.namedItem("phone").value.trim();
  const nationality = form.elements.namedItem("nationality").value.trim();
  const membershipActive = form.elements.namedItem("membershipActive").checked;

  if (!name || !email) {
    showToast("Nombre y email son requeridos.");
    return;
  }
  try {
    if (userId) {
      // Edit existing user
      const updates = { name, role, level, zone, phone: phone || null, nationality: nationality || null, membershipActive };
      if (email) updates.email = email;
      if (password) updates.password = password;
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ userId, updates })
      });
      showToast("Usuario actualizado.");
    } else {
      // Create new user
      if (!password) {
        showToast("La contraseña es requerida para crear un usuario.");
        return;
      }
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ action: "create", name, email, password, role, nationality })
      });
      showToast("Cuenta creada.");
    }
    closeAdminDynamicEditModal();
    await showAdminPanel();
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
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
  openAdminDynamicEditModal("adminPlayerForm", "Editar jugador");
}

function resetAdminPlayerForm() {
  const form = document.getElementById("adminPlayerForm");
  if (!form) return;
  form.reset();
  form.elements.namedItem("playerId").value = "";
  form.elements.namedItem("accountId").disabled = false;
  closeAdminDynamicEditModal();
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
    await loadTournaments();
    showToast(action === "confirm" ? "Resultado confirmado; se actualizó el ranking." : "Resultado marcado para revisión.");
  } catch (error) {
    showToast(error.message);
  }
}

// ============ RESULTADOS: flujo canónico (torneo → partido → marcador) ============
// Un solo flujo idéntico en página principal, main draw, admin y perfil, con el
// editor compartido window.TennisScore (score-editor.js). La cascada carga los
// torneos, al elegir uno despliega "Elige el partido" y el partido coloca solo
// sus 2 jugadores (read-only confirmados); el marcador se completa set por set
// con los juegos de ambos jugadores y el ganador se detecta por sets ganados.
let principalResultEditor = null;
let profileResultCascade = null;
let profileResultEditor = null;
let adminResultEditor = null;
let principalResultCascade = null;
let principalResultPlayers = null;
let profileResultPlayers = null;
let adminResultPlayers = null;
let adminResultCascade = null;

function resultPlayerMaps() {
  return {
    byId: new Map(players.map(p => [p.id, p])),
    byUserId: new Map(players.map(p => [p.userId, p]))
  };
}

function tournamentLabel(tournament) {
  return tournament.name || tournament.title || tournament.month || "Torneo";
}

// Deja lista una cascada torneo → partido → jugadores automáticos.
// config: { tournamentSelect, matchSelect, nameA, nameB, manualWrap, manualA, manualB,
//           hiddenWinner, hiddenLoser, onPlayers({playerAId, playerBId, playerAName, playerBName, match, tournament}) }
// Devuelve { setTournaments(list), applyMatch(matchId) }.
function setupResultCascade(config) {
  const tournamentSelect = config.tournamentSelect;
  const matchSelect = config.matchSelect;
  let tournamentsData = [];
  if (!tournamentSelect || !matchSelect) return { setTournaments() {}, applyMatch() {} };

  // Devuelve un nombre legible de etapa/ronda para un partido.
  // Prioridad: match.round (nombre real de ronda) → match.stage → match.etapa →
  // nombre de stage desde tournament.stages → etiquetas conocidas de stageId → "Partido".
  function stageLabel(match, tournament) {
    if (match.round && String(match.round).trim()) return String(match.round).trim();
    if (match.stage && String(match.stage).trim()) return String(match.stage).trim();
    if (match.etapa && String(match.etapa).trim()) return String(match.etapa).trim();
    if (match.stageId && tournament) {
      const stage = Array.isArray(tournament.stages) ? tournament.stages.find(s => s.id === match.stageId) : null;
      if (stage && stage.name) return stage.name;
      const known = { groups: "Fase de grupos", playoff: "Eliminatorias", knockout: "Cuadro", final: "Final" };
      if (known[match.stageId]) return known[match.stageId];
      return match.stageId;
    }
    return "Partido";
  }

  function normalizedMatches(tournament) {
    return (tournament.matches || []).map(match => {
      const resolved = window.TennisScore.resolvePlayers(match, resultPlayerMaps());
      // Resolver jugador A: players (perfil, tiene playerId y userId) o resultUsers (cuenta, tiene id y name).
      const playerA = players.find(p => p.id === match.playerAId || p.userId === match.a || p.userId === match.playerAId);
      const userA = resultUsers.find(u => u.id === match.a || u.id === match.playerAId);
      // Resolver jugador B.
      const playerB = players.find(p => p.id === match.playerBId || p.userId === match.b || p.userId === match.playerBId);
      const userB = resultUsers.find(u => u.id === match.b || u.id === match.playerBId);
      // Prioridad de nombres: admin API ya resueltos → players → resultUsers → resolvePlayers → fallback.
      const playerAName = match.playerAName || (playerA && playerA.name) || (userA && userA.name) || resolved.playerAName || "Jugador A";
      const playerBName = match.playerBName || (playerB && playerB.name) || (userB && userB.name) || resolved.playerBName || "Jugador B";
      // playerAId/playerBId: preferir playerId (perfil). Si no existe perfil para el
      // participante (torneos de referencia), usar el userId como identificador para
      // que el backend pueda auto-crear el perfil al guardar el resultado.
      const playerAId = (playerA && playerA.id) || resolved.playerAId || match.playerAId || match.a || null;
      const playerBId = (playerB && playerB.id) || resolved.playerBId || match.playerBId || match.b || null;
      return { match, resolved: { playerAId, playerBId, playerAName, playerBName, match, tournament } };
    });
  }

  function playerOptions() {
    return players.map(player => {
      const categoryLabel = CATEGORY_LABELS[player.category || "singles"] || "Singles";
      return `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.level)} · ${escapeHtml(categoryLabel)}</option>`;
    }).join("");
  }

  function applyPlayers(payload) {
    if (config.nameA) config.nameA.textContent = payload ? payload.playerAName : "—";
    if (config.nameB) config.nameB.textContent = payload ? payload.playerBName : "—";
    if (config.hiddenWinner) config.hiddenWinner.value = payload ? payload.playerAId : "";
    if (config.hiddenLoser) config.hiddenLoser.value = payload ? payload.playerBId : "";
    // Los jugadores se colocan automáticamente al elegir el partido.
    // No hay selección manual de Jugador A / Jugador B.
    if (config.manualWrap) config.manualWrap.style.display = "none";
    if (config.manualA) config.manualA.disabled = true;
    if (config.manualB) config.manualB.disabled = true;
    if (payload && config.onPlayers) config.onPlayers(payload);
  }

  function applyMatch(matchId, tournamentId) {
    if (!matchId) { applyPlayers(null); return; }
    const tournament = tournamentsData.find(item => item.id === (tournamentId || tournamentSelect.value));
    const item = tournament ? normalizedMatches(tournament).find(entry => String(entry.match.id) === String(matchId)) : null;
    if (!item) { applyPlayers(null); return; }
    const resolved = item.resolved;
    applyPlayers({ playerAId: resolved.playerAId, playerBId: resolved.playerBId, playerAName: resolved.playerAName, playerBName: resolved.playerBName, match: item.match, tournament });
  }

  function fillMatchSelect(tournamentId) {
    const tournament = tournamentsData.find(item => item.id === tournamentId);
    const list = tournament ? normalizedMatches(tournament) : [];
    matchSelect.innerHTML = '<option value="">Seleccionar partido (opcional)</option>' +
      list.map(({ match, resolved }) => {
        const etapa = stageLabel(match, tournament);
        const label = `${escapeHtml(etapa)} · ${escapeHtml(resolved.playerAName)} vs ${escapeHtml(resolved.playerBName)}`;
        return `<option value="${escapeHtml(match.id)}">${label}</option>`;
      }).join("");
    matchSelect.disabled = !tournamentId;
  }

  matchSelect.disabled = true;
  tournamentSelect.onchange = function() {
    fillMatchSelect(this.value);
    if (!this.value) applyPlayers(null);
  };
  matchSelect.onchange = function() { applyMatch(this.value); };
  // Estado inicial: sin torneo/partido → jugadores manuales visibles y cargados.
  applyPlayers(null);

  return {
    setTournaments(list) {
      tournamentsData = Array.isArray(list) ? list : [];
      tournamentSelect.innerHTML = '<option value="">Seleccionar torneo (opcional)</option>' +
        tournamentsData.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(tournamentLabel(t))}</option>`).join("");
    },
    getTournaments() { return tournamentsData; },
    applyMatch,
    selectTournament(tournamentId) {
      tournamentSelect.value = tournamentId || "";
      fillMatchSelect(tournamentSelect.value);
      if (!tournamentSelect.value) applyPlayers(null);
    }
  };
}

function mountResultEditor(form, editorHostId, initial) {
  const el = document.getElementById(editorHostId);
  if (!el || !window.TennisScore) return null;
  return window.TennisScore.createEditor(el, {
    playerAName: initial && initial.a ? initial.a : "Jugador A",
    playerBName: initial && initial.b ? initial.b : "Jugador B",
    initialSets: initial && initial.sets ? initial.sets : [],
    onChange(api) {
      const hidden = form && form.querySelector ? form.querySelector('input[name="score"]') : null;
      if (hidden) hidden.value = api.score();
    }
  });
}

function renderResultSetsGrid() {
  buildResultScoreString();
  if (principalResultEditor) {
    const host = document.getElementById("resultScoreEditor");
    if (host && !host.querySelector(".score-editor")) mountResultEditor(document.getElementById("resultForm"), "resultScoreEditor");
  }
}

// Compat: sincroniza el hidden principal cuando el editor cambia.
function buildResultScoreString() {
  const hidden = document.getElementById("resultScoreHidden");
  if (hidden && principalResultEditor) hidden.value = principalResultEditor.score();
}

async function loadResultTournaments() {
  // Fuente primaria: /api/tournaments (reference). Fallback: globales.
  try {
    const data = await api("/api/tournaments");
    const list = (data && data.tournaments) || [];
    // Guardar usuarios para resolver nombres reales (referencia usa a/b = userId).
    if (Array.isArray(data && data.users)) resultUsers = data.users;
    if (list.length) return list;
  } catch { /* fallback abajo */ }
  const fallback = (adminTournaments || []).filter(item => !isMonthlyTournament(item));
  if (fallback.length) return fallback;
  return (tournaments || []).filter(item => !isMonthlyTournament(item));
}

async function openResultModal(presetWinnerId, presetLoserId) {
  if (!currentUser) {
    openModal("loginModal");
    showToast("Inicia sesión para registrar un resultado.");
    return;
  }
  // Cargar jugadores primero para resolver perfil del usuario actual.
  try {
    if (!players || players.length === 0) {
      players = await api("/api/players");
    }
  } catch { /* no bloquear */ }
  const player = players.find(item => item.userId === currentUser.id);
  const isMember = currentUser.role === "member" || currentUser.membershipActive === true;
  if (!player && !isMember) {
    openPlayerModal();
    showToast("Crea tu perfil de jugador primero.");
    return;
  }
  const form = document.getElementById("resultForm");
  const tournamentSelect = document.getElementById("resultTournamentSelect");
  const matchSelect = document.getElementById("resultMatchSelect");
  if (!form || !tournamentSelect || !matchSelect) return;
  // (players ya cargados arriba)
  form.reset();
  form.date.value = new Date().toISOString().slice(0, 10);
  principalResultPlayers = null;

  const cascade = setupResultCascade({
    tournamentSelect,
    matchSelect,
    nameA: document.getElementById("resultPlayerAName"),
    nameB: document.getElementById("resultPlayerBName"),
    manualWrap: document.getElementById("resultManualPlayers"),
    manualA: form.elements.namedItem("winnerA"),
    manualB: form.elements.namedItem("loserB"),
    hiddenWinner: document.getElementById("resultWinnerHidden"),
    hiddenLoser: document.getElementById("resultLoserHidden"),
    onPlayers(payload) {
      principalResultPlayers = payload;
      if (principalResultEditor) principalResultEditor.setNames(payload.playerAName, payload.playerBName);
    }
  });
  principalResultCascade = cascade;
  principalResultEditor = mountResultEditor(form, "resultScoreEditor");
  // Manual fallback: si el usuario elige A/B sin partido, sincroniza hiddens.
  const manualA = form.elements.namedItem("winnerA");
  const manualB = form.elements.namedItem("loserB");
  const hiddenWinner = document.getElementById("resultWinnerHidden");
  const hiddenLoser = document.getElementById("resultLoserHidden");
  const syncManual = () => {
    principalResultPlayers = null;
    if (hiddenWinner) hiddenWinner.value = manualA ? manualA.value : "";
    if (hiddenLoser) hiddenLoser.value = manualB ? manualB.value : "";
    const nameAEl = document.getElementById("resultPlayerAName");
    const nameBEl = document.getElementById("resultPlayerBName");
    if (manualA && manualA.value && nameAEl) nameAEl.textContent = manualA.options[manualA.selectedIndex]?.textContent || "—";
    if (manualB && manualB.value && nameBEl) nameBEl.textContent = manualB.options[manualB.selectedIndex]?.textContent || "—";
    if (principalResultEditor && manualA && manualB && manualA.value && manualB.value) {
      principalResultEditor.setNames(nameAEl?.textContent || "Jugador A", nameBEl?.textContent || "Jugador B");
    }
  };
  if (manualA) manualA.onchange = syncManual;
  if (manualB) manualB.onchange = syncManual;

  const tournamentsData = await loadResultTournaments();
  cascade.setTournaments(tournamentsData);

  showNotice("resultNotice", "", false);

  // Preselección desde desafíos admin: jugadores ya elegidos.
  if (presetWinnerId || presetLoserId) {
    try {
      const playerA = players.find(item => item.id === presetWinnerId);
      const playerB = players.find(item => item.id === presetLoserId);
      if (manualA && manualB) {
        if (presetWinnerId) manualA.value = presetWinnerId;
        if (presetLoserId) manualB.value = presetLoserId;
        syncManual();
      }
      if (hiddenWinner && playerA) hiddenWinner.value = playerA.id;
      if (hiddenLoser && playerB) hiddenLoser.value = playerB.id;
      if (principalResultEditor && playerA && playerB) {
        principalResultPlayers = { playerAId: playerA.id, playerBId: playerB.id, playerAName: playerA.name, playerBName: playerB.name };
        principalResultEditor.setNames(playerA.name, playerB.name);
      }
    } catch { /* no bloquear */ }
  }

  openModal("resultModal");
}

async function submitResult(event) {
  event.preventDefault();
  const form = event.target;
  // Jugadores: del partido elegido (automáticos) o del fallback manual.
  // Re-sincronizar desde el partido seleccionado por si applyMatch no se disparó.
  const selectedMatchId = form.elements.namedItem("matchId")?.value;
  const selectedTournamentId = form.elements.namedItem("tournamentId")?.value;
  if (selectedMatchId && principalResultCascade) {
    try { principalResultCascade.applyMatch(selectedMatchId, selectedTournamentId || ""); } catch { /* ignore */ }
  }
  let playerAId = document.getElementById("resultWinnerHidden")?.value || "";
  let playerBId = document.getElementById("resultLoserHidden")?.value || "";
  if (!principalResultPlayers) {
    const manualA = form.elements.namedItem("winnerA");
    const manualB = form.elements.namedItem("loserB");
    if (manualA && manualB && manualA.value && manualB.value) { playerAId = manualA.value; playerBId = manualB.value; }
  }
  if (principalResultPlayers) { playerAId = principalResultPlayers.playerAId; playerBId = principalResultPlayers.playerBId; }
  if (!playerAId || !playerBId || playerAId === playerBId) {
    showNotice("resultNotice", "Elige el partido (sus 2 jugadores se colocan solos) o selecciona Jugador A y Jugador B.", true);
    return;
  }
  if (!principalResultEditor) {
    showNotice("resultNotice", "Ingresa el marcador completo (mínimo 2 sets).", true);
    return;
  }
  const check = principalResultEditor.validate();
  if (!check.ok) {
    showNotice("resultNotice", check.error, true);
    return;
  }
  // Orienta el marcador a la perspectiva del ganador (servidor: winnerIndex 0).
  const winnerId = check.winnerIndex === 0 ? playerAId : playerBId;
  const loserId = check.winnerIndex === 0 ? playerBId : playerAId;
  const score = principalResultEditor.score();
  try {
    await api("/api/results", {
      method: "POST",
      body: JSON.stringify({
        winnerId,
        loserId,
        category: form.elements.namedItem("category").value,
        tournamentId: form.elements.namedItem("tournamentId").value || null,
        matchId: form.elements.namedItem("matchId").value || null,
        score,
        playedAt: form.date.value
      })
    });
    closeModal("resultModal");
    form.reset();
    const ts = document.getElementById("resultTournamentSelect");
    const ms = document.getElementById("resultMatchSelect");
    if (ts) ts.value = "";
    if (ms) ms.innerHTML = '<option value="">Seleccionar partido (opcional)</option>';
    if (principalResultEditor) { principalResultEditor.setSets([]); principalResultEditor.setNames("Jugador A", "Jugador B"); }
    principalResultPlayers = null;
    const nameAEl = document.getElementById("resultPlayerAName");
    const nameBEl = document.getElementById("resultPlayerBName");
    if (nameAEl) nameAEl.textContent = "—";
    if (nameBEl) nameBEl.textContent = "—";
    const hw = document.getElementById("resultWinnerHidden");
    const hl = document.getElementById("resultLoserHidden");
    if (hw) hw.value = "";
    if (hl) hl.value = "";
    await loadResults();
    await loadTournaments();
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
    openPlayerModal();
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

// ============ CREATE / EDIT PLAYER PROFILE ============

function openPlayerModal(playerId = null) {
  const form = document.getElementById("playerForm");
  if (!form) return;
  form.reset();
  const preview = document.getElementById("playerPhotoPreview");
  if (preview) { preview.style.display = "none"; preview.src = ""; }
  const idInput = form.elements.namedItem("playerId");
  if (idInput) idInput.value = playerId || "";

  const title = document.getElementById("playerModalTitle") || document.querySelector("#createPlayerModal .modal-head h2");
  if (title) title.textContent = playerId ? "Editar tu perfil de jugador" : "Mi perfil de jugador";

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = playerId ? "Guardar cambios de perfil" : "Guardar perfil de jugador";

  const notice = document.getElementById("playerNotice");
  if (notice) {
    notice.textContent = playerId
      ? "Edita tus datos. Los cambios se guardan automáticamente. La foto solo se reemplaza si eliges una nueva."
      : "Completa tu perfil de jugador para participar en la liga.";
    notice.className = "notice-bar";
  }

  const applyPlayer = (player) => {
    if (!player) return;
    form.elements.namedItem("name").value = player.name || "";
    form.level.value = player.level || "";
    form.elements.namedItem("category").value = player.category || "singles";
    form.elements.namedItem("gender").value = player.gender || "hombres";
    form.zone.value = player.zone || "";
    form.elements.namedItem("country").value = player.country || "";
    form.elements.namedItem("bio").value = player.bio || "";
    const hiddenCountryInput = document.getElementById("playerCountryInput");
    if (hiddenCountryInput) hiddenCountryInput.value = player.country || "";
    if (title) title.textContent = "Editar tu perfil de jugador";
    if (submitBtn) submitBtn.textContent = "Guardar cambios de perfil";
    updateBioCharCount(form.elements.namedItem("bio"));
    if (player.photo && preview) {
      preview.src = player.photo;
      preview.style.display = "block";
    }
  };

  if (playerId) {
    const player = players.find(p => p.id === playerId);
    if (player) {
      applyPlayer(player);
    } else {
      showToast("No se encontró el perfil de jugador.");
      closeModal("createPlayerModal");
      return;
    }
  } else {
    const own = currentUser && players.find(p => p.userId === currentUser.id);
    if (own) applyPlayer(own);
  }

  openModal("createPlayerModal");

  // Init enhanced UI after modal is visible
  hasUnsavedChanges = false;
  setTimeout(() => {
    renderCountryFlagGrid();
    initPlayerAutoSave(form);
    initPlayerPhotoDropZone();
    updateBioCharCount(form.elements.namedItem("bio"));
    setSaveIndicator("saved");
  }, 50);
}

// ============ PLAYER PROFILE ENHANCEMENTS ============

// Render country flag selector grid
function renderCountryFlagGrid() {
  const container = document.getElementById("countryFlagSelector");
  const hiddenInput = document.getElementById("playerCountryInput");
  if (!container || !hiddenInput) return;

  container.innerHTML = COUNTRIES.map(c =>
    `<button type="button" role="option" aria-selected="false" tabindex="0"
      data-country="${escapeHtml(c.name)}"
      style="display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 12px; border:2px solid var(--line); border-radius:10px; background:#fff; cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s, transform 0.1s; min-width:70px;"
      onmouseover="this.style.borderColor='var(--accent)'"
      onmouseout="this.style.borderColor=this.dataset.selected==='true' ? 'var(--accent)' : 'var(--line)'"
      onclick="selectCountryFlag('${escapeHtml(c.name)}', this)">
      <span style="font-size:28px; line-height:1;">${c.flag}</span>
      <span style="font-size:11px; font-weight:600; text-align:center; color:var(--ink);">${escapeHtml(c.name)}</span>
    </button>`
  ).join("");

  // Restore selection if value already set
  const currentValue = hiddenInput.value;
  if (currentValue) {
    const btn = container.querySelector(`[data-country="${escapeHtml(currentValue)}"]`);
    if (btn) {
      btn.dataset.selected = "true";
      btn.setAttribute("aria-selected", "true");
      btn.style.borderColor = "var(--accent)";
      btn.style.boxShadow = "0 0 0 2px var(--accent-bg)";
    }
  }
}

// Select country flag
function selectCountryFlag(countryName, btn) {
  const container = document.getElementById("countryFlagSelector");
  const hiddenInput = document.getElementById("playerCountryInput");
  if (!container || !hiddenInput) return;

  container.querySelectorAll("button").forEach(b => {
    b.dataset.selected = "false";
    b.setAttribute("aria-selected", "false");
    b.style.borderColor = "var(--line)";
    b.style.boxShadow = "none";
  });

  btn.dataset.selected = "true";
  btn.setAttribute("aria-selected", "true");
  btn.style.borderColor = "var(--accent)";
  btn.style.boxShadow = "0 0 0 2px var(--accent-bg)";
  hiddenInput.value = countryName;

  // Trigger auto-save
  triggerAutoSave();
}

// Photo preview for player modal
function previewPlayerPhotoFile(input) {
  const preview = document.getElementById("playerPhotoPreview");
  const dropZone = document.getElementById("playerPhotoDropZone");
  if (!preview || !dropZone || !input.files || !input.files[0]) return;

  const file = input.files[0];
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    showToast("Formato no válido. Usa PNG, JPG o WebP.");
    input.value = "";
    return;
  }
  if (file.size > 400 * 1024) {
    showToast("El archivo supera 400 KB. Reduce el tamaño.");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    preview.src = e.target.result;
    preview.style.display = "block";
    dropZone.style.borderColor = "var(--accent)";
    dropZone.style.background = "var(--accent-bg)";
  };
  reader.readAsDataURL(file);

  // Trigger auto-save
  triggerAutoSave();
}

// Drag & drop photo upload for player modal
function initPlayerPhotoDropZone() {
  const zone = document.getElementById("playerPhotoDropZone");
  const input = document.getElementById("playerPhotoFileInput");
  if (!zone || !input || zone.dataset.dropInited) return;
  zone.dataset.dropInited = "1";

  zone.addEventListener("click", () => input.click());
  ["dragenter", "dragover"].forEach(evt => {
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.style.borderColor = "var(--accent)";
      zone.style.background = "var(--accent-bg, #e8f0fe)";
    }, false);
  });
  ["dragleave", "drop"].forEach(evt => {
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.style.borderColor = "var(--line)";
      zone.style.background = "#fafafa";
    }, false);
  });
  zone.addEventListener("drop", e => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      previewPlayerPhotoFile(input);
    }
  }, false);
}

// Foto de perfil: valida, previsualiza (tab Foto + encabezado) y deja el
// archivo pendiente de subir al guardar Datos personales.
function setProfileSavedIndicator(text, dirty) {
  const el = document.getElementById("profileSavedIndicator");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-dirty", Boolean(dirty));
}

function syncProfileHead() {
  if (!currentUser) return;
  const nameEl = document.getElementById("profileHeadName");
  const emailEl = document.getElementById("profileHeadEmail");
  const chipsEl = document.getElementById("profileHeadChips");
  const img = document.getElementById("profileAvatarImg");
  const initials = document.getElementById("profileHeadInitials");
  if (nameEl) nameEl.textContent = currentUser.name || "Mi cuenta";
  if (emailEl) emailEl.textContent = currentUser.email || "";
  if (chipsEl) {
    const roleLabel = currentUser.role === "admin" ? "Administrador" : (currentUser.role === "member" || currentUser.membershipActive ? "Miembro" : "Usuario");
    chipsEl.innerHTML = `<span class="tag">${escapeHtml(roleLabel)}</span>` +
      (currentUser.nationality ? `<span class="tag" style="background:#eef3f6;color:var(--navy);">${escapeHtml(currentUser.nationality)}</span>` : "");
  }
  if (img) {
    img.hidden = !currentUser.photo;
    if (currentUser.photo) img.src = currentUser.photo;
  }
  if (initials) {
    initials.hidden = Boolean(currentUser.photo);
    initials.textContent = (currentUser.name || "?").trim().charAt(0).toUpperCase();
  }
  const preview = document.getElementById("profilePhotoPreview");
  const empty = document.getElementById("profilePhotoEmpty");
  if (preview) preview.hidden = !currentUser.photo;
  if (empty) empty.hidden = Boolean(currentUser.photo);
}

function previewProfilePhotoFile(input) {
  const preview = document.getElementById("profilePhotoPreview");
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    showToast("Formato no válido. Usa PNG, JPG o WebP.");
    input.value = "";
    return;
  }
  if (file.size > 400 * 1024) {
    showToast("El archivo supera 400 KB. Reduce el tamaño.");
    input.value = "";
    return;
  }
  pendingProfilePhotoFile = file;
  setProfileSavedIndicator("Cambios sin guardar", true);
  const reader = new FileReader();
  reader.onload = function(e) {
    if (preview) preview.hidden = false;
    if (preview) preview.src = e.target.result;
    const headImg = document.getElementById("profileAvatarImg");
    const empty = document.getElementById("profilePhotoEmpty");
    const initials = document.getElementById("profileHeadInitials");
    if (headImg) { headImg.hidden = false; headImg.src = e.target.result; }
    if (empty) empty.hidden = true;
    if (initials) initials.hidden = true;
  };
  reader.readAsDataURL(file);
}

// Bio character counter
function updateBioCharCount(textarea) {
  const counter = document.getElementById("bioCharCount");
  if (!counter) return;
  const length = textarea.value.length;
  const max = 300;
  counter.textContent = `${length}/${max}`;
  counter.style.color = length > max * 0.9 ? "#c62828" : length > max * 0.7 ? "#f57c00" : "var(--muted)";
}

// Save indicator states
function setSaveIndicator(state) {
  const indicator = document.getElementById("playerSaveIndicator");
  if (!indicator) return;
  indicator.className = "save-indicator " + state;
  const states = {
    saved: { text: "✓ Guardado", bg: "#e9f3d8", color: "#3a5a1b" },
    saving: { text: "⟳ Guardando...", bg: "#fff3e0", color: "#e65100" },
    unsaved: { text: "● Cambios sin guardar", bg: "#fce4ec", color: "#c62828" },
    error: { text: "✕ Error al guardar", bg: "#f8e8e5", color: "#8e3028" }
  };
  const s = states[state] || states.saved;
  indicator.textContent = s.text;
  indicator.style.background = s.bg;
  indicator.style.color = s.color;
}

// Debounced auto-save
let autoSaveTimer = null;
let hasUnsavedChanges = false;

function initPlayerAutoSave(form) {
  if (!form || form.dataset.autosaveInited) return;
  form.dataset.autosaveInited = "1";
  const fields = ["name", "level", "category", "gender", "zone", "country", "bio"];
  fields.forEach(field => {
    const el = form.elements.namedItem(field);
    if (!el || el.dataset.autosave) return;
    el.dataset.autosave = "1";
    el.addEventListener("input", () => triggerAutoSave());
    el.addEventListener("change", () => triggerAutoSave());
  });
}

function triggerAutoSave() {
  hasUnsavedChanges = true;
  setSaveIndicator("unsaved");

  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    await performAutoSave();
  }, 1500); // 1.5s debounce
}

async function performAutoSave() {
  const form = document.getElementById("playerForm");
  if (!form) {
    hasUnsavedChanges = false;
    setSaveIndicator("saved");
    return;
  }

  const playerId = form.elements.namedItem("playerId")?.value;
  if (!playerId) {
    // New profile - don't auto-save until manually submitted
    hasUnsavedChanges = false;
    setSaveIndicator("saved");
    return;
  }

  setSaveIndicator("saving");

  try {
    let photoUrl = null;
    const fileInput = form.elements.namedItem("photoFile");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      photoUrl = await uploadPlayerPhotoFile(form);
    }

    const body = {
      name: form.elements.namedItem("name").value.trim(),
      level: form.level.value,
      zone: form.zone.value,
      category: form.elements.namedItem("category").value,
      gender: form.elements.namedItem("gender").value,
      country: form.elements.namedItem("country")?.value.trim() || "",
      bio: form.elements.namedItem("bio")?.value.trim() || ""
    };
    if (photoUrl) body.photoUrl = photoUrl;

    await api(`/api/players/${encodeURIComponent(playerId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });

    await loadPlayers();
    hasUnsavedChanges = false;
    setSaveIndicator("saved");
  } catch (error) {
    console.error("Auto-save failed:", error);
    hasUnsavedChanges = false;
    setSaveIndicator("error");
    // Revert to unsaved after 3s so user can retry
    setTimeout(() => {
      if (!hasUnsavedChanges) setSaveIndicator("unsaved");
    }, 3000);
  }
}

// Load countries for dropdown (used in profile edit modal)
async function loadCountries() {
  const select = document.getElementById("playerCountrySelect");
  if (!select) return;
  const options = COUNTRIES.map(function(c) {
    return '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.flag) + " " + escapeHtml(c.name) + "</option>";
  }).join("");
  select.innerHTML = '<option value="">Selecciona un país</option>' + options;
}

async function createPlayer(e) {
  e.preventDefault();
  if (!currentUser) { openModal("loginModal"); return; }
  const form = e.target;
  const playerId = form.elements.namedItem("playerId")?.value;
  if (playerId) return editPlayer(e);

  const name = form.elements.namedItem("name").value.trim();
  const level = form.level.value;
  const zone = form.zone.value;
  const category = form.elements.namedItem("category").value;
  const gender = form.elements.namedItem("gender").value;
  const country = form.elements.namedItem("country")?.value.trim() || "";
  const bio = form.elements.namedItem("bio")?.value.trim() || "";

  if (!name || !level || !zone || !category || !gender) {
    showToast("Completa todos los campos obligatorios.");
    return;
  }

  try {
    let photoUrl = null;
    const fileInput = form.elements.namedItem("photoFile");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      photoUrl = await uploadPlayerPhotoFile(form);
    }

    await api("/api/players", {
      method: "POST",
      body: JSON.stringify({ name, level, zone, category, gender, country, bio, photoUrl })
    });
    closeModal("createPlayerModal");
    await loadPlayers();
    showToast("Perfil de jugador guardado.");
    form.reset();
    const preview = document.getElementById("playerPhotoPreview");
    if (preview) { preview.style.display = "none"; preview.src = ""; }
  } catch (error) {
    showToast(error.message);
  }
}

async function editPlayer(e) {
  e.preventDefault();
  if (!currentUser) { openModal("loginModal"); return; }
  const form = e.target;
  const playerId = form.elements.namedItem("playerId").value;
  if (!playerId) return;

  try {
    let photoUrl = null;
    const fileInput = form.elements.namedItem("photoFile");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      photoUrl = await uploadPlayerPhotoFile(form);
    }

    const body = {
      name: form.elements.namedItem("name").value.trim(),
      level: form.level.value,
      zone: form.zone.value,
      category: form.elements.namedItem("category").value,
      gender: form.elements.namedItem("gender").value,
      country: form.elements.namedItem("country")?.value.trim() || "",
      bio: form.elements.namedItem("bio")?.value.trim() || ""
    };
    if (photoUrl) body.photoUrl = photoUrl;

    await api(`/api/players/${encodeURIComponent(playerId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    closeModal("createPlayerModal");
    await loadPlayers();
    showToast("Perfil de jugador actualizado.");
    form.reset();
    const preview = document.getElementById("playerPhotoPreview");
    if (preview) { preview.style.display = "none"; preview.src = ""; }
  } catch (error) {
    showToast(error.message);
  }
}

function isMonthlyTournament(item) {
  return Boolean(item && String(item.id || "").startsWith("monthly-"));
}

// ============ PUBLIC TOURNAMENTS ============
async function loadTournaments() {
  try {
    const data = await api("/api/tournament");
    tournaments = (data.tournaments || []).filter(item => !isMonthlyTournament(item));
    updateRankingScopeOptions();
    let featured = null;
    try {
      const publicData = await api("/api/tournaments");
      const publicTournaments = Array.isArray(publicData.tournaments) ? publicData.tournaments : [];
      featured = publicTournaments.find(item => item.status === "abierto" || item.status === "en proceso") || publicTournaments[0] || null;
    } catch (error) {
      featured = tournaments.find(item => ["registration", "scheduled", "in_progress"].includes(item.status)) || null;
    }
    if (featured) {
      const title = document.getElementById("heroTournamentTitle");
      const date = document.getElementById("heroTournamentDate");
      const summary = document.getElementById("heroTournamentSummary");
      if (title) title.textContent = featured.name || featured.title || "Campeonato";
      if (date) date.textContent = featured.date ? formatLocalDate(new Date(`${featured.date}T00:00:00`)) : (featured.month || "Próximamente");
      if (summary) summary.textContent = featured.description || `${(featured.participants || featured.entries || []).length} inscritos`;
    } else {
      const title = document.getElementById("heroTournamentTitle");
      const date = document.getElementById("heroTournamentDate");
      const summary = document.getElementById("heroTournamentSummary");
      if (title) title.textContent = "Sin campeonatos disponibles";
      if (date) date.textContent = "Próximamente";
      if (summary) summary.textContent = "Consulta los campeonatos disponibles en la liga.";
    }
  } catch (error) {
    showToast(`No se pudieron cargar los torneos: ${error.message}`);
  }
  // Refresh the tournament app if already mounted, otherwise mount it
  if (window.TournamentApp && window.TournamentApp.reloadPublic) {
    window.TournamentApp.reloadPublic();
  } else {
    mountPublicTournament();
  }
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

async function deleteAdminOrder(orderId) {
  const order = adminOrders.find(item => item.id === orderId);
  if (!order) return;
  if (!window.confirm(`¿Eliminar la compra "${escapeHtml(order.productName || "")}" de ${escapeHtml(order.userName || "")}? Esta acción no se puede deshacer.`)) return;
  try {
    await api("/api/admin/orders", {
      method: "DELETE",
      body: JSON.stringify({ orderId })
    });
    await showAdminPanel();
    showToast("Compra eliminada.");
  } catch (error) {
    showToast(`No se pudo eliminar: ${error.message}`);
  }
}

function editAdminOrder(orderId) {
  const order = adminOrders.find(item => item.id === orderId);
  if (!order) return;
  const form = document.getElementById("adminOrderForm");
  if (!form) return;
  form.elements.namedItem("orderId").value = order.id;
  form.elements.namedItem("status").value = order.status || "pending";
  form.elements.namedItem("productName").value = order.productName || "";
  form.elements.namedItem("amount").value = order.amount ? (order.amount / 100).toFixed(2) : "";
  openAdminDynamicEditModal("adminOrderForm", "Editar compra");
}

async function saveAdminOrder(event) {
  event.preventDefault();
  const form = event.target;
  try {
    await api("/api/admin/orders", {
      method: "PUT",
      body: JSON.stringify({
        orderId: form.elements.namedItem("orderId").value,
        status: form.elements.namedItem("status").value,
        productName: form.elements.namedItem("productName").value.trim(),
        amount: parseFloat(form.elements.namedItem("amount").value) || 0
      })
    });
    closeAdminDynamicEditModal();
    await showAdminPanel();
    showToast("Compra actualizada.");
  } catch (error) {
    showToast(`No se pudo actualizar: ${error.message}`);
  }
}

function resetAdminOrderForm() {
  const form = document.getElementById("adminOrderForm");
  if (!form) return;
  form.reset();
  closeAdminDynamicEditModal();
}

async function setUserMember(userId) {
  const user = adminUsers.find(item => item.id === userId);
  if (!user) return;
  if (!window.confirm("¿Cambiar a " + escapeHtml(user.name) + " a miembro?")) return;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ userId: userId, updates: { role: "member" } })
    });
    await showAdminPanel();
    showToast(escapeHtml(user.name) + " es ahora miembro.");
  } catch (error) {
    showToast(`No se pudo cambiar el rol: ${error.message}`);
  }
}

async function setUserNonMember(userId) {
  const user = adminUsers.find(item => item.id === userId);
  if (!user) return;
  if (!window.confirm("¿Quitar la membresía a " + escapeHtml(user.name) + "?")) return;
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ userId: userId, updates: { role: "user" } })
    });
    await showAdminPanel();
    showToast(escapeHtml(user.name) + " ya no es miembro.");
  } catch (error) {
    showToast(`No se pudo cambiar el rol: ${error.message}`);
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
  adminOrders = orders;
  const membersList = (users || []).filter(function(u) { return u.role === "member"; });
  const nonMembersList = (users || []).filter(function(u) { return u.role === "user"; });
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

  html += '<select class="admin-module-select" onchange="setAdminModule(this.value)" aria-label="Módulo de administración">';
  html += '<option value="tournaments">Torneos</option>';
  html += '<option value="players">Jugadores</option>';
  html += '<option value="results">Resultados</option>';
  html += '<option value="challenges">Desafíos</option>';
  html += '<option value="products">Tienda</option>';
  html += '<option value="orders">Compras</option>';
  html += '<option value="members">Miembros</option>';
  html += '<option value="users">Cuentas</option>';
  html += '<option value="ranking">Ranking</option>';
  html += '<option value="settings">Ajustes</option>';
  html += '</select>';
  html += '<div class="admin-layout">';
  html += '<nav class="admin-nav" aria-label="Módulos de administración">';
  html += '<button type="button" data-module-btn="tournaments" onclick="setAdminModule(\'tournaments\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/></svg>Torneos</button>';
  html += '<button type="button" data-module-btn="players" onclick="setAdminModule(\'players\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>Jugadores</button>';
  html += '<button type="button" data-module-btn="results" onclick="setAdminModule(\'results\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21h18M7 17V9M12 17V5M17 17v-6"/></svg>Resultados</button>';
  html += '<button type="button" data-module-btn="challenges" onclick="setAdminModule(\'challenges\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>Desafíos</button>';
  html += '<button type="button" data-module-btn="products" onclick="setAdminModule(\'products\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>Tienda</button>';
  html += '<button type="button" data-module-btn="orders" onclick="setAdminModule(\'orders\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>Compras</button>';
html += '<button type="button" data-module-btn="members" onclick="setAdminModule(\'members\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87"/></svg>Miembros</button>';
  html += '<button type="button" data-module-btn="users" onclick="setAdminModule(\'users\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87"/></svg>Cuentas</button>';
  html += '<button type="button" data-module-btn="ranking" onclick="setAdminModule(\'ranking\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21h18M7 17V9M12 17V5M17 17v-6"/></svg>Ranking</button>';
  html += '<button type="button" data-module-btn="settings" onclick="setAdminModule(\'settings\')"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>Ajustes</button>';
  html += '</nav>';

  // Sección de torneos
  html += '<section class="admin-section admin-module" data-module="tournaments" hidden>';
  html += '<div id="tournamentAdminMount"></div>';
  html += '</section>';

  // Sección de pedidos / compras
  html += '<section class="admin-section admin-module" data-module="orders" hidden><h3>Compras recientes</h3><div class="admin-order-tools"><p class="admin-section-help">Consulta las compras y pagos realizados en la tienda.</p><button class="btn btn-secondary btn-sm" type="button" onclick="syncAdminOrders()">Sincronizar pagos con Stripe</button></div>' + (orderSyncMessage ? '<p class="admin-order-sync-message" role="status">' + escapeHtml(orderSyncMessage) + '</p>' : "") + '<div class="table-wrap" style="margin-bottom:20px"><table><thead><tr><th>ID</th><th>Usuario</th><th>Producto</th><th>Monto</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>' + orders.map(function(o) { return '<tr><td title="' + escapeHtml(o.id) + '">' + escapeHtml(o.id.slice(0, 8)) + '</td><td>' + escapeHtml(o.userName) + '</td><td>' + escapeHtml(o.productName) + '</td><td>$' + (o.amount / 100).toFixed(2) + '</td><td><span class="tag">' + escapeHtml(orderStatusLabel(o.status)) + '</span></td><td>' + (o.created ? formatLocalDate(o.created) : '-') + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminOrder(\'' + escapeHtml(o.id) + '\')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminOrder(\'' + escapeHtml(o.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div><form id="adminOrderForm" class="admin-form" hidden><input type="hidden" name="orderId"><label>Estado<select name="status"><option value="pending">Pendiente</option><option value="paid">Pagado</option><option value="cancelled">Cancelado</option><option value="refunded">Reembolsado</option></select></label><label>Producto<input name="productName" maxlength="120"></label><label>Monto (USD)<input name="amount" type="number" min="0" step="0.01"></label><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar cambios</button><button type="button" class="btn btn-secondary" onclick="resetAdminOrderForm()">Cancelar</button></div></form></section>';

  html += '<section class="admin-section admin-module" data-module="results" hidden><h3>Resultados de partidos</h3><p class="admin-section-help">Confirma, rechaza o elimina un reporte. Los resultados confirmados impactan el ranking.</p><button class="btn btn-primary" type="button" style="margin-bottom:10px" onclick="openAdminResultForm()">Registrar resultado nuevo</button><div class="grid grid-2 admin-records">' + (pendingResults.length ? pendingResults.map(function(r) {
    return '<article class="card admin-record"><span class="tag ' + (r.status === "disputed" ? "tag-red" : "") + '">' + (r.status === "disputed" ? "En disputa" : "Pendiente") + '</span><h4>' + escapeHtml(r.winnerName) + ' vs ' + escapeHtml(r.loserName) + '</h4><p class="muted">' + escapeHtml(r.score) + '</p><div class="admin-form-actions"><button class="btn btn-primary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'confirm\')">Confirmar</button><button class="btn btn-secondary" onclick="moderateResult(\'' + escapeHtml(r.id) + '\',\'reject\')">Rechazar</button><button class="btn btn-dark" onclick="editAdminResult(\'' + escapeHtml(r.id) + '\')">Editar</button><button class="btn btn-danger" onclick="deleteAdminResult(\'' + escapeHtml(r.id) + '\')">Eliminar</button></div></article>';
  }).join("") : '<p class="muted">No hay resultados pendientes.</p>') + '</div><details class="admin-history"><summary>Historial de resultados (' + results.length + ')</summary><div class="table-wrap"><table><thead><tr><th>Partido</th><th>Marcador</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>' + results.map(function(r) { return '<tr><td>' + escapeHtml(r.winnerName) + ' vs ' + escapeHtml(r.loserName) + '</td><td>' + escapeHtml(r.score) + '</td><td>' + r.status + '</td><td>' + (r.playedAt ? formatLocalDate(r.playedAt) : '-') + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminResult(\'' + escapeHtml(r.id) + '\')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminResult(\'' + escapeHtml(r.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></details>' + '<form id="adminResultForm" class="admin-form admin-result-form" hidden><input type="hidden" name="resultId"><h4 class="full admin-form-title" id="adminResultFormTitle">Editar resultado reportado</h4><p class="full muted" id="adminResultFormDesc">Al guardar, volverá a estado pendiente para que el rival confirme el cambio. Elige el torneo, luego el partido: los 2 jugadores se colocan solos.</p><label>Torneo<select name="tournamentId"><option value="">Seleccionar torneo (opcional)</option>' + (allTournaments || []).map(function(t) { return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.title || t.month || "Torneo") + '</option>'; }).join("") + '</select></label><label>Elige el partido<select name="matchId" size="6"><option value="">Seleccionar partido (opcional)</option></select></label><div class="result-players full"><div class="result-player"><b id="adminPlayerAName">—</b><small>Elige un partido del torneo…</small></div><span class="result-vs">vs</span><div class="result-player"><b id="adminPlayerBName">—</b><small>Los 2 jugadores se colocan solos</small></div></div><div class="full" id="adminManualPlayers" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"><label style="display:flex; flex-direction:column; gap:6px;">Jugador A<select name="winnerA"><option value="">Seleccionar</option>' + allPlayers.map(function(player) { return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + '</option>'; }).join("") + '</select></label><label style="display:flex; flex-direction:column; gap:6px;">Jugador B<select name="loserB"><option value="">Seleccionar</option>' + allPlayers.map(function(player) { return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + '</option>'; }).join("") + '</select></label></div><input type="hidden" name="winnerId" id="adminWinnerHidden"><input type="hidden" name="loserId" id="adminLoserHidden"><input type="hidden" name="score" id="adminScoreHidden"><div class="full" id="adminScoreEditor"></div><label>Categoría<select name="category" required><option value="singles">Singles</option><option value="dobles">Dobles</option><option value="dobles_mixtos">Dobles Mixtos</option></select></label><label>Fecha<input name="playedAt" type="date" required></label><div class="admin-form-actions full"><button class="btn btn-primary">Guardar y solicitar confirmación</button><button type="button" class="btn btn-secondary" onclick="cancelAdminResultEdit()">Cancelar</button></div></form></section>';

  html += '<section class="admin-section admin-module" data-module="players" hidden><h3>Jugadores de la liga</h3><p class="admin-section-help">Administra el nombre, nivel y zona que aparecen en la clasificación. Los perfiles con historial deportivo no se pueden borrar.</p><form id="adminPlayerForm" class="admin-form" hidden><input type="hidden" name="playerId"><label class="full">Cuenta vinculada<select name="accountId" required><option value="">Selecciona una cuenta sin perfil</option>' + playersWithoutProfile.map(function(user) { return '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + ' · ' + escapeHtml(user.email) + '</option>'; }).join("") + '</select></label><label>Nombre público<input name="name" maxlength="100" required></label><label>Nivel<select name="level" required>' + levels.map(function(level) { return '<option value="' + level + '">' + level + '</option>'; }).join("") + '</select></label><label>Categoría<select name="category" required><option value="singles">Singles</option><option value="dobles">Dobles</option><option value="dobles_mixtos">Dobles Mixtos</option></select></label><label>Modalidad<select name="gender" required><option value="hombres">Hombres</option><option value="mujeres">Mujeres</option></select></label><label class="full">Zona<select name="zone" required><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label><div class="admin-form-actions full"><button class="btn btn-primary">Guardar perfil</button><button type="button" class="btn btn-secondary" onclick="resetAdminPlayerForm()">Cancelar</button></div></form><button class="btn btn-primary" style="margin-bottom:16px" type="button" onclick="openAdminDynamicEditModal(\'adminPlayerForm\', \'Nuevo jugador\')">Nuevo jugador</button><div class="table-wrap"><table><thead><tr><th>Jugador</th><th>Email</th><th>Nivel</th><th>Categoría</th><th>Modalidad</th><th>Zona</th><th>Partidos</th><th>Puntos</th><th>Acciones</th></tr></thead><tbody>' + players.map(function(player) { return '<tr><td>' + escapeHtml(player.name) + '</td><td>' + escapeHtml(player.email || '-') + '</td><td>' + escapeHtml(player.level) + '</td><td>' + escapeHtml(CATEGORY_LABELS[player.category || "singles"] || "Singles") + '</td><td>' + escapeHtml(GENDER_LABELS[player.gender || "hombres"] || "Hombres") + '</td><td>' + escapeHtml(player.zone) + '</td><td>' + Number(player.matches) + '</td><td>' + Number(player.points) + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminPlayer(\'' + escapeHtml(player.id) + '\')">Editar</button><button class="btn btn-sm btn-danger" onclick="deleteAdminPlayer(\'' + escapeHtml(player.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="products" hidden><h3>Tienda y membresías</h3><p class="admin-section-help">Lo que esté marcado como disponible se mostrará en la página principal.</p><form id="adminProductForm" class="admin-form" hidden><input type="hidden" name="id"><label>Nombre<input name="name" maxlength="120" required></label><label>Precio (USD)<input name="price" type="number" min="0.01" step="0.01" required></label><label>Tipo<select name="type"><option value="digital">Producto digital</option><option value="subscription">Suscripción</option></select></label><label>Frecuencia<select name="interval"><option value="month">Mensual</option><option value="year">Anual</option></select></label><label>Categoría<select name="category"><option value="">General</option><option value="libros">Libros digitales</option><option value="ropa">Ropa y accesorios</option></select></label><label class="full">Descripción<textarea name="description" rows="2" maxlength="500"></textarea></label><label class="full">Enlace de compra (opcional)<input name="link" type="url" placeholder="https://..."></label><label class="full">Imagen del producto<input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp" onchange="previewProductImageFile(this)"></label><input type="hidden" name="image"><div class="full"><img id="productImagePreview" alt="" style="display:none; width:100%; max-height:160px; object-fit:cover; border-radius:8px; border:1px solid var(--line);"></div><label class="full"><span><input name="active" type="checkbox" checked> Disponible en la tienda</span></label><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar producto</button><button class="btn btn-secondary" type="button" onclick="resetProductForm()">Limpiar</button></div></form><button class="btn btn-primary" style="margin-bottom:16px" type="button" onclick="openAdminDynamicEditModal(\'adminProductForm\', \'Nuevo producto\')">Nuevo producto</button><div class="grid grid-3 admin-records">' + allProducts.map(function(product) { return '<article class="card admin-record"><h4>' + escapeHtml(product.name) + '</h4><p class="muted">$' + (product.price / 100).toFixed(2) + (product.type === "subscription" ? ' /' + (product.interval === "year" ? "año" : "mes") : "") + '</p><span class="tag ' + (product.active ? "" : "tag-red") + '">' + (product.active ? "Activo" : "Inactivo") + '</span><p class="muted">' + escapeHtml(product.description || "") + '</p><div class="admin-form-actions"><button class="btn btn-sm btn-dark" onclick="editProduct(\'' + escapeHtml(product.id) + '\')">Editar</button><button class="btn btn-sm btn-secondary" onclick="toggleProduct(\'' + escapeHtml(product.id) + '\')">' + (product.active ? "Desactivar" : "Activar") + '</button><button class="btn btn-sm btn-secondary" onclick="deleteProduct(\'' + escapeHtml(product.id) + '\')">Eliminar</button></div></article>'; }).join("") + '</div></section>';

  html += '<section class="admin-section admin-module" data-module="challenges" hidden><h3>Desafíos publicados</h3><p class="admin-section-help">Revisa la actividad de la comunidad, cierra publicaciones resueltas o elimina contenido inválido. Desde un desafío aceptado puedes registrar directamente el resultado del partido.</p><div class="grid grid-3 admin-records">' + allChallenges.map(function(challenge) { return '<article class="card admin-record"><span class="tag ' + (challenge.status === "accepted" ? "tag-blue" : "") + '">' + challengeStatusLabel(challenge.status) + '</span><h4>' + escapeHtml(challenge.playerName) + '</h4><p>' + escapeHtml(challenge.availability || "") + '</p>' + (challenge.acceptedPlayerName ? '<p class="muted">Aceptado por ' + escapeHtml(challenge.acceptedPlayerName) + '</p>' : "") + '<p class="muted">' + (challenge.created ? formatLocalDate(challenge.created) : "") + '</p><div class="admin-form-actions">' + (challenge.status !== "closed" ? '<button class="btn btn-sm btn-dark" onclick="setChallengeStatus(\'' + escapeHtml(challenge.id) + '\',\'closed\')">Cerrar</button>' : "") + (challenge.status === "closed" ? '<button class="btn btn-sm btn-secondary" onclick="setChallengeStatus(\'' + escapeHtml(challenge.id) + '\',\'open\')">Reabrir</button>' : "") + (challenge.status === "accepted" && challenge.acceptedPlayerId ? '<button class="btn btn-sm btn-primary" onclick="openResultModal(\'' + escapeHtml(challenge.playerId) + '\',\'' + escapeHtml(challenge.acceptedPlayerId) + '\')">Registrar resultado</button>' : "") + '<button class="btn btn-sm btn-danger" onclick="deleteAdminChallenge(\'' + escapeHtml(challenge.id) + '\')">Eliminar</button>' + '</div></article>'; }).join("") + '</div></section>';

  html += '<section class="admin-section admin-module" data-module="users" hidden><h3>Cuentas registradas</h3><p class="admin-section-help">Crea cuentas, gestiona emails y contraseñas, permisos y membresías. Por seguridad, las contraseñas nunca se muestran.</p><label class="admin-search">Buscar usuario<input id="adminUserSearch" type="search" placeholder="Nombre o email"></label><div class="grid grid-2"><label>Rol<select id="adminUserRoleFilter"><option value="all">Todos</option><option value="user">Usuario</option><option value="member">Miembro</option><option value="admin">Administrador</option></select></label><label>Teléfono<select id="adminUserPhoneFilter"><option value="all">Todos</option><option value="with">Con teléfono</option><option value="without">Sin teléfono</option></select></label></div><form id="adminUserForm" class="admin-form" hidden><input type="hidden" name="userId"><label>Nombre<input name="name" maxlength="100"></label><label>Email<input name="email" type="email" required></label><label>Contraseña<input name="password" type="password" minlength="8" maxlength="128" placeholder="Dejar vacío para no cambiar (editar) / Mínimo 8 caracteres (nuevo)"></label><label>Rol<select name="role"><option value="user">Usuario</option><option value="member">Miembro</option><option value="admin">Administrador</option></select></label><label>Nivel<select name="level"><option value="">Sin nivel</option><option value="2.5">2.5</option><option value="3.0">3.0</option><option value="3.5">3.5</option><option value="4.0">4.0</option><option value="4.5">4.5</option><option value="5.0">5.0</option></select></label><label>Zona<select name="zone"><option value="">Sin zona</option><option>Aventura / Sunny Isles</option><option>North Miami / Miami Gardens</option><option>Downtown / Brickell</option><option>Kendall / Doral</option></select></label><label>Teléfono<input name="phone" type="tel" placeholder="Ej. +1 305 555 0123"></label><label>Nacionalidad<input name="nationality" maxlength="60" placeholder="Ej. Argentina"></label><label class="full"><span><input name="membershipActive" type="checkbox"> Membresía activa</span></label><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar usuario</button><button type="button" class="btn btn-secondary" onclick="resetAdminUserForm()">Cancelar</button></div></form><button class="btn btn-primary" style="margin-bottom:16px" type="button" onclick="openAdminDynamicEditModal(\'adminUserForm\', \'Nuevo usuario\')">Nuevo usuario</button><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Nivel</th><th>Zona</th><th>Membresía</th><th>Acciones</th></tr></thead><tbody id="adminUsersBody">' + users.map(function(u) { return '<tr data-role="' + (u.role || "user") + '" data-has-phone="' + (u.phone ? "true" : "false") + '"><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + escapeHtml(u.phone || '-') + '</td><td><span class="tag ' + (u.role === "admin" ? "tag-blue" : "") + '">' + (u.role === "admin" ? "Administrador" : u.role === "member" ? "Miembro" : "Usuario") + '</span></td><td>' + escapeHtml(u.level || '-') + '</td><td>' + escapeHtml(u.zone || '-') + '</td><td>' + (u.membershipActive ? "Activa" : "-") + '</td><td><button class="btn btn-sm btn-dark" onclick="editAdminUser(\'' + escapeHtml(u.id) + '\')">Editar</button> <button class="btn btn-sm btn-danger" onclick="deleteAdminUser(\'' + escapeHtml(u.id) + '\')">Eliminar</button></td></tr>'; }).join("") + '</tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="members" hidden><h3>Gestión de miembros</h3><p class="admin-section-help">Convierte usuarios a miembro y quita la membresía de los miembros actuales cuando sea necesario.</p><div class="admin-stats" style="margin-bottom:16px"><div class="stat-card"><div class="stat-number">' + membersList.length + '</div><div class="stat-label">Miembros</div></div><div class="stat-card"><div class="stat-number">' + nonMembersList.length + '</div><div class="stat-label">Usuarios no miembros</div></div></div><div class="grid grid-2"><div><h4>Convertir a miembro</h4><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol actual</th><th>Acción</th></tr></thead><tbody>' + nonMembersList.map(function(u) { return '<tr><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + (u.role === "member" ? "Miembro" : u.role === "admin" ? "Administrador" : "Usuario") + '</td><td>' + (u.role === "user" ? '<button class="btn btn-sm btn-primary" style="padding:4px 8px;font-size:12px" onclick="setUserMember(\'' + escapeHtml(u.id) + '\')">Miembro</button>' : '<span class="muted">-</span>') + '</td></tr>'; }).join("") + '</tbody></table></div></div><div><h4>Miembros actuales</h4><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Nivel</th><th>Zona</th><th>Acción</th></tr></thead><tbody>' + membersList.map(function(u) { return '<tr><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + escapeHtml(u.level || '-') + '</td><td>' + escapeHtml(u.zone || '-') + '</td><td><button class="btn btn-sm btn-danger" style="padding:4px 8px;font-size:12px" onclick="setUserNonMember(\'' + escapeHtml(u.id) + '\')">Quitar membresía</button></td></tr>'; }).join("") + '</tbody></table></div></div></div></section>';

  html += '<section class="admin-section admin-module" data-module="ranking" hidden><h3>Ranking</h3><p class="admin-section-help">Ajusta la base manual de puntos por jugador. El total suma esa base y los puntos automáticos de victorias confirmadas. Filtra por torneo o general.</p><div class="admin-form" style="margin-bottom:10px"><label>Vista del ranking<select id="adminRankingScope" onchange="renderAdminRanking(this.value)"></select></label></div><div class="table-wrap"><table><thead><tr><th>Pos.</th><th>Jugador</th><th>Nivel</th><th>Partidos</th><th>Puntos manuales</th><th>Total</th></tr></thead><tbody id="adminRankingBody"></tbody></table></div></section>';

  html += '<section class="admin-section admin-module" data-module="settings" hidden><h3>Ajustes del sitio</h3><p class="admin-section-help">Configura el botón de WhatsApp de la página pública. Ingresa solo el número y el mensaje; el enlace se crea automáticamente.</p><form id="adminSettingsForm" class="admin-form"><label>Número de WhatsApp<input name="whatsappPhone" type="tel" placeholder="Ej. +1 305 555 0123"></label><label class="full">Mensaje predeterminado<textarea name="whatsappMessage" rows="2" maxlength="500" placeholder="Hola, quiero información sobre la liga"></textarea></label><label class="full">Enlace generado (opcional, solo lectura)<input name="whatsappUrl" type="url" readonly placeholder="Se genera automáticamente"></label><p class="full muted">Déjalo vacío para ocultar el botón flotante. También puedes pegar un enlace completo de WhatsApp si lo prefieres.</p><div class="admin-form-actions full"><button class="btn btn-primary" type="submit">Guardar ajustes</button></div></form></section>';
  html += '</div>';
  html += '</div>';

  content.innerHTML = html;
  mountAdminTournament();
  document.getElementById("adminUserSearch")?.addEventListener("input", filterAdminUsers);
  document.getElementById("adminUserRoleFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminUserPhoneFilter")?.addEventListener("change", filterAdminUsers);
  document.getElementById("adminProductForm")?.addEventListener("submit", saveProduct);
  document.getElementById("adminUserForm")?.addEventListener("submit", saveAdminUser);
  document.getElementById("adminPlayerForm")?.addEventListener("submit", saveAdminPlayer);
  document.getElementById("adminResultForm")?.addEventListener("submit", saveAdminResult);
  const adminResultFormEl = document.getElementById("adminResultForm");
  if (adminResultFormEl) {
    adminResultPlayers = null;
    adminResultCascade = setupResultCascade({
      tournamentSelect: adminResultFormEl.elements.namedItem("tournamentId"),
      matchSelect: adminResultFormEl.elements.namedItem("matchId"),
      nameA: document.getElementById("adminPlayerAName"),
      nameB: document.getElementById("adminPlayerBName"),
      manualWrap: document.getElementById("adminManualPlayers"),
      manualA: adminResultFormEl.elements.namedItem("winnerA"),
      manualB: adminResultFormEl.elements.namedItem("loserB"),
      hiddenWinner: document.getElementById("adminWinnerHidden"),
      hiddenLoser: document.getElementById("adminLoserHidden"),
      onPlayers(payload) {
        adminResultPlayers = payload;
        if (adminResultEditor) adminResultEditor.setNames(payload.playerAName, payload.playerBName);
      }
    });
    adminResultCascade.setTournaments(adminTournaments || []);
    adminResultEditor = mountResultEditor(adminResultFormEl, "adminScoreEditor");
    const syncAdminManual = () => {
      adminResultPlayers = null;
      const hiddenWinner = document.getElementById("adminWinnerHidden");
      const hiddenLoser = document.getElementById("adminLoserHidden");
      const manualA = adminResultFormEl.elements.namedItem("winnerA");
      const manualB = adminResultFormEl.elements.namedItem("loserB");
      if (hiddenWinner) hiddenWinner.value = manualA ? manualA.value : "";
      if (hiddenLoser) hiddenLoser.value = manualB ? manualB.value : "";
      if (adminResultEditor && manualA && manualB && manualA.value && manualB.value) {
        adminResultEditor.setNames(manualA.options[manualA.selectedIndex]?.textContent || "Jugador A", manualB.options[manualB.selectedIndex]?.textContent || "Jugador B");
      }
    };
    adminResultFormEl.elements.namedItem("winnerA")?.addEventListener("change", syncAdminManual);
    adminResultFormEl.elements.namedItem("loserB")?.addEventListener("change", syncAdminManual);
  }
document.getElementById("adminOrderForm")?.addEventListener("submit", saveAdminOrder);
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
  const linkInput = form.elements.namedItem("link");
  if (linkInput) linkInput.value = product.link || product.url || "";
  const preview = document.getElementById("productImagePreview");
  if (preview) {
    preview.style.display = imageInput.value ? "block" : "none";
    if (imageInput.value) preview.src = imageInput.value;
  }
  openAdminDynamicEditModal("adminProductForm", "Editar producto");
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

function previewProfilePhotoFileLegacy(input) {
  // Implementación histórica (duplicada). La activa es la de arriba con
  // validación + estado pendiente; se conserva por compatibilidad.
  return previewProfilePhotoFile(input);
}

async function uploadPlayerPhotoFile(form) {
  const fileInput = form.elements.namedItem("photoFile");
  const file = fileInput?.files?.[0];
  if (!file) return null;
  const compressed = await compressProfileImage(file);
  const uploaded = await api("/api/profile/photo", {
    method: "POST",
    body: JSON.stringify({ image: compressed, country: "" })
  });
  return uploaded.photo;
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

async function compressProfileImage(file) {
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
  const maxSize = 400;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function uploadProfileImageFile(file, countryValue) {
  if (!file) return null;
  const compressed = await compressProfileImage(file);
  const uploaded = await api("/api/profile/photo", {
    method: "POST",
    body: JSON.stringify({ image: compressed, country: (countryValue || "").trim() })
  });
  return uploaded.photo;
}

async function uploadProfileImage(form) {
  // El input de foto vive en la pestaña Foto (no dentro de profileEditForm):
  // se lee del estado pendiente o del input por id, nunca del form.
  const input = document.getElementById("profilePhotoFileInput");
  const file = pendingProfilePhotoFile || (input && input.files && input.files[0]) || (form && form.elements.namedItem("photoFile") && form.elements.namedItem("photoFile").files && form.elements.namedItem("photoFile").files[0]);
  const countryEl = form && form.elements.namedItem ? form.elements.namedItem("country") : document.getElementById("profileCountrySelect");
  return uploadProfileImageFile(file, countryEl ? countryEl.value : "");
}

function resetProductForm() {
  const form = document.getElementById("adminProductForm");
  if (!form) return;
  form.reset();
  form.elements.namedItem("id").value = "";
  form.elements.namedItem("image").value = "";
  if (form.elements.namedItem("link")) form.elements.namedItem("link").value = "";
  const preview = document.getElementById("productImagePreview");
  if (preview) preview.style.display = "none";
  form.elements.namedItem("category").value = "";
  form.elements.namedItem("active").checked = true;
  closeAdminDynamicEditModal();
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
    link: form.elements.namedItem("link")?.value || "",
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
    await loadTournaments();
    await showAdminPanel();
    showToast(action === "confirm" ? "Resultado confirmado y ranking actualizado." : "Resultado rechazado.");
  } catch (error) {
    showToast(`No se pudo moderar el resultado: ${error.message}`);
  }
}

async function openAdminResultForm() {
  const form = document.getElementById("adminResultForm");
  if (!form) return;
  // Asegurar que los datos estén cargados (torneos reference + jugadores)
  try {
    if (!adminTournaments || adminTournaments.length === 0) {
      const data = await api("/api/tournaments");
      adminTournaments = Array.isArray(data.tournaments) ? data.tournaments : (Array.isArray(data) ? data : []);
    }
    if (!players || players.length === 0) {
      players = await api("/api/admin/players");
    }
  } catch { /* no bloquear, se usará lo que haya */ }
  form.reset();
  form.elements.namedItem("resultId").value = "";
  adminResultPlayers = null;
  const nameAEl = document.getElementById("adminPlayerAName");
  const nameBEl = document.getElementById("adminPlayerBName");
  if (nameAEl) nameAEl.textContent = "—";
  if (nameBEl) nameBEl.textContent = "—";
  const hiddenWinner = document.getElementById("adminWinnerHidden");
  const hiddenLoser = document.getElementById("adminLoserHidden");
  if (hiddenWinner) hiddenWinner.value = "";
  if (hiddenLoser) hiddenLoser.value = "";
  const titleEl = document.getElementById("adminResultFormTitle");
  const descEl = document.getElementById("adminResultFormDesc");
  if (titleEl) titleEl.textContent = "Registrar resultado nuevo";
  if (descEl) descEl.textContent = "Elige el torneo, luego el partido: los 2 jugadores se colocan solos. Al guardar, el resultado queda pendiente hasta que el rival lo confirme (salvo que lo guarde un administrador, que se confirma directo).";
  if (adminResultCascade) {
    adminResultCascade.setTournaments(adminTournaments || []);
    adminResultCascade.selectTournament("");
  }
  const manualWrap = document.getElementById("adminManualPlayers");
  // Jugadores se colocan automáticamente al elegir el partido: sin selección manual.
  if (manualWrap) manualWrap.style.display = "none";
  const manualA = form.elements.namedItem("winnerA");
  const manualB = form.elements.namedItem("loserB");
  if (manualA) manualA.value = "";
  if (manualB) manualB.value = "";
  if (adminResultEditor) {
    adminResultEditor.setNames("Jugador A", "Jugador B");
    adminResultEditor.setSets([]);
  }
  openAdminDynamicEditModal("adminResultForm", "Registrar resultado nuevo");
}

async function editAdminResult(resultId) {
  // Asegurar que los datos estén cargados
  try {
    if (!adminTournaments || adminTournaments.length === 0) {
      const data = await api("/api/tournaments");
      adminTournaments = Array.isArray(data.tournaments) ? data.tournaments : (Array.isArray(data) ? data : []);
    }
    if (!players || players.length === 0) {
      players = await api("/api/admin/players");
    }
    if (!matchResults || matchResults.length === 0) {
      matchResults = await api("/api/results");
    }
  } catch { /* no bloquear */ }
  const result = matchResults.find(item => item.id === resultId);
  const form = document.getElementById("adminResultForm");
  if (!result || !form) return;
  openAdminDynamicEditModal("adminResultForm", "Editar resultado");
  form.elements.namedItem("resultId").value = result.id;
  const hiddenWinner = document.getElementById("adminWinnerHidden");
  const hiddenLoser = document.getElementById("adminLoserHidden");
  if (hiddenWinner) hiddenWinner.value = result.winnerId;
  if (hiddenLoser) hiddenLoser.value = result.loserId;
  form.elements.namedItem("category").value = result.category || "singles";
  form.elements.namedItem("playedAt").value = (result.playedAt || result.created || "").slice(0, 10);
  const titleEl = document.getElementById("adminResultFormTitle");
  const descEl = document.getElementById("adminResultFormDesc");
  if (titleEl) titleEl.textContent = "Editar resultado";
  if (descEl) descEl.textContent = "Elige el torneo, luego el partido: los 2 jugadores se colocan solos. Al guardar, el resultado se confirma directo y actualiza el ranking.";
  // Mismo flujo que el resto: torneo → partido → 2 jugadores automáticos.
  if (adminResultCascade) {
    adminResultCascade.setTournaments(adminTournaments || []);
    adminResultCascade.selectTournament(result.tournamentId || "");
    const matchSelect = form.elements.namedItem("matchId");
    if (result.matchId) {
      if (matchSelect) matchSelect.value = result.matchId;
      adminResultCascade.applyMatch(result.matchId, result.tournamentId || "");
    }
  } else {
    form.elements.namedItem("tournamentId").value = result.tournamentId || "";
    form.elements.namedItem("matchId").value = result.matchId || "";
  }
  // Jugadores del reporte: A = ganador registrado, B = rival (perspectiva neutral).
  const winnerName = result.winnerName || "Jugador A";
  const loserName = result.loserName || "Jugador B";
  adminResultPlayers = {
    playerAId: result.winnerId,
    playerBId: result.loserId,
    playerAName: winnerName,
    playerBName: loserName
  };
  const nameAEl = document.getElementById("adminPlayerAName");
  const nameBEl = document.getElementById("adminPlayerBName");
  if (nameAEl) nameAEl.textContent = winnerName;
  if (nameBEl) nameBEl.textContent = loserName;
  // Manual fallback sincronizado por si no hay partido.
  const manualA = form.elements.namedItem("winnerA");
  const manualB = form.elements.namedItem("loserB");
  if (manualA && result.winnerId) manualA.value = result.winnerId;
  if (manualB && result.loserId) manualB.value = result.loserId;
  // El marcador guardado está en perspectiva del ganador: mapea directo a A-B.
  if (adminResultEditor) {
    adminResultEditor.setNames(winnerName, loserName);
    adminResultEditor.setSets(window.TennisScore ? window.TennisScore.parseScoreString(result.score) : []);
  }
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelAdminResultEdit() {
  const form = document.getElementById("adminResultForm");
  form.reset();
  form.hidden = true;
  closeAdminDynamicEditModal();
}

async function saveAdminResult(event) {
  event.preventDefault();
  const form = event.target;
  const selectedMatchId = form.elements.namedItem("matchId")?.value;
  const selectedTournamentId = form.elements.namedItem("tournamentId")?.value;
  if (selectedMatchId && adminResultCascade) {
    try { adminResultCascade.applyMatch(selectedMatchId, selectedTournamentId || ""); } catch { /* ignore */ }
  }
  let playerAId = document.getElementById("adminWinnerHidden")?.value || "";
  let playerBId = document.getElementById("adminLoserHidden")?.value || "";
  if (!adminResultPlayers) {
    const manualA = form.elements.namedItem("winnerA");
    const manualB = form.elements.namedItem("loserB");
    if (manualA && manualB && manualA.value && manualB.value) { playerAId = manualA.value; playerBId = manualB.value; }
  }
  if (adminResultPlayers) { playerAId = adminResultPlayers.playerAId; playerBId = adminResultPlayers.playerBId; }
  if (!playerAId || !playerBId || playerAId === playerBId) {
    showToast("Elige el partido (sus 2 jugadores se colocan solos) o selecciona Jugador A y Jugador B.");
    return;
  }
  const check = adminResultEditor ? adminResultEditor.validate() : { ok: false, error: "Ingresa el marcador completo (mínimo 2 sets)." };
  if (!check.ok) {
    showToast(check.error);
    return;
  }
  const winnerId = check.winnerIndex === 0 ? playerAId : playerBId;
  const loserId = check.winnerIndex === 0 ? playerBId : playerAId;
  const score = adminResultEditor.score();
  const resultId = form.elements.namedItem("resultId").value;
  try {
    if (resultId) {
      // Editar resultado existente: el administrador confirma directo.
      await api("/api/admin/results", {
        method: "PATCH",
        body: JSON.stringify({
          action: "edit",
          resultId,
          winnerId,
          loserId,
          category: form.elements.namedItem("category").value,
          tournamentId: form.elements.namedItem("tournamentId").value || null,
          matchId: form.elements.namedItem("matchId").value || null,
          score,
          playedAt: form.elements.namedItem("playedAt").value
        })
      });
      await Promise.all([loadPlayers(), loadResults()]);
      await loadTournaments();
      await showAdminPanel();
      if (adminResultEditor) { adminResultEditor.setSets([]); adminResultEditor.setNames("Jugador A", "Jugador B"); }
      adminResultPlayers = null;
      closeAdminDynamicEditModal();
      showToast("Resultado corregido y confirmado; ranking actualizado.");
    } else {
      // Crear resultado nuevo: queda pendiente hasta que el rival confirme.
      await api("/api/results", {
        method: "POST",
        body: JSON.stringify({
          winnerId,
          loserId,
          category: form.elements.namedItem("category").value,
          tournamentId: form.elements.namedItem("tournamentId").value || null,
          matchId: form.elements.namedItem("matchId").value || null,
          score,
          playedAt: form.elements.namedItem("playedAt").value
        })
      });
      await Promise.all([loadPlayers(), loadResults()]);
      await loadTournaments();
      await showAdminPanel();
      if (adminResultEditor) { adminResultEditor.setSets([]); adminResultEditor.setNames("Jugador A", "Jugador B"); }
      adminResultPlayers = null;
      closeAdminDynamicEditModal();
      showToast("Resultado enviado; el rival debe confirmarlo para actualizar el ranking.");
    }
  } catch (error) {
    showToast(`No se pudo guardar el resultado: ${error.message}`);
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

const _adminFormHomes = new Map();
function openAdminDynamicEditModal(formId, title) {
  const form = document.getElementById(formId);
  const box = document.getElementById("adminDynamicEditBox");
  const titleEl = document.getElementById("adminDynamicEditTitle");
  if (!form || !box) return;
  if (!_adminFormHomes.has(form)) {
    _adminFormHomes.set(form, { parent: form.parentNode, next: form.nextSibling });
  }
  if (titleEl) titleEl.textContent = title;
  if (!box.contains(form)) box.appendChild(form);
  openModal("adminDynamicEditModal");
}
function closeAdminDynamicEditModal() {
  const box = document.getElementById("adminDynamicEditBox");
  if (box) {
    Array.from(box.querySelectorAll("form")).forEach(form => {
      const home = _adminFormHomes.get(form);
      if (home && home.parent) {
        if (home.next && home.next.parentNode === home.parent) {
          home.parent.insertBefore(form, home.next);
        } else {
          home.parent.appendChild(form);
        }
      }
    });
  }
  closeModal("adminDynamicEditModal");
}

function openProfileEditModal() {
  if (!currentUser) return;
  const form = document.getElementById("profileEditForm");
  if (!form) return;
  form.elements.namedItem("name").value = currentUser.name || "";
  form.elements.namedItem("email").value = currentUser.email || "";
  form.elements.namedItem("phone").value = currentUser.phone || "";
  const countrySelect = document.getElementById("profileCountrySelect");
  if (countrySelect && countrySelect.options.length <= 1) {
    countrySelect.innerHTML = '<option value="">Selecciona un país</option>' +
      COUNTRIES.map(function(c) { return '<option value="' + escapeHtml(c.name) + '">' + c.flag + ' ' + escapeHtml(c.name) + '</option>'; }).join("");
  }
  form.elements.namedItem("country").value = currentUser.nationality || "";
  form.elements.namedItem("password").value = "";
  pendingProfilePhotoFile = null;
  const photoInput = document.getElementById("profilePhotoFileInput");
  if (photoInput) photoInput.value = "";
  syncProfileHead();
  setProfileSavedIndicator("Sin cambios", false);
  if (!form.dataset.dirtyBound) {
    form.dataset.dirtyBound = "1";
    form.addEventListener("input", () => setProfileSavedIndicator("Cambios sin guardar", true));
    form.addEventListener("change", () => setProfileSavedIndicator("Cambios sin guardar", true));
  }
  showProfileTab("datos");
  openModal("profileEditModal");
}

async function saveProfileEdit(event) {
  event.preventDefault();
  if (!currentUser) return;
  const form = event.target;
  const name = form.elements.namedItem("name").value.trim();
  const email = form.elements.namedItem("email").value.trim();
  const phone = form.elements.namedItem("phone").value.trim();
  const countryEl = form.elements.namedItem("country");
  const nationality = (countryEl ? countryEl.value : "").trim();
  const password = form.elements.namedItem("password").value;

  if (!name || !email) {
    showToast("Nombre y email son requeridos.");
    return;
  }

  if (password && (password.length < 8 || password.length > 128)) {
    showToast("La contraseña debe tener entre 8 y 128 caracteres.");
    return;
  }
  try {
    setProfileSavedIndicator("Guardando…", false);
    const photo = await uploadProfileImage(form);
    const body = { phone: phone || null, nationality: nationality || null, name };
    if (password) body.password = password;
    if (email !== currentUser.email) body.email = email;
    if (photo) body.photo = photo;

    const data = await api("/api/profile/phone", {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (data.user) {
      currentUser = { ...currentUser, ...data.user };
      if (photo) currentUser.photo = photo;
      updateAuthUI();
    }
    pendingProfilePhotoFile = null;
    syncProfileHead();
    setProfileSavedIndicator("Sin cambios", false);
    closeModal("profileEditModal");
    showToast("Perfil actualizado.");
  } catch (error) {
    setProfileSavedIndicator("Cambios sin guardar", true);
    showToast(`No se pudo actualizar: ${error.message}`);
  }
}

// Guardar datos desde la pestaña Foto (el input de foto vive ahí; se lee pendingProfilePhotoFile).
function saveProfileEditHandler(event) {
  if (event && event.preventDefault) event.preventDefault();
  const form = document.getElementById("profileEditForm");
  if (!form) return;
  saveProfileEdit({ preventDefault() {}, target: form, currentTarget: form });
}

// ============ PERFIL: PESTAÑAS ============
function showProfileTab(tabName, btn) {
  document.querySelectorAll("#profileEditModal .profile-tab-panel").forEach(p => {
    p.hidden = p.id !== "profileTab-" + tabName;
  });
  document.querySelectorAll("#profileEditModal .tab-btn").forEach(b => {
    b.classList.toggle("is-active", btn ? b === btn : b.dataset.tab === tabName);
  });

  if (tabName === "partidos") loadProfileMatches();
  else if (tabName === "pendientes") loadProfilePendingResults();
  else if (tabName === "reportar") initProfileResultForm();
}

async function loadProfileMatches() {
  const container = document.getElementById("profileMatchesList");
  if (!container || !currentUser) return;
  const player = players.find(p => p && p.userId === currentUser.id);
  if (!player) {
    container.innerHTML = '<p class="empty-note">Crea tu perfil de jugador para ver tus partidos asignados.</p>';
    return;
  }
  container.innerHTML = '<p class="empty-note">Cargando partidos…</p>';
  try {
    const data = await api("/api/tournament");
    const list = (data.tournaments || []).flatMap(t => {
      const matches = (t.matches || []).filter(m =>
        m.playerAId === player.id || m.playerBId === player.id);
      return matches.map(m => ({ ...m, tournament: t.title || t.month || "Torneo" }));
    });
    if (!list.length) {
      container.innerHTML = '<p class="empty-note">No tienes partidos asignados en ningún torneo.</p>';
      return;
    }
    container.innerHTML = list.map(m => `
      <div class="profile-card">
        <div class="profile-card-title">
          <b>${escapeHtml(m.tournament)}</b>
          <span class="tag">${escapeHtml(m.status || "-")}</span>
        </div>
        <p class="muted" style="margin-top:4px;">Ronda: ${escapeHtml(m.round || "-")}</p>
        <div class="result-players" style="margin-top:8px;">
          <div class="result-player ${m.winnerId && m.winnerId === m.playerAId ? "is-winner" : ""}"><b>${escapeHtml(m.playerAName || "Jugador A")}</b></div>
          <span class="result-vs">vs</span>
          <div class="result-player ${m.winnerId && m.winnerId === m.playerBId ? "is-winner" : ""}"><b>${escapeHtml(m.playerBName || "Jugador B")}</b></div>
        </div>
        ${m.score ? `<p class="muted" style="margin-top:8px;">Resultado: <b>${escapeHtml(m.score)}</b></p>` : ""}
      </div>
    `).join("");
  } catch (error) {
    container.innerHTML = `<p class="empty-note">No se pudieron cargar los partidos: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadProfilePendingResults() {
  const container = document.getElementById("profilePendingList");
  if (!container || !currentUser) return;
  container.innerHTML = '<p class="empty-note">Cargando resultados pendientes…</p>';
  try {
    const results = await api("/api/results");
    const pending = results.filter(r =>
      r.status === "pending" &&
      (r.winnerUserId === currentUser.id || r.loserUserId === currentUser.id) &&
      r.reportedBy !== currentUser.id);
    if (!pending.length) {
      container.innerHTML = '<p class="empty-note">No tienes resultados pendientes de confirmar. 👍</p>';
      return;
    }
    container.innerHTML = pending.map(r => {
      const isWinner = r.winnerUserId === currentUser.id;
      const rival = isWinner ? (r.loserName || "Jugador") : (r.winnerName || "Jugador");
      return `
        <div class="profile-card">
          <div class="profile-card-title">
            <b>${escapeHtml(r.categoryLabel || r.category || "Partido")}</b>
            <span class="muted">${formatLocalDate(r.created)}</span>
          </div>
          <p class="muted">Marcador reportado: <b>${escapeHtml(r.score || "-")}</b></p>
          <p style="text-align:center; font-weight:800; margin:8px 0 2px;">Tú vs ${escapeHtml(rival)}</p>
          <div class="profile-card-actions">
            ${r.reportedBy === currentUser.id && r.status === "pending"
              ? `<button class="btn btn-sm btn-danger" onclick="deleteOwnResult('${escapeHtml(r.id)}')">Eliminar</button>`
              : `<button class="btn btn-sm btn-primary" onclick="respondProfilePending('${escapeHtml(r.id)}', 'confirm')">Confirmar ✓</button>
                 <button class="btn btn-sm btn-secondary" onclick="respondProfilePending('${escapeHtml(r.id)}', 'dispute')">Disputar</button>`}
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    container.innerHTML = `<p class="empty-note">No se pudieron cargar: ${escapeHtml(error.message)}</p>`;
  }
}

async function respondProfilePending(resultId, action) {
  if (!confirm(action === "confirm" ? "¿Confirmar este resultado?" : "¿Disputar este resultado?")) return;
  try {
    await api("/api/results", {
      method: "PATCH",
      body: JSON.stringify({ resultId, action })
    });
    showToast(action === "confirm" ? "Resultado confirmado." : "Resultado disputado.");
    loadProfilePendingResults();
  } catch (error) {
    showToast(`No se pudo responder: ${error.message}`);
  }
}

async function deleteOwnResult(resultId) {
  if (!window.confirm("¿Eliminar este resultado? Solo se puede eliminar mientras esté pendiente.")) return;
  try {
    await api("/api/results", {
      method: "DELETE",
      body: JSON.stringify({ resultId })
    });
    loadProfilePendingResults();
    if (typeof loadResults === "function") await loadResults();
    showToast("Resultado eliminado.");
  } catch (error) {
    showToast(`No se pudo eliminar el resultado: ${error.message}`);
  }
}

async function initProfileResultForm() {
  const form = document.getElementById("profileResultForm");
  if (!form) return;
  try {
    if (!players || players.length === 0) {
      players = await api("/api/players");
    }
  } catch { /* no bloquear */ }
  const player = players.find(p => p && p.userId === currentUser.id);
  const isMember = currentUser.role === "member" || currentUser.membershipActive === true;
  if (!player && !isMember) {
    document.getElementById("profileResultNotice").textContent = "Crea tu perfil de jugador primero.";
    return;
  }
  document.getElementById("profileResultNotice").textContent = "";
  if (!form.elements.namedItem("date").value) form.elements.namedItem("date").value = new Date().toISOString().slice(0, 10);
  const tournamentSelect = form.elements.namedItem("tournamentId");
  const matchSelect = form.elements.namedItem("matchId");
  profileResultPlayers = null;
  const cascade = setupResultCascade({
    tournamentSelect,
    matchSelect,
    nameA: document.getElementById("profilePlayerAName"),
    nameB: document.getElementById("profilePlayerBName"),
    manualWrap: document.getElementById("profileManualPlayers"),
    manualA: form.elements.namedItem("winnerA"),
    manualB: form.elements.namedItem("loserB"),
    hiddenWinner: document.getElementById("profileWinnerHidden"),
    hiddenLoser: document.getElementById("profileLoserHidden"),
    onPlayers(payload) {
      profileResultPlayers = payload;
      if (profileResultEditor) profileResultEditor.setNames(payload.playerAName, payload.playerBName);
    }
  });
  profileResultCascade = cascade;
  profileResultEditor = mountResultEditor(form, "profileScoreEditor");
  const manualA = form.elements.namedItem("winnerA");
  const manualB = form.elements.namedItem("loserB");
  const hiddenWinner = document.getElementById("profileWinnerHidden");
  const hiddenLoser = document.getElementById("profileLoserHidden");
  const syncManual = () => {
    profileResultPlayers = null;
    if (hiddenWinner) hiddenWinner.value = manualA ? manualA.value : "";
    if (hiddenLoser) hiddenLoser.value = manualB ? manualB.value : "";
    if (profileResultEditor && manualA && manualB && manualA.value && manualB.value) {
      const aName = manualA.options[manualA.selectedIndex]?.textContent || "Jugador A";
      const bName = manualB.options[manualB.selectedIndex]?.textContent || "Jugador B";
      const aEl = document.getElementById("profilePlayerAName");
      const bEl = document.getElementById("profilePlayerBName");
      if (aEl) aEl.textContent = aName;
      if (bEl) bEl.textContent = bName;
      profileResultEditor.setNames(aName, bName);
    }
  };
  if (manualA) manualA.onchange = syncManual;
  if (manualB) manualB.onchange = syncManual;
  // Torneos: misma fuente y cascada que la página principal.
  const tournamentsData = await loadResultTournaments();
  cascade.setTournaments(tournamentsData);
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
  document.getElementById("profileEditForm")?.addEventListener("submit", saveProfileEdit);
  document.getElementById("profileResultForm")?.addEventListener("submit", async function(event) {
    event.preventDefault();
    const form = event.target;
    const notice = document.getElementById("profileResultNotice");
    const selectedMatchId = form.elements.namedItem("matchId")?.value;
    const selectedTournamentId = form.elements.namedItem("tournamentId")?.value;
    if (selectedMatchId && profileResultCascade) {
      try { profileResultCascade.applyMatch(selectedMatchId, selectedTournamentId || ""); } catch { /* ignore */ }
    }
    let playerAId = document.getElementById("profileWinnerHidden")?.value || "";
    let playerBId = document.getElementById("profileLoserHidden")?.value || "";
    if (!profileResultPlayers) {
      const manualA = form.elements.namedItem("winnerA");
      const manualB = form.elements.namedItem("loserB");
      if (manualA && manualB && manualA.value && manualB.value) { playerAId = manualA.value; playerBId = manualB.value; }
    }
    if (profileResultPlayers) { playerAId = profileResultPlayers.playerAId; playerBId = profileResultPlayers.playerBId; }
    if (!playerAId || !playerBId || playerAId === playerBId) {
      if (notice) notice.textContent = "Elige el partido (sus 2 jugadores se colocan solos) o selecciona Jugador A y Jugador B.";
      return;
    }
    const check = profileResultEditor ? profileResultEditor.validate() : { ok: false, error: "Ingresa el marcador completo (mínimo 2 sets)." };
    if (!check.ok) {
      if (notice) notice.textContent = check.error;
      return;
    }
    const winnerId = check.winnerIndex === 0 ? playerAId : playerBId;
    const loserId = check.winnerIndex === 0 ? playerBId : playerAId;
    try {
      await api("/api/results", {
        method: "POST",
        body: JSON.stringify({
          winnerId,
          loserId,
          category: form.elements.namedItem("category").value,
          tournamentId: form.elements.namedItem("tournamentId").value || null,
          matchId: form.elements.namedItem("matchId").value || null,
          score: profileResultEditor.score(),
          playedAt: form.elements.namedItem("date").value
        })
      });
      form.reset();
      if (profileResultEditor) { profileResultEditor.setSets([]); profileResultEditor.setNames("Jugador A", "Jugador B"); }
      profileResultPlayers = null;
      const pNameA = document.getElementById("profilePlayerAName");
      const pNameB = document.getElementById("profilePlayerBName");
      if (pNameA) pNameA.textContent = "—";
      if (pNameB) pNameB.textContent = "—";
      const phw = document.getElementById("profileWinnerHidden");
      const phl = document.getElementById("profileLoserHidden");
      if (phw) phw.value = "";
      if (phl) phl.value = "";
      if (notice) notice.textContent = "Resultado enviado ✓";
      showToast("Resultado enviado; el rival debe confirmarlo para actualizar el ranking.");
      try { await loadProfilePendingResults(); } catch { /* ignore */ }
      await loadTournaments();
      showProfileTab("datos");
    } catch (error) {
      if (notice) notice.textContent = error.message;
    }
  });
  document.getElementById("profileResultResetBtn")?.addEventListener("click", () => {
    const form = document.getElementById("profileResultForm");
    if (form) form.reset();
    const notice = document.getElementById("profileResultNotice");
    if (notice) notice.textContent = "";
  });

  syncHeaderLayout();
  HEADER_MOBILE_MEDIA.addEventListener("change", syncHeaderLayout);
  await loadWhatsAppSettings();
  initWhatsAppPromos();

  const nav = document.getElementById("nav");
  nav?.addEventListener("click", event => {
    if (event.target.closest("a")) closeNavMenu();
  });
  window.matchMedia("(max-width: 1080px)").addEventListener("change", event => {
    if (!event.matches) closeNavMenu();
  });

  if (!isAdminPage && !isStorePage) handlePaymentReturn();
  await checkAuth();
  await loadCountries();
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

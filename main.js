// League Tennis Aventura — Web Frontend
// Stripe integration + modals + ranking

const STRIPE_PUBLISHABLE_KEY = "pk_test_REPLACE_WITH_YOUR_KEY";

let stripe = null;
let cardElement = null;
let currentAmount = 0;
let currentDescription = "";

// Demo players
const demoPlayers = [
  { name: "Diego M.", level: "4.0", zone: "Aventura / Sunny Isles", matches: 18, points: 1800 },
  { name: "Andrii K.", level: "4.0", zone: "Downtown / Brickell", matches: 16, points: 1600 },
  { name: "Carlos R.", level: "3.5", zone: "North Miami / Miami Gardens", matches: 14, points: 1400 },
  { name: "Mateo P.", level: "3.5", zone: "Aventura / Sunny Isles", matches: 12, points: 1200 },
  { name: "Alex G.", level: "4.5", zone: "Kendall / Doral", matches: 11, points: 1100 },
  { name: "Luis F.", level: "3.0", zone: "Downtown / Brickell", matches: 9, points: 900 }
];

let extraPlayers = [];
try { extraPlayers = JSON.parse(localStorage.getItem("ltaPlayers") || "[]"); } catch (e) {}

// ============ MENU ============
function toggleMenu() {
  document.getElementById("nav").classList.toggle("open");
}

// ============ SCROLL ============
function scrollTo(sel) {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

// ============ MODALS ============
function openModal(id) {
  const m = document.getElementById(id);
  m.classList.add("open");
  document.body.style.overflow = "hidden";
  if (id === "stripeModal") initStripe();
}

function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.remove("open");
  document.body.style.overflow = "";
  if (id === "stripeModal") destroyStripe();
}

document.querySelectorAll(".modal").forEach(function(m) {
  m.addEventListener("click", function(e) {
    if (e.target === m) {
      m.classList.remove("open");
      document.body.style.overflow = "";
      if (m.id === "stripeModal") destroyStripe();
    }
  });
});

// ============ RANKING ============
function renderPlayers() {
  var level = document.getElementById("levelFilter").value;
  var zone = document.getElementById("zoneFilter").value;
  var q = document.getElementById("searchPlayer").value.toLowerCase();
  var players = demoPlayers.concat(extraPlayers).filter(function(p) {
    return (!level || p.level === level) && (!zone || p.zone === zone) && p.name.toLowerCase().includes(q);
  }).sort(function(a, b) { return b.points - a.points });

  var html = players.map(function(p, i) {
    var initials = p.name.split(" ").map(function(x) { return x[0]; }).join("").slice(0, 2);
    return '<tr><td><b>' + (i + 1) + '</b></td><td><div class="player"><div class="avatar">' + initials + '</div>' + p.name + '</div></td><td>' + p.level + '</td><td>' + p.zone + '</td><td>' + p.matches + '</td><td><b>' + p.points.toLocaleString("en-US") + '</b></td></tr>';
  }).join("") || '<tr><td colspan="6">No hay jugadores con esos filtros.</td></tr>';

  document.getElementById("rankingBody").innerHTML = html;
}

// ============ FORM HANDLERS ============
var photoData = "";

document.addEventListener("DOMContentLoaded", function() {
  renderPlayers();

  var pf = document.getElementById("profilePhoto");
  if (pf) {
    pf.addEventListener("change", function(e) {
      var f = e.target.files[0];
      if (!f) { photoData = ""; return; }
      var r = new FileReader();
      r.onload = function() { photoData = r.result; };
      r.readAsDataURL(f);
    });
  }

  // Register form
  var rf = document.getElementById("registerForm");
  if (rf) {
    rf.addEventListener("submit", function(e) {
      e.preventDefault();
      var d = Object.fromEntries(new FormData(e.target).entries());
      var p = { name: d.name, level: d.level, zone: d.zone, matches: 0, points: 0, photo: photoData };
      extraPlayers.push(p);
      try { localStorage.setItem("ltaPlayers", JSON.stringify(extraPlayers)); } catch (err) {}
      renderPlayers();
      var n = document.getElementById("notice");
      n.classList.add("show");
      n.textContent = "Perfil creado. Se agregó al ranking (demo local).";
      e.target.reset();
      photoData = "";
    });
  }

  // Tournament form
  var tf = document.getElementById("tournamentForm");
  if (tf) {
    tf.addEventListener("submit", function(e) {
      e.preventDefault();
      document.getElementById("tournamentNotice").textContent = "Solicitud de demostración registrada.";
      e.target.reset();
    });
  }

  // Result form
  var rf2 = document.getElementById("resultForm");
  if (rf2) {
    rf2.addEventListener("submit", function(e) {
      e.preventDefault();
      document.getElementById("resultNotice").textContent = "Resultado de demostración capturado.";
      e.target.reset();
    });
  }

  // Challenge form
  var cf = document.getElementById("challengeForm");
  if (cf) {
    cf.addEventListener("submit", function(e) {
      e.preventDefault();
      document.getElementById("challengeNotice").textContent = "Desafío de demostración preparado.";
      e.target.reset();
    });
  }

  // Stripe form
  var sf = document.getElementById("stripeCheckoutForm");
  if (sf) {
    sf.addEventListener("submit", handleStripeSubmit);
  }

  // Init Stripe
  if (typeof Stripe !== "undefined") {
    stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
  }
});

// ============ STORE ============
function showStoreNotice() {
  alert("Catálogo ilustrativo. Los productos reales se cargarán al configurar la tienda.");
}

// ============ STRIPE PAYMENTS ============
function buyBook(name, amountCents) {
  currentAmount = amountCents;
  currentDescription = name;
  document.getElementById("stripeProductInfo").innerHTML = '<p><b>' + name + '</b></p><p>Pago único: $' + (amountCents / 100).toFixed(2) + ' USD</p>';
  document.getElementById("stripeStatus").textContent = "";
  openModal("stripeModal");
}

function subscribeMembership() {
  currentAmount = 999;
  currentDescription = "League Member - Suscripción mensual";
  document.getElementById("stripeProductInfo").innerHTML = '<p><b>League Member</b></p><p>Suscripción mensual: $9.99 USD/mes</p>';
  document.getElementById("stripeStatus").textContent = "";
  openModal("stripeModal");
}

function initStripe() {
  if (!stripe) stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
  if (cardElement) return;

  var elements = stripe.elements();
  cardElement = elements.create("card", {
    style: {
      base: { fontSize: "16px", color: "#10243a", "::placeholder": { color: "#6d7885" } },
      invalid: { color: "#c95c52" }
    }
  });
  cardElement.mount("#cardElement");
}

function destroyStripe() {
  if (cardElement) { cardElement.destroy(); cardElement = null; }
  currentAmount = 0;
  currentDescription = "";
  document.getElementById("stripeCheckoutForm").reset();
}

async function handleStripeSubmit(e) {
  e.preventDefault();
  var statusEl = document.getElementById("stripeStatus");
  var payBtn = document.getElementById("stripePayBtn");
  var email = document.getElementById("stripeEmail").value;
  var name = document.getElementById("stripeName").value;

  if (!email || !name) {
    statusEl.textContent = "Completa todos los campos.";
    return;
  }

  payBtn.disabled = true;
  statusEl.textContent = "Creando intencion de pago...";

  try {
    // Step 1: Create PaymentIntent via backend
    var isSubscription = currentAmount === 999;
    var endpoint = isSubscription ? "/api/create-subscription" : "/api/create-payment-intent";

    var payload = isSubscription
      ? { email: email }
      : { amount: currentAmount, currency: "usd", description: currentDescription, mode: "payment" };

    var resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    var data = await resp.json();

    if (data.error) {
      statusEl.textContent = "Error: " + data.error;
      payBtn.disabled = false;
      return;
    }

    statusEl.textContent = "Pago creado. Confirma tu tarjeta...";

    // Step 2: Confirm card payment with Stripe.js
    var confirmResult = await stripe.confirmCardPayment(data.clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: { name: name, email: email }
      }
    });

    if (confirmResult.error) {
      statusEl.textContent = "Error: " + confirmResult.error.message;
      payBtn.disabled = false;
      return;
    }

    if (confirmResult.paymentIntent.status === "succeeded") {
      statusEl.textContent = "Pago exitoso!";

      // Log transaction locally
      try {
        var tx = {
          type: isSubscription ? "subscription" : "payment",
          description: currentDescription,
          amount_cents: currentAmount,
          email: email,
          payment_intent_id: confirmResult.paymentIntent.id,
          timestamp: new Date().toISOString(),
          status: "succeeded"
        };
        var txLog = JSON.parse(localStorage.getItem("ltaTransactions") || "[]");
        txLog.push(tx);
        localStorage.setItem("ltaTransactions", JSON.stringify(txLog));

        // Also log to server
        fetch("/api/log-transaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tx)
        }).catch(function() {});
      } catch (err) {}

      setTimeout(function() { closeModal("stripeModal"); }, 2000);
    } else {
      statusEl.textContent = "Estado: " + confirmResult.paymentIntent.status;
      payBtn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = "Error de conexion: " + err.message;
    payBtn.disabled = false;
  }
}

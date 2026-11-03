import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as register } from "../functions/api/auth/register.js";
import { onRequestPost as login } from "../functions/api/auth/login.js";
import { onRequestPost as recover } from "../functions/api/auth/recover.js";
import { onRequestPost as checkout } from "../functions/api/stripe/checkout.js";
import { onRequestGet as verifyCheckout } from "../functions/api/stripe/session/[session_id].js";
import { onRequestPost as adminUsers } from "../functions/api/admin/users.js";
import { onRequestPost as uploadImage } from "../functions/api/admin/uploads.js";
import { onRequestGet as serveUpload } from "../functions/api/uploads/[file].js";
import { onRequestPost as createPlayerProfile } from "../functions/api/players/index.js";
import { onRequestGet as publicSettings } from "../functions/api/settings.js";
import { onRequestGet as readAdminSettings, onRequestPost as saveAdminSettings } from "../functions/api/admin/settings.js";

function createGitHubMock() {
  const files = new Map();
  return {
    files,
    fetch: async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname !== "api.github.com") {
        return Response.json({ message: "Unexpected request" }, { status: 500 });
      }
      const contentPath = url.pathname.match(/\/contents\/data\/(.+)$/);
      if (options.method === "PUT" && contentPath) {
        const body = JSON.parse(options.body);
        files.set(contentPath[1], body.content);
        return Response.json({ ok: true }, { status: 201 });
      }
      if (contentPath) {
        const content = files.get(contentPath[1]);
        if (!content) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({
          sha: `sha-${contentPath[1]}`,
          content
        });
      }
      if (/\/branches\/master$/.test(url.pathname)) return Response.json({ name: "master" });
      if (/\/repos\/test-owner\/test-repo$/.test(url.pathname)) return Response.json({ name: "test-repo" });
      return Response.json({ message: "Unexpected test request" }, { status: 500 });
    }
  };
}

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "test-owner",
  GITHUB_REPO: "test-repo",
  GITHUB_BRANCH: "master",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  ADMIN_EMAIL: "admin@example.com",
  STRIPE_SECRET_KEY: "sk_test_dummy"
};

// PNG transparente de 1x1 pixel en base64.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("donations, account management, uploads, and player categories work end to end", async () => {
  const originalFetch = globalThis.fetch;
  const github = createGitHubMock();
  globalThis.fetch = github.fetch;

  try {
    const registration = await register({
      request: new Request("https://league.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Admin Features",
          email: "admin@example.com",
          password: "a-secure-password"
        })
      }),
      env
    });
    assert.equal(registration.status, 200);
    const adminCookie = registration.headers.get("Set-Cookie").split(";")[0];
    const adminId = (await registration.json()).user.id;

    const adminRequest = (url, method, body) => new Request(url, {
      method,
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    // --- Donación única con Stripe ---
    const donationRequests = [];
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname === "api.stripe.com" && url.pathname === "/v1/checkout/sessions") {
        donationRequests.push(new URLSearchParams(options.body));
        return Response.json({ url: "https://checkout.stripe.test/donation" });
      }
      return github.fetch(input, options);
    };
    const donationResponse = await checkout({
      request: adminRequest("https://league.example/api/stripe/checkout", "POST", {
        donation: { amountCents: 2500, recurring: null }
      }),
      env
    });
    assert.equal(donationResponse.status, 200);
    const donationParams = donationRequests[0];
    assert.equal(donationParams.get("mode"), "payment");
    assert.equal(donationParams.get("line_items[0][price_data][unit_amount]"), "2500");
    assert.equal(donationParams.get("metadata[productId]"), "donacion");
    assert.equal(donationParams.get("metadata[amount]"), "2500");

    const invalidDonation = await checkout({
      request: adminRequest("https://league.example/api/stripe/checkout", "POST", {
        donation: { amountCents: 50, recurring: null }
      }),
      env
    });
    assert.equal(invalidDonation.status, 400);

    // --- Donación mensual ---
    const monthlyResponse = await checkout({
      request: adminRequest("https://league.example/api/stripe/checkout", "POST", {
        donation: { amountCents: 1000, recurring: "month" }
      }),
      env
    });
    assert.equal(monthlyResponse.status, 200);
    assert.equal(donationRequests[1].get("mode"), "subscription");
    assert.equal(donationRequests[1].get("line_items[0][price_data][recurring][interval]"), "month");

    // --- Verificación de donación pagada ---
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname === "api.stripe.com" && url.pathname.endsWith("/checkout/sessions/cs_test_donation")) {
        return Response.json({
          id: "cs_test_donation",
          status: "complete",
          payment_status: "paid",
          mode: "payment",
          amount_total: 2500,
          currency: "usd",
          client_reference_id: adminId,
          metadata: { userId: adminId, productId: "donacion", amount: "2500" }
        });
      }
      return github.fetch(input, options);
    };
    const donationVerification = await verifyCheckout({
      request: new Request("https://league.example/api/stripe/session/cs_test_donation", {
        headers: { Cookie: adminCookie }
      }),
      env,
      params: { session_id: "cs_test_donation" }
    });
    assert.deepEqual(await donationVerification.json(), { status: "paid" });
    const orders = JSON.parse(Buffer.from(github.files.get("orders.json"), "base64").toString("utf8"));
    assert.equal(orders.length, 1);
    assert.equal(orders[0].productName, "Donación");
    assert.equal(orders[0].productId, "donacion");

    // --- Creación de cuenta y restablecimiento de contraseña ---
    globalThis.fetch = github.fetch;
    const createAccount = await adminUsers({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        action: "create",
        name: "Nuevo Jugador",
        email: "Nuevo.Jugador@Example.com",
        password: "initial-pass-123",
        role: "user"
      }),
      env
    });
    assert.equal(createAccount.status, 201);
    const createdUser = (await createAccount.json()).user;
    assert.equal(createdUser.email, "nuevo.jugador@example.com");

    const duplicateAccount = await adminUsers({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        action: "create",
        name: "Duplicado",
        email: "nuevo.jugador@example.com",
        password: "initial-pass-123"
      }),
      env
    });
    assert.equal(duplicateAccount.status, 409);

    const loginOriginal = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nuevo.jugador@example.com", password: "initial-pass-123" })
      }),
      env
    });
    assert.equal(loginOriginal.status, 200);

    const passwordReset = await adminUsers({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        userId: createdUser.id,
        updates: { password: "brand-new-pass-456" }
      }),
      env
    });
    assert.equal(passwordReset.status, 200);

    const loginOldPassword = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nuevo.jugador@example.com", password: "initial-pass-123" })
      }),
      env
    });
    assert.equal(loginOldPassword.status, 401);

    const loginNewPassword = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nuevo.jugador@example.com", password: "brand-new-pass-456" })
      }),
      env
    });
    assert.equal(loginNewPassword.status, 200);

    // --- Subida de imagen al catálogo ---
    const upload = await uploadImage({
      request: adminRequest("https://league.example/api/admin/uploads", "POST", {
        image: `data:image/png;base64,${TINY_PNG}`,
        filename: "Camiseta Liga.png"
      }),
      env
    });
    assert.equal(upload.status, 201);
    const { url: imageUrl } = await upload.json();
    assert.match(imageUrl, /^\/api\/uploads\/\d+-camiseta-liga\.png$/);

    const uploadName = imageUrl.split("/").pop();
    const served = await serveUpload({ env, params: { file: uploadName } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("Content-Type"), "image/png");
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    assert.equal(servedBytes.length, Buffer.from(TINY_PNG, "base64").length);

    const missingUpload = await serveUpload({ env, params: { file: "nope.png" } });
    assert.equal(missingUpload.status, 404);

    const invalidUpload = await uploadImage({
      request: adminRequest("https://league.example/api/admin/uploads", "POST", {
        image: "data:text/html;base64,PGI+aGk8L2I+",
        filename: "tricky.png"
      }),
      env
    });
    assert.equal(invalidUpload.status, 400);

    // --- Categoría y modalidad del jugador ---
    const playerCreation = await createPlayerProfile({
      request: new Request("https://league.example/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({
          name: "Admin Features",
          level: "3.5",
          zone: "Downtown / Brickell",
          category: "dobles_mixtos",
          gender: "mujeres"
        })
      }),
      env
    });
    assert.equal(playerCreation.status, 200);
    const player = await playerCreation.json();
    assert.equal(player.category, "dobles_mixtos");
    assert.equal(player.gender, "mujeres");

    // --- Ajustes del sitio: enlace de WhatsApp ---
    const invalidSettings = await saveAdminSettings({
      request: adminRequest("https://league.example/api/admin/settings", "POST", {
        whatsappUrl: "https://t.me/algo"
      }),
      env
    });
    assert.equal(invalidSettings.status, 400);

    const savedSettings = await saveAdminSettings({
      request: adminRequest("https://league.example/api/admin/settings", "POST", {
        whatsappUrl: "https://chat.whatsapp.com/AbCdEfGhIjK"
      }),
      env
    });
    assert.equal(savedSettings.status, 200);
    assert.equal((await savedSettings.json()).whatsappUrl, "https://chat.whatsapp.com/AbCdEfGhIjK");

    const adminSettingsRead = await readAdminSettings({
      request: adminRequest("https://league.example/api/admin/settings", "GET"),
      env
    });
    assert.equal((await adminSettingsRead.json()).whatsappUrl, "https://chat.whatsapp.com/AbCdEfGhIjK");

    const publicSettingsRead = await publicSettings({ env });
    assert.equal((await publicSettingsRead.json()).whatsappUrl, "https://chat.whatsapp.com/AbCdEfGhIjK");

    const clearedSettings = await saveAdminSettings({
      request: adminRequest("https://league.example/api/admin/settings", "POST", { whatsappUrl: "" }),
      env
    });
    assert.equal((await clearedSettings.json()).whatsappUrl, "");

    // --- Recuperación de contraseña con últimos 4 dígitos del celular ---
    const recoveryAccount = await adminUsers({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        action: "create",
        name: "Jugador Recupera",
        email: "recupera@example.com",
        password: "clave-vieja-123",
        role: "user"
      }),
      env
    });
    assert.equal(recoveryAccount.status, 201);
    const usersNow = JSON.parse(Buffer.from(github.files.get("users.json"), "base64").toString("utf8"));
    const recoverUser = usersNow.find(item => item.email === "recupera@example.com");
    recoverUser.phone = "+1 305 555 0123";
    github.files.set("users.json", Buffer.from(JSON.stringify(usersNow)).toString("base64"));

    const wrongDigits = await recover({
      request: new Request("https://league.example/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recupera@example.com", phoneLast4: "9999", newPassword: "clave-nueva-456" })
      }),
      env
    });
    assert.equal(wrongDigits.status, 401);

    const unknownEmail = await recover({
      request: new Request("https://league.example/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nadie@example.com", phoneLast4: "0123", newPassword: "clave-nueva-456" })
      }),
      env
    });
    assert.equal(unknownEmail.status, 401);

    const shortPassword = await recover({
      request: new Request("https://league.example/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recupera@example.com", phoneLast4: "0123", newPassword: "corta" })
      }),
      env
    });
    assert.equal(shortPassword.status, 400);

    const successfulRecovery = await recover({
      request: new Request("https://league.example/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recupera@example.com", phoneLast4: "0123", newPassword: "clave-nueva-456" })
      }),
      env
    });
    assert.equal(successfulRecovery.status, 200);

    const loginOldAfterRecovery = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recupera@example.com", password: "clave-vieja-123" })
      }),
      env
    });
    assert.equal(loginOldAfterRecovery.status, 401);

    const loginNewAfterRecovery = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "recupera@example.com", password: "clave-nueva-456" })
      }),
      env
    });
    assert.equal(loginNewAfterRecovery.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

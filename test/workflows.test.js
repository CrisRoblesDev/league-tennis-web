import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as register } from "../functions/api/auth/register.js";
import { onRequestPost as login } from "../functions/api/auth/login.js";
import { onRequestPost as checkout } from "../functions/api/stripe/checkout.js";
import { onRequestGet as verifyCheckout } from "../functions/api/stripe/session/[session_id].js";

function createGitHubMock() {
  const files = new Map();
  return {
    files,
    fetch: async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname !== "api.github.com") {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get("mode"), "subscription");
        assert.equal(form.get("line_items[0][price_data][unit_amount]"), "999");
        assert.equal(form.get("metadata[productId]"), "member-1");
        return Response.json({ url: "https://checkout.stripe.test/session" });
      }

      const contentPath = url.pathname.match(/\/contents\/data\/([^/]+)$/);
      if (options.method === "PUT" && contentPath) {
        const body = JSON.parse(options.body);
        files.set(contentPath[1], Buffer.from(body.content, "base64").toString("utf8"));
        return Response.json({ ok: true }, { status: 201 });
      }
      if (contentPath) {
        const file = files.get(contentPath[1]);
        if (!file) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({
          sha: `sha-${contentPath[1]}`,
          content: Buffer.from(file, "utf8").toString("base64")
        });
      }
      if (/\/branches\/master$/.test(url.pathname)) return Response.json({ name: "master" });
      if (/\/repos\/test-owner\/test-repo$/.test(url.pathname)) return Response.json({ name: "test-repo" });
      return Response.json({ message: "Unexpected test request" }, { status: 500 });
    }
  };
}

test("registration, login, Stripe checkout, and payment reconciliation use the configured APIs", async () => {
  const originalFetch = globalThis.fetch;
  const github = createGitHubMock();
  globalThis.fetch = github.fetch;
  const env = {
    GITHUB_TOKEN: "test-token",
    GITHUB_OWNER: "test-owner",
    GITHUB_REPO: "test-repo",
    GITHUB_BRANCH: "master",
    SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
    ADMIN_EMAIL: "admin@example.com",
    STRIPE_SECRET_KEY: "sk_test_dummy"
  };

  try {
    const registration = await register({
      request: new Request("https://league.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Admin Test",
          email: "ADMIN@example.com",
          password: "a-secure-password",
          level: "3.5",
          zone: "Aventura / Sunny Isles"
        })
      }),
      env
    });
    assert.equal(registration.status, 200);
    const createdUser = await registration.json();
    assert.equal(createdUser.user.role, "admin");
    const sessionCookie = registration.headers.get("Set-Cookie").split(";")[0];

    const signIn = await login({
      request: new Request("https://league.example/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "a-secure-password" })
      }),
      env
    });
    assert.equal(signIn.status, 200);
    assert.equal((await signIn.json()).user.id, createdUser.user.id);

    const session = JSON.parse(github.files.get("users.json"));
    assert.match(session[0].password, /^pbkdf2\$/);
    assert.equal(session[0].role, "admin");

    const checkoutRequest = new Request("https://league.example/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ productId: "member-1" })
    });
    const checkoutResponse = await checkout({ request: checkoutRequest, env });
    assert.equal(checkoutResponse.status, 200);

    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname === "api.stripe.com" && url.pathname.endsWith("/checkout/sessions/cs_test_session")) {
        return Response.json({
          id: "cs_test_session",
          payment_status: "paid",
          mode: "subscription",
          amount_total: 999,
          currency: "usd",
          client_reference_id: createdUser.user.id,
          metadata: { userId: createdUser.user.id, productId: "member-1" },
          subscription: "sub_test_active"
        });
      }
      if (url.hostname === "api.stripe.com" && url.pathname.endsWith("/subscriptions/sub_test_active")) {
        return Response.json({ id: "sub_test_active", status: "active" });
      }
      return github.fetch(input, options);
    };

    const verificationRequest = new Request("https://league.example/api/stripe/session/cs_test_session", {
      headers: { Cookie: sessionCookie }
    });
    const firstVerification = await verifyCheckout({
      request: verificationRequest,
      env,
      params: { session_id: "cs_test_session" }
    });
    assert.deepEqual(await firstVerification.json(), { status: "paid" });

    const secondVerification = await verifyCheckout({
      request: verificationRequest,
      env,
      params: { session_id: "cs_test_session" }
    });
    assert.deepEqual(await secondVerification.json(), { status: "paid" });

    const orders = JSON.parse(github.files.get("orders.json"));
    const subscriptions = JSON.parse(github.files.get("subscriptions.json"));
    const users = JSON.parse(github.files.get("users.json"));
    assert.equal(orders.length, 1);
    assert.equal(subscriptions.length, 1);
    assert.equal(users[0].membershipActive, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

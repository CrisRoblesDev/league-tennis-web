import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as register } from "../functions/api/auth/register.js";
import { onRequestPost as login } from "../functions/api/auth/login.js";
import { onRequestPost as checkout } from "../functions/api/stripe/checkout.js";
import { onRequestGet as verifyCheckout } from "../functions/api/stripe/session/[session_id].js";
import { onRequestPost as createTournament, onRequestGet as listAdminTournaments } from "../functions/api/admin/tournaments.js";
import { onRequestPut as updateTournament } from "../functions/api/admin/tournaments/[id].js";
import { onRequestPatch as moderateResult } from "../functions/api/admin/results.js";
import { onRequestGet as listPublicTournaments } from "../functions/api/tournament/index.js";
import { onRequestPost as updateAdminUser } from "../functions/api/admin/users.js";

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

    const invalidKeyResponse = await checkout({
      request: checkoutRequest,
      env: { ...env, STRIPE_SECRET_KEY: "pk_test_not_a_secret" }
    });
    assert.equal(invalidKeyResponse.status, 503);
    assert.match((await invalidKeyResponse.json()).error, /clave secreta sandbox sk_test_/);
    const restrictedSandboxResponse = await checkout({
      request: new Request(checkoutRequest.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ productId: "member-1" })
      }),
      env: { ...env, STRIPE_SECRET_KEY: "rk_test_restricted_dummy" }
    });
    assert.equal(restrictedSandboxResponse.status, 200);

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

    const adminRequest = (url, method, body) => new Request(url, {
      method,
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const adminUserUpdate = await updateAdminUser({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        userId: createdUser.user.id,
        updates: {
          role: "admin",
          level: "4.0",
          zone: "Downtown / Brickell",
          membershipActive: true
        }
      }),
      env
    });
    assert.equal(adminUserUpdate.status, 200);
    const selfDemotion = await updateAdminUser({
      request: adminRequest("https://league.example/api/admin/users", "POST", {
        userId: createdUser.user.id,
        updates: { role: "user" }
      }),
      env
    });
    assert.equal(selfDemotion.status, 409);

    const invalidTournamentResponse = await createTournament({
      request: adminRequest("https://league.example/api/admin/tournaments", "POST", {
        title: "Bad date",
        month: "2026-13",
        levels: ["3.5"],
        status: "registration"
      }),
      env
    });
    assert.equal(invalidTournamentResponse.status, 400);
    const tournamentResponse = await createTournament({
      request: adminRequest("https://league.example/api/admin/tournaments", "POST", {
        title: "Test Cup",
        month: new Date().toISOString().slice(0, 7),
        levels: ["3.5"],
        status: "registration",
        startDate: "",
        endDate: "",
        venue: "Aventura",
        format: "Best of 3"
      }),
      env
    });
    assert.equal(tournamentResponse.status, 201);
    const { tournament } = await tournamentResponse.json();
    github.files.set("players.json", JSON.stringify([
      { id: "player-a", name: "Player A", level: "3.5" },
      { id: "player-b", name: "Player B", level: "3.5" }
    ]));
    const storedTournaments = JSON.parse(github.files.get("tournaments.json"));
    storedTournaments[0].entries = [{ playerId: "player-a" }, { playerId: "player-b" }];
    github.files.set("tournaments.json", JSON.stringify(storedTournaments));
    const scheduleResponse = await updateTournament({
      request: adminRequest(`https://league.example/api/admin/tournaments/${tournament.id}`, "PUT", {
        match: {
          playerAId: "player-a",
          playerBId: "player-b",
          round: "Final",
          date: "2026-07-12",
          court: "Court 1",
          status: "scheduled"
        }
      }),
      env,
      params: { id: tournament.id }
    });
    assert.equal(scheduleResponse.status, 200);
    const savedMatch = (await scheduleResponse.json()).tournament.matches[0];
    const invalidMatchUpdate = await updateTournament({
      request: adminRequest(`https://league.example/api/admin/tournaments/${tournament.id}`, "PUT", {
        match: {
          id: savedMatch.id,
          playerAId: "player-a",
          playerBId: "player-b",
          round: "Final",
          date: "2026-07-12",
          court: "Court 1",
          status: "completed",
          winnerId: "player-b",
          score: "6-4, 4-6, 10-7"
        }
      }),
      env,
      params: { id: tournament.id }
    });
    assert.equal(invalidMatchUpdate.status, 400);
    const completedMatchResponse = await updateTournament({
      request: adminRequest(`https://league.example/api/admin/tournaments/${tournament.id}`, "PUT", {
        match: {
          id: savedMatch.id,
          playerAId: "player-a",
          playerBId: "player-b",
          round: "Final",
          date: "2026-07-12",
          court: "Court 1",
          status: "completed",
          winnerId: "player-b",
          score: "4-6, 6-4, 7-10"
        }
      }),
      env,
      params: { id: tournament.id }
    });
    assert.equal(completedMatchResponse.status, 200);
    assert.equal((await completedMatchResponse.json()).tournament.matches.length, 1);
    const publicTournamentResponse = await listPublicTournaments({ env });
    const publicData = await publicTournamentResponse.json();
    assert.equal(publicData.tournaments[0].entries.length, 2);
    assert.equal(publicData.tournaments[0].matches[0].playerAName, "Player A");
    const adminTournamentResponse = await listAdminTournaments({
      request: adminRequest("https://league.example/api/admin/tournaments", "GET"),
      env
    });
    assert.equal(adminTournamentResponse.status, 200);

    github.files.set("results.json", JSON.stringify([{
      id: "result-test",
      winnerId: "player-a",
      loserId: "player-b",
      status: "disputed"
    }]));
    const moderationResponse = await moderateResult({
      request: adminRequest("https://league.example/api/admin/results", "PATCH", {
        resultId: "result-test",
        action: "confirm"
      }),
      env
    });
    assert.equal(moderationResponse.status, 200);
    assert.equal(JSON.parse(github.files.get("results.json"))[0].status, "confirmed");

    const unauthorizedResponse = await createTournament({
      request: new Request("https://league.example/api/admin/tournaments", { method: "POST" }),
      env
    });
    assert.equal(unauthorizedResponse.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

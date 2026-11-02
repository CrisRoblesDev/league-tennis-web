import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as register } from "../functions/api/auth/register.js";

function createGitHubMock() {
  const files = new Map();
  return {
    files,
    fetch: async (input, options = {}) => {
      const url = new URL(input);
      const contentPath = url.pathname.match(/\/contents\/data\/([^/]+)$/);
      if (url.hostname === "api.github.com") {
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

test("registration stores the phone number and returns it in the session user", async () => {
  const originalFetch = globalThis.fetch;
  const github = createGitHubMock();
  globalThis.fetch = github.fetch;
  try {
    const registration = await register({
      request: new Request("https://league.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tenista Test",
          email: "tenista@example.com",
          password: "a-secure-password",
          phone: "+1 (305) 555-0142",
          level: "3.5",
          zone: "Aventura / Sunny Isles"
        })
      }),
      env
    });
    assert.equal(registration.status, 200);
    const createdUser = await registration.json();
    assert.equal(createdUser.user.phone, "+1 (305) 555-0142");
    const users = JSON.parse(github.files.get("users.json"));
    assert.equal(users[0].phone, "+1 (305) 555-0142");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registration rejects a phone number without enough digits", async () => {
  const originalFetch = globalThis.fetch;
  const github = createGitHubMock();
  globalThis.fetch = github.fetch;
  try {
    const registration = await register({
      request: new Request("https://league.example/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tenista Invalida",
          email: "tenista-invalida@example.com",
          password: "a-secure-password",
          phone: "abc",
          level: "",
          zone: ""
        })
      }),
      env
    });
    assert.equal(registration.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

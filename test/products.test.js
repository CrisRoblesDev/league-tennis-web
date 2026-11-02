import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as createProduct } from "../functions/api/products/index.js";
import { onRequestPut as updateProduct } from "../functions/api/products/[id].js";
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

test("admin product creation stores the image and updates it later", async () => {
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
          name: "Admin Producto",
          email: "admin@example.com",
          password: "a-secure-password"
        })
      }),
      env
    });
    const sessionCookie = registration.headers.get("Set-Cookie").split(";")[0];
    const adminRequest = (url, method, body) => new Request(url, {
      method,
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const createResponse = await createProduct({
      request: adminRequest("https://league.example/api/products", "POST", {
        name: "Servicio de entrenamiento",
        price: 1500,
        type: "digital",
        image: "https://cdn.leaguetenis.example/entrenamiento.jpg",
        description: "Sesión de entrenamiento online"
      }),
      env
    });
    assert.equal(createResponse.status, 200);
    const product = await createResponse.json();
    assert.equal(product.image, "https://cdn.leaguetenis.example/entrenamiento.jpg");

    const updateResponse = await updateProduct({
      request: adminRequest("https://league.example/api/products/book-1", "PUT", {
        image: "https://cdn.leaguetenis.example/nueva-imagen.jpg"
      }),
      env,
      params: { id: "book-1" }
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.image, "https://cdn.leaguetenis.example/nueva-imagen.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

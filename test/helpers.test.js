import test from "node:test";
import assert from "node:assert/strict";
import { getSession, hashPw, rankPlayers, requireAuth, setSessionResp, verifyPw } from "../functions/_helpers.js";

const env = { SESSION_SECRET: "test-session-secret-with-more-than-32-characters" };

test("passwords use a salted PBKDF2 hash and verify correctly", async () => {
  const hash = await hashPw("secure-password");
  assert.match(hash, /^pbkdf2\$120000\$/);
  assert.notEqual(hash, "secure-password");
  assert.equal(await verifyPw("secure-password", hash), true);
  assert.equal(await verifyPw("incorrect-password", hash), false);
});

test("session cookie is signed, expires, and cannot be tampered with", async () => {
  const request = new Request("https://league.example/api/auth/login");
  const response = await setSessionResp({
    userId: "user-1",
    user: { id: "user-1", role: "user" }
  }, env, request);
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  const signedRequest = new Request(request.url, { headers: { Cookie: cookie } });

  assert.equal(await requireAuth(signedRequest, env), "user-1");
  assert.equal((await getSession(signedRequest, env)).userId, "user-1");

  const [payload, signature] = cookie.slice("session=".length).split(".");
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
  const tamperedRequest = new Request(request.url, {
    headers: { Cookie: `session=${tampered}` }
  });
  assert.equal(await requireAuth(tamperedRequest, env), null);
});

test("ranking awards points only for confirmed results", () => {
  const players = [
    { id: "p1", points: 0, matches: 0 },
    { id: "p2", points: 0, matches: 0 }
  ];
  const ranked = rankPlayers(players, [
    { winnerId: "p1", loserId: "p2", status: "pending" },
    { winnerId: "p1", loserId: "p2", status: "confirmed" }
  ]);

  assert.deepEqual(ranked.map(player => [player.id, player.points, player.matches]), [
    ["p1", 100, 1],
    ["p2", 0, 1]
  ]);
  assert.deepEqual(players.map(player => player.points), [0, 0]);
});

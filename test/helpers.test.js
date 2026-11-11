import test from "node:test";
import assert from "node:assert/strict";
import {
  getSession,
  hashPw,
  rankPlayers,
  requireAuth,
  setSessionResp,
  validateMatchScore,
  verifyPw
} from "../functions/_helpers.js";

const env = { SESSION_SECRET: "test-session-secret-with-more-than-32-characters" };

test("passwords use a salted PBKDF2 hash and verify correctly", async () => {
  const hash = await hashPw("secure-password");
  assert.match(hash, /^pbkdf2\$100000\$/);
  assert.notEqual(hash, "secure-password");
  assert.equal(await verifyPw("secure-password", hash), true);
  assert.equal(await verifyPw("incorrect-password", hash), false);
  assert.equal(await verifyPw("secure-password", hash.replace("$100000$", "$120000$")), false);
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
  const tampered = `${payload}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
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
    ["p1", 1, 1],
    ["p2", 0, 1]
  ]);
  assert.deepEqual(players.map(player => player.points), [0, 0]);
});

test("match scores must be complete and the selected winner must win two sets", () => {
  assert.deepEqual(validateMatchScore("6-4, 4-6, 10-7"), {
    setWinners: [0, 1, 0],
    winnerIndex: 0
  });
  assert.equal(validateMatchScore("7-5, 7-6")?.winnerIndex, 0);
  assert.equal(validateMatchScore("6-4, 6-2")?.winnerIndex, 0);
  assert.equal(validateMatchScore("6-4, 6-2, 10-7"), null);
  assert.equal(validateMatchScore("6-4, 4-6, 10-9"), null);
  assert.equal(validateMatchScore("8-6, 3-6, 10-7"), null);
});

test("match scores accept 2 to 5 sets with majority winner", () => {
  // 4 sets, winner 3-1
  assert.deepEqual(validateMatchScore("6-4, 4-6, 6-4, 6-4"), {
    setWinners: [0, 1, 0, 0],
    winnerIndex: 0
  });
  // 5 sets, winner 3-2
  assert.deepEqual(validateMatchScore("6-4, 4-6, 6-4, 4-6, 7-5"), {
    setWinners: [0, 1, 0, 1, 0],
    winnerIndex: 0
  });
  // 4 sets, winner B wins 3-1
  assert.equal(validateMatchScore("4-6, 6-4, 4-6, 4-6")?.winnerIndex, 1);
  // Too few sets
  assert.equal(validateMatchScore("6-4"), null);
  // Too many sets
  assert.equal(validateMatchScore("6-4, 4-6, 6-4, 4-6, 6-4, 6-4"), null);
  // No extra sets after match decided (4-set match already decided 3-0 in set 3)
  assert.equal(validateMatchScore("6-4, 6-4, 6-4, 6-2"), null);
  // Tie not allowed
  assert.equal(validateMatchScore("6-4, 6-4, 6-6"), null);
});

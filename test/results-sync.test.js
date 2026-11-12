import test from "node:test";
import assert from "node:assert/strict";
import {
  syncTournamentMatch,
  validateMatchScore
} from "../functions/_helpers.js";
import { onRequestPatch as patchResults } from "../functions/api/results.js";
import { onRequestPatch as patchAdminResults } from "../functions/api/admin/results.js";

function githubMock(seed) {
  const files = new Map(Object.entries(seed).map(([name, value]) => [name, JSON.stringify(value)]));
  return {
    files,
    fetch: async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname !== "api.github.com") return Response.json({ message: "Unexpected request" }, { status: 500 });
      const match = url.pathname.match(/\/contents\/data\/([^/]+)$/);
      if (!match) {
        // Repository / branch lookups that gRead does on 404.
        if (url.pathname.match(/\/repos\/[^/]+\/[^/]+\/?$/)) return Response.json({ name: "test-repo" });
        if (url.pathname.match(/\/repos\/[^/]+\/[^/]+\/branches\//)) return Response.json({ name: "master" });
        return Response.json({ message: "Unexpected request" }, { status: 500 });
      }
      const name = match[1];
      if (options.method === "PUT") {
        const body = JSON.parse(options.body);
        files.set(name, Buffer.from(body.content, "base64").toString("utf8"));
        return Response.json({ ok: true }, { status: 200 });
      }
      const value = files.get(name);
      if (!value) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({ sha: `sha-${name}`, content: Buffer.from(value).toString("base64") });
    }
  };
}

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "test-owner",
  GITHUB_REPO: "test-repo",
  GITHUB_BRANCH: "master",
  SESSION_SECRET: "results-sync-test-session-secret-32-chars",
  ADMIN_EMAIL: "admin@example.com"
};

function seedData() {
  const players = [
    { id: "p1", userId: "u1", name: "Jugador A", level: "3.5", matches: 0, points: 0 },
    { id: "p2", userId: "u2", name: "Jugador B", level: "3.5", matches: 0, points: 0 }
  ];
  const referenceTournament = {
    id: "ref-t1",
    name: "Torneo Referencia",
    month: "2026-11",
    status: "en proceso",
    matches: [
      {
        id: "m1",
        stageId: "groups",
        round: "Jornada 1",
        a: "u1",
        b: "u2",
        playerAId: "p1",
        playerBId: "p2",
        status: "scheduled",
        sa: null,
        sb: null,
        score: ""
      }
    ]
  };
  const adminTournament = {
    id: "ref-t1",
    name: "Torneo Referencia",
    month: "2026-11",
    status: "en proceso",
    matches: [
      {
        id: "m1",
        stageId: "groups",
        round: "Jornada 1",
        playerAId: "p1",
        playerBId: "p2",
        status: "scheduled",
        winnerId: null,
        score: ""
      }
    ]
  };
  return {
    "users.json": [{ id: "admin-1", name: "Admin", email: "admin@example.com", password: "hash", role: "admin" },
                   { id: "u1", name: "Jugador A", email: "a@example.com", password: "hash", role: "user" },
                   { id: "u2", name: "Jugador B", email: "b@example.com", password: "hash", role: "user" }],
    "players.json": players,
    "tournaments.json": [adminTournament],
    "tournaments-reference.json": [referenceTournament],
    "challenges.json": [],
    "results.json": [],
    "ranking2026.json": []
  };
}

async function setAdminSession(env, userId) {
  const { setSessionResp } = await import("../functions/_helpers.js");
  const session = await setSessionResp({ userId, user: { id: userId, role: "admin" } }, env, new Request("https://league.example"));
  const cookie = session.headers.get("Set-Cookie").split(";")[0];
  return { cookie, session };
}

async function setUserSession(env, userId) {
  const { setSessionResp } = await import("../functions/_helpers.js");
  const session = await setSessionResp({ userId, user: { id: userId, role: "user" } }, env, new Request("https://league.example"));
  const cookie = session.headers.get("Set-Cookie").split(";")[0];
  return { cookie, session };
}

test("syncTournamentMatch paints sa/sb/score on tournamentsReference when a result is confirmed", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedData());
  globalThis.fetch = github.fetch;
  try {
    const result = {
      id: "result-1",
      status: "confirmed",
      matchId: "m1",
      tournamentId: "ref-t1",
      winnerId: "p1",
      loserId: "p2",
      score: "6-4, 6-2"
    };
    await syncTournamentMatch(env, result);

    const ref = JSON.parse(github.files.get("tournaments-reference.json"));

    const refMatch = ref[0].matches.find(m => m.id === "m1");
    assert.equal(refMatch.sa, 2);
    assert.equal(refMatch.sb, 0);
    assert.equal(refMatch.score, "6-4, 6-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("syncTournamentMatch does nothing when result is pending (not confirmed)", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedData());
  globalThis.fetch = github.fetch;
  try {
    const result = {
      id: "result-1",
      status: "pending",
      matchId: "m1",
      tournamentId: "ref-t1",
      winnerId: "p1",
      loserId: "p2",
      score: "6-4, 6-2"
    };
    await syncTournamentMatch(env, result);

    const ref = JSON.parse(github.files.get("tournaments-reference.json"));

    const refMatch = ref[0].matches.find(m => m.id === "m1");
    assert.equal(refMatch.score, "");
    assert.equal(refMatch.sa, null);
    assert.equal(refMatch.sb, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /api/results confirm triggers syncTournamentMatch (rival confirming principal/profile result)", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedData());
  globalThis.fetch = github.fetch;
  try {
    const { cookie } = await setUserSession(env, "u2");

    const results = JSON.parse(github.files.get("results.json") || "[]");
    results.push({
      id: "result-pending",
      status: "pending",
      matchId: "m1",
      tournamentId: "ref-t1",
      winnerId: "p1",
      loserId: "p2",
      score: "6-4, 6-2",
      reportedBy: "u1",
      created: new Date().toISOString()
    });
    github.files.set("results.json", JSON.stringify(results));

    const response = await patchResults({
      request: new Request("https://league.example/api/results", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ resultId: "result-pending", action: "confirm" })
      }),
      env
    });
    assert.equal(response.status, 200);

    const ref = JSON.parse(github.files.get("tournaments-reference.json"));
    const refMatch = ref[0].matches.find(m => m.id === "m1");
    assert.equal(refMatch.sa, 2);
    assert.equal(refMatch.sb, 0);
    assert.equal(refMatch.score, "6-4, 6-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PATCH /api/admin/results edit triggers syncTournamentMatch (admin confirming directly)", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedData());
  globalThis.fetch = github.fetch;
  try {
    const { cookie } = await setAdminSession(env, "admin-1");

    // Seed a pending result in results.json (admin handler reads results.json via FILES.challenges)
    const results = JSON.parse(github.files.get("results.json") || "[]");
    results.push({
      id: "result-admin",
      status: "pending",
      matchId: "m1",
      tournamentId: "ref-t1",
      winnerId: "p1",
      loserId: "p2",
      score: "0-0, 0-0",
      reportedBy: "u1",
      created: new Date().toISOString()
    });
    github.files.set("results.json", JSON.stringify(results));

    const response = await patchAdminResults({
      request: new Request("https://league.example/api/admin/results", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          action: "edit",
          resultId: "result-admin",
          tournamentId: "ref-t1",
          matchId: "m1",
          winnerId: "p1",
          loserId: "p2",
          score: "6-3, 6-4",
          category: "singles"
        })
      }),
      env
    });
    assert.equal(response.status, 200);

    const ref = JSON.parse(github.files.get("tournaments-reference.json"));
    const refMatch = ref[0].matches.find(m => m.id === "m1");
    assert.equal(refMatch.sa, 2);
    assert.equal(refMatch.sb, 0);
    assert.equal(refMatch.score, "6-3, 6-4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateMatchScore accepts 2 to 5 sets with majority winner", () => {
  assert.deepEqual(validateMatchScore("6-4, 4-6, 10-7"), { setWinners: [0, 1, 0], winnerIndex: 0 });
  assert.deepEqual(validateMatchScore("6-4, 4-6, 6-4, 4-6, 7-5"), { setWinners: [0, 1, 0, 1, 0], winnerIndex: 0 });
  assert.equal(validateMatchScore("4-6, 6-4, 4-6, 4-6")?.winnerIndex, 1);
  assert.equal(validateMatchScore("6-4"), null);
  assert.equal(validateMatchScore("6-4, 4-6, 6-4, 4-6, 6-4, 6-4"), null);
});

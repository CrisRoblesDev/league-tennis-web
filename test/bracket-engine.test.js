import test from "node:test";
import assert from "node:assert/strict";
import { buildRanking, setSessionResp } from "../functions/_helpers.js";
import { onRequestPut as updateTournament } from "../functions/api/admin/tournaments/[id].js";
import { onRequestPatch as updateAdminPlayer } from "../functions/api/admin/players.js";

function githubMock(seed) {
  const files = new Map(Object.entries(seed).map(([name, value]) => [name, JSON.stringify(value)]));
  return {
    files,
    fetch: async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname !== "api.github.com") return Response.json({ message: "Unexpected request" }, { status: 500 });
      const match = url.pathname.match(/\/contents\/data\/([^/]+)$/);
      if (!match) return Response.json({ message: "Unexpected request" }, { status: 500 });
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
  SESSION_SECRET: "bracket-engine-test-session-secret-32-chars",
  ADMIN_EMAIL: "admin@example.com"
};

function seedTournament() {
  const players = ["a1", "a2", "b1", "b2"].map((id, index) => ({
    id, userId: `user-${id}`, name: `Player ${id.toUpperCase()}`, level: "3.5", points: index
  }));
  const entries = players.map(player => ({ playerId: player.id, userId: player.userId }));
  return {
    "users.json": [{ id: "admin-1", name: "Admin", email: "admin@example.com", password: "hash", role: "admin" }],
    "players.json": players,
    "tournaments.json": [{
      id: "tournament-1",
      title: "Groups to Final",
      month: "2026-11",
      status: "in_progress",
      formatType: "league",
      levels: ["3.5"],
      entries,
      groups: [
        { name: "Grupo A", entryPlayerIds: ["a1", "a2"] },
        { name: "Grupo B", entryPlayerIds: ["b1", "b2"] }
      ],
      stages: [{ id: "groups", name: "Fase de grupos", type: "groups" }],
      matches: [
        { id: "ga", stageId: "groups", round: "Grupo A · Jornada 1", playerAId: "a1", playerBId: "a2", status: "completed", winnerId: "a1", score: "6-2, 6-3", sets: [[6,2],[6,3]] },
        { id: "gb", stageId: "groups", round: "Grupo B · Jornada 1", playerAId: "b1", playerBId: "b2", status: "completed", winnerId: "b2", score: "4-6, 3-6", sets: [[4,6],[3,6]] }
      ]
    }]
  };
}

test("group standings advance to an integrated playoff and seed cross-group first-round matches", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedTournament());
  globalThis.fetch = github.fetch;
  try {
    const session = await setSessionResp({ userId: "admin-1", user: { id: "admin-1", role: "admin" } }, env, new Request("https://league.example"));
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const response = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ advanceGroups: { qualifiersPerGroup: 2 } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(response.status, 200);
    const tournament = (await response.json()).tournament;
    assert.deepEqual(tournament.stages.map(stage => stage.id), ["groups", "playoff"]);
    const playoff = tournament.matches.filter(match => match.stageId === "playoff");
    const firstRound = playoff.filter(match => match.round !== "Final");
    assert.equal(firstRound.length, 2);
    for (const match of firstRound) {
      const groupA = tournament.groups.find(group => group.entryPlayerIds.includes(match.playerAId));
      const groupB = tournament.groups.find(group => group.entryPlayerIds.includes(match.playerBId));
      assert.notEqual(groupA.name, groupB.name);
    }
    assert.ok(playoff.some(match => match.nextMatchId));

    const completedSemi = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ matchResult: {
          matchId: firstRound[0].id,
          sets: [[6, 2, false], [6, 3, false]],
          status: "completed"
        } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(completedSemi.status, 200);
    const afterSemi = (await completedSemi.json()).tournament;
    const semifinal = afterSemi.matches.find(match => match.id === firstRound[0].id);
    const final = afterSemi.matches.find(match => match.id === semifinal.nextMatchId);
    assert.equal(final[semifinal.nextSlot === "B" ? "playerBId" : "playerAId"], semifinal.winnerId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inline bracket slot updates persist the participant and invalidate the stale match result", async () => {
  const originalFetch = globalThis.fetch;
  const seed = seedTournament();
  seed["tournaments.json"][0].formatType = "knockout";
  seed["tournaments.json"][0].groups = null;
  seed["tournaments.json"][0].matches = [
    { id: "semi-1", round: "Semifinales", playerAId: "a1", playerBId: "a2", status: "completed", winnerId: "a1", score: "6-2, 6-2", sets: [[6,2],[6,2]], nextMatchId: "final", nextSlot: "A" },
    { id: "semi-2", round: "Semifinales", playerAId: "b1", playerBId: "b2", status: "scheduled", winnerId: null, score: "", nextMatchId: "final", nextSlot: "B" },
    { id: "final", round: "Final", playerAId: "a1", playerBId: null, status: "scheduled", winnerId: null, score: "" }
  ];
  const github = githubMock(seed);
  globalThis.fetch = github.fetch;
  try {
    const session = await setSessionResp({ userId: "admin-1", user: { id: "admin-1", role: "admin" } }, env, new Request("https://league.example"));
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const response = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ bracketSlotUpdate: { matchId: "semi-1", slot: "A", playerId: "b1" } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(response.status, 200);
    const tournament = (await response.json()).tournament;
    assert.equal(tournament.matches.find(match => match.id === "semi-1").playerAId, "b1");
    assert.equal(tournament.matches.find(match => match.id === "semi-1").winnerId, null);
    assert.equal(tournament.matches.find(match => match.id === "final").playerAId, null);
    assert.equal(tournament.matches.find(match => match.id === "final").status, "scheduled");

    const swapResponse = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ bracketSlotSwap: {
          from: { matchId: "semi-1", slot: "B" },
          to: { matchId: "semi-2", slot: "A" }
        } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(swapResponse.status, 200);
    const swapped = (await swapResponse.json()).tournament;
    assert.equal(swapped.matches.find(match => match.id === "semi-1").playerBId, "a1");
    assert.equal(swapped.matches.find(match => match.id === "semi-2").playerAId, "a2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an oversized bracket creates empty slots without assigning automatic winners", async () => {
  const originalFetch = globalThis.fetch;
  const seed = seedTournament();
  seed["tournaments.json"][0].entries = seed["tournaments.json"][0].entries.slice(0, 3);
  seed["tournaments.json"][0].formatType = "knockout";
  seed["tournaments.json"][0].groups = null;
  seed["tournaments.json"][0].matches = [];
  const github = githubMock(seed);
  globalThis.fetch = github.fetch;
  try {
    const session = await setSessionResp({ userId: "admin-1", user: { id: "admin-1", role: "admin" } }, env, new Request("https://league.example"));
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const response = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ bracketSize: 8, generateDraw: true })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(response.status, 200);
    const tournament = (await response.json()).tournament;
    assert.equal(tournament.matches.length, 7);
    assert.ok(tournament.matches.every(match => match.status === "scheduled" && match.winnerId === null && match.score === ""));
    assert.ok(tournament.matches.some(match => match.round === "Final" && !match.playerAId && !match.playerBId));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creating a fixture returns an editable match id and its result is saved without losing either player", async () => {
  const originalFetch = globalThis.fetch;
  const seed = seedTournament();
  seed["tournaments.json"][0].formatType = "knockout";
  seed["tournaments.json"][0].groups = null;
  seed["tournaments.json"][0].matches = [];
  const github = githubMock(seed);
  globalThis.fetch = github.fetch;
  try {
    const session = await setSessionResp({ userId: "admin-1", user: { id: "admin-1", role: "admin" } }, env, new Request("https://league.example"));
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const invalidMatchResponse = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ match: null })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(invalidMatchResponse.status, 400);
    const createResponse = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ match: {
          playerAId: "a1", playerBId: "b2", round: "Semifinales",
          date: "2026-11-12", court: "Cancha 1", status: "scheduled"
        } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.matchId);
    const createdMatch = created.tournament.matches.find(match => match.id === created.matchId);
    assert.equal(createdMatch.playerAId, "a1");
    assert.equal(createdMatch.playerBId, "b2");

    const resultResponse = await updateTournament({
      request: new Request("https://league.example/api/admin/tournaments/tournament-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ matchResult: {
          matchId: created.matchId,
          sets: [[6, 3, false], [6, 4, false]],
          status: "completed",
          date: "2026-11-12",
          court: "Cancha 1"
        } })
      }),
      env,
      params: { id: "tournament-1" }
    });
    assert.equal(resultResponse.status, 200);
    const saved = (await resultResponse.json()).tournament.matches.find(match => match.id === created.matchId);
    assert.equal(saved.playerAId, "a1");
    assert.equal(saved.playerBId, "b2");
    assert.equal(saved.status, "completed");
    assert.equal(saved.winnerId, "a1");
    assert.equal(saved.date, "2026-11-12");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin can persist manual ranking points and automatic wins are added to that base", async () => {
  const originalFetch = globalThis.fetch;
  const github = githubMock(seedTournament());
  globalThis.fetch = github.fetch;
  try {
    const session = await setSessionResp({ userId: "admin-1", user: { id: "admin-1", role: "admin" } }, env, new Request("https://league.example"));
    const cookie = session.headers.get("Set-Cookie").split(";")[0];
    const response = await updateAdminPlayer({
      request: new Request("https://league.example/api/admin/players", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ playerId: "a1", updates: { manualPoints: 17 } })
      }),
      env
    });
    assert.equal(response.status, 200);
    const storedPlayers = JSON.parse(github.files.get("players.json"));
    assert.equal(storedPlayers.find(player => player.id === "a1").manualPoints, 17);
    const ranking = buildRanking(storedPlayers, [{ status: "confirmed", winnerId: "a1", loserId: "a2" }], []);
    assert.equal(ranking.find(player => player.id === "a1").points, 18);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

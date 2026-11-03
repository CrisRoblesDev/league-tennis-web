import { gRead, jsonResponse } from "../_helpers.js";

export async function onRequestGet({ env }) {
  const ranking = await gRead(env, "ranking2026");
  const sorted = (Array.isArray(ranking) ? ranking : [])
    .filter(entry => entry && typeof entry.player === "string" && Number.isFinite(entry.points))
    .sort((a, b) => b.points - a.points);
  let lastPoints = null;
  let lastPos = 0;
  return jsonResponse(sorted.map((entry, index) => {
    const pos = entry.points === lastPoints ? lastPos : index + 1;
    lastPoints = entry.points;
    lastPos = pos;
    return { pos, player: entry.player, points: entry.points };
  }));
}

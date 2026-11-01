import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

export async function onRequestPatch({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.resultId !== "string" || !["confirm", "dispute", "reject"].includes(body.action)) {
    return jsonResponse({ error: "Acción de moderación inválida" }, 400);
  }

  const results = await gRead(env, "challenges");
  const result = results.find(item => item.id === body.resultId);
  if (!result) return jsonResponse({ error: "Resultado no encontrado" }, 404);
  if (!["pending", "disputed"].includes(result.status)) {
    return jsonResponse({ error: "Este resultado ya no requiere moderación" }, 409);
  }

  result.status = body.action === "confirm" ? "confirmed" :
    body.action === "dispute" ? "disputed" : "rejected";
  result.moderatedBy = userId;
  result.moderatedAt = new Date().toISOString();
  await gWrite(env, "challenges", results);
  return jsonResponse({ ok: true, status: result.status });
}

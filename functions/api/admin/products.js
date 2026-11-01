import { gRead, requireAdmin, jsonResponse } from "../../_helpers.js";

export async function onRequestGet({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  return jsonResponse(await gRead(env, "products"));
}

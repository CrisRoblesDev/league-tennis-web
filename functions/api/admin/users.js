import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  return jsonResponse(users.map(({ password, ...user }) => user));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  let b;
  try {
    b = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return jsonResponse({ error: "Actualizaciones inválidas" }, 400);
  }
  const target = users.find(u => u.id === b.userId);
  if (!target) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  const updates = b.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return jsonResponse({ error: "Actualizaciones inválidas" }, 400);
  }
  if (updates.role !== undefined) {
    if (!["admin", "user"].includes(updates.role)) return jsonResponse({ error: "Rol inválido" }, 400);
    target.role = updates.role;
  }
  if (updates.membershipActive !== undefined) {
    if (typeof updates.membershipActive !== "boolean") return jsonResponse({ error: "Estado de membresía inválido" }, 400);
    target.membershipActive = updates.membershipActive;
  }
  if (updates.level !== undefined) target.level = typeof updates.level === "string" ? updates.level : null;
  if (updates.zone !== undefined) target.zone = typeof updates.zone === "string" ? updates.zone : null;
  await gWrite(env, "users", users);
  return jsonResponse({ ok: true });
}

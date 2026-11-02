import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

const LEVELS = ["", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const ZONES = [
  "",
  "Aventura / Sunny Isles",
  "North Miami / Miami Gardens",
  "Downtown / Brickell",
  "Kendall / Doral"
];

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const users = await gRead(env, "users");
  return jsonResponse(users.map(({ password, ...user }) => user));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const users = await gRead(env, "users");
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
    if (target.id === userId && updates.role !== "admin") {
      return jsonResponse({ error: "No puedes quitarte tu propio acceso de administrador." }, 409);
    }
    if (target.role === "admin" && updates.role !== "admin" &&
        users.filter(item => item.role === "admin").length <= 1) {
      return jsonResponse({ error: "Debe existir al menos un administrador." }, 409);
    }
    target.role = updates.role;
  }
  if (updates.membershipActive !== undefined) {
    if (typeof updates.membershipActive !== "boolean") return jsonResponse({ error: "Estado de membresía inválido" }, 400);
    target.membershipActive = updates.membershipActive;
  }
  if (updates.level !== undefined) {
    if (typeof updates.level !== "string" || !LEVELS.includes(updates.level)) {
      return jsonResponse({ error: "Nivel inválido" }, 400);
    }
    target.level = updates.level || null;
  }
  if (updates.zone !== undefined) {
    if (typeof updates.zone !== "string" || !ZONES.includes(updates.zone)) {
      return jsonResponse({ error: "Zona inválida" }, 400);
    }
    target.zone = updates.zone || null;
  }
  if (updates.phone !== undefined) {
    const phoneValue = typeof updates.phone === "string" ? updates.phone.trim() : "";
    if (phoneValue && (phoneValue.length < 7 || phoneValue.replace(/\D/g, "").length < 7)) {
      return jsonResponse({ error: "Teléfono inválido" }, 400);
    }
    target.phone = phoneValue || null;
  }
  await gWrite(env, "users", users);
  return jsonResponse({ ok: true });
}

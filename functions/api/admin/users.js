import { gRead, gWrite, hashPw, requireAdmin, jsonResponse } from "../../_helpers.js";

const LEVELS = ["", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
const ZONES = [
  "",
  "Aventura / Sunny Isles",
  "North Miami / Miami Gardens",
  "Downtown / Brickell",
  "Kendall / Doral"
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTargetUserId(request, body) {
  try {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("userId") || url.searchParams.get("id") || url.searchParams.get("user");
    if (fromQuery) return fromQuery;
  } catch {}
  if (body && typeof body === "object") {
    return body.userId || body.id || body.targetUserId || body.deleteUserId || body.user || null;
  }
  return null;
}

async function deleteAdminUser(request, env, body) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const targetId = getTargetUserId(request, body);
  if (!targetId) return jsonResponse({ error: "Usuario no encontrado" }, 400);
  const users = await gRead(env, "users");
  const target = users.find(item => item.id === targetId);
  if (!target) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  if (target.id === userId) return jsonResponse({ error: "No puedes eliminar tu propia cuenta." }, 409);
  if (target.role === "admin" && users.filter(item => item.role === "admin").length <= 1) {
    return jsonResponse({ error: "Debe existir al menos un administrador." }, 409);
  }
  const remaining = users.filter(item => item.id !== targetId);
  await gWrite(env, "users", remaining);
  return jsonResponse({ ok: true, deleted: true, userId: targetId });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const users = await gRead(env, "users");
  return jsonResponse(users.map(({ password, ...user }) => user));
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  let body = null;
  try { body = await request.json(); } catch {}
  return deleteAdminUser(request, env, body);
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

  if (b.action === "delete" || b.action === "remove" || b.action === "deleteUser" || b.delete === true || b.remove === true) {
    return deleteAdminUser(request, env, b);
  }

  if (b.action === "create") {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const password = typeof b.password === "string" ? b.password : "";
    const role = b.role === "admin" ? "admin" : b.role === "member" ? "member" : "user";
    if (!name || name.length > 100 || !EMAIL_PATTERN.test(email) ||
        password.length < 8 || password.length > 128) {
      return jsonResponse({ error: "Nombre, email válido y contraseña de 8 a 128 caracteres son requeridos." }, 400);
    }
    if (users.some(item => item.email.toLowerCase() === email)) {
      return jsonResponse({ error: "Ya existe una cuenta con ese email." }, 409);
    }
    const created = {
      id: `user-${crypto.randomUUID()}`,
      name,
      email,
      password: await hashPw(password),
      role,
      created: new Date().toISOString()
    };
    users.push(created);
    await gWrite(env, "users", users);
    const { password: _ignored, ...safeUser } = created;
    return jsonResponse({ ok: true, user: safeUser }, 201);
  }

  const target = users.find(u => u.id === b.userId);
  if (!target) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  const updates = b.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return jsonResponse({ error: "Actualizaciones inválidas" }, 400);
  }
  if (updates.email !== undefined) {
    const email = typeof updates.email === "string" ? updates.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) return jsonResponse({ error: "Email inválido" }, 400);
    if (users.some(item => item.id !== target.id && item.email.toLowerCase() === email)) {
      return jsonResponse({ error: "Ese email ya está en uso por otra cuenta." }, 409);
    }
    target.email = email;
  }
  if (updates.password !== undefined) {
    if (typeof updates.password !== "string" || updates.password.length < 8 || updates.password.length > 128) {
      return jsonResponse({ error: "La contraseña debe tener entre 8 y 128 caracteres." }, 400);
    }
    target.password = await hashPw(updates.password);
  }
  if (updates.role !== undefined) {
    if (!["admin", "member", "user"].includes(updates.role)) return jsonResponse({ error: "Rol inválido" }, 400);
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

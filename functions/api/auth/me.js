import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

function validatePhone(phone) {
  const value = typeof phone === "string" ? phone.trim() : "";
  if (!value || value.length < 7 || value.replace(/\D/g, "").length < 7) return null;
  return value;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ user: null });
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  if (!user) return jsonResponse({ user: null });
  const needsPhone = !user.phone;
  return jsonResponse({ user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, nationality: user.nationality || "", phone: user.phone || "", photo: user.photo || "", membershipActive: user.membershipActive, needsPhone, requiresPhone: needsPhone, phoneRequired: needsPhone, mustRegisterPhone: needsPhone } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: "Solicitud JSON inválida" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonResponse({ error: "Datos inválidos" }, 400);
  const phone = validatePhone(body.phone);
  if (!phone) return jsonResponse({ error: "Ingresa un número de teléfono válido" }, 400);
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  if (!user) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  user.phone = phone;
  await gWrite(env, "users", users);
  const needsPhone = false;
  return jsonResponse({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, phone: user.phone || "", membershipActive: user.membershipActive, needsPhone, requiresPhone: needsPhone, phoneRequired: needsPhone, mustRegisterPhone: needsPhone } });
}

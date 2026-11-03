import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

function validatePhone(phone) {
  const value = typeof phone === "string" ? phone.trim() : "";
  if (!value || value.length < 7 || value.replace(/\D/g, "").length < 7) return null;
  return value;
}

async function handle(request, env) {
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);

  if (request.method === "GET") {
    const users = await gRead(env, "users");
    const user = users.find(item => item.id === userId);
    if (!user) return jsonResponse({ error: "Usuario no encontrado" }, 404);
    const needsPhone = !user.phone;
    return jsonResponse({
      ok: true,
      phone: user.phone || "",
      needsPhone,
      requiresPhone: needsPhone,
      phoneRequired: needsPhone,
      mustRegisterPhone: needsPhone,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        level: user.level,
        zone: user.zone,
        phone: user.phone || "",
        membershipActive: user.membershipActive,
        needsPhone,
        requiresPhone: needsPhone,
        phoneRequired: needsPhone,
        mustRegisterPhone: needsPhone
      }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Datos inválidos" }, 400);
  }
  const phone = validatePhone(body.phone);
  if (!phone) return jsonResponse({ error: "Ingresa un número de teléfono válido" }, 400);

  const users = await gRead(env, "users");
  const target = users.find(item => item.id === userId);
  if (!target) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  target.phone = phone;
  await gWrite(env, "users", users);

  const needsPhone = false;
  return jsonResponse({
    ok: true,
    phone,
    needsPhone,
    requiresPhone: needsPhone,
    phoneRequired: needsPhone,
    mustRegisterPhone: needsPhone,
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      level: target.level,
      zone: target.zone,
      phone: target.phone || "",
      membershipActive: target.membershipActive,
      needsPhone,
      requiresPhone: needsPhone,
      phoneRequired: needsPhone,
      mustRegisterPhone: needsPhone
    }
  });
}

export async function onRequestGet(context) {
  return handle(context.request, context.env);
}

export async function onRequestPost(context) {
  return handle(context.request, context.env);
}
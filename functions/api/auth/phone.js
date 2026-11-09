import { gRead, gWrite, requireAuth, jsonResponse, hashPw } from "../../_helpers.js";

function validatePhone(phone) {
  const value = typeof phone === "string" ? phone.trim() : "";
  if (!value || value.length < 7 || value.replace(/\D/g, "").length < 7) return null;
  return value;
}

function validateEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function publicUser(user, needsPhone) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    level: user.level,
    zone: user.zone,
    nationality: user.nationality || "",
    phone: user.phone || "",
    photo: user.photo || "",
    membershipActive: user.membershipActive,
    needsPhone,
    requiresPhone: needsPhone,
    phoneRequired: needsPhone,
    mustRegisterPhone: needsPhone
  };
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
      user: publicUser(user, needsPhone)
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
  if (body && (body.nationality !== undefined || body.nacionalidad !== undefined || body.country !== undefined)) {
    const rawPhoneNat = body.nationality !== undefined ? body.nationality : (body.nacionalidad !== undefined ? body.nacionalidad : body.country);
    if (rawPhoneNat === null) target.nationality = null;
    else if (typeof rawPhoneNat === "string") target.nationality = rawPhoneNat.trim() || null;
    else target.nationality = target.nationality;
  }
  if (body && body.name !== undefined) {
    const nameValue = typeof body.name === "string" ? body.name.trim() : "";
    if (!nameValue || nameValue.length > 100) {
      return jsonResponse({ error: "Nombre inválido (1-100 caracteres)" }, 400);
    }
    target.name = nameValue;
  }
  if (body && body.email !== undefined) {
    const email = validateEmail(body.email);
    if (!email) return jsonResponse({ error: "Email inválido." }, 400);
    const taken = users.some(item => item.id !== target.id && typeof item.email === "string" && item.email.toLowerCase() === email);
    if (taken) return jsonResponse({ error: "Email ya registrado" }, 409);
    target.email = email;
  }
  if (body && typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8 || body.password.length > 128) {
      return jsonResponse({ error: "La contraseña debe tener entre 8 y 128 caracteres." }, 400);
    }
    target.password = await hashPw(body.password);
  }
  if (body && typeof body.photo === "string" && body.photo.startsWith("/api/uploads/")) {
    target.photo = body.photo;
  }
  await gWrite(env, "users", users);

  const needsPhone = false;
  return jsonResponse({
    ok: true,
    phone,
    needsPhone,
    requiresPhone: needsPhone,
    phoneRequired: needsPhone,
    mustRegisterPhone: needsPhone,
    user: publicUser(target, false)
  });
}

export async function onRequestGet(context) {
  return handle(context.request, context.env);
}

export async function onRequestPost(context) {
  return handle(context.request, context.env);
}
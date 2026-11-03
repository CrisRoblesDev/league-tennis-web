import { gRead, gWrite, hashPw, jsonResponse } from "../../_helpers.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR = "No pudimos validar tus datos. Revisa el email y los últimos 4 dígitos del teléfono registrado.";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Datos inválidos" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneLast4 = typeof body.phoneLast4 === "string" ? body.phoneLast4.replace(/\D/g, "") : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!EMAIL_PATTERN.test(email) || phoneLast4.length !== 4 ||
      newPassword.length < 8 || newPassword.length > 128) {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  const users = await gRead(env, "users");
  const user = users.find(item => typeof item.email === "string" && item.email.toLowerCase() === email);
  const storedDigits = typeof user?.phone === "string" ? user.phone.replace(/\D/g, "") : "";
  if (!user || storedDigits.length < 4 || storedDigits.slice(-4) !== phoneLast4) {
    return jsonResponse({ error: GENERIC_ERROR }, 401);
  }

  user.password = await hashPw(newPassword);
  user.passwordRecoveredAt = new Date().toISOString();
  await gWrite(env, "users", users);
  return jsonResponse({ ok: true });
}

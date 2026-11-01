import { gRead, gWrite, hashPw, verifyPw, setSessionResp, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Credenciales inválidas" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonResponse({ error: "Email y contraseña son requeridos" }, 400);

  const users = await gRead(env, "users");
  const user = users.find(u => typeof u.email === "string" && u.email.toLowerCase() === email);
  if (!user || !(await verifyPw(password, user.password))) {
    return jsonResponse({ error: "Credenciales incorrectas" }, 401);
  }

  if (!user.password.startsWith("pbkdf2$")) {
    user.password = await hashPw(password);
    await gWrite(env, "users", users);
  }

  return setSessionResp({
    userId: user.id,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, membershipActive: user.membershipActive }
  }, env, request);
}

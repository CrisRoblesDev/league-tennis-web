import { gRead, gWrite, hashPw, setSessionResp, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Datos de registro inválidos" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
    return jsonResponse({ error: "Ingresa un nombre, email válido y contraseña de 8 a 128 caracteres" }, 400);
  }
  if (phone && (phone.length < 7 || phone.replace(/\D/g, "").length < 7)) {
    return jsonResponse({ error: "Ingresa un número de teléfono válido" }, 400);
  }

  const users = await gRead(env, "users");
  if (users.find(u => typeof u.email === "string" && u.email.toLowerCase() === email)) {
    return jsonResponse({ error: "Email ya registrado" }, 409);
  }

  const user = {
    id: `user-${crypto.randomUUID()}`, name, email,
    password: await hashPw(password),
    phone,
    level: typeof body.level === "string" ? body.level : null,
    zone: typeof body.zone === "string" ? body.zone : null,
    role: env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.trim().toLowerCase() ? "admin" : "user",
    created: new Date().toISOString(), membershipActive: false
  };
  users.push(user);
  await gWrite(env, "users", users);

  return setSessionResp({
    userId: user.id,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      level: user.level,
      zone: user.zone,
      phone: user.phone || "",
      membershipActive: user.membershipActive
    }
  }, env, request);
}

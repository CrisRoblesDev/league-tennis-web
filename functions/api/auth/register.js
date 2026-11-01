import { gRead, gWrite, hashPw, setSessionResp, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const b = await request.json();
  if (!b.name || !b.email || !b.password) return jsonResponse({ error: "Campos requeridos" }, 400);

  const users = await gRead(env, "users");
  if (users.find(u => u.email === b.email)) return jsonResponse({ error: "Email ya registrado" }, 400);

  const user = {
    id: "user-" + Date.now(), name: b.name, email: b.email,
    password: hashPw(b.password), level: b.level || null, zone: b.zone || null,
    role: users.length === 0 ? "admin" : "user",
    created: new Date().toISOString(), membershipActive: false
  };
  users.push(user);
  await gWrite(env, "users", users);

  return setSessionResp({ userId: user.id, user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone } });
}

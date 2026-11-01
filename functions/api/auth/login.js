import { gRead, hashPw, setSessionResp, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const b = await request.json();
  const users = await gRead(env, "users");
  const user = users.find(u => u.email === b.email && u.password === hashPw(b.password));
  if (!user) return jsonResponse({ error: "Credenciales incorrectas" }, 401);

  return setSessionResp({
    userId: user.id,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, membershipActive: user.membershipActive }
  });
}

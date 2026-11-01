import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ user: null });
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  if (!user) return jsonResponse({ user: null });
  return jsonResponse({ user: { id: user.id, name: user.name, email: user.email, role: user.role, level: user.level, zone: user.zone, membershipActive: user.membershipActive } });
}

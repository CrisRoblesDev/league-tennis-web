import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  return jsonResponse(users.map(u => ({ ...u, password: undefined })));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  const users = await gRead(env, "users");
  if (!users.find(u => u.id === userId && u.role === "admin")) return jsonResponse({ error: "No autorizado" }, 403);
  const b = await request.json();
  const target = users.find(u => u.id === b.userId);
  if (target) Object.assign(target, b.updates || {});
  await gWrite(env, "users", users);
  return jsonResponse({ ok: true });
}

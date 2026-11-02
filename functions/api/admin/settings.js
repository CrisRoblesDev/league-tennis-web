import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

const WHATSAPP_PATTERN = /^https:\/\/(chat\.whatsapp\.com\/[\w-]+|wa\.me\/\d+)(\/.*)?$/i;

export async function onRequestGet({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const settings = await gRead(env, "settings");
  return jsonResponse({ whatsappUrl: typeof settings?.whatsappUrl === "string" ? settings.whatsappUrl : "" });
}

export async function onRequestPost({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  const whatsappUrl = typeof body?.whatsappUrl === "string" ? body.whatsappUrl.trim() : "";
  if (whatsappUrl && !WHATSAPP_PATTERN.test(whatsappUrl)) {
    return jsonResponse({
      error: "Usa un enlace válido de WhatsApp: https://chat.whatsapp.com/... o https://wa.me/<número>."
    }, 400);
  }

  const settings = await gRead(env, "settings");
  settings.whatsappUrl = whatsappUrl;
  await gWrite(env, "settings", settings);
  return jsonResponse({ ok: true, whatsappUrl });
}

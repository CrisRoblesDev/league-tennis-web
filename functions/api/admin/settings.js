import { gRead, gWrite, requireAdmin, jsonResponse } from "../../_helpers.js";

function cleanPhone(value) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function buildWhatsAppUrl(phone, message) {
  const digits = cleanPhone(phone);
  if (!digits || digits.length < 7) return "";
  const base = `https://wa.me/${digits}`;
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}

export async function onRequestGet({ request, env }) {
  const { user, userId } = await requireAdmin(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  if (!user) return jsonResponse({ error: "No autorizado" }, 403);
  const settings = await gRead(env, "settings");
  return jsonResponse({
    whatsappUrl: typeof settings?.whatsappUrl === "string" ? settings.whatsappUrl : "",
    whatsappPhone: typeof settings?.whatsappPhone === "string" ? settings.whatsappPhone : "",
    whatsappMessage: typeof settings?.whatsappMessage === "string" ? settings.whatsappMessage : ""
  });
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Datos inválidos" }, 400);
  }

  const phoneAlias = body.whatsappPhone ?? body.phone ?? body.number ?? body.whatsappNumber;
  const messageAlias = body.whatsappMessage ?? body.message ?? body.text ?? body.defaultMessage;
  const urlAlias = body.whatsappUrl ?? body.url ?? body.link;

  let settings = await gRead(env, "settings");
  let whatsappUrl = typeof settings?.whatsappUrl === "string" ? settings.whatsappUrl : "";
  let whatsappPhone = typeof settings?.whatsappPhone === "string" ? settings.whatsappPhone : "";
  let whatsappMessage = typeof settings?.whatsappMessage === "string" ? settings.whatsappMessage : "";

  if (phoneAlias !== undefined) {
    const digits = cleanPhone(phoneAlias);
    if (phoneAlias === "" || phoneAlias === null) {
      whatsappPhone = "";
      whatsappMessage = typeof messageAlias === "string" ? messageAlias.trim() : whatsappMessage;
      whatsappUrl = buildWhatsAppUrl(whatsappPhone, whatsappMessage);
    } else {
      if (digits.length < 7) {
        return jsonResponse({ error: "Ingresa un número de WhatsApp válido." }, 400);
      }
      whatsappPhone = digits;
      if (messageAlias !== undefined) whatsappMessage = typeof messageAlias === "string" ? messageAlias.trim() : "";
      whatsappUrl = buildWhatsAppUrl(whatsappPhone, whatsappMessage);
    }
  } else if (messageAlias !== undefined && whatsappPhone) {
    whatsappMessage = typeof messageAlias === "string" ? messageAlias.trim() : "";
    whatsappUrl = buildWhatsAppUrl(whatsappPhone, whatsappMessage);
  }

  if (phoneAlias === undefined && urlAlias !== undefined) {
    const whatsappUrlInput = typeof urlAlias === "string" ? urlAlias.trim() : "";
    if (whatsappUrlInput === "") {
      whatsappUrl = "";
      whatsappPhone = "";
      whatsappMessage = "";
    } else if (!/^https:\/\/.+/i.test(whatsappUrlInput) || !/(whatsapp|wa\.me)/i.test(whatsappUrlInput)) {
      return jsonResponse({ error: "Usa un enlace válido de WhatsApp o ingresa el número y el mensaje." }, 400);
    } else {
      whatsappUrl = whatsappUrlInput;
    }
  }

  settings.whatsappUrl = whatsappUrl;
  settings.whatsappPhone = whatsappPhone;
  settings.whatsappMessage = whatsappMessage;
  await gWrite(env, "settings", settings);
  return jsonResponse({ ok: true, whatsappUrl, whatsappPhone, whatsappMessage });
}

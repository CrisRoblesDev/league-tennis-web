import { gRead, jsonResponse } from "../_helpers.js";

export async function onRequestGet({ env }) {
  const settings = await gRead(env, "settings");
  return jsonResponse({ whatsappUrl: typeof settings?.whatsappUrl === "string" ? settings.whatsappUrl : "" });
}

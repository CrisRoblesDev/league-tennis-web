import { jsonResponse } from "./_helpers.js";

export async function onRequest({ next }) {
  try {
    return await next();
  } catch (error) {
    console.error("Pages Function failed:", error.message);
    return jsonResponse({ error: error.message || "Error interno del servidor" }, 503);
  }
}

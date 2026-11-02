import { gReadRaw, jsonResponse } from "../../_helpers.js";

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function onRequestGet({ env, params }) {
  const name = typeof params.file === "string" ? params.file : "";
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    return jsonResponse({ error: "Archivo inválido" }, 400);
  }
  const ext = name.split(".").pop().toLowerCase();
  if (!TYPES[ext]) return jsonResponse({ error: "Tipo de archivo no permitido" }, 400);

  let file;
  try {
    file = await gReadRaw(env, `data/uploads/${name}`);
  } catch {
    file = null;
  }
  if (!file) return jsonResponse({ error: "Imagen no encontrada" }, 404);

  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": TYPES[ext],
      "Cache-Control": "public, max-age=86400"
    }
  });
}

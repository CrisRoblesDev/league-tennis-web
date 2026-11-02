import { gWriteRaw, requireAdmin, jsonResponse } from "../../_helpers.js";

const MAX_BYTES = 400 * 1024;

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
  const dataUrl = typeof body?.image === "string" ? body.image : "";
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return jsonResponse({ error: "Imagen inválida. Sube un archivo PNG, JPG o WebP." }, 400);

  const base64 = match[2];
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes < 64) return jsonResponse({ error: "La imagen está vacía." }, 400);
  if (bytes > MAX_BYTES) {
    return jsonResponse({ error: "La imagen supera el máximo de 400 KB después de comprimir." }, 400);
  }

  const original = typeof body.filename === "string" ? body.filename : "imagen";
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const safe = original
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "imagen";
  const name = `${Date.now()}-${safe}.${ext}`;

  try {
    await gWriteRaw(env, `data/uploads/${name}`, base64, `upload ${name}`);
  } catch (error) {
    return jsonResponse({ error: `No se pudo guardar la imagen: ${error.message}` }, 502);
  }
  return jsonResponse({ url: `/api/uploads/${name}` }, 201);
}

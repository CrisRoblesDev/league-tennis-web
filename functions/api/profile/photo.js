import { gRead, gWrite, gWriteRaw, requireAuth, jsonResponse } from "../../_helpers.js";

const MAX_IMAGE_BYTES = 400 * 1024;

export async function onRequestPost({ request, env }) {
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }

  const dataUrl = typeof body?.image === "string" ? body.image : "";
  const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!imageMatch) {
    return jsonResponse({ error: "Archivo inválido. Sube una imagen PNG, JPG o WebP." }, 400);
  }

  const base64 = imageMatch[2];
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes < 64) return jsonResponse({ error: "La imagen está vacía." }, 400);
  if (bytes > MAX_IMAGE_BYTES) {
    return jsonResponse({ error: "La imagen supera el máximo de 400 KB." }, 400);
  }

  const ext = imageMatch[1] === "jpeg" ? "jpg" : imageMatch[1];
  const name = `${Date.now()}-profile-${userId}.${ext}`;

  try {
    await gWriteRaw(env, `data/uploads/${name}`, base64, `upload profile photo ${name}`);
  } catch (error) {
    return jsonResponse({ error: `No se pudo guardar la foto: ${error.message}` }, 502);
  }

  const url = `/api/uploads/${name}`;

  const users = await gRead(env, "users");
  const target = users.find(item => item.id === userId);
  if (!target) return jsonResponse({ error: "Usuario no encontrado" }, 404);

  target.photo = url;
  if (typeof body.country === "string" && body.country.trim()) {
    target.country = body.country.trim();
  }
  await gWrite(env, "users", users);

  return jsonResponse({ ok: true, photo: url, country: target.country }, 200);
}

import { gWriteRaw, requireAdmin, jsonResponse } from "../../_helpers.js";

const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

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
  const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  const pdfMatch = dataUrl.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);

  if (!imageMatch && !pdfMatch) {
    return jsonResponse({ error: "Archivo inválido. Sube una imagen PNG, JPG, WebP o un PDF." }, 400);
  }

  const isPdf = !!pdfMatch;
  const base64 = isPdf ? pdfMatch[1] : imageMatch[2];
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes < 64) return jsonResponse({ error: "El archivo está vacío." }, 400);
  const maxBytes = isPdf ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (bytes > maxBytes) {
    return jsonResponse({ error: isPdf
      ? "El PDF supera el máximo de 25 MB."
      : "La imagen supera el máximo de 400 KB después de comprimir." }, 400);
  }

  const original = typeof body.filename === "string" ? body.filename : (isPdf ? "libro.pdf" : "imagen");
  let ext;
  if (isPdf) ext = "pdf";
  else ext = imageMatch[1] === "jpeg" ? "jpg" : imageMatch[1];
  const safe = original
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || (isPdf ? "libro" : "imagen");
  const name = `${Date.now()}-${safe}.${ext}`;

  try {
    await gWriteRaw(env, `data/uploads/${name}`, base64, `upload ${name}`);
  } catch (error) {
    return jsonResponse({ error: `No se pudo guardar el archivo: ${error.message}` }, 502);
  }
  const url = isPdf ? `/api/books/${name}` : `/api/uploads/${name}`;
  return jsonResponse({ url }, 201);
}
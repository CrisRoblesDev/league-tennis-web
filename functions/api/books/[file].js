import { gRead, gReadRaw, requireAuth, jsonResponse } from "../../_helpers.js";

const TYPES = { pdf: "application/pdf" };

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para descargar este libro" }, 401);

  let users = [];
  try { users = await gRead(env, "users"); } catch { users = []; }
  const user = Array.isArray(users) ? users.find(item => item.id === userId) : null;
  const isMember = !!user && (user.role === "member" || user.role === "admin" || user.membershipActive === true);
  if (!isMember) return jsonResponse({ error: "Solo los miembros pueden descargar este libro" }, 403);

  const name = typeof params.file === "string" ? params.file : "";
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    return jsonResponse({ error: "Archivo inválido" }, 400);
  }
  const ext = name.split(".").pop().toLowerCase();
  if (!TYPES[ext]) return jsonResponse({ error: "Tipo de archivo no permitido" }, 400);

  let file;
  try { file = await gReadRaw(env, `data/uploads/${name}`); } catch { file = null; }
  if (!file) return jsonResponse({ error: "Libro no encontrado" }, 404);

  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": TYPES[ext],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, max-age=0"
    }
  });
}
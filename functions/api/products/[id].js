import { gRead, gWrite, jsonResponse } from "../../_helpers.js";

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = params.id;
  const products = await gRead(env, "products");
  const idx = products.findIndex(p => p.id === id);
  if (idx < 0) return jsonResponse({ error: "No encontrado" }, 404);
  Object.assign(products[idx], await request.json());
  await gWrite(env, "products", products);
  return jsonResponse(products[idx]);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;
  const products = await gRead(env, "products");
  const idx = products.findIndex(p => p.id === id);
  if (idx >= 0) products.splice(idx, 1);
  await gWrite(env, "products", products);
  return jsonResponse({ ok: true });
}

import { gRead, gWrite, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { env } = context;
  const products = (await gRead(env, "products")).filter(p => p.active);
  return jsonResponse(products);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const b = await request.json();
  const products = await gRead(env, "products");
  const product = { id: "prod-" + Date.now(), name: b.name, price: Math.round(b.price), type: b.type || "digital", description: b.description || "", active: b.active !== false };
  products.push(product);
  await gWrite(env, "products", products);
  return jsonResponse(product);
}

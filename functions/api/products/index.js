import { gRead, gWrite, requireAuth, jsonResponse, PRODUCT_CATEGORIES } from "../../_helpers.js";

function validImage(value) {
  return typeof value === "string" && value.trim().length <= 500 &&
    (/^\//.test(value.trim()) || /^https:\/\//i.test(value.trim()));
}

function validLink(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v === "") return true;
  return v.length <= 1000 && (/^https?:\/\//i.test(v) || /^\//.test(v));
}

export async function onRequestGet(context) {
  const { env } = context;
  const products = (await gRead(env, "products")).filter(p => p.active);
  return jsonResponse(products);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const users = await gRead(env, "users");
  if (!users.some(user => user.id === userId && user.role === "admin")) {
    return jsonResponse({ error: "No autorizado" }, 403);
  }
  let b;
  try {
    b = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return jsonResponse({ error: "Producto inválido" }, 400);
  }
  const linkAliasKeys = ["link", "url", "purchaseUrl", "purchaseLink", "buyUrl", "buyLink", "href", "productUrl", "externalUrl", "externalLink", "linkUrl"];
  const presentLinkKeys = linkAliasKeys.filter(key => Object.prototype.hasOwnProperty.call(b, key));
  const linkAlias = presentLinkKeys.length ? b[presentLinkKeys[0]] : undefined;
  if (typeof b.name !== "string" || !b.name.trim() || !Number.isSafeInteger(b.price) || b.price < 1 ||
      !["digital", "subscription"].includes(b.type || "digital") ||
      (b.category && !PRODUCT_CATEGORIES.includes(b.category)) ||
      (b.image !== undefined && !validImage(b.image)) ||
      (linkAlias !== undefined && !validLink(linkAlias))) {
    return jsonResponse({ error: "Nombre, precio entero positivo, tipo y categoría válidos son requeridos" }, 400);
  }
  const products = await gRead(env, "products");
  const linkValue = typeof linkAlias === "string" ? linkAlias.trim() : (linkAlias === null ? "" : "");
  const product = {
    id: `prod-${crypto.randomUUID()}`,
    name: b.name.trim(),
    price: b.price,
    type: b.type || "digital",
    description: typeof b.description === "string" ? b.description.trim() : "",
    active: b.active !== false,
    ...(typeof b.image === "string" && b.image.trim() ? { image: b.image.trim() } : {}),
    ...(linkValue ? { link: linkValue, url: linkValue } : {}),
    ...(b.type === "subscription" ? { interval: ["month", "year"].includes(b.interval) ? b.interval : "month" } : {}),
    category: typeof b.category === "string" ? b.category : ""
  };
  for (const key of presentLinkKeys) {
    if (linkValue) product[key] = linkValue;
  }
  products.push(product);
  await gWrite(env, "products", products);
  return jsonResponse(product);
}

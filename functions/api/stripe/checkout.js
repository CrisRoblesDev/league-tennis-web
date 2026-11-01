import { gRead, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para continuar" }, 401);
  if (!env.STRIPE_SECRET_KEY || !/^sk_(test|live)_/.test(env.STRIPE_SECRET_KEY)) {
    return jsonResponse({
      error: "STRIPE_SECRET_KEY no es válida: usa la clave secreta sk_test_... o sk_live_... de Stripe; una clave pk_ es publicable y no sirve en el servidor."
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Solicitud JSON inválida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Producto inválido" }, 400);
  }
  if (typeof body.productId !== "string") return jsonResponse({ error: "Producto inválido" }, 400);

  const [products, users] = await Promise.all([
    gRead(env, "products"),
    gRead(env, "users")
  ]);
  const product = products.find(item => item.id === body.productId && item.active);
  const user = users.find(item => item.id === userId);
  if (!user) return jsonResponse({ error: "Usuario no encontrado" }, 404);
  if (!product || !Number.isSafeInteger(product.price) || product.price < 1) {
    return jsonResponse({ error: "Producto no disponible" }, 404);
  }
  if (product.type === "subscription" && !["month", "year"].includes(product.interval || "month")) {
    return jsonResponse({ error: "Intervalo de suscripción inválido" }, 400);
  }

  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    mode: product.type === "subscription" ? "subscription" : "payment",
    "payment_method_types[]": "card",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(product.price),
    "line_items[0][price_data][product_data][name]": product.name,
    "line_items[0][price_data][product_data][description]": product.description || "",
    "line_items[0][quantity]": "1",
    client_reference_id: userId,
    success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?payment=canceled`,
    "metadata[userId]": userId,
    "metadata[productId]": product.id
  });

  if (product.type === "subscription") {
    params.set("line_items[0][price_data][recurring][interval]", product.interval || "month");
    params.set("subscription_data[metadata][userId]", userId);
    params.set("subscription_data[metadata][productId]", product.id);
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const result = await response.json();
  if (!response.ok) {
    return jsonResponse({ error: result.error?.message || "Stripe no pudo crear la sesión de pago" }, 502);
  }
  if (!result.url) return jsonResponse({ error: "Stripe no devolvió la URL de pago" }, 502);
  return jsonResponse({ url: result.url });
}

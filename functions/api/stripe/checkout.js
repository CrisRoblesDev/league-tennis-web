import { gRead, gWrite, requireAuth, jsonResponse } from "../../_helpers.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const userId = requireAuth(request);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);
  const { productId } = await request.json();
  const products = await gRead(env, "products");
  const product = products.find(p => p.id === productId && p.active);
  if (!product) return jsonResponse({ error: "Producto no encontrado" }, 404);
  const users = await gRead(env, "users");
  const user = users.find(u => u.id === userId);
  const origin = new URL(request.url).origin;

  // Use Stripe API directly (no npm module needed for Cloudflare Workers)
  const lineItem = {
    price_data: {
      unit_amount: product.price,
      currency: "usd",
      product_data: { name: product.name, description: product.description || "" },
      tax_behavior: "inclusive",
      ...(product.type === "subscription" ? { recurring: { interval: product.interval || "month" } } : {})
    },
    quantity: 1
  };

  const body = new URLSearchParams({
    mode: product.type === "subscription" ? "subscription" : "payment",
    "payment_method_types[]": "card",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(product.price),
    "line_items[0][price_data][product_data][name]": product.name,
    "line_items[0][price_data][product_data][description]": product.description || "",
    "line_items[0][quantity]": "1",
    success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?payment=canceled`,
    "metadata[userId]": userId,
    "metadata[productId]": product.id
  });

  if (product.type === "subscription") {
    body.append("line_items[0][price_data][recurring][interval]", product.interval || "month");
  }

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!resp.ok) return jsonResponse({ error: await resp.text() }, 500);
  const session = await resp.json();
  return jsonResponse({ url: session.url });
}

import { gRead, gWrite, jsonResponse } from "../../_helpers.js";

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const sessionId = params.session_id || params[0];
  if (!sessionId) return jsonResponse({ error: "Missing session id" }, 400);

  const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!resp.ok) return jsonResponse({ error: await resp.text() }, 500);
  const session = await resp.json();

  if (session.payment_status === "paid") {
    const { userId, productId } = session.metadata || {};
    const products = await gRead(env, "products");
    const product = products.find(p => p.id === productId);
    const users = await gRead(env, "users");
    const userIdx = users.findIndex(u => u.id === userId);

    const orders = await gRead(env, "orders");
    orders.push({
      id: "ord-" + Date.now(), userId, productId,
      productName: product?.name || "", amount: session.amount_total || 0,
      currency: session.currency || "usd", status: "paid",
      stripeSessionId: session.id, created: new Date().toISOString()
    });
    await gWrite(env, "orders", orders);

    if (product?.type === "subscription" && userIdx >= 0) {
      users[userIdx].membershipActive = true;
      await gWrite(env, "users", users);
      const subs = await gRead(env, "subscriptions");
      subs.push({ id: "sub-" + Date.now(), userId, productId, stripeSessionId: session.id, status: "active", created: new Date().toISOString() });
      await gWrite(env, "subscriptions", subs);
    }
  }

  return jsonResponse({ status: session.payment_status });
}

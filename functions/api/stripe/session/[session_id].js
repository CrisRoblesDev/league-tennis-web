import { gRead, gWrite, requireAuth, jsonResponse } from "../../../_helpers.js";

async function stripeGet(url, secret) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || "Stripe no pudo verificar la compra");
  }
  return result;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "Inicia sesión para verificar la compra" }, 401);
  if (!env.STRIPE_SECRET_KEY) return jsonResponse({ error: "Falta configurar STRIPE_SECRET_KEY en Cloudflare" }, 503);

  const sessionId = params.session_id;
  if (!sessionId || !/^cs_(test|live)_/.test(sessionId)) {
    return jsonResponse({ error: "Sesión de pago inválida" }, 400);
  }

  try {
    const session = await stripeGet(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      env.STRIPE_SECRET_KEY
    );
    const ownerId = session.metadata?.userId || session.client_reference_id;
    if (ownerId !== userId) return jsonResponse({ error: "Esta compra no pertenece a tu cuenta" }, 403);
    if (session.payment_status !== "paid") return jsonResponse({ status: session.payment_status });

    const [products, users, orders, subscriptions] = await Promise.all([
      gRead(env, "products"),
      gRead(env, "users"),
      gRead(env, "orders"),
      gRead(env, "subscriptions")
    ]);
    const productId = session.metadata?.productId;
    const user = users.find(item => item.id === userId);

    if (productId === "donacion") {
      const expected = Number(session.metadata?.amount);
      if (!Number.isSafeInteger(expected) || session.amount_total !== expected || session.currency !== "usd") {
        return jsonResponse({ error: "Los datos del pago no coinciden con la donación" }, 409);
      }
      if (!orders.some(order => order.stripeSessionId === session.id)) {
        orders.push({
          id: `ord-${crypto.randomUUID()}`,
          userId,
          productId: "donacion",
          productName: session.mode === "subscription" ? "Donación mensual" : "Donación",
          amount: session.amount_total,
          currency: session.currency,
          status: "paid",
          stripeSessionId: session.id,
          created: new Date().toISOString()
        });
        await gWrite(env, "orders", orders);
      }
      if (session.mode === "subscription" && session.subscription) {
        const subscription = await stripeGet(
          `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(session.subscription)}`,
          env.STRIPE_SECRET_KEY
        );
        if (["active", "trialing"].includes(subscription.status) &&
            !subscriptions.some(item => item.stripeSubscriptionId === subscription.id)) {
          subscriptions.push({
            id: `sub-${crypto.randomUUID()}`,
            userId,
            productId: "donacion",
            stripeSessionId: session.id,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            created: new Date().toISOString()
          });
          await gWrite(env, "subscriptions", subscriptions);
        }
      }
      return jsonResponse({ status: "paid" });
    }

    const product = products.find(item => item.id === productId);
    if (!product || !user) return jsonResponse({ error: "No se pudo asociar el pago a un producto y usuario" }, 409);

    const expectedMode = product.type === "subscription" ? "subscription" : "payment";
    if (session.mode !== expectedMode || session.amount_total !== product.price || session.currency !== "usd") {
      return jsonResponse({ error: "Los datos del pago no coinciden con el producto" }, 409);
    }

    if (product.type === "subscription") {
      if (!session.subscription) return jsonResponse({ error: "Stripe no devolvió la suscripción" }, 409);
      const subscription = await stripeGet(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(session.subscription)}`,
        env.STRIPE_SECRET_KEY
      );
      if (!["active", "trialing"].includes(subscription.status)) {
        return jsonResponse({ status: subscription.status });
      }

      const existingSubscription = subscriptions.find(item => item.stripeSubscriptionId === subscription.id);
      if (!existingSubscription) {
        subscriptions.push({
          id: `sub-${crypto.randomUUID()}`,
          userId,
          productId,
          stripeSessionId: session.id,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          created: new Date().toISOString()
        });
        await gWrite(env, "subscriptions", subscriptions);
      }
      user.membershipActive = true;
      await gWrite(env, "users", users);
    }

    if (!orders.some(order => order.stripeSessionId === session.id)) {
      orders.push({
        id: `ord-${crypto.randomUUID()}`,
        userId,
        productId,
        productName: product.name,
        amount: session.amount_total,
        currency: session.currency,
        status: "paid",
        stripeSessionId: session.id,
        created: new Date().toISOString()
      });
      await gWrite(env, "orders", orders);
    }
    return jsonResponse({ status: "paid" });
  } catch (error) {
    console.error("Stripe session verification failed:", error.message);
    return jsonResponse({ error: error.message }, 502);
  }
}

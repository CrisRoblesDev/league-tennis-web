import { gRead, gWrite, jsonResponse } from "../../_helpers.js";

function bytesFromHex(value) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g), byte => parseInt(byte, 16));
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifySignature(payload, signatureHeader, secret) {
  const parts = signatureHeader.split(",").map(part => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures.length) return false;

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : "";
  let keyBytes;
  try {
    keyBytes = Uint8Array.from(atob(encodedSecret), character => character.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  ));
  return signatures.some(signature => equalBytes(expected, bytesFromHex(signature)));
}

async function updateSubscription(env, stripeSubscription) {
  const [subscriptions, users] = await Promise.all([
    gRead(env, "subscriptions"),
    gRead(env, "users")
  ]);
  const existing = subscriptions.find(item => item.stripeSubscriptionId === stripeSubscription.id);
  const userId = stripeSubscription.metadata?.userId || existing?.userId;
  const productId = stripeSubscription.metadata?.productId || existing?.productId;
  if (!userId) return;

  if (existing) {
    existing.status = stripeSubscription.status;
    existing.updated = new Date().toISOString();
  } else {
    subscriptions.push({
      id: `sub-${crypto.randomUUID()}`,
      userId,
      productId,
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      created: new Date().toISOString()
    });
  }
  await gWrite(env, "subscriptions", subscriptions);

  const user = users.find(item => item.id === userId);
  if (user) {
    user.membershipActive = subscriptions.some(item =>
      item.userId === userId && ["active", "trialing"].includes(item.status)
    );
    await gWrite(env, "users", users);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    return jsonResponse({ error: "STRIPE_WEBHOOK_SECRET debe ser el secreto whsec_... del endpoint de Stripe." }, 503);
  }
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return jsonResponse({ error: "Firma Stripe requerida" }, 400);
  const payload = await request.text();
  if (!(await verifySignature(payload, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return jsonResponse({ error: "Firma Stripe inválida" }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ error: "Evento JSON inválido" }, 400);
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const userId = session.metadata?.userId || session.client_reference_id;
        const productId = session.metadata?.productId;
        const [products, users, orders] = await Promise.all([
          gRead(env, "products"),
          gRead(env, "users"),
          gRead(env, "orders")
        ]);
        const product = products.find(item => item.id === productId);
        const user = users.find(item => item.id === userId);
        const expectedMode = product?.type === "subscription" ? "subscription" : "payment";
        if (!product || !user || session.mode !== expectedMode ||
            session.amount_total !== product.price || session.currency !== "usd") {
          return jsonResponse({ error: "El pago no coincide con un producto válido" }, 400);
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

        if (product.type === "subscription" && session.subscription) {
          await updateSubscription(env, {
            id: session.subscription,
            metadata: { userId, productId },
            status: "active"
          });
        }
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      await updateSubscription(env, event.data.object);
    }
    return jsonResponse({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);
    return jsonResponse({ error: "No se pudo procesar el evento de Stripe" }, 500);
  }
}

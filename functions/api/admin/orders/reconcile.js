import { gRead, gWrite, requireAuth, jsonResponse } from "../../../_helpers.js";

export async function onRequestPost({ request, env }) {
  const userId = await requireAuth(request, env);
  if (!userId) return jsonResponse({ error: "No autenticado" }, 401);

  const [users, orders] = await Promise.all([
    gRead(env, "users"),
    gRead(env, "orders")
  ]);
  if (!users.find(user => user.id === userId && user.role === "admin")) {
    return jsonResponse({ error: "No autorizado" }, 403);
  }

  const secretKey = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY : "";
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
    return jsonResponse({ error: "Configura STRIPE_SECRET_KEY en Cloudflare para sincronizar pagos." }, 503);
  }

  try {
    let cursor;
    let scanned = 0;
    let hasMore = true;
    const knownSessionIds = new Set(orders.map(order => order.stripeSessionId));
    const usersById = new Map(users.map(user => [user.id, user]));
    const products = await gRead(env, "products");
    const productsById = new Map(products.map(product => [product.id, product]));
    let added = 0;

    while (hasMore && scanned < 1000) {
      const url = new URL("https://api.stripe.com/v1/checkout/sessions");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("starting_after", cursor);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${secretKey}` }
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || "Stripe no pudo recuperar las compras");
      }

      const sessions = Array.isArray(result.data) ? result.data : [];
      scanned += sessions.length;
      for (const session of sessions) {
        if (session.status !== "complete" || session.payment_status !== "paid" ||
            typeof session.id !== "string" || knownSessionIds.has(session.id)) continue;

        const ownerId = session.metadata?.userId || session.client_reference_id;
        const productId = session.metadata?.productId;
        const user = usersById.get(ownerId);
        if (!user || typeof productId !== "string" ||
            !Number.isSafeInteger(session.amount_total) || session.amount_total < 0 ||
            typeof session.currency !== "string") continue;

        const product = productsById.get(productId);
        const created = Number.isSafeInteger(session.created)
          ? new Date(session.created * 1000).toISOString()
          : new Date().toISOString();
        orders.push({
          id: `ord-${crypto.randomUUID()}`,
          userId: ownerId,
          productId,
          productName: product?.name || "Producto de Stripe",
          amount: session.amount_total,
          currency: session.currency,
          status: "paid",
          stripeSessionId: session.id,
          created
        });
        knownSessionIds.add(session.id);
        added++;
      }

      hasMore = result.has_more === true && sessions.length > 0;
      cursor = sessions.at(-1)?.id;
    }

    if (added) await gWrite(env, "orders", orders);
    return jsonResponse({ added, scanned });
  } catch (error) {
    console.error("Admin Stripe order reconciliation failed:", error.message);
    return jsonResponse({ error: `No se pudieron sincronizar los pagos con Stripe: ${error.message}` }, 502);
  }
}

// POST /api/admin/projects/:id/paylink  {kind: "sketch"|"deposit"|"final", send?: boolean}
// Stripe Checkout fizetési linket készít, és (alapból) e-mailben elküldi az ügyfélnek.
import { Env, json, bad, clean, logEvent, touch, money, priceOf, sketchFor, sketchAmount } from "../../../../../lib/core";
import { stripe } from "../../../../../lib/stripe";
import { sendMail, layout, rows } from "../../../../../lib/mail";

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  if (!env.STRIPE_SECRET_KEY) return bad("A Stripe-kulcs még nincs beállítva (STRIPE_SECRET_KEY).", 503);
  const id = String(params.id);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = clean(b.kind, 10);
  if (!["sketch", "deposit", "final"].includes(kind)) return bad("Ismeretlen fizetéstípus.");

  const p = await env.DB.prepare("SELECT p.*, c.email, c.name, c.business, c.lang, c.stripe_customer_id FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?1").bind(id).first<any>();
  if (!p) return bad("Nincs ilyen projekt.", 404);
  if (!p.email) return bad("Az ügyfélnek nincs e-mail-címe.");
  const cur: "HUF" | "EUR" = p.currency === "EUR" ? "EUR" : "HUF";
  const lang = p.lang === "en" ? "en" : "hu";
  const hu = lang === "hu";
  const items: string[] = JSON.parse(p.items || "[]");
  const { once } = priceOf(items, cur);
  const sketch = sketchFor(priceOf(items, "HUF").once);
  const sketchAmt = sketchAmount(priceOf(items, "HUF").once, cur);

  let lineItems: Record<string, unknown>[];
  let amount: number;
  let label: string;
  if (kind === "sketch") {
    if (!sketch) return bad(hu ? "Ennél a rendelésnél nincs vázlatdíj (200 000 Ft alatt)." : "No sketch fee for this order.");
    const prod = await stripe(env, "GET", `/products/wb_${sketch}`);
    lineItems = [{ price: prod.default_price, quantity: 1 }];
    amount = sketchAmt;
    label = hu ? "Vázlatdíj" : "Sketch fee";
  } else {
    // Előleg: a végösszeg 50%-a; végösszeg: a maradék (a befizetett vázlatdíj és előleg levonásával).
    const paid = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) s, COALESCE(SUM(CASE WHEN kind='sketch' THEN amount ELSE 0 END),0) sk FROM payments WHERE project_id=?1 AND status='paid' AND kind IN ('sketch','deposit')").bind(id).first<{ s: number; sk: number }>();
    amount = kind === "deposit" ? Math.round(once / 2) - (paid?.sk ?? 0) : once - (paid?.s ?? 0);
    if (amount <= 0) return bad("Nincs fizetendő összeg.");
    label = kind === "deposit" ? (paid?.sk ? (hu ? "Előleg (50%, a vázlatdíj levonva)" : "Deposit (50%, sketch fee deducted)") : (hu ? "Előleg (50%)" : "Deposit (50%)")) : (hu ? "Végösszeg" : "Final payment");
    lineItems = [{ quantity: 1, price_data: { currency: cur.toLowerCase(), unit_amount: amount * 100, tax_behavior: "exclusive", product_data: { name: `${label} – ${p.title || id}` } } }];
  }

  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    currency: cur.toLowerCase(),
    line_items: lineItems,
    customer: p.stripe_customer_id || undefined,
    customer_email: p.stripe_customer_id ? undefined : p.email,
    customer_creation: p.stripe_customer_id ? undefined : "always",
    invoice_creation: { enabled: true, invoice_data: { description: `${label} – ${id}`, footer: "Tactical Edge Systems OÜ · Narva mnt 5, 10117 Tallinn · EE103014676" } },
    tax_id_collection: { enabled: true },
    after_expiration: { recovery: { enabled: true, allow_promotion_codes: false } },
    // A fiókon alapból be van kapcsolva a Managed Payments (Stripe mint értékesítő); mi magunk számlázunk, ezért kikapcsoljuk.
    managed_payments: { enabled: false },
    billing_address_collection: "required",
    locale: hu ? "hu" : "en",
    success_url: `${env.SITE_URL}/?paid=${kind}&order=${id}`,
    cancel_url: `${env.SITE_URL}/?order=${id}`,
    metadata: { project_id: id, customer_id: p.customer_id, kind },
    payment_intent_data: { metadata: { project_id: id, customer_id: p.customer_id, kind }, statement_descriptor_suffix: "WEBBRIDGE" },
  });

  await logEvent(env, { customer_id: p.customer_id, project_id: id, kind: "payment", actor: "zsolt", title: `Fizetési link: ${label} – ${money(amount, cur, lang)}`, meta: { session: session.id, url: session.url } });

  if (b.send !== false) {
    const subj = hu ? `${label}: ${money(amount, cur, "hu")} – ${id}` : `${label}: ${money(amount, cur, "en")} – ${id}`;
    const body = hu
      ? `<p>Szia${p.name ? " " + p.name : ""}!</p><p>Itt a fizetési link. Kártyával, Apple Pay-jel vagy Google Pay-jel fizethetsz, a számlát a Stripe automatikusan küldi.</p>${rows([["Rendelés", id], ["Tétel", label], ["Összeg (nettó)", money(amount, cur, "hu")]])}`
      : `<p>Hi${p.name ? " " + p.name : ""},</p><p>Here's your payment link. Pay by card, Apple Pay or Google Pay; Stripe sends the invoice automatically.</p>${rows([["Order", id], ["Item", label], ["Amount (net)", money(amount, cur, "en")]])}`;
    await sendMail(env, { to: p.email, subject: subj, html: layout(lang, label, body, { label: hu ? "Fizetés" : "Pay now", url: session.url }), template: `pay_${kind}`, customer_id: p.customer_id, project_id: id });
  }
  await touch(env, p.customer_id, id);
  return json({ ok: true, url: session.url, amount, currency: cur });
};

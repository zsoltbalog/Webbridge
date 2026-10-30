// POST /api/stripe-webhook – Stripe események: fizetés → CRM státusz + e-mail.
import { Env, json, nowIso, logEvent, touch, money, setStage, once } from "../../lib/core";
import { verifyStripeSig, stripe } from "../../lib/stripe";
import { sendMail, layout, rows } from "../../lib/mail";

// Havidíjas weboldalnál az első havidíj helyettesíti az előleget.
const NEXT_STAGE: Record<string, string> = { sketch: "sketch_paid", deposit: "deposit_paid", final: "live", subscription: "deposit_paid" };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ ok: false, error: "not configured" }, 503);
  const payload = await request.text();
  if (!(await verifyStripeSig(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json({ ok: false, error: "bad signature" }, 400);
  }
  const evt = JSON.parse(payload) as { id: string; type: string; data: { object: any } };

  // Idempotencia: minden eseményt csak egyszer dolgozunk fel.
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id,at,type) VALUES (?1,?2,?3)").bind(evt.id, nowIso(), evt.type).run();
  if (!ins.meta.changes) return json({ ok: true, duplicate: true });

  const o = evt.data.object;
  if (evt.type === "checkout.session.completed" && o.payment_status === "paid") {
    const md = o.metadata || {};
    const kind = md.kind || "other";
    const cur = String(o.currency || "").toUpperCase();
    const amount = Math.round(o.amount_total / 100);
    // Előfizetésnél a befizetést az invoice.paid esemény rögzíti (különben duplán számolnánk).
    if (o.mode !== "subscription") await env.DB.prepare("INSERT OR REPLACE INTO payments (id,at,customer_id,project_id,kind,amount,currency,status,raw) VALUES (?1,?2,?3,?4,?5,?6,?7,'paid',?8)")
      .bind(o.id, nowIso(), md.customer_id || null, md.project_id || null, kind, amount, cur, JSON.stringify({ payment_intent: o.payment_intent, invoice: o.invoice, email: o.customer_details?.email })).run();
    if (md.project_id && NEXT_STAGE[kind]) {
      const p = await env.DB.prepare("SELECT id, customer_id, stage FROM projects WHERE id=?1").bind(md.project_id).first<{ id: string; customer_id: string; stage: string }>();
      if (p) await setStage(env, p, NEXT_STAGE[kind], "customer");
    }
    if (o.customer && md.customer_id) {
      await env.DB.prepare("UPDATE customers SET stripe_customer_id=COALESCE(stripe_customer_id,?1) WHERE id=?2").bind(o.customer, md.customer_id).run();
    }
    await logEvent(env, { customer_id: md.customer_id, project_id: md.project_id, kind: "payment", actor: "customer", title: `Fizetve: ${kindHu(kind)} – ${money(amount, cur)}`, meta: { session: o.id } });
    await touch(env, md.customer_id, md.project_id);
    await sendMail(env, {
      to: env.NOTIFY_TO, subject: `💶 Fizetés: ${kindHu(kind)} ${money(amount, cur)} – ${md.project_id || ""}`, template: "internal_payment", customer_id: md.customer_id, project_id: md.project_id,
      html: layout("hu", "Fizetés érkezett", rows([["Projekt", md.project_id || "-"], ["Típus", kindHu(kind)], ["Összeg", money(amount, cur)], ["Ügyfél", o.customer_details?.email || ""]]), { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${md.customer_id || ""}` }),
    });
    // Az ügyfél nyugtáját/számláját a Stripe küldi, nem duplikáljuk.
  } else if (evt.type === "invoice.paid" || evt.type === "invoice.payment_failed") {
    const paid = evt.type === "invoice.paid";
    const cust = o.customer ? await env.DB.prepare("SELECT id FROM customers WHERE stripe_customer_id=?1").bind(o.customer).first<{ id: string }>() : null;
    const cur = String(o.currency || "").toUpperCase();
    const amount = Math.round((paid ? o.amount_paid : o.amount_due) / 100);
    const subId: string | null = o.subscription || o.parent?.subscription_details?.subscription || null;
    const smd = (o.subscription_details?.metadata || o.parent?.subscription_details?.metadata || {}) as Record<string, string>;
    await env.DB.prepare("INSERT OR REPLACE INTO payments (id,at,customer_id,project_id,kind,amount,currency,status,raw) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
      .bind(o.id, nowIso(), cust?.id ?? smd.customer_id ?? null, smd.project_id || null, subId ? "subscription" : "other", amount, cur, paid ? "paid" : "failed", JSON.stringify({ number: o.number, url: o.hosted_invoice_url, subscription: subId })).run();
    // Havidíjas weboldal: a 12. befizetett hónap után a havidíj az üzemeltetés díjára vált (egyszer).
    if (paid && subId && smd.months && smd.after_amount) {
      const n = await env.DB.prepare("SELECT COUNT(*) n FROM payments WHERE kind='subscription' AND status='paid' AND raw LIKE ?1").bind(`%"subscription":"${subId}"%`).first<{ n: number }>();
      if ((n?.n ?? 0) >= Number(smd.months) && (await once(env, subId, "sub-switch"))) {
        try {
          const sub = await stripe(env, "GET", `/subscriptions/${subId}`);
          const it = sub.items?.data?.[0];
          await stripe(env, "POST", `/subscriptions/${subId}`, { proration_behavior: "none", items: [{ id: it.id, price_data: { currency: String(smd.currency || cur).toLowerCase(), unit_amount: Number(smd.after_amount) * 100, tax_behavior: "exclusive", product: it.price.product, recurring: { interval: "month" } } }], metadata: { switched: "1" } });
          await logEvent(env, { customer_id: cust?.id ?? smd.customer_id, project_id: smd.project_id, kind: "payment", actor: "system", title: `Havidíjas weboldal: ${smd.months} hónap letelt, a havidíj ${money(Number(smd.after_amount), cur)}/hó lett` });
        } catch (e) {
          await sendMail(env, { to: env.NOTIFY_TO, subject: `⚠️ Előfizetés-váltás sikertelen – ${subId}`, template: "internal_sub_switch", html: layout("hu", "Előfizetés-váltás sikertelen", `<p>A ${smd.months}. hónap után nem sikerült átállítani a havidíjat (${String(e)}). Állítsd át kézzel a Stripe-ban ${money(Number(smd.after_amount), cur)}/hó-ra.</p>`) });
        }
      }
    }
    if (cust) await logEvent(env, { customer_id: cust.id, kind: "payment", title: `${paid ? "Számla fizetve" : "Sikertelen fizetés"}: ${o.number || o.id} – ${money(amount, cur)}`, body: paid ? undefined : `${o.attempt_count || 1}. próbálkozás. A Stripe automatikusan újrapróbálja, és e-mailben kéri az ügyfelet a kártya frissítésére.` });
    if (!paid) {
      // Teendő a legutóbbi projekten + belső értesítés (csak az első sikertelen próbálkozásnál).
      if (cust) {
        await env.DB.prepare("UPDATE projects SET next_action=?1, next_action_at=?2, updated_at=?2 WHERE id=(SELECT id FROM projects WHERE customer_id=?3 ORDER BY created_at DESC LIMIT 1)")
          .bind(`Sikertelen fizetés (${o.number || "előfizetés"}) – ha 3 napon belül sem rendeződik, hívd fel`, nowIso(), cust.id).run();
      }
      if ((o.attempt_count || 1) <= 1) {
        await sendMail(env, {
          to: env.NOTIFY_TO, subject: `⚠️ Sikertelen fizetés: ${money(amount, cur)} – ${o.customer_email || ""}`, template: "internal_payment_failed", customer_id: cust?.id,
          html: layout("hu", "Sikertelen fizetés", rows([["Számla", o.number || o.id], ["Összeg", money(amount, cur)], ["Ügyfél", o.customer_email || ""], ["Próbálkozás", String(o.attempt_count || 1)], ["Következő próbálkozás", o.next_payment_attempt ? new Date(o.next_payment_attempt * 1000).toLocaleString("hu-HU") : "nincs"]]), cust ? { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${cust.id}` } : undefined),
        });
      }
    }
  } else if (evt.type === "checkout.session.expired") {
    // Lejárt (ki nem fizetett) fizetési link: új link az ügyfélnek, egyszer, teendő nekünk.
    const md = o.metadata || {};
    const url: string | undefined = o.after_expiration?.recovery?.url;
    const p = md.project_id ? await env.DB.prepare("SELECT p.id, p.customer_id, p.stage, p.title, c.email, c.name, c.lang FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?1").bind(md.project_id).first<any>() : null;
    if (p) {
      const kind = md.kind || "other";
      const paidAlready = await env.DB.prepare("SELECT 1 FROM payments WHERE project_id=?1 AND kind=?2 AND status='paid'").bind(p.id, kind).first();
      await logEvent(env, { customer_id: p.customer_id, project_id: p.id, kind: "payment", title: `Lejárt fizetési link: ${kindHu(kind)}`, meta: { session: o.id, recovery: url } });
      if (!paidAlready) {
        await env.DB.prepare("UPDATE projects SET next_action=?1, next_action_at=?2 WHERE id=?3").bind(`Nem fizette ki: ${kindHu(kind)} – rákérdezni`, new Date(Date.now() + 2 * 864e5).toISOString(), p.id).run();
        if (url && p.email && (await once(env, p.id, `expired-${kind}`))) {
          const hu = p.lang !== "en";
          const body = hu
            ? `<p>Szia${p.name ? " " + p.name : ""}!</p><p>A korábban küldött fizetési link lejárt. Ha szeretnéd folytatni, itt egy új. Ha közben kérdésed van, vagy mást szeretnél, csak válaszolj erre a levélre.</p>`
            : `<p>Hi${p.name ? " " + p.name : ""},</p><p>The payment link we sent earlier has expired. If you'd like to go ahead, here's a fresh one. Any questions or changes, just reply to this email.</p>`;
          await sendMail(env, { to: p.email, subject: hu ? `Új fizetési link – ${p.id}` : `New payment link – ${p.id}`, html: layout(hu ? "hu" : "en", hu ? "Itt egy új link" : "Here's a fresh link", body, { label: hu ? "Folytatom" : "Continue", url }), template: "checkout_recovery", customer_id: p.customer_id, project_id: p.id });
        }
      }
    }
  }
  return json({ ok: true });
};

const kindHu = (k: string) => ({ sketch: "vázlatdíj", deposit: "előleg (50%)", final: "végösszeg", subscription: "előfizetés" } as Record<string, string>)[k] || k;

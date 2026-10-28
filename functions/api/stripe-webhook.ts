// POST /api/stripe-webhook – Stripe események: fizetés → CRM státusz + e-mail.
import { Env, json, nowIso, logEvent, touch, money } from "../../lib/core";
import { verifyStripeSig } from "../../lib/stripe";
import { sendMail, layout, rows } from "../../lib/mail";

const NEXT_STAGE: Record<string, string> = { sketch: "sketch_paid", deposit: "deposit_paid", final: "live" };

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
    await env.DB.prepare("INSERT OR REPLACE INTO payments (id,at,customer_id,project_id,kind,amount,currency,status,raw) VALUES (?1,?2,?3,?4,?5,?6,?7,'paid',?8)")
      .bind(o.id, nowIso(), md.customer_id || null, md.project_id || null, kind, amount, cur, JSON.stringify({ payment_intent: o.payment_intent, invoice: o.invoice, email: o.customer_details?.email })).run();
    if (md.project_id && NEXT_STAGE[kind]) {
      await env.DB.prepare("UPDATE projects SET stage=?1, updated_at=?2 WHERE id=?3").bind(NEXT_STAGE[kind], nowIso(), md.project_id).run();
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
    await env.DB.prepare("INSERT OR REPLACE INTO payments (id,at,customer_id,project_id,kind,amount,currency,status,raw) VALUES (?1,?2,?3,NULL,?4,?5,?6,?7,?8)")
      .bind(o.id, nowIso(), cust?.id ?? null, o.subscription ? "subscription" : "other", amount, cur, paid ? "paid" : "failed", JSON.stringify({ number: o.number, url: o.hosted_invoice_url })).run();
    if (cust) await logEvent(env, { customer_id: cust.id, kind: "payment", title: `${paid ? "Számla fizetve" : "Sikertelen fizetés"}: ${o.number || o.id} – ${money(amount, cur)}` });
  }
  return json({ ok: true });
};

const kindHu = (k: string) => ({ sketch: "vázlatdíj", deposit: "előleg (50%)", final: "végösszeg", subscription: "előfizetés" } as Record<string, string>)[k] || k;

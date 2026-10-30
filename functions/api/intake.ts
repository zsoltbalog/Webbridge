// POST /api/intake – a weboldal űrlapjai (rendelés, visszahívás, chat-érdeklődő) ide küldenek.
import { Env, json, bad, clean, isEmail, upsertCustomer, logEvent, cleanAttr, sourceLabel } from "../../lib/core";
import { sendMail, layout, rows } from "../../lib/mail";
import { createOrder } from "../../lib/order";

type Body = Record<string, unknown>;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let b: Body;
  try { b = (await request.json()) as Body; } catch { return bad("Érvénytelen kérés."); }
  if (clean(b.website)) return json({ ok: true }); // honeypot: botoknak csendben "ok"

  const kind = clean(b.kind, 20) || "order";
  const lang = clean(b.lang, 2) === "en" ? "en" : "hu";
  const hu = lang === "hu";

  if (kind === "callback") return callback(env, b, lang);
  if (kind === "chat") return chatLead(env, b, lang);

  // ---------- Rendelés / kérdőív ----------
  const email = clean(b.email, 200).toLowerCase();
  if (!isEmail(email)) return bad(hu ? "Adj meg egy érvényes e-mail-címet." : "Please enter a valid email address.");
  if (b.terms !== true) return bad(hu ? "Az ÁSZF elfogadása szükséges." : "Please accept the terms.");

  const o = await createOrder(env, b, { source: "form", waitUntil });
  return json({ ok: true, order: o.id, upload: o.upload });
};

async function callback(env: Env, b: Body, lang: string) {
  const hu = lang === "hu";
  const phone = clean(b.phone, 40);
  if (phone.replace(/\D/g, "").length < 8) return bad(hu ? "Adj meg egy telefonszámot." : "Please enter a phone number.");
  if (b.consent !== true) return bad(hu ? "A hozzájárulás szükséges." : "Consent is required.");
  const name = clean(b.name, 200), slot = clean(b.slot, 100);
  const cust = await upsertCustomer(env, { name, phone, lang, source: "callback" });
  await saveAttr(env, cust.id, b.attr);
  await logEvent(env, { customer_id: cust.id, kind: "call", actor: "customer", title: hu ? `Visszahívást kér: ${slot}` : `Callback requested: ${slot}`, body: `${name} ${phone}` });
  await env.DB.prepare("UPDATE customers SET tags=TRIM(tags||' callback') WHERE id=?1").bind(cust.id).run();
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `📞 Visszahívás: ${name || phone} – ${slot}`, template: "internal_callback", customer_id: cust.id,
    html: layout("hu", "Visszahívás kérés", rows([["Név", name], ["Telefon", phone], ["Időpont", slot], ["Nyelv", lang]]), { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${cust.id}` }),
  });
  return json({ ok: true });
}

async function chatLead(env: Env, b: Body, lang: string) {
  const email = clean(b.email, 200).toLowerCase();
  const transcript = clean(b.transcript, 8000);
  if (!isEmail(email)) return bad(lang === "hu" ? "Érvénytelen e-mail-cím." : "Invalid email.");
  const cust = await upsertCustomer(env, { email, name: clean(b.name, 200), lang, source: "chat" });
  await saveAttr(env, cust.id, b.attr);
  await logEvent(env, { customer_id: cust.id, kind: "lead", actor: "customer", title: lang === "hu" ? "Érdeklődés a chatből" : "Lead from chat", body: transcript });
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `💬 Chat-érdeklődő: ${email}`, template: "internal_chat", customer_id: cust.id, replyTo: email,
    html: layout("hu", "Chat-érdeklődő", `<pre style="white-space:pre-wrap;font-family:inherit">${transcript.replace(/[<>&]/g, "")}</pre>`, { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${cust.id}` }),
  });
  return json({ ok: true });
}

async function saveAttr(env: Env, customerId: string, raw: unknown) {
  const a = cleanAttr(raw);
  await env.DB.prepare("UPDATE customers SET attribution=?1 WHERE id=?2 AND (attribution IS NULL OR attribution='{}' OR attribution='')").bind(JSON.stringify({ ...a, source: sourceLabel(a) }), customerId).run();
}

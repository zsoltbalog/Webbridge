// POST /api/intake – a weboldal űrlapjai (rendelés, visszahívás, chat-érdeklődő) ide küldenek.
import { Env, json, bad, clean, isEmail, orderNo, nowIso, upsertCustomer, logEvent, priceOf, itemById, money, sketchAmount, cleanAttr, sourceLabel } from "../../lib/core";
import { sendMail, layout, rows } from "../../lib/mail";

type Body = Record<string, unknown>;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  const cur = clean(b.currency, 3) === "EUR" ? "EUR" : "HUF";
  const items = (Array.isArray(b.items) ? b.items : []).map((x) => clean(x, 20)).filter((x) => itemById(x));
  const { once, monthly } = priceOf(items, cur);
  const onceHuf = priceOf(items, "HUF").once;
  const business = clean(b.business, 200);

  const cust = await upsertCustomer(env, {
    email, business, name: clean(b.name, 200), phone: clean(b.phone, 40), lang,
    buyer_type: clean(b.buyer_type, 4) === "b2c" ? "b2c" : "b2b", company: clean(b.company, 200),
    vat_id: clean(b.vat_id, 40).toUpperCase(), billing_addr: clean(b.billing_addr, 400), currency: cur, source: "form",
  });

  const brief = {
    what: clean(b.what, 600), who: clean(b.who, 600), tone: clean(b.tone, 100), industry: clean(b.industry, 60),
    extra: clean(b.extra, 3000), files: (Array.isArray(b.files) ? b.files : []).slice(0, 20).map((x) => clean(x, 200)),
    start_now: b.start_now === true, invoice_lang: clean(b.invoice_lang, 2),
  };
  const id = orderNo();
  const t = nowIso();
  const attr = cleanAttr(b.attr);
  const src = sourceLabel(attr);
  await env.DB.prepare(
    "INSERT INTO projects (id,customer_id,created_at,updated_at,stage_at,title,stage,items,amount,currency,domain_mode,domain_name,brief,next_action,next_action_at,attribution) VALUES (?1,?2,?3,?3,?3,?4,'lead',?5,?6,?7,?8,?9,?10,?11,?12,?13)"
  ).bind(id, cust.id, t, business || email, JSON.stringify(items), once, cur, clean(b.domain_mode, 10) || null, clean(b.domain_name, 200) || null,
    JSON.stringify(brief), "Brief-összefoglaló küldése (1 órán belül)", new Date(Date.now() + 3600e3).toISOString(), JSON.stringify({ ...attr, source: src })).run();
  await env.DB.prepare("UPDATE customers SET attribution=?1 WHERE id=?2 AND (attribution IS NULL OR attribution='{}' OR attribution='')").bind(JSON.stringify({ ...attr, source: src }), cust.id).run();

  const itemNames = items.map((x) => itemById(x)![hu ? "hu" : "en"]).join(", ");
  await logEvent(env, {
    customer_id: cust.id, project_id: id, kind: "lead", actor: "customer",
    title: hu ? `Új rendelés: ${business || email}` : `New order: ${business || email}`,
    body: `${itemNames}\n${money(once, cur, lang)}${monthly ? ` + ${money(monthly, cur, lang)}/hó` : ""}`,
    meta: { items, once, monthly, currency: cur, source: src },
  });

  // Visszaigazolás az ügyfélnek
  const sketchFee = sketchAmount(onceHuf, cur);
  const subj = hu ? `Megkaptuk – ${id}` : `Received – ${id}`;
  const body = hu
    ? `<p>Köszönjük! Megkaptuk a kérésedet, a rendelésszámod: <b>${id}</b>.</p>
<p>Egy órán belül (munkaidőben) visszaküldjük írásban, amit megértettünk, és ha valami hiányzik, rákérdezünk. A 24 óra akkor indul, amikor ezt jóváhagyod.</p>
${rows([["Vállalkozás", business], ["Tételek", itemNames], ["Egyszeri díj (nettó)", money(once, cur, "hu")], ["Havidíj (nettó)", monthly ? money(monthly, cur, "hu") + "/hó" : ""], ["Vázlatdíj", sketchFee ? money(sketchFee, cur, "hu") + " (beszámítjuk)" : "nincs"]])}
<p>Csatolnál még valamit (logó, étlap, fotók)? Válaszolj erre a levélre, és tedd mellé.</p>`
    : `<p>Thank you! We've received your request. Your order number is <b>${id}</b>.</p>
<p>Within an hour (business hours) we'll send back in writing what we understood, and ask about anything missing. The 24 hours start when you approve it.</p>
${rows([["Business", business], ["Items", itemNames], ["One-off (net)", money(once, cur, "en")], ["Monthly (net)", monthly ? money(monthly, cur, "en") + "/mo" : ""], ["Sketch fee", sketchFee ? money(sketchFee, cur, "en") + " (credited)" : "none"]])}
<p>Anything to attach (logo, menu, photos)? Just reply to this email with it.</p>`;
  await sendMail(env, { to: email, subject: subj, html: layout(lang, hu ? "Megkaptuk, köszönjük!" : "Got it, thank you!", body), template: "order_received", customer_id: cust.id, project_id: id });

  // Belső értesítés
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `🟠 Új rendelés ${id} – ${business || email}`, template: "internal_new_order", customer_id: cust.id, project_id: id, replyTo: email,
    html: layout("hu", `Új rendelés: ${business || email}`, rows([["Rendelés", id], ["E-mail", email], ["Tételek", itemNames], ["Egyszeri", money(once, cur)], ["Havi", monthly ? money(monthly, cur) : ""], ["Domain", `${clean(b.domain_mode, 10)} ${clean(b.domain_name, 200)}`], ["Forrás", src + (attr.utm_campaign ? ` · ${attr.utm_campaign}` : "")], ["Mivel foglalkozik", brief.what], ["Vevők", brief.who], ["Hangnem", brief.tone], ["Egyéb", brief.extra]]),
      { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${cust.id}` }),
  });

  return json({ ok: true, order: id });
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

// POST /api/intake – a weboldal űrlapjai (rendelés, visszahívás, chat-érdeklődő) ide küldenek.
import { orderPrice, Env, json, bad, clean, isEmail, orderNo, nowIso, rid, esc, upsertCustomer, logEvent, priceOf, itemById, money, sketchAmount, cleanAttr, sourceLabel } from "../../lib/core";
import { sendMail, layout, rows } from "../../lib/mail";
import { normalizeUrl, reviewSite, SiteBrief } from "../../lib/site";

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

  const cur = clean(b.currency, 3) === "EUR" ? "EUR" : "HUF";
  const items = (Array.isArray(b.items) ? b.items : []).map((x) => clean(x, 20)).filter((x) => itemById(x));
  const firstClient = b.first_client === true;
  const payMode = clean(b.pay_mode, 4) === "sub" ? "sub" : "full";
  // Első ügyfél program (−30% az egyszeri díjakból) és havidíjas weboldal (12 hónap) – lásd orderPrice
  const op = orderPrice(items, cur, { first_client: firstClient, pay_mode: payMode });
  const once = op.once, monthly = op.monthly, sub = op.sub;
  const buyerType = clean(b.buyer_type, 4) === "b2c" ? "b2c" : "b2b";
  const vatId = clean(b.vat_id, 40).toUpperCase().replace(/[\s.-]/g, "");
  // Számlatípus: fogyasztó | fordított adózás (közösségi adószámmal) | adószám nélküli vállalkozás (ÁFA nélkül, reverse charge szöveg nélkül)
  const invoiceType = buyerType === "b2c" ? "consumer" : vatId ? "reverse_charge" : "no_vat_id";
  const onceHuf = priceOf(items, "HUF").once;
  const business = clean(b.business, 200);

  const cust = await upsertCustomer(env, {
    email, business, name: clean(b.name, 200), phone: clean(b.phone, 40), lang,
    buyer_type: buyerType, company: clean(b.company, 200),
    vat_id: vatId, billing_addr: clean(b.billing_addr, 400), currency: cur, source: "form",
  });

  const brief = {
    what: clean(b.what, 600), who: clean(b.who, 600), tone: clean(b.tone, 100), industry: clean(b.industry, 60),
    extra: clean(b.extra, 3000), files: (Array.isArray(b.files) ? b.files : []).slice(0, 20).map((x) => clean(x, 200)),
    start_now: b.start_now === true, invoice_lang: clean(b.invoice_lang, 2), invoice_type: invoiceType, first_client: firstClient, pay_mode: sub ? "sub" : "full", sub,
    site: siteFrom(b.site), upload_token: rid("up_", 24), uploads: [] as unknown[],
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
    meta: { items, once, monthly, currency: cur, source: src, invoice_type: invoiceType, first_client: firstClient, sub },
  });

  // Visszaigazolás az ügyfélnek
  const sketchFee = sketchAmount(onceHuf, cur);
  const subj = hu ? `Megkaptuk – ${id}` : `Received – ${id}`;
  const body = hu
    ? `<p>Köszönjük! Megkaptuk a kérésedet, a rendelésszámod: <b>${id}</b>.</p>
<p>Egy órán belül (munkaidőben) visszaküldjük írásban, amit megértettünk, és ha valami hiányzik, rákérdezünk. A 24 óra akkor indul, amikor ezt jóváhagyod.</p>
${rows([["Vállalkozás", business], ["Tételek", itemNames], ["Egyszeri díj (nettó)", money(once, cur, "hu") + (firstClient ? " (Első ügyfél kedvezménnyel, −30%)" : "")], ["Weboldal havidíjjal", sub ? `${money(sub.amount, cur, "hu")}/hó, 12 hónapig (a 13. hónaptól ${money(sub.after, cur, "hu")}/hó)` : ""], ["Havidíj (nettó)", monthly ? money(monthly, cur, "hu") + "/hó" : ""], ["Vázlatdíj", sketchFee ? money(sketchFee, cur, "hu") + " (beszámítjuk)" : "nincs"]])}
<p>Csatolnál még valamit (logó, étlap, fotók)? Válaszolj erre a levélre, és tedd mellé.</p>`
    : `<p>Thank you! We've received your request. Your order number is <b>${id}</b>.</p>
<p>Within an hour (business hours) we'll send back in writing what we understood, and ask about anything missing. The 24 hours start when you approve it.</p>
${rows([["Business", business], ["Items", itemNames], ["One-off (net)", money(once, cur, "en") + (firstClient ? " (first-client discount, −30%)" : "")], ["Website on monthly plan", sub ? `${money(sub.amount, cur, "en")}/mo for 12 months (from month 13: ${money(sub.after, cur, "en")}/mo)` : ""], ["Monthly (net)", monthly ? money(monthly, cur, "en") + "/mo" : ""], ["Sketch fee", sketchFee ? money(sketchFee, cur, "en") + " (credited)" : "none"]])}
<p>Anything to attach (logo, menu, photos)? Just reply to this email with it.</p>`;
  await sendMail(env, { to: email, subject: subj, html: layout(lang, hu ? "Megkaptuk, köszönjük!" : "Got it, thank you!", body), template: "order_received", customer_id: cust.id, project_id: id });

  // Belső értesítés
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `🟠 Új rendelés ${id} – ${business || email}`, template: "internal_new_order", customer_id: cust.id, project_id: id, replyTo: email,
    html: layout("hu", `Új rendelés: ${business || email}`, rows([["Rendelés", id], ["E-mail", email], ["Tételek", itemNames], ["Egyszeri", money(once, cur)], ["Havi", monthly ? money(monthly, cur) : ""], ["Domain", `${clean(b.domain_mode, 10)} ${clean(b.domain_name, 200)}`], ["Forrás", src + (attr.utm_campaign ? ` · ${attr.utm_campaign}` : "")], ["Mivel foglalkozik", brief.what], ["Vevők", brief.who], ["Hangnem", brief.tone], ["Egyéb", brief.extra], ["Meglévő oldal", brief.site ? brief.site.url : ""], ["Utasítások az oldalhoz", brief.site?.notes || ""], ["Oldalak", brief.site ? brief.site.pages.map((p) => `${p.title}: ${({ keep: "marad", change: "más legyen", drop: "nem kell" } as Record<string, string>)[p.choice] || p.choice}`).join("; ") : ""], ["Csatolt fájlok", brief.files.join(", ")]]) + (brief.site ? "<p><i>Az oldal automatikus átnézése pár perc múlva megjelenik a CRM idővonalán.</i></p>" : ""),
      { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${cust.id}` }),
  });

  if (brief.site) waitUntil(siteReviewJob(env, id, cust.id, brief.site, { business, what: brief.what, items: items.map((x) => itemById(x)!.hu) }));
  return json({ ok: true, order: id, upload: env.UPLOADS ? brief.upload_token : null });
};

function siteFrom(v: unknown): SiteBrief | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const u = normalizeUrl(clean(o.url, 500));
  const notes = clean(o.notes, 4000);
  if (!u && !notes) return null;
  const pages = (Array.isArray(o.pages) ? o.pages : []).slice(0, 25).map((p) => {
    const x = (p || {}) as Record<string, unknown>;
    const c = clean(x.choice, 10);
    return { url: clean(x.url, 500), title: clean(x.title, 100), choice: ["keep", "change", "drop"].includes(c) ? c : "keep" };
  }).filter((p) => p.url);
  return { url: u ? u.toString() : "", notes, pages };
}

async function siteReviewJob(env: Env, projectId: string, customerId: string, site: SiteBrief, ctx: { business: string; what: string; items: string[] }) {
  if (!site.url) return;
  const review = await reviewSite(env, site, ctx);
  if (!review) return;
  const cur = await env.DB.prepare("SELECT brief FROM projects WHERE id=?1").bind(projectId).first<{ brief: string }>();
  const b = JSON.parse(cur?.brief || "{}");
  b.site_review = review;
  await env.DB.prepare("UPDATE projects SET brief=?1 WHERE id=?2").bind(JSON.stringify(b), projectId).run();
  await logEvent(env, { customer_id: customerId, project_id: projectId, kind: "system", title: "A meglévő weboldal átnézve", body: review });
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `🔎 Meglévő oldal átnézve – ${projectId}`, template: "internal_site_review", customer_id: customerId, project_id: projectId,
    html: layout("hu", `Meglévő oldal: ${site.url}`, `<pre style="white-space:pre-wrap;font-family:inherit">${esc(review)}</pre>`, { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${customerId}` }),
  });
}

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

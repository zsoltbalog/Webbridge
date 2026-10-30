// POST /api/chat – a weboldali virtuális asszisztens (Anthropic Messages API, eszközökkel).
// A kliens küldi a beszélgetést és az oldal aktuális adatait (árlista, kosár); a szabályokat a szerver adja.
// Az űrlap/kosár eszközöket a böngésző hajtja végre; a „rad_var” (átadás Zsoltnak) itt fut.
import { Env, json, bad, clean, nowIso, rid, logEvent, esc } from "../../lib/core";
import { sendMail, layout } from "../../lib/mail";

const MODEL = "claude-haiku-5-5";
const MAX_PER_HOUR = 40;

const CLIENT_TOOLS = [
  { name: "fill_questionnaire", description: "Fill fields of the order questionnaire on the page. Only use business_name when the visitor explicitly told you the name of their business; never put a question or a sentence there. Pass only fields you learned.",
    input_schema: { type: "object", properties: { business_name: { type: "string" }, what: { type: "string", description: "What the business does, one sentence" }, customers: { type: "string", description: "Customers and location" }, tone: { type: "string", enum: ["friendly", "premium", "expert", "playful"] }, email: { type: "string" }, notes: { type: "string", description: "Anything else: goals, references, opening hours" } } } },
  { name: "set_cart", description: "Replace the cart with these item ids (from the ITEMS list). Only after the visitor agreed to your recommendation. Returns cart lines and totals.",
    input_schema: { type: "object", properties: { item_ids: { type: "array", items: { type: "string" } } }, required: ["item_ids"] } },
  { name: "set_industry", description: "Set the visitor's industry label (e.g. 'Fodrászat', 'Bakery') so the live preview matches.",
    input_schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] } },
];
const SERVER_TOOLS = [
  { name: "rad_var", description: "Hand the case to Zsolt (the owner) when you cannot resolve it: the visitor wants to talk to a person, negotiates price or wants a custom quote, has a complaint, an urgent problem, or a question you cannot answer from the facts given. Ask for their name and email first (and phone if they want a call back).",
    input_schema: { type: "object", properties: { reason: { type: "string", enum: ["price", "complaint", "urgent", "human", "unknown", "other"] }, caller_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, summary: { type: "string", description: "2-4 sentences in Hungarian: what they want, what you told them, what is open" }, callback: { type: "string", description: "How and when they want an answer" } }, required: ["reason", "summary"] } },
];

function rules(lang: string, ctx: string) {
  const hu = lang !== "en";
  return `You are the virtual assistant on the Webbridge website (a brand of Tactical Edge Systems OÜ, Tallinn, Estonia). Webbridge delivers websites, logos, brandbooks, marketing strategy and ongoing marketing for individuals and small businesses within 24 hours, at fixed prices. Most visitors are Hungarian small business owners.
Language: reply in ${hu ? "Hungarian, informal (tegezés)" : "English"}; if the visitor writes in the other language, switch to it.
MOST IMPORTANT: if the visitor asks a question, ANSWER IT FIRST, directly and concretely (prices, what is included, how payment works, VAT, timing), using only the facts below. Only then, optionally, ask ONE follow-up question. Never ignore a question to continue a script. Keep replies short: 1-4 sentences, plain text, no markdown.
Secondary job: understand their business and needs; when they share details, record them with fill_questionnaire; recommend items and, once they agree, put them in the cart with set_cart (item ids exactly as listed; only one of mkt1/mkt2/mkt3); set their industry with set_industry. Explain any jargon (domain, brandbook, SEO) in one simple sentence.
Talking to a person: Zsolt (the owner) does not take phone calls; if the visitor wants a person, has a complaint, wants to negotiate or a custom offer, has an urgent problem, or asks something you cannot answer reliably, collect name + email (and phone if they prefer a call back), then call rad_var, and tell them: we reply within one business day by email (same day if urgent).
Payment: first a sketch fee (free under 200 000 Ft / €520 one-off total, otherwise 19 900 Ft / €49) for 3 directions within 24 hours, credited to the total; 50% on choosing a direction; 50% on final approval. Unlimited small changes in the client Desk ("Pult") until 14 days after handover (30 days in Growth). If the client doesn't respond to a version for 7 days we send a reminder; after 7 more days it counts as approved. Monthly fees start at go-live and can be cancelled to the end of any month with at least 30 days notice, no penalty. Card payment via Stripe; invoice by email in HU or EN, HUF or EUR.
VAT: we are a limited VAT liable person (Estonia). Private individuals: the listed price is final, no VAT added. Businesses with an EU VAT number: net invoice under reverse charge, they self-assess the VAT. Businesses without an EU VAT number: tell them to ask their accountant how to handle VAT before ordering. Never give tax advice beyond this; offer rad_var if they want a written answer.
Domain: if they have none we register it in their name (.hu about two weeks at the registry; the site runs on a temporary address meanwhile); if they have one it stays with them and we point it to the new site, or we move it (Költöztetés). Domain, hosting and SSL setup is included in the one-page site; ongoing hosting, updates and backups are the Gondtalan üzemeltetés monthly service (otherwise they pay the providers directly and we set everything up in their accounts).
Existing sites: we don't auto-import from Wix, WordPress or Squarespace; with Költöztetés we move the content by hand and redesign it. Webshops: up to 30 products we build on our own system (Webshop indulócsomag); for bigger shops or many add-ons we use Shopify (they pay Shopify's subscription, we design, set up and market it); if they are already on Shopify or similar, they stay there and we redesign it.
Never invent prices, discounts, deadlines or features beyond these facts. No legal, tax or accounting advice. Never ask for card numbers or passwords. Never mention "artificial intelligence"; if asked whether you are human, say you are a virtual assistant.
PAGE DATA (items, bundles, current cart):
${ctx}`;
}

type Msg = { role: "user" | "assistant"; content: unknown };

async function limited(env: Env, ip: string) {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `chat:${ip}:${hour}`;
  await env.DB.prepare("INSERT INTO rate_limit (key,n,at) VALUES (?1,1,?2) ON CONFLICT(key) DO UPDATE SET n=n+1").bind(key, nowIso()).run();
  const r = await env.DB.prepare("SELECT n FROM rate_limit WHERE key=?1").bind(key).first<{ n: number }>();
  return (r?.n || 0) > MAX_PER_HOUR;
}

async function radVar(env: Env, i: Record<string, unknown>) {
  const REASONS = ["price", "complaint", "urgent", "human", "unknown", "other"];
  const reason = REASONS.includes(String(i.reason)) ? String(i.reason) : "other";
  const urgency = reason === "urgent" ? "urgent" : "normal";
  const e = { id: rid("esc_"), name: clean(i.caller_name, 120) || null, email: clean(i.email, 200).toLowerCase() || null, phone: clean(i.phone, 40) || null, summary: clean(i.summary, 3000) || "(nincs összefoglaló)", callback: clean(i.callback, 300) || null };
  await env.DB.prepare("INSERT INTO escalations (id,at,source,reason,urgency,caller_name,phone,email,summary,callback) VALUES (?1,?2,'chat',?3,?4,?5,?6,?7,?8,?9)")
    .bind(e.id, nowIso(), reason, urgency, e.name, e.phone, e.email, e.summary, e.callback).run();
  const title = `${urgency === "urgent" ? "SÜRGŐS · " : ""}Chat: ${reason}${e.name ? ` – ${e.name}` : ""}`;
  await logEvent(env, { kind: "note", actor: "assistant", title: `Rád vár · ${title}`, body: e.summary, meta: { escalation_id: e.id } });
  const rows = [["Ki", e.name], ["E-mail", e.email], ["Telefon", e.phone], ["Válasz", e.callback]].filter(([, v]) => v).map(([k, v]) => `<p><b>${k}:</b> ${esc(String(v))}</p>`).join("");
  await sendMail(env, { to: env.NOTIFY_TO, subject: `[Rád vár] ${title}`, template: "escalation", replyTo: e.email || undefined,
    html: layout("hu", title, `<p>A weboldali virtuális asszisztens ezt nem tudta elintézni.</p>${rows}<p style="white-space:pre-wrap;border-left:3px solid #ff6a1a;padding-left:12px">${esc(e.summary)}</p>`, { label: "CRM", url: `${env.SITE_URL}/admin/#rad-var` }) });
  return { ok: true };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ANTHROPIC_API_KEY) return bad("A chat most nem elérhető.", 503);
  const origin = request.headers.get("origin") || "";
  if (origin && new URL(origin).host !== new URL(request.url).host) return bad("Tiltott.", 403);
  const ip = request.headers.get("cf-connecting-ip") || "x";
  if (await limited(env, ip)) return json({ ok: false, code: "rate_limited" }, 429);
  const b = (await request.json().catch(() => ({}))) as { lang?: string; messages?: Msg[]; ctx?: string };
  const lang = b.lang === "en" ? "en" : "hu";
  let messages = (Array.isArray(b.messages) ? b.messages : []).slice(-30).filter((m) => m && (m.role === "user" || m.role === "assistant"));
  if (!messages.length || JSON.stringify(messages).length > 40000) return bad("Érvénytelen kérés.");
  const system = rules(lang, String(b.ctx || "").slice(0, 6000));
  const tools = [...CLIENT_TOOLS, ...SERVER_TOOLS];
  for (let step = 0; step < 4; step++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, system, tools, messages }),
    });
    if (!r.ok) return json({ ok: false, code: "upstream", status: r.status }, 502);
    const j = (await r.json()) as { content: { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }[]; stop_reason: string };
    const uses = j.content.filter((c) => c.type === "tool_use");
    if (j.stop_reason !== "tool_use" || !uses.length) return json({ ok: true, content: j.content });
    const serverUses = uses.filter((u) => u.name === "rad_var");
    if (serverUses.length === uses.length) {
      const results = [];
      for (const u of serverUses) results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await radVar(env, u.input || {})) });
      messages = [...messages, { role: "assistant", content: j.content }, { role: "user", content: results }];
      continue;
    }
    // A böngészőnek kell végrehajtania (űrlap/kosár); a szerveres eszközöket előre lefuttatjuk
    const done: Record<string, unknown> = {};
    for (const u of serverUses) done[u.id!] = await radVar(env, u.input || {});
    return json({ ok: true, content: j.content, tool_calls: uses.filter((u) => u.name !== "rad_var").map((u) => ({ id: u.id, name: u.name, input: u.input })), server_results: done });
  }
  return json({ ok: true, content: [{ type: "text", text: lang === "hu" ? "Elnézést, most elakadtam. Írd le még egyszer röviden, miben segíthetek?" : "Sorry, I got stuck. Could you say again briefly how I can help?" }] });
};

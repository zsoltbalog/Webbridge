// POST /api/voice/escalate?k=<CRON_SECRET> – a virtuális asszisztens (Telnyx webhook-eszköz) jelzi,
// ha egy ügyet nem tud elintézni. Mentjük, a CRM-ben „Rád vár” listába kerül, és e-mailt kap Zsolt.
// A hívót Zsolt NEM hívja vissza automatikusan: e-mailben/üzenetben válaszol, ahogy a hívó kérte.
import { Env, json, bad, clean, nowIso, rid, logEvent } from "../../../lib/core";
import { sendMail, layout } from "../../../lib/mail";

const REASONS: Record<string, string> = {
  price: "Árat alkudna / egyedi ajánlatot kér", complaint: "Panasz", urgent: "Sürgős ügy",
  human: "Emberrel szeretne beszélni", unknown: "Nem tudott válaszolni a kérdésre", other: "Egyéb",
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const k = new URL(request.url).searchParams.get("k") || "";
  if (!env.CRON_SECRET || k !== env.CRON_SECRET) return json({ ok: false }, 401);
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // A Telnyx a tool-paramétereket a törzs gyökerében vagy egy "arguments"/"parameters" mezőben küldheti.
  const b = ((raw.arguments || raw.parameters || raw) as Record<string, unknown>) || {};
  const reason = Object.keys(REASONS).includes(clean(b.reason, 20)) ? clean(b.reason, 20) : "other";
  const urgency = clean(b.urgency, 10) === "urgent" || reason === "urgent" ? "urgent" : "normal";
  const summary = clean(b.summary, 3000);
  if (!summary) return bad("Hiányzik az összefoglaló (summary).");
  const e = {
    id: rid("esc_"), at: nowIso(), source: clean(b.source, 10) === "chat" ? "chat" : "phone", reason, urgency,
    caller_name: clean(b.caller_name, 120) || null, phone: clean(b.phone, 40) || clean((raw as any).from, 40) || null,
    email: clean(b.email, 200).toLowerCase() || null, summary, callback: clean(b.callback, 300) || null,
  };
  const cust = e.email ? await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(e.email).first<{ id: string }>() : null;
  await env.DB.prepare("INSERT INTO escalations (id,at,source,reason,urgency,caller_name,phone,email,summary,callback,customer_id,meta) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")
    .bind(e.id, e.at, e.source, e.reason, e.urgency, e.caller_name, e.phone, e.email, e.summary, e.callback, cust?.id || null,
      JSON.stringify({ call_control_id: (raw as any).call_control_id || null, conversation_id: (raw as any).conversation_id || null })).run();
  const title = `${e.urgency === "urgent" ? "SÜRGŐS · " : ""}${e.source === "phone" ? "Telefon" : "Chat"}: ${REASONS[reason]}${e.caller_name ? ` – ${e.caller_name}` : ""}`;
  await logEvent(env, { customer_id: cust?.id || null, kind: "call", actor: "assistant", title: `Rád vár · ${title}`, body: e.summary, meta: { escalation_id: e.id } });
  const rows = [["Ki", e.caller_name], ["Telefon", e.phone], ["E-mail", e.email], ["Mit kér, hogyan válaszoljunk", e.callback]]
    .filter(([, v]) => v).map(([k2, v]) => `<tr><td style="color:#667;padding:4px 12px 4px 0">${k2}</td><td style="padding:4px 0"><b>${esc(String(v))}</b></td></tr>`).join("");
  const html = layout("hu", title, `<p>A virtuális asszisztens ezt nem tudta elintézni, rád vár.</p><table>${rows}</table><p style="white-space:pre-wrap;border-left:3px solid #ff6a1a;padding-left:12px">${esc(e.summary)}</p><p style="color:#667">A hívónak azt mondta, hogy egy munkanapon belül válaszolunk${e.urgency === "urgent" ? " (sürgősnek jelölte, ma)" : ""}.</p>`,
    { label: "Megnyitom a CRM-ben", url: `${env.SITE_URL}/admin/#rad-var` });
  const m = await sendMail(env, { to: env.NOTIFY_TO, subject: `[Rád vár] ${title}`, template: "escalation", customer_id: cust?.id || null, replyTo: e.email || undefined, html });
  // Válasz az asszisztensnek: ezt mondja a hívónak
  return json({ ok: true, id: e.id, mail: m.ok, say_hu: "Rendben, ezt továbbítottam a kollégámnak. Egy munkanapon belül válaszol, ahogy kérted.", say_en: "All right, I've passed this on to my colleague. They'll get back to you within one business day, the way you asked." });
};

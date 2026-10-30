// Észt ÁFA-értékhatár figyelése: a közösségi adószám nélküli vállalkozásoktól és a magánszemélyektől
// az idei évben befolyt összeg (fizetve, visszatérítés nélkül). Határ: 40 000 EUR (EMTA). A HUF-ot
// tájékoztató árfolyammal váltjuk (EUR_HUF változó, alapból 390) – a pontos számítás a könyvelőé.
import { Env, logEvent } from "./core";
import { sendMail, layout } from "./mail";

export const VAT_LIMIT_EUR = 40000;

export async function vatThreshold(env: Env) {
  const year = String(new Date().getUTCFullYear());
  const rate = Number((env as unknown as Record<string, string>).EUR_HUF) || 390;
  const rows = (await env.DB.prepare(
    "SELECT p.currency cur, SUM(p.amount) s FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.status='paid' AND substr(p.at,1,4)=?1 AND (c.buyer_type='b2c' OR c.vat_id IS NULL OR c.vat_id='') GROUP BY p.currency"
  ).bind(year).all<{ cur: string; s: number }>()).results;
  let eur = 0, huf = 0;
  for (const r of rows) { if ((r.cur || "").toUpperCase() === "EUR") eur += r.s || 0; else huf += r.s || 0; } // a payments.amount fő egységben van (Ft / €)
  const eur_equiv = Math.round(eur + huf / rate);
  return { year, eur: Math.round(eur), huf: Math.round(huf), rate, eur_equiv, limit: VAT_LIMIT_EUR, pct: Math.round((eur_equiv / VAT_LIMIT_EUR) * 100) };
}

// Cron: 50, 75 és 90%-nál egyszer-egyszer szól (e-mail + CRM esemény).
export async function vatAlert(env: Env) {
  const v = await vatThreshold(env);
  const level = [90, 75, 50].find((l) => v.pct >= l);
  if (!level) return 0;
  const title = `Észt ÁFA-határ ${v.year}: ${level}%`;
  const seen = await env.DB.prepare("SELECT 1 FROM events WHERE kind='vat_limit' AND title=?1 LIMIT 1").bind(title).first();
  if (seen) return 0;
  const body = `Az idei befizetések az adószám nélküli vállalkozásoktól és a magánszemélyektől kb. ${v.eur_equiv.toLocaleString("hu-HU")} € (${v.pct}%) a ${v.limit.toLocaleString("hu-HU")} €-s észt határból (${v.huf.toLocaleString("hu-HU")} Ft + ${v.eur.toLocaleString("hu-HU")} €, ${v.rate} Ft/€ tájékoztató árfolyammal). A határ átlépése előtt egyeztess a könyvelővel (1Office).`;
  await logEvent(env, { kind: "vat_limit", actor: "system", title, body, meta: v });
  await sendMail(env, { to: env.NOTIFY_TO, subject: `[Webbridge] ${title}`, template: "vat_limit", html: layout("hu", title, `<p>${body}</p>`, { label: "CRM", url: `${env.SITE_URL}/admin/` }) });
  return level;
}

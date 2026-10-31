// POST /api/cron – óránként hívja a GitHub Actions időzítő (x-cron-secret fejléccel).
// 1) ügyfél-emlékeztetők az elakadt lépéseknél, 2) értékeléskérés élesítés után 7 nappal,
// 3) reggeli belső összesítő az elakadt projektekről.
import { Env, json, money, logEvent, once, stuckInfo, STAGE_HU, esc } from "../../lib/core";
import { sendMail, layout } from "../../lib/mail";
import { instrNotify } from "../../lib/instructions";
import { vatAlert } from "../../lib/vatlimit";

type P = { id: string; customer_id: string; stage: string; stage_at: string; title: string; amount: number; currency: string; email: string; name: string; lang: string; next_action: string };

const H = 36e5;

// Ügyfélnek szóló emlékeztetők: státusz → (ennyi óra után, szöveg)
const NUDGE: Record<string, { after: number; hu: [string, string]; en: [string, string] }> = {
  brief_sent: {
    after: 48,
    hu: ["Jóváhagyod a briefet?", "Két napja elküldtük, amit megértettünk a vállalkozásodról. Ha rendben van, egy kattintással jóváhagyod, és indul a 24 óra. Ha valamit pontosítanál, csak válaszolj erre a levélre."],
    en: ["Ready to approve your brief?", "Two days ago we sent you what we understood about your business. If it looks right, approve it with one click and the 24 hours start. Anything to adjust? Just reply to this email."],
  },
  sketches: {
    after: 72,
    hu: ["Melyik irány tetszik?", "Elkészült a három vázlatirány. Írd meg, melyik a kedvenced (vagy mit vennél át a többiből), és abból készül el minden. Ha egyik sem az igazi, azt is írd meg nyugodtan."],
    en: ["Which direction do you like?", "Your three sketch directions are ready. Tell us your favourite (or what you'd borrow from the others) and we'll build everything from it. If none feels right, tell us that too."],
  },
  review: {
    after: 72,
    hu: ["Megnézted az előnézetet?", "Az oldalad előnézete vár rád a Pultban. Rábökhetsz bármelyik részére, ha változtatnál, vagy egy kattintással jóváhagyod, és élesítjük."],
    en: ["Have you checked your preview?", "Your site preview is waiting in the Desk. Tap any part you'd change, or approve it with one click and we'll put it live."],
  },
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.CRON_SECRET || request.headers.get("x-cron-secret") !== env.CRON_SECRET) return json({ ok: false }, 401);
  const now = Date.now();
  const out = { nudges: 0, reviews: 0, digest: 0, instr: 0, vat: 0 };
  out.instr = await instrNotify(env);
  out.vat = await vatAlert(env).catch(() => 0);
  // Adatmegőrzés: rendelés nélküli regisztrációk, 6 hónapja nem léptek be → havonta egyszer lista Zsoltnak törlésre
  try {
    const ym = new Date().toISOString().slice(0, 7);
    if (await once(env, `retention-${ym}`, "retention")) {
      const cut = new Date(Date.now() - 183 * 864e5).toISOString();
      const old = (await env.DB.prepare(
        "SELECT c.id, c.email, c.created_at, (SELECT MAX(s.created_at) FROM sessions s JOIN portal_users u ON u.id=s.user_id WHERE u.customer_id=c.id) last FROM customers c WHERE c.source LIKE 'signup:%' AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.customer_id=c.id)"
      ).all<{ id: string; email: string; created_at: string; last: string | null }>()).results.filter((r) => (r.last || r.created_at) < cut);
      if (old.length) await sendMail(env, { to: env.NOTIFY_TO, subject: `[Webbridge] ${old.length} rendelés nélküli fiók 6 hónapja inaktív – törlendő`, template: "internal_retention",
        html: layout("hu", "Törlendő inaktív fiókok", `<p>Az adatkezelési tájékoztató szerint a rendelés nélküli fiókokat az utolsó belépéstől számított 6 hónap után töröljük. Ezek esedékesek:</p><ul>${old.map((r) => `<li>${esc(r.email || r.id)} – utolsó belépés: ${esc((r.last || r.created_at).slice(0, 10))} (<a href="${env.SITE_URL}/admin/#c/${r.id}">CRM</a>)</li>`).join("")}</ul>`, { label: "CRM", url: `${env.SITE_URL}/admin/` }) });
    }
  } catch { /* nem kritikus */ }
  // Régi rate-limit sorok törlése (chat, MCP)
  await env.DB.prepare("DELETE FROM rate_limit WHERE at < ?1").bind(new Date(Date.now() - 3 * H).toISOString()).run().catch(() => null);

  const open = (await env.DB.prepare(
    "SELECT p.id, p.customer_id, p.stage, COALESCE(p.stage_at,p.updated_at) stage_at, p.title, p.amount, p.currency, p.next_action, c.email, c.name, c.lang FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.stage NOT IN ('lost')"
  ).all<P>()).results;

  for (const p of open) {
    const age = (now - Date.parse(p.stage_at)) / H;
    const hu = p.lang !== "en";

    // 1) Emlékeztető (státuszonként egyszer; újra belépésnél újra jár)
    const n = NUDGE[p.stage];
    if (n && p.email && age >= n.after && age < n.after + 24 * 14 && (await once(env, p.id, `nudge-${p.stage}@${p.stage_at}`))) {
      const [title, text] = hu ? n.hu : n.en;
      await sendMail(env, {
        to: p.email, subject: `${title} – ${p.id}`, template: `nudge_${p.stage}`, customer_id: p.customer_id, project_id: p.id,
        html: layout(hu ? "hu" : "en", title, `<p>${hu ? "Szia" : "Hi"}${p.name ? " " + p.name : ""}!</p><p>${text}</p>`),
      });
      await logEvent(env, { customer_id: p.customer_id, project_id: p.id, kind: "system", title: `Automatikus emlékeztető: ${title}` });
      out.nudges++;
    }

    // 2) Értékeléskérés: élesítés után 7 nappal (legfeljebb 30 napig próbáljuk)
    if ((p.stage === "live" || p.stage === "care") && env.REVIEW_URL && p.email && age >= 24 * 7 && age < 24 * 30 && (await once(env, p.id, "review_request"))) {
      const title = hu ? "Hogy vagy elégedett?" : "How did we do?";
      const text = hu
        ? "Egy hete él az oldalad. Ha elégedett vagy, sokat segítene egy rövid Google-értékelés: így talál ránk a következő vállalkozó is. Ha valami nem tökéletes, írd meg nekünk, és kijavítjuk."
        : "Your site has been live for a week. If you're happy, a short Google review would help a lot: it's how the next business owner finds us. If anything isn't right, tell us and we'll fix it.";
      await sendMail(env, {
        to: p.email, subject: hu ? `Egy kérésünk lenne – ${p.title || p.id}` : `A small favour – ${p.title || p.id}`, template: "review_request", customer_id: p.customer_id, project_id: p.id,
        html: layout(hu ? "hu" : "en", title, `<p>${hu ? "Szia" : "Hi"}${p.name ? " " + p.name : ""}!</p><p>${text}</p>`, { label: hu ? "Értékelés írása" : "Write a review", url: env.REVIEW_URL }),
      });
      await logEvent(env, { customer_id: p.customer_id, project_id: p.id, kind: "system", title: "Értékeléskérés elküldve" });
      out.reviews++;
    }
  }

  // 3) Reggeli összesítő (8:00 budapesti idő után, naponta egyszer, csak ha van elakadt ügy)
  const bud = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Budapest" }));
  if (bud.getHours() >= 8) {
    const stuck = open.map((p) => ({ p, s: stuckInfo(p.stage, p.stage_at) })).filter((x) => x.s?.stuck).sort((a, b) => b.s!.hours - a.s!.hours);
    const day = bud.toISOString().slice(0, 10);
    if (stuck.length && (await once(env, "_", `digest-${day}`))) {
      const list = `<table style="width:100%;border-collapse:collapse;margin:14px 0">${stuck.slice(0, 25).map(({ p, s }) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid #eee;vertical-align:top"><b>${esc(p.title || p.email)}</b><br><small style="color:#888">${esc(p.id)}</small></td><td style="padding:7px 0 7px 10px;border-bottom:1px solid #eee;vertical-align:top">${esc(STAGE_HU[p.stage] || p.stage)} · <b style="color:#b45309">${s!.hours} órája</b> <small style="color:#888">(határ: ${s!.limit} ó)</small>${p.amount ? " · " + esc(money(p.amount, p.currency)) : ""}${p.next_action ? "<br><small>" + esc(p.next_action) + "</small>" : ""}</td></tr>`).join("")}</table>`;
      await sendMail(env, {
        to: env.NOTIFY_TO, subject: `⏰ ${stuck.length} elakadt projekt – ${day}`, template: "internal_digest",
        html: layout("hu", `${stuck.length} projekt vár rád`, list, { label: "CRM megnyitása", url: `${env.SITE_URL}/admin/` }),
      });
      out.digest = stuck.length;
    }
  }
  return json({ ok: true, ...out });
};

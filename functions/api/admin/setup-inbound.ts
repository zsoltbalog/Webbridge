// POST /api/admin/setup-inbound – egyszeri beállítás: Brevo „inbound” webhook a REPLY_DOMAIN-re.
// A Brevo a reply.<domain> címre érkező leveleket feldolgozza, és JSON-ban elküldi az /api/pult/inbound végpontra.
// GET: a meglévő inbound webhookok listája (ellenőrzéshez).
import { Env, json, bad } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.BREVO_API_KEY) return bad("Nincs BREVO_API_KEY.", 503);
  const r = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", { headers: { "api-key": env.BREVO_API_KEY, accept: "application/json" } });
  const j = (await r.json().catch(() => ({}))) as { webhooks?: { id: number; url: string; domain?: string; events?: string[] }[] };
  return json({ ok: r.ok, reply_domain: env.REPLY_DOMAIN || null, webhooks: (j.webhooks || []).map((w) => ({ id: w.id, domain: w.domain, events: w.events, url: w.url.replace(/k=[^&]+/, "k=…") })) });
};

// POST ?step=domain – a REPLY_DOMAIN felvétele Brevo-domainként (a válasz tartalmazza a DNS-rekordokat)
// POST ?step=authenticate – a domain hitelesítésének indítása, miután a DNS-rekordok élnek
// POST ?step=status – a domain állapota
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  if (!env.BREVO_API_KEY || !env.CRON_SECRET || !env.REPLY_DOMAIN) return bad("Hiányzik: BREVO_API_KEY, CRON_SECRET vagy REPLY_DOMAIN.", 503);
  const step = new URL(request.url).searchParams.get("step");
  const H = { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" };
  if (step === "domain") {
    const r = await fetch("https://api.brevo.com/v3/senders/domains", { method: "POST", headers: H, body: JSON.stringify({ name: env.REPLY_DOMAIN }) });
    return json({ status: r.status, body: await r.json().catch(() => null) });
  }
  if (step === "authenticate") {
    const r = await fetch(`https://api.brevo.com/v3/senders/domains/${encodeURIComponent(env.REPLY_DOMAIN)}/authenticate`, { method: "PUT", headers: H });
    return json({ status: r.status, body: await r.json().catch(() => null) });
  }
  if (step === "status") {
    const r = await fetch(`https://api.brevo.com/v3/senders/domains/${encodeURIComponent(env.REPLY_DOMAIN)}`, { headers: H });
    return json({ status: r.status, body: await r.json().catch(() => null) });
  }
  const r = await fetch("https://api.brevo.com/v3/webhooks", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      type: "inbound", events: ["inboundEmailProcessed"], domain: env.REPLY_DOMAIN,
      url: `${env.SITE_URL}/api/pult/inbound?k=${encodeURIComponent(env.CRON_SECRET)}`,
      description: "Webbridge Pult – válaszlevelek megjegyzésként",
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: number; message?: string };
  return r.ok ? json({ ok: true, id: j.id }) : bad(`Brevo: ${r.status} ${j.message || ""}`, 502);
};

// Webbridge háttérrendszer: közös segédfüggvények (Cloudflare Pages Functions).

export interface Env {
  DB: D1Database;
  SITE_URL: string;                 // pl. https://webbridge.hu
  MAIL_FROM: string;                // hello@webbridge.hu
  MAIL_FROM_NAME: string;           // Webbridge
  NOTIFY_TO: string;                // belső értesítés címe (hello@webbridge.hu)
  ADMIN_PASSWORD?: string;          // titok: a /admin CRM jelszava
  BREVO_API_KEY?: string;           // titok
  STRIPE_SECRET_KEY?: string;       // titok (restricted key)
  STRIPE_WEBHOOK_SECRET?: string;   // titok (whsec_…)
  ANTHROPIC_API_KEY?: string;       // titok (Pult AI, később)
  CRON_SECRET?: string;             // titok: az óránkénti időzítő (/api/cron) kulcsa
  REVIEW_URL?: string;              // Google-értékelés link (értékeléskérő levélhez)
  GOOGLE_CLIENT_ID?: string;        // Pult Google-belépés (OAuth-kliens, TES Google Cloud projekt)
  GOOGLE_CLIENT_SECRET?: string;    // titok
  REPLY_DOMAIN?: string;            // bejövő válaszlevelek aldomainje (pl. reply.webbridge.hu)
  UPLOADS?: R2Bucket;               // R2: az ügyfelek feltöltött fájljai (projects/<rendelés>/…)
}

export type Ctx = EventContext<Env, string, Record<string, unknown>>;

export const nowIso = () => new Date().toISOString();

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export const bad = (msg: string, status = 400) => json({ ok: false, error: msg }, status);

export function rid(prefix: string, n = 10) {
  const a = "abcdefghijkmnopqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(n));
  return prefix + Array.from(b, (x) => a[x % a.length]).join("");
}

/** Rendelésszám: WB-YYMMDD-XXXX */
export function orderNo() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(4));
  return `WB-${d}-${Array.from(b, (x) => a[x % a.length]).join("")}`;
}

export const clean = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- Árlista (a Stripe-katalógussal azonos, nettó) ----------
export interface Item { id: string; huf: number; eur: number; monthly?: boolean; hu: string; en: string }
export const CATALOG: Item[] = [
  { id: "landing", huf: 99900, eur: 259, hu: "Egyoldalas weboldal", en: "One-page website" },
  { id: "site", huf: 199900, eur: 519, hu: "Céges weboldal", en: "Business website" },
  { id: "shop", huf: 399900, eur: 1039, hu: "Webshop indulócsomag", en: "Webshop starter" },
  { id: "logo", huf: 59900, eur: 159, hu: "Logótervezés", en: "Logo design" },
  { id: "brand", huf: 89900, eur: 229, hu: "Brandbook", en: "Brandbook" },
  { id: "strategy", huf: 129900, eur: 339, hu: "Marketingstratégia", en: "Marketing strategy" },
  { id: "plan", huf: 59900, eur: 159, hu: "90 napos marketingterv", en: "90-day marketing plan" },
  { id: "setup", huf: 39900, eur: 99, hu: "Pro technikai csomag", en: "Pro technical package" },
  { id: "move", huf: 29900, eur: 75, hu: "Költöztetés", en: "Migration" },
  { id: "lang", huf: 49900, eur: 129, hu: "+1 nyelv", en: "+1 language" },
  { id: "newpage", huf: 19900, eur: 49, hu: "Új aloldal", en: "New page" },
  { id: "care", huf: 9900, eur: 25, monthly: true, hu: "Gondtalan üzemeltetés", en: "Carefree hosting" },
  { id: "mkt1", huf: 39900, eur: 99, monthly: true, hu: "Marketing · Minimális", en: "Marketing · Minimal" },
  { id: "mkt2", huf: 79900, eur: 199, monthly: true, hu: "Marketing · Közepes", en: "Marketing · Medium" },
  { id: "mkt3", huf: 149900, eur: 379, monthly: true, hu: "Marketing · Maximális", en: "Marketing · Maximum" },
  { id: "shopcare", huf: 29900, eur: 79, monthly: true, hu: "Webshop-üzemeltetés", en: "Webshop care" },
  { id: "email", huf: 3490, eur: 9, monthly: true, hu: "Céges e-mail", en: "Business email" },
  { id: "chat", huf: 19900, eur: 49, monthly: true, hu: "Virtuális asszisztens a weboldalon", en: "Website assistant" },
  { id: "phone", huf: 29900, eur: 79, monthly: true, hu: "Virtuális recepciós", en: "Virtual receptionist" },
  { id: "extra", huf: 9900, eur: 25, monthly: true, hu: "Extra marketingcsatorna", en: "Extra marketing channel" },
];
export const itemById = (id: string) => CATALOG.find((x) => x.id === id);

export function priceOf(ids: string[], cur: "HUF" | "EUR") {
  let once = 0, monthly = 0;
  for (const id of ids) {
    const it = itemById(id);
    if (!it) continue;
    const v = cur === "EUR" ? it.eur : it.huf;
    if (it.monthly) monthly += v; else once += v;
  }
  return { once, monthly };
}

/** Vázlatdíj: 200 000 Ft (≈ €520) alatt nincs, felette 19 900 Ft / €49 (Stripe: wb_sketch_l). */
export function sketchFor(onceHuf: number) { return onceHuf >= 200000 ? "sketch_l" : null; }
export function sketchAmount(onceHuf: number, cur: string) { return sketchFor(onceHuf) ? (cur === "EUR" ? 49 : 19900) : 0; }

export function money(v: number, cur: string, lang = "hu") {
  return cur === "EUR"
    ? new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v)
    : new Intl.NumberFormat("hu-HU").format(v) + " Ft";
}

// ---------- Stage-ek ----------
export const STAGES = ["lead", "brief_sent", "brief_ok", "sketch_paid", "sketches", "deposit_paid", "building", "review", "live", "care", "lost"] as const;
export const STAGE_HU: Record<string, string> = {
  lead: "Új érdeklődő", brief_sent: "Brief elküldve", brief_ok: "Brief jóváhagyva", sketch_paid: "Vázlatdíj fizetve",
  sketches: "Vázlatok kint", deposit_paid: "Előleg fizetve", building: "Készül", review: "Ügyfél nézi",
  live: "Élesítve", care: "Üzemeltetés", lost: "Elveszett",
};

// ---------- DB segédek ----------
export async function logEvent(env: Env, e: { customer_id?: string | null; project_id?: string | null; kind: string; title: string; body?: string; meta?: unknown; actor?: string }) {
  await env.DB.prepare("INSERT INTO events (at,customer_id,project_id,kind,title,body,meta,actor) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
    .bind(nowIso(), e.customer_id ?? null, e.project_id ?? null, e.kind, e.title, e.body ?? null, JSON.stringify(e.meta ?? {}), e.actor ?? "system")
    .run();
}

export async function touch(env: Env, customerId?: string | null, projectId?: string | null) {
  const t = nowIso();
  const s: D1PreparedStatement[] = [];
  if (customerId) s.push(env.DB.prepare("UPDATE customers SET updated_at=?1 WHERE id=?2").bind(t, customerId));
  if (projectId) s.push(env.DB.prepare("UPDATE projects SET updated_at=?1 WHERE id=?2").bind(t, projectId));
  if (s.length) await env.DB.batch(s);
}

/** Ügyfél keresése e-mail alapján, vagy új létrehozása. */
export async function upsertCustomer(env: Env, c: Record<string, string>) {
  const t = nowIso();
  const email = (c.email || "").toLowerCase();
  if (email) {
    const ex = await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(email).first<{ id: string }>();
    if (ex) {
      await env.DB.prepare(
        "UPDATE customers SET updated_at=?1, name=COALESCE(NULLIF(?2,''),name), business=COALESCE(NULLIF(?3,''),business), phone=COALESCE(NULLIF(?4,''),phone), lang=COALESCE(NULLIF(?5,''),lang), buyer_type=COALESCE(NULLIF(?6,''),buyer_type), company=COALESCE(NULLIF(?7,''),company), vat_id=COALESCE(NULLIF(?8,''),vat_id), billing_addr=COALESCE(NULLIF(?9,''),billing_addr), currency=COALESCE(NULLIF(?10,''),currency) WHERE id=?11"
      ).bind(t, c.name || "", c.business || "", c.phone || "", c.lang || "", c.buyer_type || "", c.company || "", c.vat_id || "", c.billing_addr || "", c.currency || "", ex.id).run();
      return { id: ex.id, isNew: false };
    }
  }
  const id = rid("cus_");
  await env.DB.prepare(
    "INSERT INTO customers (id,created_at,updated_at,name,business,email,phone,lang,buyer_type,company,vat_id,billing_addr,currency,source) VALUES (?1,?2,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"
  ).bind(id, t, c.name || null, c.business || null, email || null, c.phone || null, c.lang || "hu", c.buyer_type || null, c.company || null, c.vat_id || null, c.billing_addr || null, c.currency || "HUF", c.source || "form").run();
  return { id, isNew: true };
}

/** Csúszásjelző: ennyi óra után számít elakadtnak egy projekt az adott státuszban. */
export const STUCK_HOURS: Record<string, number> = {
  lead: 4, brief_sent: 48, brief_ok: 24, sketch_paid: 24, sketches: 72, deposit_paid: 24, building: 24, review: 72,
};
export function stuckInfo(stage: string, stageAt?: string | null) {
  const lim = STUCK_HOURS[stage];
  if (!lim || !stageAt) return null;
  const h = (Date.now() - Date.parse(stageAt)) / 36e5;
  return { hours: Math.round(h), limit: lim, stuck: h > lim };
}

/** Státuszváltás egy helyen: stage_at is frissül, az idővonalra is kerül. */
export async function setStage(env: Env, p: { id: string; customer_id: string; stage: string }, stage: string, actor = "system") {
  if (stage === p.stage) return;
  const t = nowIso();
  await env.DB.prepare("UPDATE projects SET stage=?1, stage_at=?2, updated_at=?2 WHERE id=?3").bind(stage, t, p.id).run();
  if (stage === "brief_ok") await env.DB.prepare("UPDATE projects SET due_at=?1 WHERE id=?2").bind(new Date(Date.now() + 864e5).toISOString(), p.id).run();
  await logEvent(env, { customer_id: p.customer_id, project_id: p.id, kind: "stage", actor, title: `Státusz: ${STAGE_HU[p.stage] || p.stage} → ${STAGE_HU[stage] || stage}` });
}

/** Egyszeri művelet-zár (emlékeztetők, összesítő): true, ha most először fut. */
export async function once(env: Env, projectId: string, key: string) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO reminders (project_id,key,at) VALUES (?1,?2,?3)").bind(projectId, key, nowIso()).run();
  return !!r.meta.changes;
}

/** Lead-forrás tisztítása (a weboldal küldi: első érintés). */
export function cleanAttr(v: unknown) {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer", "gclid", "fbclid", "ref", "landing", "first_at"];
  const r: Record<string, string> = {};
  for (const k of keys) { const x = clean(o[k], 300); if (x) r[k] = x; }
  return r;
}
/** Egy szavas forráscímke a riporthoz. */
export function sourceLabel(a: Record<string, string>) {
  if (a.ref) return "ajánlás";
  if (a.gclid || /google/i.test(a.utm_source || "") && /cpc|ppc|paid/i.test(a.utm_medium || "")) return "google ads";
  if (a.fbclid || /facebook|instagram|meta|fb|ig/i.test(a.utm_source || "")) return "meta";
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.referrer) { try { const h = new URL(a.referrer).hostname.replace(/^www\./, ""); if (/google\./.test(h)) return "google organikus"; if (/bing\.|duckduckgo/.test(h)) return "kereső"; return h; } catch { /* */ } }
  return "közvetlen";
}

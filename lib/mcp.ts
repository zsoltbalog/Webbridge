// MCP (Model Context Protocol) eszközök: az ügyfél a saját AI-asszisztenséből (Claude, ChatGPT…) éri el a Webbridge-et.
// Nyilvános szint: ajánlat, árajánlat, rendelés indítása (megerősítéssel). Személyes szint (connector-link a Pultból):
// projektek, előnézetek, megjegyzések, módosításkérés, jóváhagyás, kiegészítő rendelés – a Pult szerepköri szabályaival.
import { Env, clean, isEmail, nowIso, rid, orderNo, logEvent, touch, itemById, orderPrice, priceOf, CATALOG, SUBS, SUB_MONTHS } from "./core";
import { sendMail, layout, rows } from "./mail";
import { sha256, randToken, workFor, PUser, KIND_HU, KIND_EN } from "./portal";
import { addComment, approveVersion, feedbackSubmitted, versionPosts, setPostDecision, POST_ID_RE, Work } from "./works";
import { createOrder } from "./order";
import { BUNDLES, ITEM_INFO, offerData, quote, quoteText, vatText, fmt, itemName, Cur, Lang } from "./offer";

export const SERVER_VERSION = "1.0.0";
const TOKEN_PREFIX = "wbm_";
export const LIMITS = { publicPerHour: 120, tokenPerHour: 600, ipWithTokenPerHour: 1200, ordersPerIpHour: 5, ordersPerEmailDay: 3, servicesPerCustomerDay: 5, commentsPerCustomerDay: 60 };

// ---------- Auth: személyes connector-token ----------
export interface McpAuth { user: PUser | null; tokenId: string | null; invalid: boolean }

export function tokenFrom(req: Request) {
  const u = new URL(req.url);
  const h = req.headers.get("authorization") || "";
  const k = u.searchParams.get("k") || (/^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : "");
  return k.slice(0, 200);
}

export async function authToken(env: Env, tok: string): Promise<McpAuth> {
  if (!tok) return { user: null, tokenId: null, invalid: false };
  if (!tok.startsWith(TOKEN_PREFIX) || tok.length < 30) return { user: null, tokenId: null, invalid: true };
  const row = await env.DB.prepare(
    "SELECT t.id AS tid, t.last_used_at, u.id, u.customer_id, u.email, u.name, u.role, u.lang FROM mcp_tokens t JOIN portal_users u ON u.id=t.user_id AND u.customer_id=t.customer_id WHERE t.token_hash=?1 AND t.revoked_at IS NULL AND u.disabled=0"
  ).bind(await sha256(tok)).first<PUser & { tid: string; last_used_at: string | null }>();
  if (!row) return { user: null, tokenId: null, invalid: true };
  // utolsó használat: legfeljebb 5 percenként írjuk
  if (!row.last_used_at || Date.parse(row.last_used_at) < Date.now() - 5 * 6e4)
    await env.DB.prepare("UPDATE mcp_tokens SET last_used_at=?1 WHERE id=?2").bind(nowIso(), row.tid).run();
  return { user: { id: row.id, customer_id: row.customer_id, email: row.email, name: row.name, role: row.role, lang: row.lang }, tokenId: row.tid, invalid: false };
}

export async function createToken(env: Env, u: PUser, label: string) {
  const tok = TOKEN_PREFIX + randToken();
  const id = rid("mcp_");
  await env.DB.prepare("INSERT INTO mcp_tokens (id,user_id,customer_id,token_hash,label,created_at) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(id, u.id, u.customer_id, await sha256(tok), label || null, nowIso()).run();
  return { id, token: tok, url: `${env.SITE_URL}/mcp?k=${tok}` };
}

/** Óránkénti számláló a rate_limit táblában (mint a chat.ts limited()); true, ha túllépte. */
export async function overLimit(env: Env, key: string, max: number, n = 1, window: "hour" | "day" = "hour") {
  const slot = new Date().toISOString().slice(0, window === "hour" ? 13 : 10);
  const r = await env.DB.prepare("INSERT INTO rate_limit (key,n,at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET n=n+?2 RETURNING n")
    .bind(`${key}:${slot}`, n, nowIso()).first<{ n: number }>();
  return (r?.n || 0) > max;
}

// ---------- Eszköz-eredmények ----------
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult { content: Content[]; structuredContent?: Record<string, unknown>; isError?: boolean }
const ok = (text: string, data?: Record<string, unknown>, extra: Content[] = []): ToolResult => ({ content: [{ type: "text", text }, ...extra], ...(data ? { structuredContent: data } : {}) });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export interface McpCtx { env: Env; auth: McpAuth; ip: string; waitUntil: (p: Promise<unknown>) => void }

const langOf = (a: Record<string, unknown>): Lang => (a.lang === "en" ? "en" : "hu");
const curOf = (v: unknown, def: Cur = "HUF"): Cur => (v === "EUR" ? "EUR" : v === "HUF" ? "HUF" : def);
const ids = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 40).map((x) => clean(x, 20)).filter(Boolean);
const PULT = (env: Env) => `${env.SITE_URL}/pult/`;
const ASZF = (env: Env) => `${env.SITE_URL}/#aszf`;

function needUser(ctx: McpCtx, lang: Lang): ToolResult | null {
  if (ctx.auth.user) return null;
  const hu = lang === "hu";
  if (ctx.auth.invalid) return fail(hu
    ? `Ez a connector-link érvénytelen, vagy visszavonták. Lépj be a Pultba (${PULT(ctx.env)}), a „Saját AI-asszisztens bekötése” résznél hozz létre egy új linket, és cseréld le vele a connectort.`
    : `This connector link is invalid or has been revoked. Sign in to the Desk (${PULT(ctx.env)}), create a new link under "Connect your own AI assistant", and replace the connector with it.`);
  return fail(hu
    ? `Ehhez személyes connector kell (needs a personal connector). A nyilvános címmel (${ctx.env.SITE_URL}/mcp) csak az ajánlatot, árajánlatot és új rendelést éred el. A saját projektjeidhez lépj be a Pultba (${PULT(ctx.env)}), a „Saját AI-asszisztens bekötése” résznél hozz létre egy személyes linket, és add hozzá connectorként a nyilvános helyett. Útmutató: ${ctx.env.SITE_URL}/ai/`
    : `This needs a personal connector. The public address (${ctx.env.SITE_URL}/mcp) only gives access to the offer, quotes and new orders. For your own projects, sign in to the Desk (${PULT(ctx.env)}), create a personal link under "Connect your own AI assistant", and add it as a connector instead of the public one. Guide: ${ctx.env.SITE_URL}/ai/?lang=en`);
}

// ---------- Eszközleírások ----------
const LANG_P = { lang: { type: "string", enum: ["hu", "en"], description: "Answer language: hu (Hungarian, informal) or en. Default hu." } };
const CUR_P = { currency: { type: "string", enum: ["HUF", "EUR"], description: "Currency. Hungarian customers usually HUF." } };
const BUYER_P = { buyer_type: { type: "string", enum: ["b2b", "b2c"], description: "b2b = business/sole trader, b2c = private person. Affects only invoicing/VAT wording; prices are the same." } };
const PAY_P = { pay_mode: { type: "string", enum: ["full", "sub"], description: "full = one-off price (default); sub = website on the monthly plan (12-month contract), only if a website item (landing/site/shop) is included." } };
const FIRST_P = { first_client: { type: "boolean", description: "First-client programme: −30% on one-off fees in exchange for showing the finished work as a reference (first 5 clients, in order of orders)." } };
const ITEMS_P = { type: "array", items: { type: "string", enum: CATALOG.map((c) => c.id) }, description: "Item ids from get_services, e.g. [\"landing\",\"logo\"]." };
const CONFIRM_P = { confirm: { type: "boolean", description: "Leave false/omit first: you get a summary to show the user. Only after the user explicitly says yes, call again with the same arguments and confirm:true." } };

export const TOOLS = [
  { name: "get_services", title: "Webbridge offer and prices",
    description: "Public. The full Webbridge offer: every item with net HUF/EUR price and what is included, bundles, the monthly website plan, first-client programme, risk-free start, payment steps, sketch fee rule, VAT rules and timing. Use this before quoting; never invent prices.",
    inputSchema: { type: "object", properties: { ...LANG_P } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_quote", title: "Price quote",
    description: "Public. Exact quote for a set of item ids: one-off and monthly totals, sketch fee, payment schedule, monthly website plan details, and any bundle that would be cheaper. Use the numbers as returned.",
    inputSchema: { type: "object", properties: { item_ids: ITEMS_P, ...CUR_P, ...BUYER_P, ...PAY_P, ...FIRST_P, ...LANG_P }, required: ["item_ids"] }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "start_order", title: "Start an order (non-binding)",
    description: "Public. Sends a new order request to Webbridge, exactly like the order form on webbridge.hu. Nothing is binding and nothing is paid here: the customer gets a confirmation email, Webbridge replies with a written summary (brief) that the customer approves by email, and only then the 24 hours start. First call WITHOUT confirm to get a summary and price; show it to the user and ask for explicit confirmation; then call again with confirm:true. Sending implies accepting the terms (ÁSZF).",
    inputSchema: { type: "object", properties: {
      business: { type: "string", description: "Name of the business (or the person's name if private)." },
      email: { type: "string", description: "Customer's email address; confirmation and the brief go here." },
      what: { type: "string", description: "What the business does, 1–2 sentences." },
      customers: { type: "string", description: "Who the customers are and where." },
      items: ITEMS_P, ...CUR_P, ...BUYER_P, ...PAY_P, ...FIRST_P,
      liked_sites: { type: "array", items: { type: "string" }, maxItems: 3, description: "Up to 3 website addresses the customer likes as examples." },
      existing_site: { type: "string", description: "Address of the customer's current website, if any." },
      notes: { type: "string", description: "Anything else: goals, opening hours, domain they own, wishes." },
      name: { type: "string", description: "Contact person's name (optional)." },
      phone: { type: "string", description: "Phone (optional)." },
      vat_id: { type: "string", description: "EU VAT number for businesses (e.g. HU12345678), optional." },
      ...CONFIRM_P, ...LANG_P }, required: ["business", "email", "what", "items", "currency", "buyer_type"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: "my_projects", title: "My projects",
    description: "Personal connector required. The customer's Webbridge projects/orders: stage in plain words, next step, amounts, payment mode, due date and what has been paid.",
    inputSchema: { type: "object", properties: { ...LANG_P } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_preview", title: "Latest versions and previews",
    description: "Personal connector required. The customer's works (logo, brand, website, document, posts…) with their latest version, status, files, live preview URL (websites) and a link to open each in the client Desk (Pult). With include_images (default true when work_id is given) the latest version's images are attached so you can show/describe them.",
    inputSchema: { type: "object", properties: { project_id: { type: "string", description: "Order number (WB-…) to filter by." }, work_id: { type: "string", description: "A single work (wrk_…)." }, include_images: { type: "boolean" }, ...LANG_P } },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "list_comments", title: "Change requests and comments",
    description: "Personal connector required. Existing change requests/comments on a work (all versions or one), with status (open, in progress, done, verified) and replies from Webbridge.",
    inputSchema: { type: "object", properties: { work_id: { type: "string" }, version_id: { type: "string", description: "Optional: ver_… id or version number." }, ...LANG_P }, required: ["work_id"] },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "request_change", title: "Request a change",
    description: "Personal connector required. Adds a change request on the latest (or given) version of a work, as if the customer wrote it in the Desk; Webbridge is notified. Write the text in the customer's words (e.g. \"Legyen nagyobb a logó\"). If you add several requests in a row, set more_to_come:true on all but the last so they are sent together. Only versions that are waiting for feedback can be commented.",
    inputSchema: { type: "object", properties: {
      work_id: { type: "string" }, version_id: { type: "string", description: "Optional: ver_… id or version number; default latest." },
      text: { type: "string", description: "The change request, max 4000 characters." },
      action: { type: "string", enum: ["change", "add", "remove"], description: "change (default), add or remove." },
      pin: { type: "object", description: "Optional point on an image/PDF: x,y in 0–1 from the top-left; page for PDFs; file = direction/file label, number or key.", properties: { x: { type: "number" }, y: { type: "number" }, page: { type: "integer" }, file: { type: "string" } } },
      device: { type: "string", enum: ["mobile", "desktop"], description: "Websites: which view." }, path: { type: "string", description: "Websites: page path, e.g. /rolunk." },
      quote: { type: "string", description: "Documents: the exact text the request refers to." },
      post_id: { type: "string", description: "Post calendars: the post id." },
      more_to_come: { type: "boolean", description: "true = more requests follow, notify Webbridge after the last one." }, ...LANG_P }, required: ["work_id", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "approve_version", title: "Approve a version",
    description: "Personal connector required; only the account owner can approve. Approves a version so Webbridge continues from it (with several directions, the chosen one). First call WITHOUT confirm to get what will happen; ask the user; then call again with confirm:true.",
    inputSchema: { type: "object", properties: { work_id: { type: "string" }, version_id: { type: "string", description: "ver_… id or version number, e.g. \"2\"." }, chosen: { type: "string", description: "With several directions: the chosen one (label, number or key)." }, ...CONFIRM_P, ...LANG_P }, required: ["work_id", "version_id"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "request_service", title: "Order extra services",
    description: "Personal connector required; only the account owner can order. Quotes extra items for an existing customer in their currency; with confirm:true sends a non-binding add-on order (Webbridge confirms it by email before any work or payment). First call WITHOUT confirm, show the quote, ask the user.",
    inputSchema: { type: "object", properties: { item_ids: ITEMS_P, notes: { type: "string" }, ...CONFIRM_P, ...LANG_P }, required: ["item_ids"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
];

export function instructions(env: Env) {
  return `Webbridge (${env.SITE_URL}) makes websites, logos, brand identity and marketing for small businesses, mostly in Hungary, at fixed net prices. Talk to Hungarian customers in Hungarian, informal (tegezés), unless they write in English; pass lang accordingly.
Public tools: get_services (offer and rules), get_quote (exact prices; never compute or invent prices yourself), start_order (non-binding order request; call once without confirm, show the summary, ask the user, then call with confirm:true).
Personal tools (need the customer's personal connector link from the client Desk "Pult"): my_projects, get_preview, list_comments, request_change, approve_version, request_service. Approving and ordering extras require the account owner and an explicit yes from the user (confirm:true).
You cannot take payments: payment links always come from Webbridge by email. Do not give tax or legal advice beyond what get_services says.`;
}

// ---------- Nyilvános eszközök ----------
function servicesText(env: Env, lang: Lang) {
  const hu = lang === "hu", L: string[] = [];
  const p = (id: string, m = false) => { const c = itemById(id)!; return `${fmt(c.huf, "HUF", lang, m)} / ${fmt(c.eur, "EUR", lang, m)}`; };
  L.push(hu ? "WEBBRIDGE AJÁNLAT – minden ár nettó, HUF / EUR" : "WEBBRIDGE OFFER – all prices net, HUF / EUR");
  L.push(hu ? "\nEgyszeri tételek (azonosító: név – ár – leírás; tartalom):" : "\nOne-off items (id: name – price – description; includes):");
  for (const c of CATALOG.filter((x) => !x.monthly)) { const i = ITEM_INFO[c.id]?.[lang]; L.push(`- ${c.id}: ${c[lang]} – ${p(c.id)} – ${i?.[0] || ""}${i?.[1].length ? ` (${i[1].join("; ")})` : ""}`); }
  L.push(hu ? "\nHavidíjas tételek (az élesítés napjától, bármelyik hónap végére lemondható legalább 30 nappal előtte, büntetés nélkül):" : "\nMonthly items (from go-live; cancel for the end of any month with at least 30 days' notice, no penalty):");
  for (const c of CATALOG.filter((x) => x.monthly)) { const i = ITEM_INFO[c.id]?.[lang]; L.push(`- ${c.id}: ${c[lang]} – ${p(c.id, true)} – ${i?.[0] || ""}${i?.[1].length ? ` (${i[1].join("; ")})` : ""}`); }
  L.push(hu ? "\nCsomagok:" : "\nBundles:");
  for (const b of BUNDLES) {
    const raw = priceOf(b.items, "HUF");
    L.push(`- ${b.id} ${b[lang][0]} (${b.items.join(", ")}): ${fmt(b.huf, "HUF", lang)} / ${fmt(b.eur, "EUR", lang)}${b.mhuf ? ` + ${fmt(b.mhuf, "HUF", lang, true)} / ${fmt(b.meur, "EUR", lang, true)}` : ""} (${hu ? "külön" : "separately"} ${fmt(raw.once, "HUF", lang)}${raw.monthly ? ` + ${fmt(raw.monthly, "HUF", lang, true)}` : ""}). ${b[lang][1]} ${hu ? `Korlátlan apró módosítás ${b.rounds > 2 ? 30 : 14} napig az átadás után.` : `Unlimited small changes for ${b.rounds > 2 ? 30 : 14} days after handover.`}`);
  }
  L.push(hu ? "\nHavidíjas weboldal (az egyszeri weboldalár helyett, 12 hónapos szerződés):" : "\nMonthly website plan (instead of the one-off website price, 12-month contract):");
  for (const [id, s] of Object.entries(SUBS)) L.push(`- ${itemName(id, lang)}: ${fmt(s.huf, "HUF", lang, true)} / ${fmt(s.eur, "EUR", lang, true)}; ${hu ? `a ${SUB_MONTHS + 1}. hónaptól` : `from month ${SUB_MONTHS + 1}`} ${fmt(s.after_huf, "HUF", lang, true)} / ${fmt(s.after_eur, "EUR", lang, true)}`);
  L.push(hu
    ? "Benne van az oldal elkészítése, a tárhely, a domain, a mentés és havi 30 perc módosítás (webshopnál a webshop-üzemeltetés is). Az első havidíj a vázlatirány kiválasztásakor, utána havonta kártyával. A 13. hónaptól csak az üzemeltetést fizeted (havonta lemondható), és az oldal végleg a tiéd. Korábbi kiszállásnál a hátralévő havidíjakat egyben kifizeted, és viszed az oldalt. A logó, a brandbook és a tervek egyszeri díjasak maradnak."
    : "It includes building the site, hosting, domain, backups and 30 minutes of edits a month (web shop care too for shops). First month is paid when you choose a sketch direction, then monthly by card. From month 13 you pay only hosting and care (cancellable monthly) and the site is yours for good. Leaving earlier: pay the remaining months in one sum and take the site. Logo, brandbook and plans stay one-off.");
  L.push(hu
    ? "\nElső ügyfél program: az első 5 ügyfelünk 30% kedvezményt kap az egyszeri díjakból (a csomagárakból is, a havidíjakból nem). Cserébe referenciaként bemutathatjuk az elkészült munkát a nevével és képernyőképekkel, és kérünk pár mondatos visszajelzést, amit „Első ügyfél program” jelöléssel teszünk ki. A helyek a megrendelések sorrendjében kelnek el; nem garantáljuk, hogy van még szabad hely."
    : "\nFirst-client programme: our first 5 clients get 30% off one-off fees (bundle prices included, not monthly fees). In return we may show the finished work as a reference with their name and screenshots, and we ask for a few sentences of feedback published labelled \"First-client programme\". Places go in order of orders received; a free place is not guaranteed.");
  L.push(hu
    ? "\nKockázatmentes indulás (vázlat-garancia): ha az összefoglaló jóváhagyása után 24 órán belül nem kapod meg a 3 vázlatirányt, vagy egyik sem tetszik, kérhetsz új irányokat (újabb vázlatdíjért), vagy elállhatsz: ekkor a vázlatdíjat 14 napon belül visszaadjuk, és többet nem fizetsz. 200 000 Ft alatt vázlatdíj sincs."
    : "\nRisk-free start (sketch guarantee): if you don't get the 3 sketch directions within 24 hours of approving the summary, or you like none of them, ask for new directions (for another sketch fee) or walk away: we refund the sketch fee within 14 days and you owe nothing more. Under 200 000 Ft there is no sketch fee at all.");
  L.push(hu
    ? "\nFizetés három lépésben, kártyával vagy átutalással (Stripe): 1) vázlatdíj – 200 000 Ft (≈ €520) nettó egyszeri végösszeg alatt nincs, felette 19 900 Ft / €49, és beszámítjuk; 2) irányválasztáskor a végösszeg 50%-a (a vázlatdíj levonásával); 3) végső jóváhagyáskor a maradék 50%. A havidíjakat havonta előre, kártyáról vonjuk (átutalással nem). Számla e-mailben, magyarul vagy angolul, HUF-ban vagy EUR-ban."
    : "\nPayment in three steps, by card or bank transfer (Stripe): 1) sketch fee – none under a 200 000 Ft (≈ €520) net one-off total, otherwise 19 900 Ft / €49, credited to the total; 2) 50% of the total when you choose a direction (minus the sketch fee); 3) the remaining 50% on final approval. Monthly fees are charged to a card monthly in advance (no bank transfer). Invoice by email in Hungarian or English, in HUF or EUR.");
  L.push("\n" + (hu ? "ÁFA és számla: " : "VAT and invoice: ") + vatText("b2c", lang) + " " + vatText("b2b", lang) + (hu ? " Adótanácsot nem adunk." : " We don't give tax advice."));
  L.push(hu
    ? "\nIdőzítés: a 24 óra akkor indul, amikor az írásos összefoglalót (brief) jóváhagyod; 24 órán belül 3 vázlatirányt kapsz online előnézetben. Az apró módosítások legkésőbb 24 órán belül elkészülnek; az átadás után 14 napig (Növekedés csomagban 30 napig) korlátlanul kérhetsz apró módosítást a Pultban. Külső szolgáltatón múlik, ezért tovább tarthat: .hu domain regisztrációja/átvitele (a nyilvántartónál kb. két hét is lehet; addig ideiglenes címen fut az oldal), a Google Cégprofil postai ellenőrzése és a kártyás fizetés bekapcsolása. Ha 7 napig nem jelzel vissza egy verzióra, emlékeztetünk; további 7 nap után jóváhagyottnak számít."
    : "\nTiming: the 24 hours start when you approve the written summary (brief); within 24 hours you get 3 sketch directions as an online preview. Small changes are done within 24 hours; for 14 days after handover (30 in the Growth bundle) small changes are unlimited in the Desk. Depending on third parties, so it can take longer: registering/transferring a .hu domain (can take about two weeks at the registry; the site runs on a temporary address meanwhile), Google Business Profile postcard verification and activating card payments. If you don't respond to a version for 7 days we send a reminder; after 7 more days it counts as approved.");
  L.push(hu
    ? `\nDomain és jogok: a domain a te nevedre kerül; ha már van, nálad marad, és az új oldalra irányítjuk (vagy átköltöztetjük). Teljes kifizetéssel a logó és arculat jogai a tieid, a weboldalra és szövegekre határidő nélküli, kizárólagos felhasználási jogot kapsz. ÁSZF: ${ASZF(env)}`
    : `\nDomain and rights: the domain is registered in your name; if you have one, it stays yours and we point it to the new site (or move it). On full payment the logo and brand rights are yours, and you get an exclusive, unlimited-time right to use the website and copy. Terms: ${ASZF(env)}`);
  L.push(hu ? "\nRendelés: a start_order eszközzel (nem kötelező érvényű; az összefoglalót e-mailben hagyod jóvá). Kérdés: hello@webbridge.hu." : "\nOrdering: with the start_order tool (non-binding; you approve the summary by email). Questions: hello@webbridge.hu.");
  return L.join("\n");
}

function quoteIn(a: Record<string, unknown>, cur?: Cur) {
  return { item_ids: ids(a.item_ids ?? a.items), currency: cur || curOf(a.currency), buyer_type: a.buyer_type === "b2c" ? "b2c" as const : "b2b" as const, pay_mode: a.pay_mode === "sub" ? "sub" as const : "full" as const, first_client: a.first_client === true };
}

async function startOrder(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const hu = lang === "hu", env = ctx.env;
  const email = (clean(a.email, 200) || ctx.auth.user?.email || "").toLowerCase();
  const business = clean(a.business, 200), what = clean(a.what, 600);
  if (!isEmail(email)) return fail(hu ? "Adj meg egy érvényes e-mail-címet (email)." : "Please provide a valid email address (email).");
  if (!business) return fail(hu ? "Hiányzik a vállalkozás neve (business)." : "The business name (business) is missing.");
  if (!what) return fail(hu ? "Írd le 1–2 mondatban, mivel foglalkozik a vállalkozás (what)." : "Describe in 1–2 sentences what the business does (what).");
  const qi = quoteIn(a);
  const q = quote(qi);
  if (qi.pay_mode === "sub" && !q.sub) qi.pay_mode = "full";
  const liked = (Array.isArray(a.liked_sites) ? a.liked_sites : []).slice(0, 3).map((x) => clean(x, 300)).filter(Boolean);
  const summary = [
    `${hu ? "Vállalkozás" : "Business"}: ${business}`, `E-mail: ${email}`, `${hu ? "Mivel foglalkozik" : "What it does"}: ${what}`,
    a.customers ? `${hu ? "Vevők" : "Customers"}: ${clean(a.customers, 600)}` : "", liked.length ? `${hu ? "Tetsző oldalak" : "Liked sites"}: ${liked.join(", ")}` : "",
    a.existing_site ? `${hu ? "Meglévő oldal" : "Current site"}: ${clean(a.existing_site, 300)}` : "", a.notes ? `${hu ? "Megjegyzés" : "Notes"}: ${clean(a.notes, 3000)}` : "",
    `${hu ? "Vevő típusa" : "Buyer"}: ${qi.buyer_type === "b2c" ? (hu ? "magánszemély" : "private person") : (hu ? "vállalkozás" : "business")}${a.vat_id ? ` (${clean(a.vat_id, 40)})` : ""}`,
  ].filter(Boolean).join("\n");
  if (!q.items.length && !clean(a.notes, 10)) return fail(hu ? "Válassz legalább egy tételt (items), vagy írd le a notes mezőben, mire van szükség." : "Pick at least one item (items) or describe the need in notes.");
  if (a.confirm !== true) {
    return ok((hu ? "MÉG NINCS ELKÜLDVE. Mutasd meg ezt az összefoglalót, és kérdezd meg, elküldheted-e:\n\n" : "NOT SENT YET. Show this summary to the user and ask whether to send it:\n\n")
      + summary + "\n\n" + quoteText(q, lang) + "\n\n"
      + (hu ? `Mi történik elküldés után: visszaigazoló e-mailt kap a(z) ${email} cím; egy órán belül (munkaidőben) írásban visszaküldjük, amit megértettünk, és ezt e-mailben kell jóváhagyni – a 24 óra csak ekkor indul. Ez a rendelés még nem kötelező érvényű, és most semmit nem kell fizetni. Elküldéssel elfogadod az ÁSZF-et: ${ASZF(env)}\nHa a felhasználó igent mond, hívd újra a start_order eszközt ugyanezekkel az adatokkal és confirm:true értékkel.`
        : `What happens after sending: a confirmation email goes to ${email}; within an hour (business hours) we send back in writing what we understood, which must be approved by email – only then do the 24 hours start. This order is not binding yet and nothing is paid now. Sending means accepting the terms: ${ASZF(env)}\nIf the user says yes, call start_order again with the same data and confirm:true.`),
      { status: "needs_confirmation", quote: q });
  }
  if (await overLimit(env, `mcp-order-ip:${ctx.ip}`, LIMITS.ordersPerIpHour)) return fail(hu ? "Túl sok rendelés érkezett innen az elmúlt órában. Próbáld később, vagy írj a hello@webbridge.hu címre." : "Too many orders from here in the last hour. Try later or email hello@webbridge.hu.");
  if (await overLimit(env, `mcp-order-email:${email}`, LIMITS.ordersPerEmailDay, 1, "day")) return fail(hu ? "Ehhez az e-mail-címhez ma már több rendelés is érkezett. Ha módosítanál, válaszolj a visszaigazoló levelünkre." : "Several orders already arrived for this email today. To change something, reply to our confirmation email.");
  const o = await createOrder(env, {
    email, business, what, who: clean(a.customers, 600), extra: clean(a.notes, 3000), name: clean(a.name, 200), phone: clean(a.phone, 40), vat_id: clean(a.vat_id, 40),
    items: q.items, currency: qi.currency, buyer_type: qi.buyer_type, pay_mode: qi.pay_mode, first_client: qi.first_client, lang, terms: true,
    likes: liked.map((url) => ({ url })), site: a.existing_site ? { url: clean(a.existing_site, 500) } : undefined,
  }, { source: "mcp", waitUntil: ctx.waitUntil });
  return ok(hu
    ? `Elküldve. A rendelésszám: ${o.id}. Visszaigazoló e-mail ment a(z) ${email} címre; egy órán belül (munkaidőben) írásban visszaküldjük az összefoglalót jóváhagyásra. Fájlokat (logó, fotók, étlap) a visszaigazoló levélre válaszolva lehet küldeni. Fizetni most nem kell; a fizetési linket e-mailben küldjük, amikor időszerű.`
    : `Sent. Order number: ${o.id}. A confirmation email went to ${email}; within an hour (business hours) we send back the written summary for approval. Files (logo, photos, menu) can be sent by replying to the confirmation email. Nothing to pay now; payment links come by email when due.`,
    { status: "sent", order: o.id, once: o.once, monthly: o.monthly, currency: o.currency });
}

// ---------- Személyes eszközök ----------
const STAGE_CUST: Record<string, { hu: [string, string]; en: [string, string] }> = {
  lead: { hu: ["Megkaptuk a rendelést", "Egy órán belül (munkaidőben) írásban visszaküldjük, amit megértettünk; ezt e-mailben hagyod jóvá."], en: ["Order received", "Within an hour (business hours) we send back in writing what we understood; you approve it by email."] },
  brief_sent: { hu: ["Az összefoglaló a jóváhagyásodra vár", "Hagyd jóvá az összefoglalót a levelünkben, vagy írd meg, mi hiányzik. A 24 óra a jóváhagyással indul."], en: ["Summary waiting for your approval", "Approve the summary in our email or tell us what's missing. The 24 hours start on approval."] },
  brief_ok: { hu: ["Összefoglaló jóváhagyva", "Ha van vázlatdíj, a fizetési linket e-mailben küldjük; a 3 vázlatirány 24 órán belül érkezik a Pultba."], en: ["Summary approved", "If there's a sketch fee, the payment link comes by email; the 3 directions arrive in the Desk within 24 hours."] },
  sketch_paid: { hu: ["Vázlatdíj rendezve, a vázlatokon dolgozunk", "A 3 vázlatirány 24 órán belül megérkezik a Pultba."], en: ["Sketch fee paid, working on the sketches", "The 3 directions arrive in the Desk within 24 hours."] },
  sketches: { hu: ["Elkészültek a vázlatirányok", "Nézd meg őket a Pultban, és válassz irányt; utána jön az 50%-os részlet."], en: ["Sketch directions are ready", "Look at them in the Desk and choose a direction; then the 50% instalment follows."] },
  deposit_paid: { hu: ["Előleg rendezve", "A választott irányból elkészítjük az anyagokat."], en: ["Deposit paid", "We build everything from the chosen direction."] },
  building: { hu: ["Készül", "Szólunk, amikor megnézheted a Pultban."], en: ["In progress", "We'll tell you when it's ready to review in the Desk."] },
  review: { hu: ["Nézd át és jelezz vissza", "Nézd át a Pultban: kérj módosítást, vagy hagyd jóvá. Jóváhagyáskor esedékes a maradék 50%."], en: ["Please review", "Review it in the Desk: request changes or approve. The remaining 50% is due on approval."] },
  live: { hu: ["Élesben", "Apró módosításokat a Pultban kérhetsz."], en: ["Live", "Request small changes in the Desk."] },
  care: { hu: ["Üzemeltetés alatt", "Kéréseidet a Pultban vagy e-mailben jelezd."], en: ["In care", "Send requests via the Desk or email."] },
  lost: { hu: ["Lezárva", ""], en: ["Closed", ""] },
};

async function myProjects(ctx: McpCtx, lang: Lang): Promise<ToolResult> {
  const u = ctx.auth.user!, hu = lang === "hu", env = ctx.env;
  const ps = (await env.DB.prepare("SELECT id,title,stage,items,amount,currency,brief,due_at,created_at,updated_at FROM projects WHERE customer_id=?1 ORDER BY created_at DESC LIMIT 50").bind(u.customer_id)
    .all<{ id: string; title: string; stage: string; items: string; amount: number; currency: string; brief: string; due_at: string | null; created_at: string; updated_at: string }>()).results;
  const paid = (await env.DB.prepare("SELECT project_id, currency, SUM(amount) s FROM payments WHERE customer_id=?1 AND status='paid' GROUP BY project_id, currency").bind(u.customer_id)
    .all<{ project_id: string; currency: string; s: number }>()).results;
  const out = ps.map((p) => {
    const items: string[] = JSON.parse(p.items || "[]"), br = JSON.parse(p.brief || "{}");
    const cur = p.currency === "EUR" ? "EUR" : "HUF";
    const op = orderPrice(items, cur, { first_client: br.first_client === true, pay_mode: br.pay_mode });
    const st = STAGE_CUST[p.stage]?.[lang] || [p.stage, ""];
    const pd = paid.filter((x) => x.project_id === p.id).map((x) => fmt(x.s, x.currency, lang)).join(" + ");
    return { id: p.id, title: p.title, stage: p.stage, stage_text: st[0], next_step: st[1], items: items.map((i) => ({ id: i, name: itemName(i, lang) })), currency: cur, once: p.amount, monthly: op.monthly,
      pay_mode: br.pay_mode === "sub" ? "sub" : "full", sub: br.sub || null, first_client: br.first_client === true, add_on: br.addon === true, due_at: p.due_at, created_at: p.created_at, paid: pd || null };
  });
  if (!out.length) return ok(hu ? `Még nincs rendelésed nálunk. A Pult: ${PULT(env)}` : `You have no orders with us yet. Desk: ${PULT(env)}`, { projects: [] });
  const txt = out.map((p) => `• ${p.id} – ${p.title}${p.add_on ? (hu ? " (kiegészítés)" : " (add-on)") : ""}\n  ${hu ? "Állapot" : "Stage"}: ${p.stage_text}${p.next_step ? `\n  ${hu ? "Következő lépés" : "Next step"}: ${p.next_step}` : ""}\n  ${hu ? "Tételek" : "Items"}: ${p.items.map((i) => i.name).join(", ") || "–"}\n  ${hu ? "Egyszeri (nettó, rögzített)" : "One-off (net, recorded)"}: ${fmt(p.once, p.currency, lang)}${p.monthly ? ` · ${hu ? "havi" : "monthly"} ${fmt(p.monthly, p.currency, lang, true)}` : ""}${p.pay_mode === "sub" ? (hu ? " · havidíjas weboldal" : " · monthly website plan") : ""}${p.first_client ? (hu ? " · Első ügyfél kedvezmény" : " · first-client discount") : ""}${p.paid ? `\n  ${hu ? "Befizetve" : "Paid"}: ${p.paid}` : ""}${p.due_at ? `\n  ${hu ? "Határidő" : "Due"}: ${p.due_at}` : ""}`).join("\n");
  return ok(txt + `\n\n${hu ? "Anyagok és előnézetek: get_preview, vagy a Pult" : "Materials and previews: get_preview, or the Desk"}: ${PULT(env)}`, { projects: out });
}

type VRow = { id: string; n: number; note: string | null; files: string; preview_url: string | null; status: string; created_at: string; approved_at: string | null; chosen: string | null };
type FileRec = { key: string; name: string; type: string; size?: number; label?: string };

async function versionOf(env: Env, workId: string, ref: unknown): Promise<VRow | null> {
  const r = clean(ref, 40);
  const sel = "SELECT id,n,note,files,preview_url,status,created_at,approved_at,chosen FROM versions WHERE work_id=?1";
  if (!r) return env.DB.prepare(`${sel} ORDER BY n DESC LIMIT 1`).bind(workId).first<VRow>();
  const m = r.match(/^v?(\d{1,4})$/i);
  if (m) return env.DB.prepare(`${sel} AND n=?2`).bind(workId, Number(m[1])).first<VRow>();
  return env.DB.prepare(`${sel} AND id=?2`).bind(workId, r).first<VRow>();
}
function fileOf(files: FileRec[], ref: unknown): FileRec | null {
  const r = clean(ref, 300);
  if (!r) return null;
  if (/^\d{1,2}$/.test(r)) return files[Number(r) - 1] || null;
  const low = r.toLowerCase();
  return files.find((f) => f.key === r) || files.find((f) => (f.label || "").toLowerCase() === low || (f.name || "").toLowerCase() === low) || null;
}
const statusText = (s: string, lang: Lang) => (({ review: ["Rád vár", "Waiting for you"], changes: ["Dolgozunk rajta", "We're on it"], approved: ["Jóváhagyva", "Approved"], superseded: ["Újabb verzió váltotta", "Superseded"], draft: ["Előkészítés alatt", "In preparation"] } as Record<string, string[]>)[s] || [s, s])[lang === "hu" ? 0 : 1];
const isMulti = (kind: string, files: FileRec[]) => files.length > 1 && !["web", "doc", "posts"].includes(kind);

async function loadWork(ctx: McpCtx, id: unknown, lang: Lang): Promise<Work | ToolResult> {
  const w = await workFor(ctx.env, ctx.auth.user!, clean(id, 40));
  if (!w || w.status === "draft") return fail(lang === "hu" ? "Nincs ilyen munka (work_id). A get_preview eszköz listázza a munkáidat." : "No such work (work_id). get_preview lists your works.");
  return w as Work;
}

function b64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function getPreview(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const u = ctx.auth.user!, env = ctx.env, hu = lang === "hu";
  const wid = clean(a.work_id, 40), pid = clean(a.project_id, 40);
  let q = "SELECT id,kind,title,status,project_id,updated_at FROM works WHERE customer_id=?1 AND status<>'draft'";
  const binds: unknown[] = [u.customer_id];
  if (wid) { q += " AND id=?2"; binds.push(wid); } else if (pid) { q += " AND project_id=?2"; binds.push(pid); }
  const works = (await env.DB.prepare(q + " ORDER BY updated_at DESC LIMIT 30").bind(...binds).all<{ id: string; kind: string; title: string; status: string; project_id: string | null; updated_at: string }>()).results;
  if (!works.length) return ok(wid ? (hu ? "Nincs ilyen munka." : "No such work.") : (hu ? "Még nincs véleményezni való anyag. Ha elkészül az első, e-mailt küldünk." : "Nothing to review yet. We'll email you when the first one is ready."), { works: [] });
  const out = [], images: Content[] = [];
  const wantImg = a.include_images === true || (a.include_images !== false && !!wid);
  for (const w of works) {
    const v = await versionOf(env, w.id, "");
    const open = await env.DB.prepare("SELECT COUNT(*) n FROM comments WHERE work_id=?1 AND parent_id IS NULL AND status IN ('open','doing')").bind(w.id).first<{ n: number }>();
    const files: FileRec[] = v ? JSON.parse(v.files || "[]") : [];
    out.push({
      work_id: w.id, project_id: w.project_id, kind: w.kind, kind_text: (hu ? KIND_HU : KIND_EN)[w.kind] || w.kind, title: w.title, status: w.status, status_text: statusText(w.status, lang),
      latest_version: v ? { version_id: v.id, n: v.n, status: v.status, note: v.note, created_at: v.created_at, approved_at: v.approved_at, chosen: v.chosen, preview_url: v.preview_url,
        files: files.map((f, i) => ({ no: i + 1, label: f.label || f.name, type: f.type, key: f.key })), multiple_directions: isMulti(w.kind, files) } : null,
      open_comments: open?.n || 0, desk_url: `${env.SITE_URL}/pult/#w/${w.id}`,
    });
    if (wantImg && v && env.UPLOADS) {
      for (const f of files.filter((x) => /^image\/(png|jpe?g|webp|gif)$/i.test(x.type)).slice(0, 3)) {
        if (images.length >= 4) break;
        const o = await env.UPLOADS.get(f.key);
        if (!o || o.size > 1_500_000) continue;
        images.push({ type: "text", text: `${w.title} v${v.n} – ${f.label || f.name}` }, { type: "image", data: b64(await o.arrayBuffer()), mimeType: f.type.toLowerCase().replace("jpg", "jpeg") });
      }
    }
  }
  const txt = out.map((w) => {
    const v = w.latest_version;
    return `• ${w.title} (${w.kind_text}) – ${w.status_text} – work_id: ${w.work_id}${v ? `\n  ${hu ? "Legújabb" : "Latest"}: v${v.n} (version_id: ${v.version_id}, ${statusText(v.status, lang)})${v.note ? ` – ${v.note}` : ""}${v.files.length ? `\n  ${hu ? (v.multiple_directions ? "Irányok" : "Fájlok") : (v.multiple_directions ? "Directions" : "Files")}: ${v.files.map((f) => `${f.no}. ${f.label}`).join("; ")}` : ""}${v.preview_url ? `\n  ${hu ? "Élő előnézet" : "Live preview"}: ${v.preview_url}` : ""}` : ""}${w.open_comments ? `\n  ${hu ? "Nyitott megjegyzés" : "Open comments"}: ${w.open_comments}` : ""}\n  ${hu ? "Megnyitás a Pultban (belépés kell)" : "Open in the Desk (sign-in needed)"}: ${w.desk_url}`;
  }).join("\n");
  return ok(txt, { works: out }, images);
}

async function listComments(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const env = ctx.env, hu = lang === "hu";
  const w = await loadWork(ctx, a.work_id, lang);
  if ("content" in w) return w;
  let vid: string | null = null;
  if (clean(a.version_id, 40)) { const v = await versionOf(env, w.id, a.version_id); if (!v) return fail(hu ? "Nincs ilyen verzió." : "No such version."); vid = v.id; }
  const rowsQ = (await env.DB.prepare(
    `SELECT c.id,c.version_id,c.parent_id,c.author_kind,c.action,c.body,c.status,c.created_at,c.page,c.device,c.path,c.quote,c.post_id,c.proposal,c.via,v.n,COALESCE(u.name,u.email,c.author_name) AS author
     FROM comments c JOIN versions v ON v.id=c.version_id LEFT JOIN portal_users u ON u.id=c.user_id WHERE c.work_id=?1 ${vid ? "AND c.version_id=?2" : ""} ORDER BY c.created_at`
  ).bind(...(vid ? [w.id, vid] : [w.id])).all<Record<string, any>>()).results;
  const roots = rowsQ.filter((c) => !c.parent_id);
  if (!roots.length) return ok(hu ? `Még nincs megjegyzés: ${w.title}.` : `No comments yet: ${w.title}.`, { work_id: w.id, comments: [] });
  const ST: Record<string, [string, string]> = { open: ["nyitott", "open"], doing: ["dolgozunk rajta", "in progress"], done: ["kész – nézd meg", "done – please check"], verified: ["rendben", "verified"] };
  const ACT: Record<string, [string, string]> = { change: ["Változtatás", "Change"], add: ["Hozzáadás", "Add"], remove: ["Törlés", "Remove"] };
  const out = roots.map((c) => ({
    id: c.id, version: c.n, version_id: c.version_id, action: c.action, status: c.status, status_text: (ST[c.status] || [c.status, c.status])[hu ? 0 : 1], author: c.author, from_ai: c.via === "mcp", body: c.body, created_at: c.created_at,
    where: [c.page ? (hu ? `${c.page}. oldal` : `page ${c.page}`) : "", c.device ? `${c.device} · ${c.path || "/"}` : "", c.post_id ? `post ${c.post_id}` : "", c.quote ? `„${String(c.quote).slice(0, 120)}”` : ""].filter(Boolean).join(" · "),
    replies: rowsQ.filter((r) => r.parent_id === c.id).map((r) => ({ from: r.author_kind === "staff" ? "Webbridge" : r.author, body: r.body, created_at: r.created_at })),
  }));
  const txt = `${w.title}:\n` + out.map((c) => `• v${c.version} ${(ACT[c.action] || ACT.change)[hu ? 0 : 1]} [${c.status_text}]${c.where ? ` (${c.where})` : ""} – ${c.author || ""}${c.from_ai ? (hu ? " (AI-asszisztensből)" : " (via AI assistant)") : ""}: ${c.body}${c.replies.map((r) => `\n    ↳ ${r.from}: ${r.body}`).join("")}`).join("\n");
  return ok(txt, { work_id: w.id, comments: out });
}

async function requestChange(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const env = ctx.env, u = ctx.auth.user!, hu = lang === "hu";
  const w = await loadWork(ctx, a.work_id, lang);
  if ("content" in w) return w;
  const v = await versionOf(env, w.id, a.version_id);
  if (!v) return fail(hu ? "Nincs ilyen verzió." : "No such version.");
  if (v.status !== "review" && v.status !== "changes") return fail(hu
    ? `A(z) v${v.n} verzió ${v.status === "approved" ? "már jóvá van hagyva" : "helyett már újabb verzió van"}, ehhez nem lehet módosítást kérni. ${v.status === "approved" ? "Ha mégis változtatnál, írj a hello@webbridge.hu címre." : "Kérd a legújabb verzión (version_id nélkül)."}`
    : `Version v${v.n} is ${v.status === "approved" ? "already approved" : "superseded by a newer one"}, so no change can be requested on it. ${v.status === "approved" ? "To change something anyway, email hello@webbridge.hu." : "Request it on the latest version (omit version_id)."}`);
  const body = clean(a.text, 4000);
  if (!body) return fail(hu ? "Írd le, mit szeretnél (text)." : "Write what you'd like (text).");
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM comments c JOIN works w ON w.id=c.work_id WHERE w.customer_id=?1 AND c.created_at > ?2").bind(u.customer_id, new Date(Date.now() - 864e5).toISOString()).first<{ n: number }>();
  if ((n?.n || 0) >= LIMITS.commentsPerCustomerDay) return fail(hu ? "Mára elérted a megjegyzések korlátját; holnap folytathatod." : "You've reached today's comment limit; continue tomorrow.");
  const files: FileRec[] = JSON.parse(v.files || "[]");
  const pin = (a.pin && typeof a.pin === "object" ? a.pin : {}) as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null);
  let fileKey: string | null = null;
  if (pin.file != null) { const f = fileOf(files, String(pin.file)); if (!f) return fail(hu ? `Nincs ilyen fájl/irány: ${pin.file}. Lehetőségek: ${files.map((f, i) => `${i + 1}. ${f.label || f.name}`).join("; ")}` : `No such file/direction: ${pin.file}. Options: ${files.map((f, i) => `${i + 1}. ${f.label || f.name}`).join("; ")}`); fileKey = f.key; }
  const x = num(pin.x, 0, 1), y = num(pin.y, 0, 1);
  if ((x != null || y != null) && !fileKey && files.length === 1) fileKey = files[0].key;
  let device: string | null = null, path: string | null = null;
  if (w.kind === "web") {
    device = a.device === "mobile" || a.device === "desktop" ? a.device : null;
    const pth = clean(a.path, 300).replace(/[\u0000-\u001f\u007f]/g, "");
    path = pth ? (pth.startsWith("/") ? pth : "/" + pth) : device ? "/" : null;
  }
  const quoteTxt = typeof a.quote === "string" && a.quote.trim() ? clean(a.quote, 500) : null;
  let postId: string | null = null;
  if (a.post_id != null && a.post_id !== "") {
    const pidv = String(a.post_id);
    if (!POST_ID_RE.test(pidv) || w.kind !== "posts") return fail(hu ? "Érvénytelen poszt." : "Invalid post.");
    const posts = await versionPosts(env, v.files);
    if (!posts || !posts.some((p) => p.id === pidv)) return fail(hu ? "Nincs ilyen poszt." : "No such post.");
    postId = pidv;
  }
  const action = ["change", "add", "remove"].includes(String(a.action)) ? String(a.action) : "change";
  const id = await addComment(env, {
    work: w, version_id: v.id, author_kind: "customer", user_id: u.id, file_key: fileKey, page: num(pin.page, 1, 999), x: fileKey ? x : null, y: fileKey ? y : null,
    action, body, device, path, quote: quoteTxt, post_id: postId, via: "mcp",
  });
  if (postId) await setPostDecision(env, w.id, v.id, postId, "change", u.id);
  let sent = false;
  if (a.more_to_come !== true) { const r = await feedbackSubmitted(env, w, v.id, u, "mcp"); sent = r.ok; }
  return ok(hu
    ? `Rögzítve a(z) ${w.title} v${v.n} verzióhoz${sent ? ", és elküldtük a Webbridge-nek a nyitott kérésekkel együtt" : " (még nem küldtük el; az utolsó kérés után megy egyben)"}. A Pultban is látszik: ${env.SITE_URL}/pult/#w/${w.id}`
    : `Recorded on ${w.title} v${v.n}${sent ? " and sent to Webbridge together with the other open requests" : " (not sent yet; it goes out together after the last request)"}. Visible in the Desk too: ${env.SITE_URL}/pult/#w/${w.id}`,
    { comment_id: id, work_id: w.id, version_id: v.id, sent });
}

async function approve(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const env = ctx.env, u = ctx.auth.user!, hu = lang === "hu";
  if (u.role !== "owner") return fail(hu ? "Jóváhagyni csak a fiók gazdája tud. Véleményezőként módosítást kérhetsz (request_change)." : "Only the account owner can approve. As a reviewer you can request changes (request_change).");
  const w = await loadWork(ctx, a.work_id, lang);
  if ("content" in w) return w;
  const v = await versionOf(env, w.id, a.version_id);
  if (!v) return fail(hu ? "Nincs ilyen verzió." : "No such version.");
  if (v.status === "approved") return ok(hu ? `A(z) ${w.title} v${v.n} már jóvá van hagyva.` : `${w.title} v${v.n} is already approved.`, { status: "already_approved" });
  if (v.status === "superseded") return fail(hu ? "Ezt a verziót már egy újabb váltotta; a legújabbat hagyd jóvá." : "This version has been superseded; approve the latest one.");
  const files: FileRec[] = JSON.parse(v.files || "[]");
  const multi = isMulti(w.kind, files);
  const pick = multi ? fileOf(files, a.chosen) : null;
  const opts = files.map((f, i) => `${i + 1}. ${f.label || f.name}`).join("; ");
  if (multi && !pick) return fail(hu ? `Ebben a verzióban több irány van; add meg, melyiket választod (chosen): ${opts}` : `This version has several directions; say which one is chosen (chosen): ${opts}`);
  const open = await env.DB.prepare("SELECT COUNT(*) n FROM comments WHERE version_id=?1 AND parent_id IS NULL AND status IN ('open','doing') AND author_kind<>'staff'").bind(v.id).first<{ n: number }>();
  if (a.confirm !== true) {
    return ok((hu
      ? `MÉG NINCS JÓVÁHAGYVA. Ha jóváhagyod, a(z) ${w.title} v${v.n} verzióját elfogadod${pick ? `, a választott irány: ${pick.label || pick.name}` : ""}, és ebből dolgozunk tovább. Ezt a verziót utána már nem lehet módosítani.${open?.n ? ` Figyelem: ${open.n} nyitott módosításkérés van ehhez a verzióhoz.` : ""} Ha a jóváhagyáshoz fizetési lépés tartozik, a fizetési linket e-mailben küldjük.\nKérdezd meg a felhasználót, és ha igent mond, hívd újra confirm:true értékkel.`
      : `NOT APPROVED YET. Approving accepts ${w.title} v${v.n}${pick ? `, chosen direction: ${pick.label || pick.name}` : ""}, and we continue from it. This version can't be changed afterwards.${open?.n ? ` Note: ${open.n} open change request(s) on this version.` : ""} If a payment step belongs to the approval, the payment link comes by email.\nAsk the user, and if they say yes, call again with confirm:true.`),
      { status: "needs_confirmation", work_id: w.id, version_id: v.id, chosen: pick?.key || null });
  }
  const r = await approveVersion(env, w, v.id, u, "mcp", pick?.key || null);
  if (!r.ok) return fail(r.error || (hu ? "Nem sikerült." : "Failed."));
  return ok(hu ? `Köszönjük, jóváhagyva: ${w.title} v${v.n}${pick ? ` (${pick.label || pick.name})` : ""}. Ebből dolgozunk tovább, és jelentkezünk a következő lépéssel.` : `Thank you, approved: ${w.title} v${v.n}${pick ? ` (${pick.label || pick.name})` : ""}. We'll continue from it and get back to you with the next step.`,
    { status: "approved", work_id: w.id, version_id: v.id });
}

async function requestService(ctx: McpCtx, a: Record<string, unknown>, lang: Lang): Promise<ToolResult> {
  const env = ctx.env, u = ctx.auth.user!, hu = lang === "hu";
  if (u.role !== "owner") return fail(hu ? "Új szolgáltatást csak a fiók gazdája rendelhet." : "Only the account owner can order services.");
  const c = await env.DB.prepare("SELECT id,business,email,currency,buyer_type,lang FROM customers WHERE id=?1").bind(u.customer_id).first<{ id: string; business: string; email: string; currency: string; buyer_type: string; lang: string }>();
  if (!c) return fail("?");
  const cur: Cur = c.currency === "EUR" ? "EUR" : "HUF";
  const q = quote({ item_ids: ids(a.item_ids), currency: cur, buyer_type: c.buyer_type === "b2c" ? "b2c" : "b2b", pay_mode: "full", first_client: false });
  if (!q.items.length) return fail(hu ? "Válassz legalább egy tételt (item_ids); a get_services eszköz listázza őket." : "Pick at least one item (item_ids); get_services lists them.");
  const notes = clean(a.notes, 3000);
  if (a.confirm !== true) {
    return ok((hu ? "MÉG NINCS ELKÜLDVE. Kiegészítő rendelés a meglévő fiókodhoz:\n" : "NOT SENT YET. Add-on order for your existing account:\n") + quoteText(q, lang, true) + (notes ? `\n${hu ? "Megjegyzés" : "Notes"}: ${notes}` : "")
      + (hu ? `\n\nElküldés után visszaigazoló e-mailt kapsz (${c.email}), és írásban egyeztetjük a részleteket, mielőtt bármi elkészül vagy fizetni kell. Kérdezd meg a felhasználót, és ha igent mond, hívd újra confirm:true értékkel.`
        : `\n\nAfter sending you get a confirmation email (${c.email}) and we agree the details in writing before any work starts or anything is due. Ask the user, and if they say yes, call again with confirm:true.`),
      { status: "needs_confirmation", quote: q });
  }
  if (await overLimit(env, `mcp-service:${u.customer_id}`, LIMITS.servicesPerCustomerDay, 1, "day")) return fail(hu ? "Ma már több kiegészítő rendelés is érkezett. Ha módosítanál, válaszolj a visszaigazoló levelünkre." : "Several add-on orders already arrived today. To change something, reply to our confirmation email.");
  const id = orderNo(), t = nowIso();
  const brief = { extra: notes, addon: true, via: "mcp", pay_mode: "full", first_client: false, invoice_type: c.buyer_type === "b2c" ? "consumer" : undefined, requested_by: u.email };
  const title = `${c.business || c.email} – kiegészítés`;
  await env.DB.prepare(
    "INSERT INTO projects (id,customer_id,created_at,updated_at,stage_at,title,stage,items,amount,currency,brief,next_action,next_action_at,attribution) VALUES (?1,?2,?3,?3,?3,?4,'lead',?5,?6,?7,?8,?9,?10,?11)"
  ).bind(id, c.id, t, title, JSON.stringify(q.items), q.stored_order_amount, cur, JSON.stringify(brief), "Kiegészítő rendelés (saját AI-ból): visszaigazolás, részletek egyeztetése", new Date(Date.now() + 3600e3).toISOString(), JSON.stringify({ source: "mcp" })).run();
  const names = q.items.map((i) => itemName(i, lang)).join(", ");
  await logEvent(env, { customer_id: c.id, project_id: id, kind: "lead", actor: "customer", title: `Kiegészítő rendelés saját AI-asszisztensből (MCP): ${q.items.map((i) => itemName(i, "hu")).join(", ")}`, body: notes || undefined, meta: { items: q.items, once: q.once, monthly: q.monthly, currency: cur, via: "mcp", user: u.email } });
  await touch(env, c.id, id);
  const L: Lang = c.lang === "en" ? "en" : "hu"; // az ügyfélnek a saját nyelvén írunk
  const H = L === "hu";
  await sendMail(env, {
    to: c.email, subject: H ? `Megkaptuk a kiegészítő rendelést – ${id}` : `Add-on order received – ${id}`, template: "addon_received", customer_id: c.id, project_id: id,
    html: layout(L, H ? "Megkaptuk, köszönjük!" : "Got it, thank you!", (H
      ? `<p>A saját AI-asszisztensed a kérésedre kiegészítő rendelést küldött. A rendelésszám: <b>${id}</b>.</p><p>Hamarosan írásban visszaigazoljuk a részleteket; addig semmi sem kötelező érvényű, és nem kell fizetni.</p>`
      : `<p>Your own AI assistant sent an add-on order at your request. Order number: <b>${id}</b>.</p><p>We'll confirm the details in writing shortly; until then nothing is binding and nothing is due.</p>`)
      + rows([[H ? "Tételek" : "Items", names], [H ? "Egyszeri díj (nettó)" : "One-off (net)", q.once ? fmt(q.once, cur, L) : ""], [H ? "Havidíj (nettó)" : "Monthly (net)", q.monthly ? fmt(q.monthly, cur, L, true) : ""], [H ? "Megjegyzés" : "Notes", notes]])
      + `<p style="color:#6b7280;font-size:13px">${H ? "Ha nem te kérted, válaszolj erre a levélre, és töröljük." : "If you didn't ask for this, reply to this email and we'll delete it."}</p>`),
  });
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `🟠 Kiegészítő rendelés ${id} – ${c.business || c.email} (saját AI-ból)`, template: "internal_addon_order", customer_id: c.id, project_id: id, replyTo: c.email,
    html: layout("hu", `Kiegészítő rendelés: ${c.business || c.email}`, rows([["Rendelés", id], ["Kérte", u.email], ["Tételek", q.items.map((i) => itemName(i, "hu")).join(", ")], ["Egyszeri", fmt(q.once, cur, "hu")], ["Havi", q.monthly ? fmt(q.monthly, cur, "hu", true) : ""], ["Megjegyzés", notes], ["Forrás", "Az ügyfél saját AI-asszisztense (MCP)"]]),
      { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${c.id}` }),
  });
  return ok(hu ? `Elküldve, a rendelésszám: ${id}. Visszaigazoló e-mail ment a(z) ${c.email} címre; a részleteket írásban egyeztetjük, mielőtt bármi elkészül vagy fizetni kell.` : `Sent, order number: ${id}. A confirmation email went to ${c.email}; we agree the details in writing before any work starts or anything is due.`,
    { status: "sent", order: id, quote: q });
}

// ---------- Elosztó ----------
const PERSONAL = new Set(["my_projects", "get_preview", "list_comments", "request_change", "approve_version", "request_service"]);
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export async function callTool(ctx: McpCtx, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const lang = langOf(args);
  if (PERSONAL.has(name)) { const e = needUser(ctx, lang); if (e) return e; }
  switch (name) {
    case "get_services": return ok(servicesText(ctx.env, lang), offerData(lang));
    case "get_quote": { const q = quote(quoteIn(args)); if (!q.items.length) return fail(lang === "hu" ? "Adj meg legalább egy érvényes tétel-azonosítót (item_ids); a get_services listázza őket." : "Give at least one valid item id (item_ids); get_services lists them."); return ok(quoteText(q, lang), q); }
    case "start_order": return startOrder(ctx, args, lang);
    case "my_projects": return myProjects(ctx, lang);
    case "get_preview": return getPreview(ctx, args, lang);
    case "list_comments": return listComments(ctx, args, lang);
    case "request_change": return requestChange(ctx, args, lang);
    case "approve_version": return approve(ctx, args, lang);
    case "request_service": return requestService(ctx, args, lang);
  }
  return fail("Unknown tool");
}

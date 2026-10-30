// Az ajánlat leírása és az árajánlat-számítás a /mcp végponthoz (az ügyfél saját AI-asszisztense).
// Az árak forrása a lib/core.ts (CATALOG, SUBS, orderPrice, sketchAmount). A tételek leírása és a csomagok
// a site/index.html `S` és `B` tömbjének másolata: ha ott változik, itt is frissíteni kell.
import { CATALOG, SUBS, SUB_MONTHS, FIRST_CLIENT_RATE, itemById, priceOf, orderPrice, sketchAmount, sketchFeeFor } from "./core";

export type Cur = "HUF" | "EUR";
export type Lang = "hu" | "en";

/** Tételenként: rövid leírás, mit tartalmaz, mennyi idő alatt készül (site/index.html S tömb). */
export const ITEM_INFO: Record<string, { h: string; hu: [string, string[]]; en: [string, string[]] }> = {
  landing: { h: "5h", hu: ["Bemutatkozó oldal, ami eladja, amit csinálsz.", ["6–8 szekció, mobilra optimalizálva", "Kapcsolati űrlap és térkép", "Alapbeállítás a Google-keresőhöz (SEO) és szép előnézet megosztáskor", "Élesítés benne: domain bekötése vagy regisztrálása a nevedre, tárhely és SSL"]],
    en: ["A landing page that sells what you do.", ["6–8 sections, mobile-first", "Contact form and map", "Google search basics (SEO) and a neat preview when shared", "Go-live included: domain registered in your name or pointed, hosting and SSL"]] },
  site: { h: "10h", hu: ["Akár 5 aloldal: rólunk, szolgáltatások, árak, kapcsolat.", ["Max. 5 oldal, kész szövegekkel", "Blog vagy hírek modul", "Szerkeszthető admin felület", "Élesítés benne: domain bekötése vagy regisztrálása a nevedre, tárhely és SSL"]],
    en: ["Up to 5 pages: about, services, pricing, contact.", ["Up to 5 pages with copy written", "Blog or news module", "Editable admin panel", "Go-live included: domain registered in your name or pointed, hosting and SSL"]] },
  shop: { h: "18h", hu: ["Kis termékkínálatra szabott, működő bolt.", ["Max. 30 termék feltöltve", "Kártyás fizetés bekötése", "Számlázó és szállítás beállítása", "Élesítés benne: domain bekötése vagy regisztrálása a nevedre, tárhely és SSL"]],
    en: ["A working store sized for a small catalogue.", ["Up to 30 products loaded", "Card payments connected", "Invoicing and shipping set up", "Go-live included: domain registered in your name or pointed, hosting and SSL"]] },
  logo: { h: "4h", hu: ["Új logó vagy a régi frissítése: három irány, egy kiválasztott véglegesítve.", ["3 koncepció", "Vektoros fájlok (SVG, PNG, PDF)", "Világos és sötét változat"]],
    en: ["A new logo or a refresh of yours: three directions, one finalised.", ["3 concepts", "Vector files (SVG, PNG, PDF)", "Light and dark versions"]] },
  brand: { h: "6h", hu: ["A márkád szabálykönyve, hogy minden ugyanúgy nézzen ki.", ["Színek, betűtípusok, logóhasználat", "Hangnem és szóhasználat", "Social és névjegy sablonok", "Logó nélkül? Párosítsd a Logótervezéssel"]],
    en: ["Your brand rulebook, so everything looks the same.", ["Colours, type, logo usage", "Tone of voice", "Social and business-card templates", "No logo? Pair it with Logo design"]] },
  strategy: { h: "6h", hu: ["Kinek, mit, miért nálad vegyen.", ["Pozicionálás és ajánlat", "3 vevőperszóna", "Versenytárs-elemzés (5 cég)"]],
    en: ["Who buys, what, and why from you.", ["Positioning and offer", "3 customer personas", "Competitor scan (5 companies)"]] },
  plan: { h: "5h", hu: ["Csatornák, naptár, büdzsé. Holnaptól követhető.", ["Csatornaválasztás és célok", "Tartalomnaptár 90 napra", "Hirdetési büdzsé-javaslat"]],
    en: ["Channels, calendar, budget. Usable from tomorrow.", ["Channel choice and goals", "90-day content calendar", "Ad budget proposal"]] },
  setup: { h: "4h", hu: ["Egyszeri beállítás: mérés és Google-láthatóság.", ["Látogatottság-mérés (Google Analytics) és Search Console", "Google Cégprofil: térkép, nyitvatartás, értékelések", "Sütibanner és adatkezelési tájékoztató"]],
    en: ["One-off setup: measurement and Google visibility.", ["Visitor measurement (Google Analytics) and Search Console", "Google Business Profile: map, hours, reviews", "Cookie banner and privacy notice"]] },
  move: { h: "24h", hu: ["Wixről, WordPressről, Squarespace-ről vagy más régi oldalról: mi visszük át, kézzel.", ["Szövegek és képek átvitele, a régi címek 301-es átirányítása, hogy megmaradjon a Google-helyezés", "A domain átvitele (.com, .eu) vagy átirányítása; .hu domain a helyén marad, csak átirányítjuk", "Ha van, a régi e-mailek átköltöztetése Google Workspace-be"]],
    en: ["From Wix, WordPress, Squarespace or any old site: we move it over, by hand.", ["Text and images moved, old addresses 301-redirected so you keep your Google ranking", "Domain transferred (.com, .eu) or pointed; a .hu domain stays put and we just point it", "Old email moved into Google Workspace, if you have it"]] },
  lang: { h: "3h", hu: ["A teljes weboldal egy további nyelven.", ["Fordítás és lokalizálás", "Nyelvváltó és SEO-címkék"]],
    en: ["The full website in one more language.", ["Translation and localisation", "Language switcher and SEO tags"]] },
  newpage: { h: "", hu: ["Egy további aloldal a weboldaladhoz.", []], en: ["One more page for your website.", []] },
  care: { h: "", hu: ["Tárhely, domain és karbantartás egy havidíjban. Neked nincs vele dolgod.", ["Tárhely, domain, SSL, napi mentés", "Biztonsági frissítések és felügyelet", "Havi 30 perc apró módosítás (ár, nyitvatartás)"]],
    en: ["Hosting, domain and maintenance in one monthly fee. Nothing for you to manage.", ["Hosting, domain, SSL, daily backups", "Security updates and monitoring", "30 minutes of small edits monthly (prices, hours)"]] },
  mkt1: { h: "", hu: ["Iránytű: havi stratégia és kész posztok, te teszed ki őket.", ["Havi stratégia-frissítés", "8 kész poszt képpel", "Havi riport, 1 csatorna"]],
    en: ["Compass: monthly strategy and ready posts; you publish them.", ["Monthly strategy update", "8 ready posts with images", "Monthly report, 1 channel"]] },
  mkt2: { h: "", hu: ["Robotpilóta: mindent elkészítünk és közzéteszünk, te jóváhagysz.", ["12 poszt automatikusan közzétéve", "2 blogcikk, havi hírlevél", "Értékelés-válaszok, 2 csatorna"]],
    en: ["Autopilot: we create and publish everything; you approve.", ["12 posts published automatically", "2 blog articles, monthly newsletter", "Review replies, 2 channels"]] },
  mkt3: { h: "", hu: ["Teljes menedzsment: hirdetésekkel és heti optimalizálással.", ["20 poszt és rövid videók, 4 blogcikk", "Meta és Google hirdetések kezelése", "Heti javaslatok, 4 csatorna"]],
    en: ["Full management, with ads and weekly optimisation.", ["20 posts and short videos, 4 articles", "Meta and Google ads management", "Weekly suggestions, 4 channels"]] },
  shopcare: { h: "", hu: ["Havidíjas webshopkezelés, hogy a boltod mindig naprakész legyen.", ["Havi 30 új vagy módosított termék", "Akciók, kuponok, szezonális bannerek", "Készlet- és rendelésfigyelés, havi riport"]],
    en: ["Monthly shop management so your store is always up to date.", ["30 new or updated products a month", "Promotions, coupons, seasonal banners", "Stock and order monitoring, monthly report"]] },
  email: { h: "", hu: ["Saját domaines e-mail (Google Workspace), pl. info@cegem.hu, Gmaillel, naptárral, Drive-val.", ["Beállítás és domain-összekötés", "Postafiókonként havidíj", "Spam- és adathalászvédelem"]],
    en: ["Email on your own domain (Google Workspace), e.g. info@mybusiness.com, with Gmail, Calendar and Drive.", ["Setup and domain connection", "Monthly fee per mailbox", "Spam and phishing protection"]] },
  chat: { h: "", hu: ["0–24 válaszol a weboldalad látogatóinak kérdéseire, és összegyűjti az érdeklődőket.", ["Válaszol nyitvatartásról, árakról, szolgáltatásokról", "Időpontfoglalás és ajánlatkérés", "Magyarul és angolul, havi riporttal"]],
    en: ["Answers your website visitors 24/7 and collects leads.", ["Answers about hours, prices, services", "Bookings and quote requests", "Hungarian and English, with a monthly report"]] },
  phone: { h: "", hu: ["Felveszi a hívásokat a telefonodon, amikor te nem tudod, és e-mailben összefoglalja őket.", ["0–24 hívásfogadás magyarul és angolul", "Foglalás, ajánlatkérés, üzenetrögzítés", "Havi 200 perc, felette 49 Ft (€0.13)/perc"]],
    en: ["Answers calls on your phone when you can't and emails you a summary.", ["24/7 call answering in Hungarian and English", "Bookings, quote requests, messages", "200 minutes a month, then 49 Ft (€0.13)/min"]] },
  extra: { h: "", hu: ["Egy további csatorna a folyamatos marketinghez.", []], en: ["One more channel for continuous marketing.", []] },
};

/** Csomagok (site/index.html B tömb). rounds>2: 30 napig, különben 14 napig korlátlan apró módosítás. */
export const BUNDLES = [
  { id: "start", items: ["landing", "logo", "setup"], huf: 149900, eur: 389, mhuf: 0, meur: 0, rounds: 2,
    hu: ["START", "Egyoldalas weboldal + logó + Pro technikai csomag. Gyors, tiszta indulás."], en: ["START", "One-page site + logo + Pro technical package. A fast, clean launch."] },
  { id: "biz", items: ["site", "brand", "strategy", "setup"], huf: 399900, eur: 1039, mhuf: 0, meur: 0, rounds: 2,
    hu: ["ÜZLET", "Céges weboldal, brandbook, stratégia, élesre állítás. Minden, ami egy komoly induláshoz kell."], en: ["BUSINESS", "Business site, brandbook, strategy, launch. Everything a serious launch needs."] },
  { id: "grow", items: ["site", "brand", "strategy", "plan", "setup", "mkt2"], huf: 449900, eur: 1169, mhuf: 69900, meur: 179, rounds: 3,
    hu: ["NÖVEKEDÉS", "Az Üzlet csomag + 90 napos terv + automata havi marketing kedvezményes havidíjjal."], en: ["GROWTH", "Business bundle + 90-day plan + automated monthly marketing at a reduced monthly rate."] },
];

/** Pénzösszeg: HUF egészre, EUR legfeljebb 2 tizedesre (mint a weboldal kosara). */
export function fmt(v: number, cur: string, lang: Lang, monthly = false) {
  const pm = monthly ? (lang === "hu" ? "/hó" : "/mo") : "";
  if (cur !== "EUR") return new Intl.NumberFormat("hu-HU").format(Math.round(v)).replace(/ | /g, " ") + " Ft" + pm;
  const r = Math.round(v * 100) / 100;
  const s = new Intl.NumberFormat(lang === "hu" ? "hu-HU" : "en-GB", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 }).format(r).replace(/ | /g, " ");
  return (lang === "hu" ? s + " €" : "€" + s) + pm;
}
const firstApply = (o: number, cur: Cur) => (cur === "HUF" ? Math.round((o * FIRST_CLIENT_RATE) / 100) * 100 : Math.round(o * FIRST_CLIENT_RATE));
const half = (o: number, cur: Cur) => (cur === "HUF" ? Math.round(o / 2) : Math.round((o / 2) * 100) / 100);
const bPrice = (b: (typeof BUNDLES)[number], cur: Cur) => ({ o: cur === "HUF" ? b.huf : b.eur, m: b.items.includes("mkt2") ? (cur === "HUF" ? b.mhuf : b.meur) : 0 });

export const itemName = (id: string, lang: Lang) => itemById(id)?.[lang] || id;

/** A teljes ajánlat (szerkezetben); a szöveges változatot az MCP-eszköz állítja össze. */
export function offerData(lang: Lang) {
  return {
    items: CATALOG.map((c) => ({
      id: c.id, name: c[lang], huf: c.huf, eur: c.eur, monthly: !!c.monthly,
      description: ITEM_INFO[c.id]?.[lang][0] || "", includes: ITEM_INFO[c.id]?.[lang][1] || [], ready_in_hours: ITEM_INFO[c.id]?.h ? Number(ITEM_INFO[c.id].h.replace("h", "")) : null,
    })),
    bundles: BUNDLES.map((b) => ({ id: b.id, name: b[lang][0], description: b[lang][1], items: b.items, huf: b.huf, eur: b.eur, monthly_huf: b.mhuf || 0, monthly_eur: b.meur || 0, unlimited_small_changes_days: b.rounds > 2 ? 30 : 14 })),
    monthly_website_plan: Object.entries(SUBS).map(([id, s]) => ({ item: id, huf_per_month: s.huf, eur_per_month: s.eur, months: SUB_MONTHS, after_huf_per_month: s.after_huf, after_eur_per_month: s.after_eur, covers: s.covers })),
    first_client_discount: 1 - FIRST_CLIENT_RATE,
    sketch_fee: { threshold_huf: 200000, threshold_eur: 520, huf: 19900, eur: 49, credited: true },
  };
}

export interface QuoteIn { item_ids: string[]; currency: Cur; buyer_type: "b2b" | "b2c"; pay_mode: "full" | "sub"; first_client: boolean }

/** Árajánlat: orderPrice (a rendelésnél tárolt ár) + a weboldal kosarának csomag-logikája (site/index.html compute()). */
export function quote(q: QuoteIn) {
  const cur = q.currency;
  const ids = [...new Set(q.item_ids)].filter((x) => itemById(x));
  const unknown = [...new Set(q.item_ids)].filter((x) => !itemById(x));
  const op = orderPrice(ids, cur, { first_client: q.first_client, pay_mode: q.pay_mode });
  const sub = op.sub;
  const subIds = sub ? ids.filter((x) => x !== sub.item && !SUBS[sub.item].covers.includes(x)) : ids;
  const raw = priceOf(subIds, cur);
  const rawM = raw.monthly + (sub ? sub.amount : 0);
  // csomag, ami teljesen benne van a kosárban (mint a weboldalon): a legolcsóbb (egyszeri + 3 havi díj alapján)
  let applied: { id: string; o: number; m: number } | null = null;
  if (!sub) {
    for (const b of BUNDLES) {
      if (!b.items.every((i) => ids.includes(i))) continue;
      const r = priceOf(ids.filter((i) => !b.items.includes(i)), cur), bp = bPrice(b, cur);
      const tot = { id: b.id, o: bp.o + r.once, m: bp.m + r.monthly };
      if (tot.o + tot.m * 3 < raw.once + raw.monthly * 3 && (!applied || tot.o + tot.m * 3 < applied.o + applied.m * 3)) applied = tot;
    }
  }
  const once0 = applied ? applied.o : raw.once;
  const once = q.first_client ? firstApply(once0, cur) : once0;
  const monthly = applied ? applied.m : rawM;
  // csomag, ami több tételt ad ugyanannyiért vagy kevesebbért (a kosár bővítésével)
  const cheaper = sub ? [] : BUNDLES.filter((b) => !b.items.every((i) => ids.includes(i))).map((b) => {
    const all = [...new Set([...ids, ...b.items])];
    const r = priceOf(all.filter((i) => !b.items.includes(i)), cur), bp = bPrice(b, cur);
    return { id: b.id, items: b.items, adds: b.items.filter((i) => !ids.includes(i)), once: q.first_client ? firstApply(bp.o + r.once, cur) : bp.o + r.once, monthly: bp.m + r.monthly };
  }).filter((x) => x.once + x.monthly * 3 <= once + monthly * 3);
  // vázlatdíj: a szerver szabálya (a visszaigazoló levéllel azonos): a tételek nominális HUF egyszeri összege alapján
  const sketch = sketchFeeFor(ids, cur, { first_client: q.first_client, pay_mode: q.pay_mode }).amount;
  const h = half(once, cur);
  return {
    currency: cur, items: ids, unknown_items: unknown, pay_mode: sub ? "sub" : "full", first_client: q.first_client, buyer_type: q.buyer_type,
    once, monthly, items_once_before_bundle: raw.once, bundle_applied: applied ? applied.id : null,
    first_client_saving: q.first_client ? once0 - once : 0,
    sub: sub ? { item: sub.item, per_month: sub.amount, months: sub.months, after_per_month: sub.after, covers: SUBS[sub.item].covers } : null,
    sketch_fee: sketch,
    schedule: once ? { sketch: sketch, on_choice: h - sketch, on_approval: once - h } : null,
    cheaper_bundles: cheaper,
    stored_order_amount: op.once, // amit a rendelés a CRM-ben rögzít
  };
}
export type Quote = ReturnType<typeof quote>;

/** A számlázás és ÁFA rövid szabálya (chat.ts rules() és a weboldal szövegei alapján). */
export function vatText(buyer: "b2b" | "b2c", lang: Lang) {
  if (lang === "hu") return buyer === "b2c"
    ? "Magánszemélyként a kiírt ár a végső ár: ÁFÁ-t nem számítunk fel (korlátozott ÁFA-alany vagyunk, Észtország)."
    : "Vállalkozásként ÁFA nélküli számlát kapsz: közösségi (EU-s) adószámmal fordított adózással (az ÁFÁ-t te vallod be); közösségi adószám nélkül is ÁFA nélküli a számla, a bevallási teendőkről a könyvelőd tud nyilatkozni.";
  return buyer === "b2c"
    ? "As a private person the listed price is final: no VAT is charged (we are a limited VAT liable person, Estonia)."
    : "As a business you get an invoice without VAT: with an EU VAT number under reverse charge (you account for the VAT); without one the invoice is also without VAT, and your accountant can tell you whether you need to declare anything.";
}

/** Árajánlat szövegesen. */
export function quoteText(q: Quote, lang: Lang, addon = false) {
  const hu = lang === "hu", c = q.currency, L: string[] = [];
  L.push(hu ? "Tételek:" : "Items:");
  for (const id of q.items) {
    const it = itemById(id)!;
    const covered = q.sub && (id === q.sub.item || q.sub.covers.includes(id));
    L.push(`- ${it[lang]} (${id}): ${covered ? (id === q.sub!.item ? (hu ? "havidíjas weboldal, lásd lent" : "monthly website plan, see below") : (hu ? "benne van a havidíjban" : "included in the monthly plan")) : fmt(c === "EUR" ? it.eur : it.huf, c, lang, !!it.monthly)}`);
  }
  if (q.unknown_items.length) L.push((hu ? "Ismeretlen tétel-azonosító (kihagyva): " : "Unknown item ids (ignored): ") + q.unknown_items.join(", "));
  if (q.bundle_applied) { const b = BUNDLES.find((x) => x.id === q.bundle_applied)!; L.push(hu ? `Csomagár érvényes: ${b.hu[0]} (a tételek külön ${fmt(q.items_once_before_bundle, c, lang)} lennének).` : `Bundle price applies: ${b.en[0]} (items separately would be ${fmt(q.items_once_before_bundle, c, lang)}).`); }
  L.push(`${hu ? "Egyszeri díj (nettó)" : "One-off (net)"}: ${fmt(q.once, c, lang)}${q.first_client ? (hu ? ` (referencia-partner kedvezménnyel, −30%, megtakarítás ${fmt(q.first_client_saving, c, lang)})` : ` (reference-partner discount −30%, saving ${fmt(q.first_client_saving, c, lang)})`) : ""}`);
  if (q.monthly) L.push(`${hu ? "Havidíj (nettó)" : "Monthly (net)"}: ${fmt(q.monthly, c, lang, true)}`);
  if (q.sub) L.push(hu ? `Havidíjas weboldal: ${fmt(q.sub.per_month, c, lang, true)}, ${q.sub.months} hónapos szerződés; az első havidíj a vázlatirány kiválasztásakor, utána havonta kártyával. A 13. hónaptól csak ${fmt(q.sub.after_per_month, c, lang, true)} (üzemeltetés), és az oldal végleg a tiéd. Korábbi kiszállásnál a hátralévő havidíjakat egyben fizeted, és viszed az oldalt.`
    : `Monthly website plan: ${fmt(q.sub.per_month, c, lang, true)}, ${q.sub.months}-month contract; first month when you choose a sketch direction, then monthly by card. From month 13 only ${fmt(q.sub.after_per_month, c, lang, true)} (hosting and care), and the site is yours for good. Leaving earlier: pay the remaining months in one sum and take the site.`);
  if (addon) L.push(hu ? "A fizetés lépéseit és a határidőt a visszaigazolásban írásban egyeztetjük." : "Payment steps and timing are agreed in writing in our confirmation.");
  else L.push(`${hu ? "Vázlatdíj" : "Sketch fee"}: ${q.sketch_fee ? fmt(q.sketch_fee, c, lang) + (hu ? " (beszámítjuk a végösszegbe)" : " (credited to the total)") : (hu ? "nincs" : "none")}`);
  if (q.schedule && !addon) L.push(hu
    ? `Fizetés: 1) vázlatdíj ${q.schedule.sketch ? fmt(q.schedule.sketch, c, lang) : "0 Ft (ingyenes)"} → 3 vázlatirány 24 órán belül; 2) irányválasztáskor ${fmt(q.schedule.on_choice, c, lang)}; 3) végső jóváhagyáskor ${fmt(q.schedule.on_approval, c, lang)}.${q.monthly ? ` A havidíjak az élesítés napjától indulnak${q.sub ? " (a havidíjas weboldal első havidíja az irányválasztáskor esedékes)" : ""}.` : ""}`
    : `Payment: 1) sketch fee ${q.schedule.sketch ? fmt(q.schedule.sketch, c, lang) : "free"} → 3 directions within 24 hours; 2) on choosing a direction ${fmt(q.schedule.on_choice, c, lang)}; 3) on final approval ${fmt(q.schedule.on_approval, c, lang)}.${q.monthly ? ` Monthly fees start at go-live${q.sub ? " (the first month of the monthly website plan is due when you choose a direction)" : ""}.` : ""}`);
  for (const b of q.cheaper_bundles) {
    const bb = BUNDLES.find((x) => x.id === b.id)!;
    L.push(hu ? `Tipp: a(z) ${bb.hu[0]} csomaggal (+ ${b.adds.map((i) => itemName(i, lang)).join(", ")}) ${fmt(b.once, c, lang)}${b.monthly ? " + " + fmt(b.monthly, c, lang, true) : ""} lenne, vagyis többet kapsz ugyanannyiért vagy kevesebbért.`
      : `Tip: the ${bb.en[0]} bundle (+ ${b.adds.map((i) => itemName(i, lang)).join(", ")}) would be ${fmt(b.once, c, lang)}${b.monthly ? " + " + fmt(b.monthly, c, lang, true) : ""}, i.e. more for the same or less.`);
  }
  L.push(vatText(q.buyer_type, lang));
  return L.join("\n");
}

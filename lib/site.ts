// Az ügyfél meglévő weboldalának beolvasása (csak nyilvános http/https oldalak) és AI-átnézése.
import type { Env } from "./core";

export interface PageLink { url: string; title: string }
export interface SiteScan {
  url: string; final_url: string; title: string; description: string;
  headings: string[]; pages: PageLink[]; images: number; emails: string[]; phones: string[];
  text: string; theme_color?: string; og_image?: string;
}

const MAX_BYTES = 1_500_000;

/** Ügyfél által megadott cím normalizálása; belső hálózati címeket nem engedünk. */
export function normalizeUrl(raw: string): URL | null {
  let s = (raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h === "localhost") return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return null; // IP-cím helyett domain kell
  if (u.username || u.password) return null;
  u.hash = "";
  return u;
}

async function fetchHtml(u: URL): Promise<{ html: string; final: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(u.toString(), {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; WebbridgeSiteReview/1.0; +https://webbridge.hu)", accept: "text/html,application/xhtml+xml" },
    });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html") || !r.body) return null;
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = []; let n = 0;
    while (n < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length;
    }
    try { await reader.cancel(); } catch { /* */ }
    const buf = new Uint8Array(n); let o = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, n - o)), o); o += c.length; if (o >= n) break; }
    return { html: new TextDecoder().decode(buf), final: r.url || u.toString() };
  } catch { return null; } finally { clearTimeout(t); }
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : ""; };

export function parseHtml(html: string, base: string): Omit<SiteScan, "url"> {
  const final = base;
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const title = strip((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 200);
  const metas = body.match(/<meta\b[^>]*>/gi) || [];
  const meta = (k: string) => { for (const m of metas) { const n = (attr(m, "name") || attr(m, "property")).toLowerCase(); if (n === k) return attr(m, "content"); } return ""; };
  const headings = [...body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2])).filter(Boolean).slice(0, 30);
  const origin = new URL(final).hostname.replace(/^www\./, "");
  const seen = new Set<string>(); const pages: PageLink[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], "href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let u: URL; try { u = new URL(href, final); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== origin) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)$/i.test(u.pathname)) continue;
    u.hash = ""; u.search = "";
    const key = u.pathname.replace(/\/$/, "") || "/";
    if (seen.has(key)) continue;
    seen.add(key);
    const t = strip(m[2]) || attr(m[1], "title") || attr(m[1], "aria-label") || key;
    pages.push({ url: u.toString(), title: t.slice(0, 80) });
    if (pages.length >= 25) break;
  }
  const text = strip(body.replace(/<(br|p|div|li|h\d|tr|section|article)\b/gi, "\n$&")).slice(0, 12000);
  const emails = [...new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).slice(0, 5))];
  const phones = [...new Set((text.match(/(\+36|06)[\s\-/()]*\d{1,2}[\s\-/()]*\d{3}[\s\-]*\d{3,4}/g) || []).slice(0, 5))];
  return {
    final_url: final, title, description: (meta("description") || meta("og:description")).slice(0, 300), headings, pages,
    images: (body.match(/<img\b/gi) || []).length, emails, phones, text,
    theme_color: meta("theme-color") || undefined, og_image: meta("og:image") || undefined,
  };
}

export async function scanSite(raw: string): Promise<SiteScan | null> {
  const u = normalizeUrl(raw);
  if (!u) return null;
  let r = await fetchHtml(u);
  if (!r && u.protocol === "https:") { u.protocol = "http:"; r = await fetchHtml(u); }
  if (!r) return null;
  return { url: u.toString(), ...parseHtml(r.html, r.final) };
}

export interface SiteBrief { url: string; notes: string; pages: { url: string; title: string; choice: string }[] }

const CHOICE_HU: Record<string, string> = { keep: "maradjon", change: "legyen más", drop: "nem kell" };

/** A meglévő oldal átnézése Claude-dal: mit vigyünk át, mit hagyjunk el, mi hiányzik. Belső használatra, magyarul. */
export async function reviewSite(env: Env, site: SiteBrief, ctx: { business: string; what: string; items: string[] }): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const home = await scanSite(site.url);
  if (!home) return "A megadott oldalt nem sikerült betölteni (nem elérhető, vagy nem engedi a letöltést). Kérd el az ügyféltől a fontos szövegeket.";
  const sub: string[] = [];
  for (const p of site.pages.filter((x) => x.choice !== "drop").slice(0, 5)) {
    if (p.url.replace(/\/$/, "") === home.final_url.replace(/\/$/, "")) continue;
    const s = await scanSite(p.url);
    if (s) sub.push(`### ${p.title} (${p.url}) – ügyfél: ${CHOICE_HU[p.choice] || p.choice}\n${s.text.slice(0, 3500)}`);
  }
  const prompt = `Egy 24 órás weboldal-készítő csapat belső munkatársa vagy. Az ügyfél megadta a jelenlegi weboldalát, és utasításokat adott hozzá. Nézd át, és írj tömör, gyakorlati belső jegyzetet magyarul a készítő csapatnak.

Ügyfél: ${ctx.business || "-"}
Mivel foglalkozik: ${ctx.what || "-"}
Megrendelt tételek: ${ctx.items.join(", ") || "-"}
Az ügyfél utasításai a meglévő oldalhoz: ${site.notes || "(nem adott meg)"}
Oldalankénti döntései: ${site.pages.map((p) => `${p.title}: ${CHOICE_HU[p.choice] || p.choice}`).join("; ") || "(nincs)"}

JELENLEGI FŐOLDAL (${home.final_url})
Cím: ${home.title}
Leírás: ${home.description}
Címsorok: ${home.headings.join(" | ")}
Aloldalak: ${home.pages.map((p) => p.title).join(", ")}
Képek száma: ${home.images}; e-mail: ${home.emails.join(", ")}; telefon: ${home.phones.join(", ")}
Szöveg:
${home.text.slice(0, 6000)}

${sub.join("\n\n")}

A jegyzet szerkezete (rövid pontokban):
1. Mit csinál most az oldal, kinek szól (2 mondat).
2. Átvihető tartalom: konkrét szövegek, adatok, elérhetőségek, szolgáltatások, árak – amit az ügyfél nem zárt ki.
3. Amit az ügyfél szerint el kell hagyni vagy meg kell változtatni, és hogyan értelmezzük.
4. Gyengeségek a mostani oldalon (szerkezet, üzenet, cselekvésre hívás, mobil, gyorsaság jelei, elavult infó).
5. Javasolt új oldalszerkezet a megrendelt csomaghoz.
6. Kérdések az ügyfélnek, ha valami nem egyértelmű (legfeljebb 5).
Ne találj ki adatot; ha valami nem derül ki, írd, hogy nem derül ki.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const j = (await r.json()) as { content?: { type: string; text?: string }[]; error?: { message: string } };
    if (!r.ok) return `Az automatikus átnézés nem sikerült (${j.error?.message || r.status}).`;
    return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim() || null;
  } catch (e) {
    return `Az automatikus átnézés nem sikerült (${(e as Error).message}).`;
  }
}

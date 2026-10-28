// Revolut Business API kliens – CSAK OLVASÁS (accounts, transactions).
// Hitelesítés: JWT client assertion (RS256, saját privát kulcs) + nem lejáró refresh token.
// Doksi: https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request

const BASE = "https://b2b.revolut.com/api/1.0";

export interface RevolutEnv {
  REVOLUT_CLIENT_ID: string;
  REVOLUT_ISS: string;            // a redirect URI domainje https:// nélkül, pl. webbridge.hu
  REVOLUT_PRIVATE_KEY: string;    // PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----")
  REVOLUT_REFRESH_TOKEN: string;
}

export interface RvAccount { id: string; name?: string; balance: number; currency: string; state?: string; updated_at: string }
export interface RvLeg { leg_id: string; account_id?: string; amount: number; currency: string; fee?: number; description?: string; counterparty?: { account_type?: string; account_id?: string; name?: string } }
export interface RvTransaction { id: string; type: string; state: string; created_at: string; completed_at?: string; reference?: string; merchant?: { name?: string; category_code?: string }; legs: RvLeg[] }

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("PKCS#1 kulcs: alakítsd át PKCS#8-ra (openssl pkcs8 -topk8 -nocrypt)");
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Rövid életű client assertion JWT (5 perc). */
export async function clientAssertion(env: RevolutEnv): Promise<string> {
  const head = b64urlJson({ alg: "RS256", typ: "JWT" });
  const pay = b64urlJson({ iss: env.REVOLUT_ISS, sub: env.REVOLUT_CLIENT_ID, aud: "https://revolut.com", exp: Math.floor(Date.now() / 1000) + 300 });
  const key = await importKey(env.REVOLUT_PRIVATE_KEY);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${pay}`));
  return `${head}.${pay}.${b64url(sig)}`;
}

/** Új access token a refresh tokenből (40 percig érvényes). */
export async function accessToken(env: RevolutEnv): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.REVOLUT_REFRESH_TOKEN,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: await clientAssertion(env),
  });
  const r = await fetch(`${BASE}/auth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`Revolut token hiba ${r.status}: ${await r.text()}`);
  const j = await r.json() as { access_token: string };
  return j.access_token;
}

async function get<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Revolut GET ${path} hiba ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const listAccounts = (token: string) => get<RvAccount[]>(token, "/accounts");

/** Tranzakciók egy időponttól, lapozva (max. 1000/kérés, visszafelé időrendben). */
export async function listTransactionsSince(token: string, fromIso: string): Promise<RvTransaction[]> {
  const out: RvTransaction[] = [];
  let to: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ from: fromIso, count: "1000" });
    if (to) q.set("to", to);
    const batch = await get<RvTransaction[]>(token, `/transactions?${q}`);
    out.push(...batch);
    if (batch.length < 1000) break;
    to = batch[batch.length - 1].created_at;   // a legrégebbinél korábbiakat kérjük
  }
  return out;
}

/** Egyszerű besorolás a költség- és bevételi kimutatáshoz. */
export function categorize(t: RvTransaction, leg: RvLeg): string {
  const txt = `${leg.description ?? ""} ${t.merchant?.name ?? ""} ${leg.counterparty?.name ?? ""} ${t.reference ?? ""}`.toLowerCase();
  const rules: [string, RegExp][] = [
    ["stripe_payout", /stripe/],
    ["telnyx", /telnyx/],
    ["kompaas", /kompaas/],
    ["google", /google|workspace|gsuite/],
    ["brevo", /brevo|sendinblue/],
    ["cloudflare", /cloudflare/],
    ["anthropic", /anthropic|claude/],
    ["domain", /tarhely|openprovider|namecheap|domain/],
    ["accounting", /1office|baltic business/],
    ["github", /github/],
  ];
  for (const [cat, rx] of rules) if (rx.test(txt)) return cat;
  return leg.amount > 0 ? "other_income" : "other_cost";
}

// POST /api/pult/auth/facebook-deletion – Meta „Data Deletion Request Callback”.
// A Meta signed_request-et küld (form): "<aláírás>.<payload>", base64url; az aláírás HMAC-SHA256(payload, app secret).
// Ellenőrizzük, megkeressük az ügyfelet a Facebook-azonosító alapján (idővonal: signup / identity esemény),
// esemény + belső e-mail Zsoltnak a törlésről, és visszaadjuk az állapotoldal linkjét és a megerősítő kódot.
import { Env, json, logEvent, rid } from "../../../../lib/core";
import { sendMail, layout, rows } from "../../../../lib/mail";

function b64urlBytes(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** A signed_request ellenőrzése; érvényes aláírásnál a payload, egyébként null. */
async function verifySignedRequest(sr: string, secret: string): Promise<Record<string, unknown> | null> {
  const [sig, payload] = sr.split(".", 2);
  if (!sig || !payload) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(new TextDecoder().decode(b64urlBytes(payload))); } catch { return null; }
  if (String(data.algorithm || "").toUpperCase() !== "HMAC-SHA256") return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let sigBytes: Uint8Array;
  try { sigBytes = b64urlBytes(sig); } catch { return null; }
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  return ok ? data : null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.FACEBOOK_APP_SECRET) return json({ error: "not_configured" }, 503);
  const fd = await request.formData().catch(() => null);
  const sr = String(fd?.get("signed_request") || "");
  const data = sr.length < 4000 ? await verifySignedRequest(sr, env.FACEBOOK_APP_SECRET) : null;
  if (!data) return json({ error: "invalid_signed_request" }, 400);
  const fbId = String(data.user_id || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 64);
  if (!fbId) return json({ error: "missing_user_id" }, 400);

  const code = rid("del", 12).toUpperCase().replace(/^DEL/, "DEL-");
  const hit = await env.DB.prepare(
    "SELECT customer_id, json_extract(meta,'$.email') AS email, json_extract(meta,'$.user_id') AS user_id FROM events WHERE kind IN ('signup','identity') AND json_extract(meta,'$.provider')='facebook' AND json_extract(meta,'$.provider_id')=?1 ORDER BY at DESC LIMIT 1"
  ).bind(fbId).first<{ customer_id: string | null; email: string | null; user_id: string | null }>();

  await logEvent(env, {
    customer_id: hit?.customer_id || null, kind: "deletion_request", actor: "customer",
    title: `Adattörlési kérés (Facebook) – ${code}`,
    body: hit ? `Facebook-azonosító: ${fbId} · ${hit.email || ""}` : `Facebook-azonosító: ${fbId} (nincs hozzá ügyfél)`,
    meta: { provider: "facebook", provider_id: fbId, code, email: hit?.email || null, user_id: hit?.user_id || null, issued_at: data.issued_at ?? null },
  });
  await sendMail(env, {
    to: env.NOTIFY_TO, template: "internal_deletion_request", customer_id: hit?.customer_id || null,
    subject: `🗑 Adattörlési kérés (Facebook) – ${code}`,
    html: layout("hu", "Adattörlési kérés a Facebookon keresztül",
      `<p>Valaki a Facebook beállításaiban kérte, hogy töröljük a Webbridge-nél tárolt adatait. Töröld (vagy anonimizáld) a fiókját és az adatait 30 napon belül, a számviteli kötelezettség alá eső adatok kivételével.</p>` +
      rows([["Megerősítő kód", code], ["Facebook-azonosító", fbId], ["Ügyfél", hit?.customer_id || "nem található"], ["E-mail", hit?.email || ""], ["Pult-felhasználó", hit?.user_id || ""]]),
      hit?.customer_id ? { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${hit.customer_id}` } : undefined),
  });
  return json({ url: `${env.SITE_URL}/adattorles/?code=${code}`, confirmation_code: code });
};

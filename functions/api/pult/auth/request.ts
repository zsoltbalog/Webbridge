// POST /api/pult/auth/request {email, lang} – belépőlink küldése e-mailben.
// Mindig ugyanazt válaszoljuk (nem áruljuk el, van-e fiók az adott címmel).
import { Env, json, bad, clean, isEmail } from "../../../../lib/core";
import { sendMail, layout } from "../../../../lib/mail";
import { ensureOwner, loginLink, sameOrigin, PUser } from "../../../../lib/portal";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad("forbidden", 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const email = clean(b.email, 200).toLowerCase();
  const en = clean(b.lang, 2) === "en";
  if (!isEmail(email)) return bad(en ? "Please enter a valid email address." : "Adj meg egy érvényes e-mail-címet.");

  // Visszaélés ellen: címenként legfeljebb 3 link 15 percenként
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM action_tokens WHERE kind='login' AND email=?1 AND created_at > ?2")
    .bind(email, new Date(Date.now() - 15 * 6e4).toISOString()).first<{ n: number }>();
  if ((recent?.n || 0) >= 3) return json({ ok: true });

  let user = await env.DB.prepare("SELECT * FROM portal_users WHERE email=?1 AND disabled=0 ORDER BY role='owner' DESC, created_at DESC LIMIT 1").bind(email).first<PUser>();
  if (!user) {
    const c = await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(email).first<{ id: string }>();
    if (c) user = await ensureOwner(env, c.id);
  }
  if (!user) return json({ ok: true });

  const link = await loginLink(env, user, 30);
  const hu = (user.lang || (en ? "en" : "hu")) !== "en";
  await sendMail(env, {
    to: email, template: "pult_login", customer_id: user.customer_id,
    subject: hu ? "Belépés a Webbridge Pultba" : "Sign in to Webbridge Desk",
    html: layout(hu ? "hu" : "en", hu ? "Belépés a Pultba" : "Sign in to the Desk",
      hu ? "<p>Kattints a gombra a belépéshez. A link 30 percig érvényes, és egyszer használható.</p><p>Ha nem te kérted, nyugodtan hagyd figyelmen kívül ezt a levelet.</p>"
         : "<p>Click the button to sign in. The link is valid for 30 minutes and works once.</p><p>If you didn't ask for this, you can safely ignore this email.</p>",
      { label: hu ? "Belépés" : "Sign in", url: link }),
  });
  return json({ ok: true });
};

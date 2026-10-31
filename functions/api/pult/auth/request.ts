// POST /api/pult/auth/request {email, lang} – belépőlink küldése e-mailben; ismeretlen címre regisztrációs link megy.
// Mindig ugyanazt válaszoljuk (nem áruljuk el, van-e fiók az adott címmel).
import { Env, json, bad, clean, isEmail } from "../../../../lib/core";
import { sendMail, layout } from "../../../../lib/mail";
import { loginLink, sameOrigin, issueToken } from "../../../../lib/portal";
import { findUserForEmail, overHourly, clientIp, SIGNUPS_PER_HOUR } from "../../../../lib/signup";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return bad("forbidden", 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const email = clean(b.email, 200).toLowerCase();
  const en = clean(b.lang, 2) === "en";
  if (!isEmail(email)) return bad(en ? "Please enter a valid email address." : "Adj meg egy érvényes e-mail-címet.");

  // Visszaélés ellen: címenként legfeljebb 3 link 15 percenként (belépő és regisztrációs együtt)
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM action_tokens WHERE kind IN ('login','signup') AND email=?1 AND created_at > ?2")
    .bind(email, new Date(Date.now() - 15 * 6e4).toISOString()).first<{ n: number }>();
  if ((recent?.n || 0) >= 3) return json({ ok: true });

  const user = await findUserForEmail(env, email);
  if (user) {
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
  }

  // Ismeretlen cím: regisztrációs link (a fiók a link megnyitásakor jön létre). IP-címenként óránként korlátozva.
  if (await overHourly(env, `signup_link:${clientIp(request)}`, SIGNUPS_PER_HOUR)) return json({ ok: true });
  const lang = en ? "en" : "hu";
  const tok = await issueToken(env, { kind: "signup", email, ref_id: lang, minutes: 60 });
  const link = `${env.SITE_URL}/api/pult/auth/verify?t=${tok}`;
  await sendMail(env, {
    to: email, template: "pult_signup",
    subject: en ? "Your Webbridge Desk account" : "A Webbridge Pult-fiókod",
    html: layout(lang, en ? "One click and you're in" : "Egy kattintás, és kész",
      en ? "<p>Click the button to create your Webbridge Desk account and sign in. You don't need a password: next time you can sign in with an email link like this one.</p><p>In the Desk you can start an order, follow your work and review the drafts. The link is valid for 60 minutes and works once.</p><p>If you didn't ask for this, you can safely ignore this email – no account is created.</p>"
         : "<p>Kattints a gombra, és létrehozzuk a Webbridge Pult-fiókodat, és be is léptetünk. Jelszó nem kell: legközelebb is ilyen e-mailes linkkel lépsz be.</p><p>A Pultban rendelést indíthatsz, követheted a munkát, és véleményezheted a vázlatokat. A link 60 percig érvényes, és egyszer használható.</p><p>Ha nem te kérted, nyugodtan hagyd figyelmen kívül ezt a levelet – fiók nem jön létre.</p>",
      { label: en ? "Create account and sign in" : "Fiók létrehozása és belépés", url: link }),
  });
  return json({ ok: true });
};

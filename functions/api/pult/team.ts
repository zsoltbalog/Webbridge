// POST /api/pult/team {action:"invite", email, name} | {action:"remove", user_id}
// Csak a fiók gazdája hívhat meg véleményezőt (megjegyzést írhat, jóváhagyni és fizetni nem tud).
import { Env, json, bad, clean, isEmail, nowIso, rid, esc, logEvent } from "../../../lib/core";
import { sendMail, layout } from "../../../lib/mail";
import { requireUser, loginLink, PUser } from "../../../lib/portal";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const hu = u.lang !== "en";
  if (u.role !== "owner") return bad(hu ? "Meghívni csak a fiók gazdája tud." : "Only the account owner can invite.", 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const action = clean(b.action, 10);

  if (action === "remove") {
    const id = clean(b.user_id, 40);
    const r = await env.DB.prepare("UPDATE portal_users SET disabled=1 WHERE id=?1 AND customer_id=?2 AND role='reviewer'").bind(id, u.customer_id).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id=?1").bind(id).run();
    return r.meta.changes ? json({ ok: true }) : bad("Nincs ilyen véleményező.", 404);
  }
  if (action !== "invite") return bad("Ismeretlen művelet.");

  const email = clean(b.email, 200).toLowerCase(), name = clean(b.name, 100);
  if (!isEmail(email)) return bad(hu ? "Adj meg egy érvényes e-mail-címet." : "Please enter a valid email address.");
  const count = await env.DB.prepare("SELECT COUNT(*) n FROM portal_users WHERE customer_id=?1 AND role='reviewer' AND disabled=0").bind(u.customer_id).first<{ n: number }>();
  if ((count?.n || 0) >= 10) return bad(hu ? "Legfeljebb 10 véleményezőt hívhatsz meg." : "You can invite up to 10 reviewers.");
  let r = await env.DB.prepare("SELECT * FROM portal_users WHERE customer_id=?1 AND email=?2").bind(u.customer_id, email).first<PUser & { disabled: number }>();
  if (r && r.role === "owner") return bad(hu ? "Ez a te címed." : "That's your own address.");
  if (r) await env.DB.prepare("UPDATE portal_users SET disabled=0, name=COALESCE(NULLIF(?1,''),name) WHERE id=?2").bind(name, r.id).run();
  else {
    const id = rid("usr_");
    await env.DB.prepare("INSERT INTO portal_users (id,customer_id,email,name,role,lang,created_at,invited_by) VALUES (?1,?2,?3,?4,'reviewer',?5,?6,?7)")
      .bind(id, u.customer_id, email, name || null, u.lang, nowIso(), u.id).run();
    r = { id, customer_id: u.customer_id, email, name: name || null, role: "reviewer", lang: u.lang, disabled: 0 };
  }
  const c = await env.DB.prepare("SELECT business FROM customers WHERE id=?1").bind(u.customer_id).first<{ business: string }>();
  const link = await loginLink(env, r, 60 * 24 * 7);
  const who = esc(u.name || u.email), biz = esc(c?.business || "");
  await sendMail(env, {
    to: email, template: "pult_invite", customer_id: u.customer_id,
    subject: hu ? `${u.name || u.email} meghívott a Webbridge Pultba` : `${u.name || u.email} invited you to Webbridge Desk`,
    html: layout(hu ? "hu" : "en", hu ? "Meghívást kaptál" : "You're invited",
      hu ? `<p>${who} meghívott, hogy véleményezd a(z) ${biz || "vállalkozás"} anyagait (logó, arculat, weboldal) a Webbridge Pultban. Megjegyzést írhatsz bármelyik részhez; a jóváhagyás a fiók gazdájáé.</p><p>A link 7 napig érvényes. Később a pult oldalon e-mailes linkkel vagy Google-fiókkal léphetsz be.</p>`
         : `<p>${who} invited you to review the materials of ${biz || "the business"} (logo, brand, website) in Webbridge Desk. You can comment on any part; approval stays with the account owner.</p><p>The link is valid for 7 days. Later you can sign in with an email link or your Google account.</p>`,
      { label: hu ? "Megnyitom a Pultot" : "Open the Desk", url: link }),
  });
  await logEvent(env, { customer_id: u.customer_id, kind: "note", actor: "customer", title: `Véleményező meghívva: ${email}` });
  return json({ ok: true });
};

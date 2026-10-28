// POST /api/admin/projects/:id/email  {subject, message, cta_label?, cta_url?}
// Szabad szöveges levél az ügyfélnek a Webbridge sablonnal, hello@webbridge.hu-ról. A CRM idővonalra kerül.
import { Env, json, bad, clean, esc, touch } from "../../../../../lib/core";
import { sendMail, layout } from "../../../../../lib/mail";

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = clean(b.subject, 200), message = clean(b.message, 10000);
  if (!subject || !message) return bad("Tárgy és üzenet kell.");
  const p = await env.DB.prepare("SELECT p.id, p.customer_id, c.email, c.lang FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=?1").bind(id).first<any>();
  if (!p?.email) return bad("Nincs e-mail-cím.", 404);
  const html = message.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("");
  const cta = clean(b.cta_url, 500) ? { label: clean(b.cta_label, 60) || "Megnyitás", url: clean(b.cta_url, 500) } : undefined;
  const r = await sendMail(env, { to: p.email, subject, html: layout(p.lang === "en" ? "en" : "hu", subject, html, cta), template: "manual", customer_id: p.customer_id, project_id: id });
  await touch(env, p.customer_id, id);
  return json({ ok: r.ok, error: r.error });
};

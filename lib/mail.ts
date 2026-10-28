// Automatikus e-mailek Brevón keresztül (feladó: hello@webbridge.hu).
// Ha nincs BREVO_API_KEY, a levél "skipped" státusszal kerül a CRM-be, és nem megy ki.
import { Env, esc, nowIso, logEvent } from "./core";

export interface Mail {
  to: string; toName?: string; subject: string; html: string; text?: string;
  template: string; customer_id?: string | null; project_id?: string | null; replyTo?: string;
}

export async function sendMail(env: Env, m: Mail): Promise<{ ok: boolean; id?: string; error?: string }> {
  let status = "skipped", providerId: string | undefined, error: string | undefined;
  if (env.BREVO_API_KEY) {
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
          to: [{ email: m.to, name: m.toName || undefined }],
          replyTo: { email: m.replyTo || env.MAIL_FROM },
          subject: m.subject, htmlContent: m.html, textContent: m.text,
          tags: [m.template],
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { messageId?: string; message?: string };
      if (r.ok) { status = "sent"; providerId = j.messageId; } else { status = "failed"; error = `${r.status} ${j.message ?? ""}`; }
    } catch (e) { status = "failed"; error = String(e); }
  } else {
    error = "BREVO_API_KEY nincs beállítva";
  }
  await env.DB.prepare("INSERT INTO emails (at,customer_id,project_id,template,to_addr,subject,status,provider_id,error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
    .bind(nowIso(), m.customer_id ?? null, m.project_id ?? null, m.template, m.to, m.subject, status, providerId ?? null, error ?? null).run();
  if (m.customer_id && m.to !== env.NOTIFY_TO) {
    await logEvent(env, { customer_id: m.customer_id, project_id: m.project_id, kind: "email_out", title: `E-mail: ${m.subject}`, meta: { template: m.template, status, error } });
  }
  return { ok: status === "sent", id: providerId, error };
}

// ---------- Sablon ----------
export function layout(lang: string, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const foot = lang === "en"
    ? "Webbridge · operated by Tactical Edge Systems OÜ, Narva mnt 5, 10117 Tallinn, Estonia · Reply to this email if you have a question."
    : "Webbridge · üzemeltető: Tactical Edge Systems OÜ, Narva mnt 5, 10117 Tallinn, Észtország · Kérdés esetén válaszolj erre a levélre.";
  const btn = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#ff6b2c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px;display:inline-block">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#edeff2;font-family:Inter,Segoe UI,Arial,sans-serif;color:#10141b">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin-bottom:18px">Webbridge<span style="color:#ff6b2c">.</span></div>
<div style="background:#fff;border-radius:16px;padding:28px 24px;line-height:1.55;font-size:15px">
<h1 style="font-size:22px;line-height:1.25;margin:0 0 14px">${esc(title)}</h1>${bodyHtml}${btn}</div>
<p style="color:#6b7280;font-size:12px;line-height:1.5;margin:18px 4px">${esc(foot)}</p></div></body></html>`;
}

export const rows = (pairs: [string, string][]) =>
  `<table style="width:100%;border-collapse:collapse;margin:14px 0">${pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;width:42%;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`)
    .join("")}</table>`;

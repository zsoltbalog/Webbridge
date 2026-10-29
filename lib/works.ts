// Munkák, verziók, megjegyzések: közös logika a Pulthoz, a CRM-hez és az e-mailes jóváhagyáshoz.
import { Env, esc, logEvent, nowIso, rid, touch } from "./core";
import { sendMail, layout } from "./mail";
import { ensureOwner, issueToken, loginLink, KIND_HU, KIND_EN, PUser } from "./portal";

export interface Work { id: string; customer_id: string; project_id: string | null; kind: string; title: string; status: string }

export async function workDetail(env: Env, workId: string) {
  const versions = (await env.DB.prepare(
    "SELECT v.id,v.n,v.note,v.files,v.status,v.created_at,v.approved_at,v.approved_via,v.chosen,u.name AS approved_by_name,u.email AS approved_by_email FROM versions v LEFT JOIN portal_users u ON u.id=v.approved_by WHERE v.work_id=?1 ORDER BY v.n DESC"
  ).bind(workId).all()).results.map((v) => ({ ...v, files: JSON.parse(String(v.files || "[]")) }));
  const comments = (await env.DB.prepare(
    "SELECT c.*, COALESCE(u.name,u.email,c.author_name) AS author, u.role AS author_role FROM comments c LEFT JOIN portal_users u ON u.id=c.user_id WHERE c.work_id=?1 ORDER BY c.created_at"
  ).bind(workId).all()).results.map((c) => ({ ...c, attachment: c.attachment ? JSON.parse(String(c.attachment)) : null }));
  return { versions, comments };
}

export const replyTo = (env: Env, workId: string) => (env.REPLY_DOMAIN ? `pult+${workId}@${env.REPLY_DOMAIN}` : env.MAIL_FROM);

/** Megjegyzés létrehozása (Pult, e-mail-válasz vagy Webbridge-válasz). */
export async function addComment(env: Env, c: {
  work: Work; version_id: string; parent_id?: string | null; author_kind: "customer" | "staff" | "email"; user_id?: string | null; author_name?: string | null;
  file_key?: string | null; page?: number | null; x?: number | null; y?: number | null; action?: string | null; body: string; attachment?: unknown;
}) {
  const id = rid("cmt_"), t = nowIso();
  await env.DB.prepare(
    "INSERT INTO comments (id,work_id,version_id,parent_id,author_kind,user_id,author_name,file_key,page,x,y,action,body,attachment,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'open',?15,?15)"
  ).bind(id, c.work.id, c.version_id, c.parent_id ?? null, c.author_kind, c.user_id ?? null, c.author_name ?? null, c.file_key ?? null, c.page ?? null, c.x ?? null, c.y ?? null,
    c.action ?? null, c.body, c.attachment ? JSON.stringify(c.attachment) : null, t).run();
  await env.DB.prepare("UPDATE works SET updated_at=?1 WHERE id=?2").bind(t, c.work.id).run();
  if (c.author_kind !== "staff") {
    const act = ({ change: "Változtatás", add: "Hozzáadás", remove: "Törlés" } as Record<string, string>)[c.action || ""] || "Megjegyzés";
    await logEvent(env, { customer_id: c.work.customer_id, project_id: c.work.project_id, kind: "change_request", actor: "customer", title: `Pult – ${c.work.title}: ${act}`, body: c.body, meta: { work_id: c.work.id, comment_id: id } });
    await touch(env, c.work.customer_id, c.work.project_id);
  }
  return id;
}

/** Jóváhagyás: csak a fiók gazdája (Pultból vagy e-mailes linkkel). */
export async function approveVersion(env: Env, work: Work, versionId: string, u: PUser, via: "pult" | "email", chosen?: string | null) {
  const v = await env.DB.prepare("SELECT id,n,status,files FROM versions WHERE id=?1 AND work_id=?2").bind(versionId, work.id).first<{ id: string; n: number; status: string; files: string }>();
  if (!v) return { ok: false, error: "Nincs ilyen verzió." };
  if (v.status === "approved") return { ok: true, already: true, n: v.n };
  if (v.status === "superseded") return { ok: false, error: "Ezt a verziót már egy újabb váltotta." };
  const files = JSON.parse(v.files || "[]") as { key: string }[];
  const pick = chosen && files.some((f) => f.key === chosen) ? chosen : null;
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE versions SET status='approved', approved_at=?1, approved_by=?2, approved_via=?3, chosen=?4 WHERE id=?5").bind(t, u.id, via, pick, v.id),
    env.DB.prepare("UPDATE works SET status='approved', updated_at=?1 WHERE id=?2").bind(t, work.id),
  ]);
  const chosenName = pick ? (files as { key: string; label?: string; name?: string }[]).find((f) => f.key === pick) : null;
  await logEvent(env, { customer_id: work.customer_id, project_id: work.project_id, kind: "approval", actor: "customer", title: `Jóváhagyva: ${work.title} v${v.n}${chosenName ? ` (${chosenName.label || chosenName.name})` : ""}`, body: `${u.email} · ${via === "email" ? "e-mailes link" : "Pult"}`, meta: { work_id: work.id, version_id: v.id } });
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `✅ Jóváhagyva: ${work.title} v${v.n}`, template: "internal_approved", customer_id: work.customer_id, project_id: work.project_id,
    html: layout("hu", `Jóváhagyva: ${work.title} v${v.n}`, `<p>${esc(u.email)} jóváhagyta (${via === "email" ? "e-mailes link" : "Pult"}).${chosenName ? ` Választott irány: <b>${esc(chosenName.label || chosenName.name)}</b>.` : ""}</p>`, { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${work.customer_id}` }),
  });
  return { ok: true, n: v.n };
}

/** Az ügyfél jelzi: kész a visszajelzéssel (a nyitott megjegyzéseket egyben kapjuk meg). */
export async function feedbackSubmitted(env: Env, work: Work, versionId: string, u: PUser) {
  const v = await env.DB.prepare("SELECT n FROM versions WHERE id=?1 AND work_id=?2").bind(versionId, work.id).first<{ n: number }>();
  if (!v) return { ok: false, error: "Nincs ilyen verzió." };
  const open = (await env.DB.prepare("SELECT action,body,page FROM comments WHERE version_id=?1 AND parent_id IS NULL AND status='open' AND author_kind<>'staff' ORDER BY created_at").bind(versionId).all<{ action: string; body: string; page: number }>()).results;
  if (u.role === "owner") {
    await env.DB.batch([
      env.DB.prepare("UPDATE versions SET status='changes' WHERE id=?1 AND status='review'").bind(versionId),
      env.DB.prepare("UPDATE works SET status='changes', updated_at=?1 WHERE id=?2").bind(nowIso(), work.id),
    ]);
  }
  const act = (a: string) => ({ change: "Változtatás", add: "Hozzáadás", remove: "Törlés" } as Record<string, string>)[a] || "Megjegyzés";
  await sendMail(env, {
    to: env.NOTIFY_TO, subject: `✏️ Visszajelzés: ${work.title} v${v.n} (${open.length} pont)`, template: "internal_feedback", customer_id: work.customer_id, project_id: work.project_id,
    html: layout("hu", `Visszajelzés: ${work.title} v${v.n}`, `<p>${esc(u.email)} (${u.role === "owner" ? "fiók gazdája" : "véleményező"}) elküldte a visszajelzést.</p><ol>${open.map((c) => `<li><b>${act(c.action)}</b>${c.page ? ` (${c.page}. oldal)` : ""}: ${esc(c.body)}</li>`).join("")}</ol>`, { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${work.customer_id}` }),
  });
  await logEvent(env, { customer_id: work.customer_id, project_id: work.project_id, kind: "change_request", actor: "customer", title: `Visszajelzés elküldve: ${work.title} v${v.n} (${open.length} pont)` });
  return { ok: true, count: open.length };
}

/** Új verzió értesítője az ügyfélnek: Pult-belépő + egykattintásos jóváhagyó link (csak a gazdának). */
export async function notifyNewVersion(env: Env, work: Work, version: { id: string; n: number; note: string | null }) {
  const owner = await ensureOwner(env, work.customer_id);
  if (!owner) return { ok: false, error: "Az ügyfélnek nincs e-mail-címe." };
  const hu = owner.lang !== "en";
  const kind = (hu ? KIND_HU : KIND_EN)[work.kind] || work.kind;
  const open = await loginLink(env, owner, 60 * 24 * 7);
  const appr = await issueToken(env, { kind: "approve", user_id: owner.id, ref_id: version.id, minutes: 60 * 24 * 14 });
  const apprUrl = `${env.SITE_URL}/api/pult/approve-link?t=${appr}`;
  const title = hu ? `${kind}: ${work.title} – v${version.n} kész` : `${kind}: ${work.title} – v${version.n} is ready`;
  const body = hu
    ? `<p>Elkészült a(z) <b>${esc(work.title)}</b> ${version.n}. verziója.</p>${version.note ? `<p><i>${esc(version.note)}</i></p>` : ""}<p>A Pultban rábökhetsz bármelyik részére, és megírhatod, mit változtatnál, adnál hozzá vagy hagynál el. Csatolhatsz képet vagy fájlt is. Válaszlevélben is írhatsz, az is ide kerül.</p><p>Ha minden rendben, itt egy kattintással jóváhagyhatod: <a href="${esc(apprUrl)}">Jóváhagyom</a></p>`
    : `<p>Version ${version.n} of <b>${esc(work.title)}</b> is ready.</p>${version.note ? `<p><i>${esc(version.note)}</i></p>` : ""}<p>In the Desk you can tap any part of it and tell us what to change, add or remove. You can attach an image or file too. You can also just reply to this email.</p><p>If it's all good, approve it with one click: <a href="${esc(apprUrl)}">Approve</a></p>`;
  const r = await sendMail(env, { to: owner.email, subject: title, template: "pult_new_version", customer_id: work.customer_id, project_id: work.project_id, replyTo: replyTo(env, work.id), html: layout(hu ? "hu" : "en", title, body, { label: hu ? "Megnyitom a Pultban" : "Open in the Desk", url: open }) });
  return { ok: r.ok, error: r.error };
}

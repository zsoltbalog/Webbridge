// GET /api/pult/approve-link?t=… – egykattintásos jóváhagyás e-mailből (belépés nélkül, csak a gazdának kiadott, egyszer használatos link).
// A levelezők linkellenőrzője megnyithatja a GET-et, ezért a jóváhagyás egy gombnyomásra (POST) történik.
import { Env, esc } from "../../../lib/core";
import { consumeToken, peekToken, page, PUser } from "../../../lib/portal";
import { approveVersion, Work } from "../../../lib/works";

async function load(env: Env, versionId: string, userId: string) {
  const v = await env.DB.prepare("SELECT v.id,v.n,v.status,v.files,w.id AS work_id,w.customer_id,w.project_id,w.kind,w.title,w.status AS wstatus FROM versions v JOIN works w ON w.id=v.work_id WHERE v.id=?1").bind(versionId)
    .first<{ id: string; n: number; status: string; files: string; work_id: string; customer_id: string; project_id: string; kind: string; title: string; wstatus: string }>();
  const u = await env.DB.prepare("SELECT * FROM portal_users WHERE id=?1 AND disabled=0").bind(userId).first<PUser>();
  if (!v || !u || u.customer_id !== v.customer_id || u.role !== "owner") return null;
  return { v, u };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const t = new URL(request.url).searchParams.get("t") || "";
  const row = await peekToken(env, "approve", t);
  const x = row ? await load(env, row.ref_id, row.user_id) : null;
  if (!row || !x) return page("hu", "A link lejárt", `<p>Ez a jóváhagyó link már nem érvényes. Lépj be a Pultba, ott is jóváhagyhatod.</p><p><a class="b" href="/pult/">Pult</a></p>`, 410);
  const hu = x.u.lang !== "en";
  const files = JSON.parse(x.v.files || "[]") as { key: string; label?: string; name: string }[];
  const multi = files.length > 1;
  if (x.v.status === "approved") return page(hu ? "hu" : "en", hu ? "Már jóváhagytad" : "Already approved", `<p>${esc(x.v.title)} v${x.v.n}</p><p><a class="b" href="/pult/">${hu ? "Pult" : "Desk"}</a></p>`);
  const pick = multi ? `<p>${hu ? "Melyik irányt választod?" : "Which direction do you choose?"}</p>${files.map((f, i) => `<label style="display:block;margin:6px 0"><input type="radio" name="chosen" value="${esc(f.key)}" ${i === 0 ? "checked" : ""}> ${esc(f.label || f.name)}</label>`).join("")}` : "";
  return page(hu ? "hu" : "en", hu ? `Jóváhagyod? ${x.v.title} v${x.v.n}` : `Approve ${x.v.title} v${x.v.n}?`,
    `<p>${hu ? "A jóváhagyással ezt a verziót elfogadod, és ebből dolgozunk tovább. Ha inkább változtatnál, nyisd meg a Pultban." : "By approving you accept this version and we continue from it. If you'd rather change something, open it in the Desk."}</p>
<form method="post"><input type="hidden" name="t" value="${t.replace(/[^a-z0-9]/gi, "")}">${pick}<p><button class="b">${hu ? "Jóváhagyom" : "Approve"}</button></p></form>
<p><a href="/pult/#w/${esc(x.v.work_id)}">${hu ? "Inkább megnézem a Pultban" : "Open in the Desk instead"}</a></p>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const fd = await request.formData().catch(() => null);
  const t = String(fd?.get("t") || "");
  const pre = await peekToken(env, "approve", t);
  const x = pre ? await load(env, pre.ref_id, pre.user_id) : null;
  if (!pre || !x) return page("hu", "A link lejárt", `<p>Ez a jóváhagyó link már nem érvényes.</p><p><a class="b" href="/pult/">Pult</a></p>`, 410);
  const row = await consumeToken(env, "approve", t);
  if (!row) return page("hu", "A link lejárt", `<p>Ez a jóváhagyó link már nem érvényes.</p>`, 410);
  const w: Work = { id: x.v.work_id, customer_id: x.v.customer_id, project_id: x.v.project_id, kind: x.v.kind, title: x.v.title, status: x.v.wstatus };
  const r = await approveVersion(env, w, x.v.id, x.u, "email", String(fd?.get("chosen") || "") || null);
  const hu = x.u.lang !== "en";
  if (!r.ok) return page(hu ? "hu" : "en", hu ? "Nem sikerült" : "Didn't work", `<p>${esc(r.error || "")}</p><p><a class="b" href="/pult/">Pult</a></p>`, 409);
  return page(hu ? "hu" : "en", hu ? "Köszönjük, jóváhagyva!" : "Thank you, approved!", `<p>${esc(x.v.title)} v${x.v.n}. ${hu ? "Ebből dolgozunk tovább, és jelentkezünk a következő lépéssel." : "We'll continue from this and get back to you with the next step."}</p><p><a class="b" href="/pult/">${hu ? "Pult" : "Desk"}</a></p>`);
};

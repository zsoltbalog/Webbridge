// POST /api/pult/attach – csatolmány feltöltése egy megjegyzéshez (nyers törzs, x-filename fejléc). Visszaadja a kulcsot.
import { Env, json, bad, nowIso } from "../../../lib/core";
import { requireUser } from "../../../lib/portal";

const MAX = 15 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  if (!env.UPLOADS) return bad("A feltöltés átmenetileg nem elérhető.", 503);
  const size = Number(request.headers.get("content-length") || 0);
  if (!size || size > MAX) return bad(u.lang === "en" ? "Attachments can be at most 15 MB." : "Egy csatolmány legfeljebb 15 MB lehet.", 413);
  let name = "fajl";
  try { name = decodeURIComponent(request.headers.get("x-filename") || "fajl"); } catch { /* */ }
  name = name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "fajl";
  const type = (request.headers.get("content-type") || "application/octet-stream").slice(0, 100);
  if (/html|javascript|x-msdownload|x-sh|java-archive/i.test(type) || /\.(html?|js|exe|bat|cmd|sh|jar|msi)$/i.test(name)) return bad("Ezt a fájltípust nem fogadjuk.", 415);
  // napi korlát: 60 csatolmány ügyfelenként
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE customer_id=?1 AND kind='pult_attach' AND at > ?2").bind(u.customer_id, new Date(Date.now() - 864e5).toISOString()).first<{ n: number }>();
  if ((n?.n || 0) >= 60) return bad("Mára elérted a feltöltési korlátot.", 429);
  const key = `pult/${u.customer_id}/att/${Date.now()}-${name.replace(/[^\w.\-]+/g, "_")}`;
  await env.UPLOADS.put(key, request.body, { httpMetadata: { contentType: type }, customMetadata: { name, by: u.id } });
  await env.DB.prepare("INSERT INTO events (at,customer_id,kind,title,meta,actor) VALUES (?1,?2,'pult_attach',?3,?4,'customer')").bind(nowIso(), u.customer_id, `Csatolmány: ${name}`, JSON.stringify({ key })).run();
  return json({ ok: true, attachment: { key, name, type, size } });
};

// POST /api/admin/upload – Webbridge feltölt egy verziófájlt (nyers törzs). Fejlécek: x-work, x-filename.
// A kulcs: pult/<ügyfél>/works/<munka>/<időbélyeg>-<név>; ezt adja vissza, és a "version" művelet erre hivatkozik.
import { Env, json, bad } from "../../../lib/core";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.UPLOADS) return bad("Nincs R2 tárhely bekötve.", 503);
  const work = (request.headers.get("x-work") || "").slice(0, 40);
  const w = await env.DB.prepare("SELECT id,customer_id FROM works WHERE id=?1").bind(work).first<{ id: string; customer_id: string }>();
  if (!w) return bad("Nincs ilyen munka.", 404);
  let name = "fajl";
  try { name = decodeURIComponent(request.headers.get("x-filename") || "fajl"); } catch { /* */ }
  name = name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "fajl";
  // Ha a böngésző nem ad típust (gyakori .md és .json esetén), a kiterjesztésből következtetünk.
  const EXT: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", json: "application/json", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  let type = (request.headers.get("content-type") || "").split(";")[0].trim().slice(0, 100);
  if (!type || type === "application/octet-stream" || (ext === "md" || ext === "markdown" || ext === "json")) type = EXT[ext] || type || "application/octet-stream";
  const size = Number(request.headers.get("content-length") || 0);
  if (!size || size > 95 * 1024 * 1024) return bad("A fájl túl nagy (max. 95 MB).", 413);
  const key = `pult/${w.customer_id}/works/${w.id}/${Date.now()}-${name.replace(/[^\w.\-]+/g, "_")}`;
  await env.UPLOADS.put(key, request.body, { httpMetadata: { contentType: type }, customMetadata: { name } });
  return json({ ok: true, file: { key, name, type, size } });
};

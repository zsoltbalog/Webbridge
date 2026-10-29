// POST /api/upload – a rendelés elküldése után az ügyfél fájljai egyenként ide jönnek (R2 tárhelyre).
// Fejlécek: x-order (rendelésszám), x-token (az /api/intake által adott egyszer használatos kulcs), x-filename.
import { Env, json, bad, logEvent, nowIso } from "../../lib/core";

const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 15, WINDOW_H = 12;
const OK_TYPE = /^(image\/|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats|vnd\.ms-|vnd\.oasis\.opendocument|zip|x-zip|postscript|illustrator)|image\/svg)/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const en = request.headers.get("x-lang") === "en";
  if (!env.UPLOADS) return bad(en ? "File upload is temporarily unavailable. Please reply to our email with the files attached." : "A feltöltés átmenetileg nem elérhető. Válaszolj a visszaigazoló levelünkre, és csatold a fájlokat.", 503);
  const order = (request.headers.get("x-order") || "").slice(0, 30), token = (request.headers.get("x-token") || "").slice(0, 60);
  let name = "fajl";
  try { name = decodeURIComponent(request.headers.get("x-filename") || "fajl"); } catch { /* */ }
  name = name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "fajl";
  const type = (request.headers.get("content-type") || "application/octet-stream").slice(0, 100);
  const size = Number(request.headers.get("content-length") || 0);
  if (!order || !token) return bad("Hiányzó azonosító.", 401);
  if (!size || size > MAX_FILE) return bad(en ? "Files can be at most 25 MB." : "Egy fájl legfeljebb 25 MB lehet.", 413);
  if (!OK_TYPE.test(type) && !/\.(pdf|docx?|xlsx?|pptx?|odt|txt|zip|ai|eps|psd|svg|png|jpe?g|webp|heic|gif)$/i.test(name)) return bad(en ? "This file type isn't supported." : "Ezt a fájltípust nem fogadjuk.", 415);

  const p = await env.DB.prepare("SELECT id, customer_id, brief, created_at FROM projects WHERE id=?1").bind(order).first<{ id: string; customer_id: string; brief: string; created_at: string }>();
  if (!p) return bad("Ismeretlen rendelés.", 404);
  const brief = JSON.parse(p.brief || "{}") as { upload_token?: string; uploads?: unknown[] };
  if (!brief.upload_token || brief.upload_token !== token || Date.now() - Date.parse(p.created_at) > WINDOW_H * 3600e3) return bad(en ? "This upload link has expired. Please email us the files." : "A feltöltési lehetőség lejárt. Küldd el a fájlokat e-mailben.", 403);
  const uploads = (brief.uploads || []) as { key: string; name: string; size: number; type: string; at: string }[];
  if (uploads.length >= MAX_FILES) return bad(en ? `At most ${MAX_FILES} files per order.` : `Rendelésenként legfeljebb ${MAX_FILES} fájl.`, 413);

  const key = `projects/${p.id}/${Date.now()}-${name.replace(/[^\w.\-]+/g, "_")}`;
  await env.UPLOADS.put(key, request.body, { httpMetadata: { contentType: type }, customMetadata: { name, order: p.id } });
  const rec = { key, name, size, type, at: nowIso() };

  // Friss olvasás és hozzáfűzés (több fájl egymás után érkezik)
  const cur = await env.DB.prepare("SELECT brief FROM projects WHERE id=?1").bind(p.id).first<{ brief: string }>();
  const b2 = JSON.parse(cur?.brief || "{}");
  b2.uploads = [...(b2.uploads || []), rec];
  await env.DB.prepare("UPDATE projects SET brief=?1, updated_at=?2 WHERE id=?3").bind(JSON.stringify(b2), nowIso(), p.id).run();
  await logEvent(env, { customer_id: p.customer_id, project_id: p.id, kind: "file", actor: "customer", title: `Fájl feltöltve: ${name}`, body: `${Math.round(size / 1024)} KB · ${type}`, meta: { key } });
  return json({ ok: true, name });
};

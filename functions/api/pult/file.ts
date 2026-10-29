// GET /api/pult/file?key=pult/<ügyfél>/… – a Pult fájljai (verziók, csatolmányok), csak a saját ügyfél kulcsai alatt.
import { Env } from "../../../lib/core";
import { currentUser } from "../../../lib/portal";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = await currentUser(env, request);
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!u) return new Response("Belépés szükséges.", { status: 401 });
  if (!env.UPLOADS || !key.startsWith(`pult/${u.customer_id}/`) || key.includes("..")) return new Response("Nincs ilyen fájl.", { status: 404 });
  const o = await env.UPLOADS.get(key);
  if (!o) return new Response("Nincs ilyen fájl.", { status: 404 });
  const type = o.httpMetadata?.contentType || "application/octet-stream";
  const name = o.customMetadata?.name || key.split("/").pop() || "fajl";
  const inline = url.searchParams.get("dl") !== "1" && /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf)$/i.test(type);
  return new Response(o.body, {
    headers: {
      "content-type": type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
};

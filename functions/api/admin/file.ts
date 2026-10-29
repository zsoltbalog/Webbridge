// GET /api/admin/file?key=projects/WB-…/… – az ügyfél által feltöltött fájl letöltése a CRM-ből (jelszóval védett).
import { Env } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.UPLOADS || !(key.startsWith("projects/") || key.startsWith("pult/"))) return new Response("Nincs ilyen fájl.", { status: 404 });
  const o = await env.UPLOADS.get(key);
  if (!o) return new Response("Nincs ilyen fájl.", { status: 404 });
  const name = o.customMetadata?.name || key.split("/").pop() || "fajl";
  return new Response(o.body, {
    headers: {
      "content-type": o.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `${/^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(o.httpMetadata?.contentType || "") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
};

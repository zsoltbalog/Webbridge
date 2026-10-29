// GET /api/pult/auth/verify?t=… – a belépőlink. A levelezők linkellenőrzője is megnyithatja,
// ezért GET-re nem váltjuk be a tokent: egy oldal POST-tal (automatikusan) lépteti be a felhasználót.
import { Env } from "../../../../lib/core";
import { consumeToken, createSession, sessionCookie, peekToken, page } from "../../../../lib/portal";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const t = new URL(request.url).searchParams.get("t") || "";
  const ok = await peekToken(env, "login", t);
  if (!ok) return page("hu", "A link lejárt", `<p>Ez a belépőlink már nem érvényes (30 percig él, és egyszer használható).</p><p><a class="b" href="/pult/">Új link kérése</a></p>`, 410);
  return page("hu", "Belépés…", `<p>Egy pillanat, beléptetünk a Pultba.</p>
<form method="post" id="f"><input type="hidden" name="t" value="${t.replace(/[^a-z0-9]/gi, "")}"><button class="b">Belépés</button></form>
<script>document.getElementById("f").submit()</script>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const fd = await request.formData().catch(() => null);
  const t = String(fd?.get("t") || "");
  const row = await consumeToken(env, "login", t);
  if (!row || !row.user_id) return page("hu", "A link lejárt", `<p>Ez a belépőlink már nem érvényes.</p><p><a class="b" href="/pult/">Új link kérése</a></p>`, 410);
  const tok = await createSession(env, row.user_id, request.headers.get("user-agent") || "");
  return new Response(null, { status: 303, headers: { location: "/pult/", "set-cookie": sessionCookie(tok), "cache-control": "no-store" } });
};

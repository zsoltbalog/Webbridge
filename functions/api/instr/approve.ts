// GET/POST /api/instr/approve?id=&t=[&no=1] – a javaslat jóváhagyása (needs_ok → approved) vagy elutasítása (→ rejected).
import { Env, nowIso, esc } from "../../../lib/core";
import { page } from "../../../lib/portal";
import { confirmPage } from "../../../lib/instructions";

type Row = { id: string; status: string; ok_token: string; subject: string | null; proposal: string | null };
async function load(env: Env, url: URL) {
  const id = url.searchParams.get("id") || "", t = url.searchParams.get("t") || "";
  const r = await env.DB.prepare("SELECT id,status,ok_token,subject,proposal FROM instructions WHERE id=?1").bind(id).first<Row>();
  return r && t && r.ok_token === t ? r : null;
}
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url), r = await load(env, u), no = u.searchParams.get("no") === "1";
  if (!r) return page("hu", "Érvénytelen link", "<p>Ez a link nem érvényes.</p>", 404);
  if (r.status !== "needs_ok") return page("hu", "Már eldöntötted", "<p>Erről a javaslatról már döntöttél.</p>");
  return page("hu", no ? "Elutasítod?" : "Jóváhagyod?", `<p style="white-space:pre-wrap">${esc(r.proposal || "")}</p>` + confirmPage("", "", u.pathname + u.search, no ? "Nem, ne csináld" : "Jóváhagyom"));
};
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url), r = await load(env, u), no = u.searchParams.get("no") === "1";
  if (!r) return page("hu", "Érvénytelen link", "<p>Ez a link nem érvényes.</p>", 404);
  if (r.status === "needs_ok") await env.DB.prepare(`UPDATE instructions SET status='${no ? "rejected" : "approved"}', ok_token=NULL, updated_at=?1 WHERE id=?2`).bind(nowIso(), r.id).run();
  return page("hu", no ? "Rendben, nem csinálom ✓" : "Jóváhagyva ✓", no ? "<p>Lezártam.</p>" : "<p>A következő feldolgozáskor végrehajtom, és jelzem az eredményt.</p>");
};

// GET/POST /api/instr/confirm?id=&t= – „Indulhat”: a beérkezett utasítás sorba kerül (unconfirmed → queued).
import { Env, nowIso } from "../../../lib/core";
import { page } from "../../../lib/portal";
import { confirmPage } from "../../../lib/instructions";

type Row = { id: string; status: string; confirm_token: string; subject: string | null };
async function load(env: Env, url: URL) {
  const id = url.searchParams.get("id") || "", t = url.searchParams.get("t") || "";
  const r = await env.DB.prepare("SELECT id,status,confirm_token,subject FROM instructions WHERE id=?1").bind(id).first<Row>();
  return r && t && r.confirm_token === t ? r : null;
}
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url), r = await load(env, u);
  if (!r) return page("hu", "Érvénytelen link", "<p>Ez a link nem érvényes.</p>", 404);
  if (r.status !== "unconfirmed") return page("hu", "Már sorban van", "<p>Ezt az utasítást már elindítottad.</p>");
  return page("hu", "Indulhat?", confirmPage("", `Utasítás: <b>${(r.subject || r.id).replace(/</g, "&lt;")}</b>`, u.pathname + u.search, "Indulhat"));
};
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url), r = await load(env, u);
  if (!r) return page("hu", "Érvénytelen link", "<p>Ez a link nem érvényes.</p>", 404);
  if (r.status === "unconfirmed") await env.DB.prepare("UPDATE instructions SET status='queued', confirm_token=NULL, updated_at=?1 WHERE id=?2").bind(nowIso(), r.id).run();
  return page("hu", "Sorba tettem ✓", "<p>A következő feldolgozáskor elvégzem, és e-mailben jelzem az eredményt.</p>");
};

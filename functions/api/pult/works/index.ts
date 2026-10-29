// GET /api/pult/works – az ügyfél munkái (logó, arculat, szórólap…), a legutóbbi verzióval és a nyitott megjegyzések számával.
import { Env, json } from "../../../../lib/core";
import { requireUser } from "../../../../lib/portal";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const works = (await env.DB.prepare(
    `SELECT w.id,w.kind,w.title,w.status,w.updated_at,
      (SELECT MAX(n) FROM versions v WHERE v.work_id=w.id) AS last_n,
      (SELECT files FROM versions v WHERE v.work_id=w.id ORDER BY n DESC LIMIT 1) AS last_files,
      (SELECT COUNT(*) FROM comments c WHERE c.work_id=w.id AND c.parent_id IS NULL AND c.status IN ('open','doing')) AS open_comments,
      (SELECT COUNT(*) FROM comments c WHERE c.work_id=w.id AND c.parent_id IS NULL AND c.status='done') AS done_comments
     FROM works w WHERE w.customer_id=?1 AND w.status<>'draft' ORDER BY w.updated_at DESC`
  ).bind(u.customer_id).all()).results;
  return json({ ok: true, works });
};

// GET /api/admin/overview – irányítópult: státuszok, teendők, legutóbbi események, bevétel.
import { Env, json, stuckInfo } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const since90 = new Date(Date.now() - 90 * 864e5).toISOString();
  const [stages, todo, events, revenue, cfg, src] = await Promise.all([
    env.DB.prepare("SELECT stage, COUNT(*) n FROM projects GROUP BY stage").all(),
    env.DB.prepare(
      "SELECT p.id, p.title, p.stage, p.next_action, p.next_action_at, COALESCE(p.stage_at,p.updated_at) stage_at, p.customer_id, c.email FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.stage NOT IN ('live','care','lost') ORDER BY COALESCE(p.next_action_at,p.updated_at) ASC LIMIT 30"
    ).all(),
    env.DB.prepare(
      "SELECT e.*, c.business, c.name, c.email FROM events e LEFT JOIN customers c ON c.id=e.customer_id ORDER BY e.id DESC LIMIT 40"
    ).all(),
    env.DB.prepare(
      "SELECT currency, SUM(amount) total, COUNT(*) n FROM payments WHERE status='paid' AND at >= ?1 GROUP BY currency"
    ).bind(new Date(Date.now() - 30 * 864e5).toISOString()).all(),
    Promise.resolve({
      brevo: !!env.BREVO_API_KEY, stripe: !!env.STRIPE_SECRET_KEY, stripe_webhook: !!env.STRIPE_WEBHOOK_SECRET, anthropic: !!env.ANTHROPIC_API_KEY,
      cron: !!env.CRON_SECRET, review: !!env.REVIEW_URL,
    }),
    // Lead-forrás riport (90 nap): projektek, megnyert projektek, befizetett összeg pénznemenként
    env.DB.prepare(
      `SELECT COALESCE(json_extract(p.attribution,'$.source'),'ismeretlen') source, COUNT(*) leads,
        SUM(CASE WHEN p.stage IN ('sketch_paid','sketches','deposit_paid','building','review','live','care') THEN 1 ELSE 0 END) won,
        SUM(COALESCE((SELECT SUM(amount) FROM payments y WHERE y.project_id=p.id AND y.status='paid' AND y.currency='HUF'),0)) paid_huf,
        SUM(COALESCE((SELECT SUM(amount) FROM payments y WHERE y.project_id=p.id AND y.status='paid' AND y.currency='EUR'),0)) paid_eur
       FROM projects p WHERE p.created_at >= ?1 GROUP BY 1 ORDER BY leads DESC`
    ).bind(since90).all(),
  ]);
  const todoRows = (todo.results as any[]).map((p) => ({ ...p, sla: stuckInfo(p.stage, p.stage_at) }))
    .sort((a, b) => Number(!!b.sla?.stuck) - Number(!!a.sla?.stuck));
  return json({ stages: stages.results, todo: todoRows, events: events.results, revenue30: revenue.results, config: cfg, sources: src.results });
};

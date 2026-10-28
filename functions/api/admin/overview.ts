// GET /api/admin/overview – irányítópult: státuszok, teendők, legutóbbi események, bevétel.
import { Env, json } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [stages, todo, events, revenue, cfg] = await Promise.all([
    env.DB.prepare("SELECT stage, COUNT(*) n FROM projects GROUP BY stage").all(),
    env.DB.prepare(
      "SELECT p.id, p.title, p.stage, p.next_action, p.next_action_at, p.customer_id, c.email FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.stage NOT IN ('live','care','lost') ORDER BY COALESCE(p.next_action_at,p.updated_at) ASC LIMIT 30"
    ).all(),
    env.DB.prepare(
      "SELECT e.*, c.business, c.name, c.email FROM events e LEFT JOIN customers c ON c.id=e.customer_id ORDER BY e.id DESC LIMIT 40"
    ).all(),
    env.DB.prepare(
      "SELECT currency, SUM(amount) total, COUNT(*) n FROM payments WHERE status='paid' AND at >= ?1 GROUP BY currency"
    ).bind(new Date(Date.now() - 30 * 864e5).toISOString()).all(),
    Promise.resolve({
      brevo: !!env.BREVO_API_KEY, stripe: !!env.STRIPE_SECRET_KEY, stripe_webhook: !!env.STRIPE_WEBHOOK_SECRET, anthropic: !!env.ANTHROPIC_API_KEY,
    }),
  ]);
  return json({ stages: stages.results, todo: todo.results, events: events.results, revenue30: revenue.results, config: cfg });
};

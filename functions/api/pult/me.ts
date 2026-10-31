// GET /api/pult/me – a belépett felhasználó, az ügyfél és (a gazdának) a véleményezők listája.
import { Env, json } from "../../../lib/core";
import { requireUser } from "../../../lib/portal";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const c = await env.DB.prepare("SELECT business,name,lang FROM customers WHERE id=?1").bind(u.customer_id).first<{ business: string; name: string; lang: string }>();
  const team = (await env.DB.prepare("SELECT id,email,name,role,last_login,disabled FROM portal_users WHERE customer_id=?1 ORDER BY role='owner' DESC, created_at").bind(u.customer_id).all()).results;
  // Rendelés nélküli (frissen regisztrált) fióknál a Pult üdvözlő üres állapotot mutat.
  const pc = await env.DB.prepare("SELECT COUNT(*) n FROM projects WHERE customer_id=?1").bind(u.customer_id).first<{ n: number }>();
  return json({ ok: true, user: u, customer: { business: c?.business || "", name: c?.name || "" }, team: u.role === "owner" ? team : [], projects: pc?.n || 0, google: !!env.GOOGLE_CLIENT_ID, facebook: !!env.FACEBOOK_APP_ID });
};

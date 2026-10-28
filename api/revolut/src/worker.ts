// Cloudflare Worker: Revolut → D1 szinkron (ütemezett) + belső pénzügyi összesítő végpont.
// Csak olvas a Revolutból. Utalást, fizetést nem tud indítani (READ scope).
import { accessToken, listAccounts, listTransactionsSince, categorize, type RevolutEnv } from "./revolut";

interface Env extends RevolutEnv {
  DB: D1Database;
  ADMIN_TOKEN: string;
}

async function sync(env: Env): Promise<{ accounts: number; legs: number; since: string }> {
  const token = await accessToken(env);
  const now = new Date().toISOString();

  const accounts = await listAccounts(token);
  const accStmts = accounts.map(a => env.DB.prepare(
    "INSERT INTO rv_accounts (id,name,currency,balance,state,updated_at) VALUES (?1,?2,?3,?4,?5,?6) " +
    "ON CONFLICT(id) DO UPDATE SET name=?2,currency=?3,balance=?4,state=?5,updated_at=?6"
  ).bind(a.id, a.name ?? null, a.currency, a.balance, a.state ?? null, now));

  // 3 nap átfedéssel szinkronizálunk, hogy a függő tranzakciók állapota is frissüljön.
  const last = await env.DB.prepare("SELECT v FROM rv_state WHERE k='last_sync'").first<{ v: string }>();
  const since = last ? new Date(Date.parse(last.v) - 3 * 864e5).toISOString() : "2026-10-01T00:00:00Z";
  const txs = await listTransactionsSince(token, since);

  const txStmts = txs.flatMap(t => t.legs.map(l => env.DB.prepare(
    "INSERT INTO rv_transactions (id,leg_id,account_id,type,state,created_at,completed_at,amount,currency,fee,description,counterparty,merchant,reference,category,raw) " +
    "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) " +
    "ON CONFLICT(id,leg_id) DO UPDATE SET state=?5,completed_at=?7,amount=?8,fee=?10,category=?15,raw=?16"
  ).bind(t.id, l.leg_id, l.account_id ?? null, t.type, t.state, t.created_at, t.completed_at ?? null, l.amount, l.currency,
    l.fee ?? null, l.description ?? null, l.counterparty?.name ?? null, t.merchant?.name ?? null, t.reference ?? null,
    categorize(t, l), JSON.stringify(t))));

  const all = [...accStmts, ...txStmts, env.DB.prepare("INSERT INTO rv_state (k,v) VALUES ('last_sync',?1) ON CONFLICT(k) DO UPDATE SET v=?1").bind(now)];
  for (let i = 0; i < all.length; i += 100) await env.DB.batch(all.slice(i, i + 100));
  return { accounts: accounts.length, legs: txStmts.length, since };
}

async function summary(env: Env, month: string) {
  const balances = await env.DB.prepare("SELECT name,currency,balance,updated_at FROM rv_accounts WHERE state IS NULL OR state='active' ORDER BY currency").all();
  const byCategory = await env.DB.prepare(
    "SELECT category,currency,ROUND(SUM(amount),2) AS total,COUNT(*) AS n FROM rv_transactions " +
    "WHERE state='completed' AND substr(created_at,1,7)=?1 GROUP BY category,currency ORDER BY total"
  ).bind(month).all();
  return { month, balances: balances.results, byCategory: byCategory.results };
}

export default {
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sync(env).then(r => console.log("revolut sync", r)));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = req.headers.get("Authorization") ?? "";
    if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
    const url = new URL(req.url);
    try {
      if (url.pathname === "/admin/finance/sync" && req.method === "POST") return Response.json(await sync(env));
      if (url.pathname === "/admin/finance/summary") {
        const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
        return Response.json(await summary(env, month));
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502 });
    }
  },
};

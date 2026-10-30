// /mcp – MCP (Model Context Protocol) szerver, Streamable HTTP: JSON-RPC 2.0 POST-tal, JSON-válasszal (SSE nélkül).
// Az ügyfél a saját AI-asszisztenséből (Claude, ChatGPT…) connectorként adja hozzá:
//   nyilvános: https://webbridge.hu/mcp   ·   személyes: https://webbridge.hu/mcp?k=<token> (a Pultból) vagy Authorization: Bearer <token>
// Az eszközök logikája: lib/mcp.ts.
import { Env } from "../lib/core";
import { TOOLS, TOOL_NAMES, LIMITS, SERVER_VERSION, instructions, tokenFrom, authToken, overLimit, callTool, McpCtx } from "../lib/mcp";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};
const HDR = { ...CORS, "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };

type Id = string | number | null;
type Msg = { jsonrpc?: string; id?: Id; method?: unknown; params?: unknown };

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...HDR, "content-type": "application/json; charset=utf-8" } });
const rpcErr = (id: Id, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcOk = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: HDR });

// Nincs szerver felől induló SSE-folyam: a GET-re 405 (a specifikáció szerint megengedett).
export const onRequestGet: PagesFunction<Env> = async () =>
  new Response("Webbridge MCP server: use POST (JSON-RPC 2.0). Guide: /ai/", { status: 405, headers: { ...HDR, allow: "POST, OPTIONS", "content-type": "text/plain; charset=utf-8" } });
export const onRequestDelete: PagesFunction<Env> = async () => new Response(null, { status: 405, headers: { ...HDR, allow: "POST, OPTIONS" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let raw: unknown;
  try { raw = JSON.parse(await request.text()); } catch { return out(rpcErr(null, -32700, "Parse error"), 400); }
  const batch = Array.isArray(raw);
  const msgs = (batch ? raw : [raw]) as Msg[];
  if (!msgs.length || msgs.length > 50) return out(rpcErr(null, -32600, "Invalid Request"), 400);

  const ip = request.headers.get("cf-connecting-ip") || "local";
  const auth = await authToken(env, tokenFrom(request));
  // óránkénti korlát: nyilvánosan IP-címenként, személyes linkkel tokenenként (és bőkezűbben IP-nként)
  const n = msgs.length;
  const limited = auth.tokenId
    ? (await overLimit(env, `mcp-tok:${auth.tokenId}`, LIMITS.tokenPerHour, n)) || (await overLimit(env, `mcp-ip:${ip}`, LIMITS.ipWithTokenPerHour, n))
    : await overLimit(env, `mcp-ip:${ip}`, LIMITS.publicPerHour, n);
  if (limited) {
    const e = (m: Msg) => rpcErr(m && m.id !== undefined ? m.id : null, -32000, "Rate limit exceeded – please try again later (Túl sok kérés, próbáld később).");
    return new Response(JSON.stringify(batch ? msgs.map(e) : e(msgs[0])), { status: 429, headers: { ...HDR, "content-type": "application/json; charset=utf-8", "retry-after": "600" } });
  }

  const ctx: McpCtx = { env, auth, ip, waitUntil };
  const results: unknown[] = [];
  let negotiated = "";
  for (const m of msgs) {
    const r = await handle(ctx, m);
    if (r && typeof r === "object" && "result" in r && (r as { result: { protocolVersion?: string } }).result?.protocolVersion) negotiated = (r as { result: { protocolVersion: string } }).result.protocolVersion;
    if (r) results.push(r);
  }
  // csak értesítések/válaszok érkeztek: 202, törzs nélkül
  if (!results.length) return new Response(null, { status: 202, headers: HDR });
  const res = out(batch ? results : results[0]);
  if (negotiated) res.headers.set("mcp-protocol-version", negotiated);
  return res;
};

async function handle(ctx: McpCtx, m: Msg): Promise<unknown | null> {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return rpcErr(m && typeof m === "object" && m.id !== undefined ? m.id : null, -32600, "Invalid Request");
  const isNote = m.id === undefined;
  // kliens-válasz (pl. sampling) vagy értesítés: nincs válasz
  if (typeof m.method !== "string") return isNote ? null : rpcErr(m.id ?? null, -32600, "Invalid Request");
  if (isNote) return null; // notifications/initialized, notifications/cancelled …
  const id = m.id as Id;
  const p = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  try {
    switch (m.method) {
      case "initialize": {
        const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
        return rpcOk(id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "webbridge", title: "Webbridge", version: SERVER_VERSION },
          instructions: instructions(ctx.env) + (ctx.auth.user ? `\nThis is a personal connector for ${ctx.auth.user.email} (${ctx.auth.user.role}).` : ctx.auth.invalid ? "\nThe personal link in this connector is invalid or revoked; only public tools work until a new link is created in the Desk." : "\nThis is the public connector: personal tools need a personal link from the Desk."),
        });
      }
      case "ping": return rpcOk(id, {});
      case "tools/list": return rpcOk(id, { tools: TOOLS });
      case "tools/call": {
        const name = typeof p.name === "string" ? p.name : "";
        if (!TOOL_NAMES.has(name)) return rpcErr(id, -32602, `Unknown tool: ${name.slice(0, 60)}`);
        const args = (p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
        return rpcOk(id, await callTool(ctx, name, args));
      }
      case "resources/list": return rpcOk(id, { resources: [] });
      case "prompts/list": return rpcOk(id, { prompts: [] });
      default: return rpcErr(id, -32601, "Method not found");
    }
  } catch (e) {
    console.error("mcp", m.method, e);
    if (m.method === "tools/call") return rpcOk(id, { content: [{ type: "text", text: "Belső hiba történt, próbáld újra később. / Internal error, please try again later." }], isError: true });
    return rpcErr(id, -32603, "Internal error");
  }
}

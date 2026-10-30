// POST /api/pult/inbound?k=<CRON_SECRET> – bejövő e-mail (Brevo Inbound Parsing webhook).
// Ha a címzett pult+<munka>@<REPLY_DOMAIN>, a válasz megjegyzésként kerül a munka legutóbbi verziójához.
import { Env, json, nowIso } from "../../../lib/core";
import { addComment, Work } from "../../../lib/works";
import { sha256 } from "../../../lib/portal";
import { createInstruction, isOwner, instrAddress } from "../../../lib/instructions";

type Item = { MessageId?: string; SentAtDate?: string; Uuid?: string[]; From?: { Address?: string; Name?: string }; To?: { Address?: string }[]; Recipients?: string[]; Subject?: string; ExtractedMarkdownMessage?: string; RawTextBody?: string; Attachments?: { Name: string; ContentType: string; DownloadToken?: string; ContentLength?: number }[] };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const k = new URL(request.url).searchParams.get("k") || "";
  if (!env.CRON_SECRET || k !== env.CRON_SECRET) return json({ ok: false }, 401);
  const b = (await request.json().catch(() => ({}))) as { items?: Item[] };
  let added = 0;
  for (const it of b.items || []) {
    const to = [...(it.To || []).map((x) => x.Address || ""), ...(it.Recipients || [])].join(" ");
    // Utasítás-csatorna: utasitas@REPLY_DOMAIN, csak a tulajdonos címeiről
    if (env.REPLY_DOMAIN && to.toLowerCase().includes(instrAddress(env))) {
      const fromI = (it.From?.Address || "").toLowerCase();
      const textI = (it.ExtractedMarkdownMessage || it.RawTextBody || "").trim().slice(0, 8000);
      if (!isOwner(env, fromI) || !textI) continue;
      const keyI = it.MessageId ? `mid:${it.MessageId}` : `h:${await sha256(`instr|${fromI}|${it.SentAtDate || ""}|${textI}`)}`;
      const insI = await env.DB.prepare("INSERT OR IGNORE INTO inbound_seen (key,at) VALUES (?1,?2)").bind(keyI, nowIso()).run();
      if (!insI.meta.changes) continue;
      await createInstruction(env, { from: fromI, subject: (it.Subject || "").slice(0, 200), body: textI, attachments: (it.Attachments || []).map((a) => a.Name).filter(Boolean) });
      added++;
      continue;
    }
    const m = to.match(/pult\+(wrk_[a-z0-9]+)@/i);
    if (!m) continue;
    const w = await env.DB.prepare("SELECT * FROM works WHERE id=?1").bind(m[1]).first<Work>();
    if (!w) continue;
    const from = (it.From?.Address || "").toLowerCase();
    // csak az ügyfél ismert címeiről fogadunk megjegyzést
    const u = await env.DB.prepare("SELECT id,name FROM portal_users WHERE customer_id=?1 AND email=?2 AND disabled=0").bind(w.customer_id, from).first<{ id: string; name: string }>();
    const known = u || (await env.DB.prepare("SELECT id FROM customers WHERE id=?1 AND email=?2").bind(w.customer_id, from).first());
    if (!known) continue;
    const v = await env.DB.prepare("SELECT id FROM versions WHERE work_id=?1 ORDER BY n DESC LIMIT 1").bind(w.id).first<{ id: string }>();
    if (!v) continue;
    const text = (it.ExtractedMarkdownMessage || it.RawTextBody || "").trim().slice(0, 4000);
    const atts = (it.Attachments || []).map((a) => a.Name).filter(Boolean);
    if (!text && !atts.length) continue;
    // ismétlődés szűrése: ugyanaz a levél (Message-ID, vagy feladó + munka + szöveg) csak egyszer lesz megjegyzés
    const key = it.MessageId ? `mid:${it.MessageId}` : `h:${await sha256(`${w.id}|${from}|${it.SentAtDate || ""}|${text}|${atts.join(",")}`)}`;
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO inbound_seen (key,at) VALUES (?1,?2)").bind(key, nowIso()).run();
    if (!ins.meta.changes) continue;
    await addComment(env, { work: w, version_id: v.id, author_kind: "email", user_id: u?.id || null, author_name: it.From?.Name || from, action: "change",
      body: text + (atts.length ? `\n\n[Csatolmány a levélben: ${atts.join(", ")} – a hello@ postafiókban]` : "") });
    added++;
  }
  return json({ ok: true, added, at: nowIso() });
};

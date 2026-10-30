// E-mailes utasítás-csatorna: Zsolt ír az utasitas@REPLY_DOMAIN címre, mi sorba tesszük.
// Biztonság: a feladó-cím hamisítható, ezért minden utasítás csak a visszaigazoló link
// („Indulhat”) megnyomása után kerül sorra. Nyilvános változásnál a feldolgozó előbb javaslatot küld,
// és csak a második link („Jóváhagyom”) után hajtja végre.
import { Env, nowIso, rid, logEvent, esc } from "./core";
import { sendMail, layout } from "./mail";
import { randToken } from "./portal";

export const instrAddress = (env: Env) => `utasitas@${env.REPLY_DOMAIN}`;
export const isOwner = (env: Env, email: string) =>
  (env.OWNER_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

export async function createInstruction(env: Env, i: { from: string; subject: string; body: string; attachments: string[] }) {
  const id = rid("ins_", 8), t = nowIso(), tok = randToken();
  await env.DB.prepare("INSERT INTO instructions (id,at,from_email,subject,body,attachments,status,confirm_token,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'unconfirmed',?7,?2)")
    .bind(id, t, i.from, i.subject || null, i.body, JSON.stringify(i.attachments), tok).run();
  await logEvent(env, { kind: "note", actor: "zsolt", title: `Utasítás e-mailben: ${i.subject || i.body.slice(0, 60)}`, body: i.body, meta: { instruction_id: id } });
  const url = `${env.SITE_URL}/api/instr/confirm?id=${id}&t=${tok}`;
  await sendMail(env, {
    to: i.from, subject: `Megkaptam: ${i.subject || "utasítás"} [${id}]`, template: "instruction_ack",
    html: layout("hu", "Megkaptam az utasítást", `<p>Ezt kaptam tőled:</p><blockquote style="border-left:3px solid #ff6a1a;margin:0;padding:4px 12px;white-space:pre-wrap">${esc(i.body.slice(0, 3000))}</blockquote>${i.attachments.length ? `<p>Csatolmány: ${esc(i.attachments.join(", "))} (a hello@ postafiókban)</p>` : ""}<p>Ha tényleg te küldted, nyomd meg az <b>Indulhat</b> gombot: a következő feldolgozáskor (naponta kétszer) elvégzem, és e-mailben jelzem, mit csináltam. Ha nyilvános dolgot érint (hirdetés, poszt, ár, ügyfélnek menő levél), előbb javaslatot küldök jóváhagyásra.</p><p style="color:#888">Ha nem te küldted, ne nyomd meg; magától nem indul el.</p>`,
      { label: "Indulhat", url }),
  });
  return id;
}

/** Megerősítő oldal (GET: gomb, POST: végrehajtás) – a levelezők linkellenőrzője így nem tudja elsütni. */
export function confirmPage(title: string, text: string, action: string, label: string) {
  return `<p>${text}</p><form method="post" action="${esc(action)}"><button class="b" type="submit">${esc(label)}</button></form>`;
}

/** Óránként (cron): a feldolgozó által frissített utasításokról e-mail Zsoltnak – javaslat jóváhagyó linkkel, vagy eredmény. */
export async function instrNotify(env: Env) {
  const rows = (await env.DB.prepare("SELECT id,from_email,subject,status,proposal,result,ok_token FROM instructions WHERE notify=1 LIMIT 20").all<{ id: string; from_email: string; subject: string | null; status: string; proposal: string | null; result: string | null; ok_token: string | null }>()).results;
  let n = 0;
  for (const r of rows) {
    const subj = r.subject || "utasítás";
    if (r.status === "needs_ok" && r.ok_token) {
      const base = `${env.SITE_URL}/api/instr/approve?id=${r.id}&t=${r.ok_token}`;
      await sendMail(env, { to: r.from_email, subject: `Jóváhagyásra vár: ${subj} [${r.id}]`, template: "instruction_proposal",
        html: layout("hu", "Ezt csinálnám – jóváhagyod?", `<p style="white-space:pre-wrap">${esc(r.proposal || "")}</p><p><a href="${base}&no=1">Nem, ne csináld</a></p>`, { label: "Jóváhagyom", url: base }) });
    } else if (["done", "failed", "rejected"].includes(r.status)) {
      const t = r.status === "done" ? "Kész" : r.status === "failed" ? "Nem sikerült" : "Lezárva";
      await sendMail(env, { to: r.from_email, subject: `${t}: ${subj} [${r.id}]`, template: "instruction_result",
        html: layout("hu", `${t}: ${subj}`, `<p style="white-space:pre-wrap">${esc(r.result || "")}</p>`, { label: "CRM megnyitása", url: `${env.SITE_URL}/admin/#utasitasok` }) });
    }
    await env.DB.prepare("UPDATE instructions SET notify=0 WHERE id=?1").bind(r.id).run();
    n++;
  }
  return n;
}

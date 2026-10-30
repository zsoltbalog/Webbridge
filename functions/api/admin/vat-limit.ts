// GET /api/admin/vat-limit – az észt ÁFA-értékhatár állása (lásd lib/vatlimit.ts)
import { Env, json } from "../../../lib/core";
import { vatThreshold } from "../../../lib/vatlimit";
export const onRequestGet: PagesFunction<Env> = async ({ env }) => json({ ok: true, ...(await vatThreshold(env)) });

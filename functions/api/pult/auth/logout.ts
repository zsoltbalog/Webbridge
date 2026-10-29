// POST /api/pult/auth/logout
import { Env, json } from "../../../../lib/core";
import { endSession, sessionCookie } from "../../../../lib/portal";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await endSession(env, request);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
};

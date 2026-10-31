// GET /api/pult/config – nyilvános beállítások a belépő oldalhoz.
import { Env, json } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => json({ ok: true, google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), facebook: !!(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET), upload: !!env.UPLOADS });

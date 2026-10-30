// A webbridge.hu a fő cím: a régi webbridge.studio és a www-s címek oldalkéréseit 301-gyel átirányítjuk.
// Az /api/ kéréseket (webhookok, cron, OAuth-visszatérés) NEM irányítjuk át, mert a POST-ot a 301 elrontaná.
const MAIN = "webbridge.hu";
const OLD = new Set(["webbridge.studio", "www.webbridge.studio", "www.webbridge.hu"]);

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (OLD.has(url.hostname) && (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
    url.hostname = MAIN;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
};

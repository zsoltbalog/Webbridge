# Revolut Business kapcsolat (csak olvasás)

A háttérrendszer naponta háromszor lehúzza a TES Revolut Business számláinak egyenlegét és tranzakcióit egy Cloudflare D1 adatbázisba. A tranzakciókat automatikusan kategorizálja (Stripe-kifizetés, Telnyx, Google, Brevo, Cloudflare, domain, könyvelő, egyéb). Az eredmény a belső pénzügyi összesítő végponton érhető el.

**Csak olvasási jog (`scope=READ`).** Ezzel a kapcsolattal nem lehet utalni vagy fizetni.

## Egyszeri beállítás

1. **Tanúsítvány (a saját gépeden):**
   ```bash
   ./gen-cert.sh
   ```
   A kulcsok a `~/webbridge-secrets/revolut/` mappába kerülnek. A `privatecert.pem` és a `private_pkcs8.pem` titkos, nem kerülhet a repóba és a chatbe.

2. **Revolut Business webes felület:** Settings → APIs → Business API → *Add API certificate*
   - X509 public key: a `publiccert.cer` teljes tartalma (a BEGIN és END sorokkal együtt).
   - OAuth redirect URI: `https://webbridge.hu`
   - IP-whitelist: üresen hagyható. A Cloudflare IP-címei változnak.
   - Mentés után másold ki a **ClientID**-t.

3. **Jóváhagyás, csak olvasási joggal.** Nyisd meg ezt a böngészőben a saját ClientID-ddel:
   ```
   https://business.revolut.com/app-confirm?client_id=<ClientID>&redirect_uri=https://webbridge.hu&response_type=code&scope=READ
   ```
   Enable access → Authorise → 2FA. Az átirányított címből másold ki a `code=` utáni értéket. **2 percig érvényes.**

4. **Refresh token, azonnal:**
   ```bash
   ./exchange-code.sh <ClientID> <code>
   ```

5. **Cloudflare:**
   ```bash
   npm i
   npx wrangler d1 create webbridge-finance        # a kapott database_id → wrangler.toml
   npx wrangler d1 execute webbridge-finance --remote --file=schema.sql
   # wrangler.toml: REVOLUT_CLIENT_ID = "<ClientID>"
   npx wrangler secret put REVOLUT_PRIVATE_KEY      # a private_pkcs8.pem tartalma
   npx wrangler secret put REVOLUT_REFRESH_TOKEN
   npx wrangler secret put ADMIN_TOKEN              # pl.: openssl rand -hex 32
   npx wrangler deploy
   ```

## Használat
```bash
curl -X POST https://webbridge-revolut.<fiók>.workers.dev/admin/finance/sync -H "Authorization: Bearer $ADMIN_TOKEN"
curl "https://webbridge-revolut.<fiók>.workers.dev/admin/finance/summary?month=2026-11" -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Működés
- Hitelesítés: RS256-tal aláírt rövid életű JWT (client assertion) + nem lejáró refresh token. Ebből minden futáskor új, 40 percig érvényes access token készül.
- Szinkron: az utolsó futás előtti 3 naptól, így a függő tranzakciók állapota is frissül.
- Tárolás: `rv_accounts`, `rv_transactions` (minden tranzakcióláb külön sor, saját kategóriával), `rv_state`.
- Ha a Revolut visszavonja a hozzáférést, vagy lejár a tanúsítvány (5 év), a szinkron hibát ír a naplóba. Ilyenkor a 3–4. lépést kell megismételni.

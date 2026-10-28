# Webbridge

24 órás weboldal-, logó-, brand- és marketingszolgáltatás kisvállalkozásoknak.
Üzemelteti és tulajdonolja: **Tactical Edge Systems OÜ** (Tallinn, reg. 17541898).

## Tartalom
- `site/index.html` – a nyilvános weboldal (HU/EN, HUF/EUR, tanácsadó, Pult-demó, jogi oldalak). Egyetlen önálló HTML-fájl.
- `docs/webbridge-pult-spec.md` – az ügyfélfelület (Pult) specifikációja.
- `docs/webbridge-domain-tarhely-email.md` – domain-, tárhely- és e-mail-partnerek, döntések.
- `docs/webbridge-telefonos-asszisztens.md` – a telefonos virtuális asszisztens forgatókönyve (Telnyx).

## Tervezett felépítés
- `site/` – marketingoldal (Cloudflare Pages)
- `app/` – Pult (ügyfélfelület): belépés, előnézet, kérések, médiatár
- `api/` – háttér: Stripe-webhookok, Openprovider, Telnyx, Google Workspace
- `docs/` – specifikációk és döntések

## Biztonság
Titkos kulcsot (Stripe, Openprovider, Telnyx, Google) **soha ne tegyünk a repóba**. Ezek a környezeti változókba és a Cloudflare/GitHub titoktárba valók.

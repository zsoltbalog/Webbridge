# Webbridge – domain, tárhely, e-mail partnerek (döntési jegyzet)

2026-10-28 · Üzemeltető: Tactical Edge Systems OÜ

## Alapelvek
- A domaint mindig az ügyfél nevére regisztráljuk. Mi csak kezeljük.
- A meglévő domain alapból marad, ahol van, és csak átirányítjuk (DNS). Csak akkor költöztetünk, ha az ügyfél kéri: „Költöztetés” tétel, 29 900 Ft / €75, véglegesítendő.
- A tárhely a sajátunk (Cloudflare), nem továbbadott szolgáltatás.

## Tárhely
- Az ügyféloldalak a Cloudflare Pages-en futnak.
- Saját domain: Cloudflare for SaaS. 100 egyéni domain ingyenes, utána $0,10 domainenként havonta. Az SSL automatikus.
- Webshop: az ügyfél saját Shopify/Woo fiókjában, mi kezeljük.

## Domain – partnerjelöltek
| Partner | API | .hu | Megjegyzés |
|---|---|---|---|
| Openprovider (NL) | XML/REST API | regisztráció API-n; transzfer kézi (aláírt registry-űrlap, ~21 nap, €90–120) | a regisztráló adószáma és a képviselő igazolványszáma kell; e-mailes jóváhagyás a registry-től; 8+2 nap várakozás + 14 nap közzététel; cégnél védjegy vagy cégkivonat kellhet |
| CentralNic Reseller (ex-Hexonet/RRPproxy) | API | regisztráció API-n; megújítás csak AUTORENEW módban; transzfer nincs API-n | regisztráció akár 16 munkanap |
| INWX (DE) | API | .hu-t kínál | részletek ellenőrizendők |
| Tárhely.Eu viszonteladói program | nincs dokumentált API | .hu 1 400–1 800 Ft/év + ÁFA, anonim viszonteladói felület | 25–100 ezer Ft feltöltés a sávtól függően |
| ZONER RegZone | REST API (hozzáférés e-mailes kérésre) | .hu nincs említve | |
| Cloudflare Registrar | API béta (2026-04): keresés, ellenőrzés, regisztráció; megújítás és transzfer még nincs | .hu támogatása nem igazolt | a viszonteladást a feltételek nem rendezik; a domain a mi fiókunkba kerülne |

**Döntés (2026-10-28, Zsolt jóváhagyta):**
- .com/.eu és hasonló végződések: Openprovider API, teljesen automatikus.
- .hu: Openprovider API, félautomata. Az ügyfél a Pultban kap útmutatót a registry e-mailjének jóváhagyásához.
- Meglévő .hu domain: nem visszük át, csak a DNS-t irányítjuk.

## E-mail – Google Workspace partnerség
- Feltétel: aláírt viszonteladói szerződés, Partner Sales Console, Reseller API.
- Belépési pontok: Google Partner Advantage és partners.cloud.google.com/enrollment.
- Kis partnernek valószínűleg a közvetett út reális (disztribútoron keresztül, pl. Ingram Micro). A magyarországi elérhetőség ellenőrizendő.
- A jelentkezéshez céges domainű e-mail kell: hello@webbridge.hu (még be kell állítani).
- A partnerség elfogadásáig az ügyfél közvetlenül a Google-nek fizet, mi a beállítást és az adminisztrációt számlázzuk.

## Nyitott
- A Költöztetés és az új aloldal végleges ára.
- Openprovider-fiók nyitása (TES nevére). Ezt Zsolt csinálja, Claude nem hozhat létre fiókot.
- Google Partner Advantage jelentkezés (Zsolt). Utána egy disztribútor kiválasztása.

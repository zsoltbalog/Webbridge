# Webbridge – automatikus ügyfél-e-mailek

2026-10-28 · Cél: az összes megerősítő és ügyfél-e-mailt a rendszer küldi, Zsolt nem levelez kézzel.

## Felépítés
- **Kimenő levelek:** tranzakciós levelezőszolgáltatáson keresztül, nem Gmailből. Jelölt: Brevo (francia, EU-s adatkezelés) vagy Amazon SES (eu-central-1). Feladó: `hello@webbridge.hu` (EN: `hello@webbridge.studio`), a technikai küldés a `mail.webbridge.hu` aldomainről megy, így nem ütközik a Google Workspace-szel.
- **DNS:** SPF, DKIM és DMARC a küldő aldomainre. A gyökérdomain MX-e marad a Google-nél.
- **Bejövő válaszok:** a `hello@` címre jönnek (Gmail), és egy továbbítási szabály vagy inbound webhook a rendszerbe is beküldi őket.
  - A rendszer elolvassa a választ: frissíti a briefet, vagy kérést nyit a Pultban.
  - A rutinkérdésekre automatikusan válaszol.
  - Zsoltnak csak a kivételek mennek: panasz, alku, jogi kérdés.
- **Stripe** maga küldi a számlát, a fizetési linket, a nyugtát és a sikertelen fizetés értesítőjét (HU/EN, a TES adataival). Ezeket nem duplikáljuk.
- **Nyelv:** az ügyfél választása (HU/EN). Minden levélben ugyanaz a sablon, márkaszínekkel, egy fő gombbal.

## Levéllista
| # | Esemény | Levél | Gomb |
|---|---|---|---|
| 1 | Kérdőív, hívás vagy e-mail beérkezett | Brief-összefoglaló | Jóváhagyom (innen indul a 24 óra) |
| 2 | Brief jóváhagyva | Vázlatdíj (Stripe-számla) | Fizetés |
| 3 | 3 vázlatirány kész | Vázlatok a Pultban | Megnézem |
| 4 | Irány kiválasztva | 50%-os előleg (Stripe) | Fizetés |
| 5 | Új előnézet (vN) | Mi változott, mit kérünk | Jóváhagyom / Módosítást kérek |
| 6 | 7 nap csend | Emlékeztető | Megnézem |
| 7 | +7 nap csend | Utolsó emlékeztető (ÁSZF 6.4: utána jóváhagyottnak számít) | Megnézem |
| 8 | Új tétel kérése | Ár előre, elfogadás | Elfogadom (+ár) |
| 9 | Élesítés | Átadás, hozzáférések, 14 nap apró módosítás | Pult |
| 10 | Új .hu domain | Útmutató a nyilvántartó e-mailjéhez, majd emlékeztető 3 és 7 nap után | Útmutató |
| 11 | A domain a régi szolgáltatónál marad | DNS-teendők lépésenként | Kész, ellenőrizzétek |
| 12 | Belépés | Pult belépőlink | Belépés |
| 13 | Hívás után | Hívás-összefoglaló (telefonos asszisztens) | Jóváhagyom |
| 14 | Havonta | Marketingriport és javaslatok | Javaslatok |
| 15 | 30 nappal megújulás előtt | Domain- vagy előfizetés-megújulás | Rendben |
| 16 | Élesítés + 7 nap | Elégedettség, Google-vélemény kérése | Értékelem |

## Megvalósítás
- Eseményvezérelt: a Pult, a Stripe-webhookok és a telefonos webhook eseményeiből sablon + adat → küldés.
- A sablonok a repóban vannak (`app/emails/`, HU és EN), verziókövetve.
- Naplózás: elküldve, kézbesítve, megnyitva, kattintva. Visszapattanáskor jelzés a Pultban.
- Leiratkozás csak a marketinglevelekből van (14, 16). A szerződéshez kötött levelek kötelezőek.

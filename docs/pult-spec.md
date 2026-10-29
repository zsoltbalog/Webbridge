# Webbridge Pult – ügyfélfelület specifikáció (v1)

Verzió: 2026-10-29 · Üzemeltető: Tactical Edge Systems OÜ · Státusz: a v1 élesben fut (/pult/), lásd a 7. pontot

## 1. Cél
Az ügyfél egy helyen lássa az oldalát, kérjen módosítást, fizessen és lássa a számláit. Kérjen gyorsan és egyértelműen, mi pedig mérjük, mit kérnek.

## 2. Belépés
- E-mailes belépőlink (jelszó nélkül) – alap, mindig elérhető.
- Google-belépés (OAuth) – élesben.
- Facebook-belépés – 2. kör (a Meta cég- és alkalmazás-ellenőrzést kérhet; indítás előtt ellenőrizni).
- Ugyanez a fiók nyitja a Stripe ügyfélportált (számlák, kártyacsere, előfizetés).

## 3. Funkciók
1. **Élő előnézet** mobil/gép nézettel, verziószámmal (v1, v2…), „Előnézet · nem éles” / „Éles” jelzéssel.
2. **Rajzszöges kérés:** megjegyzés mód → kattintás az oldal egy elemére → rögzített adatok: elem (CSS-szelektor), oldal, nézet, képernyőkép, koordináta.
   - Művelet: változtatás / hozzáadás / törlés.
   - Csatolmány: szöveg, kép, link.
   - Javasolt gyors szövegek elemtípusonként.
3. **Chat-kérés:** szabad szöveg („a főcím legyen …”). A rendszer elemhez rendeli, besorolja (apró / új tétel), és megerősítést kér, ha bizonytalan.
4. **Médiatár:** feltöltött képek, automatikus címkézéssel. Ráhúzható egy elemre.
5. **Előnézet → jóváhagyás:** minden módosítás előbb előnézet, élesítés csak jóváhagyás után. Verziótörténet, összehasonlítás, egy kattintásos visszaállítás.
6. **Besorolás és árazás:**
   - Apró módosítás (szöveg, kép, szín, link, elérhetőség, nyitvatartás, meglévő elem áthelyezése/átméretezése): korlátlan a vázlatirány kidolgozásától az élesítés utáni 14. napig (Növekedés: 30. napig). Utána a Gondtalan üzemeltetés része (havi 30 perc), vagy tételesen.
   - Új tétel (új aloldal, új funkció, új logóirány, a Brief lényeges változása): az árat a Pult előre mutatja. Csak elfogadás után indul. Demó ár: új aloldal 29 900 Ft / €75 – **véglegesítendő**.
   - Méltányos használat: napi max. 20 kérés, a többi másnap kerül sorra.
   - Átfutás: apró módosítás legkésőbb 24 órán belül.
7. **Mérés (szolgáltatásfejlesztés, jogos érdek):** minden kérés strukturált eseményként mentődik, ügyféltartalom nélkül.
   - Típus: szöveg / kép / stílus / új tétel.
   - Elem és oldal, iparág.
   - Képpel érkezett-e.
   - Elsőre jóváhagyva-e, körök száma, átfutási idő.
   - Felhasználás: jobb első verziók és sablonok, pontosabb árazás. Csak összesítve, személyhez nem kötve.

## 4. Jogi szöveg (élő)
- ÁSZF 6. pont átírva: „Módosítások és jóváhagyás” (6.1–6.3a, 6.4 marad a 7+7 napos hallgatólagos jóváhagyás).
- Adatkezelési tájékoztató: Google-belépés adatai, meghívott véleményezők neve és e-mail-címe, megjegyzések, csatolmányok; új sor a szolgáltatásfejlesztési mérésről.

## 5. Technikai megoldás
- Auth: saját megoldás a meglévő rendszerben (Cloudflare Pages Functions + D1): e-mailes link Brevóval és Google OAuth. Külső auth-szolgáltató nincs.
- Előnézetek: ügyfelenként és verziónként statikus build (Cloudflare Pages), a megjegyzésréteg szkriptként betöltve (2. lépés).
- Adatok: D1 (portal_users, sessions, action_tokens, works, versions, comments, events), a fájlok R2-ben (webbridge-uploads).
- Feldolgozás: kérés → besorolás → módosítás a forráson → build → előnézet URL → értesítés → jóváhagyás → élesítés.
- Számlázás: Stripe. Az új tétel egy invoice item, csak az ügyfél elfogadása után kerül rá.

## 6. Nyitott kérdések
- Az új aloldal végleges ára.
- A Facebook-belépés időzítése.
- A 14/30 napos ablak a Start csomagnál is 14 nap legyen-e (most: igen).
- (Kész) R2: webbridge-uploads-eu, EU-joghatóság.

## 7. Megépítve – állapot 2026-10-29 (Pult v1, élesben: /pult/)
- **Belépés (saját megoldás, nem Supabase/Clerk – Zsolt döntése):**
  - E-mailes link a Brevón keresztül: 30 percig érvényes, egyszer használható, a levelezők linkellenőrzője nem tudja elhasználni.
  - Google-belépés: OAuth-kliens a TES „webbridge-tes” Google Cloud projektjében, élesítve („In production”), csak e-mail és név.
  - Munkamenet: HttpOnly süti 30 napig.
- **Szerepek:**
  - Fiók gazdája (owner): megjegyzést ír, jóváhagy, meghív.
  - Meghívott véleményező (reviewer, legfeljebb 10 fő): csak megjegyzést ír.
- **Munkák:** logó, arculat, szórólap, grafika, weboldal, dokumentum, posztok. Mindegyiknek vannak verziói (v1, v2…), egy verzióban több fájl lehet (pl. 3 logóirány címkével).
- **Megjegyzések:**
  - Rábökés képre vagy PDF-oldalra (x, y arányban, PDF-nél oldalszámmal), Változtatás / Hozzáadás / Törlés.
  - Csatolmány (R2) vagy link; válaszok; általános megjegyzés.
  - Állapotok: nyitott → dolgozunk rajta → kész → az ügyfél leokézta.
- **„Visszajelzés elküldése”:** egyben e-mailben megy a nyitott pontokkal.
- **Jóváhagyás:** csak a gazda, Pultból vagy e-mailes egykattintásos linkkel (14 napig él, megerősítő gombbal). Több iránynál a választott irány is rögzül.
- **CRM:** az ügyfélnél „Pult” kártya. Új munka, verziófeltöltés címkékkel, e-mail az ügyfélnek, megjegyzések állapota és válasz, Pult-belépő küldése.
- **Biztonság:**
  - A fájlok ügyfelenkénti kulcs alatt vannak (pult/<ügyfél>/…), és csak belépve érhetők el.
  - Az azonos origin ellenőrzött.
  - Méltányos használat: napi 60 megjegyzés és 60 csatolmány.
- **Kész, de még beállítandó:** válaszlevélből megjegyzés (/api/pult/inbound). Kell hozzá reply aldomain MX, a Brevo inbound beállítása és a REPLY_DOMAIN változó.
- **Következő lépések:**
  - 2. weboldal-megjegyzés az előnézeten;
  - 3. megjegyzés dokumentumon (marketingterv) és posztnaptár;
  - a belépőlinkek átállítása saját domainre (webbridge.hu/.studio).

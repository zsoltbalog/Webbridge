# Webbridge Pult – ügyfélfelület specifikáció (v1)

Verzió: 2026-10-28 · Üzemeltető: Tactical Edge Systems OÜ · Státusz: döntés kész, a weboldalon élő demó van („A Pult” szakasz)

## 1. Cél
Az ügyfél egy helyen lássa az oldalát, kérjen módosítást, fizessen és lássa a számláit. Kérjen gyorsan és egyértelműen, mi pedig mérjük, mit kérnek.

## 2. Belépés
- E-mailes belépőlink (jelszó nélkül) – alap, mindig elérhető.
- Google-belépés (OAuth) – induláskor.
- Facebook-belépés – 2. kör (a Meta cég- és alkalmazás-ellenőrzést kérhet; indítás előtt ellenőrizni).
- Ugyanez a fiók nyitja a Stripe ügyfélportált (számlák, kártyacsere, előfizetés).

## 3. Funkciók
1. **Élő előnézet** mobil/gép nézettel, verziószámmal (v1, v2…), „Előnézet · nem éles” / „Éles” jelzéssel.
2. **Rajzszöges kérés:** megjegyzés mód → kattintás az oldal egy elemére → rögzített adatok: elem (CSS-szelektor), oldal, nézet, képernyőkép, koordináta.
   - Művelet: csere / hozzáadás / törlés.
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
- Adatkezelési tájékoztató: Google-belépés adatai, csatolmányok; új sor a szolgáltatásfejlesztési mérésről.

## 5. Technikai javaslat (megépítéshez)
- Auth: Supabase Auth vagy Clerk (e-mailes link és Google, később Facebook), EU-régióban.
- Előnézetek: ügyfelenként és verziónként statikus build (Cloudflare Pages), a megjegyzésréteg szkriptként betöltve.
- Kérések: adatbázis (requests, attachments, versions, events), a képek objektumtárban (R2/S3, EU).
- Feldolgozás: kérés → besorolás → módosítás a forráson → build → előnézet URL → értesítés → jóváhagyás → élesítés.
- Számlázás: Stripe. Az új tétel egy invoice item, csak az ügyfél elfogadása után kerül rá.

## 6. Nyitott kérdések
- Az új aloldal végleges ára.
- A Facebook-belépés időzítése.
- A 14/30 napos ablak a Start csomagnál is 14 nap legyen-e (most: igen).

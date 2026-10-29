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
- Adatok: D1 (portal_users, sessions, action_tokens, works, versions, comments, post_decisions, events), a fájlok R2-ben (webbridge-uploads).
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
- **2. lépés – weboldal-megjegyzés az előnézeten (kész, helyben tesztelve; élesítéshez a 0004-es migráció kell):**
  - A CRM-ben a „Weboldal” munkánál a verzióhoz előnézeti URL adható meg (csak https://, versions.preview_url). Fájl nem kötelező.
  - A Pultban az előnézet iframe-ben jelenik meg: Mobil (390 px) / Gép (1280 px) nézet, a dobozhoz méretezve; „Melyik oldalon?” mező (alapból „/”), „Új lapon” link.
  - „Megjegyzés mód”: átlátszó réteg az iframe fölött; a kattintás x,y-ja a látható dobozhoz képest mentődik, a nézettel (comments.device) és az útvonallal (comments.path) együtt.
  - **Korlát:** az előnézet más originről jön, így a görgetési helyzetet, a kattintott elemet és az aktuális oldalt nem látjuk. Ha az ügyfél az előnézetben továbblép, neki kell beírnia az útvonalat. Ezért a pontok csak listában látszanak („Mobil · /rolunk”), nem rajzoljuk vissza őket az előnézetre. Görgetéshez a megjegyzés módot ki kell kapcsolni.
  - Saját originről érkező előnézetnél a sandbox nem kap allow-same-origin-t; a saját originre telepített, beépített megjegyzésszkript későbbi lépés.
- **3a. lépés – dokumentum (marketingterv):**
  - A PDF továbbra is rábökéssel véleményezhető. Új: Markdown (.md) dokumentum. A Pult saját, biztonságos megjelenítővel rendereli: címsorok, bekezdések, listák, félkövér/dőlt, kód, idézet, vonal, táblázat és linkek (csak http/https/mailto, rel=noopener). Nyers HTML nincs, minden más szövegként jelenik meg.
  - Szövegkijelölés → „Megjegyzés a kijelöléshez” gomb → a megszokott ablak (Változtatás / Hozzáadás / Törlés, csatolmány). Mentődik az idézet (comments.quote, max. 500 karakter) és a helye (comments.anchor = „blokk:eltolás”).
  - Az idézett részek kiemelve jelennek meg; a kiemelésre kattintva a megjegyzés kijelölődik a listában. **Korlát:** a kiemelés legjobb szándékú – ha új verzióban a szöveg megváltozik, vagy a kijelölés több blokkon át ér, csak az első sor vagy semmi sem emelődik ki (a megjegyzés ettől még megvan). Fejezetenkénti jóváhagyás nincs, csak a teljes verzió jóváhagyása.
- **3b. lépés – posztnaptár:**
  - A „Posztok” munka verziója egy JSON-fájl: [{id, date:"ÉÉÉÉ-HH-NN", channel: facebook|instagram|linkedin|google, text, image (fájlnév) vagy image_key, notes?}]. Mellé ugyanabba a verzióba feltölthetők a képek; a JSON fájlnév szerint hivatkozik rájuk.
  - A Pult hetente csoportosítja a posztokat (dátum, csatorna, kép, szöveg, a mi megjegyzésünk). Posztonként: Mehet / Változtatás (megjegyzésablak, a megjegyzés a poszthoz kötve: comments.post_id) / Kihagyjuk, valamint „Szöveg átírása”. Az átírt szöveg „change” megjegyzésként mentődik, proposal=1 jelöléssel.
  - A döntések a post_decisions táblában vannak; a gazda és a véleményező is dönthet. Összesítő: x mehet, y változtatás, z kihagyva, n még vár.
  - A teljes verzió jóváhagyása továbbra is csak a gazdáé, és csak akkor lehet, ha minden poszthoz van döntés. Ezt a szerver is ellenőrzi, az e-mailes jóváhagyó linknél is.
  - A CRM posztonként mutatja a döntést (ki, mikor) és a poszthoz tartozó megjegyzéseket.
- **CRM-feltöltés:** .md és .json is feltölthető. Ha a böngésző nem ad típust, a kiterjesztésből lesz text/markdown, illetve application/json.
- **Következő lépések:**
  - beépített megjegyzésszkript a saját originre telepített előnézetekhez (elem, görgetés, oldal automatikusan);
  - a belépőlinkek átállítása saját domainre (webbridge.hu/.studio).

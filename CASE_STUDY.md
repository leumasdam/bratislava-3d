# Case study — Bratislava: 15-minútové mesto

> Ako som z otvorených dát postavil nástroj, ktorý meria dostupnosť mesta pešo —
> a prečo som spravil práve tieto rozhodnutia.

---

## Zadanie, ktoré som si dal

Ukázať to, čo mestský dátový tím robí denne: **vziať surové priestorové dáta,
premeniť ich na analýzu, ktorá niečo *tvrdí*, a obaliť ju rozhraním, ktorému
rozumie aj laik.** Nie pekný 3D obrázok — nástroj, ktorý odpovedá na otázku
o kvalite života v meste a vie ju obhájiť dátami.

Otázka: **„15-minútové mesto".** Dobré miesto na život má školu, škôlku, lekára,
lekáreň, obchod, zastávku a park v pešej dostupnosti. Koľko z toho majú
Bratislavčania reálne — a kde mesto funguje a kde rednе?

## Od modelu k nástroju

Prvá verzia bola 3D model zafarbený podľa výšky budov. Vyzeral dobre, ale
nič *netvrdil* — bola to dekorácia dát. To je rozdiel medzi „dizajnérom, čo
renderuje" a „dátovým editorom, čo sa pýta". Tak som 3D mesto nechal ako
**plátno** a položil naň analytickú vrstvu s tézou. Mesto teraz nesvieti podľa
toho, aké je vysoké, ale podľa toho, **aké je tam dobre žiť**.

## Kľúčové rozhodnutia

### 1. Poctivá metóda — a poctivo priznaná

Skutočná pešia dostupnosť potrebuje routovací engine (siete chodníkov, prechody).
Ja som zvolil **vzdušnú čiaru k najbližšej vybavenosti** ako proxy — a v nástroji
aj dokumentácii to **otvorene píšem**. Prečo je to v poriadku: pre porovnanie
*relatívnej* dostupnosti naprieč mestom je proxy dostatočná a rádovo rýchlejšia,
a polomery sú **per kategória** (k zastávke akceptuješ 5 min, k lekárovi 12) —
čo zodpovedá reálnemu správaniu. Kompetencia nie je predstierať presnosť, ktorú
nemáš, ale vedieť, **kde je tvoj odhad dosť dobrý a kde nie**.

### 2. Spojitý index namiesto plochej zelenej

Prvé výsledky ukázali, že **97 % budov v jadre má 6+/7** — Bratislavské centrum
*už je* 15-minútové mesto. Pravda, ale ako mapa nuda: všetko zelené. Riešením
nebolo prikrášliť dáta, ale **merať jemnejšie**: popri binárnom skóre 0–7 počítam
spojitý **index blízkosti 0–100** (miesto 3 min od všetkého ≠ miesto 12 min od
všetkého). Ten dá mestu textúru a ukáže, kde je dostupnosť špičková a kde „len
dobrá". A prepínač **slabé miesta** vytiahne tých pár percent pukliny aj v jadre.

### 3. Dve šošovky, jedno plátno

Jedným klikom prepneš, čím sa mesto farbí — **15-min dostupnosť** alebo **výška
zástavby**. Tá istá scéna, dve otázky. Legenda, panel aj ovládače sa menia podľa
kontextu. Je to lacné na kód a silné na pochopenie — ukazuje, že dáta nie sú
jeden pohľad, ale optika, ktorú si volíš.

### 4. Klik = odpoveď, nie len farba

Farba dá prehľad, ale nástroj musí vedieť odpovedať konkrétne. **Klik kdekoľvek**
spustí živý výpočet vzdialeností a vypíše: *„obchod 1 min ✓, lekár 14 min ✗…
máš 5/7"*. To je moment, keď sa z mapy stane nástroj — odpovie na *tvoju* otázku
o *tvojom* mieste.

### 5. Žiadna podkladová mapa — mesto ako model

Renderujem **iba dáta** (Dunaj, zeleň, ulice, budovy) na tmavom plátne, takže to
vyzerá ako **fyzický architektonický model pod svetlom**, nie ako generická web
mapa. Vedľajší efekt: nulová závislosť na tile-hostingu, nič sa „nerozsype".

### 6. MapLibre namiesto Mapboxu — vedome

**MapLibre GL JS** je open-source fork s **identickým API ako Mapbox GL JS**:
žiadny token, žiadna karta, plne statické nasadenie. Skill je 1:1 prenosný.
Píšem to otvorene — kompetencia je vedieť, *prečo* si nástroj vyberáš.

### 7. Pipeline, ktorá prežije padajúce API

Jeden veľký Overpass dopyt cez celé jadro **vracal 504** (Petržalka je stena
budov). Riešenie je učebnicové: **dlaždicovanie** (mriežka malých dopytov),
**failover cez viac mirrorov** a **de-duplikácia** podľa OSM id. Neviditeľný kus
práce, ktorý rozhoduje, či dáta vôbec dostaneš.

## Čo by bolo ďalej (mám rozmyslené)

- **Skutočné izochróny** cez routovací engine (OSRM/Valhalla) namiesto vzdušnej čiary.
- **Váženie kvality** — nielen „je tam škola", ale kapacita, typ, otváracie hodiny.
- **Napojenie na senzorické dáta** (teplota, hluk) → most medzi IoT a 3D modelom.
- **Index po mestských častiach** ako podklad pre porovnanie a rozhodovanie.

## Čo som sa naučil

Že najťažšia časť dátovej vizualizácie nie je render — ten je za večer. Je to
**rozhodnúť, čo dáta merajú, čomu v nich veriť a ako to poctivo priznať.**
A že keď dáta nehovoria dramaticky (jadro *je* dostupné), úlohou nie je dramatizovať,
ale nájsť tú jemnú, pravdivú vrstvu rozdielov — to je rozdiel medzi grafom
a poznaním.

---

_Samuel Zenko · 2026 · [zdrojový kód](.) · dáta © OpenStreetMap (ODbL)_

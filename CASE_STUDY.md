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

### ★ Z jedného indikátora na atlas šiestich rozmerov

15-min dostupnosť je len jeden pohľad na kvalitu života. Reálny výstup mestského
inštitútu je **multi-indikátorový atlas**: viacero nezávislých analýz spojených do
jedného indexu. Tak vzniklo **šesť rozmerov** — dostupnosť, zelená rovnosť, tepelný
komfort, kvalita MHD, chodeckosť, pokoj — každý počítaný per hex zo samostatného
priestorového proxy, spojený do **Indexu kvality miesta** s **nastaviteľnými váhami**
(používateľ si zvolí, čo je preňho dôležité, a mesto sa prepočíta naživo).

**Ako som to postavil:** päť indikátorov som rozdelil medzi **paralelných agentov** —
každý dostal špecifikáciu (vstupné dáta, výstupný formát zarovnaný na hexy, smer
normalizácie) a sám napísal a spustil svoj Python pipeline. Potom **adversariálny
overovací agent** každý kriticky preveril: má pole správnu dĺžku? je nuisance (teplo,
hluk) správne invertovaný na kvalitu? je proxy obhájiteľný? Výsledky som krížovo
overil **koreláciami** (zeleň↔teplo +0,54 — zeleň chladí; hluk↔MHD −0,36 — pri cestách
viac spojov ale aj hluku). To je metóda, nie náhoda.

A poctivosť: overovatelia našli reálne limity (dvojitá normalizácia, vertex-snapping
pri chodeckosti, žiadne GTFS/satelit) — **nechal som ich napísané v caveats**, lebo
kompetencia je vedieť, kde je tvoj odhad slabý, nie to skryť.

### ★★ Reálne dáta a benchmark — druhý tím agentov

Proxy je dobrý začiatok, ale silu dáva realita. Druhý tím agentov priniesol:
**reálnu populáciu** (WorldPop 100 m raster Slovenska, navzorkovaný cez `rasterio`
na hexy), **reálnu kvalitu MHD** (GTFS feed DPB — 1 348 zastávok, 481 tis. spojov
za pracovný deň, frekvencia na zastávku), a **porovnanie 5 miest** (každé mesto
vlastný agent spustil rovnakú 15-min analýzu cez Overpass).

Benchmark dal Bratislave zrkadlo: **56 % obytných oblastí je 15-minútových — 4. z 5**,
za Viedňou a Prahou (70 %) aj Budapešťou (60 %), no pred Brnom (34 %). To je presne
ten kontext, ktorý z čísla robí príbeh: *nie sme zlí, ale máme kam rásť.*

Poctivosť aj tu: WorldPop ukázal, že náš hex-grid pokrýva len ~147 tis. obyvateľov
(nie celé mesto) — **napísal som to ako limit**, nie zametol pod koberec.

### 0. Z jadra na celé mesto — lebo jadro klamalo

Prvá analýza pokrývala len husté centrum a vyšlo, že **97 % budov je v 15-min
meste**. Pekné číslo — a zavádzajúce, lebo centrum je *vždy* dobre obslúžené.
Skutočná otázka („kde mesto funguje a kde nie?") sa dá položiť len **celomestsky**.

Lenže celá Bratislava = ~150 000 budov, čo prehliadač nedá. Riešenie je štandardný
GIS prístup: namiesto budov **hexagónová mriežka** (~350 hexov nad obytným územím).
Tisíce buniek namiesto stotisícov budov — plynulé, a navyše to čítaš ako priestorovú
analýzu, nie ako zoznam domov. Z diaľky 3D krajina dostupnosti, pri priblížení sa
splošti a vystúpi pôvodný 3D detail jadra. Celomestsky vyšlo úprimnejšie číslo:
**58 % obytných oblastí v 15-min meste, 24 % autozávislých.**

A jedno rozhodnutie o poctivosti: mriežku **maskujem len na obytné územie**
(`landuse=residential`). Bez toho by lesy a polia svietili „červeno = žiadne
služby", čo je nezmysel — tam nikto nebýva. Mapa nemá tvrdiť o miestach, ktoré
nemajú obyvateľa.

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

### 8. Vizuálny jazyk — vedome v rodine MIB

Nástroj nemá pôsobiť ako „ešte jedna dátová appka", ale ako niečo, čo by mohlo vyjsť
**z dielne Metropolitného inštitútu Bratislavy**. Preto je celý vizuál postavený na
ich brand DNA, nie na generickej palete:

- **Typografia: Overused Grotesk** — doslova font, na ktorom jazdí TU-BA (tuba.mib.sk).
  Vedľa Aktiv Grotesku z mib.sk je to tá istá grotesk-rodina, takže nástroj „znie"
  ako MIB už na úrovni písma. Self-hostovaný (žiadny Google Fonts), variabilný.
- **Farba: MIB indigo `#30287B`** ako značkový akcent na **levanduľovo-bielych
  plochách** (`#eeedf4` / `#fcfffd`) — presné tóny z mib.sk. Akcenty (červená `#e4564f`,
  modrá `#4ec5f9`, jantár `#f4b860`, zelená `#29b826`) sú tiež ich.
- **Dátová škála hovorí značkou:** index kvality 0→100 ide **červená (slabé) →
  jantár → modrá → indigo (špička)** — „dobré miesto na život" doslova svieti
  značkovou MIB indigo. Výška budov je indigo monochróm — architektonický model
  pod jedným svetlom.

Je to **MIB-inšpirované, no s vlastnou identitou** — nepredstiera, že je oficiálny
produkt MIB (footer to priznáva: *portfóliový prototyp v duchu MIB*). To je rozdiel
medzi „skopíroval som web" a „rozumiem brandu a viem v ňom pracovať".

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

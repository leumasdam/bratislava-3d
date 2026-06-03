# Case study — Bratislava 3D

> Ako som z otvorených dát o meste postavil interaktívny 3D model v prehliadači —
> a prečo som spravil práve tieto rozhodnutia.

---

## Zadanie, ktoré som si dal

Ukázať, že viem to, čo mestský dátový tím robí každý deň: **vziať surové
priestorové dáta, premeniť ich na presný a vizuálne čitateľný model a obaliť ho
rozhraním, ktorému rozumie aj laik.** Nie pekný obrázok — funkčný nástroj, do
ktorého sa dá kliknúť, ktorý niečo tvrdí o meste a vie to obhájiť dátami.

Téma: **vertikálny profil Bratislavy.** Jedným pohľadom ukázať tri éry mesta —
drobné historické jadro, panelovú Petržalku a nové veže — pretože práve tento
kontrast je jadrom debaty o tom, ako má mesto rásť.

## Kľúčové rozhodnutia

### 1. Žiadna podkladová mapa — mesto ako „model", nie ako web mapa

Najľahšie by bolo hodiť budovy na Google/Mapbox podklad. Zámerne som to neurobil.
Generická mapová dlaždica kričí „web stránka". Namiesto toho renderujem **iba
dáta** — Dunaj, zeleň, ulice, budovy — na tmavom plátne. Výsledok vyzerá ako
**fyzický architektonický model pod bodovým svetlom**, čo je presne reč, ktorou
hovorí mestské plánovanie. Vedľajší efekt: nulová závislosť na tile-hostingu,
takže sa to nikdy „nerozsype" kvôli cudziemu serveru.

### 2. MapLibre namiesto Mapboxu — vedome

Použil som **MapLibre GL JS**, open-source fork s **identickým API ako Mapbox
GL JS**. Dôvod nie je ideologický, ale praktický: žiadny token, žiadna platobná
karta, plne statické nasadenie na GitHub Pages. Skill je 1:1 prenosný na Mapbox —
rovnaké výrazy, rovnaký `fill-extrusion`, rovnaký štýl-spec. Píšem to otvorene,
lebo kompetencia je vedieť, **prečo** si nástroj vyberáš.

### 3. Výška budovy: dáta najprv, potom rozumný odhad

OSM nemá výšku pri každej budove. Postavil som kaskádu:
`height` (v metroch) → `building:levels × 3,2 m` → konzervatívny default 8 m.
Takže model je presný tam, kde dáta sú, a **uveriteľný** tam, kde chýbajú —
namiesto plochých dier. To je rozhodnutie o dôvere v dáta, nie len o kóde.

### 4. Robustná pipeline — lebo verejné API padá

Prvý pokus o jeden veľký Overpass dopyt cez celé jadro **vracal 504** (Petržalka
je doslova stena budov). Riešenie je učebnicové pre priestorový extrakt:

- **dlaždicovanie** — jadro rozsekané na mriežku, každá dlaždica samostatný malý
  dopyt; malé prejdú tam, kde veľký vyprší,
- **failover cez viac mirrorov** — keď jeden server padne, pipeline skúsi ďalší,
- **de-duplikácia** budov podľa OSM id na hraniciach dlaždíc.

Toto je ten neviditeľný kus práce, ktorý rozhoduje, či dáta vôbec dostaneš.

### 5. UX: jeden nástroj, viac úrovní čítania

- **laik** spustí *Sprievodcu* a mesto mu samo odrozpráva príbeh kamerou,
- **zvedavý** klikne na budovu → výška a odhad podlaží,
- **odborník** filtruje podľa výšky a číta zástavbu ako dáta.

Jedno rozhranie, ktoré nevylučuje ani jednu skupinu — to je podstata
prezentácie dát pre verejnosť aj profesionálov.

## Čo by bolo ďalej (mám rozmyslené)

- **Vektorové dlaždice (PMTiles)** namiesto GeoJSON → plynulý 3D pre celé mesto,
  nielen jadro.
- **Napojenie na senzorické dáta** (teplota, hluk, doprava) ako dátová projekcia
  na budovy — presne ten most medzi IoT a 3D modelom.
- **Choropleth po mestských častiach** — hustota, podiel zelene, vek zástavby.

## Čo som sa naučil

Že najťažšia časť dátovej vizualizácie nie je render — ten je hotový za večer.
Je to **získať čisté dáta a rozhodnúť, čomu v nich veriť.** A že obmedzenie
(žiadny kľúč, žiadny backend) vie byť dizajnová výhoda, nie prekážka.

---

_Samuel Zenko · 2026 · [zdrojový kód](.) · dáta © OpenStreetMap (ODbL)_

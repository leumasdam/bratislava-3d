# Bratislava 3D — Atlas mesta z otvorených dát

Interaktívny **3D model jadra Bratislavy**, postavený výhradne z otvorených
geodát (OpenStreetMap) a vyrenderovaný priamo v prehliadači. Žiadna podkladová
mapa, žiadny API kľúč — len dáta o meste premenené na „svietiaci architektonický
model".

**▶ Živá ukážka:** _(doplní sa po nasadení na GitHub Pages)_

![Bratislava 3D](screens/00-cover.png)

---

## Čo to ukazuje

Mesto rozprávané cez **výšku zástavby**: nízke historické jadro, panelová stena
Petržalky za Dunajom a nové výškové dominanty (Eurovea Tower, Sky Park, Nivy) —
tri éry mesta v jednom pohľade.

- **3D budovy** extrudované z reálnych výšok OSM (`height` / `building:levels`),
  zafarbené podľa výšky.
- **Mestská zeleň**, **Dunaj** a **uličná sieť** ako kontext.
- **Filter výšky** — vytiahni len dominanty mesta.
- **Atmosféra** deň / súmrak / noc (svetlo + nálada scény).
- **Sprievodca mestom** — kamera ťa prevedie kľúčovými bodmi.
- **Inšpektor budovy** — klikni na akúkoľvek budovu a zisti výšku a odhad podlaží.
- Hranice mestských častí ako priestorový kontext.

## Stack

| Vrstva | Nástroj | Prečo |
|---|---|---|
| Render | **MapLibre GL JS** | Open-source, **API-kompatibilné s Mapbox GL JS** — skill 1:1 prenosný, ale bez tokenu a bez platobnej karty, nasaditeľné staticky. |
| Dáta | **OpenStreetMap** cez **Overpass API** | Otvorené, aktuálne, s výškami budov. |
| Pipeline | **Python** (`fetch_all.py`) | Multi-endpoint failover + dlaždicovanie ťažkých vrstiev. |
| Hosting | **GitHub Pages** | Statické, zadarmo, bez backendu. |

## Dátová pipeline

```bash
python fetch_all.py      # stiahne a očistí všetky vrstvy do data/*.geojson
```

Verejné Overpass mirrory pod záťažou vracajú 504, preto pipeline:

1. **Rotuje cez viacero mirrorov** (`overpass-api.de`, `private.coffee`, …) — keď
   jeden zlyhá, skúsi ďalší.
2. **Dlaždicuje** husté vrstvy (budovy 3×4, zeleň 2×2) — malé dopyty prejdú tam,
   kde jeden veľký vyprší. Štandardný postup pri reálnom priestorovom extrakte.
3. **Odvodzuje výšku** budov z `height` → `building:levels × 3,2 m` → rozumný default,
   takže každá budova vystúpi do uveriteľnej výšky aj pri riedkych dátach.
4. **Zaokrúhľuje** súradnice na 6 desatín (~0,11 m) — menší payload bez viditeľnej straty.

## Lokálne spustenie

```bash
# stačí statický server (kvôli fetch() na data/*.geojson)
python -m http.server 8000
# → http://localhost:8000
```

## Štruktúra

```
fetch_all.py        dátová pipeline (Overpass → GeoJSON)
index.html          kostra UI
src/app.js          MapLibre scéna, interakcie, sprievodca
src/style.css       dizajn (dark „model" štýl)
data/*.geojson      stiahnuté geodáta
shoot.js            headless capture hero záberov (puppeteer)
```

## Dáta a licencia

Geodáta © prispievatelia **OpenStreetMap**, licencia **ODbL**.
Kód tohto projektu: MIT.

---

_Portfóliový projekt — Samuel Zenko, 2026. Vizualizácia priestorových dát,
mapové rozhrania, UX/UI._

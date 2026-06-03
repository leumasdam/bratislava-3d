# Bratislava 3D — 15-minútové mesto

Interaktívna **3D analýza dostupnosti** jadra Bratislavy, postavená výhradne
z otvorených geodát (OpenStreetMap) a vyrenderovaná priamo v prehliadači.
Žiadna podkladová mapa, žiadny API kľúč — mesto ako „svietiaci model", ktorý
sa pýta: **koľko z toho, čo denne potrebuješ, máš pešo do 15 minút?**

**▶ Živá ukážka: https://leumasdam.github.io/bratislava-3d/**

![Bratislava 3D](screens/00-cover.png)

---

## Téza

*„15-minútové mesto"* je urbanistický koncept: dobré miesto na život má školu,
škôlku, lekára, lekáreň, obchod, zastávku a park v pešej dostupnosti. Tento
nástroj to **počíta z reálnych dát** a zafarbí ním celé mesto — a klikom kdekoľvek
povie konkrétne, čo tam máš a za koľko minút.

Zistenie: **jadro Bratislavy už je hotové 15-minútové mesto** (97 % budov má 6+/7),
ale aj v ňom sú rozdiely a pukliny — a tie nástroj odhalí.

## Čo to vie

- **Dve šošovky** — zafarbi mesto podľa **15-min dostupnosti** (index 0–100,
  červená → zelená) alebo podľa **výšky zástavby**. Jeden klik mení optiku.
- **Klik kamkoľvek → živá analýza**: „škola 4 min ✓, lekár 18 min ✗… máš 5/7".
  Skutočný výpočet vzdialeností k najbližšej vybavenosti v každej kategórii.
- **7 kategórií vybavenosti** ako body na mape (1 373 bodov z OSM).
- **Slabé miesta** — jedným prepínačom stlmíš dobre obslúžené budovy a vytiahneš
  tie pod 6/7; aj v jadre ich pár je.
- **3D budovy** v reálnych výškach (Eurovea Tower 168 m), zeleň, Dunaj, ulice,
  hranice mestských častí.
- **Orientačné body** (Hrad, Most SNP, Slavín…), **atmosféra** deň/súmrak/noc,
  **sprievodca mestom** s kamerou.

## Stack

| Vrstva | Nástroj | Prečo |
|---|---|---|
| Render | **MapLibre GL JS** | Open-source, **API-kompatibilné s Mapbox GL JS** — skill 1:1 prenosný, ale bez tokenu a bez platobnej karty, nasaditeľné staticky. |
| Dáta | **OpenStreetMap** cez **Overpass API** | Otvorené, aktuálne, s výškami budov. |
| Pipeline | **Python** (`fetch_all.py`) | Multi-endpoint failover + dlaždicovanie ťažkých vrstiev. |
| Hosting | **GitHub Pages** | Statické, zadarmo, bez backendu. |

## Dátová pipeline

```bash
python fetch_all.py          # budovy, zeleň, voda, ulice, hranice → data/*.geojson
python fill_gaps.py          # doplní dlaždice, ktoré pod záťažou zlyhali
python fetch_amenities.py    # 7 kategórií vybavenosti → amenities.geojson
python compute_access.py     # 15-min skóre (sc 0–7, idx 0–100) do buildings.geojson
```

Verejné Overpass mirrory pod záťažou vracajú 504, preto sťahovanie:

1. **Rotuje cez viacero mirrorov** (`overpass-api.de`, `private.coffee`, …) — keď
   jeden zlyhá, skúsi ďalší.
2. **Dlaždicuje** husté vrstvy (budovy 4×5) — malé dopyty prejdú tam, kde jeden
   veľký vyprší. Štandardný postup pri reálnom priestorovom extrakte.
3. **Odvodzuje výšku** budov z `height` → `building:levels × 3,2 m` → rozumný default.
4. **Zaokrúhľuje** súradnice na 6 desatín (~0,11 m) — menší payload bez straty.

### Analýza dostupnosti (`compute_access.py`)

Pre každú z 10 046 budov sa spočíta vzdialenosť k najbližšej vybavenosti v každej
kategórii (priestorový hash, vzdušná čiara ako **proxy pešej chôdze** — pozri
[CASE_STUDY](CASE_STUDY.md)). Z toho:

- `sc` 0–7 — koľko potrieb je v dochádzkovom polomere (per kategória 400–1000 m),
- `idx` 0–100 — spojitý index blízkosti (3 min vs 12 min sa líši), ním sa farbí mesto.

## Lokálne spustenie

```bash
# stačí statický server (kvôli fetch() na data/*.geojson)
python -m http.server 8000
# → http://localhost:8000
```

## Štruktúra

```
fetch_all.py         geodáta (Overpass → GeoJSON, failover + dlaždice)
fill_gaps.py         doplnenie dlaždíc, ktoré pod záťažou zlyhali
fetch_amenities.py   7 kategórií dennej vybavenosti
compute_access.py    15-min analýza dostupnosti → skóre do budov
index.html           kostra UI
src/app.js           MapLibre scéna, šošovky, klik-analýza, sprievodca
src/style.css        dizajn (dark „model" štýl)
data/*.geojson       geodáta (10 046 budov, 1 373 bodov vybavenosti, …)
shoot.cjs            headless capture hero záberov (puppeteer)
screens/             vyrenderované náhľady
```

## Dáta a licencia

Geodáta © prispievatelia **OpenStreetMap**, licencia **ODbL**.
Kód tohto projektu: MIT.

---

_Portfóliový projekt — Samuel Zenko, 2026. Vizualizácia priestorových dát,
mapové rozhrania, UX/UI._

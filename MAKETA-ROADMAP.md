# Od digitálneho modelu k fyzickej makete — cesta (roadmap)

> Zhrnutie celej diskusie: ako preklenúť digitálny 3D model Bratislavy na fyzickú
> interaktívnu maketu v štýle **The London Model** / **Model Budapešti** — pre MIB.
> Digitálny základ je hotový a nasadený: https://leumasdam.github.io/bratislava-3d/

---

## 0. Čo už mám (digitálny základ — hotové)
- Celomestský **biely masívny 3D model** (~85 000 budov z OSM, vektorové dlaždice **pmtiles**).
- Materiály podľa typu budovy + fake tiene; **hrdinské landmarky** (hrad, UFO, pyramída) cez three.js.
- **Atlas kvality** (15-min mesto, 6 indikátorov, plánovač) + vrstva **reálnych projektov MIB**.
- **Projekčný režim** (čistý pohľad zhora, bez UI) — tlačidlo v paneli / klávesa **P** / `?projector` v URL.
- Branding v jazyku MIB (Overused Grotesk, indigo #30287B).
- **Dôležité:** tento digitálny model = „mozog" / digitálny dvojička, ktorý feeduje všetky fyzické cesty nižšie.

---

## 1. Tri spôsoby, ako maketu „oživiť" dátami

| Spôsob | Maketa | Ako 3D | Náročnosť | Kalibrácia |
|---|---|---|---|---|
| **A) Projekčný mapping (zhora)** | biela 3D maketa (alebo plochý stôl) | fyzicky | stredné–vysoké | RAZ (fixné) |
| **B) LED zospodu / priesvitný akryl** | priesvitná 3D maketa | fyzicky | stredné | raz (zapojenie) |
| **C) AR cez tablet (Budapešť)** | biela 3D maketa + tablety | na obrazovke | **najvyššie** | STÁLE, 60×/s |
| **C-lite) Web-AR bez makety** | žiadna (virtuálny model na stole) | na obrazovke | nízke–stredné | rieši telefón sám |

Plochá projekcia (na stôl) = 2D, ľahká kalibrácia. „3D" musí prísť buď z **fyzickej makety**, alebo z **AR/obrazovky** — z plochej projekcie 3D nedostaneš (fyzika).

---

## 2. Projekčný mapping — ako to vôbec sedí na 3D model

**Kľúčová idea: projektor = kamera naopak.** Kamera: 3D → 2D. Projektor: 2D → 3D. Rovnaké
rovnice perspektívy. Ak počítač vie (a) **tvar** (tvoj 3D model) a (b) **kde stojí projektor**
(kalibrácia), dopočíta pre každý bod makety, ktorý pixel naň dopadne, a obraz dopredu „pokriví".

**Prečo je to u mňa realizovateľné:** mám **presný digitálny dvojča** fyzickej makety (tie isté
dáta vyrobia maketu aj digitál). Projektovať na známy tvar = vyriešený problém.

**Kalibrácia (krok po kroku):**
1. V softvéri (MadMapper / TouchDesigner / HeavyM) načítam svoj 3D model.
2. Na makete vyberiem ~6–12 známych bodov (špička veže, roh budovy…).
3. Pre každý posuniem krížik v obraze, kým nesadne na ten fyzický bod.
4. Softvér z dvojíc „pixel ↔ 3D bod" dopočíta presnú polohu/otočenie/šošovku projektora.
5. Vyrenderuje scénu „očami projektora" → obraz sa prilepí na maketu presne.
- Maketa aj projektor sa nehýbu → kalibruješ **raz**, beží stále.

### Akákoľvek mierka — áno
Matematika je nezávislá od mierky (30 cm aj 10 m). Mení sa len **fyzika**:
- **Vzdialenosť:** `vzdialenosť = throw ratio × šírka obrazu` (napr. throw 1.2 × 3 m = 3.6 m nad maketou).
- **Ostrosť:** projektor má pevné pixely (1080p = 1920 px). Cieľ napr. ~15 px/cm → jeden projektor pokryje ~128 cm.
- **Jas:** väčšia plocha = tmavšie → jasnejší projektor / tmavšia miestnosť.

### Koľko projektorov a kam (väčšia maketa)
- Počet = **plocha modelu ÷ plocha, ktorú 1 projektor utiahne ostro** (+ tiene).
- Príklad 3×2 m, cieľ 15 px/cm → dlaždica ~1.3 m → mriežka ~3×2 = **~6 projektorov**, každý ~1.55 m nad svojou dlaždicou.
- Umiestnenie: **mriežka nad maketou, čo najstrmšie** (kolmo dole = menej tieňov), susedia **prekryv ~15–20 %** → softvér zošije (edge blending).
- Nástroje: **Projector Central Throw Calculator** (vzdialenosť), zvyšok navrhne **AV integrátor**.

---

## 3. AR (Budapešť) — prečo je najťažšie
Budapešť = **fyzická maketa z LiDAR skenu + tablety s AR** (kamera „vidí" maketu a prekreslí naň obsah).
- **Projekcia** zarovná **raz** (fixné). **AR** musí zarovnávať **stále, 60×/s, na pohyblivom tablete** → to je jadro náročnosti.
- Plus: tracking je krehký (sklo, svetlo, ruky), musí sedieť z každého uhla, treba appku + N tabletov + logistiku.
- **C-lite (web-AR bez makety)** je naopak ľahké: telefón (ARKit/ARCore cez `<model-viewer>` / WebXR) položí **virtuálny** 3D model na hocijaký stôl, tracking si rieši sám. Najlepší pomer cena/wow pre mňa — využije môj existujúci 3D model.

---

## 4. Vytlačiť maketu na 3D tlačiarni
- **Čo:** nie celé mesto (vyšlo by ~1:9000, mikro budovy) — ale **centrum ~4×4 km na 2×2 m = ~1:2000** (ako London; 20 m dom = 1 cm).
- **Reťazec:** `buildings_full.geojson` → **STL** (extrúzia pôdorysov + doska) → **rozrezať na dlaždice** podľa dosky tlačiarne (~20–25 cm) → slice (Cura/PrusaSlicer) → tlač → zlepiť → prebrúsiť → nastriekať na bielo.
- **Námaha 2×2 m:** ~64–100 dlaždíc, stovky hodín tlače, kg filamentu, týždne → lepšie **fab lab / tlačová služba**.
- **POC:** spraviť to isté na **~1×1 m alebo 50 cm** — pár dlaždíc, za víkend.
- **Domáci projektor:** na POC v zatemnenej izbe stačí. 1 m model → projektor ~1.3 m nad ním, ~19 px/cm (ostré). 2 m → ~2.6–3 m nad (vysoký strop), ~10 px/cm (mäkké).

---

## 5. Fázový plán (poradie — nikdy nepreskoč krok)
1. **Digitál užitočný pre MIB** (mám) — reálne dáta, interní používatelia, spätná väzba.
2. **Veľká dotyková obrazovka v TU-BA** — appka ako je, žiadny hardvér navyše.
3. **Plochá projekcia na stôl** — projekčný režim appky + 1 projektor, ovládanie z notebooku/tabletu. (Ľahká kalibrácia = 1 obdĺžnik.)
4. **Malá tlačená maketa (~1 m) + domáci projektor** — overí celý reťazec dáta → projektor → maketa.
5. **Veľká maketa 2×2 m (fab lab) + mriežka projektorov** (alebo LED zospodu / AR) — galerijný exponát pre MIB.

> Pravidlo: plocha pred 3D, malé pred veľkým. Plochá projekcia ovládaná z tabletu = 80 % efektu za 20 % roboty.

---

## 6. Pitch pre MIB (čo povedať, kde začať)
- **Mindset:** nejdeš prosiť s nápadom — ideš s **bežiacim nástrojom z otvorených dát, live**. Iná liga než PDF portfólio.
- **Veď problémom, nie technikou:** plánovacie rozhodnutia sú pre verejnosť/poslancov abstraktné → tvoj model ich **zviditeľní**. Trafí oba mandáty MIB: kvalitné plánovanie + verejný dialóg (TU-BA).
- **Ich slová:** „zdravšie, krajšie, funkčné mesto".
- **De-risk:** prototyp + otvorené dáta + fázový plán = nízke riziko.
- **Nepýtaj rozpočet na prvom stretnutí — pýtaj 20 minút na ukážku.** Otvor link, klikni, ukáž projekty MIB, prepni na biely model. Veta: *„Toto by mohlo žiť v TU-BA. Kde by sa to hodilo?"*
- **Pozn.:** fyzický London model stavia firma (Pipers) — to je modelárske remeslo, NIE práca dátového dizajnéra. Tvoja práca = dáta → mapy/vizualizácie → kartografia. Presne to, čo tento projekt dokazuje.

---

## 7. Nástroje / tech
- **Projekčný mapping:** MadMapper, TouchDesigner, HeavyM, Resolume.
- **Throw kalkulačka:** Projector Central Throw Calculator.
- **Web-AR:** Google `<model-viewer>` (view in AR), WebXR, 8th Wall.
- **Natívne AR:** ARKit (iOS), ARCore (Android), Unity + Vuforia / AR Foundation.
- **LED zospodu:** adresovateľné RGB (WS2812 / DMX pixely), riadenie ESP32 / Raspberry Pi, protokol Art-Net/DMX; most z webu cez WebSocket → Node/Python → serial/Art-Net.
- **Tlač/výroba:** Cura / PrusaSlicer, fab lab / makerspace, CNC pena, laser (vrstvy).
- **geojson → STL:** shapely + trimesh / numpy-stl (skript netreba assety).

---

## 8. Konkrétne ďalšie kroky, ktoré viem dodať (na požiadanie)
- **glTF loader** do landmark vrstvy — aby ručne vymodelované budovy (Blender → glTF) len zapadli na súradnice; + špec na export pre 3D modelára.
- **`geojson → STL dlaždice`** export — zadáš oblasť + mierku + veľkosť dosky → hotové súbory na tlač.
- **Web-AR režim** (`<model-viewer>` „view in AR") — virtuálna 3D Bratislava na stole cez mobil, bez makety.

---

## Referencie (živé príklady)
- **The London Model** (NLA) — 1:2000 biela fyzická maketa + projekcia.
- **Model Budapešti** — biela maketa z LiDARu + AR tablety.
- **MIT CityScope** — stôl + projekcia + LEGO + ovládanie, pre urbanizmus a verejnosť: https://www.media.mit.edu/projects/cityscope/overview/
- **MIT Luminous Table** — 2D plán + 3D model + projekcia naraz.
- **AR Sandbox** — projektor + senzor, vrstevnice naživo: https://projection-mapping.org/augmented-reality-sandtable-military-planning/

---

_Uložené 2026-06-22 · súčasť projektu bratislava-3d (MIB portfólio)._

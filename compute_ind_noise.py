"""
Indikator: Pokoj (inverz dopravneho hluku) -- kluc "noise"
Atlas kvality zivota Bratislavy.

Metoda:
  Pre kazdy hex (v poradi features grid.geojson) spocitame centroid.
  Najdeme vzdusnu vzdialenost (v metroch) k najblizsej:
    - hlavnej ceste (k != rail, r >= 3),
    - zeleznici (k == rail).
  Vezmeme MIN z tychto dvoch (najblizsi zdroj hluku).
  Distance-decay: hlucnost = exp(-d / TAU), kde TAU je dosah hluku.
    d -> 0   => hlucnost -> 1 (najhlucnejsie)
    d veľke  => hlucnost -> 0 (pokoj)
  Pokoj (skore) = 100 * (1 - hlucnost) = 100 * (1 - exp(-d/TAU)).
    Blizko cesty/zeleznice = nizke skore; daleko = vysoke skore (pokoj).

Limity (POCTIVO):
  - Toto je PROXY z blizkosti, NIE meranie hluku. Pouzivame vzdusnu ciaru,
    ziadny realny model sirenia zvuku, ziadne LAeq merania.
  - Neberie do uvahy intenzitu dopravy, rychlost, terenne/budovove tienenie,
    protihlukove steny, vysku zdroja, ani frekvenciu vlakov (ziadne GTFS).
  - Rank r>=3 berieme ako "hlavna cesta"; vsetka zeleznica (k=rail) sa zaratava.
  - Decay konstanta TAU=300 m je expertny odhad dosahu dopravneho hluku.
"""

import json
import math

BASE = "C:/Users/samue/bratislava-3d/data"
GRID = BASE + "/grid.geojson"
ROADS = BASE + "/city_roads.geojson"
OUT = BASE + "/ind_noise.json"

LAT0 = 48.15
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0

TAU = 300.0  # m, dosah dopravneho hluku (distance-decay konstanta)


def to_m(lon, lat):
    return (lon * MX, lat * MY)


def main():
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree
    from shapely.ops import transform as shp_transform

    # --- grid centroidy v poradi features ---
    grid = json.load(open(GRID, encoding="utf-8"))
    feats = grid["features"]
    n = len(feats)

    centroids = []
    for f in feats:
        coords = f["geometry"]["coordinates"][0]  # vonkajsi ring
        # priemer vrcholov (centroid ako priemer vrcholov, podla zadania)
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        # ak je ring uzavrety (prvy==posledny), nezdvoj posledny bod
        if len(coords) > 1 and coords[0] == coords[-1]:
            xs = xs[:-1]
            ys = ys[:-1]
        clon = sum(xs) / len(xs)
        clat = sum(ys) / len(ys)
        cx, cy = to_m(clon, clat)
        centroids.append(Point(cx, cy))

    # --- nacitaj cesty/zeleznice, projektuj do metrov ---
    rd = json.load(open(ROADS, encoding="utf-8"))

    def proj(geom_coords):
        return [to_m(x, y) for x, y in geom_coords]

    road_lines = []  # hlavne cesty r>=3, nie rail
    rail_lines = []  # zeleznica
    for f in rd["features"]:
        if f["geometry"]["type"] != "LineString":
            continue
        p = f["properties"]
        k = p.get("k")
        r = p.get("r", 0) or 0
        ls = LineString(proj(f["geometry"]["coordinates"]))
        if not ls.is_valid or ls.is_empty:
            continue
        if k == "rail":
            rail_lines.append(ls)
        elif r >= 3:
            road_lines.append(ls)

    print("hlavne cesty (r>=3):", len(road_lines))
    print("zeleznica (rail):", len(rail_lines))

    road_tree = STRtree(road_lines) if road_lines else None
    rail_tree = STRtree(rail_lines) if rail_lines else None

    def nearest_dist(pt, lines, tree):
        if tree is None:
            return float("inf")
        idx = tree.nearest(pt)
        # shapely 2.x: nearest vracia index
        if isinstance(idx, (int,)) or hasattr(idx, "__int__"):
            geom = lines[int(idx)]
        else:
            geom = idx
        return pt.distance(geom)

    raw = []  # min vzdialenost k zdroju hluku v metroch
    for pt in centroids:
        dr = nearest_dist(pt, road_lines, road_tree)
        dz = nearest_dist(pt, rail_lines, rail_tree)
        raw.append(min(dr, dz))

    # --- skore: pokoj = 100 * (1 - exp(-d/TAU)) ---
    scores = []
    for d in raw:
        if math.isinf(d):
            scores.append(100.0)
            continue
        noise = math.exp(-d / TAU)        # 1 pri d=0, klesa s vzdialenostou
        score = 100.0 * (1.0 - noise)     # invertovany hluk = pokoj
        score = max(0.0, min(100.0, score))
        scores.append(round(score, 1))

    assert len(scores) == n, f"dlzka {len(scores)} != N {n}"
    for s in scores:
        assert 0.0 <= s <= 100.0, f"mimo rozsahu: {s}"

    json.dump(scores, open(OUT, "w", encoding="utf-8"))

    import statistics
    print("N:", n)
    print("mean:", round(statistics.mean(scores), 2))
    print("min:", min(scores), "max:", max(scores))
    print("zapisane:", OUT)


if __name__ == "__main__":
    main()

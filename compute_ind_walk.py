"""
Indikator: Chodeckost ("walk") pre Atlas kvality zivota Bratislavy.

Metoda:
  Jemnost ulicnej siete = pocet roznych vrcholov/krizovatiek lokalnejsich ciest
  (rank r<=2, k=='road') v ~300 m okolo centroidu hexa. Viac krizovatiek
  = jemnejsia chodecka mriezka = vyssie skore.
  Penalizacia: blizkost dialnice/rychlostnej (r>=4) ako bariera v okoli hexa.
  Normalizacia 0-100, 100 = najlepsie pre chodca.

Data: data/grid.geojson, data/city_roads.geojson
Vystup: data/ind_walk.json = JSON pole N floatov (1 des. miesto) v poradi features.
"""
import json
import math
from collections import defaultdict

BASE = "C:/Users/samue/bratislava-3d"
GRID = BASE + "/data/grid.geojson"
ROADS = BASE + "/data/city_roads.geojson"
OUT = BASE + "/data/ind_walk.json"

# Projekcia lon/lat -> metre (lokalna equirectangular okolo BA)
LAT0 = 48.15
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0

RADIUS = 300.0          # okruh okolo centroidu hexa (m) pre jemnost siete
HW_RADIUS = 150.0       # okruh pre detekciu bariery dialnice/rychlostnej (m)
SNAP = 25.0             # mriezka na snapovanie vrcholov -> identifikacia krizovatiek (m)


def to_m(lon, lat):
    return lon * MX, lat * MY


def centroid_of_polygon(coords):
    """Priemer vrcholov vonkajsieho ringu (podla zadania)."""
    ring = coords[0]
    # vynechaj duplicitny posledny bod ak == prvy
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    return sx / len(pts), sy / len(pts)


def main():
    with open(GRID, encoding="utf-8") as f:
        grid = json.load(f)
    feats = grid["features"]
    N = len(feats)

    # centroidy v metroch, v poradi features
    centroids = []
    for ft in feats:
        g = ft["geometry"]
        if g["type"] == "Polygon":
            clon, clat = centroid_of_polygon(g["coordinates"])
        elif g["type"] == "MultiPolygon":
            # priemer vrcholov vsetkych vonkajsich ringov
            allpts = []
            for poly in g["coordinates"]:
                ring = poly[0]
                pts = ring[:-1] if ring[0] == ring[-1] else ring
                allpts.extend(pts)
            clon = sum(p[0] for p in allpts) / len(allpts)
            clat = sum(p[1] for p in allpts) / len(allpts)
        else:
            raise ValueError("Neocakavany typ geometrie: " + g["type"])
        centroids.append(to_m(clon, clat))

    # nacitaj cesty
    with open(ROADS, encoding="utf-8") as f:
        roads = json.load(f)

    # Lokalne ulice (r<=2, road): zbieraj vrcholy v metroch + rank pre snapovanie krizovatiek.
    # Dialnice/rychlostne (r>=4): segmenty pre vzdialenost (bariera).
    local_verts = []      # (x, y)
    hw_segments = []      # ((x1,y1),(x2,y2))

    for rd in roads["features"]:
        pr = rd["properties"]
        r = pr.get("r", 0)
        k = pr.get("k", "road")
        geom = rd["geometry"]
        if geom["type"] != "LineString":
            continue
        line = geom["coordinates"]
        if k == "road" and r <= 2:
            for lon, lat in line:
                local_verts.append(to_m(lon, lat))
        if k == "road" and r >= 4:
            mpts = [to_m(lon, lat) for lon, lat in line]
            for i in range(len(mpts) - 1):
                hw_segments.append((mpts[i], mpts[i + 1]))

    # --- Spatial bucket index pre lokalne vrcholy ---
    CELL = RADIUS
    vbuckets = defaultdict(list)
    for x, y in local_verts:
        vbuckets[(int(x // CELL), int(y // CELL))].append((x, y))

    # bucket index pre highway segmenty (podla stredu segmentu)
    HCELL = HW_RADIUS
    hbuckets = defaultdict(list)
    for (x1, y1), (x2, y2) in hw_segments:
        mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        hbuckets[(int(mx // HCELL), int(my // HCELL))].append(((x1, y1), (x2, y2)))

    def point_seg_dist(px, py, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0:
            return math.hypot(px - ax, py - ay)
        t = ((px - ax) * dx + (py - ay) * dy) / L2
        t = max(0.0, min(1.0, t))
        cx, cy = ax + t * dx, ay + t * dy
        return math.hypot(px - cx, py - cy)

    raw_inter = []   # pocet unikatnych krizovatiek/uzlov v okruhu
    hw_pen = []      # 0..1 penalta blizkosti dialnice

    R2 = RADIUS * RADIUS
    for cx, cy in centroids:
        # --- jemnost siete: unikatne snapnute vrcholy v okruhu RADIUS ---
        cbx, cby = int(cx // CELL), int(cy // CELL)
        snapped = set()
        for bx in (cbx - 1, cbx, cbx + 1):
            for by in (cby - 1, cby, cby + 1):
                for (x, y) in vbuckets.get((bx, by), ()):
                    dx, dy = x - cx, y - cy
                    if dx * dx + dy * dy <= R2:
                        snapped.add((round(x / SNAP), round(y / SNAP)))
        raw_inter.append(len(snapped))

        # --- bariera dialnice: najblizsia vzdialenost k r>=4 segmentu ---
        hbx, hby = int(cx // HCELL), int(cy // HCELL)
        best = None
        # hladaj v okoli (rozsah pokryje HW_RADIUS)
        for bx in (hbx - 1, hbx, hbx + 1):
            for by in (hby - 1, hby, hby + 1):
                for a, b in hbuckets.get((bx, by), ()):
                    d = point_seg_dist(cx, cy, a, b)
                    if best is None or d < best:
                        best = d
        if best is not None and best <= HW_RADIUS:
            # linearne 1 (na dialnici) -> 0 (na hranici HW_RADIUS)
            hw_pen.append(1.0 - best / HW_RADIUS)
        else:
            hw_pen.append(0.0)

    # --- Normalizacia jemnosti na 0..1 (robustne, percentil 95 ako strop) ---
    sorted_inter = sorted(raw_inter)
    p95 = sorted_inter[min(len(sorted_inter) - 1, int(0.95 * len(sorted_inter)))]
    cap = p95 if p95 > 0 else (max(raw_inter) if max(raw_inter) > 0 else 1)

    scores = []
    for inter, pen in zip(raw_inter, hw_pen):
        fineness = min(1.0, inter / cap)          # 0..1
        # bariera dialnice znizi skore az o 35 %
        score = fineness * (1.0 - 0.35 * pen)
        scores.append(round(max(0.0, min(1.0, score)) * 100.0, 1))

    assert len(scores) == N, f"dlzka {len(scores)} != N {N}"
    for s in scores:
        assert 0.0 <= s <= 100.0, f"hodnota mimo rozsahu: {s}"

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(scores, f, ensure_ascii=False)

    # statistiky
    mean = sum(scores) / N
    print(f"N={N}")
    print(f"mean={mean:.2f} min={min(scores)} max={max(scores)}")
    print(f"raw intersections: min={min(raw_inter)} max={max(raw_inter)} p95={p95} cap={cap}")
    nhw = sum(1 for p in hw_pen if p > 0)
    print(f"hexov s blizkostou dialnice (<{HW_RADIUS}m): {nhw}")
    print(f"local verts: {len(local_verts)}, hw segments: {len(hw_segments)}")


if __name__ == "__main__":
    main()

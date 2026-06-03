"""
Indikator: Zelena rovnost (key "green")
Skore 0-100, kde 100 = NAJLEPSIE (najviac zelene v okoli + najblizsi park).

Metoda:
- Centroid hexa (priemer vrcholov), projekcia lon/lat -> metre.
- Buffer 600 m okolo centroidu.
- Prienik bufferu s uniou zelenych polygonov (land_green) -> podiel pokrytia (0..1).
- Vzdialenost k najblizsiemu parku (amenities cat=park, body) -> blizsi = lepsie.
- Skombinuj: 70% pokrytie zelenou + 30% blizkost parku.
- Normalizacia na 0-100 (min-max cez vsetky hexy pre obe zlozky).

Len stdlib + shapely. STRtree na rychly vyber relevantnych zelenych polygonov.
"""
import json
import math
from shapely.geometry import Polygon, Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep

DATA = "C:/Users/samue/bratislava-3d/data"
GRID = DATA + "/grid.geojson"
GREEN = DATA + "/land_green.geojson"
AMEN = DATA + "/amenities_city.geojson"
OUT = DATA + "/ind_green.json"

LAT0 = 48.15
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0
BUFFER_M = 600.0


def to_m(lon, lat):
    return (lon * MX, lat * MY)


def project_geom(geom):
    """Reproject a shapely Polygon/MultiPolygon from lon/lat to local meters."""
    def proj_ring(coords):
        return [to_m(x, y) for x, y in coords]

    if geom.geom_type == "Polygon":
        ext = proj_ring(geom.exterior.coords)
        ints = [proj_ring(r.coords) for r in geom.interiors]
        return Polygon(ext, ints)
    elif geom.geom_type == "MultiPolygon":
        from shapely.geometry import MultiPolygon
        return MultiPolygon([project_geom(p) for p in geom.geoms])
    else:
        return None


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    grid = load_features(GRID)
    N = len(grid)

    # --- Centroidy hexov v metroch (priemer vrcholov), v poradi features ---
    centroids = []
    for feat in grid:
        ring = feat["geometry"]["coordinates"][0]
        # posledny vrchol = prvy (uzavrety), vynech ho z priemeru
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        centroids.append(to_m(cx, cy))

    # --- Zelene polygony -> metre, STRtree ---
    green_raw = load_features(GREEN)
    green_polys = []
    for feat in green_raw:
        try:
            g = shape(feat["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            pg = project_geom(g)
            if pg is not None and not pg.is_empty and pg.is_valid:
                green_polys.append(pg)
        except Exception:
            continue
    print(f"Zelenych polygonov (validnych): {len(green_polys)}")

    green_tree = STRtree(green_polys)

    # --- Parky (body) -> metre ---
    amen = load_features(AMEN)
    park_pts = []
    for feat in amen:
        if feat["properties"].get("cat") == "park":
            if feat["geometry"]["type"] == "Point":
                lon, lat = feat["geometry"]["coordinates"]
                park_pts.append(to_m(lon, lat))
    print(f"Parkov (bodov): {len(park_pts)}")
    park_geoms = [Point(p) for p in park_pts]
    park_tree = STRtree(park_geoms) if park_geoms else None

    # --- Surove hodnoty na hex ---
    coverage = []   # podiel zelene v bufferi 0..1
    park_dist = []  # vzdialenost k najblizsiemu parku (m)

    for (cx, cy) in centroids:
        buf = Point(cx, cy).buffer(BUFFER_M, quad_segs=16)
        buf_area = buf.area
        pbuf = prep(buf)

        # kandidatske zelene polygony cez STRtree
        idxs = green_tree.query(buf)
        inter_area = 0.0
        for i in idxs:
            gp = green_polys[i]
            if pbuf.intersects(gp):
                try:
                    inter_area += buf.intersection(gp).area
                except Exception:
                    pass
        # cap na 1.0 (prekryvy zelenych polygonov sa mozu scitavat)
        cov = inter_area / buf_area if buf_area > 0 else 0.0
        if cov > 1.0:
            cov = 1.0
        coverage.append(cov)

        # najblizsi park
        if park_tree is not None:
            cpt = Point(cx, cy)
            nearest = park_tree.nearest(cpt)
            d = cpt.distance(park_geoms[nearest])
            park_dist.append(d)
        else:
            park_dist.append(float("inf"))

    # --- Normalizacia ---
    # Pokrytie: priamo (vacsie = lepsie). Skalujeme min-max.
    cmin, cmax = min(coverage), max(coverage)
    crange = (cmax - cmin) or 1.0
    cov_score = [(c - cmin) / crange for c in coverage]

    # Blizkost parku: blizsie = lepsie -> invertujeme vzdialenost.
    # Strop 1500 m: za nim uz "ziadny rozdiel" (najhorsie).
    DCAP = 1500.0
    prox_score = []
    for d in park_dist:
        dd = min(d, DCAP)
        prox_score.append(1.0 - dd / DCAP)  # 0..1, blizko=1

    # Kombinacia: zelen je hlavny rozmer (pokrytie), park dolada.
    W_COV = 0.7
    W_PARK = 0.3
    combined = [W_COV * cov_score[i] + W_PARK * prox_score[i] for i in range(N)]

    # Finalna normalizacia kombinovaneho na 0-100 (min-max -> plne vyuzitie skaly)
    mn, mx = min(combined), max(combined)
    rng = (mx - mn) or 1.0
    scores = [round(((v - mn) / rng) * 100.0, 1) for v in combined]

    # --- Zapis ---
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(scores, f)

    # --- Overenie ---
    assert len(scores) == N, f"dlzka {len(scores)} != N {N}"
    assert all(0.0 <= s <= 100.0 for s in scores), "hodnota mimo [0,100]"
    smean = sum(scores) / N
    print(f"N={N}")
    print(f"mean={smean:.2f} min={min(scores)} max={max(scores)}")
    print(f"coverage raw: min={cmin:.4f} max={cmax:.4f}")
    print(f"park_dist (m): min={min(park_dist):.1f} max={max(d for d in park_dist if d!=float('inf')):.1f}")
    print(f"Zapisane: {OUT}")


if __name__ == "__main__":
    main()

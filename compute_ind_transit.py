"""
Indicator: Kvalita MHD ("transit") pre Atlas kvality zivota Bratislavy.

Metoda (proxy pokrytia, NIE frekvencie):
  - Hustota zastaviek v okoli ~400 m okolo centroidu hexu (Gaussovsky vahovany pocet).
  - Blizkost k vyssiemu radu dopravy (zeleznica/elektricka, city_roads k=rail):
    vzdialenost centroidu k najblizsiemu rail segmentu -> blizsie = lepsie.
  - Kombinacia: 65% hustota zastaviek + 35% blizkost ku kolajovej doprave.
  - Normalizacia kazdej zlozky na 0..100 cez percentil (robustne, 5.-95. perc),
    vysledok 0..100 kde 100 = NAJLEPSIE pokrytie MHD.

Limity (poctivo): vzdusna ciara, ziadne GTFS (frekvencie/linky neznáme),
ziadny satelit. "Zastavka" je len bod bez info o tom kolko liniek tam stoji.
Rail blizkost je proxy pre pristup ku kapacitnej doprave, nie realna dochodzkova
vzdialenost po chodniku.
"""
import json
import math

DATA = "C:/Users/samue/bratislava-3d/data"
LAT0 = 48.15
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0

R = 400.0  # m, charakteristicka vzdialenost pre hustotu zastaviek


def to_m(lon, lat):
    return (lon * MX, lat * MY)


def load(name):
    with open(f"{DATA}/{name}", "r", encoding="utf-8") as f:
        return json.load(f)


def hex_centroid(geom):
    # Polygon: prvy ring, priemer vrcholov (bez duplicitneho posledneho bodu)
    ring = geom["coordinates"][0]
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    n = len(pts)
    return to_m(sx / n, sy / n)


def pt_seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def main():
    grid = load("grid.geojson")
    centroids = [hex_centroid(f["geometry"]) for f in grid["features"]]
    N = len(centroids)

    # --- zastavky (cat=zastavka) ---
    am = load("amenities_city.geojson")
    stops = []
    for f in am["features"]:
        if f["properties"].get("cat") == "zastavka":
            lon, lat = f["geometry"]["coordinates"][:2]
            stops.append(to_m(lon, lat))

    # --- rail segmenty (k=rail) ---
    roads = load("city_roads.geojson")
    rail_segs = []
    for f in roads["features"]:
        if f["properties"].get("k") != "rail":
            continue
        g = f["geometry"]
        coords = g["coordinates"]
        if g["type"] == "LineString":
            lines = [coords]
        elif g["type"] == "MultiLineString":
            lines = coords
        else:
            continue
        for line in lines:
            m = [to_m(c[0], c[1]) for c in line]
            for i in range(len(m) - 1):
                rail_segs.append((m[i][0], m[i][1], m[i + 1][0], m[i + 1][1]))

    # shapely STRtree na zrychlenie blizkosti
    from shapely.geometry import Point, MultiPoint, LineString
    from shapely.strtree import STRtree

    stop_pts = [Point(x, y) for (x, y) in stops]
    stop_tree = STRtree(stop_pts)

    rail_lines = []
    for f in roads["features"]:
        if f["properties"].get("k") != "rail":
            continue
        g = f["geometry"]
        if g["type"] == "LineString":
            seg_lists = [g["coordinates"]]
        elif g["type"] == "MultiLineString":
            seg_lists = g["coordinates"]
        else:
            continue
        for line in seg_lists:
            mm = [to_m(c[0], c[1]) for c in line]
            if len(mm) >= 2:
                rail_lines.append(LineString(mm))
    rail_tree = STRtree(rail_lines) if rail_lines else None

    dens_raw = [0.0] * N
    rail_dist = [float("inf")] * N

    for i, (cx, cy) in enumerate(centroids):
        c = Point(cx, cy)
        # Gaussovsky vahovany pocet zastaviek do ~3R (dosah ~1200 m)
        idxs = stop_tree.query(c.buffer(3 * R))
        s = 0.0
        for j in idxs:
            d = stop_pts[int(j)].distance(c)
            s += math.exp(-(d * d) / (2 * R * R))
        dens_raw[i] = s

        # vzdialenost k najblizsej rail linke
        if rail_tree is not None:
            cand = rail_tree.query_nearest(c)
            best = float("inf")
            for j in cand:
                d = rail_lines[int(j)].distance(c)
                if d < best:
                    best = d
            rail_dist[i] = best

    # rail blizkost -> skore: exp pokles s charakter. dlzkou 800 m (rozumna
    # dochodzkova vzdialenost ku kolajovej doprave)
    RAIL_L = 800.0
    rail_score_raw = [math.exp(-d / RAIL_L) if d != float("inf") else 0.0
                      for d in rail_dist]

    def pct_normalize(vals):
        srt = sorted(vals)
        n = len(srt)

        def perc(p):
            k = p * (n - 1)
            lo = int(math.floor(k))
            hi = int(math.ceil(k))
            if lo == hi:
                return srt[lo]
            return srt[lo] + (srt[hi] - srt[lo]) * (k - lo)
        p5, p95 = perc(0.05), perc(0.95)
        rng = p95 - p5
        out = []
        for v in vals:
            if rng <= 0:
                out.append(50.0)
            else:
                t = (v - p5) / rng
                out.append(max(0.0, min(1.0, t)) * 100.0)
        return out

    dens_n = pct_normalize(dens_raw)
    rail_n = pct_normalize(rail_score_raw)

    W_DENS, W_RAIL = 0.65, 0.35
    final = []
    for i in range(N):
        v = W_DENS * dens_n[i] + W_RAIL * rail_n[i]
        final.append(round(max(0.0, min(100.0, v)), 1))

    with open(f"{DATA}/ind_transit.json", "w", encoding="utf-8") as f:
        json.dump(final, f)

    # validacia
    assert len(final) == N, f"len {len(final)} != N {N}"
    assert all(0.0 <= x <= 100.0 for x in final), "mimo [0,100]"
    mean = sum(final) / N
    print(f"N={N} stops={len(stops)} rail_lines={len(rail_lines)}")
    print(f"mean={mean:.2f} min={min(final)} max={max(final)}")
    print("OK ind_transit.json")


if __name__ == "__main__":
    main()

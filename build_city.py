#!/usr/bin/env python3
"""
Generalizovaný engine: build_city(mesto) → kompletný atlas kvality života.

Jeden parametrizovaný pipeline namiesto kopy skriptov pre každé mesto. Vstup =
konfig mesta (slug, názov, stred). Výstup = data/cities/<slug>.json — hex mriežka
obytného územia so 6 rozmermi kvality (0–100) + kompozitný index, pripravená pre
prepínač miest v appke.

Použitie:  python build_city.py <slug>
Mestá:     bratislava, viheden, praha, brno, budapest   (pozri CITIES nižšie)
"""
import json, sys, os, math, time, urllib.parse, urllib.request
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cities")
UA = "bratislava-3d-atlas/1.0 (open data; portfolio)"
EPS = ["https://overpass.private.coffee/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
       "https://overpass.kumi.systems/api/interpreter"]

CITIES = {
    "bratislava": ("Bratislava", 48.1486, 17.1077),
    "vieden":     ("Viedeň",     48.2082, 16.3738),
    "praha":      ("Praha",      50.0755, 14.4378),
    "brno":       ("Brno",       49.1951, 16.6068),
    "budapest":   ("Budapešť",   47.4979, 19.0402),
}

CATS = ["skola", "skolka", "lekar", "lekaren", "obchod", "zastavka", "park"]
RADIUS = {"zastavka": 400, "park": 500, "obchod": 700, "lekaren": 700,
          "skolka": 800, "skola": 1000, "lekar": 1000}
HEX_R = 250.0
CELL = 500
WALK = 80
T_FULL = 15


def overpass(q, t=60):
    last = None
    for _ in range(2):
        for ep in EPS:
            try:
                d = urllib.parse.urlencode({"data": q}).encode()
                req = urllib.request.Request(ep, data=d, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=t) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last = f"{ep.split('//')[1].split('/')[0]}:{type(ex).__name__}"
                time.sleep(1)
        time.sleep(2)
    print("  overpass FAIL", last, flush=True)
    return {"elements": []}


def classify(t):
    am, shop, lei = t.get("amenity", ""), t.get("shop", ""), t.get("leisure", "")
    hc, rail, pt, hw = t.get("healthcare", ""), t.get("railway", ""), t.get("public_transport", ""), t.get("highway", "")
    if am == "school": return "skola"
    if am == "kindergarten": return "skolka"
    if am == "pharmacy": return "lekaren"
    if am in ("doctors", "clinic", "hospital") or hc in ("doctor", "clinic", "centre", "hospital"): return "lekar"
    if shop in ("supermarket", "convenience", "grocery", "general", "greengrocer"): return "obchod"
    if hw == "bus_stop" or rail in ("tram_stop", "station", "halt") or pt in ("station", "platform"): return "zastavka"
    if lei in ("park", "playground", "garden"): return "park"
    return None


def main(slug):
    name, lat0, lon0 = CITIES[slug]
    S, W, N, E = lat0 - 0.085, lon0 - 0.125, lat0 + 0.085, lon0 + 0.125
    MX = 111320 * math.cos(math.radians(lat0)); MY = 111320
    to_xy = lambda lon, lat: (lon * MX, lat * MY)
    to_ll = lambda x, y: (x / MX, y / MY)
    print(f"== {name} ({slug}) bbox {S:.3f},{W:.3f},{N:.3f},{E:.3f} ==", flush=True)

    def tiles(r, c):
        dlat, dlon = (N - S) / r, (E - W) / c
        for i in range(r):
            for j in range(c):
                yield (S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon)

    # --- vybavenosť (body) ---
    by = {c: [] for c in CATS}
    nam = 0
    for s, w, n, e in tiles(2, 2):
        q = (f'[out:json][timeout:55];('
             f'nwr["amenity"~"^(school|kindergarten|pharmacy|doctors|clinic|hospital)$"]({s},{w},{n},{e});'
             f'nwr["healthcare"~"doctor|clinic|centre"]({s},{w},{n},{e});'
             f'nwr["shop"~"^(supermarket|convenience|grocery|general|greengrocer)$"]({s},{w},{n},{e});'
             f'node["highway"="bus_stop"]({s},{w},{n},{e});'
             f'nwr["railway"~"tram_stop|station|halt"]({s},{w},{n},{e});'
             f'nwr["public_transport"~"station|platform"]({s},{w},{n},{e});'
             f'nwr["leisure"~"^(park|playground|garden)$"]({s},{w},{n},{e}););out center tags;')
        for el in overpass(q).get("elements", []):
            cat = classify(el.get("tags", {}))
            if not cat: continue
            la = el.get("lat") or el.get("center", {}).get("lat")
            lo = el.get("lon") or el.get("center", {}).get("lon")
            if la and lo: by[cat].append(to_xy(lo, la)); nam += 1
        time.sleep(0.3)
    print(f"  vybavenosť: {nam}", flush=True)

    # --- obytné územie (maska) + zeleň + cesty ---
    res_polys, green_polys, road_lines, major_lines = [], [], [], []
    for s, w, n, e in tiles(2, 2):
        q = (f'[out:json][timeout:55];('
             f'way["landuse"~"residential|retail|commercial"]({s},{w},{n},{e});'
             f'way["leisure"~"park|garden"]({s},{w},{n},{e});way["landuse"~"forest|grass|meadow|recreation_ground"]({s},{w},{n},{e});way["natural"~"wood|scrub"]({s},{w},{n},{e});'
             f'way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified"]({s},{w},{n},{e});'
             f'way["railway"="rail"]({s},{w},{n},{e}););out geom;')
        for el in overpass(q).get("elements", []):
            g = el.get("geometry"); t = el.get("tags", {})
            if not g: continue
            if "highway" in t or t.get("railway") == "rail":
                ln = LineString([to_xy(p["lon"], p["lat"]) for p in g]) if len(g) >= 2 else None
                if ln:
                    road_lines.append(ln)
                    if t.get("highway") in ("motorway", "trunk", "primary", "secondary") or t.get("railway") == "rail":
                        major_lines.append(ln)
            else:
                ring = [to_xy(p["lon"], p["lat"]) for p in g]
                if len(ring) >= 4:
                    poly = Polygon(ring)
                    if poly.is_valid and poly.area > 0:
                        if t.get("landuse") in ("residential", "retail", "commercial"):
                            res_polys.append(poly)
                        else:
                            green_polys.append(poly)
        time.sleep(0.3)
    print(f"  res {len(res_polys)} · zeleň {len(green_polys)} · cesty {len(road_lines)} (hl. {len(major_lines)})", flush=True)
    if not res_polys:
        print("  ! žiadne obytné územie — končím", flush=True); return

    res_mask = prep(unary_union(res_polys).buffer(260))
    green_union = unary_union(green_polys) if green_polys else None
    green_tree = STRtree(green_polys) if green_polys else None
    major_tree = STRtree(major_lines) if major_lines else None
    road_tree = STRtree(road_lines) if road_lines else None

    # priestorový hash vybavenosti
    buckets = {c: {} for c in CATS}
    for c in CATS:
        for (x, y) in by[c]:
            buckets[c].setdefault((int(x // CELL), int(y // CELL)), []).append((x, y))

    def nearest(x, y, c):
        gx, gy = int(x // CELL), int(y // CELL); best = 1e9
        for k in range(0, 9):
            for dx in range(-k, k + 1):
                for dy in range(-k, k + 1):
                    if max(abs(dx), abs(dy)) != k: continue
                    for (px, py) in buckets[c].get((gx + dx, gy + dy), ()):
                        d = math.hypot(px - x, py - y)
                        if d < best: best = d
            if best < 1e9 and k >= 1: break
        return best

    def cov(x, y, tree, polys, rad):
        if not tree: return 0.0
        cell = Point(x, y).buffer(rad)
        a = 0.0
        for idx in tree.query(cell):
            try: a += cell.intersection(polys[int(idx)]).area
            except Exception: pass
        return min(1.0, a / (math.pi * rad * rad))

    def near_dist(x, y, tree, lines, cap=1500):
        if not tree: return cap
        pt = Point(x, y); best = cap
        for idx in tree.query(pt.buffer(cap)):
            d = pt.distance(lines[int(idx)])
            if d < best: best = d
        return best

    # --- hex mriežka ---
    xmin, ymin = to_xy(W, S); xmax, ymax = to_xy(E, N)
    dx = 1.5 * HEX_R; dy = math.sqrt(3) * HEX_R
    raw = []  # (x,y, access_idx, sc, green_raw, heat_raw, transit_raw, walk_raw, noise_raw)
    col = 0; x = xmin
    while x <= xmax + dx:
        y = ymin + (dy / 2 if col % 2 else 0)
        while y <= ymax + dy:
            if res_mask.contains(Point(x, y)):
                # access
                sc = 0; contrib = 0.0; tcount = 0
                for c in CATS:
                    d = nearest(x, y, c)
                    if d <= RADIUS[c]: sc += 1
                    contrib += max(0.0, 1 - (d / WALK) / T_FULL)
                    if c == "zastavka":
                        # transit proxy: počet zastávok v 400 m
                        gx, gy = int(x // CELL), int(y // CELL)
                        for dxx in (-1, 0, 1):
                            for dyy in (-1, 0, 1):
                                for (px, py) in buckets["zastavka"].get((gx + dxx, gy + dyy), ()):
                                    if math.hypot(px - x, py - y) <= 400: tcount += 1
                access = 100 * contrib / len(CATS)
                gcov = cov(x, y, green_tree, green_polys, 600)
                heat_raw = gcov  # viac zelene = chladnejšie (proxy)
                walk_raw = len(road_tree.query(Point(x, y).buffer(300))) if road_tree else 0
                noise_d = near_dist(x, y, major_tree, major_lines, 1200)
                raw.append([x, y, access, sc, gcov, heat_raw, tcount, walk_raw, noise_d])
            y += dy
        x += dx; col += 1
    if not raw:
        print("  ! žiadne hexy", flush=True); return
    print(f"  hexov: {len(raw)}", flush=True)

    # normalizácia 0–100 (relatívne v meste)
    def norm(vals, invert=False):
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-9: return [50.0] * len(vals)
        return [round((100 * ((v - lo) / (hi - lo)) if not invert else 100 * (1 - (v - lo) / (hi - lo))), 1) for v in vals]
    green_n = norm([r[4] for r in raw])
    heat_n = norm([r[5] for r in raw])
    transit_n = norm([math.sqrt(r[6]) for r in raw])
    walk_n = norm([r[7] for r in raw])
    noise_n = norm([r[8] for r in raw])  # ďalej od ciest = vyššie = pokoj

    def hexring(cx, cy):
        pts = [[round(v, 6) for v in to_ll(cx + HEX_R * math.cos(math.radians(60 * k)), cy + HEX_R * math.sin(math.radians(60 * k)))] for k in range(6)]
        pts.append(pts[0]); return pts

    feats = []
    good = poor = 0
    for i, r in enumerate(raw):
        qa = round(r[2], 1)
        qs = [qa, green_n[i], heat_n[i], transit_n[i], walk_n[i], noise_n[i]]
        qi = round(sum(qs) / len(qs), 1)
        if r[3] >= 6: good += 1
        if r[3] <= 3: poor += 1
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [hexring(r[0], r[1])]},
            "properties": {"q_access": qa, "q_green": green_n[i], "q_heat": heat_n[i],
                "q_transit": transit_n[i], "q_walk": walk_n[i], "q_noise": noise_n[i],
                "q_index": qi, "sc": r[3]}})

    os.makedirs(OUT, exist_ok=True)
    meta = {"slug": slug, "name": name, "center": [lon0, lat0],
            "nHexes": len(feats), "pctGood": round(100 * good / len(feats), 1),
            "pctPoor": round(100 * poor / len(feats), 1)}
    fc = {"type": "FeatureCollection", "meta": meta, "features": feats}
    path = os.path.join(OUT, slug + ".json")
    json.dump(fc, open(path, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"  -> {path}  ({meta['pctGood']}% 6+/7, {os.path.getsize(path)/1024:.0f} kB)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "brno")

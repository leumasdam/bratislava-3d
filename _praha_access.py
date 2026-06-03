#!/usr/bin/env python3
"""15-min dostupnost Praha — feror. porovnanie, presna metoda."""
import json, math, time, urllib.request, urllib.error, urllib.parse, sys

LAT0, LON0 = 50.0755, 14.4378
DLAT, DLON = 0.085, 0.125
S, N = LAT0 - DLAT, LAT0 + DLAT
W, E = LON0 - DLON, LON0 + DLON

MIRRORS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

CATS = ["skola", "skolka", "lekar", "lekaren", "obchod", "zastavka", "park"]
RADIUS = {"zastavka": 400, "park": 500, "obchod": 700, "lekaren": 700,
          "skolka": 800, "skola": 1000, "lekar": 1000}

MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320

def to_xy(lon, lat):
    return lon * MX, lat * MY

def query(s, w, n, e):
    bb = f"{s},{w},{n},{e}"
    return f"""[out:json][timeout:180];
(
  node["amenity"="school"]({bb});
  way["amenity"="school"]({bb});
  node["amenity"="kindergarten"]({bb});
  way["amenity"="kindergarten"]({bb});
  node["amenity"="pharmacy"]({bb});
  way["amenity"="pharmacy"]({bb});
  node["amenity"~"doctors|clinic|hospital"]({bb});
  way["amenity"~"doctors|clinic|hospital"]({bb});
  node["healthcare"~"doctor|clinic|centre"]({bb});
  way["healthcare"~"doctor|clinic|centre"]({bb});
  node["shop"~"supermarket|convenience|grocery|general"]({bb});
  way["shop"~"supermarket|convenience|grocery|general"]({bb});
  node["highway"="bus_stop"]({bb});
  node["railway"~"tram_stop|station|halt"]({bb});
  node["public_transport"~"station|platform"]({bb});
  way["public_transport"~"station|platform"]({bb});
  node["leisure"~"park|playground|garden"]({bb});
  way["leisure"~"park|playground|garden"]({bb});
  node["landuse"="residential"]({bb});
  way["landuse"="residential"]({bb});
  relation["landuse"="residential"]({bb});
);
out tags center qt;
"""

def fetch(s, w, n, e):
    q = query(s, w, n, e)
    data = ("data=" + urllib.parse.quote(q)).encode()
    for attempt in range(3):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=data, headers={
                    "User-Agent": "praha-15min-access/1.0 (research)",
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                })
                with urllib.request.urlopen(req, timeout=200) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                sys.stderr.write(f"fail {url}: {ex}\n")
                time.sleep(3)
    return None

def classify(tags):
    """vrati kategoriu vybavenosti alebo None / 'resid'."""
    a = tags.get("amenity", "")
    hc = tags.get("healthcare", "")
    shop = tags.get("shop", "")
    hw = tags.get("highway", "")
    rw = tags.get("railway", "")
    pt = tags.get("public_transport", "")
    le = tags.get("leisure", "")
    lu = tags.get("landuse", "")
    if lu == "residential":
        return "resid"
    if a == "school":
        return "skola"
    if a == "kindergarten":
        return "skolka"
    if a == "pharmacy":
        return "lekaren"
    if a in ("doctors", "clinic", "hospital") or hc in ("doctor", "clinic", "centre"):
        return "lekar"
    if shop in ("supermarket", "convenience", "grocery", "general"):
        return "obchod"
    if hw == "bus_stop" or rw in ("tram_stop", "station", "halt") or pt in ("station", "platform"):
        return "zastavka"
    if le in ("park", "playground", "garden"):
        return "park"
    return None

def coords_of(el):
    if el["type"] == "node":
        return el.get("lon"), el.get("lat")
    c = el.get("center")
    if c:
        return c.get("lon"), c.get("lat")
    return None, None

# --- fetch (single, tile 2x2 if needed) ---
def collect():
    elems = {}
    res = fetch(S, W, N, E)
    if res and "elements" in res:
        for el in res["elements"]:
            elems[(el["type"], el["id"])] = el
        return list(elems.values())
    # tile 2x2
    sys.stderr.write("single failed, tiling 2x2\n")
    mlat = (S + N) / 2
    mlon = (W + E) / 2
    tiles = [(S, W, mlat, mlon), (S, mlon, mlat, E), (mlat, W, N, mlon), (mlat, mlon, N, E)]
    for (ts, tw, tn, te) in tiles:
        r = fetch(ts, tw, tn, te)
        if r and "elements" in r:
            for el in r["elements"]:
                elems[(el["type"], el["id"])] = el
    return list(elems.values())

elements = collect()

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

amen = {c: [] for c in CATS}
resid_pts = []
n_amen = 0
for el in elements:
    tags = el.get("tags", {})
    if not tags:
        continue
    cat = classify(tags)
    if cat is None:
        continue
    lon, lat = coords_of(el)
    if lon is None:
        continue
    if cat == "resid":
        resid_pts.append((lon, lat))
    else:
        amen[cat].append(to_xy(lon, lat))
        n_amen += 1

# residential union (buffer 260m in meters). Build small squares around resid points/centers
# We only have centers (out center), so approximate residential coverage as buffered points.
# Per spec: unary_union(residential).buffer(260). With only centers available we buffer centers.
resid_geom = None
if resid_pts:
    pts_xy = [Point(*to_xy(lon, lat)) for (lon, lat) in resid_pts]
    # buffer each center generously to approximate the residential polygon footprint + 260m
    resid_geom = unary_union([p.buffer(260) for p in pts_xy])

# --- hex grid, flat-top, radius ~250m ---
R = 250.0
dx = 1.5 * R          # horizontal spacing between columns (flat-top)
dy = math.sqrt(3) * R # vertical spacing
x0, y0 = to_xy(W, S)
x1, y1 = to_xy(E, N)

hex_centers = []
col = 0
x = x0
while x <= x1 + dx:
    yoff = (dy / 2) if (col % 2) else 0
    y = y0 + yoff
    while y <= y1 + dy:
        hex_centers.append((x, y))
        y += dy
    x += dx
    col += 1

# keep hexes whose centroid in residential area
if resid_geom is not None:
    kept = [(cx, cy) for (cx, cy) in hex_centers if resid_geom.contains(Point(cx, cy))]
else:
    kept = []

# spatial buckets for nearest search
CELL = 500
buckets = {c: {} for c in CATS}
for c in CATS:
    for (px, py) in amen[c]:
        buckets[c].setdefault((int(px // CELL), int(py // CELL)), []).append((px, py))

def nearest(x, y, c):
    gx, gy = int(x // CELL), int(y // CELL)
    best = float("inf")
    for k in range(0, 9):
        for dxx in range(-k, k + 1):
            for dyy in range(-k, k + 1):
                if max(abs(dxx), abs(dyy)) != k:
                    continue
                for (px, py) in buckets[c].get((gx + dxx, gy + dyy), ()):
                    d = math.hypot(px - x, py - y)
                    if d < best:
                        best = d
        if best < float("inf") and k >= 1:
            break
    return best

scores = []
cat_hits = {c: 0 for c in CATS}
for (cx, cy) in kept:
    sc = 0
    for c in CATS:
        d = nearest(cx, cy, c)
        if d <= RADIUS[c]:
            sc += 1
            cat_hits[c] += 1
    scores.append(sc)

nH = len(scores)
if nH:
    pctGood = sum(1 for s in scores if s >= 6) / nH * 100
    pctPoor = sum(1 for s in scores if s <= 3) / nH * 100
    meanScore = sum(scores) / nH
    perCat = {c: round(cat_hits[c] / nH * 100, 1) for c in CATS}
else:
    pctGood = pctPoor = meanScore = 0
    perCat = {c: 0 for c in CATS}

out = {
    "nHexes": nH,
    "pctGood": round(pctGood, 1),
    "pctPoor": round(pctPoor, 1),
    "meanScore": round(meanScore, 2),
    "perCat": perCat,
    "amenities": n_amen,
}
print("RESULT_JSON:" + json.dumps(out, ensure_ascii=False))

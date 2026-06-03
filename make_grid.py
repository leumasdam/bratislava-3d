#!/usr/bin/env python3
"""
Celomestská hexagónová mriežka 15-min dostupnosti.

Vygeneruje flat-top hexy (~200 m) cez celé mesto, ponechá len tie v obytnom území
(maska residential — inak by lesy/polia svietili „červeno = bez služieb", čo je
zavádzajúce), a každému spočíta skóre sc(0–7) + index idx(0–100) z mestskej
vybavenosti. Toto je celomestská analýza, ktorá ukáže kontrast jadro vs okraje.
"""
import json, os, math
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

CITY = (48.085, 17.00, 48.215, 17.20)
S, W, N, E = CITY
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CATS = ["skola", "skolka", "lekar", "lekaren", "obchod", "zastavka", "park"]
RADIUS_M = {"zastavka": 400, "park": 500, "obchod": 700, "lekaren": 700,
            "skolka": 800, "skola": 1000, "lekar": 1000}
WALK_MPM = 80
T_FULL = 15
HEX_R = 270.0          # center→vertex (m)
CELL = 500
LAT0 = 48.15
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320


def to_xy(lon, lat): return lon * MX, lat * MY
def to_ll(x, y): return x / MX, y / MY


# --- vybavenosť do priestorového hashu ---
am = json.load(open(os.path.join(OUT, "amenities_city.geojson"), encoding="utf-8"))
buckets = {c: {} for c in CATS}
for f in am["features"]:
    c = f["properties"]["cat"]
    if c not in buckets:
        continue
    x, y = to_xy(*f["geometry"]["coordinates"])
    buckets[c].setdefault((int(x // CELL), int(y // CELL)), []).append((x, y))


def nearest(x, y, c):
    gx, gy = int(x // CELL), int(y // CELL)
    best = float("inf")
    for k in range(0, 9):
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                if max(abs(dx), abs(dy)) != k:
                    continue
                for (px, py) in buckets[c].get((gx + dx, gy + dy), ()):
                    d = math.hypot(px - x, py - y)
                    if d < best:
                        best = d
        if best < float("inf") and k >= 1:
            break
    return best


# --- maska obytného územia ---
res = json.load(open(os.path.join(OUT, "residential.geojson"), encoding="utf-8"))
polys = []
for f in res["features"]:
    try:
        p = Polygon([(to_xy(lon, lat)) for lon, lat in f["geometry"]["coordinates"][0]])
        if p.is_valid and p.area > 0:
            polys.append(p)
    except Exception:
        pass
mask = unary_union(polys).buffer(260)   # +260 m okolo obytných zón (spojí roztrúsené plochy)
pmask = prep(mask)
print(f"maska: {len(polys)} obytných plôch", flush=True)

# --- hex mriežka (flat-top) ---
xmin, ymin = to_xy(W, S)
xmax, ymax = to_xy(E, N)
dx = 1.5 * HEX_R
dy = math.sqrt(3) * HEX_R
hexes = []
col = 0
x = xmin
while x <= xmax + dx:
    yoff = (dy / 2) if (col % 2) else 0
    y = ymin + yoff
    while y <= ymax + dy:
        if pmask.contains(Point(x, y)):
            hexes.append((x, y))
        y += dy
    x += dx
    col += 1
print(f"hexov v obytnom území: {len(hexes)}", flush=True)


def hex_ring(cx, cy):
    pts = []
    for k in range(6):
        a = math.radians(60 * k)
        vx, vy = cx + HEX_R * math.cos(a), cy + HEX_R * math.sin(a)
        lon, lat = to_ll(vx, vy)
        pts.append([round(lon, 6), round(lat, 6)])
    pts.append(pts[0])
    return pts


feats = []
hist = [0] * 8
for (x, y) in hexes:
    sc = 0
    contrib = 0.0
    for c in CATS:
        d = nearest(x, y, c)
        if d <= RADIUS_M[c]:
            sc += 1
        contrib += max(0.0, 1.0 - (d / WALK_MPM) / T_FULL)
    idx = round(100 * contrib / len(CATS))
    hist[sc] += 1
    feats.append({"type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [hex_ring(x, y)]},
        "properties": {"sc": sc, "idx": idx}})

path = os.path.join(OUT, "grid.geojson")
json.dump({"type": "FeatureCollection", "features": feats},
          open(path, "w", encoding="utf-8"), separators=(",", ":"))
n = len(feats)
print(f"\ngrid.geojson: {n} hexov, {os.path.getsize(path)/1024:.0f} kB")
print("skóre 0–7:", {s: hist[s] for s in range(8)})
good = sum(hist[6:]) / n * 100 if n else 0
poor = sum(hist[:4]) / n * 100 if n else 0
print(f"{good:.0f} % obytných hexov má 6+/7  ·  {poor:.0f} % je ≤3/7 (autozávislé)")

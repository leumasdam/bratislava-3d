#!/usr/bin/env python3
"""
Analýza 15-minútového mesta.

Pre každú budovu zistí vzdialenosť k najbližšej z každej zo 7 denných potrieb
(vzdušná čiara ako proxy pešej chôdze — pozri CASE_STUDY) a odvodí:
  sc  : 0–7, koľko potrieb je v dochádzkovom polomere (binárne, pre klik/štatistiku)
  idx : 0–100, spojitý index blízkosti (3 min vs 12 min sa líši) — ním sa farbí mesto

Spojitý index dáva gradient aj v dobre obslúženom jadre: ukáže, kde je dostupnosť
špičková a kde „len dobrá", namiesto plochej zelenej plochy.
"""
import json, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CATS = ["skola", "skolka", "lekar", "lekaren", "obchod", "zastavka", "park"]
RADIUS_M = {"zastavka": 400, "park": 500, "obchod": 700, "lekaren": 700,
            "skolka": 800, "skola": 1000, "lekar": 1000}
WALK_MPM = 80          # m/min pri ~4,8 km/h
T_FULL = 15            # min — horný strop indexu
CELL = 500            # m, bucket pre hľadanie najbližšieho
LAT0 = 48.138
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320


def to_xy(lon, lat):
    return lon * MX, lat * MY


def centroid(coords):
    pts = coords[0]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


am = json.load(open(os.path.join(OUT, "amenities.geojson"), encoding="utf-8"))
buckets = {c: {} for c in CATS}
for f in am["features"]:
    c = f["properties"]["cat"]
    if c not in buckets:
        continue
    lon, lat = f["geometry"]["coordinates"]
    x, y = to_xy(lon, lat)
    buckets[c].setdefault((int(x // CELL), int(y // CELL)), []).append((x, y))


def nearest(x, y, c):
    """vzdialenosť k najbližšiemu bodu kategórie (m), prehľadávaním rastúcich prstencov."""
    gx, gy = int(x // CELL), int(y // CELL)
    best = float("inf")
    for k in range(0, 8):                       # do ~3,5 km
        found = False
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                if max(abs(dx), abs(dy)) != k:  # len obvod prstenca
                    continue
                for (px, py) in buckets[c].get((gx + dx, gy + dy), ()):
                    found = True
                    d = math.hypot(px - x, py - y)
                    if d < best:
                        best = d
        if best < float("inf") and k >= 1:      # našli sme + jeden prstenec navyše = istota
            break
        if found and best < float("inf"):
            break
    return best


b = json.load(open(os.path.join(OUT, "buildings.geojson"), encoding="utf-8"))
hist_sc = [0] * 8
hist_idx = [0] * 11
for f in b["features"]:
    lon, lat = centroid(f["geometry"]["coordinates"])
    x, y = to_xy(lon, lat)
    sc = 0
    contrib = 0.0
    for c in CATS:
        d = nearest(x, y, c)
        if d <= RADIUS_M[c]:
            sc += 1
        t = d / WALK_MPM
        contrib += max(0.0, 1.0 - t / T_FULL)
    idx = round(100 * contrib / len(CATS))
    f["properties"]["sc"] = sc
    f["properties"]["idx"] = idx
    hist_sc[sc] += 1
    hist_idx[min(10, idx // 10)] += 1

json.dump(b, open(os.path.join(OUT, "buildings.geojson"), "w", encoding="utf-8"),
          separators=(",", ":"))

n = len(b["features"])
print(f"oskórovaných {n} budov\n\nIndex dostupnosti (0–100):")
for s in range(10, -1, -1):
    lo = s * 10
    bar = "█" * round(46 * hist_idx[s] / max(hist_idx))
    print(f"  {lo:3d}+ : {hist_idx[s]:5d}  {bar}")
print("\n7/7 binárne:")
for s in range(8):
    print(f"  {s}/7: {hist_sc[s]:5d}")
good = sum(hist_sc[6:]) / n * 100
print(f"\n{good:.0f} % budov má 6+/7 do 15 min  ·  najlepšie idx {max(i for i in range(11) if hist_idx[i])*10}+")

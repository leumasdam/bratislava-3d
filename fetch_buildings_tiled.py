#!/usr/bin/env python3
"""
Tiled building fetch — the robust way to pull a dense city from Overpass.

A single query over the whole core of Bratislava (Petrzalka is wall-to-wall blocks)
times out. So we split the bbox into a grid, query each cell separately, and merge
de-duplicated by OSM way id. Smaller queries = faster, resilient, and a public-API
citizen. This is exactly how you'd tile any real spatial extract.
"""
import json, urllib.parse, urllib.request, os, time

BBOX = (48.118, 17.085, 48.158, 17.140)   # S, W, N, E
GRID = (3, 4)                              # rows (lat) x cols (lon)
OVERPASS = "https://overpass.kumi.systems/api/interpreter"
UA = "bratislava-3d-portfolio/1.0 (open data viz demo)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
S, W, N, E = BBOX


def overpass(q, timeout=120):
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(OVERPASS, data=data,
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def ring(geometry):
    c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geometry]
    if len(c) < 4:
        return None
    if c[0] != c[-1]:
        c.append(c[0])
    return c


def num(v, mult=1.0):
    try:
        return float(str(v).split()[0].replace(",", ".")) * mult
    except (ValueError, AttributeError):
        return None


def height(t):
    return (num(t.get("height")) or num(t.get("building:levels"), 3.2) or 8.0)


def minh(t):
    return (num(t.get("min_height")) or num(t.get("building:min_level"), 3.2) or 0.0)


rows, cols = GRID
dlat = (N - S) / rows
dlon = (E - W) / cols
seen = {}
cell = 0
for i in range(rows):
    for j in range(cols):
        cell += 1
        s = S + i * dlat
        n = S + (i + 1) * dlat
        w = W + j * dlon
        e = W + (j + 1) * dlon
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        q = f"""[out:json][timeout:110];way["building"]({bb});out geom;"""
        ok = False
        for attempt in (1, 2, 3):
            try:
                d = overpass(q, 130)
                cnt = 0
                for el in d.get("elements", []):
                    if el.get("type") != "way" or "geometry" not in el or el["id"] in seen:
                        continue
                    r = ring(el["geometry"])
                    if not r:
                        continue
                    t = el.get("tags", {})
                    seen[el["id"]] = {
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [r]},
                        "properties": {
                            "h": round(max(2.0, height(t)), 1),
                            "min": round(max(0.0, minh(t)), 1),
                            "name": t.get("name", ""),
                            "kind": t.get("building", "yes"),
                        },
                    }
                    cnt += 1
                print(f"cell {cell}/{rows*cols} [{bb}]: +{cnt} (total {len(seen)})", flush=True)
                ok = True
                break
            except Exception as ex:
                print(f"cell {cell} attempt {attempt} failed: {ex}", flush=True)
                time.sleep(6)
        if not ok:
            print(f"cell {cell} GAVE UP", flush=True)
        time.sleep(1.5)

feats = list(seen.values())
path = os.path.join(OUT, "buildings.geojson")
with open(path, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
print(f"\nbuildings.geojson: {len(feats)} features, {os.path.getsize(path)/1024:.0f} kB", flush=True)

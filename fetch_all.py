#!/usr/bin/env python3
"""
Robust Bratislava extract: multi-endpoint failover + tiling for the heavy layers.

Public Overpass mirrors throttle and 504 under load, so we (1) rotate across several
mirrors and (2) split dense layers (buildings, green) into a grid of small queries.
Small queries succeed where one big query times out — standard practice for a real
spatial extract.
"""
import json, urllib.parse, urllib.request, os, time

BBOX = (48.118, 17.085, 48.158, 17.140)   # S, W, N, E
S, W, N, E = BBOX
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d-portfolio/1.0 (open data viz demo; contact via github)"
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]


def overpass(q, timeout=45, rounds=2):
    """Short per-endpoint timeout + quick rotation. A hung mirror costs <=timeout,
    not minutes, so we converge on whichever server is healthy right now."""
    last = None
    for _ in range(rounds):
        for ep in ENDPOINTS:
            data = urllib.parse.urlencode({"data": q}).encode()
            req = urllib.request.Request(ep, data=data,
                                         headers={"User-Agent": UA, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last = f"{ep.split('//')[1].split('/')[0]}: {ex}"
                time.sleep(1)
    raise RuntimeError(last)


def ring(g):
    c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in g]
    if len(c) < 4:
        return None
    if c[0] != c[-1]:
        c.append(c[0])
    return c


def num(v, m=1.0):
    try:
        return float(str(v).split()[0].replace(",", ".")) * m
    except (ValueError, AttributeError, TypeError):
        return None


def write(name, feats):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
    print(f"  -> {name}: {len(feats)} feats, {os.path.getsize(p)/1024:.0f} kB", flush=True)


def tiles(rows, cols):
    dlat, dlon = (N - S) / rows, (E - W) / cols
    for i in range(rows):
        for j in range(cols):
            yield (S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon)


def fetch_buildings():
    ROWS, COLS = 4, 5
    print(f"buildings (tiled {ROWS}x{COLS})...", flush=True)
    seen, k = {}, 0
    for (s, w, n, e) in tiles(ROWS, COLS):
        k += 1
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        q = f'[out:json][timeout:50];way["building"]({bb});out geom;'
        try:
            d = overpass(q, 45)
        except Exception as ex:
            print(f"  tile {k}/{ROWS*COLS} FAIL {ex}", flush=True); continue
        c = 0
        for el in d.get("elements", []):
            if el.get("type") != "way" or "geometry" not in el or el["id"] in seen:
                continue
            r = ring(el["geometry"])
            if not r:
                continue
            t = el.get("tags", {})
            h = num(t.get("height")) or num(t.get("building:levels"), 3.2) or 8.0
            mh = num(t.get("min_height")) or num(t.get("building:min_level"), 3.2) or 0.0
            seen[el["id"]] = {"type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"h": round(max(2.0, h), 1), "min": round(max(0.0, mh), 1),
                               "name": t.get("name", ""), "kind": t.get("building", "yes")}}
            c += 1
        print(f"  tile {k}/{ROWS*COLS} +{c} (total {len(seen)})", flush=True)
        time.sleep(0.4)
    write("buildings.geojson", list(seen.values()))


def fetch_green():
    print("green (tiled 3x3)...", flush=True)
    seen = {}
    for (s, w, n, e) in tiles(3, 3):
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        q = (f'[out:json][timeout:50];('
             f'way["leisure"~"park|garden|nature_reserve|pitch"]({bb});'
             f'way["landuse"~"grass|forest|recreation_ground|meadow|cemetery|village_green"]({bb});'
             f'way["natural"~"wood|scrub|grassland"]({bb}););out geom;')
        try:
            d = overpass(q, 45)
        except Exception as ex:
            print(f"  green tile FAIL {ex}", flush=True); continue
        for el in d.get("elements", []):
            if "geometry" not in el or el.get("id") in seen:
                continue
            r = ring(el["geometry"])
            if not r:
                continue
            seen[el["id"]] = {"type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"name": el.get("tags", {}).get("name", "")}}
        time.sleep(1)
    write("green.geojson", list(seen.values()))


def fetch_roads():
    print("roads...", flush=True)
    CLS = {"motorway":4,"trunk":4,"motorway_link":3,"trunk_link":3,"primary":3,"primary_link":2,
           "secondary":2,"secondary_link":2,"tertiary":1,"residential":0,"living_street":0,"unclassified":0}
    feats = []
    for (s, w, n, e) in tiles(2, 2):
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        q = (f'[out:json][timeout:90];('
             f'way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified|motorway_link|trunk_link|primary_link"]({bb});'
             f'way["railway"="rail"]({bb}););out geom;')
        try:
            d = overpass(q, 45)
        except Exception as ex:
            print(f"  roads tile FAIL {ex}", flush=True); continue
        for el in d.get("elements", []):
            if "geometry" not in el:
                continue
            line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
            if len(line) < 2:
                continue
            t = el.get("tags", {})
            if t.get("railway") == "rail":
                rank, kind = 1, "rail"
            else:
                rank, kind = CLS.get(t.get("highway", ""), 0), "road"
            feats.append({"type": "Feature",
                "geometry": {"type": "LineString", "coordinates": line},
                "properties": {"r": rank, "k": kind}})
        time.sleep(1)
    write("roads.geojson", feats)


def fetch_districts():
    print("districts...", flush=True)
    q = f'[out:json][timeout:50];relation["boundary"="administrative"]["admin_level"="10"]({S},{W},{N},{E});out geom;'
    try:
        d = overpass(q, 45)
    except Exception as ex:
        print(f"  districts FAIL {ex}", flush=True); write("districts.geojson", []); return
    feats = []
    for el in d.get("elements", []):
        if el.get("type") != "relation":
            continue
        name = el.get("tags", {}).get("name", "")
        for m in el.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in m["geometry"]]
            if len(line) >= 2:
                feats.append({"type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {"name": name}})
    write("districts.geojson", feats)


def fetch_water():
    if os.path.exists(os.path.join(OUT, "water.geojson")):
        print("water already present, skip", flush=True); return
    print("water...", flush=True)
    q = (f'[out:json][timeout:90];('
         f'way["natural"="water"]({S},{W},{N},{E});'
         f'way["waterway"="riverbank"]({S},{W},{N},{E});'
         f'relation["natural"="water"]({S},{W},{N},{E}););out geom;')
    try:
        d = overpass(q, 110)
    except Exception as ex:
        print(f"  water FAIL {ex}", flush=True); return
    feats = []
    for el in d.get("elements", []):
        if "geometry" not in el:
            continue
        r = ring(el["geometry"])
        if r:
            feats.append({"type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"name": el.get("tags", {}).get("name", "")}})
    write("water.geojson", feats)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    fetch_buildings()   # the hero — first
    fetch_roads()
    fetch_green()
    fetch_water()
    fetch_districts()   # best-effort context, last
    print(f"\nDONE in {time.time()-t0:.0f}s", flush=True)

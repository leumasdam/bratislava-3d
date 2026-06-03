#!/usr/bin/env python3
"""Append the two tiles that failed in the main run (3 & 17, 1-based) + retry districts.
Those tiles are empty in the current file, so a plain append needs no de-dup."""
import json, urllib.parse, urllib.request, os, time

BBOX = (48.118, 17.085, 48.158, 17.140)
S, W, N, E = BBOX
ROWS, COLS = 4, 5
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d-portfolio/1.0"
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def overpass(q, timeout=50, rounds=4):
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
                last = f"{ep.split('//')[1].split('/')[0]}: {type(ex).__name__}"
                time.sleep(1)
        time.sleep(3)
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


dlat, dlon = (N - S) / ROWS, (E - W) / COLS
# main-run order: k = i*COLS + j + 1
gap_k = [3, 17]
new = []
for k in gap_k:
    idx = k - 1
    i, j = divmod(idx, COLS)
    s, w, n, e = S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon
    bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
    q = f'[out:json][timeout:50];way["building"]({bb});out geom;'
    try:
        d = overpass(q)
    except Exception as ex:
        print(f"gap tile {k} STILL failing: {ex}", flush=True); continue
    c = 0
    for el in d.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        r = ring(el["geometry"])
        if not r:
            continue
        t = el.get("tags", {})
        h = num(t.get("height")) or num(t.get("building:levels"), 3.2) or 8.0
        mh = num(t.get("min_height")) or num(t.get("building:min_level"), 3.2) or 0.0
        new.append({"type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [r]},
            "properties": {"h": round(max(2.0, h), 1), "min": round(max(0.0, mh), 1),
                           "name": t.get("name", ""), "kind": t.get("building", "yes")}})
        c += 1
    print(f"gap tile {k}: +{c}", flush=True)

if new:
    p = os.path.join(OUT, "buildings.geojson")
    fc = json.load(open(p, encoding="utf-8"))
    fc["features"].extend(new)
    json.dump(fc, open(p, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"buildings.geojson now {len(fc['features'])} feats, {os.path.getsize(p)/1024:.0f} kB", flush=True)

# retry districts (admin_level 9 = mestske casti in BA)
print("districts retry...", flush=True)
for al in ("9", "10"):
    q = f'[out:json][timeout:60];relation["boundary"="administrative"]["admin_level"="{al}"]({S},{W},{N},{E});out geom;'
    try:
        d = overpass(q, 60, rounds=3)
    except Exception as ex:
        print(f"  admin_level {al} failed: {ex}", flush=True); continue
    feats = []
    for el in d.get("elements", []):
        if el.get("type") != "relation":
            continue
        name = el.get("tags", {}).get("name", "")
        for m in el.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            line = [[round(pp["lon"], 6), round(pp["lat"], 6)] for pp in m["geometry"]]
            if len(line) >= 2:
                feats.append({"type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {"name": name}})
    if feats:
        pp = os.path.join(OUT, "districts.geojson")
        json.dump({"type": "FeatureCollection", "features": feats},
                  open(pp, "w", encoding="utf-8"), separators=(",", ":"))
        print(f"  districts.geojson: {len(feats)} lines (admin_level {al})", flush=True)
        break

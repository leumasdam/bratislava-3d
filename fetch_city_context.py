#!/usr/bin/env python3
"""Celomestský skelet: Dunaj + hlavné cesty/železnica cez celé mesto, nech hexy
nesedia na čiernom prázdne. Prepíše water/rivers, pridá city_roads."""
import json, urllib.parse, urllib.request, time, os

CITY = (48.085, 17.00, 48.215, 17.20)
S, W, N, E = CITY
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0"
EPS = ["https://overpass.private.coffee/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def op(q, t=55):
    last = None
    for _ in range(2):
        for ep in EPS:
            try:
                d = urllib.parse.urlencode({"data": q}).encode()
                r = urllib.request.Request(ep, data=d, headers={"User-Agent": UA, "Accept": "application/json"})
                return json.loads(urllib.request.urlopen(r, timeout=t).read().decode())
            except Exception as ex:
                last = type(ex).__name__; time.sleep(1)
        time.sleep(2)
    print("  FAIL", last, flush=True); return {"elements": []}


def tiles(r, c):
    dlat, dlon = (N - S) / r, (E - W) / c
    for i in range(r):
        for j in range(c):
            yield (S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon)


# --- hlavné cesty + železnica (dlaždice 2x2) ---
print("city roads...", flush=True)
RANK = {"motorway": 4, "trunk": 4, "motorway_link": 3, "trunk_link": 3, "primary": 3,
        "primary_link": 2, "secondary": 2, "secondary_link": 1, "tertiary": 1}
roads = []
for s, w, n, e in tiles(2, 2):
    q = (f'[out:json][timeout:55];('
         f'way["highway"~"motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link"]({s},{w},{n},{e});'
         f'way["railway"="rail"]({s},{w},{n},{e}););out geom;')
    d = op(q)
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
            rank, kind = RANK.get(t.get("highway", ""), 0), "road"
        roads.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": line},
                      "properties": {"r": rank, "k": kind}})
    time.sleep(0.4)
json.dump({"type": "FeatureCollection", "features": roads},
          open(os.path.join(OUT, "city_roads.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"city_roads.geojson: {len(roads)} línií", flush=True)

# --- voda: Dunaj + jazerá (plochy) a rieky (línie) cez celé mesto ---
print("city water...", flush=True)
polys, lines = [], []
for s, w, n, e in tiles(2, 2):
    qp = (f'[out:json][timeout:55];('
          f'way["natural"="water"]({s},{w},{n},{e});'
          f'way["waterway"="riverbank"]({s},{w},{n},{e});'
          f'relation["natural"="water"]({s},{w},{n},{e}););out geom;')
    for el in op(qp).get("elements", []):
        if "geometry" not in el:
            continue
        c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
        if len(c) < 4:
            continue
        if c[0] != c[-1]:
            c.append(c[0])
        polys.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [c]},
                      "properties": {"name": el.get("tags", {}).get("name", "")}})
    ql = f'[out:json][timeout:55];way["waterway"~"river|canal"]({s},{w},{n},{e});out geom;'
    for el in op(ql).get("elements", []):
        if "geometry" not in el:
            continue
        line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
        if len(line) >= 2:
            t = el.get("tags", {})
            lines.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": line},
                          "properties": {"name": t.get("name", ""), "kind": t.get("waterway", "")}})
    time.sleep(0.4)
json.dump({"type": "FeatureCollection", "features": polys},
          open(os.path.join(OUT, "water.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
json.dump({"type": "FeatureCollection", "features": lines},
          open(os.path.join(OUT, "rivers.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"water.geojson: {len(polys)} plôch · rivers.geojson: {len(lines)} línií", flush=True)
print("DONE", flush=True)

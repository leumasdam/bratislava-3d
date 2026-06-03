#!/usr/bin/env python3
"""Voda dôkladnejšie: Dunaj + jazerá/rybníky (polygóny) a rieky/kanály (línie).
Aby Dunaj a Chorvátske rameno vystúpili, nie zliate s pozadím."""
import json, urllib.parse, urllib.request, time, os

BBOX = (48.118, 17.085, 48.158, 17.140)
S, W, N, E = BBOX
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0"
EPS = ["https://overpass.private.coffee/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
       "https://overpass.kumi.systems/api/interpreter"]


def overpass(q, t=60):
    for _ in range(3):
        for ep in EPS:
            try:
                data = urllib.parse.urlencode({"data": q}).encode()
                req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=t) as r:
                    return json.loads(r.read().decode())
            except Exception:
                time.sleep(1)
        time.sleep(3)
    return {"elements": []}


def ring(g):
    c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in g]
    if len(c) < 4:
        return None
    if c[0] != c[-1]:
        c.append(c[0])
    return c


# polygóny vody
qp = (f'[out:json][timeout:60];('
      f'way["natural"="water"]({S},{W},{N},{E});'
      f'way["waterway"="riverbank"]({S},{W},{N},{E});'
      f'way["water"]({S},{W},{N},{E});'
      f'relation["natural"="water"]({S},{W},{N},{E}););out geom;')
dp = overpass(qp)
polys = []
for el in dp.get("elements", []):
    if "geometry" not in el:
        continue
    r = ring(el["geometry"])
    if r:
        polys.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [r]},
                      "properties": {"name": el.get("tags", {}).get("name", "")}})
json.dump({"type": "FeatureCollection", "features": polys},
          open(os.path.join(OUT, "water.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"water.geojson: {len(polys)} polygónov")

# línie riek/kanálov
ql = (f'[out:json][timeout:60];('
      f'way["waterway"~"river|canal|stream"]({S},{W},{N},{E}););out geom;')
dl = overpass(ql)
lines = []
for el in dl.get("elements", []):
    if "geometry" not in el:
        continue
    line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
    if len(line) >= 2:
        t = el.get("tags", {})
        lines.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": line},
                      "properties": {"name": t.get("name", ""), "kind": t.get("waterway", "")}})
json.dump({"type": "FeatureCollection", "features": lines},
          open(os.path.join(OUT, "rivers.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"rivers.geojson: {len(lines)} línií")

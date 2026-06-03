#!/usr/bin/env python3
"""Roads + rail as lines — gives the dark 'model' its street structure."""
import json, urllib.parse, urllib.request, os

BBOX = (48.118, 17.085, 48.158, 17.140)
OVERPASS = "https://overpass.kumi.systems/api/interpreter"
UA = "bratislava-3d-portfolio/1.0 (open data viz demo)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
S, W, N, E = BBOX
BB = f"{S},{W},{N},{E}"


def overpass(q, timeout=160):
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(OVERPASS, data=data,
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# Rank by class so the app can weight line width / opacity.
CLASS = {
    "motorway": 4, "motorway_link": 3, "trunk": 4, "trunk_link": 3,
    "primary": 3, "primary_link": 2, "secondary": 2, "secondary_link": 2,
    "tertiary": 1, "residential": 0, "living_street": 0, "unclassified": 0,
}

q = f"""[out:json][timeout:150];
  (
    way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street|unclassified|motorway_link|trunk_link|primary_link"]({BB});
    way["railway"="rail"]({BB});
  );
  out geom;"""

d = overpass(q)
feats = []
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
        hw = t.get("highway", "")
        rank, kind = CLASS.get(hw, 0), "road"
    feats.append({
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": line},
        "properties": {"r": rank, "k": kind, "bridge": 1 if t.get("bridge") else 0},
    })

path = os.path.join(OUT, "roads.geojson")
with open(path, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
print(f"roads.geojson: {len(feats)} features, {os.path.getsize(path)/1024:.0f} kB")

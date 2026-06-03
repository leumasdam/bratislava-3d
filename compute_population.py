#!/usr/bin/env python3
"""
Odhad obyvateľov na hex — aby dopad zásahov bol v ĽUĎOCH, nie v hexoch.

Proxy: podiel obytného územia (landuse=residential) v hexe → váha → škálované tak,
aby súčet zodpovedal reálnej populácii Bratislavy (~475 000). Nie je to sčítanie
obyvateľov, ale obhájiteľná priestorová distribúcia (kde je viac bývania, viac ľudí).
"""
import json, os, math
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
BA_POP = 475000
LAT0 = 48.15
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320


def to_xy(lon, lat):
    return lon * MX, lat * MY


res = json.load(open(os.path.join(OUT, "residential.geojson"), encoding="utf-8"))
polys = []
for f in res["features"]:
    try:
        p = Polygon([to_xy(lon, lat) for lon, lat in f["geometry"]["coordinates"][0]])
        if p.is_valid and p.area > 0:
            polys.append(p)
    except Exception:
        pass
res_union = unary_union(polys)

grid = json.load(open(os.path.join(OUT, "grid.geojson"), encoding="utf-8"))
weights = []
for f in grid["features"]:
    hexp = Polygon([to_xy(lon, lat) for lon, lat in f["geometry"]["coordinates"][0]])
    inter = hexp.intersection(res_union).area    # m² obytnej plochy v hexe
    weights.append(inter)

tot = sum(weights) or 1
for f, w in zip(grid["features"], weights):
    f["properties"]["pop"] = round(BA_POP * w / tot)

json.dump(grid, open(os.path.join(OUT, "grid.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
pops = [f["properties"]["pop"] for f in grid["features"]]
print(f"populácia rozdelená na {len(pops)} hexov, súčet {sum(pops):,}")
print(f"  medián {sorted(pops)[len(pops)//2]}, max {max(pops)}, hexov s 0 obyv.: {sum(1 for p in pops if p==0)}")

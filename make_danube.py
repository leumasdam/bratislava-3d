#!/usr/bin/env python3
"""
Dunaj ako plocha, nie čiara.

V OSM je veľká rieka multipolygónová relácia, ktorú jednoduchý fetch preskočí —
ostane len tenká os (`waterway=river`). Tu z tej osi spravíme realistickú vodnú
plochu: os rieky rozšírime bufferom na skutočnú šírku (~300 m Dunaj, ~25 m kanál).
Výsledok pridáme do water.geojson (idempotentne — staré buffery najprv odstránime).
"""
import json, os, math
from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge, transform

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
LAT0 = 48.138
MX = 111320 * math.cos(math.radians(LAT0))
MY = 111320

WIDTHS = {"Dunaj": 150, "river": 60, "canal": 13, "stream": 6}  # polomer buffera (m)


def to_m(x, y, z=None):
    return (x * MX, y * MY)


def to_deg(x, y, z=None):
    return (x / MX, y / MY)


rivers = json.load(open(os.path.join(OUT, "rivers.geojson"), encoding="utf-8"))

# zoskup línie podľa „šírkovej triedy"
groups = {}
for f in rivers["features"]:
    name = f["properties"].get("name", "")
    kind = f["properties"].get("kind", "")
    key = "Dunaj" if name == "Dunaj" else kind
    w = WIDTHS.get(key, WIDTHS.get(kind, 8))
    groups.setdefault(w, []).append(LineString(f["geometry"]["coordinates"]))

buffers = []
for w, lines in groups.items():
    merged = linemerge(MultiLineString(lines)) if len(lines) > 1 else lines[0]
    merged_m = transform(to_m, merged)
    poly_m = merged_m.buffer(w, cap_style=2, join_style=1).simplify(4)
    poly = transform(to_deg, poly_m)
    geoms = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
    for g in geoms:
        coords = [[round(x, 6), round(y, 6)] for x, y in g.exterior.coords]
        buffers.append({"type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {"name": "", "src": "buffer"}})

# vlož do water.geojson (vyhoď staré buffery)
water = json.load(open(os.path.join(OUT, "water.geojson"), encoding="utf-8"))
water["features"] = [f for f in water["features"] if f["properties"].get("src") != "buffer"]
water["features"].extend(buffers)
json.dump(water, open(os.path.join(OUT, "water.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"pridaných {len(buffers)} vodných plôch z osí riek; water.geojson teraz {len(water['features'])} prvkov")

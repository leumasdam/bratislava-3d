#!/usr/bin/env python3
"""
Bratislava 3D — data pipeline.

Pulls real open geospatial data from OpenStreetMap (via the Overpass API) for the
core of Bratislava and turns it into lean GeoJSON the web app can render directly:

  - buildings.geojson  : footprints + a derived height in metres (for 3D extrusion)
  - green.geojson      : parks, gardens, forests, grass (the "climate" layer)
  - water.geojson      : the Danube + water bodies (context)
  - districts.geojson  : mestske casti boundary lines (spatial context)

Design choices:
  - Height is derived from `height` -> `building:levels` -> sensible default, so every
    building extrudes to *something* believable even when OSM is sparse.
  - Geometry is rounded to 6 decimals (~0.11 m) to shrink the payload without visible loss.
  - One Overpass query per layer, each with its own timeout, so a single slow layer
    can't sink the whole run.
"""

import json, sys, time, urllib.parse, urllib.request, os

# Core Bratislava: Stare Mesto + castle + waterfront + northern Petrzalka.
# This frame holds the strongest urban story: low historic centre, the Petrzalka
# panel wall across the river, and the new towers (Sky Park, Eurovea Tower).
BBOX = (48.118, 17.085, 48.158, 17.140)  # south, west, north, east

OVERPASS = "https://overpass.kumi.systems/api/interpreter"
UA = "bratislava-3d-portfolio/1.0 (open data viz demo)"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

S, W, N, E = BBOX
BB = f"{S},{W},{N},{E}"


def overpass(query: str, timeout: int = 180):
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def ring(geometry):
    """Overpass 'geometry' array -> a closed [lon,lat] ring (6-dp rounded)."""
    coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geometry]
    if len(coords) < 4:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def derive_height(tags: dict) -> float:
    """Best-effort building height in metres."""
    h = tags.get("height")
    if h:
        try:
            return max(2.0, float(str(h).split()[0].replace(",", ".")))
        except ValueError:
            pass
    lvl = tags.get("building:levels")
    if lvl:
        try:
            return max(2.0, float(str(lvl).split()[0].replace(",", ".")) * 3.2)
        except ValueError:
            pass
    # Footprint-free default: most BA stock without tags is low-rise.
    return 8.0


def min_height(tags: dict) -> float:
    mh = tags.get("min_height")
    if mh:
        try:
            return max(0.0, float(str(mh).split()[0].replace(",", ".")))
        except ValueError:
            pass
    lvl = tags.get("building:min_level")
    if lvl:
        try:
            return max(0.0, float(str(lvl).split()[0]) * 3.2)
        except ValueError:
            pass
    return 0.0


def write(name, features):
    path = os.path.join(OUT, name)
    fc = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))
    kb = os.path.getsize(path) / 1024
    print(f"  -> {name}: {len(features)} features, {kb:.0f} kB")


def fetch_buildings():
    print("buildings...")
    q = f"""[out:json][timeout:170];
      way["building"]({BB});
      out geom;"""
    d = overpass(q, 180)
    feats = []
    for el in d.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        r = ring(el["geometry"])
        if not r:
            continue
        t = el.get("tags", {})
        h = derive_height(t)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [r]},
            "properties": {
                "h": round(h, 1),
                "min": round(min_height(t), 1),
                "name": t.get("name", ""),
                "kind": t.get("building", "yes"),
            },
        })
    write("buildings.geojson", feats)
    return len(feats)


def fetch_green():
    print("green...")
    q = f"""[out:json][timeout:120];
      (
        way["leisure"~"park|garden|nature_reserve"]({BB});
        way["landuse"~"grass|forest|recreation_ground|meadow|village_green|cemetery"]({BB});
        way["natural"~"wood|scrub|grassland"]({BB});
      );
      out geom;"""
    d = overpass(q, 140)
    feats = []
    for el in d.get("elements", []):
        if "geometry" not in el:
            continue
        r = ring(el["geometry"])
        if not r:
            continue
        t = el.get("tags", {})
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [r]},
            "properties": {"name": t.get("name", "")},
        })
    write("green.geojson", feats)
    return len(feats)


def fetch_water():
    print("water...")
    q = f"""[out:json][timeout:120];
      (
        way["natural"="water"]({BB});
        way["waterway"="riverbank"]({BB});
        relation["natural"="water"]({BB});
      );
      out geom;"""
    d = overpass(q, 140)
    feats = []
    for el in d.get("elements", []):
        if "geometry" not in el:
            continue
        r = ring(el["geometry"])
        if not r:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [r]},
            "properties": {"name": el.get("tags", {}).get("name", "")},
        })
    write("water.geojson", feats)
    return len(feats)


def fetch_districts():
    """Mestske casti boundary *lines* (cheap, no polygon assembly)."""
    print("districts...")
    q = f"""[out:json][timeout:120];
      relation["boundary"="administrative"]["admin_level"~"9|10"]({BB});
      out geom;"""
    d = overpass(q, 140)
    feats = []
    for el in d.get("elements", []):
        if el.get("type") != "relation":
            continue
        name = el.get("tags", {}).get("name", "")
        for m in el.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            line = [[round(p["lon"], 6), round(p["lat"], 6)] for p in m["geometry"]]
            if len(line) < 2:
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": line},
                "properties": {"name": name},
            })
    write("districts.geojson", feats)
    return len(feats)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(f"BBOX {BB}\nOverpass {OVERPASS}\n")
    t0 = time.time()
    totals = {}
    for fn in (fetch_buildings, fetch_green, fetch_water, fetch_districts):
        for attempt in (1, 2):
            try:
                totals[fn.__name__] = fn()
                break
            except Exception as e:  # noqa
                print(f"  ! {fn.__name__} attempt {attempt} failed: {e}")
                time.sleep(5)
        else:
            totals[fn.__name__] = 0
    print(f"\nDone in {time.time()-t0:.0f}s: {totals}")

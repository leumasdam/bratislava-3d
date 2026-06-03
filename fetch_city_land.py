#!/usr/bin/env python3
"""Terén cez celé mesto, nech okraje nie sú čierne prázdno:
- land_green.geojson : lesy, parky, zeleň, lúky (tmavozelené plochy)
- land_use.geojson    : využitie územia (priemysel/komerčné) ako jemný podklad
Bratislavu obklopujú Karpaty a lužné lesy — to zaplní 'čierno okolo' terénom."""
import json, urllib.parse, urllib.request, time, os

CITY = (48.085, 17.00, 48.215, 17.20)
S, W, N, E = CITY
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0"
EPS = ["https://overpass.private.coffee/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def op(q, t=60):
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


def ring(g):
    c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in g]
    if len(c) < 4:
        return None
    if c[0] != c[-1]:
        c.append(c[0])
    return c


def fetch(name, selector, rows=2, cols=2):
    print(name, "...", flush=True)
    seen, feats = set(), []
    for s, w, n, e in tiles(rows, cols):
        q = f'[out:json][timeout:55];({selector.format(bb=f"{s},{w},{n},{e}")});out geom;'
        for el in op(q).get("elements", []):
            if "geometry" not in el or el.get("id") in seen:
                continue
            r = ring(el["geometry"])
            if not r:
                continue
            seen.add(el.get("id"))
            feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [r]},
                          "properties": {}})
        time.sleep(0.4)
    p = os.path.join(OUT, name)
    json.dump({"type": "FeatureCollection", "features": feats}, open(p, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"  -> {name}: {len(feats)} plôch, {os.path.getsize(p)/1024:.0f} kB", flush=True)


# zeleň/lesy (veľký vizuálny prínos)
fetch("land_green.geojson",
      'way["natural"~"wood|scrub|grassland"]({bb});'
      'way["landuse"~"forest|grass|meadow|recreation_ground|village_green|cemetery|orchard|vineyard"]({bb});'
      'way["leisure"~"park|garden|nature_reserve|golf_course"]({bb});'
      'relation["natural"="wood"]({bb});relation["landuse"="forest"]({bb});')

# využitie územia (jemný podklad pre zastavané plochy)
fetch("land_use.geojson",
      'way["landuse"~"industrial|commercial|retail|railway|construction"]({bb});')

print("DONE", flush=True)

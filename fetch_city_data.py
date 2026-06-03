#!/usr/bin/env python3
"""
Dáta pre celomestskú analýzu 15-min dostupnosti.

- amenities_city.geojson : 7 kategórií dennej vybavenosti cez celé mesto (dlaždicované)
- residential.geojson    : obytné územie (landuse=residential) — maska, aby mriežka
                           svietila len tam, kde ľudia bývajú (nie na poliach/lesoch)
"""
import json, urllib.parse, urllib.request, time, os

CITY = (48.085, 17.00, 48.215, 17.20)   # S,W,N,E — hlavné zastavané mesto
S, W, N, E = CITY
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0"
EPS = ["https://overpass.private.coffee/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
       "https://overpass.kumi.systems/api/interpreter"]


def overpass(q, t=50):
    last = None
    for _ in range(2):
        for ep in EPS:
            try:
                data = urllib.parse.urlencode({"data": q}).encode()
                req = urllib.request.Request(ep, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=t) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last = f"{ep.split('//')[1].split('/')[0]}:{type(ex).__name__}"
                time.sleep(1)
        time.sleep(2)
    print("   FAIL", last, flush=True)
    return {"elements": []}


def tiles(rows, cols):
    dlat, dlon = (N - S) / rows, (E - W) / cols
    for i in range(rows):
        for j in range(cols):
            yield (S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon)


def classify(t):
    am = t.get("amenity", ""); shop = t.get("shop", ""); lei = t.get("leisure", "")
    hc = t.get("healthcare", ""); rail = t.get("railway", ""); pt = t.get("public_transport", "")
    hw = t.get("highway", "")
    if am == "school": return "skola"
    if am == "kindergarten": return "skolka"
    if am == "pharmacy": return "lekaren"
    if am in ("doctors", "clinic", "hospital") or hc in ("doctor", "clinic", "centre", "hospital"): return "lekar"
    if shop in ("supermarket", "convenience", "grocery", "general", "greengrocer"): return "obchod"
    if hw == "bus_stop" or rail in ("tram_stop", "station", "halt") or pt in ("station", "platform"): return "zastavka"
    if lei in ("park", "playground", "garden"): return "park"
    return None


# --- amenities (dlaždicované 3x3) ---
print("amenities...", flush=True)
seen, feats = set(), []
counts = {}
for k, (s, w, n, e) in enumerate(tiles(3, 3), 1):
    q = (f'[out:json][timeout:50];('
         f'nwr["amenity"~"^(school|kindergarten|pharmacy|doctors|clinic|hospital)$"]({s},{w},{n},{e});'
         f'nwr["healthcare"~"doctor|clinic|centre"]({s},{w},{n},{e});'
         f'nwr["shop"~"^(supermarket|convenience|grocery|general|greengrocer)$"]({s},{w},{n},{e});'
         f'node["highway"="bus_stop"]({s},{w},{n},{e});'
         f'nwr["railway"~"tram_stop|station|halt"]({s},{w},{n},{e});'
         f'nwr["public_transport"~"station|platform"]({s},{w},{n},{e});'
         f'nwr["leisure"~"^(park|playground|garden)$"]({s},{w},{n},{e}););out center tags;')
    d = overpass(q)
    c = 0
    for el in d.get("elements", []):
        t = el.get("tags", {})
        cat = classify(t)
        if not cat:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if not lat or not lon:
            continue
        key = (cat, round(lon, 5), round(lat, 5))
        if key in seen:
            continue
        seen.add(key)
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                      "properties": {"cat": cat}})
        counts[cat] = counts.get(cat, 0) + 1
        c += 1
    print(f"  tile {k}/9 +{c} (total {len(feats)})", flush=True)
    time.sleep(0.5)
json.dump({"type": "FeatureCollection", "features": feats},
          open(os.path.join(OUT, "amenities_city.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"amenities_city.geojson: {len(feats)} bodov {counts}", flush=True)

# --- obytné územie (maska) ---
print("residential...", flush=True)
res = []
for k, (s, w, n, e) in enumerate(tiles(2, 2), 1):
    q = (f'[out:json][timeout:50];('
         f'way["landuse"~"residential|retail|commercial"]({s},{w},{n},{e});'
         f'relation["landuse"~"residential|retail|commercial"]({s},{w},{n},{e}););out geom;')
    d = overpass(q)
    for el in d.get("elements", []):
        if "geometry" not in el:
            continue
        c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
        if len(c) < 4:
            continue
        if c[0] != c[-1]:
            c.append(c[0])
        res.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [c]},
                    "properties": {}})
    time.sleep(0.5)
json.dump({"type": "FeatureCollection", "features": res},
          open(os.path.join(OUT, "residential.geojson"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"residential.geojson: {len(res)} plôch", flush=True)
print("DONE", flush=True)

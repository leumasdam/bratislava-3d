#!/usr/bin/env python3
"""
Občianska vybavenosť pre analýzu 15-minútového mesta.

Sedem kategórií denných potrieb z OSM ako body (vrátane centroidov plôch).
Každý bod dostane jednu kategóriu (cat) — tá riadi dochádzkový polomer v analýze.
"""
import json, urllib.parse, urllib.request, time, os

BBOX = (48.118, 17.085, 48.158, 17.140)
S, W, N, E = BBOX
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0"
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def overpass(q, timeout=60):
    last = None
    for _ in range(3):
        for ep in ENDPOINTS:
            try:
                data = urllib.parse.urlencode({"data": q}).encode()
                req = urllib.request.Request(ep, data=data,
                    headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last = f"{ep.split('//')[1].split('/')[0]}: {type(ex).__name__}"
                time.sleep(1)
        time.sleep(3)
    raise RuntimeError(last)


def classify(t):
    am = t.get("amenity", ""); shop = t.get("shop", ""); lei = t.get("leisure", "")
    hc = t.get("healthcare", ""); rail = t.get("railway", ""); pt = t.get("public_transport", "")
    hw = t.get("highway", "")
    if am == "school":            return "skola"
    if am == "kindergarten":      return "skolka"
    if am in ("pharmacy",):       return "lekaren"
    if am in ("doctors", "clinic", "hospital") or hc in ("doctor", "clinic", "centre", "hospital"):
        return "lekar"
    if shop in ("supermarket", "convenience", "grocery", "general", "greengrocer"):
        return "obchod"
    if hw == "bus_stop" or rail in ("tram_stop", "station", "halt") or pt in ("station", "platform"):
        return "zastavka"
    if lei in ("park", "playground", "garden"):
        return "park"
    return None


Q = f"""[out:json][timeout:60];
(
  nwr["amenity"~"^(school|kindergarten|pharmacy|doctors|clinic|hospital)$"]({S},{W},{N},{E});
  nwr["healthcare"~"doctor|clinic|centre"]({S},{W},{N},{E});
  nwr["shop"~"^(supermarket|convenience|grocery|general|greengrocer)$"]({S},{W},{N},{E});
  node["highway"="bus_stop"]({S},{W},{N},{E});
  nwr["railway"~"tram_stop|station|halt"]({S},{W},{N},{E});
  nwr["public_transport"~"station|platform"]({S},{W},{N},{E});
  nwr["leisure"~"^(park|playground|garden)$"]({S},{W},{N},{E});
);
out center tags;"""

d = overpass(Q)
feats, counts = [], {}
seen = set()
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
    feats.append({"type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {"cat": cat, "name": t.get("name", "")}})
    counts[cat] = counts.get(cat, 0) + 1

path = os.path.join(OUT, "amenities.geojson")
json.dump({"type": "FeatureCollection", "features": feats},
          open(path, "w", encoding="utf-8"), separators=(",", ":"))
print(f"amenities.geojson: {len(feats)} bodov, {os.path.getsize(path)/1024:.0f} kB")
print("podľa kategórie:", json.dumps(counts, ensure_ascii=False))

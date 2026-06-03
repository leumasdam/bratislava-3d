#!/usr/bin/env python3
"""Precise coordinates for named landmarks (so the map pins sit on the real thing)."""
import json, urllib.parse, urllib.request, time

UA = "bratislava-3d/1.0"
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def overpass(q, timeout=50):
    for ep in ENDPOINTS:
        try:
            data = urllib.parse.urlencode({"data": q}).encode()
            req = urllib.request.Request(ep, data=data,
                headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except Exception as ex:
            print("  miss", ep.split('//')[1].split('/')[0], type(ex).__name__)
            time.sleep(1)
    return {"elements": []}


Q = """[out:json][timeout:50];
(
  nwr["historic"="castle"]["name"~"Bratislavsk",i](48.135,17.09,48.150,17.11);
  nwr["name"="Eurovea Tower"](48.13,17.11,48.15,17.14);
  nwr["name"~"^Nivy Tower"](48.13,17.11,48.16,17.14);
  nwr["name"~"Sky Park"](48.14,17.10,48.16,17.13);
  nwr["railway"="station"]["name"~"Bratislava hlavn",i](48.15,17.09,48.17,17.12);
  nwr["name"~"Grassalkovich",i](48.14,17.10,48.16,17.12);
  nwr["historic"="memorial"]["name"="Slavín"](48.14,17.08,48.16,17.11);
  nwr["man_made"="bridge"]["name"~"Most SNP"](48.13,17.09,48.145,17.115);
  nwr["bridge:name"="Most SNP"](48.13,17.09,48.145,17.115);
  nwr["amenity"="theatre"]["name"~"Slovensk.*n.rodn.*divadlo",i](48.135,17.115,48.145,17.13);
);
out center 1;"""

d = overpass(Q)
seen = {}
for el in d.get("elements", []):
    t = el.get("tags", {})
    name = t.get("name", "?")
    lat = el.get("lat") or el.get("center", {}).get("lat")
    lon = el.get("lon") or el.get("center", {}).get("lon")
    if lat and lon and name not in seen:
        seen[name] = (round(lon, 5), round(lat, 5))
        print(f"{name:34} [{lon:.5f}, {lat:.5f}]")
print("\nJSON:", json.dumps(seen, ensure_ascii=False))

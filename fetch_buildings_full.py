#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Stiahne VŠETKY budovy Bratislavy z OSM (Overpass) pre celomestský 3D model.
Dlaždicovaný dopyt (proti 504), failover mirrorov, de-duplikácia podľa OSM id,
výška z tagov (height / building:levels). Výstup: data/buildings_full.geojson
(dočasný artefakt pre tiling — necommituje sa, ide len do pmtiles)."""
import json, time, sys, urllib.parse, urllib.request

BBOX = (48.055, 16.975, 48.230, 17.220)   # (S, W, N, E) — celé husté mesto + okraje
NX, NY = 6, 5                               # mriežka dlaždíc dopytu
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
OUT = "data/buildings_full.geojson"

def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for base in MIRRORS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(base, data=data,
                    headers={"User-Agent": "bratislava-3d-buildings"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read().decode())
            except Exception as e:
                last = e
                print(f"   ! {base.split('/')[2]} pokus {attempt+1}: {e}")
                time.sleep(3)
    raise RuntimeError(f"všetky mirrory zlyhali: {last}")

def height_of(tags):
    h = tags.get("height")
    if h:
        try: return max(2.0, float(str(h).replace("m", "").replace(",", ".").split()[0]))
        except: pass
    lv = tags.get("building:levels")
    if lv:
        try: return max(2.0, float(str(lv).replace(",", ".").split(";")[0]) * 3.1 + 1.0)
        except: pass
    b = tags.get("building", "yes")
    # hrubý odhad podľa typu, keď nič nevieme
    return {"church": 16, "cathedral": 28, "industrial": 9, "warehouse": 9,
            "retail": 7, "commercial": 12, "office": 18, "hospital": 16,
            "house": 7, "detached": 7, "garage": 3, "shed": 3, "hut": 3}.get(b, 9.0)

def kind_of(tags, h):
    """materiálová trieda budovy → kód (farba sa priradí v appke):
    0 default · 1 byty/dom · 2 sklo/kancelária · 3 civic/kameň · 4 priemysel · 5 retail"""
    b = (tags.get("building") or "yes").lower()
    if h >= 45:  # výškové = takmer vždy sklené veže
        return 2
    if b in ("office", "commercial"):
        return 2
    if b in ("residential", "apartments", "house", "detached", "dormitory",
             "terrace", "semidetached_house", "bungalow"):
        return 1
    if b in ("church", "cathedral", "chapel", "monastery", "civic", "public",
             "government", "university", "college", "school", "hospital",
             "museum", "train_station", "palace", "castle", "temple"):
        return 3
    if b in ("industrial", "warehouse", "manufacture", "factory",
             "garage", "garages", "shed", "hangar", "service"):
        return 4
    if b in ("retail", "supermarket", "kiosk", "mall"):
        return 5
    return 0

def min_height_of(tags):
    mh = tags.get("min_height")
    if mh:
        try: return max(0.0, float(str(mh).replace("m", "").split()[0]))
        except: pass
    ml = tags.get("building:min_level")
    if ml:
        try: return max(0.0, float(str(ml).replace(",", ".")) * 3.1)
        except: pass
    return 0.0

def main():
    s, w, n, e = BBOX
    seen = set()
    feats = []
    cells = NX * NY
    k = 0
    for iy in range(NY):
        for ix in range(NX):
            k += 1
            cs = s + (n - s) * iy / NY
            cn = s + (n - s) * (iy + 1) / NY
            cw = w + (e - w) * ix / NX
            ce = w + (e - w) * (ix + 1) / NX
            q = (f"[out:json][timeout:160];"
                 f'way["building"]({cs},{cw},{cn},{ce});out geom;')
            print(f"[{k}/{cells}] dlaždica ({cs:.3f},{cw:.3f})…", flush=True)
            try:
                data = overpass(q)
            except Exception as ex:
                print(f"   PRESKAKUJEM dlaždicu: {ex}")
                continue
            added = 0
            for el in data.get("elements", []):
                if el.get("type") != "way" or el["id"] in seen:
                    continue
                geom = el.get("geometry")
                if not geom or len(geom) < 4:
                    continue
                ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                if len(ring) < 4:
                    continue
                seen.add(el["id"])
                tags = el.get("tags", {})
                hh = round(height_of(tags), 1)
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": {
                        "h": hh,
                        "min": round(min_height_of(tags), 1),
                        "k": kind_of(tags, hh),
                    },
                })
                added += 1
            print(f"   +{added} (spolu {len(feats)})", flush=True)
            time.sleep(1.0)
    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f)
    import os
    print(f"HOTOVO: {len(feats)} budov → {OUT} ({os.path.getsize(OUT)/1048576:.1f} MB)")

if __name__ == "__main__":
    main()

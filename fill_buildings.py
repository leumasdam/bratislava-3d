#!/usr/bin/env python3
"""
Guaranteed-coverage building fetch: tiled + repeated sweeps over failed tiles.

Public Overpass mirrors are flaky right now (timeouts, one broken cert), so a single
pass can leave holes. We sweep the grid, remember which tiles failed, and re-sweep
just those (up to N rounds) until every tile reports in. De-dup by OSM way id across
sweeps, so re-tries never double-count.
"""
import json, urllib.parse, urllib.request, os, time, ssl

BBOX = (48.118, 17.085, 48.158, 17.140)
S, W, N, E = BBOX
ROWS, COLS = 4, 5
MAX_ROUNDS = 5
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d-portfolio/1.0 (open data viz demo)"
ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
_CTX = ssl.create_default_context()


def overpass(q, timeout=45):
    last = None
    for ep in ENDPOINTS:
        data = urllib.parse.urlencode({"data": q}).encode()
        req = urllib.request.Request(ep, data=data,
                                     headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
                return json.loads(r.read().decode())
        except Exception as ex:
            last = f"{ep.split('//')[1].split('/')[0]}: {type(ex).__name__}"
            time.sleep(1)
    raise RuntimeError(last)


def ring(g):
    c = [[round(p["lon"], 6), round(p["lat"], 6)] for p in g]
    if len(c) < 4:
        return None
    if c[0] != c[-1]:
        c.append(c[0])
    return c


def num(v, m=1.0):
    try:
        return float(str(v).split()[0].replace(",", ".")) * m
    except (ValueError, AttributeError, TypeError):
        return None


dlat, dlon = (N - S) / ROWS, (E - W) / COLS
all_tiles = []
for i in range(ROWS):
    for j in range(COLS):
        all_tiles.append((S + i*dlat, W + j*dlon, S + (i+1)*dlat, W + (j+1)*dlon))

# Fresh fetch of every tile, de-duped by OSM way id — no seeding, so no double counts.
seen = {}
existing = os.path.join(OUT, "buildings.geojson")
pending = list(range(len(all_tiles)))
for rnd in range(1, MAX_ROUNDS + 1):
    if not pending:
        break
    print(f"--- round {rnd}, {len(pending)} tiles ---", flush=True)
    still = []
    for idx in pending:
        s, w, n, e = all_tiles[idx]
        bb = f"{s:.5f},{w:.5f},{n:.5f},{e:.5f}"
        q = f'[out:json][timeout:50];way["building"]({bb});out geom;'
        try:
            d = overpass(q)
        except Exception as ex:
            print(f"  tile {idx} retry-later ({ex})", flush=True)
            still.append(idx); continue
        c = 0
        for el in d.get("elements", []):
            if el.get("type") != "way" or "geometry" not in el:
                continue
            key = f"w{el['id']}"
            if key in seen:
                continue
            r = ring(el["geometry"])
            if not r:
                continue
            t = el.get("tags", {})
            h = num(t.get("height")) or num(t.get("building:levels"), 3.2) or 8.0
            mh = num(t.get("min_height")) or num(t.get("building:min_level"), 3.2) or 0.0
            seen[key] = {"type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"h": round(max(2.0, h), 1), "min": round(max(0.0, mh), 1),
                               "name": t.get("name", ""), "kind": t.get("building", "yes")}}
            c += 1
        print(f"  tile {idx} ok +{c} (total {len(seen)})", flush=True)
        time.sleep(0.4)
    pending = still
    if pending:
        time.sleep(4)

feats = list(seen.values())
with open(existing, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
print(f"\nbuildings.geojson: {len(feats)} features, "
      f"{os.path.getsize(existing)/1024:.0f} kB, unfilled tiles: {pending}", flush=True)

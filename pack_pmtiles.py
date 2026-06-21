#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Zabalí MVT dlaždice z ./_tiles do data/buildings.pmtiles (PMTiles v3).
Dlaždice sú už gzip-nuté (z build_tiles.cjs) → tile_compression=GZIP."""
import json, os, glob
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, Compression, TileType

TILES = "_tiles"
OUT = "data/buildings.pmtiles"

meta = json.load(open(os.path.join(TILES, "meta.json")))
W, S, E, N = meta["bounds"]
clon, clat = meta["center"]

entries = []
for path in glob.glob(os.path.join(TILES, "*", "*", "*.pbf")):
    parts = path.replace("\\", "/").split("/")
    z, x, y = int(parts[-3]), int(parts[-2]), int(parts[-1][:-4])
    entries.append((zxy_to_tileid(z, x, y), path))
entries.sort(key=lambda e: e[0])
print(f"dlaždíc na zápis: {len(entries)}")

with open(OUT, "wb") as f:
    w = Writer(f)
    for tid, path in entries:
        with open(path, "rb") as tf:
            w.write_tile(tid, tf.read())
    header = {
        "version": 3,
        "tile_type": TileType.MVT,
        "tile_compression": Compression.GZIP,
        "min_zoom": meta["minzoom"],
        "max_zoom": meta["maxzoom"],
        "min_lon_e7": int(W * 1e7), "min_lat_e7": int(S * 1e7),
        "max_lon_e7": int(E * 1e7), "max_lat_e7": int(N * 1e7),
        "center_zoom": 13,
        "center_lon_e7": int(clon * 1e7), "center_lat_e7": int(clat * 1e7),
    }
    metadata = {
        "name": "Bratislava — budovy (OSM)",
        "type": "overlay",
        "attribution": "© OpenStreetMap (ODbL)",
        "vector_layers": [{
            "id": meta["layer"],
            "minzoom": meta["minzoom"], "maxzoom": meta["maxzoom"],
            "fields": {"h": "Number", "min": "Number", "k": "Number"},
        }],
    }
    w.finalize(header, metadata)

print(f"HOTOVO: {OUT} ({os.path.getsize(OUT)/1048576:.2f} MB)")

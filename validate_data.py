#!/usr/bin/env python3
"""Validácia dát pre CI — overí, že atlas dáta sú konzistentné. Exit 1 pri chybe."""
import json, os, sys, glob

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
errs = []

def check_grid(path, need_real=False):
    try:
        fc = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        errs.append(f"{path}: nečitateľný JSON ({e})"); return
    fs = fc.get("features", [])
    if not fs:
        errs.append(f"{path}: žiadne features"); return
    for f in fs[:9999]:
        p = f.get("properties", {})
        qi = p.get("q_index")
        if qi is None or not (0 <= qi <= 100):
            errs.append(f"{path}: q_index mimo rozsahu ({qi})"); break
        for k in ("q_access", "q_green", "q_heat", "q_transit", "q_walk", "q_noise"):
            if k not in p:
                errs.append(f"{path}: chýba {k}"); break
    print(f"  ✓ {os.path.relpath(path, DATA)}: {len(fs)} hexov")

# hlavný BA grid
check_grid(os.path.join(DATA, "grid.geojson"))
# mestá platformy
for cf in sorted(glob.glob(os.path.join(DATA, "cities", "*.json"))):
    check_grid(cf)

if errs:
    print("\nVALIDÁCIA ZLYHALA:")
    for e in errs: print("  ✗", e)
    sys.exit(1)
print("\nVšetky dáta v poriadku.")

#!/usr/bin/env python3
"""
Spojí 6 indikátorov do grid.geojson a spočíta kompozitný Index kvality miesta.

q_access  : 15-min dostupnosť (= existujúce idx)
q_green   : zelená rovnosť
q_heat    : tepelný komfort (inverz ostrova)
q_transit : kvalita MHD
q_walk    : chodeckosť
q_noise   : pokoj (inverz hluku)
q_index   : default kompozit (rovnaké váhy) — v appke prepočítavajú posuvníky
"""
import json, os, statistics as st

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
INDS = ["green", "heat", "transit", "walk", "noise"]

grid = json.load(open(os.path.join(OUT, "grid.geojson"), encoding="utf-8"))
feats = grid["features"]
N = len(feats)

arrays = {}
for name in INDS:
    a = json.load(open(os.path.join(OUT, f"ind_{name}.json"), encoding="utf-8"))
    assert len(a) == N, f"ind_{name}: {len(a)} != {N}"
    arrays[name] = a

for i, f in enumerate(feats):
    p = f["properties"]
    p["q_access"] = round(p.get("idx", 0))
    for name in INDS:
        p["q_" + name] = round(arrays[name][i], 1)
    six = [p["q_access"]] + [p["q_" + n] for n in INDS]
    p["q_index"] = round(sum(six) / len(six), 1)

json.dump(grid, open(os.path.join(OUT, "grid.geojson"), "w", encoding="utf-8"), separators=(",", ":"))

# --- sanity: priemery + korelácie (či nie je niečo invertované zle) ---
def col(key):
    return [f["properties"][key] for f in feats]

def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = sum((x - ma) ** 2 for x in a) ** .5
    db = sum((y - mb) ** 2 for y in b) ** .5
    return num / (da * db) if da and db else 0

keys = ["q_access", "q_green", "q_heat", "q_transit", "q_walk", "q_noise", "q_index"]
print(f"grid.geojson: {N} hexov, {os.path.getsize(os.path.join(OUT,'grid.geojson'))/1024:.0f} kB\n")
print("priemer indikátorov (0–100):")
for k in keys:
    print(f"  {k:9} {st.mean(col(k)):5.1f}")
print("\nkorelácie (sanity):")
print(f"  green↔heat   {corr(col('q_green'), col('q_heat')):+.2f}  (čakaj kladnú: zeleň chladí)")
print(f"  access↔transit {corr(col('q_access'), col('q_transit')):+.2f}  (čakaj kladnú)")
print(f"  access↔walk  {corr(col('q_access'), col('q_walk')):+.2f}")
print(f"  noise↔transit {corr(col('q_noise'), col('q_transit')):+.2f}  (často záporná: pri cestách viac MHD ale hluk)")

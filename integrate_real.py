#!/usr/bin/env python3
"""
Nahradí odhady REÁLNYMI dátami:
- pop      ← WorldPop (pop_real.json), skutoční obyvatelia/hex
- q_transit ← GTFS DPB (ind_transit_real.json), reálne frekvencie zastávok

GTFS frekvencie sú silno pravostranne zošikmené (pár uzlov dominuje), preto
„kvalitu MHD" zobrazujeme na odmocninovej škále (štandard pri dostupnosti dopravy)
— zachová poradie, ale rozprestrie nízke hodnoty do čitateľného rozsahu.
"""
import json, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
WEIGHTED = ["access", "green", "heat", "transit", "walk", "noise"]
KEY = {"access": "q_access", "green": "q_green", "heat": "q_heat",
       "transit": "q_transit", "walk": "q_walk", "noise": "q_noise"}

grid = json.load(open(os.path.join(OUT, "grid.geojson"), encoding="utf-8"))
pop = json.load(open(os.path.join(OUT, "pop_real.json"), encoding="utf-8"))
tr = json.load(open(os.path.join(OUT, "ind_transit_real.json"), encoding="utf-8"))
N = len(grid["features"])
assert len(pop) == N and len(tr) == N, f"dĺžky nesedia: pop {len(pop)}, tr {len(tr)}, grid {N}"

for i, f in enumerate(grid["features"]):
    p = f["properties"]
    p["pop"] = round(pop[i])
    p["q_transit"] = round(min(100.0, 10.0 * math.sqrt(max(0.0, tr[i]))), 1)  # sqrt-spread
    # prepočítaj kompozit (rovnaké váhy ako default v appke; JS to aj tak prepočíta)
    p["q_index"] = round(sum(p[KEY[k]] for k in WEIGHTED) / len(WEIGHTED), 1)

json.dump(grid, open(os.path.join(OUT, "grid.geojson"), "w", encoding="utf-8"), separators=(",", ":"))

import statistics as st
def col(k): return [f["properties"][k] for f in grid["features"]]
print(f"grid.geojson aktualizovaný ({N} hexov)")
print(f"  pop (reálna): súčet {sum(col('pop')):,}, max {max(col('pop'))}, ⌀ {st.mean(col('pop')):.0f}")
print(f"  q_transit (GTFS, sqrt): ⌀ {st.mean(col('q_transit')):.1f}, max {max(col('q_transit')):.0f}, hexov >0: {sum(1 for v in col('q_transit') if v>0)}")
print(f"  q_index (nový kompozit): ⌀ {st.mean(col('q_index')):.1f}")

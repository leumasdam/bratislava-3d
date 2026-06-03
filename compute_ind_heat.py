"""
Indikator: Tepelny komfort (inverz tepelneho ostrova), kluc "heat".

Metoda (proxy):
  Pre kazdy hex vezmeme kruh s polomerom ~400 m okolo jeho centroidu.
  V tomto okoli zmeriame:
    - CHLADIACE plochy: zelen (land_green) + voda (water)
    - HREJUCE plochy: zastavane (land_use + residential)
  Surova hodnota = (chladiaca plocha - hrejuca plocha) / plocha kruhu.
  Cim viac zelene/vody a menej betonu v okoli, tym chladnejsie => vyssie skore.
  Normalizujeme na 0-100 (100 = najlepsi tepelny komfort = najchladnejsie).

Suradnice -> metre: lokalna ekvirektangularna projekcia
  x = lon * MX, y = lat * MY,  MX = 111320*cos(rad(48.15)), MY = 111320.

POCTIVE LIMITY (proxy, nie satelit):
  - Toto NIE je nameranana teplota (LST). Je to land-cover proxy tepelneho ostrova.
  - Okolie je kruh vzdusnou ciarou (Euclid), nezohladnuje tienenie budov, albedo,
    vlhkost, vietor, vysku/hustotu zastavby, antropogenne teplo.
  - "Hrejuce" = polygony land_use + residential; ak realna zastavba chyba v tychto
    vrstvach, podhodnotime ohrev. Prekryv medzi vrstvami sa NEpocita 2x (zjednotenie).
  - Chladiace a hrejuce vrstvy sa mozu geometricky prekryvat; pocitame ich nezavisle
    ako podiel plochy kruhu, takze surova hodnota moze byt mimo [-1,1] len teoreticky.
"""

import json
import math
import os

from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep

DATA = "C:/Users/samue/bratislava-3d/data"
RADIUS_M = 400.0

LAT0 = 48.15
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0


def load(fn):
    with open(os.path.join(DATA, fn), "r", encoding="utf-8") as f:
        return json.load(f)


def project_geom(geom):
    """Reprojektuj shapely geometriu z lon/lat do lokalnych metrov."""
    from shapely.ops import transform
    return transform(lambda x, y, z=None: (x * MX, y * MY), geom)


def load_layer_projected(fn):
    """Nacitaj vrstvu, zjednot do jednej (multi)geometrie v metroch."""
    gj = load(fn)
    geoms = []
    for feat in gj["features"]:
        g = feat.get("geometry")
        if not g:
            continue
        s = shape(g)
        if not s.is_valid:
            s = s.buffer(0)
        if s.is_empty:
            continue
        geoms.append(project_geom(s))
    if not geoms:
        return None
    u = unary_union(geoms)
    return u


def area_in_circle(circle, prepared_layer, tree, parts):
    """Plocha prieniku vrstvy s kruhom (m^2), cez STRtree kandidatov."""
    if prepared_layer is None:
        return 0.0
    idx = tree.query(circle)
    if len(idx) == 0:
        return 0.0
    total = 0.0
    for i in idx:
        part = parts[i]
        # rychly prepared test
        if prepared_layer.intersects(part):
            inter = circle.intersection(part)
            if not inter.is_empty:
                total += inter.area
    return total


def build_index(union_geom):
    """Rozbi union na casti pre STRtree (rychlejsie prieniky s kruhom)."""
    if union_geom is None:
        return None, None, None
    if union_geom.geom_type.startswith("Multi") or union_geom.geom_type == "GeometryCollection":
        parts = [g for g in union_geom.geoms if not g.is_empty]
    else:
        parts = [union_geom]
    tree = STRtree(parts)
    prepared = prep(union_geom)
    return prepared, tree, parts


def main():
    grid = load("grid.geojson")
    feats = grid["features"]
    N = len(feats)

    # centroidy v metroch, v poradi features
    centroids = []
    for feat in feats:
        coords = feat["geometry"]["coordinates"][0]
        # priemer vrcholov (poslednу bod = prvy, vynechame duplikat ak je)
        ring = coords[:-1] if coords[0] == coords[-1] else coords
        sx = sum(p[0] for p in ring) / len(ring)
        sy = sum(p[1] for p in ring) / len(ring)
        centroids.append((sx * MX, sy * MY))

    # chladiace = zelen + voda; hrejuce = land_use + residential
    print("Nacitavam vrstvy...")
    green = load_layer_projected("land_green.geojson")
    water = load_layer_projected("water.geojson")
    land_use = load_layer_projected("land_use.geojson")
    resid = load_layer_projected("residential.geojson")

    cool_geoms = [g for g in (green, water) if g is not None]
    warm_geoms = [g for g in (land_use, resid) if g is not None]
    cool = unary_union(cool_geoms) if cool_geoms else None
    warm = unary_union(warm_geoms) if warm_geoms else None

    cool_prep, cool_tree, cool_parts = build_index(cool)
    warm_prep, warm_tree, warm_parts = build_index(warm)

    circle_area = math.pi * RADIUS_M * RADIUS_M

    raw = []
    for i, (cx, cy) in enumerate(centroids):
        circle = Point(cx, cy).buffer(RADIUS_M, quad_segs=32)
        a_cool = area_in_circle(circle, cool_prep, cool_tree, cool_parts)
        a_warm = area_in_circle(circle, warm_prep, warm_tree, warm_parts)
        frac_cool = a_cool / circle_area
        frac_warm = a_warm / circle_area
        raw.append(frac_cool - frac_warm)  # vyssie = chladnejsie = lepsie
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{N} hexov")

    # normalizacia na 0-100, 100 = najlepsie (najchladnejsie).
    # raw je uz orientovany spravne (vyssie=lepsie), takze NEinvertujeme.
    rmin = min(raw)
    rmax = max(raw)
    span = rmax - rmin
    if span == 0:
        scores = [50.0] * N
    else:
        scores = [round((r - rmin) / span * 100.0, 1) for r in raw]

    assert len(scores) == N, f"dlzka {len(scores)} != N {N}"
    assert all(0.0 <= s <= 100.0 for s in scores), "skore mimo [0,100]"

    out = os.path.join(DATA, "ind_heat.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(scores, f, ensure_ascii=False)

    mean = sum(scores) / N
    print(f"\nHotovo. N={N}")
    print(f"raw range: {rmin:.4f} .. {rmax:.4f}")
    print(f"score mean={mean:.2f} min={min(scores)} max={max(scores)}")
    print(f"zapisane: {out}")


if __name__ == "__main__":
    main()

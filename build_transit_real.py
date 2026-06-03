# -*- coding: utf-8 -*-
"""Build REAL 'MHD quality' indicator from Bratislava GTFS (IDS BK / DPB).

Step 1: GTFS already downloaded to data/gtfs_ba.zip (producer: arcgis item
        aba12fd2cbac4843bc7406151bc66106, mirrored on mobilitydatabase tld-3363).
Step 2: stop frequency = number of departures on a typical weekday (Wednesday),
        from stop_times x trips x calendar (services with wednesday=1).
Step 3: per hex -> distance-weighted sum of stop frequencies within ~400 m
        (Gaussian decay), normalized 0-100.
Step 4: write data/ind_transit_real.json (N numbers, in feature order).
"""
import zipfile, csv, io, json, math
from collections import defaultdict

DATA = r"C:/Users/samue/bratislava-3d/data"
ZIP = DATA + "/gtfs_ba.zip"
GRID = DATA + "/grid.geojson"
OUT = DATA + "/ind_transit_real.json"

RADIUS_M = 400.0          # influence radius
SIGMA_M = 250.0           # Gaussian decay -> at 400 m weight ~0.08, very local
WEEKDAY = "wednesday"     # representative working day

z = zipfile.ZipFile(ZIP)

def reader(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))

# --- weekday services (a normal working day) ---
weekday_services = set()
for row in reader("calendar.txt"):
    if row.get(WEEKDAY, "0").strip() == "1":
        weekday_services.add(row["service_id"])
print("weekday services:", len(weekday_services), sorted(weekday_services))

# --- trips active on a weekday -> their trip_ids ---
weekday_trips = set()
for row in reader("trips.txt"):
    if row["service_id"] in weekday_services:
        weekday_trips.add(row["trip_id"])
print("weekday trips:", len(weekday_trips))

# --- frequency per stop = departures by weekday trips ---
# Count each stop visit by a weekday trip (one departure event = one service).
stop_freq = defaultdict(int)
total_visits = 0
for row in reader("stop_times.txt"):
    if row["trip_id"] in weekday_trips:
        stop_freq[row["stop_id"]] += 1
        total_visits += 1
print("weekday stop visits:", total_visits, "served stops:", len(stop_freq))

# --- stop coordinates ---
stops = []  # (lat, lon, freq)
served = 0
for row in reader("stops.txt"):
    f = stop_freq.get(row["stop_id"], 0)
    if f == 0:
        continue
    try:
        lat = float(row["stop_lat"]); lon = float(row["stop_lon"])
    except (ValueError, KeyError):
        continue
    stops.append((lat, lon, f))
    served += 1
print("stops with coords + service:", served)

# --- grid ---
gj = json.load(open(GRID, encoding="utf-8"))
feats = gj["features"]
N = len(feats)
print("hexes:", N)

def centroid(geom):
    if geom["type"] == "Polygon":
        ring = geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        ring = geom["coordinates"][0][0]
    else:
        return None
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)  # lon, lat

# local meters per degree, around Bratislava (~48.15 N)
LAT0 = 48.15
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# pre-project stops to local meters
stops_xy = [(lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT, fr) for (lat, lon, fr) in stops]

raw = []
two_sig2 = 2.0 * SIGMA_M * SIGMA_M
for feat in feats:
    c = centroid(feat["geometry"])
    if c is None:
        raw.append(0.0); continue
    cx = c[0] * M_PER_DEG_LON
    cy = c[1] * M_PER_DEG_LAT
    acc = 0.0
    for (sx, sy, fr) in stops_xy:
        dx = sx - cx; dy = sy - cy
        d2 = dx * dx + dy * dy
        if d2 > RADIUS_M * RADIUS_M:
            continue
        w = math.exp(-d2 / two_sig2)  # Gaussian, closer = more
        acc += w * fr
    raw.append(acc)

# --- normalize 0-100 ---
mx = max(raw) if raw else 0.0
if mx > 0:
    vals = [round(100.0 * r / mx, 2) for r in raw]
else:
    vals = [0.0] * N

nz = sum(1 for v in vals if v > 0)
print("nonzero hexes:", nz, "/", N, "max raw:", round(mx, 1))
print("sample first 10:", vals[:10])

json.dump(vals, open(OUT, "w"), ensure_ascii=False)
print("wrote", OUT, "len", len(vals))

# summary stats for headline
top = sorted(vals, reverse=True)[:5]
print("top5:", top)
print("served_stops_total", served, "total_stops_in_feed", 1358)

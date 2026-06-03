import json, math, time, urllib.request, urllib.error
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

LAT0, LON0 = 49.1951, 16.6068
DLAT, DLON = 0.085, 0.125
S, N = LAT0 - DLAT, LAT0 + DLAT
W, E = LON0 - DLON, LON0 + DLON

MIRRORS = ["https://overpass.private.coffee/api/interpreter",
           "https://overpass-api.de/api/interpreter"]

COSLAT = math.cos(math.radians(LAT0))
def to_m(lon, lat):
    return (lon * 111320.0 * COSLAT, lat * 111320.0)

CATS = {
 "skola": 'nwr["amenity"="school"]',
 "skolka": 'nwr["amenity"="kindergarten"]',
 "lekaren": 'nwr["amenity"="pharmacy"]',
 "lekar": 'nwr["amenity"~"doctors|clinic|hospital"];nwr["healthcare"~"doctor|clinic|centre"]',
 "obchod": 'nwr["shop"~"supermarket|convenience|grocery|general"]',
 "zastavka": 'nwr["highway"="bus_stop"];nwr["railway"~"tram_stop|station|halt"];nwr["public_transport"~"station|platform"]',
 "park": 'nwr["leisure"~"park|playground|garden"]',
}
RADII = {"zastavka":400,"park":500,"obchod":700,"lekaren":700,"skolka":800,"skola":1000,"lekar":1000}

def build_query(s,w,n,e):
    parts=[]
    for k,q in CATS.items():
        for sub in q.split(";"):
            sub=sub.strip()
            if sub:
                parts.append(sub+f'({s},{w},{n},{e});')
    parts.append(f'way["landuse"="residential"]({s},{w},{n},{e});')
    parts.append(f'relation["landuse"="residential"]({s},{w},{n},{e});')
    body="".join(parts)
    return f"[out:json][timeout:120];({body});out center;"

def fetch(s,w,n,e):
    q=build_query(s,w,n,e)
    data=urllib.parse.urlencode({"data":q}).encode()
    last=None
    for attempt in range(3):
        for m in MIRRORS:
            try:
                req=urllib.request.Request(m,data=data,headers={
                    "User-Agent":"brno-15min/1.0 (research)",
                    "Accept":"application/json"})
                with urllib.request.urlopen(req,timeout=180) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last=ex
                time.sleep(3)
    raise last

import urllib.parse
# tile 2x2
tiles=[]
mlat=(S+N)/2; mlon=(W+E)/2
for (s,n) in [(S,mlat),(mlat,N)]:
    for (w,e) in [(W,mlon),(mlon,E)]:
        tiles.append((s,w,n,e))

elements=[]
for t in tiles:
    try:
        d=fetch(*t)
        elements.extend(d.get("elements",[]))
    except Exception as ex:
        print("tile fail",t,ex)

# dedupe by type/id
seen=set()
els=[]
for el in elements:
    key=(el.get("type"),el.get("id"))
    if key in seen: continue
    seen.add(key); els.append(el)

def el_point(el):
    if el.get("type")=="node":
        return (el.get("lon"),el.get("lat"))
    c=el.get("center")
    if c: return (c.get("lon"),c.get("lat"))
    return None

# classify amenities & collect residential
def match_cat(tags):
    cats=set()
    a=tags.get("amenity",""); hc=tags.get("healthcare","")
    sh=tags.get("shop",""); hw=tags.get("highway",""); rw=tags.get("railway","")
    pt=tags.get("public_transport",""); le=tags.get("leisure","")
    if a=="school": cats.add("skola")
    if a=="kindergarten": cats.add("skolka")
    if a=="pharmacy": cats.add("lekaren")
    if a in("doctors","clinic","hospital") or hc in("doctor","clinic","centre"): cats.add("lekar")
    if sh in("supermarket","convenience","grocery","general"): cats.add("obchod")
    if hw=="bus_stop" or rw in("tram_stop","station","halt") or pt in("station","platform"): cats.add("zastavka")
    if le in("park","playground","garden"): cats.add("park")
    return cats

cat_pts={k:[] for k in CATS}
res_polys=[]
nodes_by_id={el["id"]:(el.get("lon"),el.get("lat")) for el in els if el.get("type")=="node"}

for el in els:
    tags=el.get("tags",{}) or {}
    if tags.get("landuse")=="residential":
        # build polygon from center? we used out center, so polygons collapse. Need geometry.
        pass

# We used "out center" -> residential ways have center only. Build buffered points fallback won't make polygon area.
# Re-fetch residential geometry properly.
def fetch_res_geom(s,w,n,e):
    q=f'[out:json][timeout:120];(way["landuse"="residential"]({s},{w},{n},{e});relation["landuse"="residential"]({s},{w},{n},{e}););out geom;'
    data=urllib.parse.urlencode({"data":q}).encode()
    last=None
    for attempt in range(3):
        for m in MIRRORS:
            try:
                req=urllib.request.Request(m,data=data,headers={"User-Agent":"brno-15min/1.0","Accept":"application/json"})
                with urllib.request.urlopen(req,timeout=180) as r:
                    return json.loads(r.read().decode())
            except Exception as ex:
                last=ex; time.sleep(3)
    raise last

res_elements=[]
for t in tiles:
    try:
        d=fetch_res_geom(*t)
        res_elements.extend(d.get("elements",[]))
    except Exception as ex:
        print("res tile fail",t,ex)

rseen=set()
for el in res_elements:
    key=(el.get("type"),el.get("id"))
    if key in rseen: continue
    rseen.add(key)
    if el.get("type")=="way" and el.get("geometry"):
        coords=[to_m(p["lon"],p["lat"]) for p in el["geometry"]]
        if len(coords)>=4:
            try:
                poly=Polygon(coords)
                if poly.is_valid and poly.area>0: res_polys.append(poly)
                elif not poly.is_valid:
                    poly=poly.buffer(0)
                    if poly.area>0: res_polys.append(poly)
            except Exception: pass
    elif el.get("type")=="relation" and el.get("members"):
        for mem in el["members"]:
            if mem.get("type")=="way" and mem.get("geometry") and mem.get("role") in("outer",""):
                coords=[to_m(p["lon"],p["lat"]) for p in mem["geometry"]]
                if len(coords)>=4:
                    try:
                        poly=Polygon(coords)
                        if not poly.is_valid: poly=poly.buffer(0)
                        if poly.area>0: res_polys.append(poly)
                    except Exception: pass

# amenity points
amen_count=0
for el in els:
    tags=el.get("tags",{}) or {}
    cats=match_cat(tags)
    if not cats: continue
    p=el_point(el)
    if p is None or p[0] is None: continue
    xm=to_m(p[0],p[1])
    for c in cats:
        cat_pts[c].append(xm)
    amen_count+=1

if not res_polys:
    print(json.dumps({"error":"no residential","amenities":amen_count}))
    raise SystemExit

res_union=unary_union(res_polys).buffer(260.0)

# hex grid flat-top radius 250m
R=250.0
wcell=2*R           # flat-top width (horizontal) = 2R
hcell=math.sqrt(3)*R
xstep=1.5*R
ystep=hcell
xmin,ymin=to_m(W,S)
xmax,ymax=to_m(E,N)

def hexagon(cx,cy,r):
    pts=[]
    for i in range(6):
        ang=math.radians(60*i)  # flat-top
        pts.append((cx+r*math.cos(ang),cy+r*math.sin(ang)))
    return Polygon(pts)

minx,miny,maxx,maxy=res_union.bounds
hexes=[]
col=0
x=xmin
while x<=xmax+R:
    yoff=0 if col%2==0 else ystep/2
    y=ymin
    while y+yoff<=ymax+R:
        cx=x; cy=y+yoff
        if minx-R<=cx<=maxx+R and miny-R<=cy<=maxy+R:
            hexes.append((cx,cy))
        y+=ystep
    x+=xstep
    col+=1

# build STRtrees per cat
trees={}
for c,pts in cat_pts.items():
    if pts:
        trees[c]=(STRtree([Point(p) for p in pts]),[Point(p) for p in pts])
    else:
        trees[c]=(None,[])

prep=res_union
kept=[]
for (cx,cy) in hexes:
    if prep.contains(Point(cx,cy)):
        kept.append((cx,cy))

cat_hit={c:0 for c in CATS}
scores=[]
for (cx,cy) in kept:
    pt=Point(cx,cy)
    score=0
    for c in CATS:
        tree,plist=trees[c]
        rad=RADII[c]
        hit=False
        if tree is not None:
            idxs=tree.query(pt.buffer(rad))
            for i in idxs:
                if pt.distance(plist[int(i)])<=rad:
                    hit=True; break
        if hit:
            score+=1; cat_hit[c]+=1
    scores.append(score)

nH=len(scores)
if nH==0:
    print(json.dumps({"error":"no hexes","amenities":amen_count}))
    raise SystemExit

pctGood=100.0*sum(1 for s in scores if s>=6)/nH
pctPoor=100.0*sum(1 for s in scores if s<=3)/nH
meanScore=sum(scores)/nH
perCat={c:round(100.0*cat_hit[c]/nH,1) for c in CATS}

out={"city":"Brno","nHexes":nH,"pctGood":round(pctGood,1),"pctPoor":round(pctPoor,1),
     "meanScore":round(meanScore,3),"perCat":perCat,"amenities":amen_count}
print("RESULT",json.dumps(out,ensure_ascii=False))

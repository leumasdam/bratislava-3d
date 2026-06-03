#!/usr/bin/env python3
"""Fotka + krátky popis pamiatok zo slovenskej Wikipédie.
Robustne: keď priamy názov zlyhá, dohľadá správny článok cez opensearch a skúsi znova.
Výstup landmarks_info.json {name: {img, desc}}."""
import json, urllib.parse, urllib.request, os, time

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = "bratislava-3d/1.0 (portfolio; contact via github)"

TITLES = {
    "Bratislavský hrad": "Bratislavský hrad",
    "Most SNP · UFO": "Most SNP",
    "Modrý kostolík": "Kostol svätej Alžbety (Bratislava)",
    "Grassalkovičov palác": "Grasalkovičov palác",
    "SND": "Slovenské národné divadlo",
    "Eurovea Tower": "Eurovea Tower",
    "Sky Park": "Sky Park",
    "Stanica Nivy": "Stanica Nivy",
    "Hlavná stanica": "Bratislava hlavná stanica",
    "Slavín": "Slavín",
    "Sad Janka Kráľa": "Sad Janka Kráľa",
    "Aupark": "Aupark",
    "Michalská brána": "Michalská brána",
    "Primaciálny palác": "Primaciálny palác",
    "Stará tržnica": "Stará tržnica",
    "Horský park": "Horský park",
    "Medická záhrada": "Medická záhrada",
}
# dotaz pre opensearch fallback (ľudský názov)
SEARCH = {
    "Primaciálny palác": "Primaciálny palác Bratislava",
    "Stará tržnica": "Stará tržnica Bratislava",
    "Horský park": "Horský park Bratislava",
    "Medická záhrada": "Medická záhrada Bratislava",
    "Slavín": "Slavín pamätník Bratislava",
    "Aupark": "Aupark Bratislava",
    "Modrý kostolík": "Modrý kostol Bratislava",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def summary(title):
    for _ in range(2):
        try:
            return get("https://sk.wikipedia.org/api/rest_v1/page/summary/"
                       + urllib.parse.quote(title.replace(" ", "_")))
        except Exception:
            time.sleep(1.5)
    return None


def search_title(q):
    try:
        d = get("https://sk.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search="
                + urllib.parse.quote(q))
        return d[1][0] if d and len(d) > 1 and d[1] else None
    except Exception:
        return None


info = {}
for name, title in TITLES.items():
    d = summary(title)
    if not d or not (d.get("thumbnail") or {}).get("source"):
        alt = search_title(SEARCH.get(name, name + " Bratislava"))
        if alt:
            d2 = summary(alt)
            if d2 and ((d2.get("thumbnail") or {}).get("source") or not d):
                d = d2
    # URL thumbnailu necháme presne ako ho dá API — Wikimedia povoľuje len svoje šírky
    img = (d.get("thumbnail") or {}).get("source", "") if d else ""
    desc = (d.get("extract", "") if d else "")
    if len(desc) > 240:
        desc = desc[:237].rsplit(" ", 1)[0] + "…"
    info[name] = {"img": img, "desc": desc}
    print(f"{'✓' if img else '·'} {name:24} {'foto' if img else 'BEZ FOTA'}  {len(desc)}z")
    time.sleep(0.4)

json.dump(info, open(os.path.join(OUT, "landmarks_info.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"\nlandmarks_info.json: {sum(1 for v in info.values() if v['img'])}/{len(info)} s fotom, "
      f"{sum(1 for v in info.values() if v['desc'])}/{len(info)} s popisom")

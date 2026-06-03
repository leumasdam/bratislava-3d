/* Bratislava 3D — atlas mesta z otvorených dát
   Pure-data "architektonický model": žiadna externá mapová podložka, len OSM geodáta
   vykreslené cez MapLibre GL JS (API-kompatibilné s Mapbox GL JS). */

const DATA = (f) => `data/${f}`;

/* ---- height → color ramp (metre) ---- */
const HEIGHT_RAMP = [
  0, '#21303a', 8, '#27606b', 15, '#2f8f8a', 25, '#46e0d0',
  40, '#bfe27a', 60, '#ffc24b', 90, '#ff7a45', 130, '#ff4d4d',
];
/* ---- 15-min index → color ramp (0–100, červená = slabá, zelená = špička) ---- */
const ACCESS_RAMP = [
  45, '#c0392b', 56, '#e0603b', 66, '#e6a13c', 75, '#d8c84a',
  83, '#8ec85a', 92, '#34c47a',
];
/* ---- kategórie dennej vybavenosti (poradie = riadky v karte) ---- */
const CAT_META = {
  obchod:  { emoji:'🛒', label:'Obchod',   color:'#5dade2', rad:700  },
  zastavka:{ emoji:'🚏', label:'Zastávka', color:'#58d68d', rad:400  },
  lekaren: { emoji:'💊', label:'Lekáreň',  color:'#bb8fce', rad:700  },
  lekar:   { emoji:'🩺', label:'Lekár',    color:'#ec7063', rad:1000 },
  skola:   { emoji:'🏫', label:'Škola',    color:'#f4d03f', rad:1000 },
  skolka:  { emoji:'🧸', label:'Škôlka',   color:'#f5b041', rad:800  },
  park:    { emoji:'🌳', label:'Park',     color:'#45b39d', rad:500  },
};
const CAT_ORDER = ['obchod','zastavka','lekaren','lekar','skola','skolka','park'];
let lens = 'access';        // 'access' | 'height'
let amByCat = {};           // cat -> [[lon,lat],...] pre klik-výpočet
let weakOn = false;
let heightMin = 0, accessMin = 0;
let activeCats = new Set(CAT_ORDER);   // ktoré kategórie vybavenosti sa zobrazujú

/* ---- orientačné body: pin = známe miesto, area = názov štvrte ---- */
const LANDMARKS = [
  { t:'pin', icon:'🏰', name:'Bratislavský hrad', at:[17.1003,48.1419], year:'9. stor. / obnova 1968', fact:'Dominanta nad Dunajom, dnes sídlo expozícií SNM.' },
  { t:'pin', icon:'🛸', name:'Most SNP · UFO', at:[17.1045,48.1383], year:'1972', fact:'Most s vyhliadkou UFO — jediný slovenský člen Svetovej federácie veží.' },
  { t:'pin', icon:'⛪', name:'Modrý kostolík', at:[17.1170,48.1437], year:'1913', fact:'Secesný skvost architekta Ödöna Lechnera.' },
  { t:'pin', icon:'🏛️', name:'Grassalkovičov palác', at:[17.1106,48.1486], year:'1760', fact:'Sídlo prezidenta SR, za ním Francúzska záhrada.' },
  { t:'pin', icon:'🎭', name:'SND', at:[17.1238,48.1404], year:'2007', fact:'Nová budova Slovenského národného divadla na nábreží.' },
  { t:'pin', icon:'🏢', name:'Eurovea Tower', at:[17.1271,48.1398], year:'2023', fact:'Najvyššia budova Slovenska — 168 m.' },
  { t:'pin', icon:'🏙️', name:'Sky Park', at:[17.1255,48.1446], year:'2020', fact:'Rezidencie podľa návrhu Zahy Hadid.' },
  { t:'pin', icon:'🚌', name:'Stanica Nivy', at:[17.1300,48.1462], year:'2021', fact:'Autobusová stanica s parkom na streche.' },
  { t:'pin', icon:'🚉', name:'Hlavná stanica', at:[17.1065,48.1590], year:'1871', fact:'Hlavná železničná stanica mesta.' },
  { t:'pin', icon:'🗿', name:'Slavín', at:[17.0972,48.1531], year:'1960', fact:'Pamätník a vyhliadka nad mestom.' },
  { t:'pin', icon:'🌳', name:'Sad Janka Kráľa', at:[17.1045,48.1340], year:'1776', fact:'Jeden z najstarších verejných parkov v Európe.' },
  { t:'pin', icon:'🛍️', name:'Aupark', at:[17.1078,48.1247], year:'2001', fact:'Nákupné centrum pri Sade Janka Kráľa.' },
  { t:'pin', icon:'🚪', name:'Michalská brána', at:[17.1067,48.1437], year:'14. stor.', fact:'Jediná zachovaná stredoveká mestská brána.' },
  { t:'pin', icon:'🏛️', name:'Primaciálny palác', at:[17.1090,48.1443], year:'1781', fact:'Klasicistický palác so Zrkadlovou sieňou.' },
  { t:'pin', icon:'🏬', name:'Stará tržnica', at:[17.1128,48.1448], year:'1910', fact:'Historická tržnica, dnes kultúrny priestor.' },
  { t:'pin', icon:'🌲', name:'Horský park', at:[17.0960,48.1565], year:'1868', fact:'Lesopark nad centrom, pamiatková zóna.' },
  { t:'pin', icon:'🌳', name:'Medická záhrada', at:[17.1180,48.1505], year:'18. stor.', fact:'Historická záhrada v centre mesta.' },
  { t:'area', name:'STARÉ MESTO', at:[17.1085,48.1455] },
  { t:'area', name:'PETRŽALKA',   at:[17.1075,48.1175] },
  { t:'area', name:'NOVÉ MESTO',  at:[17.1290,48.1610] },
  { t:'area', name:'RUŽINOV',     at:[17.1470,48.1530] },
];
let lmMarkers = [];
let lmInfo = {};            // name -> {img, desc} z Wikipédie
let focusMarker = null;

/* ---- atmosphere presets ---- */
const MOODS = {
  day:   { bg:'#0b1018', light:[1.1,0.55,0.4], lightPos:[1.3,120,40], boost:1.0,  fog:'rgba(120,150,170,.0)' },
  dusk:  { bg:'#0a0c14', light:[1.0,0.45,0.55],lightPos:[1.4,250,28], boost:1.06, fog:'rgba(255,120,70,.08)' },
  night: { bg:'#05070c', light:[0.7,0.35,0.7], lightPos:[1.5,300,70], boost:1.18, fog:'rgba(40,70,120,.12)' },
};

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': MOODS.day.bg } },
  ], glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf' },
  center: [17.1150, 48.1500],
  zoom: 11.4, pitch: 50, bearing: -16,
  maxPitch: 78, antialias: true, attributionControl: false,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

let buildingsData = null;
let hoveredId = null;
let currentMood = 'day';

/* ---------- helpers ---------- */
async function loadJSON(file) {
  try {
    const r = await fetch(DATA(file));
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('chýba/zlyhalo', file, e);
    return { type: 'FeatureCollection', features: [] };
  }
}

function applyLight(mood) {
  const m = MOODS[mood];
  map.setPaintProperty('bg', 'background-color', m.bg);
  try {
    map.setLight({ anchor: 'map', color: '#ffffff',
      intensity: m.light[0] * 0.4, position: m.lightPos });
  } catch (e) {}
  if (map.getLayer('buildings')) {
    map.setPaintProperty('buildings', 'fill-extrusion-vertical-gradient', true);
  }
  document.body.style.setProperty('--mood-fog', m.fog);
}

/* ---------- build the scene ---------- */
map.on('load', async () => {
  const [buildings, green, water, roads, districts, amenities, rivers, info, grid] = await Promise.all([
    loadJSON('buildings.geojson'), loadJSON('green.geojson'),
    loadJSON('water.geojson'), loadJSON('roads.geojson'),
    loadJSON('districts.geojson'), loadJSON('amenities_city.geojson'),
    loadJSON('rivers.geojson'), loadJSON('landmarks_info.json'),
    loadJSON('grid.geojson'),
  ]);
  const cityRoads = await loadJSON('city_roads.geojson');
  buildingsData = buildings;
  lmInfo = info && !info.features ? info : {};
  for (const c of CAT_ORDER) amByCat[c] = [];
  for (const f of amenities.features) {
    const c = f.properties.cat;
    if (amByCat[c]) amByCat[c].push(f.geometry.coordinates);
  }

  map.addSource('water', { type: 'geojson', data: water });
  map.addSource('rivers', { type: 'geojson', data: rivers });
  map.addSource('green', { type: 'geojson', data: green });
  map.addSource('city-roads', { type: 'geojson', data: cityRoads });
  map.addSource('roads', { type: 'geojson', data: roads });
  map.addSource('districts', { type: 'geojson', data: districts });
  map.addSource('amenities', { type: 'geojson', data: amenities });
  map.addSource('grid', { type: 'geojson', data: grid });
  map.addSource('buildings', { type: 'geojson', data: buildings, generateId: true });

  /* water — svetlomodrá, nech Dunaj vystúpi */
  map.addLayer({ id: 'water', type: 'fill', source: 'water',
    paint: { 'fill-color': '#2b7fb8', 'fill-opacity': 0.78 } });
  map.addLayer({ id: 'water-edge', type: 'line', source: 'water',
    paint: { 'line-color': '#7ec8ec', 'line-width': 1.1, 'line-opacity': 0.7 } });
  /* rieky a kanály (Chorvátske rameno…) ako línie */
  map.addLayer({ id: 'rivers', type: 'line', source: 'rivers',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#3f9fd0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16,
        ['match', ['get', 'kind'], 'river', 6, 'canal', 4, 2]],
      'line-opacity': 0.75,
    } });

  /* celomestský skelet hlavných ciest (pod hexmi) */
  map.addLayer({ id: 'city-roads', type: 'line', source: 'city-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'k'], 'rail', '#3a4655',
        ['interpolate', ['linear'], ['get', 'r'], 0, '#33424f', 2, '#46596b', 4, '#5c7589']],
      'line-width': ['interpolate', ['linear'], ['zoom'],
        10, ['+', 0.4, ['*', 0.5, ['get', 'r']]],
        14, ['+', 1, ['*', 1.4, ['get', 'r']]]],
      'line-opacity': ['interpolate', ['linear'], ['get', 'r'], 0, 0.5, 4, 0.95],
    } });

  /* green */
  map.addLayer({ id: 'green', type: 'fill', source: 'green',
    paint: { 'fill-color': '#16361f', 'fill-opacity': 0.85 } });
  map.addLayer({ id: 'green-edge', type: 'line', source: 'green',
    paint: { 'line-color': '#2f6b3c', 'line-width': 0.6, 'line-opacity': 0.5 } });

  /* roads — width/opacity by rank */
  map.addLayer({ id: 'roads', type: 'line', source: 'roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'k'], 'rail', '#3a4150', '#243240'],
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['+', 0.3, ['*', 0.35, ['get', 'r']]],
        16, ['+', 1.2, ['*', 1.4, ['get', 'r']]]],
      'line-opacity': ['interpolate', ['linear'], ['get', 'r'], 0, 0.35, 4, 0.8],
    } });

  /* districts */
  map.addLayer({ id: 'districts', type: 'line', source: 'districts',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#46e0d0', 'line-width': 1.4, 'line-opacity': 0.55,
      'line-dasharray': [3, 2] } });

  /* celomestská hex mriežka dostupnosti — 3D prizmy podľa indexu */
  map.addLayer({ id: 'grid', type: 'fill-extrusion', source: 'grid',
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'idx'], ...ACCESS_RAMP],
      // vysoké prizmy z celomestského pohľadu, splošti pri priblížení nech budovy vystúpia
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'],
        11.5, ['+', 15, ['*', 1.1, ['get', 'idx']]],
        13.5, 3],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.82, 14, 0.5],
    } });
  // pri silnom priblížení skry hexy úplne, nech vládne 3D detail jadra
  map.setLayerZoomRange('grid', 0, 15.5);

  /* 3D buildings (farba sa nastaví cez setLens) */
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'buildings',
    paint: {
      'fill-extrusion-color': buildingColorExpr('access'),
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min'],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    } });

  /* slabé miesta — len budovy ≤5/7, jasná červená (default skryté) */
  map.addLayer({ id: 'buildings-weak', type: 'fill-extrusion', source: 'buildings',
    filter: ['<=', ['get', 'sc'], 5],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'sc'],
        0, '#ff2d2d', 3, '#ff5a3c', 5, '#ff8c42'],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min'],
      'fill-extrusion-opacity': 0.97,
    } });

  /* hover highlight */
  map.addLayer({ id: 'buildings-hi', type: 'fill-extrusion', source: 'buildings',
    filter: ['==', ['id'], -1],
    paint: {
      'fill-extrusion-color': '#ffffff',
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min'],
      'fill-extrusion-opacity': 0.4,
    } });

  /* vybavenosť — farebné body podľa kategórie (default skryté, pri oddialení rušia) */
  map.addLayer({ id: 'amenities', type: 'circle', source: 'amenities',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 5.5],
      'circle-color': ['match', ['get', 'cat'],
        ...Object.entries(CAT_META).flatMap(([k, v]) => [k, v.color]), '#ffffff'],
      'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(0,0,0,.55)',
      'circle-opacity': 0.92,
    } });

  applyLight('day');
  computeStats(buildings, grid);
  buildLandmarks();
  setLens('access');
  wireUI();
  setTimeout(() => document.getElementById('loader').classList.add('hide'), 350);

  // expose for screenshot tooling / debugging
  window.__app = { map, gotoStop, setMood: applyLight, setLens, showSpotAt, openLandmarkCard, LANDMARKS, TOUR };
  window.__ready = true;

  /* hover budov */
  map.on('mousemove', 'buildings', (e) => {
    map.getCanvas().style.cursor = 'crosshair';
    if (e.features.length) {
      hoveredId = e.features[0].id;
      map.setFilter('buildings-hi', ['==', ['id'], hoveredId]);
    }
  });
  map.on('mouseleave', 'buildings', () => {
    map.getCanvas().style.cursor = '';
    hoveredId = null;
    map.setFilter('buildings-hi', ['==', ['id'], -1]);
  });

  /* klik kdekoľvek → 15-min analýza odtiaľto (+ budova, ak sme ju trafili) */
  map.on('click', (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['buildings'] });
    showSpotAt(e.lngLat, hit.length ? hit[0].properties : null);
  });
});

/* zjednotené filtrovanie budov — podľa aktívnej šošovky */
function applyBuildingFilter() {
  const f = lens === 'height'
    ? ['>=', ['get', 'h'], heightMin]
    : ['>=', ['coalesce', ['get', 'idx'], 60], accessMin];
  if (map.getLayer('buildings')) map.setFilter('buildings', f);
}
/* filter bodov vybavenosti podľa aktívnych kategórií */
function applyAmenityFilter() {
  if (!map.getLayer('amenities')) return;
  map.setFilter('amenities', ['in', ['get', 'cat'], ['literal', [...activeCats]]]);
}

/* farebný výraz budov podľa šošovky */
function buildingColorExpr(which) {
  return which === 'height'
    ? ['interpolate', ['linear'], ['get', 'h'], ...HEIGHT_RAMP]
    : ['interpolate', ['linear'], ['coalesce', ['get', 'idx'], 60], ...ACCESS_RAMP];
}

/* ---------- stats (top bar) ---------- */
function computeStats(fc, grid) {
  const n = fc.features.length;
  let tallest = 0;
  for (const f of fc.features) tallest = Math.max(tallest, f.properties.h || 0);
  const cells = (grid && grid.features) || [];
  const good = cells.filter(f => (f.properties.sc || 0) >= 6).length;
  const poor = cells.filter(f => (f.properties.sc || 0) <= 3).length;
  const pctGood = cells.length ? Math.round(100 * good / cells.length) : 0;
  const pctPoor = cells.length ? Math.round(100 * poor / cells.length) : 0;
  document.getElementById('stat-buildings').innerHTML =
    `<b>${pctGood} %</b> obyt. oblastí v 15-min meste`;
  document.getElementById('stat-tallest').innerHTML =
    `<b>${pctPoor} %</b> autozávislých`;
}

/* ---------- šošovka ---------- */
function setLens(which) {
  lens = which;
  document.body.classList.toggle('lens-access', which === 'access');
  document.body.classList.toggle('lens-height', which === 'height');
  if (map.getLayer('buildings'))
    map.setPaintProperty('buildings', 'fill-extrusion-color', buildingColorExpr(which));
  document.querySelectorAll('#lens-seg button').forEach(b =>
    b.classList.toggle('active', b.dataset.lens === which));
  document.getElementById('legend-title').textContent =
    which === 'height' ? 'Výška zástavby' : 'Index dostupnosti';
  document.getElementById('legend-unit').textContent =
    which === 'height' ? 'metre' : '0 = slabá · 100 = špička';
  const st = document.getElementById('story-title');
  const tx = document.getElementById('story-text');
  if (which === 'height') {
    st.textContent = 'Vertikálny profil mesta';
    tx.innerHTML = 'Každá budova je vytlačená do výšky z reálnych dát OSM. Nízke historické jadro, '
      + 'panelová Petržalka a nové veže — tri éry mesta naraz.';
  } else {
    st.textContent = '15-minútové mesto';
    tx.innerHTML = 'Hexagóny pokrývajú <b>obytné územie celej Bratislavy</b> — výška a farba = '
      + 'koľko zo 7 denných potrieb máš pešo do 15 min. Jadro žiari, okraje sú autozávislé. '
      + '<b>Klikni kamkoľvek</b> a zisti, čo tam máš v dosahu.';
  }
  renderLegend();
  applyBuildingFilter();
}

function renderLegend() {
  const el = document.getElementById('legend');
  if (lens === 'height') {
    const ticks = [0, 15, 30, 60, 90, 130];
    el.innerHTML = `<div class="legend-bar legend-bar-h"></div>`
      + `<div class="legend-ticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="legend-bar legend-bar-a"></div>`
      + `<div class="legend-ticks"><span>slabá</span><span>dobrá</span><span>špička</span></div>`
      + `<div class="legend-cats" id="legend-cats">${CAT_ORDER.map(c => {
          const m = CAT_META[c];
          const off = activeCats.has(c) ? '' : ' off';
          return `<span class="lc${off}" data-cat="${c}"><i style="background:${m.color}"></i>${m.emoji} ${m.label}</span>`;
        }).join('')}</div>`
      + `<p class="micro">Klikni na kategóriu — skry/zobraz jej body na mape.</p>`;
    el.querySelectorAll('.lc').forEach(ch => ch.addEventListener('click', () => {
      const c = ch.dataset.cat;
      if (activeCats.has(c)) activeCats.delete(c); else activeCats.add(c);
      ch.classList.toggle('off', !activeCats.has(c));
      applyAmenityFilter();
    }));
  }
}

/* ---------- 15-min klik analýza ---------- */
function haversineM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const la1 = a[1] * toR, la2 = b[1] * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function nearestM(lngLat, cat) {
  let best = Infinity;
  for (const p of (amByCat[cat] || [])) {
    const d = haversineM(lngLat, p);
    if (d < best) best = d;
  }
  return best;
}
function showSpotAt(lngLat, bldg) {
  const ll = [lngLat.lng, lngLat.lat];
  let score = 0;
  const rows = CAT_ORDER.map(c => {
    const m = CAT_META[c];
    const d = nearestM(ll, c);
    // 80 m/min ≈ 4,8 km/h, ×1,3 detour faktor uličnej siete (vzdušná čiara je kratšia)
    const min = Math.max(1, Math.round(d * 1.3 / 80));
    const ok = d <= m.rad;
    if (ok) score++;
    return `<div class="spot-row ${ok ? 'ok' : 'no'}">
        <span class="sr-ic" style="--c:${m.color}">${m.emoji}</span>
        <span class="sr-l">${m.label}</span>
        <span class="sr-m">${min} min</span>
        <span class="sr-x">${ok ? '✓' : '✗'}</span></div>`;
  }).join('');

  document.getElementById('spot-score').textContent = score;
  document.getElementById('spot-score').parentElement.dataset.s = score;
  document.getElementById('spot-sub').textContent =
    score >= 6 ? 'kompletné 15-min miesto' : score >= 4 ? 'slušná dostupnosť' : 'slabšie obslúžené';
  document.getElementById('spot-rows').innerHTML = rows;

  const bEl = document.getElementById('spot-bldg');
  if (bldg && bldg.h) {
    const h = Math.round(bldg.h);
    bEl.hidden = false;
    bEl.innerHTML = `<span>🏢 ${bldg.name && bldg.name.length ? bldg.name : 'Budova'}</span>`
      + `<b>${h} m · ≈ ${Math.max(1, Math.round(h / 3.2))} podl.</b>`;
  } else {
    bEl.hidden = true;
  }
  document.getElementById('spot').hidden = false;
}

/* ---------- orientačné body (HTML markery) ---------- */
function buildLandmarks() {
  for (const lm of LANDMARKS) {
    const el = document.createElement('div');
    if (lm.t === 'area') {
      el.className = 'lm lm-area';
      el.textContent = lm.name;
    } else {
      el.className = 'lm lm-pin';
      el.innerHTML = `<span class="lm-dot">${lm.icon}</span><span class="lm-label">${lm.name}</span>`;
      el.title = 'Klikni pre detail';
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openLandmarkCard(lm); });
    }
    const m = new maplibregl.Marker({ element: el, anchor: lm.t === 'area' ? 'center' : 'bottom',
        offset: lm.t === 'area' ? [0, 0] : [0, 14] })   // pin nižšie, nech sa nekryje s názvami
      .setLngLat(lm.at).addTo(map);
    m._kind = lm.t;
    lmMarkers.push(m);
  }
  // pri oddialení ukáž len ikonky (názvy by sa prekrývali)
  const setZoomClass = () => document.body.classList.toggle('zoom-far', map.getZoom() < 14.2);
  setZoomClass();
  map.on('zoom', setZoomClass);
}
function showLandmarks(v) {
  document.body.classList.toggle('hide-lm', !v);
}

/* rozklikávacia karta pamiatky (foto + fakty z Wikipédie) */
let currentLm = null;
function openLandmarkCard(lm) {
  currentLm = lm;
  const info = lmInfo[lm.name] || {};
  const card = document.getElementById('lmcard');
  const photo = document.getElementById('lmcard-photo');
  if (info.img) {
    photo.style.backgroundImage = `url("${info.img}")`;
    card.classList.remove('no-photo');
  } else {
    photo.style.backgroundImage = '';
    card.classList.add('no-photo');
  }
  document.getElementById('lmcard-kicker').textContent = `${lm.icon}  Bod záujmu`;
  document.getElementById('lmcard-name').textContent = lm.name;
  document.getElementById('lmcard-meta').innerHTML =
    `${lm.year ? `<b>${lm.year}</b> · ` : ''}${lm.fact || ''}`;
  document.getElementById('lmcard-desc').textContent = info.desc || '';
  document.getElementById('lmcard-src').textContent =
    info.img ? 'Foto a text © prispievatelia Wikipédie (CC BY-SA)'
             : info.desc ? 'Text © prispievatelia Wikipédie (CC BY-SA)' : '';
  card.hidden = false;
}
function closeLandmarkCard() { document.getElementById('lmcard').hidden = true; }

/* ---------- guided tour ---------- */
const TOUR = [
  { title:'Celá Bratislava', center:[17.1150,48.1500], zoom:11.4, pitch:50, bearing:-16,
    text:'Hexagóny cez <b>obytné územie celého mesta</b> — výška a farba ukazujú 15-min dostupnosť. Zelené žiariace jadro vs nízke červené okraje: <b>každá piata oblasť je autozávislá.</b>' },
  { title:'Bratislavský hrad', focus:[17.1003,48.1419], icon:'🏰', zoom:15.6, pitch:64, bearing:24,
    text:'Hradný kopec a pod ním <b>nízke historické jadro</b> — Staré Mesto si stáročia drží drobnú mierku.' },
  { title:'Staré Mesto', focus:[17.1135,48.1445], icon:'🏛️', zoom:15.4, pitch:65, bearing:-34,
    text:'Kompaktná bloková zástavba, väčšina budov <b>4–6 podlaží</b> — mestská látka, ktorú dnes urbanisti chránia.' },
  { title:'Eurovea Tower', focus:[17.1271,48.1398], icon:'🏢', zoom:15.7, pitch:66, bearing:18,
    text:'Najvyššia budova Slovenska — <b>168 m</b>. Spolu so Sky Parkom a Nivami tvorí nové výškové ťažisko mesta.' },
  { title:'Most SNP · UFO', focus:[17.1045,48.1383], icon:'🛸', zoom:15.4, pitch:67, bearing:-46,
    text:'Dunaj ako os mesta. Na druhom brehu sa začína <b>úplne iná mierka</b> — Petržalka.' },
  { title:'Petržalka', focus:[17.1075,48.1210], icon:'🏘️', zoom:14.4, pitch:60, bearing:8,
    text:'Panelová „stena“ — jedno z <b>najhustejšie obývaných sídlisk</b> v strednej Európe. Kontrast voči jadru je tu hmatateľný.' },
];
let tourIdx = -1, tourPlaying = false, tourTimer = null;

function setFocus(stop) {
  if (focusMarker) { focusMarker.remove(); focusMarker = null; }
  if (!stop.focus) return;
  const el = document.createElement('div');
  el.className = 'lm-focus';
  el.innerHTML = `<span class="lm-focus-ring"></span><span class="lm-focus-pin">${stop.icon}</span>`
    + `<span class="lm-focus-label">${stop.title}</span>`;
  focusMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 20] })
    .setLngLat(stop.focus).addTo(map);
}

function gotoStop(i, fly = true) {
  tourIdx = (i + TOUR.length) % TOUR.length;
  const s = TOUR[tourIdx];
  document.getElementById('story-title').textContent = s.title;
  document.getElementById('tour-caption').innerHTML = s.text;
  setFocus(s);
  map[fly ? 'flyTo' : 'jumpTo']({ center: s.focus || s.center, zoom: s.zoom, pitch: s.pitch,
    bearing: s.bearing, duration: 3400, curve: 1.5, essential: true });
}
function playTour() {
  tourPlaying = true;
  document.body.classList.add('touring');   // počas auto-prehliadky stlm statické body
  const b = document.getElementById('tour-play');
  b.classList.add('playing');
  b.textContent = '⏸ Zastaviť prehliadku';
  const step = () => {
    gotoStop(tourIdx + 1);
    tourTimer = setTimeout(step, 6000);
  };
  step();
}
function stopTour() {
  tourPlaying = false;
  clearTimeout(tourTimer);
  document.body.classList.remove('touring');
  if (focusMarker) { focusMarker.remove(); focusMarker = null; }
  const b = document.getElementById('tour-play');
  b.classList.remove('playing');
  b.textContent = '▶ Spustiť prehliadku';
}

/* ---------- UI wiring ---------- */
function wireUI() {
  renderLegend();

  // šošovka
  document.querySelectorAll('#lens-seg button').forEach(b =>
    b.addEventListener('click', () => setLens(b.dataset.lens)));

  // layer toggles
  const toggle = (id, ...layers) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const v = e.target.checked ? 'visible' : 'none';
      layers.forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', v));
    });
  };
  toggle('t-grid', 'grid');
  toggle('t-buildings', 'buildings', 'buildings-hi');
  toggle('t-amenities', 'amenities');
  toggle('t-green', 'green', 'green-edge');
  toggle('t-water', 'water', 'water-edge', 'rivers');
  toggle('t-roads', 'roads', 'city-roads');
  toggle('t-districts', 'districts');

  // landmarks are DOM markers, not map layers
  document.getElementById('t-landmarks').addEventListener('change', (e) => showLandmarks(e.target.checked));

  // karta pamiatky — zatvorenie + akcia
  document.getElementById('lmcard-close').addEventListener('click', closeLandmarkCard);
  document.getElementById('lmcard-backdrop').addEventListener('click', closeLandmarkCard);
  document.getElementById('lmcard-spot').addEventListener('click', () => {
    if (!currentLm) return;
    closeLandmarkCard();
    map.flyTo({ center: currentLm.at, zoom: 15.6, pitch: 62, duration: 1600, essential: true });
    showSpotAt({ lng: currentLm.at[0], lat: currentLm.at[1] }, null);
  });

  // slabé miesta — zvýrazni budovy ≤5/7
  document.getElementById('t-weak').addEventListener('change', (e) => {
    weakOn = e.target.checked;
    map.setLayoutProperty('buildings-weak', 'visibility', weakOn ? 'visible' : 'none');
    map.setPaintProperty('buildings', 'fill-extrusion-opacity', weakOn ? 0.14 : 0.92);
  });

  // height filter (výšková šošovka)
  document.getElementById('height-filter').addEventListener('input', (e) => {
    heightMin = +e.target.value;
    document.getElementById('filter-val').textContent = heightMin;
    applyBuildingFilter();
  });
  // access filter (dostupnostná šošovka)
  document.getElementById('access-filter').addEventListener('input', (e) => {
    accessMin = +e.target.value;
    document.getElementById('afilter-val').textContent = accessMin;
    applyBuildingFilter();
  });

  // atmosphere
  document.querySelectorAll('#time-seg button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#time-seg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentMood = b.dataset.time;
      applyLight(currentMood);
    });
  });

  // tour
  document.getElementById('tour-play').addEventListener('click', () => tourPlaying ? stopTour() : playTour());
  document.getElementById('tour-next').addEventListener('click', () => { stopTour(); gotoStop(tourIdx + 1); });
  document.getElementById('tour-prev').addEventListener('click', () => { stopTour(); gotoStop(tourIdx - 1); });

  // spot close
  document.getElementById('spot-close').addEventListener('click', () =>
    document.getElementById('spot').hidden = true);

  // panel collapse
  const panel = document.getElementById('panel');
  const reveal = document.getElementById('panel-reveal');
  document.getElementById('panel-collapse').addEventListener('click', () => {
    panel.classList.add('collapsed'); reveal.classList.add('show');
  });
  reveal.addEventListener('click', () => {
    panel.classList.remove('collapsed'); reveal.classList.remove('show');
  });
}

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
/* ---- Atlas kvality života: 6 rozmerov + kompozit ---- */
const INDICATORS = [
  { id:'index',   key:'q_index',   emoji:'🎯', label:'Index kvality', desc:'Kompozitný index kvality života — vážený priemer 6 rozmerov.' },
  { id:'access',  key:'q_access',  emoji:'🕒', label:'Dostupnosť',    desc:'15-min dostupnosť 7 denných potrieb pešo.' },
  { id:'green',   key:'q_green',   emoji:'🌳', label:'Zeleň',         desc:'Zelená rovnosť — podiel a blízkosť zelene v okolí.' },
  { id:'heat',    key:'q_heat',    emoji:'🌡️', label:'Tepl. komfort', desc:'Tepelný komfort — pomer zelene/vody voči betónu (proxy ostrova).' },
  { id:'transit', key:'q_transit', emoji:'🚊', label:'MHD',           desc:'Kvalita MHD — hustota zastávok a blízkosť koľajovej dopravy.' },
  { id:'walk',    key:'q_walk',    emoji:'🚶', label:'Chodeckosť',    desc:'Chodeckosť — jemnosť uličnej siete, bariéry diaľnic.' },
  { id:'noise',   key:'q_noise',   emoji:'🔇', label:'Pokoj',         desc:'Pokoj — inverz dopravného hluku (vzdialenosť od ciest/tratí).' },
];
const META = Object.fromEntries(INDICATORS.map(i => [i.id, i]));
const WEIGHTED = ['access', 'green', 'heat', 'transit', 'walk', 'noise'];
let indicator = 'index';
let weights = Object.fromEntries(WEIGHTED.map(k => [k, 1]));

let catLens = '';           // '' = celkovo, inak kľúč kategórie (pri indikátore 'access')
let gridData = null;
let amByCat = {};           // cat -> [[lon,lat],...] pre klik-výpočet
let weakOn = false;
let activeCats = new Set(CAT_ORDER);   // ktoré kategórie vybavenosti sa zobrazujú

/* ---- orientačné body: pin = známe miesto, area = názov štvrte ---- */
const LANDMARKS = [
  { t:'pin', icon:'🏰', name:'Bratislavský hrad', at:[17.1003,48.1419], year:'9. stor. / obnova 1968', fact:'Dominanta nad Dunajom, dnes sídlo expozícií SNM.' },
  { t:'pin', icon:'🛸', name:'Most SNP · UFO', at:[17.1045,48.1383], year:'1972', fact:'Most s vyhliadkou UFO — jediný slovenský člen Svetovej federácie veží.' },
  { t:'pin', icon:'⛪', name:'Modrý kostolík', at:[17.1170,48.1437], year:'1913', fact:'Secesný skvost architekta Ödöna Lechnera.' },
  { t:'pin', icon:'🏛️', name:'Prezidentský palác', at:[17.1106,48.1486], year:'1760', fact:'Grasalkovičov palác — sídlo prezidenta SR, za ním Francúzska záhrada.' },
  { t:'pin', icon:'🏛️', name:'Úrad vlády SR', at:[17.1056,48.1487], year:'1761', fact:'Letný arcibiskupský palác na Námestí slobody.' },
  { t:'pin', icon:'⚖️', name:'Národná rada SR', at:[17.0985,48.1394], year:'1994', fact:'Parlament na hradnom kopci.' },
  { t:'pin', icon:'🏛️', name:'Stará radnica', at:[17.1085,48.1432], year:'14. stor.', fact:'Najstaršia radnica na Slovensku, dnes mestské múzeum.' },
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
  const [cityRoads, landGreen, landUse] = await Promise.all([
    loadJSON('city_roads.geojson'), loadJSON('land_green.geojson'), loadJSON('land_use.geojson'),
  ]);
  buildingsData = buildings;
  lmInfo = info && !info.features ? info : {};
  for (const c of CAT_ORDER) amByCat[c] = [];
  for (const f of amenities.features) {
    const c = f.properties.cat;
    if (amByCat[c]) amByCat[c].push(f.geometry.coordinates);
  }

  map.addSource('land-green', { type: 'geojson', data: landGreen });
  map.addSource('land-use', { type: 'geojson', data: landUse });
  map.addSource('water', { type: 'geojson', data: water });
  map.addSource('rivers', { type: 'geojson', data: rivers });
  map.addSource('green', { type: 'geojson', data: green });
  map.addSource('city-roads', { type: 'geojson', data: cityRoads });
  map.addSource('roads', { type: 'geojson', data: roads });
  map.addSource('districts', { type: 'geojson', data: districts });
  map.addSource('amenities', { type: 'geojson', data: amenities });
  map.addSource('grid', { type: 'geojson', data: grid });
  map.addSource('buildings', { type: 'geojson', data: buildings, generateId: true });

  /* celomestský terén — vyplní 'čierno okolo' (lesy, parky, plochy) */
  map.addLayer({ id: 'land-use', type: 'fill', source: 'land-use',
    paint: { 'fill-color': '#1a212b', 'fill-opacity': 0.8 } });
  map.addLayer({ id: 'land-green', type: 'fill', source: 'land-green',
    paint: { 'fill-color': '#1c4028', 'fill-opacity': 0.95 } });

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

  gridData = grid;
  applyLight('day');
  computeStats(buildings, grid);
  buildLandmarks();
  buildIndSel();
  buildWeights();
  buildCatLens();
  setIndicator('index');
  buildFindings(grid);
  wireUI();
  setTimeout(() => document.getElementById('loader').classList.add('hide'), 350);
  showIntro(grid);

  // klik na hex/budovu = pointer
  map.on('mouseenter', 'grid', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'grid', () => map.getCanvas().style.cursor = '');

  // expose for screenshot tooling / debugging
  window.__app = { map, gotoStop, setMood: applyLight, setIndicator, setCatLens, setWeights, showSpotAt, openLandmarkCard, LANDMARKS, INDICATORS, TOUR };
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

  /* klik kdekoľvek → 15-min analýza + rozbor hexa (atlas) */
  map.on('click', (e) => {
    const b = map.queryRenderedFeatures(e.point, { layers: ['buildings'] });
    const g = map.queryRenderedFeatures(e.point, { layers: ['grid'] });
    showSpotAt(e.lngLat, b.length ? b[0].properties : null, g.length ? g[0].properties : null);
  });
});

/* filter bodov vybavenosti podľa aktívnych kategórií */
function applyAmenityFilter() {
  if (!map.getLayer('amenities')) return;
  map.setFilter('amenities', ['in', ['get', 'cat'], ['literal', [...activeCats]]]);
}
function buildingColorExpr() {
  return ['interpolate', ['linear'], ['coalesce', ['get', 'idx'], 60], ...ACCESS_RAMP];
}

/* ---------- Atlas: výber indikátora ---------- */
const MIN_RAMP_ATLAS = [0, '#34c47a', 4, '#8ec85a', 7, '#d8c84a', 10, '#e6a13c', 13, '#e0603b', 18, '#c0392b'];
function gridColorExpr() {
  if (indicator === 'access' && catLens)
    return ['interpolate', ['linear'], ['coalesce', ['get', 'm_' + catLens], 30], ...MIN_RAMP_ATLAS];
  return ['interpolate', ['linear'], ['coalesce', ['get', META[indicator].key], 50], ...ACCESS_RAMP];
}
function applyGridColor() {
  if (map.getLayer('grid')) map.setPaintProperty('grid', 'fill-extrusion-color', gridColorExpr());
  // výška hexa = hodnota zvoleného indikátora (krajina kvality)
  if (map.getLayer('grid'))
    map.setPaintProperty('grid', 'fill-extrusion-height', ['interpolate', ['linear'], ['zoom'],
      11.5, ['+', 15, ['*', 1.1, ['coalesce', ['get', META[indicator].key], 50]]],
      13.5, 3]);
}

function buildIndSel() {
  const wrap = document.getElementById('indsel');
  wrap.innerHTML = INDICATORS.map(i =>
    `<button data-ind="${i.id}" title="${i.label}"><span>${i.emoji}</span>${i.label}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setIndicator(b.dataset.ind)));
}
function setIndicator(id) {
  indicator = id;
  if (id !== 'access') catLens = '';
  document.querySelectorAll('#indsel button').forEach(b => b.classList.toggle('active', b.dataset.ind === id));
  document.getElementById('ind-desc').textContent = META[id].desc;
  document.getElementById('block-weights').hidden = (id !== 'index');
  document.getElementById('block-catlens').hidden = (id !== 'access');
  document.getElementById('legend-title').textContent = id === 'index' ? 'Index kvality miesta' : META[id].label;
  applyGridColor();
  applyWeak();
  renderLegend();
  // story
  document.getElementById('story-title').textContent = id === 'index' ? 'Atlas kvality života' : META[id].label;
  document.getElementById('story-text').innerHTML = META[id].desc
    + (id === 'index' ? ' <b>Hýb váhami</b> nižšie a mesto sa prepočíta.' : ' <b>Klikni na hex</b> pre rozbor.');
}

/* ---------- váhy kompozitu ---------- */
function buildWeights() {
  const wrap = document.getElementById('weights');
  wrap.innerHTML = WEIGHTED.map(k => {
    const m = META[k];
    return `<div class="wrow"><span class="wl">${m.emoji} ${m.label}</span>`
      + `<input type="range" class="wsl" data-k="${k}" min="0" max="3" step="1" value="1">`
      + `<span class="wv" id="wv-${k}">1×</span></div>`;
  }).join('');
  wrap.querySelectorAll('.wsl').forEach(s => s.addEventListener('input', () => {
    weights[s.dataset.k] = +s.value;
    document.getElementById('wv-' + s.dataset.k).textContent = s.value + '×';
    recomputeIndex();
  }));
}
function setWeights(obj) {            // pre testovanie / presety
  Object.assign(weights, obj);
  WEIGHTED.forEach(k => { const s = document.querySelector(`.wsl[data-k="${k}"]`); if (s) { s.value = weights[k]; document.getElementById('wv-' + k).textContent = weights[k] + '×'; } });
  recomputeIndex();
}
function recomputeIndex() {
  if (!gridData) return;
  const tot = WEIGHTED.reduce((s, k) => s + weights[k], 0) || 1;
  for (const f of gridData.features) {
    let v = 0;
    for (const k of WEIGHTED) v += weights[k] * (f.properties[META[k].key] || 0);
    f.properties.q_index = Math.round(v / tot * 10) / 10;
  }
  const src = map.getSource('grid');
  if (src) src.setData(gridData);
  if (indicator === 'index') { applyGridColor(); buildFindings(gridData); }
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

/* ---------- zvýrazni najhoršie oblasti (filter gridu) ---------- */
function applyWeak() {
  if (!map.getLayer('grid')) return;
  if (weakOn) {
    const key = indicator === 'access' && catLens ? null : META[indicator].key;
    map.setFilter('grid', key ? ['<=', ['coalesce', ['get', key], 50], 45] : null);
  } else {
    map.setFilter('grid', null);
  }
}

function renderLegend() {
  const el = document.getElementById('legend');
  document.getElementById('legend-unit').textContent =
    (indicator === 'access' && catLens) ? 'minúty pešo' : '0 = slabá · 100 = špička';
  if (indicator === 'access' && catLens) {
    el.innerHTML = `<div class="legend-bar legend-bar-m"></div>`
      + `<div class="legend-ticks"><span>0 min</span><span>9</span><span>18+ min</span></div>`
      + `<p class="micro hexnote">⬢ Hexagón = obytná oblasť. Farba = čas pešo k najbližšej ${CAT_META[catLens].label.toLowerCase()}.</p>`;
    return;
  }
  let note = `⬢ Každý <b>hexagón = obytná oblasť</b> (~200 m). Výška a farba = <b>${(indicator === 'index' ? 'index kvality' : META[indicator].label.toLowerCase())}</b>. <b>Klikni naň</b> pre rozbor.`;
  el.innerHTML = `<div class="legend-bar legend-bar-a"></div>`
    + `<div class="legend-ticks"><span>slabá</span><span>dobrá</span><span>špička</span></div>`
    + `<p class="micro hexnote">${note}</p>`;
  if (indicator === 'access') {
    el.innerHTML += `<div class="legend-cats" id="legend-cats">${CAT_ORDER.map(c => {
        const m = CAT_META[c];
        const off = activeCats.has(c) ? '' : ' off';
        return `<span class="lc${off}" data-cat="${c}"><i style="background:${m.color}"></i>${m.emoji} ${m.label}</span>`;
      }).join('')}</div><p class="micro">Klikni na kategóriu — skry/zobraz jej body na mape.</p>`;
    el.querySelectorAll('.lc').forEach(ch => ch.addEventListener('click', () => {
      const c = ch.dataset.cat;
      if (activeCats.has(c)) activeCats.delete(c); else activeCats.add(c);
      ch.classList.toggle('off', !activeCats.has(c));
      applyAmenityFilter();
    }));
  }
}

/* ---------- onboarding ---------- */
function showIntro(grid) {
  const cells = (grid && grid.features) || [];
  const good = cells.filter(f => (f.properties.sc || 0) >= 6).length;
  const poor = cells.filter(f => (f.properties.sc || 0) <= 3).length;
  if (cells.length) {
    document.getElementById('intro-good').textContent = Math.round(100 * good / cells.length) + ' %';
    document.getElementById('intro-poor').textContent = Math.round(100 * poor / cells.length) + ' %';
  }
  document.getElementById('intro').hidden = false;
}

/* ---------- šošovka po kategórii (pri indikátore Dostupnosť) ---------- */
function buildCatLens() {
  const wrap = document.getElementById('catlens');
  wrap.innerHTML = '<button data-cat="" class="active">Celkovo</button>'
    + CAT_ORDER.map(c => `<button data-cat="${c}" title="${CAT_META[c].label}">${CAT_META[c].emoji}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setCatLens(b.dataset.cat)));
}
function setCatLens(cat) {
  catLens = cat;
  document.querySelectorAll('#catlens button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  applyGridColor();
  const hint = document.getElementById('catlens-hint');
  hint.innerHTML = cat
    ? `Farba hexa = <b>minúty pešo k najbližšej (${CAT_META[cat].label.toLowerCase()})</b>. Zelená blízko, červená ďaleko — <b>mapa „kde chýba ${CAT_META[cat].label.toLowerCase()}".</b>`
    : 'Vyber potrebu a uvidíš, <b>kde k nej ľudia majú ďaleko</b>.';
  renderLegend();
}

/* ---------- zistenia (atlas: 6 rozmerov + kompozit) ---------- */
function ACCESS_COLOR(v) {       // farba podľa skóre 0–100
  return v >= 80 ? '#34c47a' : v >= 65 ? '#8ec85a' : v >= 50 ? '#d8c84a' : v >= 38 ? '#e6a13c' : '#e0603b';
}
function buildFindings(grid) {
  const cells = (grid && grid.features) || [];
  if (!cells.length) return;
  const n = cells.length;
  const mean = k => cells.reduce((s, f) => s + (f.properties[k] || 0), 0) / n;
  const dims = WEIGHTED.map(id => ({ id, m: mean(META[id].key) }));
  dims.sort((a, b) => a.m - b.m);
  const worst = dims[0], best = dims[dims.length - 1];
  const idxMean = Math.round(mean('q_index'));

  const bars = WEIGHTED.map(id => {
    const v = Math.round(mean(META[id].key));
    return `<div class="fbar"><span class="fb-l">${META[id].emoji} ${META[id].label}</span>`
      + `<span class="fb-track"><i style="width:${v}%;background:${ACCESS_COLOR(v)}"></i></span>`
      + `<span class="fb-v">${v}</span></div>`;
  }).join('');

  document.getElementById('findings').innerHTML =
    `<div class="fcard"><b>Index kvality miesta ⌀ ${idxMean}/100</b> naprieč obytnou Bratislavou.</div>`
    + `<div class="fcard warn">Najslabší rozmer mesta: <b>${META[worst.id].label.toLowerCase()}</b> `
    + `(⌀ ${Math.round(worst.m)}/100). Najsilnejší: <b>${META[best.id].label.toLowerCase()}</b> (⌀ ${Math.round(best.m)}).</div>`
    + `<div class="fbars-title">Priemerné skóre rozmerov (0–100):</div>`
    + `<div class="fbars">${bars}</div>`;
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
function showSpotAt(lngLat, bldg, hex) {
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
  let html = '';
  if (hex && hex.q_index != null) {
    html += `<div class="spot-atlas"><div class="sa-head"><span>Index kvality tu</span><b>${Math.round(hex.q_index)}/100</b></div>`
      + WEIGHTED.map(id => {
          const v = Math.round(hex[META[id].key] || 0);
          return `<div class="sa-row"><span>${META[id].emoji} ${META[id].label}</span>`
            + `<span class="sa-track"><i style="width:${v}%;background:${ACCESS_COLOR(v)}"></i></span>`
            + `<span class="sa-v">${v}</span></div>`;
        }).join('') + `</div>`;
  }
  if (bldg && bldg.h) {
    const h = Math.round(bldg.h);
    html += `<div class="spot-brow"><span>🏢 ${bldg.name && bldg.name.length ? bldg.name : 'Budova'}</span>`
      + `<b>${h} m · ≈ ${Math.max(1, Math.round(h / 3.2))} podl.</b></div>`;
  }
  bEl.hidden = !html;
  bEl.innerHTML = html;
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

  // reset váh
  document.getElementById('weights-reset').addEventListener('click', () =>
    setWeights(Object.fromEntries(WEIGHTED.map(k => [k, 1]))));

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

  // onboarding
  const intro = document.getElementById('intro');
  document.getElementById('intro-explore').addEventListener('click', () => intro.hidden = true);
  document.getElementById('intro-tour').addEventListener('click', () => { intro.hidden = true; playTour(); });

  // karta pamiatky — zatvorenie + akcia
  document.getElementById('lmcard-close').addEventListener('click', closeLandmarkCard);
  document.getElementById('lmcard-backdrop').addEventListener('click', closeLandmarkCard);
  document.getElementById('lmcard-spot').addEventListener('click', () => {
    if (!currentLm) return;
    closeLandmarkCard();
    map.flyTo({ center: currentLm.at, zoom: 15.6, pitch: 62, duration: 1600, essential: true });
    showSpotAt({ lng: currentLm.at[0], lat: currentLm.at[1] }, null);
  });

  // zvýrazni najhoršie oblasti (filter gridu podľa zvoleného rozmeru)
  document.getElementById('t-weak').addEventListener('change', (e) => {
    weakOn = e.target.checked;
    applyWeak();
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

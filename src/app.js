/* Bratislava 3D — atlas mesta z otvorených dát
   Pure-data "architektonický model": žiadna externá mapová podložka, len OSM geodáta
   vykreslené cez MapLibre GL JS (API-kompatibilné s Mapbox GL JS). */

const DATA = (f) => `data/${f}`;

/* ---- height → color ramp (metre) ---- */
const HEIGHT_RAMP = [
  0, '#21303a', 8, '#27606b', 15, '#2f8f8a', 25, '#46e0d0',
  40, '#bfe27a', 60, '#ffc24b', 90, '#ff7a45', 130, '#ff4d4d',
];
/* ---- kvalita 0–100 → moderná percepčne čistá sekvenčná škála ----
   Tmavá indigo (slabá) → fialová → korálová → jantár → limetka → akvamarín (špička).
   Inšpirované magma/viridis: žiadne blatisté stredné tóny, každý stupeň jasne odlíšiteľný,
   a poradie funguje aj pri čiastočnej farbosleposti (svetlosť rastie monotónne so skóre). */
const ACCESS_RAMP = [
  22, '#3a1d52', 32, '#7a2a6e', 42, '#b83a63', 50, '#e35a54',
  58, '#f57c3d', 66, '#f7a83b', 74, '#d7df58', 84, '#37e0b0',
];
/* zoradené stopy (pre legendu / CSS gradient) */
const ACCESS_STOPS = ['#3a1d52','#7a2a6e','#b83a63','#e35a54','#f57c3d','#f7a83b','#d7df58','#37e0b0'];
/* ---- kategórie dennej vybavenosti (poradie = riadky v karte) ---- */
const CAT_META = {
  obchod:  { emoji:'🛒', label:'Obchod',   acc:'obchod',   color:'#5dade2', rad:700  },
  zastavka:{ emoji:'🚏', label:'Zastávka', acc:'zastávku', color:'#58d68d', rad:400  },
  lekaren: { emoji:'💊', label:'Lekáreň',  acc:'lekáreň',  color:'#bb8fce', rad:700  },
  lekar:   { emoji:'🩺', label:'Lekár',    acc:'lekára',   color:'#ec7063', rad:1000 },
  skola:   { emoji:'🏫', label:'Škola',    acc:'školu',    color:'#f4d03f', rad:1000 },
  skolka:  { emoji:'🧸', label:'Škôlka',   acc:'škôlku',   color:'#f5b041', rad:800  },
  park:    { emoji:'🌳', label:'Park',     acc:'park',     color:'#45b39d', rad:500  },
};
const CAT_ORDER = ['obchod','zastavka','lekaren','lekar','skola','skolka','park'];
/* ---- Atlas kvality života: 6 rozmerov + kompozit ---- */
const INDICATORS = [
  { id:'index',   key:'q_index',   emoji:'🎯', label:'Index kvality', desc:'Kompozitný index kvality života — vážený priemer 6 rozmerov.' },
  { id:'access',  key:'q_access',  emoji:'🕒', label:'Dostupnosť',    desc:'15-min dostupnosť 7 denných potrieb pešo.' },
  { id:'green',   key:'q_green',   emoji:'🌳', label:'Zeleň',         desc:'Zelená rovnosť — podiel a blízkosť zelene v okolí.' },
  { id:'heat',    key:'q_heat',    emoji:'🌡️', label:'Tepl. komfort', desc:'Tepelný komfort — pomer zelene/vody voči betónu (proxy ostrova).' },
  { id:'transit', key:'q_transit', emoji:'🚊', label:'MHD',           desc:'Kvalita MHD — reálne frekvencie zastávok z GTFS DPB (481 tis. spojov/deň).' },
  { id:'walk',    key:'q_walk',    emoji:'🚶', label:'Pre chodcov',    desc:'Ako dobre sa tu chodí pešo — hustá a jemná sieť ulíc, málo bariér (diaľnic).' },
  { id:'noise',   key:'q_noise',   emoji:'🔇', label:'Pokoj',         desc:'Pokoj — inverz dopravného hluku (vzdialenosť od ciest/tratí).' },
];
const META = Object.fromEntries(INDICATORS.map(i => [i.id, i]));
const WEIGHTED = ['access', 'green', 'heat', 'transit', 'walk', 'noise'];
/* porovnanie miest — rovnaká 15-min metóda, ~10 km okno (z workflow) */
const CITIES = [
  { city:'Viedeň',     good:70.4, mean:5.65 },
  { city:'Praha',      good:69.8, mean:5.73 },
  { city:'Budapešť',   good:59.9, mean:5.29 },
  { city:'Bratislava', good:56.1, mean:5.02, me:true },
  { city:'Brno',       good:33.9, mean:3.66 },
];
let indicator = 'index';
let weights = Object.fromEntries(WEIGHTED.map(k => [k, 1]));

const CITY_LIST = [
  { slug:'bratislava', name:'Bratislava' }, { slug:'vieden', name:'Viedeň' },
  { slug:'praha', name:'Praha' }, { slug:'brno', name:'Brno' }, { slug:'budapest', name:'Budapešť' },
];
let currentCity = 'bratislava', baGrid = null, cityMode = false;
let catLens = '';           // '' = celkovo, inak kľúč kategórie (pri indikátore 'access')
let gridData = null;
let amByCat = {};           // cat -> [[lon,lat],...] pre klik-výpočet
let weakOn = false;
let activeCats = new Set(CAT_ORDER);   // ktoré kategórie vybavenosti sa zobrazujú

/* ---- plánovacie pieskovisko ---- */
let plannerOn = false;
let placeType = 'obchod';
let placed = [];            // {cat, ll, marker}
let hexCentroids = [];      // [lon,lat] na hex (poradie features)
let baselineM = [];         // snapshot m_<cat> na reset

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
  zoom: 11.4, pitch: 28, bearing: -14,
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

  /* celomestská hex mriežka kvality — PLOCHÝ 2D choropleth (žiadne prekrývanie prizmov).
     Čistá farebná plocha + jemný okraj medzi hexmi = každá bunka je zreteľne oddelená.
     3D detail v jadre zabezpečia budovy, nie hexy. */
  map.addLayer({ id: 'grid', type: 'fill', source: 'grid',
    paint: {
      'fill-color': ['interpolate', ['linear'], ['get', 'idx'], ...ACCESS_RAMP],
      // plné a sýte z celomestského pohľadu; pri priblížení do jadra zľahka ustúpi budovám
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 14, 0.7, 15.4, 0.42],
    } });
  /* tenký okraj medzi hexmi — odsadenie, aby splývajúce plochy neboli „farba cez farbu" */
  map.addLayer({ id: 'grid-edge', type: 'line', source: 'grid',
    paint: {
      'line-color': 'rgba(8,11,16,.55)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13, 1.1, 15, 1.6],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15.4, 0.3],
    } });
  // pri silnom priblížení skry hexy úplne, nech vládne 3D detail jadra
  map.setLayerZoomRange('grid', 0, 15.6);
  map.setLayerZoomRange('grid-edge', 0, 15.6);

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
  baGrid = grid;
  initAtlasRuntime();
  applyLight('day');
  computeStats(buildings, grid);
  buildLandmarks();
  buildIndSel();
  buildWeights();
  buildCatLens();
  buildPlanner();
  setIndicator('index');
  buildFindings(grid);
  buildCities();
  buildCitySeg();
  wireUI();
  wireAsk();
  setTimeout(() => document.getElementById('loader').classList.add('hide'), 350);
  showIntro(grid);

  // klik na hex/budovu = pointer
  map.on('mouseenter', 'grid', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'grid', () => map.getCanvas().style.cursor = '');

  // expose for screenshot tooling / debugging
  window.__app = { map, gotoStop, setMood: applyLight, setIndicator, setCatLens, setWeights, showSpotAt, openLandmarkCard, addFacility, runOptimizer, setPlanner: (v) => { document.getElementById('t-planner').checked = v; document.getElementById('t-planner').dispatchEvent(new Event('change')); }, LANDMARKS, INDICATORS, CAT_ORDER, TOUR };
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

  /* klik kdekoľvek → 15-min analýza + rozbor hexa (atlas), alebo postav (plánovač) */
  map.on('click', (e) => {
    if (plannerOn) { addFacility(placeType, [e.lngLat.lng, e.lngLat.lat]); return; }
    const g = map.queryRenderedFeatures(e.point, { layers: ['grid'] });
    if (cityMode) { if (g.length) showCityHex(g[0].properties); return; }
    const b = map.queryRenderedFeatures(e.point, { layers: ['buildings'] });
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
/* minúty pešo: 0 = výborne (akvamarín) → 18+ = ďaleko (tmavá indigo). Inverz hlavnej škály. */
const MIN_RAMP_ATLAS = [0, '#37e0b0', 4, '#d7df58', 7, '#f7a83b', 10, '#f57c3d', 13, '#b83a63', 18, '#3a1d52'];
function gridColorExpr() {
  if (indicator === 'access' && catLens)
    return ['interpolate', ['linear'], ['coalesce', ['get', 'm_' + catLens], 30], ...MIN_RAMP_ATLAS];
  return ['interpolate', ['linear'], ['coalesce', ['get', META[indicator].key], 50], ...ACCESS_RAMP];
}
function applyGridColor() {
  if (map.getLayer('grid')) map.setPaintProperty('grid', 'fill-color', gridColorExpr());
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
    `<b>${pctGood} %</b> oblastí má všetko do 15 min`;
  document.getElementById('stat-tallest').innerHTML =
    `<b>${pctPoor} %</b> odkázaných na auto`;
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
function ACCESS_COLOR(v) {       // farba podľa skóre 0–100 (harmonizované s mapovou škálou)
  return v >= 84 ? '#37e0b0' : v >= 74 ? '#d7df58' : v >= 66 ? '#f7a83b'
       : v >= 58 ? '#f57c3d' : v >= 50 ? '#e35a54' : v >= 42 ? '#b83a63'
       : v >= 32 ? '#7a2a6e' : '#3a1d52';
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
  document.querySelector('.spot-title').textContent = 'do 15 minút pešo';
  document.querySelector('.spot-score span').textContent = '/7';
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

/* ---------- prepínač miest (platforma) ---------- */
function buildCitySeg() {
  const el = document.getElementById('cityseg');
  el.innerHTML = CITY_LIST.map(c => `<button data-slug="${c.slug}"${c.slug === 'bratislava' ? ' class="active"' : ''}>${c.name}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => switchCity(b.dataset.slug)));
  document.getElementById('city-mode-hint').textContent = 'plný režim';
}
async function switchCity(slug) {
  if (slug === currentCity) return;
  document.querySelectorAll('#cityseg button').forEach(b => { b.classList.toggle('active', b.dataset.slug === slug); });
  const hint = document.getElementById('city-mode-hint');
  if (slug === 'bratislava') {
    cityMode = false; document.body.classList.remove('city-mode');
    gridData = baGrid; hexCentroids = baGrid.features.map(hexCentroid);
    map.getSource('grid').setData(baGrid);
    map.flyTo({ center: [17.115, 48.15], zoom: 11.4, pitch: 28, bearing: -14, duration: 1500, essential: true });
    hint.textContent = 'plný režim';
  } else {
    hint.textContent = 'načítavam…';
    const fc = await loadJSON('cities/' + slug + '.json');
    if (!fc.features || !fc.features.length) { hint.textContent = 'dáta chýbajú'; return; }
    cityMode = true; document.body.classList.add('city-mode');
    if (plannerOn) { const t = document.getElementById('t-planner'); t.checked = false; t.dispatchEvent(new Event('change')); }
    ['air', 'air-glow'].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', 'none'));
    document.getElementById('t-air').checked = false;
    showLandmarks(false);
    gridData = fc; hexCentroids = fc.features.map(hexCentroid);
    map.getSource('grid').setData(fc);
    const c = (fc.meta && fc.meta.center) || [17.11, 48.15];
    map.flyTo({ center: c, zoom: 11.1, pitch: 28, bearing: -14, duration: 1500, essential: true });
    hint.textContent = 'atlas (zjednodušený)';
  }
  currentCity = slug;
  weakOn = false; document.getElementById('t-weak').checked = false;
  if (catLens) catLens = '';
  setIndicator('index');
  computeStats(gridData, gridData);
  buildFindings(gridData);
  document.getElementById('spot').hidden = true;
  // titulok až po setIndicator (ten ho prepisuje)
  document.getElementById('story-title').textContent =
    slug === 'bratislava' ? 'Atlas kvality života' : 'Atlas: ' + ((gridData.meta && gridData.meta.name) || slug);
}
function showCityHex(p) {
  document.querySelector('.spot-title').textContent = 'Kvalita tu';
  document.querySelector('.spot-score span').textContent = '/100';
  const sc = document.getElementById('spot-score');
  sc.textContent = Math.round(p.q_index); sc.parentElement.dataset.s = '';
  document.getElementById('spot-sub').textContent = 'index kvality miesta';
  document.getElementById('spot-rows').innerHTML = '';
  const bEl = document.getElementById('spot-bldg'); bEl.hidden = false;
  bEl.innerHTML = '<div class="spot-atlas">' + WEIGHTED.map(id => {
    const v = Math.round(p[META[id].key] || 0);
    return `<div class="sa-row"><span>${META[id].emoji} ${META[id].label}</span>`
      + `<span class="sa-track"><i style="width:${v}%;background:${ACCESS_COLOR(v)}"></i></span><span class="sa-v">${v}</span></div>`;
  }).join('') + '</div>';
  document.getElementById('spot').hidden = false;
}

/* ---------- porovnanie miest ---------- */
function buildCities() {
  const el = document.getElementById('cities');
  if (!el) return;
  const max = Math.max(...CITIES.map(c => c.good));
  el.innerHTML = CITIES.map(c => {
    const w = Math.round(100 * c.good / max);
    return `<div class="crow${c.me ? ' me' : ''}">`
      + `<span class="cc-l">${c.city}</span>`
      + `<span class="cc-track"><i style="width:${w}%"></i></span>`
      + `<span class="cc-v">${c.good.toFixed(0)} %</span></div>`;
  }).join('');
}

/* ========== AI asistent „Spýtaj sa mesta" ========== */
const ASK_MODEL = 'claude-haiku-4-5-20251001';
const ASK_SYSTEM = `Si asistent mestského Atlasu kvality života Bratislavy. Máš dáta o 350 obytných oblastiach (hexoch), každá so skóre 0–100 v 6 rozmeroch: dostupnosť (15-min), zeleň, tepelný komfort, MHD, chodci, pokoj; + kompozitný index kvality; + populácia na oblasť; + porovnanie s Viedňou/Prahou/Brnom/Budapešťou. Keď sa používateľ pýta, ZAVOLAJ vhodný nástroj a potom stručne (1–3 vety) po slovensky interpretuj výsledok. Buď konkrétny, používaj čísla. Ak otázka nesúvisí s mestom/dátami, slušne to povedz.`;

function nearestLandmarkName(ll) {
  let best = '', bd = Infinity;
  for (const lm of LANDMARKS) {
    if (lm.t !== 'pin') continue;
    const d = haversineM(ll, lm.at);
    if (d < bd) { bd = d; best = lm.name; }
  }
  return best;
}
function gMean(key) {
  const fs = gridData.features;
  return fs.reduce((s, f) => s + (f.properties[key] || 0), 0) / fs.length;
}
function topHexes(key, order, n) {
  const fs = gridData.features.map((f, i) => ({ i, v: f.properties[key] || 0, c: hexCentroids[i] }));
  fs.sort((a, b) => order === 'top' ? b.v - a.v : a.v - b.v);
  return fs.slice(0, n);
}

const ASK_TOOLS = {
  prehlad_kvality: {
    desc: 'Celkový prehľad kvality života: priemerné skóre 6 rozmerov, najslabší a najsilnejší rozmer.',
    schema: { type: 'object', properties: {} },
    run() {
      const dims = WEIGHTED.map(id => ({ id, m: gMean(META[id].key) })).sort((a, b) => a.m - b.m);
      const w = dims[0], b = dims[dims.length - 1];
      return { text: `Priemerný index kvality je ${Math.round(gMean('q_index'))}/100. Najsilnejší rozmer mesta je ${META[b.id].label.toLowerCase()} (⌀ ${Math.round(b.m)}), najslabší ${META[w.id].label.toLowerCase()} (⌀ ${Math.round(w.m)}).`,
        effect: { indicator: w.id } };
    },
  },
  kde_chyba: {
    desc: 'Kde v meste majú ľudia najhoršiu pešiu dostupnosť konkrétnej dennej potreby.',
    schema: { type: 'object', properties: { kategoria: { type: 'string', enum: CAT_ORDER, description: 'obchod|zastavka|lekaren|lekar|skola|skolka|park' } }, required: ['kategoria'] },
    run({ kategoria }) {
      const c = CAT_ORDER.includes(kategoria) ? kategoria : 'lekar';
      const worst = topHexes('m_' + c, 'top', 3).map(h => nearestLandmarkName(h.c));
      const budget = CAT_BUDGET[c];
      const share = Math.round(100 * gridData.features.filter(f => (f.properties['m_' + c] ?? 99) <= budget).length / gridData.features.length);
      return { text: `Najhoršiu dostupnosť (${CAT_META[c].label}) majú oblasti pri: ${[...new Set(worst)].join(', ')}. Túto potrebu má do 15 min pešo len ${share} % obytných oblastí.`,
        effect: { catLens: c } };
    },
  },
  rebricek_oblasti: {
    desc: 'Najlepšie alebo najhoršie oblasti podľa zvoleného rozmeru kvality.',
    schema: { type: 'object', properties: {
      rozmer: { type: 'string', enum: ['index', ...WEIGHTED] },
      poradie: { type: 'string', enum: ['najlepsie', 'najhorsie'] } }, required: ['rozmer', 'poradie'] },
    run({ rozmer, poradie }) {
      const id = (rozmer === 'index' || WEIGHTED.includes(rozmer)) ? rozmer : 'index';
      const key = id === 'index' ? 'q_index' : META[id].key;
      const order = poradie === 'najlepsie' ? 'top' : 'bottom';
      const hx = topHexes(key, order, 3);
      const names = [...new Set(hx.map(h => nearestLandmarkName(h.c)))];
      const lbl = id === 'index' ? 'index kvality' : META[id].label.toLowerCase();
      return { text: `${poradie === 'najlepsie' ? 'Najlepšie' : 'Najhoršie'} oblasti podľa ${lbl}: ${names.join(', ')} (skóre ${Math.round(hx[0].v)}–${Math.round(hx[hx.length-1].v)}).`,
        effect: { indicator: id, flyTo: [hx[0].c[0], hx[0].c[1], 13] } };
    },
  },
  porovnanie_miest: {
    desc: 'Porovnanie Bratislavy s Viedňou, Prahou, Brnom a Budapešťou (% oblastí v 15-min meste).',
    schema: { type: 'object', properties: {} },
    run() {
      const r = CITIES.map(c => `${c.city} ${c.good.toFixed(0)} %`).join(', ');
      return { text: `Podiel obytných oblastí s 6+/7 potrebami do 15 min: ${r}. Bratislava (56 %) je 4. z 5 — za Viedňou, Prahou aj Budapešťou, no pred Brnom.`, effect: null };
    },
  },
  najlepsie_miesto: {
    desc: 'Kam postaviť novú vybavenosť, aby získala dostupnosť pre najviac obyvateľov.',
    schema: { type: 'object', properties: { kategoria: { type: 'string', enum: CAT_ORDER } }, required: ['kategoria'] },
    run({ kategoria }) {
      const c = CAT_ORDER.includes(kategoria) ? kategoria : 'skolka';
      const budget = CAT_BUDGET[c];
      let best = null, gain = -1;
      for (let k = 0; k < hexCentroids.length; k++) {
        if ((gridData.features[k].properties.pop || 0) === 0) continue;
        let g = 0;
        for (let i = 0; i < gridData.features.length; i++) {
          const p = gridData.features[i].properties;
          if ((p.pop || 0) === 0 || (p['m_' + c] ?? 30) <= budget) continue;
          if (Math.round(haversineM(hexCentroids[i], hexCentroids[k]) * 1.3 / 80) <= budget) g += p.pop;
        }
        if (g > gain) { gain = g; best = hexCentroids[k]; }
      }
      return { text: `Najlepšie miesto pre ${CAT_META[c].acc} je pri ${nearestLandmarkName(best)} — dostupnosť by vďaka tomu získalo ~${gain.toLocaleString('sk')} obyvateľov.`,
        effect: { optimize: c } };
    },
  },
};

function applyAskEffect(e) {
  if (!e) return;
  if (e.indicator) setIndicator(e.indicator);
  if (e.catLens) { setIndicator('access'); setCatLens(e.catLens); }
  if (e.flyTo) map.flyTo({ center: [e.flyTo[0], e.flyTo[1]], zoom: e.flyTo[2] || 13, duration: 1600, essential: true });
  if (e.optimize) {
    if (!plannerOn) { document.getElementById('t-planner').checked = true; document.getElementById('t-planner').dispatchEvent(new Event('change')); }
    placeType = e.optimize; buildPlanner(); runOptimizer(e.optimize);
  }
}

const ASK_EXAMPLES = [
  { q: 'Aký je celkový obraz kvality života?', tool: 'prehlad_kvality', args: {} },
  { q: 'Kde v meste chýba najviac lekárov?', tool: 'kde_chyba', args: { kategoria: 'lekar' } },
  { q: 'Ktoré oblasti sú najhoršie na bývanie?', tool: 'rebricek_oblasti', args: { rozmer: 'index', poradie: 'najhorsie' } },
  { q: 'Ako je Bratislava oproti iným mestám?', tool: 'porovnanie_miest', args: {} },
  { q: 'Kam postaviť škôlku, nech pomôže najviac ľuďom?', tool: 'najlepsie_miesto', args: { kategoria: 'skolka' } },
];

function askAddMsg(role, html) {
  const body = document.getElementById('ask-body');
  const d = document.createElement('div');
  d.className = 'ask-msg ' + role;
  d.innerHTML = html;
  body.appendChild(d);
  body.scrollTop = body.scrollHeight;
  return d;
}
function runDemoTool(tool, args) {
  const out = ASK_TOOLS[tool].run(args);
  askAddMsg('bot', out.text);
  applyAskEffect(out.effect);
}
async function askClaude(question) {
  const key = localStorage.getItem('anthropic_key');
  const thinking = askAddMsg('bot thinking', '<span class="dots"><i></i><i></i><i></i></span>');
  try {
    const tools = Object.entries(ASK_TOOLS).map(([name, t]) => ({ name, description: t.desc, input_schema: t.schema }));
    let messages = [{ role: 'user', content: question }];
    let finalText = '';
    for (let step = 0; step < 4; step++) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key,
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: ASK_MODEL, max_tokens: 600, system: ASK_SYSTEM, tools, messages }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || 'API chyba');
      const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
      finalText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ');
      if (data.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({ role: 'assistant', content: data.content });
        const results = [];
        for (const tu of toolUses) {
          const t = ASK_TOOLS[tu.name];
          if (t) { const out = t.run(tu.input || {}); applyAskEffect(out.effect); results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.text }); }
          else results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'neznámy nástroj' });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      break;
    }
    thinking.remove();
    askAddMsg('bot', finalText || 'Nemám k tomu dáta.');
  } catch (err) {
    thinking.remove();
    askAddMsg('bot err', 'Chyba: ' + err.message + ' — skontroluj API kľúč (🔑).');
  }
}

function wireAsk() {
  const fab = document.getElementById('ask-fab');
  const panel = document.getElementById('ask');
  const ex = document.getElementById('ask-examples');
  ex.innerHTML = ASK_EXAMPLES.map((e, i) => `<button data-i="${i}">${e.q}</button>`).join('');
  ex.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const e = ASK_EXAMPLES[+b.dataset.i];
    askAddMsg('user', e.q);
    if (localStorage.getItem('anthropic_key')) askClaude(e.q);
    else runDemoTool(e.tool, e.args);
  }));
  fab.addEventListener('click', () => { panel.hidden = false; fab.style.display = 'none'; refreshAskFoot(); });
  document.getElementById('ask-close').addEventListener('click', () => { panel.hidden = true; fab.style.display = ''; });
  document.getElementById('ask-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const inp = document.getElementById('ask-text');
    const q = inp.value.trim(); if (!q) return; inp.value = '';
    askAddMsg('user', q);
    if (localStorage.getItem('anthropic_key')) askClaude(q);
    else askAddMsg('bot', 'Voľné otázky potrebujú Claude API kľúč 🔑. Zatiaľ skús príkladové otázky vyššie — tie fungujú aj bez kľúča.');
  });
  // key modal
  const km = document.getElementById('keymodal');
  const openKm = () => { km.hidden = false; document.getElementById('keymodal-input').value = localStorage.getItem('anthropic_key') || ''; };
  document.getElementById('ask-key').addEventListener('click', openKm);
  document.getElementById('keymodal-close').addEventListener('click', () => km.hidden = true);
  document.getElementById('keymodal-back').addEventListener('click', () => km.hidden = true);
  document.getElementById('keymodal-save').addEventListener('click', () => {
    const v = document.getElementById('keymodal-input').value.trim();
    if (v) localStorage.setItem('anthropic_key', v); km.hidden = true; refreshAskFoot();
    askAddMsg('bot', '✓ Kľúč uložený — teraz sa môžeš pýtať voľne, prirodzeným jazykom.');
  });
  document.getElementById('keymodal-clear').addEventListener('click', () => {
    localStorage.removeItem('anthropic_key'); km.hidden = true; refreshAskFoot();
  });
  refreshAskFoot();
}
function refreshAskFoot() {
  const has = !!localStorage.getItem('anthropic_key');
  const foot = document.getElementById('ask-foot');
  if (foot) foot.innerHTML = has ? '🟢 Pripojené na Claude — pýtaj sa voľne.' : 'Demo režim — pre voľné otázky pridaj svoj Claude API kľúč 🔑';
}

/* ========== živá IoT vrstva: kvalita ovzdušia (Sensor.Community) ========== */
let airLoaded = false;
function pmColor() {
  return ['interpolate', ['linear'], ['get', 'pm25'],
    0, '#2ecc71', 10, '#a3d977', 20, '#f4d03f', 25, '#e67e22', 50, '#e74c3c', 90, '#9b2d6f'];
}
async function loadAir(refresh) {
  const note = document.getElementById('air-note');
  try {
    note.hidden = false; note.textContent = 'Načítavam živé senzory…';
    const r = await fetch('https://data.sensor.community/airrohr/v1/filter/area=48.15,17.11,18');
    const data = await r.json();
    const sensors = {};
    for (const rec of data) {
      const loc = rec.location || {}, id = rec.sensor && rec.sensor.id;
      const lat = +loc.latitude, lon = +loc.longitude;
      if (!id || !lat || !lon) continue;
      let pm25 = null, pm10 = null;
      for (const v of rec.sensordatavalues || []) {
        if (v.value_type === 'P2') pm25 = +v.value;
        if (v.value_type === 'P1') pm10 = +v.value;
      }
      if (pm25 == null || pm25 > 999) continue;
      sensors[id] = { lon, lat, pm25: Math.round(pm25 * 10) / 10, pm10: pm10 == null ? null : Math.round(pm10) };
    }
    const feats = Object.values(sensors).map(s => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { pm25: s.pm25, pm10: s.pm10 } }));
    const fc = { type: 'FeatureCollection', features: feats };
    if (map.getSource('air')) map.getSource('air').setData(fc);
    else {
      map.addSource('air', { type: 'geojson', data: fc });
      map.addLayer({ id: 'air-glow', type: 'circle', source: 'air', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 14, 15, 34],
        'circle-color': pmColor(), 'circle-opacity': 0.18, 'circle-blur': 1 } });
      map.addLayer({ id: 'air', type: 'circle', source: 'air', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 11],
        'circle-color': pmColor(), 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } });
      map.on('click', 'air', (e) => {
        const p = e.features[0].properties;
        new maplibregl.Popup({ closeButton: false, className: 'air-pop' })
          .setLngLat(e.lngLat)
          .setHTML(`<b>PM2.5: ${p.pm25} µg/m³</b><br>${airLabel(p.pm25)}${p.pm10 != null ? `<br>PM10: ${p.pm10}` : ''}`)
          .addTo(map);
      });
      map.on('mouseenter', 'air', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'air', () => map.getCanvas().style.cursor = '');
    }
    airLoaded = true;
    const now = new Date();
    note.innerHTML = `🟢 ${feats.length} senzorov naživo · PM2.5 µg/m³ · Sensor.Community`;
    return feats.length;
  } catch (e) {
    note.hidden = false; note.textContent = '⚠️ Živé dáta ovzdušia sa nepodarilo načítať.';
    return 0;
  }
}
function airLabel(v) {
  return v < 10 ? 'výborné ovzdušie' : v < 20 ? 'dobré' : v < 25 ? 'prijateľné' : v < 50 ? 'zhoršené' : 'zlé ovzdušie';
}

/* ---------- Atlas runtime + plánovacie pieskovisko ---------- */
const CAT_BUDGET = Object.fromEntries(CAT_ORDER.map(c => [c, Math.round(CAT_META[c].rad * 1.3 / 80)]));
let baselineAmLen = {};

function hexCentroid(f) {
  const r = f.geometry.coordinates[0], n = r.length - 1;
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; }
  return [x / n, y / n];
}
function jsAccess(p) {
  let s = 0;
  for (const c of CAT_ORDER) s += Math.max(0, 1 - (p['m_' + c] ?? 30) / 15);
  return Math.round(100 * s / CAT_ORDER.length * 10) / 10;
}
function compositeOf(p) {
  const tot = WEIGHTED.reduce((s, k) => s + weights[k], 0) || 1;
  let v = 0;
  for (const k of WEIGHTED) v += weights[k] * (p[META[k].key] || 0);
  return Math.round(v / tot * 10) / 10;
}
function initAtlasRuntime() {
  hexCentroids = gridData.features.map(hexCentroid);
  baselineM = gridData.features.map(f => Object.fromEntries(CAT_ORDER.map(c => [c, f.properties['m_' + c]])));
  baselineAmLen = Object.fromEntries(CAT_ORDER.map(c => [c, (amByCat[c] || []).length]));
  for (const f of gridData.features) {
    f.properties.q_access = jsAccess(f.properties);
    f.properties.q_index = compositeOf(f.properties);
  }
  if (map.getSource('grid')) map.getSource('grid').setData(gridData);
}

function addFacility(cat, ll, isOpt) {
  amByCat[cat] = amByCat[cat] || [];
  amByCat[cat].push(ll);
  const el = document.createElement('div');
  el.className = 'plan-marker' + (isOpt ? ' opt' : '');
  el.innerHTML = `<span>${CAT_META[cat].emoji}</span>`;
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(ll).addTo(map);
  placed.push({ cat, ll, marker });

  let peopleGained = 0, idxDeltaSum = 0, improved = 0;
  const budget = CAT_BUDGET[cat];
  for (let i = 0; i < gridData.features.length; i++) {
    const p = gridData.features[i].properties;
    const newMin = Math.max(1, Math.round(haversineM(hexCentroids[i], ll) * 1.3 / 80));
    const oldMin = p['m_' + cat] ?? 30;
    if (newMin < oldMin) {
      const nowReach = newMin <= budget, wasReach = oldMin <= budget;
      p['m_' + cat] = newMin;
      const oldIdx = p.q_index;
      p.q_access = jsAccess(p);
      p.q_index = compositeOf(p);
      idxDeltaSum += p.q_index - oldIdx; improved++;
      if (nowReach && !wasReach) peopleGained += (p.pop || 0);
    }
  }
  map.getSource('grid').setData(gridData);
  applyGridColor();
  if (indicator === 'index') buildFindings(gridData);
  const m = CAT_META[cat];
  document.getElementById('pimpact').innerHTML =
    `${isOpt ? '✨ Optimálne miesto: ' : ''}<b>${m.emoji} ${m.label}</b> — novo dostupné pre <b>${peopleGained.toLocaleString('sk')} obyvateľov</b> do 15 min pešo`
    + (improved ? `, index <b>+${(idxDeltaSum / improved).toFixed(1)}</b> v ${improved} oblastiach.` : '.');
}

function runOptimizer(cat) {
  const budget = CAT_BUDGET[cat];
  let best = null, bestGain = -1;
  for (let c = 0; c < hexCentroids.length; c++) {
    if ((gridData.features[c].properties.pop || 0) === 0) continue;
    const cand = hexCentroids[c];
    let gain = 0;
    for (let i = 0; i < gridData.features.length; i++) {
      const p = gridData.features[i].properties;
      if ((p.pop || 0) === 0 || (p['m_' + cat] ?? 30) <= budget) continue;
      if (Math.round(haversineM(hexCentroids[i], cand) * 1.3 / 80) <= budget) gain += p.pop;
    }
    if (gain > bestGain) { bestGain = gain; best = cand; }
  }
  if (best) { addFacility(cat, best, true); map.flyTo({ center: best, zoom: 12.4, duration: 1400, essential: true }); }
}

function recomputeFromPlaced() {
  for (let i = 0; i < gridData.features.length; i++) {
    const p = gridData.features[i].properties;
    for (const c of CAT_ORDER) p['m_' + c] = baselineM[i][c];
  }
  for (const c of CAT_ORDER) if (amByCat[c]) amByCat[c].length = baselineAmLen[c];
  for (const f of placed) {
    amByCat[f.cat].push(f.ll);
    for (let i = 0; i < gridData.features.length; i++) {
      const p = gridData.features[i].properties;
      const nm = Math.max(1, Math.round(haversineM(hexCentroids[i], f.ll) * 1.3 / 80));
      if (nm < p['m_' + f.cat]) p['m_' + f.cat] = nm;
    }
  }
  for (const f of gridData.features) { f.properties.q_access = jsAccess(f.properties); f.properties.q_index = compositeOf(f.properties); }
  map.getSource('grid').setData(gridData);
  applyGridColor();
  if (indicator === 'index') buildFindings(gridData);
}
function undoFacility() {
  const last = placed.pop();
  if (last) last.marker.remove();
  recomputeFromPlaced();
  document.getElementById('pimpact').innerHTML = placed.length ? `${placed.length} zásahov.` : 'Vyber typ a klikni na mapu, kam ho postaviť.';
}
function resetPlanner() {
  placed.forEach(f => f.marker.remove());
  placed = [];
  recomputeFromPlaced();
  document.getElementById('pimpact').innerHTML = 'Vyber typ a klikni na mapu, kam ho postaviť.';
}

function buildPlanner() {
  const wrap = document.getElementById('ptypes');
  wrap.innerHTML = CAT_ORDER.map(c =>
    `<button data-cat="${c}" title="${CAT_META[c].label}"${c === placeType ? ' class="active"' : ''}>${CAT_META[c].emoji} ${CAT_META[c].label}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    placeType = b.dataset.cat;
    wrap.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.cat === placeType));
  }));
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
  // declutter podľa priblíženia:
  //  • celomestský pohľad (zoom < 13.2) → skry pin-y úplne, nech vládne čistý choropleth
  //  • stredné priblíženie → ikonky bez názvov
  //  • detail (zoom ≥ 14.2) → ikonky aj názvy
  const setZoomClass = () => {
    const z = map.getZoom();
    document.body.classList.toggle('zoom-city', z < 13.2);
    document.body.classList.toggle('zoom-far', z < 14.2);
  };
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
  { title:'Celá Bratislava', center:[17.1150,48.1500], zoom:11.4, pitch:28, bearing:-14,
    text:'Mapa kvality života cez <b>obytné územie celého mesta</b>. Každý hexagón je jedna oblasť, farba = skóre. Žiariace akvamarínové jadro vs tmavé okraje: <b>každá piata oblasť je autozávislá.</b>' },
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
  toggle('t-grid', 'grid', 'grid-edge');
  toggle('t-buildings', 'buildings', 'buildings-hi');
  toggle('t-amenities', 'amenities');
  toggle('t-green', 'green', 'green-edge');
  toggle('t-water', 'water', 'water-edge', 'rivers');
  toggle('t-roads', 'roads', 'city-roads');
  toggle('t-districts', 'districts');

  // landmarks are DOM markers, not map layers
  document.getElementById('t-landmarks').addEventListener('change', (e) => showLandmarks(e.target.checked));

  // živé ovzdušie (IoT) — lazy load + toggle
  document.getElementById('t-air').addEventListener('change', async (e) => {
    if (e.target.checked) {
      if (!airLoaded) { e.target.disabled = true; await loadAir(); e.target.disabled = false; }
      ['air-glow', 'air'].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', 'visible'));
    } else {
      ['air-glow', 'air'].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', 'none'));
      document.getElementById('air-note').hidden = true;
    }
  });

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

  // plánovač
  document.getElementById('t-planner').addEventListener('change', (e) => {
    plannerOn = e.target.checked;
    document.getElementById('planner-tools').hidden = !plannerOn;
    document.body.classList.toggle('planning', plannerOn);
    if (plannerOn && indicator !== 'index' && indicator !== 'access') setIndicator('index');
  });
  document.getElementById('plan-opt').addEventListener('click', () => runOptimizer(placeType));
  document.getElementById('plan-undo').addEventListener('click', undoFacility);
  document.getElementById('plan-reset').addEventListener('click', resetPlanner);

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

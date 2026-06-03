/* Bratislava 3D — atlas mesta z otvorených dát
   Pure-data "architektonický model": žiadna externá mapová podložka, len OSM geodáta
   vykreslené cez MapLibre GL JS (API-kompatibilné s Mapbox GL JS). */

const DATA = (f) => `data/${f}`;

/* ---- height → color ramp (metre) ---- */
const HEIGHT_RAMP = [
  0, '#21303a', 8, '#27606b', 15, '#2f8f8a', 25, '#46e0d0',
  40, '#bfe27a', 60, '#ffc24b', 90, '#ff7a45', 130, '#ff4d4d',
];

/* ---- orientačné body: pin = známe miesto, area = názov štvrte ---- */
const LANDMARKS = [
  { t:'pin',  icon:'🏰', name:'Bratislavský hrad',     at:[17.1003,48.1419] },
  { t:'pin',  icon:'🛸', name:'Most SNP · UFO',          at:[17.1045,48.1383] },
  { t:'pin',  icon:'⛪', name:'Modrý kostolík',          at:[17.1170,48.1437] },
  { t:'pin',  icon:'🏛️', name:'Grassalkovičov palác',    at:[17.1106,48.1486] },
  { t:'pin',  icon:'🎭', name:'SND',                     at:[17.1238,48.1404] },
  { t:'pin',  icon:'🏢', name:'Eurovea Tower · 168 m',   at:[17.1271,48.1398] },
  { t:'pin',  icon:'🏙️', name:'Sky Park',                at:[17.1255,48.1446] },
  { t:'pin',  icon:'🚌', name:'Stanica Nivy',            at:[17.1300,48.1462] },
  { t:'pin',  icon:'🚉', name:'Hlavná stanica',          at:[17.1065,48.1590] },
  { t:'pin',  icon:'🗿', name:'Slavín',                  at:[17.0972,48.1531] },
  { t:'pin',  icon:'🌳', name:'Sad Janka Kráľa',         at:[17.1045,48.1340] },
  { t:'area', name:'STARÉ MESTO',  at:[17.1085,48.1455] },
  { t:'area', name:'PETRŽALKA',    at:[17.1075,48.1175] },
  { t:'area', name:'NOVÉ MESTO',   at:[17.1290,48.1610] },
  { t:'area', name:'RUŽINOV',      at:[17.1470,48.1530] },
];
let lmMarkers = [];
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
  center: [17.1105, 48.1395],
  zoom: 13.7, pitch: 56, bearing: -19,
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
  const [buildings, green, water, roads, districts] = await Promise.all([
    loadJSON('buildings.geojson'), loadJSON('green.geojson'),
    loadJSON('water.geojson'), loadJSON('roads.geojson'),
    loadJSON('districts.geojson'),
  ]);
  buildingsData = buildings;

  map.addSource('water', { type: 'geojson', data: water });
  map.addSource('green', { type: 'geojson', data: green });
  map.addSource('roads', { type: 'geojson', data: roads });
  map.addSource('districts', { type: 'geojson', data: districts });
  map.addSource('buildings', { type: 'geojson', data: buildings, generateId: true });

  /* water */
  map.addLayer({ id: 'water', type: 'fill', source: 'water',
    paint: { 'fill-color': '#0c2233', 'fill-opacity': 0.9 } });
  map.addLayer({ id: 'water-edge', type: 'line', source: 'water',
    paint: { 'line-color': '#1b4a63', 'line-width': 1 } });

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

  /* 3D buildings */
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'buildings',
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], ...HEIGHT_RAMP],
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min'],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    } });

  /* hover highlight */
  map.addLayer({ id: 'buildings-hi', type: 'fill-extrusion', source: 'buildings',
    filter: ['==', ['id'], -1],
    paint: {
      'fill-extrusion-color': '#ffffff',
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'min'],
      'fill-extrusion-opacity': 0.55,
    } });

  applyLight('day');
  computeStats(buildings);
  buildLandmarks();
  wireUI();
  setTimeout(() => document.getElementById('loader').classList.add('hide'), 350);

  // expose for screenshot tooling / debugging
  window.__app = { map, gotoStop, setMood: applyLight, TOUR };
  window.__ready = true;

  /* hover */
  map.on('mousemove', 'buildings', (e) => {
    map.getCanvas().style.cursor = 'pointer';
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
  map.on('click', 'buildings', (e) => {
    if (e.features.length) openInspector(e.features[0].properties);
  });
});

/* ---------- stats ---------- */
function computeStats(fc) {
  const n = fc.features.length;
  let tallest = 0;
  for (const f of fc.features) tallest = Math.max(tallest, f.properties.h || 0);
  document.getElementById('stat-buildings').innerHTML = `<b>${n.toLocaleString('sk')}</b> budov`;
  document.getElementById('stat-tallest').innerHTML = `najvyššia <b>${Math.round(tallest)} m</b>`;
}

/* ---------- inspector ---------- */
function openInspector(p) {
  const el = document.getElementById('inspector');
  el.hidden = false;
  const h = Math.round(p.h);
  document.getElementById('insp-kind').textContent = kindLabel(p.kind);
  document.getElementById('insp-name').textContent = p.name && p.name.length ? p.name : 'Budova bez názvu';
  document.getElementById('insp-height').textContent = `${h} m`;
  document.getElementById('insp-levels').textContent = `≈ ${Math.max(1, Math.round(h / 3.2))}`;
  document.getElementById('insp-bar-fill').style.width = Math.min(100, (h / 130) * 100) + '%';
}
function kindLabel(k) {
  const map = { yes:'budova', apartments:'bytový dom', house:'rodinný dom', residential:'obytná',
    commercial:'komerčná', retail:'obchod', office:'administratíva', industrial:'priemysel',
    church:'kostol', hospital:'nemocnica', school:'škola', university:'univerzita',
    hotel:'hotel', public:'verejná', garage:'garáž', roof:'prístrešok', construction:'výstavba' };
  return map[k] || (k || 'budova');
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
    }
    const m = new maplibregl.Marker({ element: el, anchor: lm.t === 'area' ? 'center' : 'bottom' })
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

/* ---------- guided tour ---------- */
const TOUR = [
  { title:'Mesto ako model', center:[17.1105,48.1395], zoom:13.6, pitch:54, bearing:-19,
    text:'Celá scéna je poskladaná <b>výhradne z otvorených dát</b> — žiadna podkladová mapa. Presne ako fyzický 3D model, len v prehliadači. Ikonky ukazujú, kde čo je.' },
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
  focusMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
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
  // legend
  const ticks = [0, 15, 30, 60, 90, 130];
  document.getElementById('legend').innerHTML =
    `<div class="legend-bar"></div><div class="legend-ticks">${
      ticks.map(t => `<span>${t}</span>`).join('')}</div>`;

  // layer toggles
  const toggle = (id, ...layers) => {
    document.getElementById(id).addEventListener('change', (e) => {
      const v = e.target.checked ? 'visible' : 'none';
      layers.forEach(l => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', v));
    });
  };
  toggle('t-buildings', 'buildings', 'buildings-hi');
  toggle('t-green', 'green', 'green-edge');
  toggle('t-water', 'water', 'water-edge');
  toggle('t-roads', 'roads');
  toggle('t-districts', 'districts');

  // landmarks are DOM markers, not map layers
  document.getElementById('t-landmarks').addEventListener('change', (e) => showLandmarks(e.target.checked));

  // height filter
  const hf = document.getElementById('height-filter');
  hf.addEventListener('input', (e) => {
    const v = +e.target.value;
    document.getElementById('filter-val').textContent = v;
    map.setFilter('buildings', ['>=', ['get', 'h'], v]);
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

  // inspector close
  document.getElementById('insp-close').addEventListener('click', () =>
    document.getElementById('inspector').hidden = true);

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

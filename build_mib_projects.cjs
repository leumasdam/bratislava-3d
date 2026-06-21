/* build_mib_projects.cjs — stiahne reálne projekty z verejného MIB API (mib.sk)
   a umiestni ich podľa MESTSKEJ ČASTI na centroid danej časti z districts.geojson.
   Výstup: data/mib_projects.geojson  (klik = link na mib.sk).
   Súradnice nie sú presná adresa — sú na úrovni mestskej časti (MIB ich cez REST nepublikuje).
   Spustenie:  node build_mib_projects.cjs */
const fs = require('fs');
const path = require('path');

const API = 'https://mib.sk/wp-json/wp/v2';
const stripDia = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => stripDia(String(s || '')).toLowerCase()
  .replace(/^bratislava[-\s]+/, '').replace(/mestsk[aá]\s+cas[tť]\s+/, '').trim();

// stav → MIB akcentová farba
function statusColor(name) {
  const n = norm(name);
  if (n.includes('priprav')) return { c: '#f4b860', k: 'Príprava' };
  if (n.includes('povol')) return { c: '#4ec5f9', k: 'Povoľovacie procesy' };
  if (n.includes('realiz')) return { c: '#30287B', k: 'Realizácia' };
  if (n.includes('ukoncen')) return { c: '#29b826', k: 'Ukončené' };
  if (n.includes('prebieh')) return { c: '#8a7fc8', k: 'Prebiehajúce' };
  return { c: '#908da8', k: name || 'Projekt' };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'bratislava-3d-build' } });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}
async function getTerms(base) {
  const out = {};
  for (let p = 1; p <= 5; p++) {
    const arr = await getJSON(`${API}/${base}?per_page=100&page=${p}&_fields=id,name`);
    if (!arr.length) break;
    arr.forEach((t) => { out[t.id] = t.name; });
    if (arr.length < 100) break;
  }
  return out;
}

// gazetteer všetkých 17 bratislavských mestských častí (približný stred) — kľúč = norm()
const GAZETTEER = {
  'stare mesto': [17.107, 48.145], 'ruzinov': [17.155, 48.155], 'nove mesto': [17.135, 48.180],
  'petrzalka': [17.110, 48.118], 'karlova ves': [17.060, 48.150], 'dubravka': [17.020, 48.190],
  'devinska nova ves': [16.985, 48.205], 'devin': [16.980, 48.175], 'lamac': [17.045, 48.190],
  'zahorska bystrica': [17.070, 48.230], 'raca': [17.155, 48.205], 'vajnory': [17.200, 48.210],
  'vrakuna': [17.180, 48.160], 'podunajske biskupice': [17.205, 48.130], 'jarovce': [17.135, 48.070],
  'rusovce': [17.150, 48.050], 'cunovo': [17.205, 48.005],
};

// centroid mestskej časti z districts.geojson (priemer všetkých vrcholov daného name)
function districtCentroids() {
  const gj = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'districts.geojson'), 'utf8'));
  const acc = {};
  const add = (name, lng, lat) => {
    const k = norm(name);
    (acc[k] ||= { sx: 0, sy: 0, n: 0 });
    acc[k].sx += lng; acc[k].sy += lat; acc[k].n++;
  };
  const walk = (coords) => { if (typeof coords[0] === 'number') return; coords.forEach(walk); };
  for (const f of gj.features) {
    const name = f.properties && f.properties.name; if (!name) continue;
    const g = f.geometry; if (!g) continue;
    const each = (c) => add(name, c[0], c[1]);
    const rec = (c) => { if (typeof c[0] === 'number') each(c); else c.forEach(rec); };
    rec(g.coordinates);
  }
  const out = {};
  for (const k in acc) out[k] = [acc[k].sx / acc[k].n, acc[k].sy / acc[k].n];
  return out;
}

(async () => {
  const [statuses, sections] = await Promise.all([
    getTerms('custom_statuses'),
    getTerms('custom_city_section'),
  ]);
  const cent = { ...GAZETTEER, ...districtCentroids() }; // presné centroidy prepíšu gazetteer
  console.log('mestské časti s centroidom:', Object.keys(cent).length);

  // všetky projekty
  const projects = [];
  for (let p = 1; p <= 5; p++) {
    const arr = await getJSON(`${API}/project?per_page=100&page=${p}&_fields=id,title,link,date,custom_statuses,custom_city_section`);
    if (!arr.length) break;
    projects.push(...arr);
    if (arr.length < 100) break;
  }
  console.log('projektov načítaných:', projects.length);

  const BA = [17.1077, 48.1486]; // fallback: centrum BA
  const grouped = {}; // pre jitter podľa miesta
  const feats = [];
  let placed = 0, fallback = 0;

  for (const pr of projects) {
    const secName = (pr.custom_city_section || []).map((id) => sections[id]).filter(Boolean)[0] || '';
    const stName = (pr.custom_statuses || []).map((id) => statuses[id]).filter(Boolean)[0] || '';
    const sc = statusColor(stName);
    let base = cent[norm(secName)];
    if (base) placed++; else { base = BA; fallback++; }

    // jitter: viac projektov v tej istej časti rozlož do špirály (~250–600 m)
    const key = base.join(',');
    const idx = (grouped[key] = (grouped[key] || 0) + 1) - 1;
    const ring = Math.floor(idx / 8), slot = idx % 8;
    const r = 0.004 + ring * 0.0032;
    const ang = (slot / 8) * Math.PI * 2 + ring * 0.6;
    const lng = base[0] + Math.cos(ang) * r / Math.cos(base[1] * Math.PI / 180) * (idx ? 1 : 0);
    const lat = base[1] + Math.sin(ang) * r * (idx ? 1 : 0);

    const title = String(pr.title && pr.title.rendered || '')
      .replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();

    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        title, link: pr.link, section: secName || '—',
        status: sc.k, color: sc.c, year: String(pr.date || '').slice(0, 4),
      },
    });
  }

  const fc = { type: 'FeatureCollection', features: feats };
  fs.writeFileSync(path.join(__dirname, 'data', 'mib_projects.geojson'), JSON.stringify(fc));
  console.log(`hotovo: ${feats.length} projektov → data/mib_projects.geojson (na mestskú časť: ${placed}, fallback centrum: ${fallback})`);
})().catch((e) => { console.error('CHYBA:', e.message); process.exit(1); });

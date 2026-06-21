/* build_tiles.cjs — z data/buildings_full.geojson vyrobí MVT vektorové dlaždice
   (vrstva "building", atribút h = výška, min = spodok) do ./_tiles/{z}/{x}/{y}.pbf
   (gzip) + meta.json. Tieto dlaždice potom pack_pmtiles.py zabalí do .pmtiles. */
const fs = require('fs'), p = require('path'), zlib = require('zlib');
const geojsonvt = require('geojson-vt').default || require('geojson-vt');
const vtpbf = require('vt-pbf');

const SRC = 'data/buildings_full.geojson';
const OUT = '_tiles';
const MINZOOM = 11, MAXZOOM = 16;
const BBOX = [16.975, 48.055, 17.220, 48.230]; // W,S,E,N

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };

console.log('načítavam', SRC, '…');
const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.log('budov:', gj.features.length, '— indexujem (geojson-vt)…');
const idx = geojsonvt(gj, { maxZoom: MAXZOOM, indexMaxZoom: MAXZOOM, indexMaxPoints: 0, tolerance: 3, extent: 4096, buffer: 64 });

fs.rmSync(OUT, { recursive: true, force: true });
let written = 0, bytes = 0;
for (let z = MINZOOM; z <= MAXZOOM; z++) {
  const x0 = lon2x(BBOX[0], z), x1 = lon2x(BBOX[2], z);
  const y0 = lat2y(BBOX[3], z), y1 = lat2y(BBOX[1], z);
  let zc = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const tile = idx.getTile(z, x, y);
      if (!tile || !tile.features || !tile.features.length) continue;
      const pbf = vtpbf.fromGeojsonVt({ building: tile }, { version: 2 });
      const gz = zlib.gzipSync(Buffer.from(pbf), { level: 9 });
      const dir = p.join(OUT, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p.join(dir, y + '.pbf'), gz);
      written++; zc++; bytes += gz.length;
    }
  }
  console.log(`  z${z}: ${zc} dlaždíc`);
}
const center = [(BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2];
fs.writeFileSync(p.join(OUT, 'meta.json'), JSON.stringify({
  minzoom: MINZOOM, maxzoom: MAXZOOM, bounds: BBOX, center,
  layer: 'building',
}));
console.log(`HOTOVO: ${written} dlaždíc, ${(bytes / 1048576).toFixed(1)} MB (gz) → ${OUT}/`);

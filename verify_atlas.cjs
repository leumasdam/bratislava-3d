const puppeteer = require('puppeteer');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = __dirname, PORT = 8751;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); });
}).listen(PORT);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const pg = await b.newPage(); await pg.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.3 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await pg.waitForFunction('window.__ready===true', { timeout: 45000 }).catch(() => {});
  await sleep(2500);
  await pg.evaluate(() => document.getElementById('intro-explore').click());

  const base = await pg.evaluate(() => ({
    inds: document.querySelectorAll('#indsel button').length,
    weights: document.querySelectorAll('.wsl').length,
    weightsShown: !document.getElementById('block-weights').hidden,
    findings: document.getElementById('findings').children.length,
  }));
  console.log('BASE', JSON.stringify(base));

  // composite default view
  await sleep(800);
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'atlas-01-index.png') });

  // switch to heat indicator
  await pg.evaluate(() => window.__app.setIndicator('heat'));
  await sleep(1200);
  const heat = await pg.evaluate(() => ({ catlensHidden: document.getElementById('block-catlens').hidden,
    weightsHidden: document.getElementById('block-weights').hidden,
    title: document.getElementById('legend-title').textContent }));
  console.log('HEAT', JSON.stringify(heat));
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'atlas-02-heat.png') });

  // change weights: prioritise green+noise, zero others, back to index
  await pg.evaluate(() => { window.__app.setIndicator('index'); window.__app.setWeights({ access:0, green:3, heat:0, transit:0, walk:0, noise:3 }); });
  await sleep(1200);
  const idxMean = await pg.evaluate(() => {
    const fs = window.__app.map.getSource('grid')._data.features;
    return Math.round(fs.reduce((s,f)=>s+f.properties.q_index,0)/fs.length);
  });
  console.log('weighted q_index mean:', idxMean);
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'atlas-03-weighted.png') });

  // click a hex → breakdown
  await pg.evaluate(() => window.__app.setWeights({ access:1, green:1, heat:1, transit:1, walk:1, noise:1 }));
  await pg.evaluate(() => { window.__app.map.flyTo({ center:[17.11,48.15], zoom:12.5, duration:0 }); });
  await sleep(800);
  const hex = await pg.evaluate(() => {
    const f = window.__app.map.getSource('grid')._data.features[150];
    const c = f.geometry.coordinates[0][0];
    window.__app.showSpotAt({ lng:c[0], lat:c[1] }, null, f.properties);
    return { atlas: document.querySelectorAll('.sa-row').length, qi: document.querySelector('.sa-head b')?.textContent };
  });
  console.log('HEX breakdown rows:', hex.atlas, 'q_index:', hex.qi);
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'atlas-04-hex.png') });

  console.log('ERRORS', errs.length ? errs.slice(0, 6) : 'none');
  await b.close(); srv.close();
})();

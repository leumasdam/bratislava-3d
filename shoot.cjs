/* Render the app headlessly and capture hero shots.
   MapLibre needs WebGL; headless Chrome gets it via SwiftShader (software GL). */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8731;
const OUTDIR = path.join(ROOT, 'screens');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.geojson':'application/json', '.png':'image/png' };

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    fs.readFile(fp, (e, data) => {
      if (e) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(PORT);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR);
  const server = serve();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
           '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
           '--window-size=1680,1050'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });

  // wait for the app to signal ready
  try { await page.waitForFunction('window.__ready === true', { timeout: 45000 }); }
  catch (e) { console.log('!! __ready never set'); }
  await page.evaluate(() => { const i = document.getElementById('intro'); if (i) i.hidden = true; });
  await sleep(2500); // let tiles/extrusion settle

  const stats = await page.evaluate(() => {
    const b = document.getElementById('stat-buildings')?.textContent;
    const t = document.getElementById('stat-tallest')?.textContent;
    return { b, t, hasMap: !!window.__app };
  });
  console.log('STATS', JSON.stringify(stats));

  const shots = [
    { name: '01-hero', stop: 0, mood: 'day' },
    { name: '02-castle', stop: 1, mood: 'day' },
    { name: '03-oldtown', stop: 2, mood: 'dusk' },
    { name: '04-towers', stop: 3, mood: 'dusk' },
    { name: '05-bridge', stop: 4, mood: 'night' },
    { name: '06-petrzalka', stop: 5, mood: 'night' },
  ];
  for (const s of shots) {
    await page.evaluate((st, md) => {
      window.__app.setMood(md);
      window.__app.gotoStop(st, false); // jumpTo for crisp capture
    }, s.stop, s.mood);
    await sleep(2600);
    await page.screenshot({ path: path.join(OUTDIR, s.name + '.png') });
    console.log('shot', s.name);
  }

  // a clean full-frame hero without panel for the PDF cover
  await page.evaluate(() => {
    window.__app.setMood('dusk');
    window.__app.gotoStop(0, false);
    document.getElementById('panel').classList.add('collapsed');
    document.querySelector('.topbar').style.opacity = '0';
    const ctrl = document.querySelector('.maplibregl-ctrl-bottom-right');
    if (ctrl) ctrl.style.display = 'none';
  });
  await sleep(2600);
  await page.screenshot({ path: path.join(OUTDIR, '00-cover.png') });
  console.log('shot 00-cover');

  console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 12), null, 2) : 'none');
  await browser.close();
  server.close();
})();

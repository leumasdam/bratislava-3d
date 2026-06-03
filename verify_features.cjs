const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname, PORT = 8744, OUT = path.join(ROOT, 'screens');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT);

(async () => {
  const b = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1.4 });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready===true', { timeout: 45000 }).catch(() => {});
  await sleep(2500);

  // 1) klik do centra → spot karta (15-min rozpad)
  await page.evaluate(() => window.__app.gotoStop(2, false)); // Staré Mesto
  await sleep(2200);
  await page.evaluate(() => window.__app.showSpotAt({ lng: 17.1090, lat: 48.1460 }, { h: 22, name: '' }));
  await sleep(600);
  const spot = await page.evaluate(() => {
    const s = document.getElementById('spot');
    return { hidden: s.hidden, score: document.getElementById('spot-score').textContent,
             rows: document.querySelectorAll('.spot-row').length,
             firstRow: document.querySelector('.spot-row')?.innerText };
  });
  console.log('SPOT', JSON.stringify(spot));
  await page.screenshot({ path: path.join(OUT, 'feat-01-click.png') });

  // 2) klik na okraj (slabšie) → nižšie skóre?
  await page.evaluate(() => window.__app.showSpotAt({ lng: 17.0980, lat: 48.1280 }, null));
  await sleep(500);
  const edge = await page.evaluate(() => document.getElementById('spot-score').textContent);
  console.log('EDGE score', edge);

  // 3) slabé miesta toggle
  await page.evaluate(() => { document.getElementById('t-weak').click(); window.__app.gotoStop(0, false); });
  await sleep(2200);
  await page.screenshot({ path: path.join(OUT, 'feat-02-weak.png') });

  // 4) výšková šošovka
  await page.evaluate(() => { document.getElementById('t-weak').click(); window.__app.setLens('height'); });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'feat-03-height.png') });

  console.log('ERRORS', errs.length ? errs.slice(0, 8) : 'none');
  await b.close(); server.close();
})();

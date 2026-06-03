const puppeteer = require('puppeteer');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = __dirname, PORT = 8753;
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

  // population present?
  const pop = await pg.evaluate(() => {
    const fs = window.__app.map.getSource('grid')._data.features;
    return { total: fs.reduce((s,f)=>s+(f.properties.pop||0),0), hasPop: fs[0].properties.pop != null };
  });
  console.log('POP', JSON.stringify(pop));

  // enable planner
  await pg.evaluate(() => window.__app.setPlanner(true));
  await sleep(400);
  const toolsShown = await pg.evaluate(() => !document.getElementById('planner-tools').hidden);
  console.log('planner tools shown:', toolsShown);

  // place a doctor in a peripheral area (Devínska-ish west)
  await pg.evaluate(() => window.__app.addFacility('lekar', [17.025, 48.19]));
  await sleep(800);
  const imp1 = await pg.evaluate(() => document.getElementById('pimpact').textContent);
  console.log('PLACE impact:', imp1);

  // optimizer for kindergarten
  await pg.evaluate(() => window.__app.runOptimizer('skolka'));
  await sleep(900);
  const imp2 = await pg.evaluate(() => document.getElementById('pimpact').textContent);
  console.log('OPT impact:', imp2);
  await pg.evaluate(() => window.__app.map.flyTo({center:[17.11,48.15],zoom:11.4,duration:0}));
  await sleep(600);
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'planner-01.png') });

  // counts + reset
  const before = await pg.evaluate(() => document.querySelectorAll('.plan-marker').length);
  await pg.evaluate(() => document.getElementById('plan-reset').click());
  await sleep(500);
  const after = await pg.evaluate(() => document.querySelectorAll('.plan-marker').length);
  console.log('markers before reset:', before, 'after:', after);

  console.log('ERRORS', errs.length ? errs.slice(0, 6) : 'none');
  await b.close(); srv.close();
})();

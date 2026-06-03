const puppeteer = require('puppeteer');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = __dirname, PORT = 8749;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); });
}).listen(PORT);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const pg = await b.newPage(); await pg.setViewport({ width: 1500, height: 950 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await pg.waitForFunction('window.__ready===true', { timeout: 45000 }).catch(() => {});
  await sleep(2500);
  const r = await pg.evaluate(() => ({ intro: !document.getElementById('intro').hidden,
    introGood: document.getElementById('intro-good').textContent,
    findings: document.getElementById('findings').children.length,
    catBtns: document.getElementById('catlens').children.length }));
  console.log('UX', JSON.stringify(r));
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'feat-intro.png') });
  await pg.evaluate(() => { document.getElementById('intro-explore').click(); window.__app.setCatLens('lekar'); });
  await sleep(1300);
  await pg.screenshot({ path: path.join(ROOT, 'screens', 'feat-catlens.png') });
  const cl = await pg.evaluate(() => document.querySelector('#catlens button.active') && document.querySelector('#catlens button.active').dataset.cat);
  console.log('catLens active:', cl, 'errors:', errs.length ? errs.slice(0, 5) : 'none');
  await b.close(); srv.close();
})();

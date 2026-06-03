const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname, PORT = 8745, OUT = path.join(ROOT, 'screens');
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
  page.on('requestfailed', r => { if (r.url().includes('wikimedia')) errs.push('IMG FAIL ' + r.url()); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready===true', { timeout: 45000 }).catch(() => {});
  await sleep(2500);

  // default hero (access lens, light-blue water, landmarks + amenities)
  await page.evaluate(() => window.__app.gotoStop(0, false));
  await sleep(1800);
  await page.screenshot({ path: path.join(OUT, 'feat-01-default.png') });

  // landmark card s fotom (Hrad)
  await page.evaluate(() => {
    const lm = window.__app.LANDMARKS.find(l => l.name === 'Bratislavský hrad');
    window.__app.openLandmarkCard(lm);
  });
  await sleep(2500); // nechaj fotku načítať
  const card = await page.evaluate(() => {
    const c = document.getElementById('lmcard');
    const ph = getComputedStyle(document.getElementById('lmcard-photo')).backgroundImage;
    return { hidden: c.hidden, hasPhoto: ph && ph !== 'none', name: document.getElementById('lmcard-name').textContent,
             desc: document.getElementById('lmcard-desc').textContent.slice(0, 60) };
  });
  console.log('LMCARD', JSON.stringify(card));
  await page.screenshot({ path: path.join(OUT, 'feat-02-landmark.png') });

  // access filter ≥ 80
  await page.evaluate(() => {
    document.getElementById('lmcard-close').click();
    const s = document.getElementById('access-filter'); s.value = 80;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'feat-03-accessfilter.png') });

  // category chips: nechaj len obchod + zastavka
  await page.evaluate(() => {
    const s = document.getElementById('access-filter'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelectorAll('#legend-cats .lc').forEach(ch => {
      if (!['obchod','zastavka'].includes(ch.dataset.cat)) ch.click();
    });
  });
  await sleep(1200);
  const amen = await page.evaluate(() => document.querySelectorAll('#legend-cats .lc.off').length);
  console.log('CHIPS off:', amen);
  await page.screenshot({ path: path.join(OUT, 'feat-04-chips.png') });

  console.log('ERRORS', errs.length ? errs.slice(0, 8) : 'none');
  await b.close(); server.close();
})();

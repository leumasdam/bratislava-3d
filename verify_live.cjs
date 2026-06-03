const puppeteer = require('puppeteer');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: 'new',
    args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.4 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('https://leumasdam.github.io/bratislava-3d/', { waitUntil: 'networkidle0', timeout: 60000 });
  try { await page.waitForFunction('window.__ready===true', { timeout: 45000 }); }
  catch(e){ console.log('!! not ready'); }
  await sleep(3000);
  const stats = await page.evaluate(() => ({
    b: document.getElementById('stat-buildings')?.textContent,
    t: document.getElementById('stat-tallest')?.textContent,
  }));
  console.log('LIVE STATS', JSON.stringify(stats));
  await page.evaluate(() => { window.__app.setMood('dusk'); window.__app.gotoStop(3, false); });
  await sleep(2600);
  await page.screenshot({ path: path.join(__dirname, 'screens', 'live-check.png') });
  console.log('errors:', errs.length ? errs.slice(0,5) : 'none');
  await browser.close();
})();

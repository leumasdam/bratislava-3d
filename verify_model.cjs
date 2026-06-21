const puppeteer = require('puppeteer');
const http = require('http'), fs = require('fs'), p = require('path');
const types = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.woff':'font/woff','.geojson':'application/json','.json':'application/json','.pmtiles':'application/octet-stream','.pbf':'application/x-protobuf' };
// server S PODPOROU HTTP RANGE (pmtiles to vyžaduje)
const srv = http.createServer((q, r) => {
  let u = q.url.split('?')[0]; if (u === '/') u = '/index.html';
  const f = p.join(__dirname, decodeURIComponent(u));
  fs.stat(f, (e, st) => {
    if (e) { r.writeHead(404); return r.end(); }
    const ct = types[p.extname(f)] || 'application/octet-stream';
    const range = q.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = +m[1], end = m[2] ? +m[2] : st.size - 1;
      r.writeHead(206, { 'content-type': ct, 'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      fs.createReadStream(f, { start, end }).pipe(r);
    } else {
      r.writeHead(200, { 'content-type': ct, 'accept-ranges': 'bytes', 'content-length': st.size });
      fs.createReadStream(f).pipe(r);
    }
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => srv.listen(8130, r));
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1500, height:950, deviceScaleFactor:1.3 });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{ const t=m.text(); if(t.includes('[lm]')||t.includes('landmarks')||m.type()==='warning'||m.type()==='error') console.log('  ['+m.type()+']', t.slice(0,200)); });
  await page.goto('http://127.0.0.1:8130/', { waitUntil:'networkidle2', timeout:90000 });
  try{ await page.waitForFunction('window.__ready===true',{timeout:60000}); console.log('ready ✓'); }catch(e){ console.log('!! not ready'); }
  await page.evaluate(()=>{ const i=document.getElementById('intro'); if(i)i.hidden=true; });
  // doleť bližšie nech sa načítajú dlaždice
  await page.evaluate(()=>window.__app && window.__app.map.easeTo({center:[17.1075,48.1395],zoom:14.4,pitch:64,bearing:-22,duration:800}));
  await sleep(6500);
  const diag = await page.evaluate(()=>{
    const m=window.__app && window.__app.map; if(!m) return {err:'no map'};
    let rendered=null; try{ rendered=m.queryRenderedFeatures({layers:['buildings-full']}).length; }catch(e){ rendered='err:'+e.message; }
    return { view_model: document.body.classList.contains('view-model'),
      three: typeof window.THREE,
      hasLandmarks: !!m.getLayer('landmarks3d'),
      renderedFull: rendered,
      buildingsHidden: m.getLayer('buildings')?m.getLayoutProperty('buildings','visibility'):'(none)' };
  });
  console.log('DIAG', JSON.stringify(diag));
  await page.screenshot({ path: p.join(__dirname,'screens','model-check.png') });
  // prepni na atlas a späť pre istotu
  await page.evaluate(()=>window.__app.setView('atlas')); await sleep(2000);
  const atlas = await page.evaluate(()=>({ atlas: document.body.classList.contains('view-atlas'), fullVis: window.__app.map.getLayoutProperty('buildings-full','visibility'), bVis: window.__app.map.getLayoutProperty('buildings','visibility') }));
  console.log('ATLAS', JSON.stringify(atlas));
  await page.screenshot({ path: p.join(__dirname,'screens','atlas-check.png') });
  await page.evaluate(()=>window.__app.setView('model')); await sleep(800);
  // projekčný režim
  await page.evaluate(()=>window.__app.enterProjector()); await sleep(2000);
  const proj = await page.evaluate(()=>({ projector: document.body.classList.contains('projector'), panelShown: getComputedStyle(document.querySelector('.panel')).display }));
  console.log('PROJ', JSON.stringify(proj));
  await page.screenshot({ path: p.join(__dirname,'screens','proj-check.png') });
  console.log('errors:', errs.length?errs.slice(0,4):'none');
  await browser.close(); srv.close();
})().catch(e=>{ console.error('FAIL', e.message); process.exit(1); });

'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const playwrightModule = process.env.PLAYWRIGHT_MODULE || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const { chromium } = require(playwrightModule);
let target = process.env.PAC_PIC_URL;
const output = process.env.QA_OUTPUT || '/tmp/pacpic-qa';
fs.mkdirSync(output, { recursive: true });

(async () => {
  let server;
  if (!target) {
    const root = path.resolve(__dirname, '..');
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { response.writeHead(404).end(); return; }
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' });
        response.end(data);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    target = `http://127.0.0.1:${server.address().port}`;
  }
  const options = { headless: true };
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  let browser;
  try {
    browser = await chromium.launch(options);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [], failedRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push(request.url()));
    await page.goto(target);
    await page.waitForFunction(() => document.getElementById('calculationStatus').textContent.startsWith('Completato'), null, { timeout: 60000 });
    assert.equal(await page.locator('#modelSharpe').innerText(), '0,127');
    assert.equal(await page.locator('#statsTableBody tr').count(), 9);
    assert.equal(await page.evaluate(() => Object.values(Chart.instances).length), 3);
    for (const count of await page.evaluate(() => Chart.getChart('histogramChart').data.datasets.map(d => d.data.reduce((a, b) => a + b, 0)))) assert.ok(Math.abs(count - 100) < 1e-8);
    assert.equal(await page.locator('#chartError').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    if (process.env.SAVE_README_PREVIEW === '1') {
      await page.screenshot({ path: path.resolve(__dirname, '../docs/anteprima.jpg'), type: 'jpeg', quality: 85 });
    }
    const initialMedian = await page.locator('#pacMedian').innerText();
    const initialStamp = await page.locator('#resultStamp').innerText();
    await page.locator('#grossButton').click();
    assert.notEqual(await page.locator('#pacMedian').innerText(), initialMedian);
    assert.equal(await page.locator('#resultStamp').innerText(), initialStamp);
    await page.locator('#netButton').click();
    assert.equal(await page.locator('#pacMedian').innerText(), initialMedian);
    await page.locator('#realTerms').check();
    assert.match(await page.locator('#resultStamp').innerText(), /euro di oggi/);
    assert.notEqual(await page.locator('#pacMedian').innerText(), initialMedian);
    await page.locator('#riskReference').selectOption('riskFree');
    assert.match(await page.locator('#riskDescription').innerText(), /tasso RF/);
    await page.locator('#showTailLines').check();
    assert.equal(await page.evaluate(() => Chart.getChart('fanChart').data.datasets.filter(d => /P1$|P5$/.test(d.label)).length), 4);
    await page.locator('#drawdownType').selectOption('balance');
    assert.equal(await page.evaluate(() => Chart.getChart('drawdownChart').data.datasets.length), 2);
    await page.locator('#guideButton').click();
    assert.equal(await page.locator('#guideDialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#guideDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'guideButton');
    await page.locator('#years').fill('16');
    assert.equal(await page.locator('#staleNotice').isVisible(), true);
    await page.locator('#years').fill('15');
    assert.equal(await page.locator('#staleNotice').isVisible(), false);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#csvButton').click();
    const download = await downloadPromise;
    const csvPath = path.join(output, download.suggestedFilename());
    await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    for (const key of ['VaR95', 'ES99', 'seed;42', 'Massimo drawdown', 'Sharpe annuo modello', '0,126']) assert.ok(csv.includes(key), `Missing CSV value: ${key}`);

    await page.setViewportSize({ width: 393, height: 852 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page has horizontal overflow');
    await page.setViewportSize({ width: 768, height: 1024 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tablet page has horizontal overflow');
    await page.screenshot({ path: path.join(output, 'tablet.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.locator('#resetButton').click();
    await page.waitForFunction(() => document.getElementById('calculationStatus').textContent.startsWith('Completato'));
    assert.equal(await page.locator('#pacMedian').innerText(), realExpected(initialMedian, await page.locator('#realTerms').isChecked()));

    await page.locator('.advanced summary').click();
    for (const id of ['riskFree', 'expectedReturn', 'volatility', 'ter', 'inflation', 'fee', 'jumpFrequency', 'jumpMean', 'seed']) await page.locator(`#${id}`).fill('0');
    await page.locator('#simulatorForm').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => document.getElementById('calculationStatus').textContent.startsWith('Completato'));
    assert.equal(await page.locator('#modelSharpe').innerText(), 'N.D.');
    assert.equal(await page.locator('#winRate').innerText(), '0,0%');
    assert.match(await page.locator('#otherWinRates').innerText(), /Parità: 100,0%/);
    assert.equal(await page.locator('#pacMedian').innerText(), await page.locator('#picMedian').innerText());
    await page.locator('#initial').fill('0');
    await page.locator('#recurring').fill('0');
    await page.locator('#simulatorForm').evaluate(form => form.requestSubmit());
    assert.match(await page.locator('#formError').innerText(), /almeno un versamento positivo/);
    await page.locator('#initial').fill('1000');
    await page.locator('#recurring').fill('100');
    await page.locator('#years').fill('40');
    await page.locator('#simulations').selectOption('50000');
    await page.locator('#simulatorForm').evaluate(form => form.requestSubmit());
    await page.locator('#cancelButton').click();
    assert.match(await page.locator('#calculationStatus').innerText(), /annullato/);
    assert.equal(await page.locator('#simulateButton').isDisabled(), false);
    assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(failedRequests, []);
    await context.close();
    const offline = await browser.newContext({ offline: true });
    const file = await offline.newPage();
    const offlineErrors = [];
    file.on('pageerror', e => offlineErrors.push(e.message));
    const { pathToFileURL } = require('node:url');
    await file.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await file.waitForFunction(() => document.getElementById('calculationStatus').textContent.startsWith('Completato'), null, { timeout: 60000 });
    assert.equal(await file.locator('#modelSharpe').innerText(), '0,127');
    assert.equal(await file.locator('#chartError').isVisible(), false);
    assert.deepEqual(offlineErrors, []);
    await offline.close();
    console.log(JSON.stringify({ result: 'Browser checks passed, including offline file opening and worker cancellation', screenshots: output, pageErrors, failedRequests }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

function realExpected(initial, showingReal) {
  // Reset restores simulation inputs; display-only controls are intentionally retained.
  if (!showingReal) return initial;
  const E = require('../engine.js');
  const r = E.simulate(E.DEFAULTS);
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(E.quantile(E.view(r, 'net', true).wealth.pac, 0.5));
}

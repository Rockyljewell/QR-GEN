// External ZXing photographic/negative corpus through ordinary public demo UI.
// Run from the QR-GEN checkout. No proprietary SDK objects, keys, source extraction or private calls.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { writeImageCamera } from './image-camera.mjs';
const metadataDir = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.QRGEN_COMPARISON_OUTPUT ?? metadataDir;
mkdirSync(outputDir, { recursive: true });
const repository = process.env.QRGEN_COMPARISON_REPO ?? process.cwd();
const taskRequire = createRequire(join(repository, 'package.json'));
const { chromium } = taskRequire('playwright');
const manifest = JSON.parse(readFileSync(join(metadataDir, 'corpus-manifest.json'), 'utf8'));
const prepared = JSON.parse(readFileSync(join(metadataDir, 'fixture-preparation.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const buildProof = JSON.parse(readFileSync(join(outputDir, 'qrgen-build-proof.json'), 'utf8'));
const expectedAssetSha256 = buildProof.sdkAsset.sha256;
if (sha256(readFileSync(join(repository, 'site/dist/sdk/qrgen.js'))) !== expectedAssetSha256) throw new Error('Pinned asset changed since build proof');
const sourceCommit = '37185d8c87bc5827942733e8e5716bc4a128af0a';
const executablePath = process.env.CHROMIUM_PATH ?? undefined;
const fixturePath = join(outputDir, 'comparison-active.y4m');
const reportPath = join(outputDir, 'public-photo-comparison.json');
const port = 4347;
const baseUrl = process.env.QRGEN_COMPARISON_URL ?? 'http://127.0.0.1:' + port + '/QR-GEN/demo/';
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), status: 'running',
  purpose: 'Bounded exact-input external-corpus UI observations; no latency or parity benchmark',
  source: { qrgenCommit: sourceCommit, qrgenBuild: 'Fresh build after verifying HEAD and clean web source at pinned commit',
    expectedQrgenSdkAssetSha256: expectedAssetSha256, expectedSiteAssets: buildProof.siteAssets, qrgenUrl: baseUrl, scanditUrl: 'https://websdk.demos.scandit.com/',
    corpusRepository: manifest.repository, corpusCommit: manifest.commit, selectionFrozenAt: manifest.selectionFrozenAt,
    selectionSha256: prepared.selectionSha256, fixtureHelperSha256: prepared.helperSha256 },
  environment: { viewport: { width: 1360, height: 960 }, observationWindowSeconds: 20, freshContextPerCaseAndVendor: true },
  limitations: [...manifest.limitations, 'No exact result is an inconclusive hosted-UI observation, not a diagnosed proprietary decoder defect.',
    'Negative outcomes mean no visible UI output in a bounded window, not a false-positive-rate estimate or proof of indefinite active decoding.'],
  results: [],
};
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const blocked = new Map();
let server;
let serverLog = '';
async function startServer() {
  if (process.env.QRGEN_COMPARISON_URL) return;
  const astro = join(dirname(taskRequire.resolve('astro/package.json')), 'bin/astro.mjs');
  server = spawn(process.execPath, [astro, 'preview', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'],
    { cwd: join(repository, 'site'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverLog = (serverLog + data).slice(-3000); });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Pinned preview server did not start: ' + serverLog);
}
async function diagnostics(page, vendor) {
  return page.evaluate(which => {
    const component = which === 'qrgen' ? document.querySelector('#demo-scanner') : null;
    const video = component?.shadowRoot?.querySelector('video') ?? document.querySelector('video');
    const track = video?.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : null;
    const settings = track?.getSettings();
    const preview = component?.shadowRoot?.querySelector('.preview');
    const finder = component?.shadowRoot?.querySelector('.vf');
    const rect = e => e?.getBoundingClientRect().toJSON() ?? null;
    const geometry = { videoRect: rect(video), videoObjectFit: video ? getComputedStyle(video).objectFit : null, videoObjectPosition: video ? getComputedStyle(video).objectPosition : null, previewRect: rect(preview), previewClientWidth: preview?.clientWidth ?? null, previewClientHeight: preview?.clientHeight ?? null, viewfinderRect: rect(finder), viewfinderClass: finder?.className ?? null };
    return { geometry, videoWidth: video?.videoWidth ?? null, videoHeight: video?.videoHeight ?? null,
      videoReadyState: video?.readyState ?? null, cameraTrackState: track?.readyState ?? null,
      frameRate: settings?.frameRate ?? null, crossOriginIsolated, sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
      ...(component ? { engine: component.scanner?.stats.engine, scannerState: component.scanner?.state, resolvedOptions: component.scanner?.options ?? null, elementAttributes: { mode: component.getAttribute('mode'), symbologies: component.getAttribute('symbologies') } } : {}) };
  }, vendor);
}
async function configureScandit(page, item, result) {
  await page.goto(report.source.scanditUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const initial = await page.locator('body').innerText();
  result.sdkVersion = initial.match(/v\.\d+\.\d+\.\d+/)?.[0] ?? null;
  if (result.sdkVersion !== 'v.8.6.1') throw new Error('Scandit displayed SDK version differs from prepared comparison: ' + result.sdkVersion);
  const inventory = await page.locator('input[id^="radio-scannerMode-"]').evaluateAll(es => es.map(e => e.id));
  report.scanditAvailablePresetIds ??= inventory;
  await page.locator('label[for="radio-scannerMode-' + item.publicUi.scandit.preset + '"]').click();
  result.colorInverted = await page.locator('#colorInverted').isChecked();
  await page.getByRole('button', { name: 'Start Scanner', exact: true }).click();
  await page.getByRole('button', { name: 'Start Scanning', exact: true }).click({ timeout: 20000 });
  await page.getByText('Settings', { exact: true }).click({ timeout: 20000 });
  const rows = page.locator('div.ui.toggle.checkbox');
  for (let i = 0; i < await rows.count(); i++) {
    const row = rows.nth(i), input = row.locator('input');
    if (await input.getAttribute('id') === 'extendSymbolsCounts') continue;
    const label = (await row.locator('label').innerText()).trim();
    if (await input.isChecked() !== item.publicUi.scandit.selectedSymbologies.includes(label)) await row.locator('label').click();
  }
  result.selectedSymbologies = await rows.evaluateAll(es => es.filter(e => e.querySelector('input')?.checked).map(e => e.querySelector('label')?.textContent?.trim()));
  result.extendedSymbolCounts = await page.locator('#extendSymbolsCounts').isChecked();
  if (JSON.stringify([...result.selectedSymbologies].sort()) !== JSON.stringify([...item.publicUi.scandit.selectedSymbologies].sort())) throw new Error('Visible Scandit format settings mismatch');
  await page.getByText('Settings', { exact: true }).click();
  const expand = page.getByRole('button', { name: 'Expand list', exact: true });
  if (await expand.isVisible()) { await expand.press('Enter'); await page.waitForTimeout(300); result.expandedListByKeyboard = true; }
  const clear = page.getByText('Clear List', { exact: true });
  if (await clear.isVisible()) {
    const box = await clear.boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= report.environment.viewport.height) { await clear.click(); result.clearActivation = 'pointer'; }
    else { await clear.focus(); await clear.press('Enter'); result.clearActivation = 'focus + Enter'; }
  }
  result.itemsImmediatelyAfterClear = (await page.locator('body').innerText()).match(/\b(\d+) items? scanned\b/)?.[1] ?? null;
  const resume = page.getByRole('button', { name: 'Resume Scanning', exact: true });
  if (await resume.isVisible()) { await resume.focus(); await resume.press('Enter'); result.resumeActivation = 'focus + Enter'; }
  result.configurationCompleted = true;
}
async function configureQrgen(page, item, result) {
  await page.goto(baseUrl, { waitUntil: 'load', timeout: 30000 });
  await page.getByText('Scanner settings', { exact: true }).click();
  const inputs = page.locator('[data-sym-grid] input');
  for (let i = 0; i < await inputs.count(); i++) { const input = inputs.nth(i); await input.setChecked(item.publicUi.qrgen.selectedSymbologies.includes(await input.inputValue())); }
  result.selectedSymbologies = await page.locator('[data-sym-grid] input:checked').evaluateAll(es => es.map(e => e.value));
  if (JSON.stringify([...result.selectedSymbologies].sort()) !== JSON.stringify([...item.publicUi.qrgen.selectedSymbologies].sort())) throw new Error('Visible QRGEN format settings mismatch');
  result.inversionSetting = 'alternate (public default)';
  await page.getByText('Scanner settings', { exact: true }).click();
  await page.locator('#demo-scanner').locator('button[data-a="start"]').click();
  result.configurationCompleted = true;
}
async function observe(page, item, vendor, result) {
  result.observationStartedAt = new Date().toISOString();
  if (item.negative) {
    await page.waitForTimeout(20000);
    if (vendor === 'qrgen') {
      result.visiblePayloads = await page.locator('.r-data').allInnerTexts();
      result.status = result.visiblePayloads.length === 0 ? 'no-visible-results-observed' : 'unexpected-visible-results';
    } else {
      const body = await page.locator('body').innerText();
      result.visibleItemCount = Number(body.match(/\b(\d+) items? scanned\b/)?.[1] ?? NaN);
      result.visiblePageDiagnostic = body.slice(-3500);
      result.status = result.visibleItemCount === 0 ? 'no-visible-results-observed' : 'inconclusive-unparsed-or-visible-results';
    }
    result.exactPayloadVisible = null;
  } else {
    const expected = item.expected[0].data;
    const exact = vendor === 'qrgen' ? page.locator('.r-data').filter({ hasText: expected }).first() : page.getByText(expected, { exact: true }).first();
    result.exactPayloadVisible = await exact.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
    if (result.exactPayloadVisible) {
      result.visiblePayload = await exact.innerText();
      result.exactPayloadVisible = result.visiblePayload === expected;
      result.visibleResult = (await (vendor === 'qrgen' ? page.locator('.result-item').first() : exact.locator('..')).innerText()).slice(0, 1000);
      if (vendor === 'scandit') report.scanditResultPublicDom ??= await exact.evaluate(e => ({ tag: e.tagName, className: e.className, parentTag: e.parentElement?.tagName, parentClassName: e.parentElement?.className }));
    }
    if (vendor === 'qrgen') result.visiblePayloads = await page.locator('.r-data').allInnerTexts();
    else result.visiblePageDiagnostic = (await page.locator('body').innerText()).slice(-3500);
    result.status = result.exactPayloadVisible ? 'exact-payload-visible' : 'inconclusive-no-exact-visible-result';
  }
}
save();
try {
  await startServer();
  for (const item of manifest.cases) {
    const fixture = await writeImageCamera(fixturePath, join(outputDir, item.image.local));
    const frozen = prepared.cases.find(c => c.id === item.id).fixture;
    if (fixture.y4mSha256 !== frozen.y4mSha256 || fixture.imageSha256 !== item.image.sha256) throw new Error('Fixture changed after selection: ' + item.id);
    const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + fixturePath] });
    report.browser = browser.version();
    try {
      for (const vendor of ['scandit', 'qrgen']) {
        const result = { caseId: item.id, vendor, negative: !!item.negative, expected: item.expected, conditions: item.conditions,
          fixture, sourceImageSha256: item.image.sha256, freshContext: true, pageErrors: [], consoleErrors: [] };
        if (blocked.has(vendor)) { result.status = 'skipped-public-ui-blocker'; result.blocker = blocked.get(vendor); report.results.push(result); save(); continue; }
        const context = await browser.newContext({ viewport: report.environment.viewport, ignoreHTTPSErrors: true });
        const page = await context.newPage();page.setDefaultTimeout(7000);
        const assetReads = [];
        page.on('pageerror', e => result.pageErrors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') result.consoleErrors.push(/license.?key/i.test(m.text()) ? 'License-key-related error omitted' : m.text().slice(0, 1000)); });
        if (vendor === 'qrgen') { result.loadedLocalAssets = []; page.on('response', response => { const url = new URL(response.url()); if (url.origin === new URL(baseUrl).origin && /\.(?:js|wasm)$/.test(url.pathname)) assetReads.push(response.body().then(bytes => { result.loadedLocalAssets.push({ path: url.pathname, sha256: sha256(bytes), bytes: bytes.length }); })); }); }
        try {
          await (vendor === 'scandit' ? configureScandit : configureQrgen)(page, item, result);
          await page.waitForFunction(which => { const el = which === 'qrgen' ? document.querySelector('#demo-scanner') : null; const video = el?.shadowRoot?.querySelector('video') ?? document.querySelector('video'); const track = video?.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : null; return video?.readyState === 4 && video.videoWidth === 640 && video.videoHeight === 480 && track?.readyState === 'live'; }, vendor, { timeout: 10000 });
          result.uiReadyForObservation = true;
          result.readyDiagnostics = await diagnostics(page, vendor);
          await observe(page, item, vendor, result);
          result.diagnostics = await diagnostics(page, vendor);
          await Promise.all(assetReads);
          if (vendor === 'qrgen' && (!result.loadedLocalAssets.some(a => /elements\..*\.js$/.test(a.path)) || result.loadedLocalAssets.some(a => buildProof.siteAssets[a.path]?.sha256 !== a.sha256))) { result.sourceMismatch = true; throw new Error('Loaded QRGEN JS/WASM assets differ from pinned build'); }
          if (result.pageErrors.length) result.status = 'page-error';
        } catch (error) {
          result.status = result.sourceMismatch ? 'source-pin-mismatch' : result.uiReadyForObservation ? 'observation-ui-blocker' : 'setup-blocker';
          result.errorCategory = error.name === 'TimeoutError' ? 'bounded-ui-timeout' : 'ui-or-configuration-error';
          result.error = error.message;result.visiblePageDiagnostic = (await page.locator('body').innerText().catch(() => '')).slice(-3500);
          result.diagnostics = await diagnostics(page, vendor).catch(() => null);
          blocked.set(vendor, error.message);
        } finally {
          result.observedAt = new Date().toISOString();report.results.push(result);save();
          console.log(JSON.stringify({ caseId: item.id, vendor, status: result.status, exact: result.exactPayloadVisible, pageErrors: result.pageErrors, consoleErrors: result.consoleErrors, error: result.error }));
          await context.close();
        }
        if (result.sourceMismatch) throw new Error('Stopping comparison after source-pin mismatch');
      }
    } finally { await browser.close(); }
  }
  report.status = 'complete';
} catch (error) { report.status = 'stopped'; report.error = error.message; throw error; }
finally {
  report.completedAt = new Date().toISOString();save();
  server?.kill();try { unlinkSync(fixturePath); } catch {}
}
console.log(JSON.stringify({ reportPath, status: report.status, summary: report.results.reduce((s,r) => {const key=r.vendor+':'+r.status;s[key]=(s[key]??0)+1;return s;}, {}) }));

// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its installed path.
// QUIET_BLOCK_BROWSER selects an Opera/Chrome executable; only a fresh profile is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const extension = path.resolve(__dirname, '..');
const sample = {
  videoDetails: { videoId: 'normal-video' }, playabilityStatus: { status: 'OK' },
  streamingData: { formats: [{ url: '/normal-media' }] },
  playerAds: [{ url: '/ad-media' }], adPlacements: [{ url: '/ad-media' }],
  adSlots: [{ url: '/ad-media' }], captions: { tracks: ['English'] }
};
const expected = { ...sample };
for (const key of ['playerAds', 'adPlacements', 'adSlots']) delete expected[key];
const profile = path.join(extension, 'work', `youtube-browser-${Date.now()}`);
const fixture = `<!doctype html><title>YouTube player data fixture</title>
<script>
var ytInitialPlayerResponse = ${JSON.stringify(sample)};
// Consume inline data immediately, before DOMContentLoaded or an async storage read.
window.initial = JSON.stringify(ytInitialPlayerResponse);
window.media = fetch(ytInitialPlayerResponse.adSlots?.[0]?.url || ytInitialPlayerResponse.streamingData.formats[0].url).then(r => r.text());
</script><h1>Local fixture</h1>`;
(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.QUIET_BLOCK_BROWSER || undefined,
    headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server']
  });
  try {
    const errors = [];
    const worker = context.serviceWorkers().find(w => w.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    const send = message => options.evaluate(message => chrome.runtime.sendMessage(message), message);
    const { settings } = await send({ type: 'get' });
    const save = async overrides => {
      const result = await send({ type: 'save', settings: { ...settings, ...overrides } });
      assert.equal(result.ok, true, result.error);
    };
    const requests = [];
    await context.route('https://*.youtube.com/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (/\/youtubei\/v1\//.test(url.pathname)) {
        const body = url.pathname.endsWith('/next') ? [{ playerResponse: sample }] : sample;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'x-fixture': 'yes' } });
      }
      if (url.pathname.endsWith('media')) return route.fulfill({ body: url.pathname });
      return route.fulfill({ contentType: 'text/html', body: fixture });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://www.youtube.com/watch?v=normal-video');
    assert.deepEqual(JSON.parse(await page.evaluate(() => window.initial)), expected);
    assert.equal(await page.evaluate(() => window.media), '/normal-media');
    assert.equal(requests.includes('/ad-media'), false);
    console.log('PASS document-start filter prevents the initial ad request before the first inline script consumes player data.');
    const fetches = await page.evaluate(async () => {
      const response = await fetch(new Request('/youtubei/v1/player', { method: 'POST', body: '{}' }));
      const clone = response.clone();
      return { url: response.url, type: response.type, header: response.headers.get('x-fixture'), json: await response.json(), text: await clone.text(), next: await (await fetch('/youtubei/v1/next')).json() };
    });
    assert.deepEqual(fetches.json, expected);
    assert.deepEqual(JSON.parse(fetches.text), expected);
    assert.deepEqual(fetches.next, [{ playerResponse: expected }]);
    assert.match(fetches.url, /\/youtubei\/v1\/player$/);
    assert.equal(fetches.type, 'basic'); assert.equal(fetches.header, 'yes');
    console.log('PASS native Request/fetch/Response/clone and navigation envelopes deliver only normal video data.');
    for (const type of ['', 'text', 'json']) {
      const data = await page.evaluate(type => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', '/youtubei/v1/player'); xhr.responseType = type;
        xhr.onload = () => resolve(type === 'json' ? xhr.response : JSON.parse(xhr.responseText));
        xhr.onerror = reject; xhr.send('{}');
      }), type);
      assert.deepEqual(data, expected);
    }
    console.log('PASS native XHR text and JSON responses filter ad scheduling.');
    // Switches affect both the currently open page and future document-start injection.
    for (const overrides of [{ youtube: false }, { enabled: false }, { allowed: ['youtube.com'] }, { allowed: ['www.youtube.com'] }]) {
      await save(overrides);
      // Deliver the storage notification to the existing document before making a request.
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(async () => (await (await fetch('/youtubei/v1/player')).json()).adSlots.length), 1);
      await page.reload();
      assert.deepEqual(JSON.parse(await page.evaluate(() => window.initial)), sample);
      assert.equal(await page.evaluate(() => window.media), '/ad-media');
      await save({}); await page.reload();
      assert.deepEqual(JSON.parse(await page.evaluate(() => window.initial)), expected);
    }
    console.log('PASS off switches and parent/subdomain exceptions preserve ads when requested; re-enabling restores prevention.');
    assert.deepEqual(errors, []);
    console.log('PASS no JavaScript errors in fixture playback paths.');
    await fs.writeFile(path.join(profile, 'result.json'), JSON.stringify({ passed: true, browser: context.browser().version(), version: await options.evaluate(() => chrome.runtime.getManifest().version), tests: 5 }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../youtube-block.js', import.meta.url), 'utf8');
const events = new Map();
let responseBody, responseStatus = 200, rejectFetch = false;
class XHR {
  open(method, url) { this.url = url; this.readyState = 1; this.responseType = ''; }
  get response() { return this.data; }
  get responseText() {
    if (this.responseType && this.responseType !== 'text') throw new Error('InvalidStateError');
    return this.data;
  }
}
const context = vm.createContext({
  URL, Response, Headers, XMLHttpRequest: XHR, Event, console,
  location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=content' },
  addEventListener: (name, callback) => events.set(name, callback),
  dispatchEvent: () => {},
  fetch: async () => {
    if (rejectFetch) throw new Error('Network failed');
    const response = new Response(responseStatus === 204 ? null : responseBody, { status: responseStatus, headers: { 'x-test': 'kept', 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
    return response;
  }
});
vm.runInContext('window = globalThis; top = globalThis;', context);
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const sample = { videoDetails: { videoId: 'content' }, playabilityStatus: { status: 'OK' }, streamingData: { formats: [{ url: 'https://video.example/content' }] }, playerAds: [{ url: '/ad-media' }], adPlacements: [{ url: '/ad-media' }], adSlots: [{ type: 'midroll' }], captions: { tracks: ['English'] } };
const expected = { ...sample }; delete expected.playerAds; delete expected.adPlacements; delete expected.adSlots;
const plain = data => JSON.parse(JSON.stringify(data));
run(`var ytInitialPlayerResponse = ${JSON.stringify(sample)};`);
assert.deepEqual(plain(run('ytInitialPlayerResponse')), expected);
console.log('PASS initial inline player data strips ad scheduling and preserves streams, captions and playability.');
context.raw = JSON.stringify([{ playerResponse: sample }, { unrelated: { adSlots: ['keep'] } }]);
assert.deepEqual(plain(run('JSON.parse(raw)')), [{ playerResponse: expected }, { unrelated: { adSlots: ['keep'] } }]);
assert.equal(run(`JSON.parse('{"n":2}', (key, value) => key === "n" ? value * 3 : value).n`), 6);
assert.throws(() => run('JSON.parse("invalid")'));
assert.deepEqual(plain(run(`JSON.parse('{"adSlots":[1]}')`)), { adSlots: [1] });
run('JSON.parse("{}", (key, value) => { if (key === "") value.playerResponse = value; return value; });');
console.log('PASS JSON envelopes, revivers, errors and unrelated objects retain normal semantics.');

responseBody = JSON.stringify(sample);
let response = await run('fetch("/youtubei/v1/player?prettyPrint=false")');
assert.equal(response.url, 'https://www.youtube.com/youtubei/v1/player');
assert.equal(response.headers.get('x-test'), 'kept');
const clone = response.clone();
assert.equal(clone.url, response.url);
assert.deepEqual(await clone.json(), expected);
assert.deepEqual(JSON.parse(await response.text()), expected);
assert.equal(response.bodyUsed, true);
await assert.rejects(response.text());
response = await run('fetch("/youtubei/v1/player")');
assert.deepEqual(JSON.parse(await new Response(response.body).text()), expected);
console.log('PASS fetch json/text/clone/body-stream reads all remove ad instructions and preserve response metadata.');
for (const url of ['/other-api', 'https://youtube.com.attacker.test/youtubei/v1/player']) {
  response = await run(`fetch(${JSON.stringify(url)})`);
  assert.deepEqual(await response.json(), sample);
}
responseBody = 'not JSON';
assert.equal(await (await run('fetch("/youtubei/v1/player")')).text(), 'not JSON');
responseStatus = 403; responseBody = JSON.stringify(sample);
assert.deepEqual(await (await run('fetch("/youtubei/v1/player")')).json(), sample);
responseStatus = 204;
assert.equal((await run('fetch("/youtubei/v1/player")')).status, 204);
responseStatus = 200; rejectFetch = true;
await assert.rejects(run('fetch("/youtubei/v1/player")'), /Network failed/);
rejectFetch = false;
console.log('PASS unrelated endpoints, errors, malformed bodies and empty responses pass through.');
context.sample = JSON.stringify(sample);
run('xhr = new XMLHttpRequest(); xhr.open("POST", "/youtubei/v1/player"); xhr.data = sample; xhr.readyState = 4;');
assert.deepEqual(JSON.parse(run('xhr.responseText')), expected);
assert.deepEqual(JSON.parse(run('xhr.response')), expected);
run('xhr.open("GET", "/unrelated"); xhr.data = sample; xhr.readyState = 4;');
assert.equal(run('xhr.responseText'), JSON.stringify(sample));
run('xhr.open("POST", "/youtubei/v1/next"); xhr.responseType = "json"; xhr.data = {playerResponse: JSON.parse(sample)}; xhr.readyState = 4;');
assert.deepEqual(plain(run('xhr.response')), { playerResponse: expected });
assert.throws(() => run('xhr.responseText'), /InvalidStateError/);
console.log('PASS XHR text/JSON filtering, reused requests and native getter errors.');
events.get('quiet-block-config')({ detail: { youtube: false } });
run(`ytInitialPlayerResponse = ${JSON.stringify(sample)};`);
assert.deepEqual(plain(run('ytInitialPlayerResponse')), sample);
context.raw = JSON.stringify(sample);
assert.deepEqual(plain(run('JSON.parse(raw)')), sample);
assert.deepEqual(await (await run('fetch("/youtubei/v1/player")')).json(), sample);
run('xhr.open("POST", "/youtubei/v1/player"); xhr.data = sample; xhr.readyState = 4;');
assert.equal(run('xhr.responseText'), JSON.stringify(sample));
console.log('PASS disabling YouTube filtering stops every interceptor for subsequent data.');

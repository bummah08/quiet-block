import assert from 'node:assert/strict';
import { compareVersions, startLocalUpdateChecks, readUpdateStatus, UPDATE_ALARM } from '../update-bridge.mjs';
assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
assert.equal(compareVersions('1.1', '1.1.0'), 0);
assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
assert.throws(() => compareVersions('1.2.beta', '1.0'));
assert.throws(() => compareVersions('1.99999', '1.0'));
let listener, reloads = 0, creates = 0;
const api = {
  runtime: { getURL: path => `chrome-extension://test/${path}`, getManifest: () => ({ version: '1.1.0' }), reload: () => { reloads++; } },
  alarms: { get: async () => undefined, create: async () => { creates++; }, onAlarm: { addListener: callback => { listener = callback; } } }
};
let marker = { managed: true, version: '1.1.0' };
const fetcher = async (url, options) => {
  assert.equal(url, 'chrome-extension://test/local-update.json'); assert.equal(options.cache, 'no-store');
  return { ok: true, json: async () => marker };
};
startLocalUpdateChecks(api, fetcher);
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle(); assert.equal(creates, 1); assert.equal(reloads, 0);
marker = { managed: true, version: '1.0.0' }; listener({ name: UPDATE_ALARM }); await settle(); assert.equal(reloads, 0);
marker = { managed: false, version: '2.0.0' }; listener({ name: UPDATE_ALARM }); await settle(); assert.equal(reloads, 0);
marker = { managed: true, version: '1.2.0' }; listener({ name: 'different-alarm' }); await settle(); assert.equal(reloads, 0);
listener({ name: UPDATE_ALARM }); await settle(); assert.equal(reloads, 1);
assert.deepEqual(await readUpdateStatus(api, async () => { throw new Error('Missing file'); }), { managed: false });
console.log('PASS version comparison, alarm registration, newer managed release reload, unchanged/older/unmanaged rejection, and missing-file recovery.');

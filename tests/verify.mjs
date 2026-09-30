import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { domainFrom, parseList, exceptionFor, buildRules, DEFAULTS, AD_DOMAINS } from '../rules.mjs';
let passed = 0;
function test(name, action) { action(); passed++; console.log(`PASS ${name}`); }
test('normalizes pasted URLs and international domains', () => {
  assert.equal(domainFrom('https://ADS.Example.com/path?q=a'), 'ads.example.com');
  assert.equal(domainFrom('*.Example.com.'), 'example.com');
  assert.equal(domainFrom('münchen.de'), 'xn--mnchen-3ya.de');
});
test('rejects filters, credentials, IPs, and unsafe schemes', () => {
  for (const input of ['||example.com^', 'a b.com', 'https://user@example.com', 'javascript:alert(1)', 'ftp://example.com', 'localhost', '127.0.0.1', '-bad.example']) assert.throws(() => domainFrom(input), input);
});
test('deduplicates domain lists and ignores comment lines', () => assert.deepEqual(parseList('# note\nA.example\nhttps://a.example/path\nb.example'), ['a.example', 'b.example']));
test('enforces list size limit', () => assert.throws(() => parseList(Array.from({ length: 1001 }, (_, i) => `a${i}.example`).join('\n'))));
test('exceptions match only full labels and their subdomains', () => {
  assert.equal(exceptionFor('www.example.com', ['example.com']), 'example.com');
  assert.equal(exceptionFor('notexample.com', ['example.com']), null);
  assert.equal(exceptionFor('example.com.attacker.test', ['example.com']), null);
});
test('global off removes every network rule', () => assert.deepEqual(buildRules({ ...DEFAULTS, enabled: false }), []));
test('bundled domains are unique and valid', () => {
  assert.equal(new Set(AD_DOMAINS).size, AD_DOMAINS.length);
  for (const domain of AD_DOMAINS) assert.equal(domainFrom(domain), domain);
});
test('custom-only mode omits bundled domains', () => {
  const rules = buildRules({ ...DEFAULTS, builtIn: false, blocked: ['ads.example'] });
  assert.deepEqual(rules.find(rule => rule.id === 1).condition.requestDomains, ['ads.example']);
});
test('navigation protection and site exceptions have explicit priorities', () => {
  const rules = buildRules({ ...DEFAULTS, allowed: ['site.example'] });
  const navigation = rules.find(rule => rule.id === 3), exception = rules.find(rule => rule.id === 2);
  assert.deepEqual(navigation.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(navigation.condition.excludedInitiatorDomains, ['site.example']);
  assert.equal(exception.action.type, 'allowAllRequests');
  assert.ok(exception.priority > navigation.priority);
});
test('empty custom-only list produces no rules', () => assert.deepEqual(buildRules({ ...DEFAULTS, builtIn: false }), []));

// Exercise worker state transitions, serialized writes, and a failed rule update.
let onMessage, saved = {}, rules = [], failNext = false, scripts = [], failScript = false;
globalThis.chrome = {
  runtime: { id: 'test', getURL: path => path, getManifest: () => ({ version: '1.1.0' }), onMessage: { addListener: listener => { onMessage = listener; } } },
  alarms: { get: async () => ({}), create: async () => {}, onAlarm: { addListener: () => {} } },
  storage: { local: { get: async () => structuredClone(saved), set: async value => { saved = { ...saved, ...structuredClone(value) }; } } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  scripting: {
    getRegisteredContentScripts: async () => structuredClone(scripts),
    registerContentScripts: async input => { scripts = structuredClone(input); },
    updateContentScripts: async input => {
      if (failScript) { failScript = false; throw new Error('Script registration rejected'); }
      scripts = structuredClone(input);
    },
    unregisterContentScripts: async () => { scripts = []; }
  },
  declarativeNetRequest: {
    getDynamicRules: async () => structuredClone(rules),
    updateDynamicRules: async update => {
      if (failNext) { failNext = false; throw new Error('Simulated rule rejection'); }
      rules = [...rules.filter(rule => !update.removeRuleIds.includes(rule.id)), ...structuredClone(update.addRules)];
    }
  }
};
const source = (await fs.readFile(new URL('../background.js', import.meta.url), 'utf8')).replace("'./rules.mjs'", JSON.stringify(new URL('../rules.mjs', import.meta.url).href)).replace("'./update-bridge.mjs'", JSON.stringify(new URL('../update-bridge.mjs', import.meta.url).href));
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const send = message => new Promise(resolve => onMessage(message, { id: 'test' }, resolve));
await send({ type: 'get' });
const first = await send({ type: 'save', settings: { ...DEFAULTS, blocked: ['ads.example'] } });
assert.equal(first.ok, true);
failNext = true;
const failed = await send({ type: 'save', settings: { ...DEFAULTS, blocked: ['other.example'] } });
test('failed rule updates restore stored settings and retain prior rules', () => {
  assert.equal(failed.ok, false); assert.deepEqual(saved.settings.blocked, ['ads.example']);
  assert.ok(rules[0].condition.requestDomains.includes('ads.example'));
  assert.ok(!rules[0].condition.requestDomains.includes('other.example'));
});
await Promise.all([send({ type: 'toggle' }), send({ type: 'toggle' })]);
test('simultaneous toggles are serialized without losing a write', () => assert.equal(saved.settings.enabled, true));
await send({ type: 'save', settings: { ...DEFAULTS, allowed: ['example.com'] } });
const parent = await send({ type: 'site', host: 'news.example.com' });
test('child toggle does not silently remove a parent-domain exception', () => { assert.equal(parent.ok, false); assert.deepEqual(saved.settings.allowed, ['example.com']); });
test('YouTube filtering is persistent and runs before site code', () => {
  assert.equal(scripts[0].runAt, 'document_start'); assert.equal(scripts[0].world, 'MAIN');
  assert.equal(scripts[0].persistAcrossSessions, true); assert.equal(scripts[0].allFrames, false);
});
await send({ type: 'save', settings: { ...DEFAULTS, allowed: ['www.youtube.com'] } });
test('YouTube subdomain exceptions exclude script injection', () => assert.deepEqual(scripts[0].excludeMatches, ['*://*.www.youtube.com/*']));
await send({ type: 'save', settings: { ...DEFAULTS, allowed: ['youtube.com'] } });
test('YouTube parent exception removes filter registration', () => assert.equal(scripts.length, 0));
await send({ type: 'save', settings: { ...DEFAULTS, youtube: false } });
test('YouTube switch off removes filter registration', () => assert.equal(scripts.length, 0));
await send({ type: 'save', settings: DEFAULTS });
failScript = true;
const scriptFailure = await send({ type: 'save', settings: { ...DEFAULTS, blocked: ['rollback.example'] } });
test('script registration failure rolls back both settings and network rules', () => {
  assert.equal(scriptFailure.ok, false); assert.deepEqual(saved.settings.blocked, []);
  assert.ok(!rules[0].condition.requestDomains.includes('rollback.example'));
  assert.equal(scripts.length, 1);
});
await send({ type: 'toggle' });
test('global off unregisters the player filter', () => assert.equal(scripts.length, 0));
console.log(`${passed} checks passed.`);

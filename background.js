import { AD_DOMAINS, DEFAULTS, normalizeSettings, domainFrom, exceptionFor, buildRules } from './rules.mjs';
import { startLocalUpdateChecks, readUpdateStatus } from './update-bridge.mjs';

startLocalUpdateChecks();

async function readSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings || DEFAULTS);
}

async function installRules(settings) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id), addRules: buildRules(settings)
  });
}

async function badge(settings) {
  // Badge is global; a website exception is shown explicitly in the popup.
  await chrome.action.setBadgeText({ text: settings.enabled ? 'ON' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: settings.enabled ? '#6d5ef5' : '#64748b' });
  await chrome.action.setTitle({ title: settings.enabled ? 'Quiet Block: on (site exceptions may apply)' : 'Quiet Block: off' });
}

async function commit(input) {
  const next = normalizeSettings(input);
  const previous = await readSettings();
  // Save desired state first: if the worker is interrupted, startup reconciles it.
  await chrome.storage.local.set({ settings: next });
  try { await installRules(next); }
  catch (error) {
    await chrome.storage.local.set({ settings: previous });
    throw new Error(`Could not apply the rules: ${error.message}`);
  }
  await badge(next);
  return next;
}

let queue = Promise.resolve();
function serial(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}

// Dynamic rules persist without an active service worker. Reconcile stored state
// whenever the worker starts, including after extension updates and browser restarts.
const initialized = serial(async () => {
  const settings = await readSettings();
  await installRules(settings);
  await badge(settings);
});
initialized.catch(error => console.error('Quiet Block initialization failed:', error));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  serial(async () => {
    await initialized;
    if (message.type === 'updates') return { ok: true, updates: await readUpdateStatus() };
    let settings = await readSettings();
    if (message.type === 'get') return { ok: true, settings, builtInDomains: AD_DOMAINS };
    if (message.type === 'toggle') settings = await commit({ ...settings, enabled: !settings.enabled });
    else if (message.type === 'site') {
      const host = domainFrom(message.host);
      const exception = exceptionFor(host, settings.allowed);
      if (exception && exception !== host) throw new Error(`This site is covered by the ${exception} exception. Remove that parent domain in Settings to enable blocking here.`);
      settings = await commit({ ...settings, allowed: exception ? settings.allowed.filter(domain => domain !== host) : [...settings.allowed, host] });
    } else if (message.type === 'save') settings = await commit(message.settings);
    else throw new Error('Unknown request.');
    return { ok: true, settings, builtInDomains: AD_DOMAINS };
  }).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

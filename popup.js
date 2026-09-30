import { domainFrom, exceptionFor } from './rules.mjs';
const $ = id => document.getElementById(id);
let tab, host = '', settings;
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Try reloading it.');
  return result;
}
function render() {
  const exception = host && exceptionFor(host, settings.allowed);
  $('mode').textContent = !settings.enabled ? 'Blocking is off' : exception ? 'Paused on this site' : 'Blocking is on';
  $('summary').textContent = !settings.enabled ? 'Websites can load normally.' : exception ? 'Filtering and page protections are paused here.' : 'Ad domains filtered' + (settings.popups ? ' · automatic pop-ups blocked' : '') + (settings.youtube ? ' · YouTube ad filter on' : '');
  $('power').textContent = settings.enabled ? 'Turn off everywhere' : 'Turn on blocking';
  $('power').disabled = false;
  $('site').disabled = !host || !settings.enabled;
  $('site').textContent = exception ? 'Enable on this site' : 'Pause on this site';
  $('host').textContent = host || 'Open a regular website to use site controls.';
}
async function change(message) {
  $('power').disabled = true; $('site').disabled = true;
  try {
    ({ settings } = await request(message));
    $('message').textContent = 'Saved. Reload the page to apply the change to all its content.';
    $('reload').hidden = !host;
  } catch (error) { $('message').textContent = error.message; }
  finally { render(); }
}
$('power').addEventListener('click', () => change({ type: 'toggle' }));
$('site').addEventListener('click', () => change({ type: 'site', host }));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('reload').addEventListener('click', async () => {
  try { await chrome.tabs.reload(tab.id); window.close(); }
  catch (error) { $('message').textContent = error.message; }
});
async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:\/\//.test(tab.url)) {
    try { host = domainFrom(tab.url); } catch {}
  }
  ({ settings } = await request({ type: 'get' }));
  render();
}
init().catch(error => { $('message').textContent = error.message; });

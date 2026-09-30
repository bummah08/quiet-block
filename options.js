import { parseList } from './rules.mjs';
const $ = id => document.getElementById(id);
let dirty = false;
function fill(settings) {
  $('enabled').checked = settings.enabled; $('builtIn').checked = settings.builtIn;
  $('popups').checked = settings.popups; $('youtube').checked = settings.youtube;
  $('blocked').value = settings.blocked.join('\n'); $('allowed').value = settings.allowed.join('\n');
}
$('form').addEventListener('input', () => { dirty = true; $('status').textContent = 'Unsaved changes'; });
$('form').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const settings = { enabled: $('enabled').checked, builtIn: $('builtIn').checked, popups: $('popups').checked, youtube: $('youtube').checked, blocked: parseList($('blocked').value), allowed: parseList($('allowed').value) };
    const result = await chrome.runtime.sendMessage({ type: 'save', settings });
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings.');
    fill(result.settings); dirty = false;
    $('status').textContent = 'Saved. Reload affected pages.';
  } catch (error) { $('status').textContent = error.message; }
  finally { $('save').disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  if (dirty) $('status').textContent = 'Settings changed in another window. Saving here will replace them.';
  else fill(changes.settings.newValue);
});
async function init() {
  const result = await chrome.runtime.sendMessage({ type: 'get' });
  if (!result?.ok) throw new Error(result?.error || 'Could not load settings.');
  fill(result.settings);
  $('builtinList').textContent = result.builtInDomains.join('\n');
  $('builtinSummary').textContent = `View ${result.builtInDomains.length} bundled domains`;
  $('status').textContent = 'Ready'; $('save').disabled = false;
  const updateResult = await chrome.runtime.sendMessage({ type: 'updates' });
  const updates = updateResult?.updates;
  $('updates').textContent = updates?.managed
    ? `Windows updater configured. Installed package: ${updates.version}${updates.installedAt ? ' · ' + new Date(updates.installedAt).toLocaleString() : ''}. The helper checks GitHub hourly while you are signed in to Windows; Opera checks the local files each minute.`
    : 'Manual installation. Run scripts/Install-Updates.ps1 to set up private GitHub release updates. Browser-store updates are not configured.';
}
init().catch(error => { $('status').textContent = error.message; });

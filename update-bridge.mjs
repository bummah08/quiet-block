export const UPDATE_ALARM = 'quiet-block-local-update';

export function compareVersions(left, right) {
  const parts = value => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(value)) throw new Error('Invalid extension version.');
    const numbers = value.split('.').map(Number);
    if (numbers.some(number => number > 65535)) throw new Error('Invalid extension version.');
    return [...numbers, 0, 0, 0, 0].slice(0, 4);
  };
  const a = parts(left), b = parts(right);
  for (let index = 0; index < 4; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

export async function readUpdateStatus(api = chrome, fetcher = fetch) {
  try {
    const response = await fetcher(api.runtime.getURL('local-update.json'), { cache: 'no-store' });
    if (!response.ok) return { managed: false };
    const marker = await response.json();
    if (marker.managed !== true || typeof marker.version !== 'string') return { managed: false };
    compareVersions(marker.version, api.runtime.getManifest().version);
    return { managed: true, version: marker.version, installedAt: marker.installedAt || null };
  } catch { return { managed: false }; }
}

export function startLocalUpdateChecks(api = chrome, fetcher = fetch) {
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    try {
      const marker = await readUpdateStatus(api, fetcher);
      if (marker.managed && compareVersions(marker.version, api.runtime.getManifest().version) > 0) api.runtime.reload();
    } finally { checking = false; }
  }
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === UPDATE_ALARM) void check().catch(() => {});
  });
  // Recreate the alarm after browser/worker restarts; inspect only bundled local data.
  void (async () => {
    if (!await api.alarms.get(UPDATE_ALARM)) await api.alarms.create(UPDATE_ALARM, { periodInMinutes: 1 });
    await check();
  })().catch(() => {});
}

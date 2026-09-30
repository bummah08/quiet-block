// A deliberately small, editable starter set. No remote filter subscriptions.
export const AD_DOMAINS = Object.freeze([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'amazon-adsystem.com',
  'adnxs.com', 'adsrvr.org', 'adform.net', 'adroll.com', 'advertising.com',
  'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com',
  'criteo.com', 'criteo.net', 'smartadserver.com',
  'outbrain.com', 'taboola.com', 'revcontent.com', 'mgid.com',
  'yieldmo.com', 'sharethrough.com', 'triplelift.com', 'bidswitch.net',
  'bidr.io', 'lijit.com', 'sovrn.com', 'media.net', 'teads.tv'
].filter((domain, index, all) => all.indexOf(domain) === index));

export const DEFAULTS = Object.freeze({ enabled: true, builtIn: true, popups: true, youtube: true, blocked: [], allowed: [] });

export function domainFrom(value) {
  if (typeof value !== 'string') throw new Error('Enter a domain name.');
  const input = value.trim().replace(/^\*\./, '');
  if (!input || /\s|[\\|^]/.test(input)) throw new Error(`Invalid domain: ${value}`);
  let url;
  try { url = new URL(input.includes('://') ? input : `https://${input}`); }
  catch { throw new Error(`Invalid domain: ${value}`); }
  const domain = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || domain.length > 253 || !domain.includes('.') || /^\d+(\.\d+){3}$/.test(domain) || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error(`Use a website domain such as example.com: ${value}`);
  }
  return domain;
}

export function parseList(text) {
  if (typeof text !== 'string' || text.length > 250000) throw new Error('List is too large.');
  const domains = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(domainFrom);
  const unique = [...new Set(domains)].sort();
  if (unique.length > 1000) throw new Error('Use at most 1,000 domains per list.');
  return unique;
}

export function normalizeSettings(input = {}) {
  if (typeof input.enabled !== 'boolean' || typeof input.builtIn !== 'boolean' || !Array.isArray(input.blocked) || !Array.isArray(input.allowed)) throw new Error('Invalid settings.');
  return { enabled: input.enabled, builtIn: input.builtIn, popups: input.popups !== false, youtube: input.youtube !== false,
    blocked: parseList(input.blocked.join('\n')), allowed: parseList(input.allowed.join('\n')) };
}

export function exceptionFor(host, allowed) {
  return allowed.find(domain => host === domain || host.endsWith(`.${domain}`)) || null;
}

export function buildRules(input) {
  const settings = normalizeSettings(input);
  if (!settings.enabled) return [];
  const blocked = [...new Set([...(settings.builtIn ? AD_DOMAINS : []), ...settings.blocked])].sort();
  const rules = [];
  if (blocked.length) rules.push({ id: 1, priority: 1, action: { type: 'block' }, condition: {
    requestDomains: blocked, excludedResourceTypes: ['main_frame']
  } });
  if (blocked.length) rules.push({ id: 3, priority: 1, action: { type: 'block' }, condition: {
    requestDomains: blocked, resourceTypes: ['main_frame'],
    ...(settings.allowed.length ? { excludedInitiatorDomains: settings.allowed } : {})
  } });
  // A top-level allow rule exempts the entire frame tree on the next page load.
  if (settings.allowed.length) rules.push({ id: 2, priority: 100, action: { type: 'allowAllRequests' }, condition: {
    requestDomains: settings.allowed, resourceTypes: ['main_frame']
  } });
  return rules;
}

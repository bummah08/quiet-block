(() => {
  // Registered at document_start only on enabled, non-exempt YouTube pages.
  // MAIN world is necessary: isolated content scripts cannot filter player data.
  if (window !== window.top || !/(^|\.)youtube\.com$/.test(location.hostname)) return;
  let enabled = true;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const adKeys = ['playerAds', 'adPlacements', 'adSlots'];

  function clean(value, player = false, seen = new WeakSet()) {
    if (!enabled || !value || typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);
    let changed = false;
    if (Array.isArray(value)) {
      for (const item of value) changed = clean(item, false, seen) || changed;
      return changed;
    }
    // Only known player-response envelopes, never arbitrary recursive key removal.
    if (player || value.videoDetails || value.playabilityStatus || value.streamingData) {
      for (const key of adKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          try { changed = delete value[key] || changed; } catch {}
        }
      }
    }
    if (value.playerResponse) changed = clean(value.playerResponse, true, seen) || changed;
    return changed;
  }

  function filterText(text) {
    if (!enabled || typeof text !== 'string' || !/"(?:playerAds|adPlacements|adSlots)"/.test(text)) return text;
    try {
      const data = Reflect.apply(parse, JSON, [text]);
      return clean(data) ? stringify(data) : text;
    } catch { return text; } // Preserve malformed/non-JSON responses exactly.
  }

  function playerURL(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      return /(^|\.)youtube\.com$/.test(url.hostname) &&
        (/^\/youtubei\/v1\/(player|next)\/?$/.test(url.pathname) ||
         (url.pathname === '/watch' && url.searchParams.get('pbj') === '1'));
    } catch { return false; }
  }

  // YouTube's first response is often an inline object, not a network JSON parse.
  const descriptor = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
  if (!descriptor || (descriptor.configurable && 'value' in descriptor)) {
    let initial = descriptor?.value;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true, enumerable: descriptor?.enumerable ?? true,
      get() { clean(initial, true); return initial; },
      set(value) { clean(value, true); initial = value; }
    });
  }

  JSON.parse = new Proxy(parse, {
    apply(target, context, args) {
      const data = Reflect.apply(target, context, args);
      clean(data);
      return data;
    }
  });

  function withMetadata(response, source) {
    for (const key of ['url', 'redirected', 'type']) {
      Object.defineProperty(response, key, { value: source[key], configurable: true });
    }
    const clone = response.clone;
    Object.defineProperty(response, 'clone', {
      value() { return withMetadata(Reflect.apply(clone, this, []), source); }, configurable: true
    });
    return response;
  }

  window.fetch = new Proxy(window.fetch, {
    async apply(target, context, args) {
      const response = await Reflect.apply(target, context, args);
      if (!enabled || !playerURL(args[0]) || !response.ok || [204, 205].includes(response.status)) return response;
      try {
        const original = await response.clone().text();
        const filtered = filterText(original);
        if (original === filtered) return response;
        const headers = new Headers(response.headers);
        headers.delete('content-length'); headers.delete('content-encoding');
        return withMetadata(new Response(filtered, {
          status: response.status, statusText: response.statusText, headers
        }), response);
      } catch { return response; }
    }
  });

  // Older player paths use XHR. Wrap native getters without taking over events.
  const requests = new WeakMap();
  const prototype = XMLHttpRequest.prototype;
  prototype.open = new Proxy(prototype.open, {
    apply(target, context, args) {
      const result = Reflect.apply(target, context, args);
      requests.set(context, { player: playerURL(args[1]) });
      return result;
    }
  });
  for (const key of ['response', 'responseText']) {
    const native = Object.getOwnPropertyDescriptor(prototype, key);
    if (!native?.get || !native.configurable) continue;
    Object.defineProperty(prototype, key, { ...native, get() {
      const value = Reflect.apply(native.get, this, []);
      const request = requests.get(this);
      if (!enabled || !request?.player || this.readyState !== 4) return value;
      if (key === 'response' && this.responseType === 'json') { clean(value); return value; }
      if (this.responseType && this.responseType !== 'text') return value;
      if (request.original !== value) {
        request.original = value; request.filtered = filterText(value);
      }
      return request.filtered;
    } });
  }

  window.addEventListener('quiet-block-config', event => {
    if (typeof event.detail?.youtube !== 'boolean') return;
    enabled = event.detail.youtube;
  });
  window.dispatchEvent(new Event('quiet-block-request-config'));
})();

(() => {
  let config = { popups: false, youtube: false };
  let timer = null, style = null;
  const mutedVideos = new Map();
  const clicked = new WeakMap();
  const youtubePage = /(^|\.)youtube\.com$/.test(location.hostname) && window === window.top;

  let ready = false;
  function publish() { if (ready) window.dispatchEvent(new CustomEvent('quiet-block-config', { detail: config })); }
  window.addEventListener('quiet-block-request-config', publish);

  function restore(video, previous) {
    if (video.isConnected && video.muted) video.muted = previous;
    mutedVideos.delete(video);
  }

  function tick() {
    if (!config.youtube || !youtubePage) return;
    const player = document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing');
    const video = player?.querySelector('video');
    for (const [old, previous] of mutedVideos) if (old !== video) restore(old, previous);
    if (!player) return;
    if (video) {
      if (!mutedVideos.has(video)) mutedVideos.set(video, video.muted);
      video.muted = true;
    }
    const button = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (button && !button.disabled && button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden' && Date.now() - (clicked.get(button) || 0) > 1500) {
      clicked.set(button, Date.now()); button.click();
    }
  }

  function updateYouTube() {
    if (config.youtube && youtubePage) {
      if (!style && document.documentElement) {
        style = document.createElement('style');
        style.textContent = 'ytd-ad-slot-renderer,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,ytd-in-feed-ad-layout-renderer,#player-ads{display:none!important}';
        document.documentElement.appendChild(style);
      }
      if (!timer) timer = setInterval(tick, 400);
      tick();
    } else {
      clearInterval(timer); timer = null;
      style?.remove(); style = null;
      for (const [video, previous] of mutedVideos) restore(video, previous);
    }
  }

  function apply(settings = {}) {
    let topHost = location.hostname;
    try {
      const ancestors = location.ancestorOrigins;
      if (ancestors?.length) topHost = new URL(ancestors[ancestors.length - 1]).hostname;
    } catch {}
    const exempt = (settings.allowed || []).some(domain => topHost === domain || topHost.endsWith(`.${domain}`));
    const enabled = settings.enabled !== false && !exempt;
    config = { popups: enabled && settings.popups !== false, youtube: enabled && settings.youtube !== false };
    ready = true;
    publish(); updateYouTube();
  }
  chrome.storage.local.get('settings').then(({ settings }) => apply(settings)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });
  document.addEventListener('DOMContentLoaded', updateYouTube, { once: true });
})();

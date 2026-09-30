(() => {
  // Runs in the page's world so it can intercept calls to window.open.
  // This is a convenience filter, not a security boundary against hostile pages.
  let enabled = false;
  window.addEventListener('quiet-block-config', event => {
    enabled = event.detail?.popups === true;
  });
  const original = window.open;
  window.open = new Proxy(original, {
    apply(target, context, args) {
      const name = typeof args[1] === 'string' ? args[1].toLowerCase() : '';
      // In-place navigation is governed by network rules, not the pop-up guard.
      if (enabled && !['_self', '_parent', '_top'].includes(name) && !navigator.userActivation?.isActive) return null;
      return Reflect.apply(target, context, args);
    }
  });
  window.dispatchEvent(new Event('quiet-block-request-config'));
})();

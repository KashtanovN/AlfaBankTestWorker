(() => {
  'use strict';
  const eventName = 'alfa-qti-helper-document';
  const nativeFetch = window.fetch;
  let latest;
  const isQti = value => {
    try {
      const u = new URL(value, location.href);
      return u.origin === location.origin && /\/qti\/?$/i.test(u.pathname);
    } catch { return false; }
  };
  const publish = (url, xml) => {
    if (typeof xml !== 'string' || xml.length > 8000000 || !/<(?:\w+:)?(?:questestinterop|assessment|item)[\s>]/i.test(xml)) return;
    latest = JSON.stringify({url: String(url), xml});
    window.dispatchEvent(new CustomEvent(eventName, {detail: latest}));
  };
  window.addEventListener('alfa-qti-helper-ready', () => {
    if (latest) window.dispatchEvent(new CustomEvent(eventName, {detail: latest}));
  });
  window.fetch = function (...args) {
    const result = Reflect.apply(nativeFetch, this, args);
    const url = args[0] instanceof Request ? args[0].url : args[0];
    if (isQti(url)) result.then(r => { if (r.ok) r.clone().text().then(t => publish(url, t)).catch(() => {}); }).catch(() => {});
    return result;
  };
  const open = XMLHttpRequest.prototype.open;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    urls.set(this, url);
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (isQti(urls.get(this))) this.addEventListener('load', () => {
      try {
        if (this.status < 200 || this.status >= 300) return;
        const xml = this.responseType === 'document' ? new XMLSerializer().serializeToString(this.responseXML) : this.responseText;
        publish(urls.get(this), xml);
      } catch {}
    }, {once: true});
    return Reflect.apply(send, this, args);
  };
  const recovered = new Set();
  window.addEventListener('alfa-qti-helper-reload', () => {
    const entries = performance.getEntriesByType('resource').filter(e => isQti(e.name));
    const entry = entries.at(-1);
    if (!entry || recovered.has(entry.name)) return;
    recovered.add(entry.name);
    Reflect.apply(nativeFetch, window, [entry.name, {credentials: 'same-origin'}])
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(t => publish(entry.name, t)).catch(() => recovered.delete(entry.name));
  });
})();

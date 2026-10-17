/**
 * 03-window.js —— Window / Document / Navigator / Screen / Location / Performance / Storage / 定时器
 */

'use strict';

// ══════════════════════════════════════════════════════════════════
// Storage
// ══════════════════════════════════════════════════════════════════

class Storage {
  constructor() { st(this).map = new Map(); }
  get length() { return st(this).map.size; }
  key(i) { return Array.from(st(this).map.keys())[i] || null; }
  getItem(k) { const v = st(this).map.get(String(k)); return v === undefined ? null : v; }
  setItem(k, v) { st(this).map.set(String(k), String(v)); }
  removeItem(k) { st(this).map.delete(String(k)); }
  clear() { st(this).map.clear(); }
}
Object.defineProperty(Storage.prototype, Symbol.toStringTag, { value: 'Storage', configurable: true });

// ══════════════════════════════════════════════════════════════════
// Screen / Location / History
// ══════════════════════════════════════════════════════════════════

class Screen extends EventTarget {
  constructor() {
    super();
    const s = st(this);
    const B = (__CFG.baseline || {}).screen || {};
    s.width = B.width || 1366; s.height = B.height || 768;
    s.availWidth = B.availWidth || s.width; s.availHeight = B.availHeight || s.height;
    s.colorDepth = B.colorDepth || 24; s.pixelDepth = B.pixelDepth || 24;
    s.availLeft = B.availLeft || 0; s.availTop = B.availTop || 0;
    s.orientation = { type: 'landscape-primary', angle: 0, addEventListener() {}, removeEventListener() {} };
  }
  get width() { return st(this).width; }
  get height() { return st(this).height; }
  get availWidth() { return st(this).availWidth; }
  get availHeight() { return st(this).availHeight; }
  get colorDepth() { return st(this).colorDepth; }
  get pixelDepth() { return st(this).pixelDepth; }
  get availLeft() { return st(this).availLeft; }
  get availTop() { return st(this).availTop; }
  get orientation() { return st(this).orientation; }
  get isExtended() { return false; }
}
Object.defineProperty(Screen.prototype, Symbol.toStringTag, { value: 'Screen', configurable: true });

class Location {
  constructor(href) { st(this).href = String(href); }
  get href() {
    try { __HOST__._note('loc.href'); } catch (e) {}
    return st(this).href;
  }
  set href(v) { st(this).href = String(v); }
  get origin() {
    try { const u = new URL(st(this).href); return u.origin; } catch (e) { return ''; }
  }
  get protocol() { return new URL(st(this).href).protocol; }
  get host() { return new URL(st(this).href).host; }
  get hostname() { return new URL(st(this).href).hostname; }
  get port() { return new URL(st(this).href).port; }
  get pathname() { try { __HOST__._note('loc.pathname'); } catch (e) {} return new URL(st(this).href).pathname; }
  get search() { try { __HOST__._note('loc.search'); } catch (e) {} return new URL(st(this).href).search; }
  get hash() { return new URL(st(this).href).hash; }
  assign(v) { st(this).href = String(v); }
  replace(v) { st(this).href = String(v); }
  reload() { __HOST__.log('location.reload() 被调用（%s）', st(this).href); }
  toString() { return st(this).href; }
}
Object.defineProperty(Location.prototype, Symbol.toStringTag, { value: 'Location', configurable: true });

class History {
  constructor() { st(this).len = 2; st(this).idx = 1; }
  get length() { return st(this).len; }
  get state() { return null; }
  get scrollRestoration() { return 'auto'; }
  set scrollRestoration(v) {}
  back() {} forward() {} go() {}
  pushState(s, t, u) { st(this).len++; }
  replaceState(s, t, u) {}
}
Object.defineProperty(History.prototype, Symbol.toStringTag, { value: 'History', configurable: true });

// ══════════════════════════════════════════════════════════════════
// Performance
// ══════════════════════════════════════════════════════════════════

class PerformanceEntry {
  constructor(init) {
    Object.assign(st(this), init);
    st(this).type = init.entryType;
    st(this).name = init.name;
    st(this).startTime = init.startTime || 0;
    st(this).duration = init.duration || 0;
  }
  get name() { return st(this).name; }
  get entryType() { return st(this).entryType; }
  get startTime() { return st(this).startTime; }
  get duration() { return st(this).duration; }
  toJSON() {
    return { name: this.name, entryType: this.entryType, startTime: this.startTime, duration: this.duration };
  }
}
class PerformanceMark extends PerformanceEntry {}
class PerformanceMeasure extends PerformanceEntry {}
class PerformanceResourceTiming extends PerformanceEntry {}
class PerformanceNavigationTiming extends PerformanceEntry {}

class Performance extends EventTarget {
  constructor() {
    super();
    const s = st(this);
    s.timeOrigin = __HOST__.timeOrigin;
    s.entries = [];
    s.marks = new Map();
    s.observers = [];
  }
  get timeOrigin() { try { __HOST__._note('perf.timeOrigin'); } catch (e) {} return st(this).timeOrigin; }
  get timing() {
    try { __HOST__._note('perf.timing'); } catch (e) {}
    const s = st(this);
    if (s.timingObj) return s.timingObj;
    const t0 = s.timeOrigin;
    const navStart = s.timeOrigin;
    const t = {
      navigationStart: Math.round(t0) - (Number(__CFG.navOffsetMs) || 0),
      unloadEventStart: 0, unloadEventEnd: 0,
      redirectStart: 0, redirectEnd: 0,
      fetchStart: Math.round(t0 + 2),
      domainLookupStart: Math.round(t0 + 2), domainLookupEnd: Math.round(t0 + 6),
      connectStart: Math.round(t0 + 6), connectEnd: Math.round(t0 + 40),
      secureConnectionStart: Math.round(t0 + 20),
      requestStart: Math.round(t0 + 40), responseStart: Math.round(t0 + 95),
      responseEnd: Math.round(t0 + 130),
      domLoading: Math.round(t0 + 100),
      domInteractive: Math.round(t0 + 190),
      domContentLoadedEventStart: Math.round(t0 + 191),
      domContentLoadedEventEnd: Math.round(t0 + 195),
      domComplete: Math.round(t0 + 300),
      loadEventStart: Math.round(t0 + 300),
      loadEventEnd: Math.round(t0 + 305),
      toJSON() { return this; },
    };
    // 单调递增修正 + 保证 browser 里常见的属性
    let prev = -Infinity;
    for (const k of Object.keys(t)) {
      if (typeof t[k] === 'number' && k.endsWith('Start') || k.endsWith('End') || /^(fetchStart|domainLookupStart|domainLookupEnd|connectStart|connectEnd|requestStart|responseStart|responseEnd|domLoading|domInteractive|domComplete|navigationStart|secureConnectionStart)$/.test(k)) {
        if (t[k] < prev) t[k] = prev;
        prev = t[k];
      }
    }
    s.timingObj = t;
    // 字段级追踪：sensor 读 performance.timing 的哪些字段，是反推 performance.total 公式的唯一途径
    try {
      if (__HOST__.cfg.traceTiming && !s.timingProxied) {
        s.timingProxied = true;
        return new Proxy(t, {
          get(tg, k) {
            const v = Reflect.get(tg, k, tg);
            if (typeof k !== 'symbol') __HOST__._note('timing.' + String(k) + '=' + String(v));
            return v;
          },
        });
      }
    } catch (e) {}
    return t;
  }
  get navigation() {
    return {
      type: 0, redirectCount: 0,
      toJSON() { return { type: 0, redirectCount: 0 }; },
    };
  }
  get memory() {
    return {
      jsHeapSizeLimit: 4294705152,
      totalJSHeapSize: 13000000 + ((__HOST__.seed % 2000000)),
      usedJSHeapSize: 9000000 + ((__HOST__.seed % 1000000)),
    };
  }
  get eventCounts() { return new Map(); }
  get onresourcetimingbufferfull() { return null; }
  set onresourcetimingbufferfull(v) {}
  now() { return __HOST__.now(); }
  toJSON() { return { timeOrigin: this.timeOrigin, timing: this.timing, navigation: this.navigation }; }
  mark(name) {
    const s = st(this);
    const e = new PerformanceMark({ name: String(name), entryType: 'mark', startTime: this.now(), duration: 0 });
    s.marks.set(String(name), e.startTime);
    s.entries.push(e);
    try { __HOST__._perf('mark', String(name), 0); } catch (err) {}
    return e;
  }
  measure(name, a, b) {
    const s = st(this);
    let start = 0, end = this.now();
    if (typeof a === 'string') start = s.marks.get(a) || 0;
    else if (a && typeof a.startTime === 'number') start = a.startTime;
    if (typeof b === 'string') end = s.marks.get(b) || this.now();
    else if (b && typeof b.startTime === 'number') end = b.endTime || b.startTime;
    const e = new PerformanceMeasure({ name: String(name), entryType: 'measure', startTime: start, duration: end - start });
    s.entries.push(e);
    // ★ 关键诊断：reese84 用 User Timing 量各阶段耗时，再汇总进 payload 的 performance 字段。
    //   把每个 measure 的名字与 duration 打出来，就能知道服务端到底在看哪几个阶段。
    try { __HOST__._perf('measure', String(name), end - start); } catch (err) {}
    return e;
  }
  clearMarks() { st(this).entries = st(this).entries.filter((e) => e.entryType !== 'mark'); }
  clearMeasures() { st(this).entries = st(this).entries.filter((e) => e.entryType !== 'measure'); }
  clearResourceTimings() { st(this).entries = st(this).entries.filter((e) => e.entryType !== 'resource'); }
  setResourceTimingBufferSize() {}
  getEntries() {
    const out = st(this).entries.slice();
    out.unshift(this.__navigationEntry());
    return out;
  }
  getEntriesByType(t) {
    const type = String(t);
    try { __HOST__._perf('query.type', type, 0); } catch (err) {}
    // ★ 关键：reese84 会读 performance.getEntriesByType('navigation') 来算耗时。
    //   早期实现里 entries 只有 mark/measure，这个查询恒返回空数组 →
    //   sensor 拿到空数据，把采集耗时算成几十微秒（服务端期望 7000+ 微秒的 band）。
    if (type === 'navigation') return [this.__navigationEntry()];
    if (type === 'paint') {
      const B = (__CFG.baseline || {}).perf || {};
      const fp = B.firstPaint || 120.5;
      return [
        { name: 'first-paint', entryType: 'paint', startTime: fp, duration: 0, toJSON() { return { name: 'first-paint', entryType: 'paint', startTime: fp, duration: 0 }; } },
        { name: 'first-contentful-paint', entryType: 'paint', startTime: fp + 12.3, duration: 0, toJSON() { return { name: 'first-contentful-paint', entryType: 'paint', startTime: fp + 12.3, duration: 0 }; } },
      ];
    }
    return st(this).entries.filter((e) => e.entryType === type);
  }

  // 完整的 PerformanceNavigationTiming（浏览器里必然存在，且字段自洽）
  __navigationEntry() {
    const s = st(this);
    if (s.navEntry) return s.navEntry;
    const t = this.timing;
    const B = (__CFG.baseline || {}).perf || {};
    const e = {
      name: __CFG.entryUrl,
      entryType: 'navigation',
      initiatorType: 'navigation',
      startTime: 0,
      duration: t.domComplete,
      nextHopProtocol: 'h2',
      workerStart: 0,
      redirectStart: 0, redirectEnd: 0,
      fetchStart: t.fetchStart - t.navigationStart,
      domainLookupStart: t.domainLookupStart - t.navigationStart,
      domainLookupEnd: t.domainLookupEnd - t.navigationStart,
      connectStart: t.connectStart - t.navigationStart,
      connectEnd: t.connectEnd - t.navigationStart,
      secureConnectionStart: t.secureConnectionStart - t.navigationStart,
      requestStart: t.requestStart - t.navigationStart,
      responseStart: t.responseStart - t.navigationStart,
      responseEnd: t.responseEnd - t.navigationStart,
      transferSize: 8341, encodedBodySize: 6058, decodedBodySize: 12032,
      decodedBodySize_: undefined,
      unloadEventStart: 0, unloadEventEnd: 0,
      domInteractive: t.domInteractive - t.navigationStart,
      domContentLoadedEventStart: t.domContentLoadedEventStart - t.navigationStart,
      domContentLoadedEventEnd: t.domContentLoadedEventEnd - t.navigationStart,
      domComplete: t.domComplete - t.navigationStart,
      loadEventStart: t.loadEventStart - t.navigationStart,
      loadEventEnd: t.loadEventEnd - t.navigationStart,
      type: 'navigate',
      redirectCount: 0,
      serverTiming: [],
      activationStart: 0,
      criticalCHRestart: 0,
      toJSON() {
        const o = {};
        for (const k of Object.keys(this)) if (typeof this[k] !== 'function') o[k] = this[k];
        return o;
      },
    };
    delete e.decodedBodySize_;
    s.navEntry = e;
    return e;
  }
  getEntriesByName(n, t) {
    try { __HOST__._perf('query.name', String(n) + (t ? '|' + t : ''), 0); } catch (err) {}
    return st(this).entries.filter((e) => e.name === n && (!t || e.entryType === t));
  }
}
Object.defineProperty(Performance.prototype, Symbol.toStringTag, { value: 'Performance', configurable: true });

// ══════════════════════════════════════════════════════════════════
// Navigator
// ══════════════════════════════════════════════════════════════════

// ★ 以下值全部来自真实浏览器采样（baseline.json），不猜。
//   猜出来的值会和别的指纹自相矛盾：例如本机是 16 线程，写 8 就与 performance 里的
//   线程相关信息矛盾；Chrome 141 已经不暴露 deviceMemory，写了 8 反而是漏洞。
const __B = __CFG.baseline || {};
const __BN = __B.navigator || {};
const __nav = {
  appCodeName: __BN.appCodeName || 'Mozilla',
  appName: __BN.appName || 'Netscape',
  appVersion: __BN.appVersion || __CFG.ua.replace('Mozilla/', ''),
  cookieEnabled: __BN.cookieEnabled !== undefined ? __BN.cookieEnabled : true,
  doNotTrack: __BN.doNotTrack !== undefined ? __BN.doNotTrack : null,
  hardwareConcurrency: __BN.hardwareConcurrency || 8,
  language: __BN.language || 'en-US',
  languages: (__BN.languages || ['en-US', 'en']).slice(),
  maxTouchPoints: __BN.maxTouchPoints || 0,
  onLine: __BN.onLine !== undefined ? __BN.onLine : true,
  platform: __BN.platform || 'Win32',
  product: __BN.product || 'Gecko',
  productSub: __BN.productSub || '20030107',
  userAgent: __BN.userAgent || __CFG.ua,
  vendor: __BN.vendor || 'Google Inc.',
  vendorSub: __BN.vendorSub !== undefined ? __BN.vendorSub : '',
  webdriver: __BN.webdriver !== undefined ? __BN.webdriver : false,
  pdfViewerEnabled: __BN.pdfViewerEnabled !== undefined ? __BN.pdfViewerEnabled : true,
};
// deviceMemory：Chrome 141 实测为 undefined，只有存在值时才定义
if (__BN.deviceMemory !== undefined) __nav.deviceMemory = __BN.deviceMemory;

class PluginArray {
  constructor(items) {
    st(this).items = items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this[i] = it;
      this[it.name] = it;
    }
  }
  get length() { return st(this).items.length; }
  item(i) { return st(this).items[i] || null; }
  namedItem(n) { return st(this).items.find((x) => x.name === n) || null; }
  [Symbol.iterator]() { return st(this).items[Symbol.iterator](); }
}
Object.defineProperty(PluginArray.prototype, Symbol.toStringTag, { value: 'PluginArray', configurable: true });

class MimeTypeArray {
  constructor(items) {
    st(this).items = items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this[i] = it;
      this[it.type] = it;
    }
  }
  get length() { return st(this).items.length; }
  item(i) { return st(this).items[i] || null; }
  namedItem(n) { return st(this).items.find((x) => x.type === n) || null; }
}
Object.defineProperty(MimeTypeArray.prototype, Symbol.toStringTag, { value: 'MimeTypeArray', configurable: true });

function __buildPlugins() {
  const defs = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format', mimes: ['application/pdf', 'text/pdf'] },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format', mimes: ['application/pdf', 'text/pdf'] },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format', mimes: ['application/pdf', 'text/pdf'] },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format', mimes: ['application/pdf', 'text/pdf'] },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', desc: 'Portable Document Format', mimes: ['application/pdf', 'text/pdf'] },
  ];
  const mimeArr = [];
  const plugins = defs.map((d) => {
    const mt = d.mimes.map((t) => {
      const m = {
        type: t, suffixes: 'pdf', description: d.desc,
        enabledPlugin: null,
      };
      mimeArr.push(m);
      return m;
    });
    const p = {
      name: d.name, filename: d.filename, description: d.desc,
      length: mt.length,
      item(i) { return mt[i] || null; },
      namedItem(n) { return mt.find((x) => x.type === n) || null; },
      [Symbol.iterator]() { return mt[Symbol.iterator](); },
    };
    mt.forEach((m, i) => { p[i] = m; m.enabledPlugin = p; });
    return p;
  });
  return { plugins: new PluginArray(plugins), mimeTypes: new MimeTypeArray(mimeArr) };
}

class Navigator extends EventTarget {
  constructor() {
    super();
    const built = __buildPlugins();
    const s = st(this);
    s.plugins = built.plugins;
    s.mimeTypes = built.mimeTypes;
    const BUA = (__CFG.baseline || {}).userAgentData || null;
    s.uaData = {
      brands: (BUA && BUA.brands) || [
        { brand: 'Chromium', version: '141' },
        { brand: 'Not?A_Brand', version: '24' },
        { brand: 'Google Chrome', version: '141' },
      ],
      mobile: (BUA && BUA.mobile) || false,
      platform: (BUA && BUA.platform) || 'Windows',
      getHighEntropyValues(hints) {
        const full = {
          architecture: 'x86', bitness: '64', brands: this.brands,
          formFactors: ['Desktop'], fullVersionList: [
            { brand: 'Chromium', version: '141.0.7390.108' },
            { brand: 'Not?A_Brand', version: '24.0.0.0' },
            { brand: 'Google Chrome', version: '141.0.7390.108' },
          ],
          mobile: false, model: '', platform: 'Windows', platformVersion: '15.0.0',
          uaFullVersion: '141.0.7390.108', wow64: false,
        };
        const out = { brands: this.brands, mobile: false, platform: 'Windows' };
        for (const h of (hints || [])) if (h in full) out[h] = full[h];
        return Promise.resolve(out);
      },
      toJSON() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; },
    };
    s.connection = {
      downlink: 10, effectiveType: '4g', onchange: null, rtt: 50, saveData: false,
      addEventListener() {}, removeEventListener() {},
    };
    s.permissions = {
      query: nativeLike(function (d) { return Promise.resolve({ name: d && d.name, state: 'prompt', onchange: null }); }, 'query'),
      addEventListener() {}, removeEventListener() {},
    };
    s.mediaDevices = {
      enumerateDevices: nativeLike(function () {
        return Promise.resolve([
          { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'default' },
          { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'default' },
          { deviceId: 'default', kind: 'videoinput', label: '', groupId: 'default' },
        ]);
      }, 'enumerateDevices'),
      getUserMedia: nativeLike(function () { return Promise.reject(new Error('NotAllowedError')); }, 'getUserMedia'),
      addEventListener() {}, removeEventListener() {},
    };
  }
  get plugins() { return st(this).plugins; }
  get mimeTypes() { return st(this).mimeTypes; }
  get userAgentData() { return st(this).uaData; }
  get connection() { return st(this).connection; }
  get permissions() { return st(this).permissions; }
  get mediaDevices() { return st(this).mediaDevices; }
  get geolocation() {
    return {
      getCurrentPosition(succ, err) { if (err) err({ code: 1, message: 'User denied Geolocation' }); },
      watchPosition() { return 0; }, clearWatch() {},
    };
  }
  get storage() {
    return {
      estimate: nativeLike(function () { return Promise.resolve({ quota: 300000000000, usage: 0 }); }, 'estimate'),
      persisted: nativeLike(function () { return Promise.resolve(false); }, 'persisted'),
      persist: nativeLike(function () { return Promise.resolve(false); }, 'persist'),
    };
  }
  get serviceWorker() { return undefined; }
  get bluetooth() { return undefined; }
  get usb() { return undefined; }
  get xr() { return undefined; }
  get credentials() { return { get: () => Promise.resolve(null), create: () => Promise.resolve(null) }; }
  get keyboard() { return { getLayoutMap: () => Promise.resolve(new Map()), lock() {}, unlock() {} }; }
  get userActivation() { return { hasBeenActive: true, isActive: true }; }
  get scheduling() { return { isInputPending: () => false }; }
  get hardwareConcurrency() { return __nav.hardwareConcurrency; }
  get deviceMemory() { return __nav.deviceMemory; }
  javaEnabled() { return false; }
  sendBeacon(url, data) { return __HOST__.sendBeacon(String(url), data === undefined ? '' : String(data)); }
  vibrate() { return false; }
  registerProtocolHandler() {}
  share() { return Promise.reject(new Error('NotAllowedError')); }
  canShare() { return false; }
}
for (const k of Object.keys(__nav)) {
  if (k === 'languages') {
    defGetter(Navigator.prototype, k, function () { return __nav[k].slice(); });
  } else {
    defGetter(Navigator.prototype, k, function () { return __nav[k]; });
  }
}
Object.defineProperty(Navigator.prototype, Symbol.toStringTag, { value: 'Navigator', configurable: true });

// ══════════════════════════════════════════════════════════════════
// Document
// ══════════════════════════════════════════════════════════════════

class HTMLCanvasElement extends HTMLElement {
  constructor() {
    super('canvas');
    st(this).w = 300;
    st(this).h = 150;
  }
  get width() { return st(this).w; }
  set width(v) { const n = Math.max(0, parseInt(v, 10) || 0); st(this).w = n; __syncSize(this); }
  get height() { return st(this).h; }
  set height(v) { const n = Math.max(0, parseInt(v, 10) || 0); st(this).h = n; __syncSize(this); }
  getContext(type, attrs) {
    const t = String(type).toLowerCase();
    try { __HOST__._bump('getContext.' + t); } catch (e) {}
    try {
      if (attrs && typeof attrs === 'object') __HOST__._bump('getContext.attrs.' + Object.keys(attrs).join('+'));
    } catch (e) {}
    try {
      if (__HOST__.cfg.traceStack) {
        __HOST__.log('getContext(%s) 调用栈: %s', t, String(new Error().stack).split('\n').slice(1, 5).join(' <- '));
      }
    } catch (e) {}
    if (t === '2d') {
      if (!st(this).ctx2d) st(this).ctx2d = new CanvasRenderingContext2D(this);
      const c2 = st(this).ctx2d;
      if (__HOST__.cfg.traceCtx && !st(this).ctxProxied) {
        st(this).ctxProxied = true;
        return new Proxy(c2, {
          get(tg, k) {
            if (typeof k !== 'symbol') __HOST__._note('ctx.get.' + String(k));
            return Reflect.get(tg, k, tg);
          },
          set(tg, k, v) {
            if (typeof k !== 'symbol') __HOST__._note('ctx.set.' + String(k));
            return Reflect.set(tg, k, v, tg);
          },
        });
      }
      return c2;
    }
    if (t === 'webgl' || t === 'experimental-webgl') {
      if (!st(this).gl1) st(this).gl1 = new WebGLRenderingContext(this);
      return st(this).gl1;
    }
    if (t === 'webgl2') {
      if (!st(this).gl2) st(this).gl2 = new WebGL2RenderingContext(this);
      return st(this).gl2;
    }
    return null;
  }
  toDataURL(type, quality) {
    try {
      const be = __getBackend(this);
      __syncSize(this);
      return __HOST__.canvasToDataURL(be, type || 'image/png', quality);
    } catch (e) {
      return 'data:image/png;base64,';
    }
  }
  toBlob(cb, type, quality) {
    try {
      const be = __getBackend(this);
      const b64 = __HOST__.canvasToDataURL(be, type || 'image/png', quality);
      const bin = atob(b64.split(',')[1] || '');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      setTimeout(() => cb(new Blob([u8], { type: type || 'image/png' })), 0);
    } catch (e) { setTimeout(() => cb(null), 0); }
  }
  transferControlToOffscreen() { return {}; }
  captureStream() { return { getTracks: () => [], addEventListener() {} }; }
}
Object.defineProperty(HTMLCanvasElement.prototype, Symbol.toStringTag, { value: 'HTMLCanvasElement', configurable: true });

class HTMLIFrameElement extends HTMLElement {
  constructor() {
    super('iframe');
    const s = st(this);
    s.src = '';
    s.loadHandlers = 0;
  }
  get src() {
    const a = this.getAttribute('src');
    if (a) return a;
    return '';
  }
  set src(v) { this.setAttribute('src', v); }
  get contentWindow() {
    // 实测结论（两种都试过）：
    //   A) 返回主 window        → payload 28~32KB，能拿到服务端签发的 token（当前最优）
    //   B) 独立子窗口（裸对象）  → sensor 立刻抛错，退化成错误上报，payload 掉到 11KB
    //   C) 独立子窗口（Proxy 委托）→ payload 24KB，拿不到 token
    // 浏览器里 A 是"不真实的"（iframe 必是独立 Window），但 reese84 显然不校验
    // contentWindow 的对象身份，而非常依赖它拥有完整的 window 能力。
    // 所以这里选 A，并在 skill 里如实标注这是已知的保真度取舍。
    return __window;
  }
  get contentDocument() { return __document; }
  get sandbox() { return { add() {}, remove() {}, contains() { return false; }, length: 0, value: '' }; }
  get allow() { return ''; }
  set allow(v) {}
  get loading() { return 'eager'; }
  get name() { return this.getAttribute('name') || ''; }
  set name(v) { this.setAttribute('name', v); }
}
Object.defineProperty(HTMLIFrameElement.prototype, Symbol.toStringTag, { value: 'HTMLIFrameElement', configurable: true });

class HTMLScriptElement extends HTMLElement {
  constructor() {
    super('script');
  }
  get src() {
    const v = this.getAttribute('src');
    if (!v) return '';
    try { return new URL(v, __document.baseURI).href; } catch (e) { return v; }
  }
  set src(v) { this.setAttribute('src', v); }
  get type() { return this.getAttribute('type') || ''; }
  set type(v) { this.setAttribute('type', v); }
  get async() { return this.hasAttribute('async'); }
  set async(v) { if (v) this.setAttribute('async', ''); else this.removeAttribute('async'); }
  get defer() { return this.hasAttribute('defer'); }
  set defer(v) { if (v) this.setAttribute('defer', ''); else this.removeAttribute('defer'); }
  get nonce() { return this.getAttribute('nonce') || ''; }
  get text() { return this.textContent; }
  set text(v) { this.textContent = v; }
  get charset() { return this.getAttribute('charset') || ''; }
  get crossOrigin() { return this.getAttribute('crossorigin'); }
  get integrity() { return this.getAttribute('integrity') || ''; }
  get referrerPolicy() { return ''; }
  get noModule() { return false; }
}
Object.defineProperty(HTMLScriptElement.prototype, Symbol.toStringTag, { value: 'HTMLScriptElement', configurable: true });

class HTMLImageElement extends HTMLElement {
  constructor() {
    super('img');
    st(this).w = 0; st(this).h = 0; st(this).complete = false;
  }
  get src() {
    const v = this.getAttribute('src');
    if (!v) return '';
    try { return new URL(v, __document.baseURI).href; } catch (e) { return v; }
  }
  set src(v) { this.setAttribute('src', v); }
  get width() { return st(this).w || (parseInt(this.getAttribute('width'), 10) || 0); }
  set width(v) { st(this).w = parseInt(v, 10) || 0; }
  get height() { return st(this).h || (parseInt(this.getAttribute('height'), 10) || 0); }
  set height(v) { st(this).h = parseInt(v, 10) || 0; }
  get naturalWidth() { return st(this).w; }
  get naturalHeight() { return st(this).h; }
  get complete() { return true; }
  get currentSrc() { return this.src; }
  get alt() { return this.getAttribute('alt') || ''; }
  set alt(v) { this.setAttribute('alt', v); }
  get crossOrigin() { return this.getAttribute('crossorigin'); }
  get decoding() { return 'auto'; }
  get loading() { return 'eager'; }
  get referrerPolicy() { return ''; }
  decode() { return Promise.resolve(); }
}
Object.defineProperty(HTMLImageElement.prototype, Symbol.toStringTag, { value: 'HTMLImageElement', configurable: true });

class HTMLAnchorElement extends HTMLElement {
  constructor() { super('a'); }
  get href() {
    const v = this.getAttribute('href');
    if (!v) return '';
    try { return new URL(v, __document.baseURI).href; } catch (e) { return v; }
  }
  set href(v) { this.setAttribute('href', v); }
  get protocol() { return new URL(this.href).protocol; }
  get host() { return new URL(this.href).host; }
  get hostname() { return new URL(this.href).hostname; }
  get pathname() { return new URL(this.href).pathname; }
  get search() { return new URL(this.href).search; }
  get hash() { return new URL(this.href).hash; }
  get origin() { return new URL(this.href).origin; }
  get target() { return this.getAttribute('target') || ''; }
  get rel() { return this.getAttribute('rel') || ''; }
  get text() { return this.textContent; }
}
Object.defineProperty(HTMLAnchorElement.prototype, Symbol.toStringTag, { value: 'HTMLAnchorElement', configurable: true });

class HTMLInputElement extends HTMLElement {
  constructor() { super('input'); }
  get value() { return this.getAttribute('value') || ''; }
  set value(v) { this.setAttribute('value', v); }
  get type() { return this.getAttribute('type') || 'text'; }
  set type(v) { this.setAttribute('type', v); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(v) { if (v) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  get disabled() { return this.hasAttribute('disabled'); }
  get name() { return this.getAttribute('name') || ''; }
  get form() { return null; }
  select() {} setSelectionRange() {}
  checkValidity() { return true; }
}
Object.defineProperty(HTMLInputElement.prototype, Symbol.toStringTag, { value: 'HTMLInputElement', configurable: true });

class HTMLMediaElement extends HTMLElement {
  get play() { return nativeLike(function () { return Promise.resolve(); }, 'play'); }
  get pause() { return nativeLike(function () {}, 'pause'); }
  get load() { return nativeLike(function () {}, 'load'); }
  get canPlayType() {
    return nativeLike(function (t) {
      const v = String(t);
      if (!v) return '';
      if (/codecs=/i.test(v)) return /^(audio|video)\/(mp4|webm|ogg)/.test(v) ? 'probably' : 'maybe';
      return /^(audio|video)\//.test(v) ? 'maybe' : '';
    }, 'canPlayType');
  }
  get currentTime() { return 0; }
  set currentTime(v) {}
  get duration() { return NaN; }
  get paused() { return true; }
  get volume() { return 1; }
  set volume(v) {}
  get muted() { return false; }
  set muted(v) {}
  get readyState() { return 0; }
  get networkState() { return 0; }
  get error() { return null; }
  get buffered() { return { length: 0 }; }
}
Object.defineProperty(HTMLMediaElement.prototype, Symbol.toStringTag, { value: 'HTMLMediaElement', configurable: true });

class HTMLAudioElement extends HTMLMediaElement {
  constructor() { super('audio'); }
}
class HTMLVideoElement extends HTMLMediaElement {
  constructor() {
    super('video');
    st(this).w = 0; st(this).h = 0;
  }
  get videoWidth() { return 0; }
  get videoHeight() { return 0; }
}
class HTMLDivElement extends HTMLElement { constructor() { super('div'); } }
class HTMLSpanElement extends HTMLElement { constructor() { super('span'); } }
class HTMLBodyElement extends HTMLElement { constructor() { super('body'); } }
class HTMLHeadElement extends HTMLElement { constructor() { super('head'); } }
class HTMLHtmlElement extends HTMLElement { constructor() { super('html'); } }
class HTMLUnknownElement extends HTMLElement { constructor(t) { super(t || 'unknown'); } }
class HTMLStyleElement extends HTMLElement {
  constructor() { super('style'); }
  get sheet() { return { cssRules: [], insertRule() { return 0; }, deleteRule() {}, disabled: false }; }
}
class HTMLLinkElement extends HTMLElement {
  constructor() { super('link'); }
  get sheet() { return null; }
  get rel() { return this.getAttribute('rel') || ''; }
  get href() { return this.getAttribute('href') || ''; }
}
class HTMLMetaElement extends HTMLElement { constructor() { super('meta'); } }
class HTMLTitleElement extends HTMLElement { constructor() { super('title'); } }
class DocumentFragment extends Node {
  get nodeType() { return DOCUMENT_FRAGMENT_NODE; }
  get nodeName() { return '#document-fragment'; }
}
Object.defineProperty(DocumentFragment.prototype, Symbol.toStringTag, { value: 'DocumentFragment', configurable: true });

// DOMException 简版
class DOMException extends Error {
  constructor(msg, name) {
    super(msg || '');
    this.name = name || 'Error';
    st(this).code = 0;
  }
  get code() { return st(this).code; }
}

const __tagClassMap = {
  canvas: HTMLCanvasElement, iframe: HTMLIFrameElement, script: HTMLScriptElement,
  img: HTMLImageElement, a: HTMLAnchorElement, input: HTMLInputElement,
  audio: HTMLAudioElement, video: HTMLVideoElement,
  div: HTMLDivElement, span: HTMLSpanElement,
  body: HTMLBodyElement, head: HTMLHeadElement, html: HTMLHtmlElement,
  style: HTMLStyleElement, link: HTMLLinkElement, meta: HTMLMetaElement,
  title: HTMLTitleElement,
};

class Document extends Node {
  constructor() {
    super();
    const s = st(this);
    s.readyState = 'loading';
    s.activeElementVal = null;
    s.currentScriptVal = null;
    s.titleVal = '';

    s.documentElement = new HTMLHtmlElement();
    s.documentElement.setAttribute('lang', 'en');
    s.head = new HTMLHeadElement();
    s.body = new HTMLBodyElement();
    s.documentElement.appendChild(s.head);
    s.documentElement.appendChild(s.body);
    st(s.documentElement).parentNode = this;
    st(s.head).parentNode = s.documentElement;
    st(s.body).parentNode = s.documentElement;
  }
  get nodeType() { return DOCUMENT_NODE; }
  get nodeName() { return '#document'; }
  get ownerDocument() { return null; }
  get documentElement() { return st(this).documentElement; }
  get head() { return st(this).head; }
  get body() { return st(this).body; }
  get defaultView() { return __window; }
  get location() { return __window.location; }
  set location(v) { __window.location.href = v; }
  get URL() { return __window.location.href; }
  get documentURI() { return __window.location.href; }
  get baseURI() { return __window.location.href; }
  get domain() { return __window.location.hostname; }
  get referrer() { return __CFG.referrer; }
  get cookie() { return __HOST__.cookieGet(); }
  set cookie(v) { __HOST__.cookieSet(String(v)); }
  get readyState() { return st(this).readyState; }
  get characterSet() { return 'UTF-8'; }
  get charset() { return 'UTF-8'; }
  get inputEncoding() { return 'UTF-8'; }
  get contentType() { return 'text/html'; }
  get compatMode() { return 'CSS1Compat'; }
  get designMode() { return 'off'; }
  get hidden() { return false; }
  get visibilityState() { return 'visible'; }
  get wasDiscarded() { return false; }
  get prerendering() { return false; }
  get title() { return st(this).titleVal; }
  set title(v) {
    st(this).titleVal = String(v);
    let t = st(this).head.querySelector('title');
    if (!t) { t = this.createElement('title'); st(this).head.appendChild(t); }
    t.textContent = String(v);
  }
  get currentScript() { return st(this).currentScriptVal; }
  __setCurrentScript(v) { st(this).currentScriptVal = v; }
  get activeElement() { return st(this).activeElementVal || this.body; }
  __setActive(v) { st(this).activeElementVal = v; }
  get scripts() {
    return this.querySelectorAll('script');
  }
  get all() {
    // 浏览器里 typeof document.all === 'undefined' 且 !!document.all === false
    return undefined;
  }
  get forms() { return this.querySelectorAll('form'); }
  get images() { return this.querySelectorAll('img'); }
  get links() { return this.querySelectorAll('a[href]'); }
  get styleSheets() { return []; }
  get adoptedStyleSheets() { return []; }
  get fonts() {
    return {
      ready: Promise.resolve(), status: 'loaded', size: 3,
      check: nativeLike(function () { return true; }, 'check'),
      add() {}, delete() {}, clear() {}, has() { return false; },
      forEach() {}, load() { return Promise.resolve([]); },
      addEventListener() {}, removeEventListener() {},
      [Symbol.iterator]() { return [][Symbol.iterator](); },
    };
  }
  get implementation() {
    const self = this;
    return {
      createHTMLDocument: nativeLike(function (title) {
        const d = __makeDocument(__CFG.origin + '/about:blank');
        if (title) d.title = title;
        return d;
      }, 'createHTMLDocument'),
      createDocument() { return __makeDocument('about:blank'); },
      createDocumentType() { return { name: 'html', publicId: '', systemId: '' }; },
      hasFeature() { return true; },
    };
  }
  get doctype() {
    return { name: 'html', publicId: '', systemId: '', nodeType: DOCUMENT_TYPE_NODE, nodeName: 'html' };
  }
  createElement(tag) {
    const t = String(tag).toLowerCase();
    try { __HOST__._bump('create.' + t); } catch (e) {}
    const C = __tagClassMap[t];
    if (C) return new C();
    return new HTMLUnknownElement(t);
  }
  createElementNS(ns, tag) { return this.createElement(String(tag).split(':').pop()); }
  createTextNode(data) { return new Text(data); }
  createComment(data) { return new Comment(data); }
  createDocumentFragment() { return new DocumentFragment(); }
  createAttribute(n) { return { name: n, value: '', specified: true }; }
  createEvent(kind) {
    const k = String(kind).toLowerCase();
    if (k === 'customevent') return new CustomEvent('');
    if (k === 'mouseevent' || k === 'mouseevents') return new MouseEvent('');
    if (k === 'keyboardevent' || k === 'keyboardevents') return new KeyboardEvent('');
    if (k === 'messageevent') return new MessageEvent('');
    return new Event('');
  }
  importNode(node, deep) { return node.cloneNode(deep); }
  adoptNode(node) { return node; }
  getElementById(id) {
    const want = String(id);
    let found = null;
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (found) return;
        if (c.nodeType === ELEMENT_NODE) {
          if (st(c).attrs.id === want) { found = c; return; }
          walk(c);
        }
      }
    };
    if (st(this.body).attrs.id === want) return this.body;
    walk(this.documentElement);
    return found;
  }
  getElementsByTagName(t) {
    const out = [];
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (c.nodeType !== ELEMENT_NODE) continue;
        if (t === '*' || st(c).tagName === String(t).toUpperCase()) out.push(c);
        walk(c);
      }
    };
    walk(this.documentElement);
    return out;
  }
  getElementsByTagNameNS(ns, t) { return this.getElementsByTagName(t); }
  getElementsByClassName(c) {
    const want = String(c).split(/\s+/).filter(Boolean);
    const out = [];
    const walk = (n) => {
      for (const ch of st(n).childNodes) {
        if (ch.nodeType !== ELEMENT_NODE) continue;
        if (want.every((w) => st(ch).classListSet.has(w))) out.push(ch);
        walk(ch);
      }
    };
    walk(this.documentElement);
    return out;
  }
  getElementsByName(n) {
    return this.querySelectorAll('[name="' + String(n).replace(/"/g, '') + '"]');
  }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  hasFocus() { return true; }
  execCommand() { return false; }
  open() { return this; }
  close() {}
  write() {}
  writeln() {}
  elementFromPoint() { return null; }
  elementsFromPoint() { return []; }
  caretRangeFromPoint() { return null; }
  exitFullscreen() { return Promise.resolve(); }
  get fullscreenElement() { return null; }
  get pointerLockElement() { return null; }
  get scrollingElement() { return this.documentElement; }
  get children() { return [this.documentElement]; }
  get firstElementChild() { return this.documentElement; }
}
Object.defineProperty(Document.prototype, Symbol.toStringTag, { value: 'Document', configurable: true });

function __makeDocument(url) {
  const d = new Document();
  return d;
}

// ══════════════════════════════════════════════════════════════════
// Window
// ══════════════════════════════════════════════════════════════════

let __document = new Document();

// ★ window 必须是 realm 的全局对象本身。
//   浏览器里 window === globalThis，sensor 大量直接写 navigator.x / document.x
//   而不是 window.navigator.x。用独立对象冒充 window 会导致这些裸访问全部 ReferenceError。
const __window = globalThis;

class Window extends EventTarget {}
Object.defineProperty(Window.prototype, Symbol.toStringTag, { value: 'Window', configurable: true });
// ★ setPrototypeOf(globalThis, ...) 让 V8 放弃全局对象的内联缓存，
//   之后每一次 window 属性访问都走慢路径。实测足以把 3 秒的 sensor 拖成 90 秒，
//   进而导致服务端 ?d= 会话超时（408 Timeout）。默认关闭，需要时用 --window-proto 打开。
if (__HOST__.cfg.windowProto) {
  try { Object.setPrototypeOf(__window, Window.prototype); } catch (e) {}
}
// 把 EventTarget 的三件套装到全局对象上
for (const m of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
  defValue(__window, m, nativeLike(EventTarget.prototype[m], m), false);
}

// 定时器：真实 host 定时器，保证 sensor 的异步流程能推进
const __timers = new Map();
let __timerSeq = 1;
function __setTimeout(fn, delay, ...args) {
  if (typeof fn === 'string') { const code = fn; fn = function () { (0, eval)(code); }; }
  if (typeof fn !== 'function') return 0;
  const id = __timerSeq++;
  const d = Math.max(0, Number(delay) || 0);
  const h = __HOST__.setTimeout(() => {
    __timers.delete(id);
    try { fn.apply(__window, args); } catch (e) { __HOST__.log('timer 异常: %s', e && e.message); }
  }, d);
  __timers.set(id, { h, type: 'timeout' });
  return id;
}
function __clearTimeout(id) {
  const t = __timers.get(Number(id));
  if (t) { __HOST__.clearTimeout(t.h); __timers.delete(Number(id)); }
}
function __setInterval(fn, delay, ...args) {
  if (typeof fn !== 'function') return 0;
  const id = __timerSeq++;
  const d = Math.max(4, Number(delay) || 4);
  const h = __HOST__.setInterval(() => {
    try { fn.apply(__window, args); } catch (e) { __HOST__.log('interval 异常: %s', e && e.message); }
  }, d);
  __timers.set(id, { h, type: 'interval' });
  return id;
}
function __clearInterval(id) { __clearTimeout(id); }

// 尺寸：Chrome 里 innerHeight = outerHeight - 浏览器 UI(约 87px)
const __BW = (__CFG.baseline || {}).window || {};
// Date.now 统计：判断 payload 的 performance.total 是不是来自 Date 差值
const __dateStats = { calls: 0, first: null, last: null };
const __origDateNow = Date.now;
Date.now = function () {
  const v = __origDateNow.call(Date);
  __dateStats.calls++;
  if (__dateStats.first === null) __dateStats.first = v;
  __dateStats.last = v;
  return v;
};
nativeLike(Date.now, 'now');

// new Date().getTime()/valueOf() 统计（sensor 可能用它做精细计时）
const __dateObjStats = { calls: 0, first: null, last: null };
(function patchDate() {
  const RealDate = Date;
  function WrappedDate(...a) {
    if (!(this instanceof WrappedDate)) return new RealDate().toString();
    const d = a.length === 0 ? new RealDate() : new RealDate(...a);
    return d;
  }
  WrappedDate.prototype = RealDate.prototype;
  WrappedDate.now = RealDate.now;
  WrappedDate.parse = RealDate.parse;
  WrappedDate.UTC = RealDate.UTC;
  const og = RealDate.prototype.getTime;
  const ov = RealDate.prototype.valueOf;
  defMethod(RealDate.prototype, 'getTime', function () {
    const v = og.call(this);
    __dateObjStats.calls++;
    if (__dateObjStats.first === null) __dateObjStats.first = v;
    __dateObjStats.last = v;
    return v;
  });
  defMethod(RealDate.prototype, 'valueOf', function () {
    const v = ov.call(this);
    __dateObjStats.calls++;
    if (__dateObjStats.first === null) __dateObjStats.first = v;
    __dateObjStats.last = v;
    return v;
  });
  try { Object.defineProperty(globalThis, 'Date', { value: WrappedDate, configurable: true, writable: true }); } catch (e) {}
})();

const __WIN = {
  innerWidth: __BW.innerWidth || 1340, innerHeight: __BW.innerHeight || 757,
  outerWidth: __BW.outerWidth || 1366, outerHeight: __BW.outerHeight || 768,
  screenX: __BW.screenX || 0, screenY: __BW.screenY || 0,
  screenLeft: __BW.screenLeft || 0, screenTop: __BW.screenTop || 0,
  devicePixelRatio: __BW.devicePixelRatio || 1,
  pageXOffset: 0, pageYOffset: 0, scrollX: 0, scrollY: 0,
};

class MediaQueryList extends EventTarget {
  constructor(q) {
    super();
    st(this).media = String(q);
    st(this).matches = __evalMedia(String(q));
  }
  get media() { return st(this).media; }
  get matches() { return st(this).matches; }
  get onchange() { return null; }
  set onchange(v) {}
  addListener() {} removeListener() {}
}
function __evalMedia(q) {
  // 只处理常见的尺寸/偏好查询
  const m = /\(\s*(min|max)-(width|height)\s*:\s*(\d+)px\s*\)/.exec(q);
  if (m) {
    const v = m[2] === 'width' ? __WIN.innerWidth : __WIN.innerHeight;
    return m[1] === 'min' ? v >= +m[3] : v <= +m[3];
  }
  if (/prefers-color-scheme:\s*dark/.test(q)) return false;
  if (/prefers-color-scheme:\s*light/.test(q)) return true;
  if (/prefers-reduced-motion:\s*reduce/.test(q)) return false;
  if (/any-pointer:\s*fine/.test(q)) return true;
  if (/hover:\s*hover/.test(q)) return true;
  return false;
}

function __installWindow() {
  const w = __window;

  // 基本自引用
  defValue(w, 'window', w, false);
  defValue(w, 'self', w, false);
  defValue(w, 'globalThis', w, false);
  defValue(w, 'top', w, false);
  defValue(w, 'parent', w, false);
  defValue(w, 'frames', w, false);
  defGetter(w, 'length', () => 0);
  defValue(w, 'closed', false, false);
  defValue(w, 'opener', null, false);
  defValue(w, 'name', '', true);
  defValue(w, 'isSecureContext', true, false);
  defValue(w, 'origin', __CFG.origin, false);
  defValue(w, 'crossOriginIsolated', false, false);

  const docGet = () => __document;
  Object.defineProperty(w, 'document', { get: nativeLike(docGet, 'get document'), configurable: true, enumerable: true });

  const nav = new Navigator();
  defValue(w, 'navigator', nav, true);
  defValue(w, 'clientInformation', nav, true);
  defValue(w, 'screen', new Screen(), true);
  defValue(w, 'history', new History(), true);
  defValue(w, 'performance', new Performance(), true);
  defValue(w, 'localStorage', new Storage(), true);
  defValue(w, 'sessionStorage', new Storage(), true);
  defValue(w, 'location', __makeLocation(), true);
  defValue(w, 'visualViewport', {
    width: __WIN.innerWidth, height: __WIN.innerHeight, offsetLeft: 0, offsetTop: 0,
    pageLeft: 0, pageTop: 0, scale: 1, onresize: null, onscroll: null,
    addEventListener() {}, removeEventListener() {},
  }, true);

  for (const k of Object.keys(__WIN)) {
    defGetter(w, k, (() => { const key = k; return () => __WIN[key]; })());
  }

  // 定时器
  defValue(w, 'setTimeout', nativeLike(__setTimeout, 'setTimeout'), true);
  defValue(w, 'clearTimeout', nativeLike(__clearTimeout, 'clearTimeout'), true);
  defValue(w, 'setInterval', nativeLike(__setInterval, 'setInterval'), true);
  defValue(w, 'clearInterval', nativeLike(__clearInterval, 'clearInterval'), true);
  defValue(w, 'requestAnimationFrame', nativeLike(function (fn) {
    return __setTimeout(function () { fn(__HOST__.now()); }, 16);
  }, 'requestAnimationFrame'), true);
  defValue(w, 'cancelAnimationFrame', nativeLike(__clearTimeout, 'cancelAnimationFrame'), true);
  defValue(w, 'requestIdleCallback', nativeLike(function (fn) {
    return __setTimeout(function () {
      fn({ didTimeout: false, timeRemaining: () => 50 });
    }, 1);
  }, 'requestIdleCallback'), true);
  defValue(w, 'cancelIdleCallback', nativeLike(__clearTimeout, 'cancelIdleCallback'), true);
  defValue(w, 'queueMicrotask', nativeLike(function (fn) { Promise.resolve().then(fn); }, 'queueMicrotask'), true);

  // 样式与查询
  defValue(w, 'getComputedStyle', nativeLike(function (el, pseudo) {
    return __computedStyle(el);
  }, 'getComputedStyle'), true);
  defValue(w, 'matchMedia', nativeLike(function (q) { return new MediaQueryList(q); }, 'matchMedia'), true);

  // 编解码
  defValue(w, 'btoa', nativeLike(function (s) { return Buffer.from(String(s), 'latin1').toString('base64'); }, 'btoa'), true);
  defValue(w, 'atob', nativeLike(function (s) { return Buffer.from(String(s), 'base64').toString('latin1'); }, 'atob'), true);

  // crypto
  defValue(w, 'crypto', {
    getRandomValues: nativeLike(function (arr) {
      const bytes = __HOST__.randomBytes(arr.length * (arr.BYTES_PER_ELEMENT || 1));
      const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      view.set(bytes.subarray(0, view.length));
      return arr;
    }, 'getRandomValues'),
    randomUUID: nativeLike(function () { return __HOST__.uuid(); }, 'randomUUID'),
    subtle: {
      digest: nativeLike(function (alg, data) {
        const name = typeof alg === 'string' ? alg : alg && alg.name;
        return Promise.resolve(__HOST__.digest(name, new Uint8Array(data)).buffer);
      }, 'digest'),
      generateKey: nativeLike(() => Promise.resolve({})),
      importKey: nativeLike(() => Promise.resolve({})),
      encrypt: nativeLike(() => Promise.resolve(new ArrayBuffer(0))),
      decrypt: nativeLike(() => Promise.resolve(new ArrayBuffer(0))),
    },
  }, true);

  // chrome 对象（真实 Chrome 有，Edge 也有；内容要像）
  defValue(w, 'chrome', {
    app: {
      isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: nativeLike(function () { return null; }, 'getDetails'),
      getIsInstalled: nativeLike(function () { return false; }, 'getIsInstalled'),
    },
    csi: nativeLike(function () {
      return { onloadT: __HOST__.now(), startE: __HOST__.timeOrigin, pageT: 4.5, tran: 15 };
    }, 'csi'),
    loadTimes: nativeLike(function () {
      return {
        requestTime: __HOST__.timeOrigin / 1000, startLoadTime: __HOST__.timeOrigin / 1000,
        commitLoadTime: __HOST__.timeOrigin / 1000 + 0.1, finishDocumentLoadTime: __HOST__.timeOrigin / 1000 + 0.2,
        finishLoadTime: __HOST__.timeOrigin / 1000 + 0.25, firstPaintTime: __HOST__.timeOrigin / 1000 + 0.15,
        firstPaintAfterLoadTime: 0, navigationType: 'Other',
        wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
      };
    }, 'loadTimes'),
    runtime: undefined,
  }, true);

  // 其它常见构造器（按 Chrome 的可见性挂）
  defValue(w, 'Image', function Image(wd, ht) {
    const img = __document.createElement('img');
    if (wd !== undefined) img.width = wd;
    if (ht !== undefined) img.height = ht;
    return img;
  }, true);
  defValue(w, 'Audio', function Audio(src) {
    const a = __document.createElement('audio');
    if (src) a.src = src;
    return a;
  }, true);
  defValue(w, 'Option', function Option(text, value) {
    const o = __document.createElement('option');
    if (text !== undefined) o.textContent = text;
    if (value !== undefined) o.setAttribute('value', value);
    return o;
  }, true);
  // console：sensor 可能用它做调试输出；缺失会让脚本直接 ReferenceError
  const __console = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml',
    'table', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog',
    'count', 'countReset', 'assert', 'clear', 'profile', 'profileEnd', 'timeStamp']) {
    __console[m] = nativeLike((function (name) {
      return function (...a) {
        try {
          __HOST__.log('[console.' + name + '] ' + a.map(function (x) {
            if (x && typeof x === 'object') { try { return JSON.stringify(x); } catch (e) { return String(x); } }
            return String(x);
          }).join(' '));
        } catch (e) {}
      };
    })(m), m);
  }
  Object.defineProperty(__console, Symbol.toStringTag, { value: 'console', configurable: true });
  defValue(w, 'console', __console, true);

  defValue(w, 'Blob', Blob, true);
  defValue(w, 'URL', URLShim, true);
  defValue(w, 'URLSearchParams', URLSearchParams, true);
  defValue(w, 'TextEncoder', TextEncoderShim, true);
  defValue(w, 'TextDecoder', TextDecoderShim, true);
  defValue(w, 'AbortController', AbortControllerShim, true);
  defValue(w, 'AbortSignal', AbortSignalShim, true);
  defValue(w, 'FormData', FormDataShim, true);
  defValue(w, 'Headers', Headers, true);
  defValue(w, 'Request', Request, true);
  defValue(w, 'Response', Response, true);
  defValue(w, 'fetch', nativeLike(__fetch, 'fetch'), true);
  defValue(w, 'XMLHttpRequest', XMLHttpRequest, true);
  defValue(w, 'WebSocket', WebSocketShim, true);
  defValue(w, 'EventSource', EventSourceShim, true);
  defValue(w, 'FileReader', FileReaderShim, true);
  defValue(w, 'File', Blob, true);
  defValue(w, 'OffscreenCanvas', OffscreenCanvasShim, true);
  defValue(w, 'createImageBitmap', nativeLike(function () { return Promise.reject(new Error('not supported')); }, 'createImageBitmap'), true);
  defValue(w, 'ImageBitmap', function ImageBitmap() {}, true);
  defValue(w, 'MutationObserver', MutationObserver, true);
  defValue(w, 'IntersectionObserver', IntersectionObserverShim, true);
  defValue(w, 'ResizeObserver', ResizeObserverShim, true);
  defValue(w, 'PerformanceObserver', PerformanceObserverShim, true);
  defValue(w, 'Notification', NotificationShim, true);
  defValue(w, 'MatchMediaList', MediaQueryList, true);
  defValue(w, 'DOMParser', DOMParserShim, true);
  defValue(w, 'XMLSerializer', function XMLSerializer() { return { serializeToString: (n) => __serialize(n) }; }, true);
  defValue(w, 'Event', Event, true);
  defValue(w, 'CustomEvent', CustomEvent, true);
  defValue(w, 'UIEvent', UIEvent, true);
  defValue(w, 'MouseEvent', MouseEvent, true);
  defValue(w, 'KeyboardEvent', KeyboardEvent, true);
  defValue(w, 'MessageEvent', MessageEvent, true);
  defValue(w, 'ErrorEvent', ErrorEvent, true);
  defValue(w, 'ProgressEvent', ProgressEvent, true);
  defValue(w, 'EventTarget', EventTarget, true);
  defValue(w, 'DOMException', DOMException, true);
  defValue(w, 'Node', Node, true);
  defValue(w, 'Element', Element, true);
  defValue(w, 'HTMLElement', HTMLElement, true);
  defValue(w, 'Document', Document, true);
  defValue(w, 'HTMLDocument', Document, true);
  defValue(w, 'DocumentFragment', DocumentFragment, true);
  defValue(w, 'Text', Text, true);
  defValue(w, 'Comment', Comment, true);
  defValue(w, 'CharacterData', CharacterData, true);
  defValue(w, 'Attr', function Attr() {}, true);
  defValue(w, 'HTMLCanvasElement', HTMLCanvasElement, true);
  defValue(w, 'CanvasRenderingContext2D', CanvasRenderingContext2D, true);
  defValue(w, 'CanvasPattern', function CanvasPattern() {}, true);
  defValue(w, 'CanvasGradient', function CanvasGradient() {}, true);
  defValue(w, 'ImageData', function ImageData(w, h) {
    if (typeof w === 'number') return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' };
    return { width: w.width, height: w.height, data: w.data, colorSpace: 'srgb' };
  }, true);
  defValue(w, 'TextMetrics', function TextMetrics() {}, true);
  defValue(w, 'Path2D', function Path2D() { return { addPath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {}, closePath() {} }; }, true);
  defValue(w, 'WebGLRenderingContext', WebGLRenderingContext, true);
  defValue(w, 'WebGL2RenderingContext', WebGL2RenderingContext, true);
  defValue(w, 'WebGLBuffer', function WebGLBuffer() {}, true);
  defValue(w, 'WebGLProgram', function WebGLProgram() {}, true);
  defValue(w, 'WebGLShader', function WebGLShader() {}, true);
  defValue(w, 'WebGLTexture', function WebGLTexture() {}, true);
  defValue(w, 'WebGLUniformLocation', function WebGLUniformLocation() {}, true);
  defValue(w, 'WebGLActiveInfo', function WebGLActiveInfo() {}, true);
  defValue(w, 'WebGLShaderPrecisionFormat', function WebGLShaderPrecisionFormat() {}, true);
  defValue(w, 'WebGLFramebuffer', function WebGLFramebuffer() {}, true);
  defValue(w, 'WebGLRenderbuffer', function WebGLRenderbuffer() {}, true);
  defValue(w, 'AudioContext', AudioContext, true);
  defValue(w, 'webkitAudioContext', AudioContext, true);
  defValue(w, 'OfflineAudioContext', OfflineAudioContext, true);
  defValue(w, 'webkitOfflineAudioContext', OfflineAudioContext, true);
  defValue(w, 'AudioNode', AudioNode, true);
  defValue(w, 'AudioParam', AudioParam, true);
  defValue(w, 'OscillatorNode', function OscillatorNode() {}, true);
  defValue(w, 'GainNode', function GainNode() {}, true);
  defValue(w, 'DynamicsCompressorNode', function DynamicsCompressorNode() {}, true);
  defValue(w, 'AnalyserNode', function AnalyserNode() {}, true);
  defValue(w, 'Storage', Storage, true);
  defValue(w, 'Screen', Screen, true);
  defValue(w, 'Location', Location, true);
  defValue(w, 'History', History, true);
  defValue(w, 'Navigator', Navigator, true);
  defValue(w, 'Performance', Performance, true);
  defValue(w, 'Plugin', function Plugin() {}, true);
  defValue(w, 'PluginArray', PluginArray, true);
  defValue(w, 'MimeType', function MimeType() {}, true);
  defValue(w, 'MimeTypeArray', MimeTypeArray, true);
  defValue(w, 'CSSStyleDeclaration', CSSStyleDeclaration, true);
  defValue(w, 'CSS', {
    supports: nativeLike(function () { return true; }, 'supports'),
    escape: nativeLike(function (s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c); }, 'escape'),
  }, true);
  defValue(w, 'HTMLIFrameElement', HTMLIFrameElement, true);
  defValue(w, 'HTMLScriptElement', HTMLScriptElement, true);
  defValue(w, 'HTMLImageElement', HTMLImageElement, true);
  defValue(w, 'HTMLAnchorElement', HTMLAnchorElement, true);
  defValue(w, 'HTMLInputElement', HTMLInputElement, true);
  defValue(w, 'HTMLDivElement', HTMLDivElement, true);
  defValue(w, 'HTMLSpanElement', HTMLSpanElement, true);
  defValue(w, 'HTMLBodyElement', HTMLBodyElement, true);
  defValue(w, 'HTMLHeadElement', HTMLHeadElement, true);
  defValue(w, 'HTMLHtmlElement', HTMLHtmlElement, true);
  defValue(w, 'HTMLStyleElement', HTMLStyleElement, true);
  defValue(w, 'HTMLLinkElement', HTMLLinkElement, true);
  defValue(w, 'HTMLMetaElement', HTMLMetaElement, true);
  defValue(w, 'HTMLTitleElement', HTMLTitleElement, true);
  defValue(w, 'HTMLMediaElement', HTMLMediaElement, true);
  defValue(w, 'HTMLAudioElement', HTMLAudioElement, true);
  defValue(w, 'HTMLVideoElement', HTMLVideoElement, true);
  defValue(w, 'HTMLUnknownElement', HTMLUnknownElement, true);
  defValue(w, 'HTMLElement', HTMLElement, true);
  defValue(w, 'MediaQueryList', MediaQueryList, true);
  defValue(w, 'MessageChannel', MessageChannelShim, true);
  defValue(w, 'MessagePort', function MessagePort() {}, true);
  defValue(w, 'BroadcastChannel', BroadcastChannelShim, true);
  defValue(w, 'Worker', function Worker() { throw new DOMException('Worker is not supported', 'SecurityError'); }, true);
  defValue(w, 'SharedWorker', undefined, true);
  defValue(w, 'ServiceWorker', undefined, true);
  defValue(w, 'indexedDB', {
    open: nativeLike(function () {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
      setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0);
      return req;
    }, 'open'),
    deleteDatabase: nativeLike(function () { return {}; }, 'deleteDatabase'),
    databases: nativeLike(function () { return Promise.resolve([]); }, 'databases'),
  }, true);
  defValue(w, 'caches', undefined, true);
  defValue(w, 'cookieStore', {
    get: nativeLike(function () { return Promise.resolve(null); }, 'get'),
    getAll: nativeLike(function () { return Promise.resolve([]); }, 'getAll'),
    set: nativeLike(function () { return Promise.resolve(); }, 'set'),
    addEventListener() {}, removeEventListener() {},
  }, true);
  defValue(w, 'speechSynthesis', {
    speaking: false, pending: false, paused: false,
    getVoices: nativeLike(function () { return []; }, 'getVoices'),
    speak() {}, cancel() {}, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  }, true);
  defValue(w, 'webkitSpeechSynthesis', w.speechSynthesis, true);
  defValue(w, 'PerformanceObserverEntryList', function () {}, true);
  defValue(w, 'DOMRect', function DOMRect(x, y, w, h) {
    return { x: x || 0, y: y || 0, width: w || 0, height: h || 0, top: y || 0, left: x || 0, right: (x || 0) + (w || 0), bottom: (y || 0) + (h || 0) };
  }, true);
  defValue(w, 'DOMRectReadOnly', w.DOMRect, true);
  defValue(w, 'DOMTokenList', function DOMTokenList() {}, true);
  defValue(w, 'HTMLCollection', function HTMLCollection() {}, true);
  defValue(w, 'NodeList', function NodeList() {}, true);
  defValue(w, 'Range', function Range() {
    return { setStart() {}, setEnd() {}, selectNode() {}, collapse() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }), detach() {} };
  }, true);
  defValue(w, 'Selection', function Selection() { return { removeAllRanges() {}, addRange() {}, toString: () => '' }; }, true);

  // 窗口动作
  defValue(w, 'open', nativeLike(function () { return null; }, 'open'), true);
  defValue(w, 'close', nativeLike(function () {}, 'close'), true);
  defValue(w, 'focus', nativeLike(function () {}, 'focus'), true);
  defValue(w, 'blur', nativeLike(function () {}, 'blur'), true);
  defValue(w, 'print', nativeLike(function () {}, 'print'), true);
  defValue(w, 'stop', nativeLike(function () {}, 'stop'), true);
  defValue(w, 'alert', nativeLike(function () {}, 'alert'), true);
  defValue(w, 'confirm', nativeLike(function () { return true; }, 'confirm'), true);
  defValue(w, 'prompt', nativeLike(function () { return null; }, 'prompt'), true);
  defValue(w, 'scrollTo', nativeLike(function () {}, 'scrollTo'), true);
  defValue(w, 'scrollBy', nativeLike(function () {}, 'scrollBy'), true);
  defValue(w, 'scroll', nativeLike(function () {}, 'scroll'), true);
  defValue(w, 'postMessage', nativeLike(function (msg, targetOrigin) {
    __setTimeout(function () {
      const ev = new MessageEvent('message', {
        data: msg, origin: typeof targetOrigin === 'string' ? targetOrigin : __CFG.origin, source: __window,
      });
      __window.dispatchEvent(ev);
    }, 0);
  }, 'postMessage'), true);
  defValue(w, 'structuredClone', nativeLike(function (v) { return JSON.parse(JSON.stringify(v)); }, 'structuredClone'), true);

  // on* 事件属性
  installOnHandlers(w, ['load', 'unload', 'beforeunload', 'pageshow', 'pagehide', 'error',
    'online', 'offline', 'resize', 'scroll', 'message', 'focus', 'blur', 'hashchange',
    'popstate', 'visibilitychange', 'devicemotion', 'orientationchange', 'storage',
    'pointerdown', 'click', 'keydown', 'DOMContentLoaded', 'readystatechange']);

  // 显式的宿主可见性诊断钩子（默认不可枚举，避免被 Object.keys 看到）
  Object.defineProperty(w, '__diag', { value: __diagApi, configurable: true, enumerable: false });
}

function __makeLocation() {
  return new Location(__CFG.entryUrl);
}

// 计算样式：合并行内样式 + 元素默认样式 + 已知 CSS 规则
function __computedStyle(el) {
  const decl = Object.assign({}, st(el).style ? (st(st(el).style).decl || {}) : {});
  const tag = (st(el).tagName || '').toLowerCase();
  const d = {
    display: BLOCK_TAGS.has(tag) ? 'block' : INLINE_TAGS.has(tag) ? 'inline' : 'block',
    visibility: 'visible',
    opacity: '1',
    position: 'static',
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
    float: 'none',
    clear: 'none',
    cursor: 'auto',
    pointerEvents: 'auto',
    zIndex: 'auto',
    transform: 'none',
    filter: 'none',
    clipPath: 'none',
    contentVisibility: 'visible',
    contain: 'none',
    willChange: 'auto',
    userSelect: 'auto',
    appearance: 'none',
    boxSizing: 'content-box',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'normal',
    justifyContent: 'normal',
    textAlign: 'start',
    whiteSpace: 'normal',
    letterSpacing: 'normal',
    wordSpacing: '0px',
    lineHeight: 'normal',
    fontSize: tag === 'h1' ? '32px' : '16px',
    fontFamily: '"Times New Roman"',
    fontWeight: /^h[1-6]$/.test(tag) ? 'bold' : 'normal',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
    paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
    marginTop: '8px', marginRight: '8px', marginBottom: '8px', marginLeft: '8px',
    maxWidth: 'none', minWidth: '0px', maxHeight: 'none', minHeight: '0px',
    top: 'auto', left: 'auto', right: 'auto', bottom: 'auto',
  };
  const b = __box(el);
  d.width = b.ow + 'px';
  d.height = b.oh + 'px';
  const out = {};
  for (const k of Object.keys(d)) out[k] = d[k];
  for (const [k, v] of Object.entries(decl)) if (v !== '') out[k] = v;
  if (out.display === 'none') { out.width = '0px'; out.height = '0px'; }

  const api = {
    getPropertyValue(p) {
      const key = camel(p);
      const v = out[key];
      return v === undefined ? '' : String(v);
    },
    getPropertyPriority() { return ''; },
    item(i) { return Object.keys(out)[i] || ''; },
    get length() { return Object.keys(out).length; },
    cssText: '',
    parentRule: null,
  };
  for (const k of Object.keys(out)) {
    Object.defineProperty(api, k, {
      configurable: true, enumerable: true,
      get() { return String(out[k]); },
      set(v) { out[k] = v; },
    });
  }
  Object.defineProperty(api, Symbol.toStringTag, { value: 'CSS2Properties', configurable: true });
  return api;
}

// ══════════════════════════════════════════════════════════════════
// 杂项构造器
// ══════════════════════════════════════════════════════════════════

class Blob {
  constructor(parts, opts) {
    const bufs = (parts || []).map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p)));
    st(this).buf = Buffer.concat(bufs);
    st(this).type = (opts && opts.type) || '';
  }
  get size() { return st(this).buf.length; }
  get type() { return st(this).type; }
  text() { return Promise.resolve(st(this).buf.toString('utf8')); }
  arrayBuffer() { return Promise.resolve(st(this).buf.buffer.slice(st(this).buf.byteOffset, st(this).buf.byteOffset + st(this).buf.length)); }
  slice(a, b, type) { return new Blob([st(this).buf.slice(a, b)], { type }); }
  stream() { return {}; }
}

class URLShim extends URL {
  static createObjectURL() { return 'blob:' + __CFG.origin + '/' + __HOST__.uuid(); }
  static revokeObjectURL() {}
  static canParse(u) { try { new URL(u); return true; } catch (e) { return false; } }
  get searchParams() { return super.searchParams; }
}

class TextEncoderShim {
  get encoding() { return 'utf-8'; }
  encode(s) {
    const b = Buffer.from(String(s === undefined ? '' : s), 'utf8');
    return new Uint8Array(b);
  }
  encodeInto(s, dest) {
    const b = Buffer.from(String(s), 'utf8');
    const n = Math.min(b.length, dest.length);
    for (let i = 0; i < n; i++) dest[i] = b[i];
    return { read: String(s).length, written: n };
  }
}
class TextDecoderShim {
  constructor(label, opts) { st(this).enc = label || 'utf-8'; st(this).fatal = !!(opts && opts.fatal); }
  get encoding() { return 'utf-8'; }
  get fatal() { return st(this).fatal; }
  get ignoreBOM() { return false; }
  decode(buf) {
    if (!buf) return '';
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    return Buffer.from(u8).toString('utf8');
  }
}

class MutationObserver {
  constructor(cb) { st(this).cb = cb; st(this).records = []; st(this).obs = []; }
  observe(target, opts) { st(this).obs.push({ target, opts }); }
  disconnect() { st(this).obs.length = 0; st(this).records.length = 0; }
  takeRecords() { const r = st(this).records.slice(); st(this).records.length = 0; return r; }
}
class IntersectionObserverShim extends EventTarget {
  constructor(cb, opts) { super(); st(this).cb = cb; }
  observe(t) { const self = this; __setTimeout(function () { try { st(self).cb([{ target: t, isIntersecting: true, intersectionRatio: 1, boundingClientRect: __rect(t), intersectionRect: __rect(t), rootBounds: null, time: __HOST__.now() }], self); } catch (e) {} }, 0); }
  unobserve() {} disconnect() {} takeRecords() { return []; }
}
class ResizeObserverShim {
  constructor(cb) { st(this).cb = cb; }
  observe(t) { const self = this; __setTimeout(function () { try { const r = __rect(t); st(self).cb([{ target: t, contentRect: r, borderBoxSize: [{ inlineSize: r.width, blockSize: r.height }], contentBoxSize: [{ inlineSize: r.width, blockSize: r.height }] }], self); } catch (e) {} }, 0); }
  unobserve() {} disconnect() {}
}
class PerformanceObserverShim {
  constructor(cb) { st(this).cb = cb; }
  observe() {} disconnect() {} takeRecords() { return []; }
}
class NotificationShim extends EventTarget {
  constructor(title, opts) {
    super();
    st(this).title = String(title);
    st(this).body = (opts && opts.body) || '';
    this.onclick = null;
  }
  get title() { return st(this).title; }
  get body() { return st(this).body; }
  close() {}
  static requestPermission(cb) { if (cb) __setTimeout(() => cb('default'), 0); return Promise.resolve('default'); }
}
Object.defineProperty(NotificationShim, 'permission', { get: () => 'default', configurable: true });
NotificationShim.maxActions = 2;

class DOMParserShim {
  parseFromString(str, type) {
    const d = __makeDocument(__CFG.origin + '/');
    d.documentElement.innerHTML = String(str);
    return d;
  }
}
class MessageChannelShim {
  constructor() {
    const self = this;
    this.port1 = { postMessage(m) { __setTimeout(() => self.port2.onmessage && self.port2.onmessage({ data: m }), 0); }, onmessage: null, start() {}, close() {}, addEventListener() {}, removeEventListener() {} };
    this.port2 = { postMessage(m) { __setTimeout(() => self.port1.onmessage && self.port1.onmessage({ data: m }), 0); }, onmessage: null, start() {}, close() {}, addEventListener() {}, removeEventListener() {} };
  }
}
class BroadcastChannelShim extends EventTarget {
  constructor(name) { super(); st(this).name = String(name); }
  get name() { return st(this).name; }
  postMessage() {} close() {}
}

// ══════════════════════════════════════════════════════════════════
// 诊断 API（由 __diag 暴露，sensor 看不到）
// ══════════════════════════════════════════════════════════════════

const __diagApi = {
  __version: 1,
  getDocument() { return __document; },
  getWindow() { return __window; },
  setReadyState(v) { st(__document).readyState = v; },
  setCurrentScript(el) { st(__document).currentScriptVal = el; },
  html(selector) {
    const el = selector ? __document.querySelector(selector) : __document.documentElement;
    return el ? el.outerHTML : null;
  },
  dateStats() {
    return {
      dateNow: { calls: __dateStats.calls, span: (__dateStats.first === null ? 0 : __dateStats.last - __dateStats.first) },
      dateObj: { calls: __dateObjStats.calls, span: (__dateObjStats.first === null ? 0 : __dateObjStats.last - __dateObjStats.first) },
    };
  },
  dumpBox(el) { return __box(el); },
  rect(el) { return __rect(el); },
};

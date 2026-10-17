/* reese84_iv8_hooks.js —— 一体化环境补丁 + 追踪
 * ============================================================================
 * 合并四件事，按此顺序 prepend 到 VM 源码前执行（与 VM 同一个 <script>）：
 *   1. 布局补丁：补 offsetWidth/Height/Left/Top、offsetParent、
 *      getBoundingClientRect、getComputedStyle  —— 绕过 reese84 的广告拦截检测
 *   2. iframe 伪造：VM 动态造的 iframe 在 iv8 里永远等不到 load，
 *      这里在它注册 load 监听后自动派发一次，并伪造 contentWindow/contentDocument
 *   3. cookie 追踪：记录 document.cookie 的每次写入
 *   4. DOM/网络追踪：记录创建的元素、表单提交、XHR/fetch/beacon
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__r84Hooked) return;
  window.__r84Hooked = true;

  window.__r84 = {
    layout: [], hooks: [], cookies: [], tags: [], net: [], ipCalls: [], err: [],
  };
  var R = window.__r84;
  function log(k, s) { try { R[k].push(s); } catch (e) {} }

  // ══════════════════════════════════════════════════════════════════════
  // 1. 布局补丁（iv8 社区版无 CSS 布局引擎）
  // ══════════════════════════════════════════════════════════════════════
  function stylePx(el, prop) {
    try {
      var v = el.style && el.style[prop];
      if (v) { var n = parseFloat(v); if (!isNaN(n)) return n; }
    } catch (e) {}
    return null;
  }
  function hidden(el) {
    try { var s = el.style || {}; return s.display === 'none' || s.visibility === 'hidden'; }
    catch (e) { return false; }
  }

  try {
    var MAP = { offsetWidth: 'width', offsetHeight: 'height', offsetLeft: 'left', offsetTop: 'top' };
    Object.keys(MAP).forEach(function (jsP) {
      var cssP = MAP[jsP];
      try {
        Object.defineProperty(HTMLElement.prototype, jsP, {
          configurable: true, enumerable: true,
          get: function () {
            try {
              if (hidden(this)) return 0;
              if (cssP === 'width')  { var w = this.clientWidth;  if (w) return w; }
              if (cssP === 'height') { var h = this.clientHeight; if (h) return h; }
              var n = stylePx(this, cssP);
              if (n !== null) return Math.round(n);
              if (cssP === 'width')  return 300;
              if (cssP === 'height') return 150;
              return 0;
            } catch (e) { return 0; }
          },
        });
      } catch (e) { log('err', 'offset ' + jsP + ': ' + e); }
    });

    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true, enumerable: true,
      get: function () {
        try {
          if (hidden(this)) return null;
          if (this === document.body || this === document.documentElement) return null;
          var pos = (this.style && this.style.position) || '';
          if (pos === 'fixed') return null;
          return document.body || document.documentElement || null;
        } catch (e) { return document.body || null; }
      },
    });
  } catch (e) { log('err', 'layout: ' + e); }

  try {
    var _rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      var r = null;
      try { r = _rect ? _rect.call(this) : null; } catch (e) { r = null; }
      if (r && (r.width || r.height)) return r;
      try {
        var w = this.clientWidth  || stylePx(this, 'width')  || 300;
        var h = this.clientHeight || stylePx(this, 'height') || 150;
        var l = stylePx(this, 'left'); if (l === null) l = 0;
        var t = stylePx(this, 'top');  if (t === null) t = 0;
        return { x: l, y: t, width: w, height: h, top: t, right: l + w,
                 bottom: t + h, left: l };
      } catch (e) {
        return r || { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
      }
    };
  } catch (e) { log('err', 'rect: ' + e); }

  try {
    var _gcs = window.getComputedStyle;
    if (typeof _gcs === 'function') {
      window.getComputedStyle = function (el) {
        var s = _gcs.apply(this, arguments);
        try {
          var _gpv = s.getPropertyValue.bind(s);
          s.getPropertyValue = function (prop) {
            var v = _gpv(prop);
            if (v === '' || v === null || v === undefined) {
              var p = String(prop).toLowerCase();
              var sty = (el && el.style) || {};
              if (p === 'display')    return sty.display || 'block';
              if (p === 'visibility') return sty.visibility || 'visible';
              if (p === 'opacity')    return sty.opacity || '1';
              if (p === 'position')   return sty.position || 'static';
              if (p === 'overflow')   return sty.overflow || 'visible';
              if (p === 'width')  return ((el && el.clientWidth)  || 300) + 'px';
              if (p === 'height') return ((el && el.clientHeight) || 150) + 'px';
            }
            return v;
          };
        } catch (e) {}
        return s;
      };
    }
  } catch (e) { log('err', 'gcs: ' + e); }

  // ══════════════════════════════════════════════════════════════════════
  // 2. iframe 伪造（iv8 没有 iframe 浏览上下文 → load 永不触发）
  // ══════════════════════════════════════════════════════════════════════
  function patchIframe(el) {
    if (el.__r84If) return;
    el.__r84If = true;
    try {
      var _w, _d;
      Object.defineProperty(el, 'contentWindow', {
        configurable: true, enumerable: true,
        get: function () { if (!_w) { try { _w = window; } catch (e) { _w = null; } } return _w; },
      });
      Object.defineProperty(el, 'contentDocument', {
        configurable: true, enumerable: true,
        get: function () { try { return _d || document; } catch (e) { return null; } },
      });
    } catch (e) { log('err', 'iframe prop: ' + e); }

    var _a = el.addEventListener;
    el.addEventListener = function (t, f, o) {
      if (t === 'load' && typeof f === 'function') {
        var wrapped = function () {
          try { return f.apply(this, arguments); }
          catch (e) { log('err', 'iframe load handler: ' + e); return undefined; }
        };
        var r = _a.call(this, t, wrapped, o);
        setTimeout(function () {
          try {
            var ev = new Event('load');
            el.dispatchEvent(ev);
            log('hooks', 'dispatched iframe load');
          } catch (e) { log('err', 'iframe dispatch: ' + e); }
        }, 20);
        return r;
      }
      return _a.apply(this, arguments);
    };

    try {
      var _ol;
      Object.defineProperty(el, 'onload', {
        configurable: true, enumerable: true,
        get: function () { return _ol; },
        set: function (v) {
          _ol = function () {
            try { return v.apply(this, arguments); }
            catch (e) { log('err', 'iframe onload: ' + e); }
          };
        },
      });
    } catch (e) {}
  }

  var _ce = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = _ce.apply(this, arguments);
    var t = String(tag).toLowerCase();
    log('tags', t);
    if (t === 'iframe') patchIframe(el);
    return el;
  };
  try { Array.prototype.forEach.call(document.querySelectorAll('iframe'), patchIframe); } catch (e) {}

  // ══════════════════════════════════════════════════════════════════════
  // 3. cookie 写入追踪
  // ══════════════════════════════════════════════════════════════════════
  try {
    var _cd = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (_cd && _cd.set) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true, enumerable: true,
        get: function () { return _cd.get.call(this); },
        set: function (v) {
          var s = String(v);
          log('cookies', s.slice(0, 60) + '  (总长 ' + s.length + ')');
          return _cd.set.call(this, v);
        },
      });
    }
  } catch (e) { log('err', 'cookie hook: ' + e); }

  // ══════════════════════════════════════════════════════════════════════
  // 4. 网络 + 提交追踪
  // ══════════════════════════════════════════════════════════════════════
  try {
    var _o = XMLHttpRequest.prototype.open, _s = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return _o.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      log('net', 'XHR ' + this.__m + ' ' + String(this.__u).slice(0, 110) +
                 ' len=' + (b == null ? 0 : String(b).length));
      return _s.apply(this, arguments);
    };
  } catch (e) { log('err', 'xhr hook: ' + e); }
  try {
    var _f = window.fetch;
    if (_f) window.fetch = function (a, b) {
      try {
        var url = String((a && a.url) || a);
        var method = (b && b.method) || 'GET';
        var bd = b && b.body;
        var bodyStr = '';
        if (bd != null) {
          if (typeof bd === 'string') {
            bodyStr = bd;
          } else if (typeof FormData !== 'undefined' && bd instanceof FormData) {
            var parts = [];
            bd.forEach(function (v, k) { parts.push(k + '=' + String(v)); });
            bodyStr = parts.join('&');
          } else if (typeof URLSearchParams !== 'undefined' && bd instanceof URLSearchParams) {
            bodyStr = bd.toString();
          } else {
            try { bodyStr = String(bd); } catch (e2) {}
          }
        }
        log('net', 'fetch ' + method + ' ' + url.slice(0, 110) + ' bodyLen=' + bodyStr.length);
        // ★ 把完整 payload 留存，Python 侧读走
        if (bodyStr.length > 200) {
          window.__body_full = bodyStr;
          window.__body_url = url;
          window.__body_method = method;
          window.__postback = url.split('?')[0];
          window.__body_headers = (function () {
            var hs = [];
            try {
              var h = b && b.headers;
              if (h) {
                if (typeof h.forEach === 'function') h.forEach(function (v, k) { hs.push(k + ':' + v); });
                else for (var k in h) hs.push(k + ':' + h[k]);
              }
            } catch (e3) {}
            return hs.join('; ');
          })();
        }
      } catch (e4) { log('err', 'fetch cap: ' + e4); }
      return _f.apply(this, arguments);
    };
  } catch (e) {}
  try {
    var _sb = navigator.sendBeacon;
    if (_sb) navigator.sendBeacon = function (u, d) {
      log('net', 'beacon ' + String(u).slice(0, 110) + ' len=' + String(d).length);
      return _sb.apply(this, arguments);
    };
  } catch (e) {}
  try {
    var _fs = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      log('net', 'form.submit ' + String(this.action).slice(0, 110) + ' target=' + this.target);
      return _fs.apply(this, arguments);
    };
  } catch (e) {}

  // ══════════════════════════════════════════════════════════════════════
  // 5. 捕获 initializeProtection 调用
  // ══════════════════════════════════════════════════════════════════════
  try {
    var _ip;
    Object.defineProperty(window, 'initializeProtection', {
      configurable: true, enumerable: true,
      get: function () { return _ip; },
      set: function (v) {
        _ip = function () {
          log('ipCalls', 'CALLED');
          return v.apply(this, arguments);
        };
      },
    });
  } catch (e) { log('err', 'ip hook: ' + e); }

  window.addEventListener('error', function (e) { log('err', 'window: ' + e.message); }, true);
  window.addEventListener('unhandledrejection', function (e) {
    log('err', 'rejection: ' + String(e.reason).slice(0, 200));
  }, true);
})();

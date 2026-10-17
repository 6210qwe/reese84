// ============================================================
// collect_trace.js —— 采集 API 调用轨迹探针（两端通用）
//
// 思路（这一轮的核心）：
//   浏览器 / iv8 / 我们的补环境，跑的是**同一份 sensor 脚本**。
//   所以差异只可能来自"sensor 调用的 Web API 返回了什么"。
//
//   那就不去逆向 JSVMP，直接把 sensor 会调的那些 API 全部包一层，
//   记录「第几次调用、哪个 API、参数、返回值」。
//   两端各跑一遍，diff 序列 —— 第一个分叉点就是问题的精确坐标。
//
//   这个探针不依赖任何内部实现，只依赖标准 Web API，所以两边都能挂。
//   （比上一轮"固定随机数对齐密文"实际得多：密文对不齐，但 API 返回值一定能对齐。）
//
// 用法：
//   iv8  : 把本文件 prepend 到 VM 源码前
//   Node : 在 env 装配完成后 runInContext 注入
//   产物  : globalThis.__TRACE（数组），宿主侧导出成 JSON
// ============================================================
(function () {
  if (globalThis.__TRACE_INSTALLED__) return;
  globalThis.__TRACE_INSTALLED__ = true;

  var TR = [];
  globalThis.__TRACE = TR;
  var MAX = 20000;

  // 值摘要：只保留"能被判等"的部分，避免把巨大的 base64 全存下来
  function brief(v, depth) {
    depth = depth || 0;
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'number') return 'n:' + (Number.isFinite(v) ? v : String(v));
      if (t === 'boolean') return 'b:' + v;
      if (t === 'string') {
        // 长字符串只保留长度 + 前 24 + 哈希，避免 trace 爆炸
        if (v.length > 48) return 's:' + v.length + ':' + v.slice(0, 24) + '#' + hash(v);
        return 's:' + v;
      }
      if (t === 'function') return 'fn:' + (v.name || '');
      if (t === 'symbol') return 'sym';
      if (depth > 2) return '{deep}';
      if (Array.isArray(v)) {
        if (v.length > 12) return 'arr[' + v.length + ']';
        return 'arr[' + v.map(function (x) { return brief(x, depth + 1); }).join(',') + ']';
      }
      if (v && typeof v === 'object') {
        var tag = Object.prototype.toString.call(v);
        // canvas / ctx 这类对象只报类型，不展开
        if (/Canvas|Context|Element|Window|Node/i.test(tag)) return tag;
        var ks = Object.keys(v);
        if (!ks.length) return tag;
        if (ks.length > 8) return tag + '{' + ks.length + 'keys}';
        return tag + '{' + ks.map(function (k) {
          return k + '=' + brief(v[k], depth + 1);
        }).join(',') + '}';
      }
      return String(v);
    } catch (e) { return 'ERR:' + (e && e.name); }
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ── 只记 sensor 发起的调用 ──
  // 第一版没做过滤，结果 canvas.width 出现 572 次、ctx.font 169 次 ——
  // 那些全是我自己实现内部的读取（__syncSize 读 width、measureText 读 this.font），
  // 属于观测偏差。真正要看的是 sensor 调了什么。
  //
  // 判据：sensor 的代码是在 eval 里跑的（栈里含 __runExternalScript），
  // 而我的补环境代码在 env-bootstrap.js 里。两者靠栈帧区分。
  var SELF_PAT = /env-bootstrap\.js/;
  var SENSOR_PAT = /__runExternalScript/;
  function fromSensor() {
    if (!FILTER) return true;
    try {
      var st = (new Error()).stack || '';
      if (!SENSOR_PAT.test(st)) return false;
      // 栈里既出现 sensor 又出现 bootstrap 时，看最靠近栈顶的那一帧
      var lines = st.split('\n');
      for (var i = 0; i < lines.length && i < 8; i++) {
        if (SENSOR_PAT.test(lines[i])) return true;
        if (SELF_PAT.test(lines[i])) return false;
      }
      return true;
    } catch (e) { return true; }
  }
  var FILTER = true;

  function rec(api, args, ret) {
    if (TR.length >= MAX) return;
    if (!fromSensor()) return;
    var a = '';
    try {
      if (args && args.length) {
        var parts = [];
        for (var i = 0; i < Math.min(args.length, 3); i++) parts.push(brief(args[i]));
        a = parts.join(' , ');
      }
    } catch (e) { a = '?'; }
    TR.push(api + '(' + a + ') => ' + (ret === undefined ? 'undefined' : brief(ret)));
  }

  // ── 包装工具 ──
  function wrapFn(obj, name, label) {
    if (!obj || typeof obj[name] !== 'function') return;
    var og = obj[name];
    obj[name] = function () {
      var r = og.apply(this, arguments);
      rec(label || name, arguments, r);
      return r;
    };
    try { Object.defineProperty(obj[name], 'name', { value: name }); } catch (e) {}
  }

  function wrapGetter(proto, name, label) {
    try {
      var d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.get) return;
      var og = d.get;
      Object.defineProperty(proto, name, {
        get: function () {
          var r = og.call(this);
          rec(label || ('get ' + name), [], r);
          return r;
        },
        set: d.set, configurable: true, enumerable: d.enumerable,
      });
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════════════
  // 1. navigator 上的标量（sensor 一定会读）
  // ══════════════════════════════════════════════════════════
  var NAV = ['userAgent', 'platform', 'vendor', 'vendorSub', 'product', 'productSub',
    'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints',
    'doNotTrack', 'cookieEnabled', 'onLine', 'webdriver', 'pdfViewerEnabled',
    'appCodeName', 'appName', 'appVersion', 'buildID', 'cpuClass'];
  for (var i = 0; i < NAV.length; i++) {
    wrapGetter(Navigator.prototype, NAV[i], 'nav.' + NAV[i]);
  }
  wrapGetter(Navigator.prototype, 'plugins', 'nav.plugins');
  wrapGetter(Navigator.prototype, 'mimeTypes', 'nav.mimeTypes');
  wrapGetter(Navigator.prototype, 'userAgentData', 'nav.userAgentData');

  // ══════════════════════════════════════════════════════════
  // 2. screen / window 尺寸
  // ══════════════════════════════════════════════════════════
  var SCR = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth',
    'availLeft', 'availTop'];
  for (var j = 0; j < SCR.length; j++) wrapGetter(Screen.prototype, SCR[j], 'screen.' + SCR[j]);

  var WIN = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
    'screenX', 'screenY', 'screenLeft', 'screenTop', 'scrollX', 'scrollY'];
  for (var k = 0; k < WIN.length; k++) {
    wrapGetter(Window.prototype, WIN[k], 'win.' + WIN[k]);
    // 有些环境把 innerWidth 直接挂在实例上
    try {
      if (Object.getOwnPropertyDescriptor(window, WIN[k])) {
        (function (n) {
          var d0 = Object.getOwnPropertyDescriptor(window, n);
          if (d0 && d0.get) {
            var g0 = d0.get;
            Object.defineProperty(window, n, {
              get: function () { var r = g0.call(this); rec('win.' + n, [], r); return r; },
              configurable: true, enumerable: true,
            });
          }
        })(WIN[k]);
      }
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════════════
  // 3. canvas —— 最关键的一块
  // ══════════════════════════════════════════════════════════
  wrapFn(HTMLCanvasElement.prototype, 'getContext', 'canvas.getContext');
  wrapFn(HTMLCanvasElement.prototype, 'toDataURL', 'canvas.toDataURL');
  wrapFn(HTMLCanvasElement.prototype, 'toBlob', 'canvas.toBlob');
  wrapGetter(HTMLCanvasElement.prototype, 'width', 'canvas.width');
  wrapGetter(HTMLCanvasElement.prototype, 'height', 'canvas.height');

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    var C2D = ['measureText', 'getImageData', 'putImageData', 'fillText', 'strokeText',
      'fillRect', 'strokeRect', 'clearRect', 'rect', 'beginPath', 'moveTo', 'lineTo',
      'arc', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale',
      'drawImage', 'createLinearGradient', 'setTransform', 'clip', 'quadraticCurveTo',
      'bezierCurveTo', 'closePath'];
    for (var m = 0; m < C2D.length; m++) wrapFn(CanvasRenderingContext2D.prototype, C2D[m], 'ctx.' + C2D[m]);
    var C2P = ['font', 'fillStyle', 'strokeStyle', 'textBaseline', 'textAlign',
      'globalAlpha', 'globalCompositeOperation', 'lineWidth', 'lineCap', 'lineJoin',
      'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter',
      'imageSmoothingEnabled', 'direction', 'letterSpacing', 'wordSpacing'];
    for (var p = 0; p < C2P.length; p++) {
      (function (nm) {
        try {
          var d2 = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, nm);
          if (!d2 || !d2.get) return;
          var g2 = d2.get, s2 = d2.set;
          Object.defineProperty(CanvasRenderingContext2D.prototype, nm, {
            get: function () { var r = g2.call(this); rec('ctx.' + nm, [], r); return r; },
            set: function (v) { rec('set ctx.' + nm, [v], undefined); return s2.call(this, v); },
            configurable: true, enumerable: d2.enumerable,
          });
        } catch (e) {}
      })(C2P[p]);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 4. WebGL
  // ══════════════════════════════════════════════════════════
  ['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach(function (cn) {
    var C = globalThis[cn];
    if (typeof C === 'undefined') return;
    ['getParameter', 'getExtension', 'getSupportedExtensions', 'readPixels',
      'getShaderPrecisionFormat', 'getContextAttributes'].forEach(function (fn) {
      wrapFn(C.prototype, fn, cn + '.' + fn);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 5. Audio
  // ══════════════════════════════════════════════════════════
  ['AudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext'].forEach(function (cn) {
    var C = globalThis[cn];
    if (typeof C === 'undefined') return;
    ['createOscillator', 'createDynamicsCompressor', 'createAnalyser', 'createGain',
      'createScriptProcessor', 'startRendering', 'createBuffer', 'createBufferSource',
      'decodeAudioData'].forEach(function (fn) { wrapFn(C.prototype, fn, cn + '.' + fn); });
  });

  // ══════════════════════════════════════════════════════════
  // 6. document / DOM
  // ══════════════════════════════════════════════════════════
  wrapFn(document, 'createElement', 'doc.createElement');
  wrapFn(document, 'createEvent', 'doc.createEvent');
  wrapFn(document, 'getElementsByTagName', 'doc.getElementsByTagName');
  wrapFn(document, 'querySelector', 'doc.querySelector');
  wrapFn(document, 'getElementById', 'doc.getElementById');
  wrapFn(document, 'hasFocus', 'doc.hasFocus');
  wrapGetter(Document.prototype, 'cookie', 'doc.cookie');
  wrapGetter(Document.prototype, 'readyState', 'doc.readyState');
  wrapGetter(Document.prototype, 'referrer', 'doc.referrer');
  wrapGetter(Document.prototype, 'characterSet', 'doc.characterSet');
  wrapGetter(Document.prototype, 'compatMode', 'doc.compatMode');
  wrapGetter(Document.prototype, 'hidden', 'doc.hidden');
  wrapGetter(Document.prototype, 'visibilityState', 'doc.visibilityState');

  // ══════════════════════════════════════════════════════════
  // 7. 布局（广告拦截检测就靠这几个）
  // ══════════════════════════════════════════════════════════
  ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent',
    'clientWidth', 'clientHeight', 'clientTop', 'clientLeft',
    'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft'].forEach(function (n) {
    wrapGetter(HTMLElement.prototype, n, 'el.' + n);
  });
  wrapFn(HTMLElement.prototype, 'getBoundingClientRect', 'el.getBoundingClientRect');
  wrapFn(HTMLElement.prototype, 'getClientRects', 'el.getClientRects');
  wrapFn(window, 'getComputedStyle', 'getComputedStyle');
  wrapFn(window, 'matchMedia', 'matchMedia');

  // ══════════════════════════════════════════════════════════
  // 8. 反射类（形状检测）
  // ══════════════════════════════════════════════════════════
  ['getOwnPropertyNames', 'getPrototypeOf', 'getOwnPropertyDescriptor', 'keys'].forEach(function (fn) {
    var og = Object[fn];
    if (typeof og !== 'function') return;
    Object[fn] = function (o) {
      var r = og.apply(Object, arguments);
      // 只记"对函数/关键对象"的调用，避免日志爆炸
      var lb = 'Object.' + fn;
      try {
        if (typeof o === 'function') rec(lb + '(<fn ' + (o.name || '?') + '>)',
          [], Array.isArray(r) ? r : r);
        else if (o && typeof o === 'object') {
          var tag = Object.prototype.toString.call(o);
          if (/Window|Navigator|Screen|Document|Canvas|Context|Element/.test(tag)) {
            rec(lb + '(<' + tag + '>)', [], Array.isArray(r) ? r.length + ' 项' : r);
          }
        }
      } catch (e) {}
      return r;
    };
  });

  // Function.prototype.toString（80+ 构造器泄漏的检测点）
  var ogFTS = Function.prototype.toString;
  Function.prototype.toString = function () {
    var r = ogFTS.call(this);
    try {
      rec('Fn.toString(<' + (this.name || '?') + '>)', [], r);
    } catch (e) {}
    return r;
  };

  // ══════════════════════════════════════════════════════════
  // 9. 时间与随机（用来定位 cr 的来源）
  // ══════════════════════════════════════════════════════════
  var ogRandom = Math.random;
  Math.random = function () {
    var r = ogRandom.call(Math);
    // 只记索引，不记值（值本身无意义，位置有意义）
    if (TR.length < MAX) TR.push('Math.random() => #' + (globalThis.__RNDN = (globalThis.__RNDN || 0) + 1)
      + ' v=' + (Math.round(r * 1e6) / 1e6));
    return r;
  };

  // ══════════════════════════════════════════════════════════
  // 10. 导出
  // ══════════════════════════════════════════════════════════
  globalThis.__dumpTrace = function () { return JSON.stringify(TR); };

  // ★ iv8 专用出口：iv8 的 page.load 会重置 window，挂在 window 上的数组会丢。
  //   但 __iv8__（宿主对象）不会被重置，所以额外挂一份到 __iv8__.data 上。
  //   这是唯一能在 iv8 里把轨迹带出来的方式（试过 window.__TRACE，取到的是空）。
  try {
    if (typeof __iv8__ !== 'undefined' && __iv8__ && __iv8__.data) {
      __iv8__.data.__trace = TR;
      globalThis.__iv8TraceReady = true;
    }
  } catch (e) {}
  globalThis.__setTraceFilter = function (on) { FILTER = !!on; };
})();

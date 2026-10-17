# -*- coding: utf-8 -*-
"""
dump_iv8_env.py —— 把 iv8 的完整浏览器环境值 dump 成 JSON

为什么这是关键一步：
  上一轮把探针挂在 Navigator.prototype 上，一条没记到，于是我误判成
  "iv8 的环境是 C++ 原生、JS 挂不上"。实测发现：
    实例上 defineProperty   → 生效
    原型上 defineProperty   → 不生效（C++ 层直接返回原值）
  canvas.toDataURL / measureText / Function.prototype.toString 全部可替换。

  也就是说 iv8 提供的是一套**已经很像真浏览器、且可以被 JS 微调**的环境。
  它的默认值（UA Chrome/124、navigator 结构、插件列表、WebGL 参数…）
  本身就比我手写补环境里的猜测值准。

  那最省事的路就是：把这套值 dump 下来，作为我补环境的 baseline 回放。
  这比自己一个个猜快一个数量级，而且值之间是自洽的（同一台机器出的）。

产物：iv8_env_dump.json
"""
import json
import iv8

DUMP = r"""
(function(){
  var out = {};
  function safe(f, dflt) { try { var v = f(); return v === undefined ? (dflt === undefined ? null : dflt) : v; } catch(e){ return null; } }

  // ── navigator 全量标量 ──
  var NAV = ['appCodeName','appName','appVersion','buildID','cookieEnabled','doNotTrack',
    'hardwareConcurrency','deviceMemory','language','maxTouchPoints','onLine','platform',
    'product','productSub','userAgent','vendor','vendorSub','webdriver','pdfViewerEnabled'];
  var nav = {};
  for (var i = 0; i < NAV.length; i++) nav[NAV[i]] = safe(function(){ return navigator[NAV[i]]; });
  nav.languages = safe(function(){ return Array.prototype.slice.call(navigator.languages); });
  // plugins / mimeTypes 的完整形状
  nav.plugins = safe(function(){
    var r = [];
    for (var i = 0; i < navigator.plugins.length; i++) {
      var p = navigator.plugins[i];
      r.push({ name: p.name, filename: p.filename, description: p.description,
               mimes: (function(){ var m=[]; for(var j=0;j<p.length;j++) m.push(p[j].type); return m; })() });
    }
    return r;
  });
  nav.mimeTypes = safe(function(){
    var r = [];
    for (var i = 0; i < navigator.mimeTypes.length; i++) {
      var m = navigator.mimeTypes[i];
      r.push({ type: m.type, suffixes: m.suffixes, description: m.description });
    }
    return r;
  });
  nav.userAgentData = safe(function(){
    var u = navigator.userAgentData;
    if (!u) return null;
    return { brands: JSON.parse(JSON.stringify(u.brands)), mobile: u.mobile, platform: u.platform };
  });
  out.navigator = nav;

  // ── screen ──
  out.screen = {};
  ['width','height','availWidth','availHeight','colorDepth','pixelDepth','availLeft','availTop'].forEach(function(k){
    out.screen[k] = safe(function(){ return screen[k]; });
  });
  out.screen.orientation = safe(function(){ return screen.orientation ? screen.orientation.type : null; });

  // ── window 尺寸 ──
  out.window = {};
  ['innerWidth','innerHeight','outerWidth','outerHeight','devicePixelRatio','screenX','screenY',
   'screenLeft','screenTop'].forEach(function(k){
    out.window[k] = safe(function(){ return window[k]; });
  });

  // ── 时区 / 语言 ──
  out.intl = {
    timeZone: safe(function(){ return Intl.DateTimeFormat().resolvedOptions().timeZone; }),
    locale: safe(function(){ return Intl.DateTimeFormat().resolvedOptions().locale; }),
    tzOffset: safe(function(){ return new Date().getTimezoneOffset(); }),
  };

  // ── WebGL ──
  out.webgl = safe(function(){
    var c = document.createElement('canvas'); c.width = 300; c.height = 150;
    var g = c.getContext('webgl');
    if (!g) return null;
    var r = {};
    var names = {
      7936:'vendor', 7937:'renderer', 7938:'version', 35724:'shading',
      37445:'unmaskedVendor', 37446:'unmaskedRenderer'
    };
    Object.keys(names).forEach(function(k){
      r[names[k]] = safe(function(){ return g.getParameter(Number(k)); });
    });
    r.supportedExtensions = safe(function(){ return g.getSupportedExtensions(); });
    // 常用参数全抓（数字类）
    var params = {};
    [34921,34922,3379,34076,34024,36347,36348,3386,35660,35661,34047,34045,35658].forEach(function(p){
      var v = safe(function(){ return g.getParameter(p); });
      if (v !== null) params[p] = v;
    });
    r.params = params;
    return r;
  });

  // ── canvas 指纹（几组固定图案的像素和）──
  out.canvas = safe(function(){
    function draw(fn){
      var c = document.createElement('canvas'); c.width = 220; c.height = 30;
      var x = c.getContext('2d');
      fn(x);
      return c.toDataURL();
    }
    var a = draw(function(x){
      x.textBaseline='top'; x.font='14px Arial'; x.fillStyle='#f60';
      x.fillRect(125,1,62,20); x.fillStyle='#069';
      x.fillText('Cwm fjordbank glyphs vext quiz, 😃', 2, 15);
    });
    var b = draw(function(x){
      x.font='23px Arial'; x.fillStyle='#f60'; x.fillRect(10,1,80,20);
      x.fillStyle='#069'; x.fillText('abz!', 2, 15);
    });
    function hash(s){ var h=0; for (var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return (h>>>0).toString(16); }
    return { lenA: a.length, hashA: hash(a), lenB: b.length, hashB: hash(b), prefixA: a.slice(0, 40) };
  });

  // ── 字体探测（与 reese84 同款算法：候选族 vs generic fallback）──
  out.fonts = safe(function(){
    var c = document.createElement('canvas'); c.width = 400; c.height = 50;
    var x = c.getContext('2d');
    var base = ['monospace','sans-serif','serif'];
    var test = 'mmmmmmmmmmlli';
    var cands = ['Arial','Arial Black','Arial Narrow','Calibri','Cambria','Candara','Comic Sans MS',
      'Consolas','Constantia','Corbel','Courier New','Ebrima','Franklin Gothic Medium','Gabriola',
      'Gadugi','Georgia','Impact','Ink Free','Javanese Text','Leelawadee UI','Lucida Console',
      'Lucida Sans Unicode','Malgun Gothic','Marlett','Microsoft Himalaya','Microsoft JhengHei',
      'Microsoft New Tai Lue','Microsoft PhagsPa','Microsoft Sans Serif','Microsoft Tai Le',
      'Microsoft YaHei','Microsoft Yi Baiti','MingLiU-ExtB','Mongolian Baiti','MS Gothic',
      'MV Boli','Myanmar Text','Nirmala UI','Palatino Linotype','Segoe Print','Segoe Script',
      'Segoe UI','Segoe UI Emoji','Segoe UI Historic','Segoe UI Symbol','SimSun','Sitka',
      'Sylfaen','Symbol','Tahoma','Times New Roman','Trebuchet MS','Verdana','Webdings',
      'Wingdings','Yu Gothic','Noto Sans SC','Noto Serif SC'];
    var baseW = {};
    for (var i=0;i<base.length;i++){ x.font = '72px ' + base[i]; baseW[base[i]] = x.measureText(test).width; }
    var installed = [];
    for (var j=0;j<cands.length;j++){
      var hit = false;
      for (var k=0;k<base.length;k++){
        x.font = '72px "' + cands[j] + '", ' + base[k];
        if (Math.abs(x.measureText(test).width - baseW[base[k]]) > 0.05) { hit = true; break; }
      }
      if (hit) installed.push(cands[j]);
    }
    return { installed: installed, count: installed.length, baseWidths: baseW };
  });

  // ── 函数形状（几个关键构造器）──
  out.shapes = safe(function(){
    var r = {};
    ['Window','Navigator','Document','HTMLCanvasElement','Element','EventTarget','XMLHttpRequest']
      .forEach(function(n){
        var C = window[n];
        r[n] = C ? {
          toString: String(Function.prototype.toString.call(C)).slice(0, 60),
          ownNames: Object.getOwnPropertyNames(C),
          protoNames: C.prototype ? Object.getOwnPropertyNames(C.prototype).slice(0, 30) : null,
        } : null;
      });
    r.__keysLen = Object.keys(window).length;
    r.__ownNamesLen = Object.getOwnPropertyNames(window).length;
    r.__navProtoDesc = (function(){
      var p = Object.getPrototypeOf(navigator);
      var d = p && Object.getOwnPropertyDescriptor(p, 'userAgent');
      return d ? Object.keys(d).join('/') : null;
    })();
    return r;
  });

  // ── 其他能力标志 ──
  out.features = safe(function(){
    var r = {};
    ['TouchEvent','Touch','TouchList','PointerEvent','MediaRecorder','SharedWorker','reportError',
     'AudioContext','OfflineAudioContext','webkitOfflineAudioContext','indexedDB','openDatabase',
     'WebGL2RenderingContext','Path2D','Notification','BroadcastChannel','structuredClone']
      .forEach(function(n){ r[n] = safe(function(){ return typeof window[n]; }); });
    r.canPlayType_mp4 = safe(function(){
      var v = document.createElement('video');
      return v.canPlayType('video/mp4; codecs="avc1.42E01E"');
    });
    r.canPlayType_webm = safe(function(){
      var v = document.createElement('video');
      return v.canPlayType('video/webm; codecs="vp8"');
    });
    r.hasFocus = safe(function(){ return document.hasFocus(); });
    return r;
  });

  return JSON.stringify(out);
})()
"""

with iv8.JSContext() as ctx:
    raw = ctx.eval(DUMP)
    d = json.loads(str(raw))

with open('iv8_env_dump.json', 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print('已导出 iv8_env_dump.json')
print('  navigator.userAgent =', d['navigator']['userAgent'][:80])
print('  navigator.hardwareConcurrency =', d['navigator']['hardwareConcurrency'])
print('  navigator.deviceMemory =', d['navigator']['deviceMemory'])
print('  screen =', d['screen'].get('width'), 'x', d['screen'].get('height'),
      'avail', d['screen'].get('availWidth'), 'x', d['screen'].get('availHeight'))
print('  window.innerWidth =', d['window']['innerWidth'], 'outer', d['window']['outerWidth'])
print('  plugins =', len(d['navigator']['plugins'] or []), '个 / mimeTypes',
      len(d['navigator']['mimeTypes'] or []), '个')
print('  webgl.renderer =', (d['webgl'] or {}).get('renderer'))
print('  webgl.unmaskedRenderer =', (d['webgl'] or {}).get('unmaskedRenderer'))
print('  fonts =', d['fonts']['count'], '个已装字体')
print('  keysLen =', d['shapes']['__keysLen'], 'ownNamesLen =', d['shapes']['__ownNamesLen'])

# -*- coding: utf-8 -*-
"""
probe_iv8_env.py —— 探测 iv8 的浏览器环境到底"可不可以被 JS 改"

为什么需要：
  上一轮我得出「iv8 的 window 是 C++ 原生，JS 包装挂不上」的结论。
  但有个矛盾：我加的 hooks（CSS 布局补丁、iframe load 伪造）在 iv8 里是生效的，
  说明 window 是可以被 JS 修改的。

  所以要么是我探针挂错了位置（挂 Navigator.prototype，而 iv8 的属性是实例自有），
  要么是生命周期问题（window 被 page.load 重置）。

  这个脚本直接测三件事：
    1) navigator 的属性在实例上还是原型上
    2) 两种位置的包装分别能不能生效
    3) canvas.toDataURL 能不能被替换
"""
import json
import iv8

PROBE = r"""
(function(){
  var out = {};
  function t(k, f){ try { out[k] = String(f()); } catch(e){ out[k] = 'ERR:' + (e && e.message); } }

  t('1_navigator_exists', function(){ return typeof navigator !== 'undefined'; });
  t('2_nav_own_names', function(){ return JSON.stringify(Object.getOwnPropertyNames(navigator).slice(0, 12)); });
  t('3_nav_proto_is_objproto', function(){ return Object.getPrototypeOf(navigator) === Object.prototype; });
  t('4_ua_desc_on_instance', function(){
    var d = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    return d ? Object.keys(d).join('/') : 'none';
  });
  t('5_ua_desc_on_proto', function(){
    var p = Object.getPrototypeOf(navigator);
    var d = p ? Object.getOwnPropertyDescriptor(p, 'userAgent') : null;
    return d ? Object.keys(d).join('/') : 'none';
  });
  t('6_patch_ua_on_instance', function(){
    var old = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: function(){ return 'P-INST'; } });
    var got = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: function(){ return old; } });
    return got;
  });
  t('7_patch_ua_on_proto', function(){
    var p = Object.getPrototypeOf(navigator);
    if (!p) return 'no proto';
    var old = Object.getOwnPropertyDescriptor(p, 'userAgent');
    Object.defineProperty(p, 'userAgent', { configurable: true, get: function(){ return 'P-PROTO'; } });
    var got = navigator.userAgent;
    if (old) Object.defineProperty(p, 'userAgent', old);
    return got;
  });
  t('8_canvas_proto', function(){
    return typeof HTMLCanvasElement === 'undefined' ? 'none'
      : (HTMLCanvasElement.prototype ? 'has' : 'no');
  });
  t('9_patch_toDataURL', function(){
    var P = HTMLCanvasElement.prototype;
    var old = P.toDataURL;
    P.toDataURL = function(){ return 'P-DATAURL'; };
    var c = document.createElement('canvas'); c.width = 10; c.height = 10;
    var got = c.toDataURL();
    P.toDataURL = old;
    return got === 'P-DATAURL' ? 'YES' : ('NO:' + String(got).slice(0, 16));
  });
  t('10_patch_measureText', function(){
    var P = CanvasRenderingContext2D.prototype;
    var old = P.measureText;
    P.measureText = function(){ return { width: 12345 }; };
    var c = document.createElement('canvas');
    var x = c.getContext('2d');
    var w = x.measureText('abc').width;
    P.measureText = old;
    return w;
  });
  t('11_screen_own_vs_proto', function(){
    var d = Object.getOwnPropertyDescriptor(screen, 'width');
    var p = Object.getPrototypeOf(screen);
    var dp = p ? Object.getOwnPropertyDescriptor(p, 'width') : null;
    return 'inst=' + (d ? Object.keys(d).join('/') : 'none') + ' proto=' + (dp ? Object.keys(dp).join('/') : 'none');
  });
  t('12_window_own_innerWidth', function(){
    var d = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    return d ? Object.keys(d).join('/') : 'none';
  });
  t('13_fn_proto_toString_patchable', function(){
    var old = Function.prototype.toString;
    Function.prototype.toString = function(){ return 'P-TOSTRING'; };
    var got = Function.prototype.toString.call(function(){});
    Function.prototype.toString = old;
    return got;
  });
  return JSON.stringify(out);
})()
"""

with iv8.JSContext() as ctx:
    raw = ctx.eval(PROBE)
    d = json.loads(str(raw))
    for k in sorted(d.keys(), key=lambda x: int(x.split('_')[0])):
        print('  %-32s %s' % (k, d[k][:100]))

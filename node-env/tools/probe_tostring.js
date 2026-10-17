/**
 * tools/probe_tostring.js —— 检测 Function.prototype.toString 相关的原生性
 *
 * 依据（scrapebadger 2026 实测报告）：
 *   "The 12 Function.prototype.toString calls matter most here.
 *    Two of them targeted **Window and eval**, which is what a native-code integrity check looks like."
 *
 * 也就是说 sensor 会显式检查：
 *   Window.toString()  → function Window() { [native code] }
 *   eval.toString()    → function eval() { [native code] }   （且长度通常是 33）
 *   以及一批我们补的函数是否还是 [native code]
 *
 * 我们用纯 JS 补环境，这些检查是最容易露馅的地方之一。这里逐项打表。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createBridge, UA } = require('../src/bridge');

const ENV_DIR = path.join(__dirname, '..', 'src', 'env');
const ENV_FILES = ['01-core.js', '02-media.js', '03-window.js', '04-net.js', '05-page.js'];

function buildEnvSource() {
  const parts = ENV_FILES.map((f) => '\n/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(ENV_DIR, f), 'utf8')).join('\n');
  return `
(function () {
'use strict';
const __HOST__ = globalThis.__bridge__;
try { delete globalThis.__bridge__; } catch (e) {}
const Buffer = __HOST__.Buffer;
const URL = __HOST__.URL;
const URLSearchParams = __HOST__.URLSearchParams;
const __CFG = __HOST__.cfg;
${parts}
__installWindow();
return { page: __pageApi, win: __window, getDoc: () => __document };
})()
`;
}

// 浏览器（Windows / Chrome）基准值
const EXPECT_BROWSER = {
  'Window.toString()': 'function Window() { [native code] }',
  'eval.toString()': 'function eval() { [native code] }',
  'eval.toString().length': 33,
  'Object.keys(window).length': '9000~12000（本机 Chrome 实测）',
  'window.constructor.toString()': 'function Window() { [native code] }',
  'navigator.constructor.toString()': 'function Navigator() { [native code] }',
};

const PROBE = `
(function () {
  const out = {};
  const T = Function.prototype.toString;
  const s = (fn) => { try { return T.call(fn); } catch (e) { return 'ERR:' + e.message; } };

  // ── 最基础的两项（scrapebadger 指出的重点）──
  out['Window.toString()'] = s(window.Window || window.constructor);
  out['eval.toString()'] = s(eval);
  out['eval.toString().length'] = s(eval).length;
  out['window.constructor.toString()'] = s(window.constructor);

  // ── 常见受限构造器 ──
  const ctors = ['Navigator','Document','Element','HTMLElement','EventTarget','XMLHttpRequest',
                 'HTMLCanvasElement','CanvasRenderingContext2D','WebGLRenderingContext',
                 'AudioContext','Performance','Screen','Location','History','Storage',
                 'MutationObserver','Image','Blob','URL','TextEncoder','Notification'];
  out._ctorBad = [];
  for (const n of ctors) {
    const v = window[n];
    if (typeof v !== 'function') { out._ctorBad.push(n + ':missing'); continue; }
    const str = s(v);
    if (!/\\[native code\\]/.test(str)) out._ctorBad.push(n + ':' + str.slice(0, 40));
  }

  // ── 方法级：补的 getter / 方法是否 native ──
  const methodChecks = [
    ['navigator.userAgent', null],
    ['screen.width', null],
    ['performance.now', performance.now],
    ['getComputedStyle', window.getComputedStyle],
    ['document.createElement', document.createElement],
    ['document.querySelector', document.querySelector],
    ['setTimeout', window.setTimeout],
    ['fetch', window.fetch],
    ['btoa', window.btoa],
    ['atob', window.atob],
    ['requestAnimationFrame', window.requestAnimationFrame],
    ['postMessage', window.postMessage],
  ];
  out._methodBad = [];
  for (const [name, fn] of methodChecks) {
    if (!fn) { out._methodBad.push(name + ':not-fn'); continue; }
    const str = s(fn);
    if (!/\\[native code\\]/.test(str)) out._methodBad.push(name + ':' + str.slice(0, 40));
  }

  // ── getter 的 toString（desc.get）──
  try {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    out['get userAgent'] = d && d.get ? s(d.get) : 'no-getter';
  } catch (e) { out['get userAgent'] = 'ERR'; }
  try {
    const d2 = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    out['get offsetWidth'] = d2 && d2.get ? s(d2.get) : 'no-getter';
  } catch (e) { out['get offsetWidth'] = 'ERR'; }

  // ── 全局对象规模与类型 ──
  out['Object.keys(window).length'] = Object.keys(window).length;
  out['typeof window'] = typeof window;
  out['window === globalThis'] = (window === globalThis);
  out['typeof document.all'] = typeof document.all;
  out['!!document.all'] = !!document.all;
  out['globalThis==window'] = (globalThis == window);

  // ── 常见自动化痕迹 ──
  out._trace = {
    webdriver: navigator.webdriver,
    phantom: typeof window._phantom,
    nightmare: typeof window.__nightmare,
    domAutomation: typeof window.domAutomation,
    selenium: typeof window._Selenium_IDE_Recorder,
    cdc: Object.keys(document).filter(k => /cdc_|\\$cdc/.test(k)).length,
    processLeak: typeof window.process,
    requireLeak: typeof window.require,
    moduleLeak: typeof window.module,
    bufferLeak: typeof window.Buffer,
    globalLeak: typeof window.global,
    setImmediateLeak: typeof window.setImmediate,
    nodeNavigator: (typeof process !== 'undefined') ? 'HOST-HAS-PROCESS' : 'clean',
  };
  return out;
})()
`;

(async () => {
  const cfg = {
    ua: UA, origin: 'https://book.airgreenland.com',
    entryUrl: 'https://book.airgreenland.com/api/', referrer: '', verbose: false,
  };
  const bridge = createBridge(cfg);
  const ctx = vm.createContext(Object.create(null), { name: 'probe-tostring' });
  Object.defineProperty(ctx, '__bridge__', {
    enumerable: true, configurable: true, writable: true,
    value: Object.assign({}, bridge, { cfg, URL, URLSearchParams }),
  });
  vm.runInContext(buildEnvSource(), ctx, { filename: 'env.js' });
  const out = vm.runInContext(PROBE, ctx, { filename: 'probe.js' });

  console.log('=== Function.prototype.toString 原生性 ===');
  for (const k of Object.keys(EXPECT_BROWSER)) {
    const got = out[k];
    const ok = String(got) === String(EXPECT_BROWSER[k]) ? '✅' : '⚠️';
    console.log('  ' + ok + ' ' + k.padEnd(34) + ' = ' + JSON.stringify(got));
    if (ok === '⚠️') console.log('     浏览器应为: ' + JSON.stringify(EXPECT_BROWSER[k]));
  }

  console.log('\n=== 构造器 toString 异常项 ===');
  console.log(out._ctorBad.length ? '  ❌ ' + out._ctorBad.join('\n  ❌ ') : '  ✅ 全部 native');

  console.log('\n=== 方法 toString 异常项 ===');
  console.log(out._methodBad.length ? '  ❌ ' + out._methodBad.join('\n  ❌ ') : '  ✅ 全部 native');

  console.log('\n=== 全局对象形态 ===');
  for (const k of ['Object.keys(window).length', 'typeof window', 'window === globalThis',
    'typeof document.all', '!!document.all', 'globalThis==window']) {
    console.log('  ' + k.padEnd(34) + ' = ' + JSON.stringify(out[k]));
  }

  console.log('\n=== 自动化/宿主机泄漏 ===');
  console.log('  ' + JSON.stringify(out._trace, null, 2).replace(/\n/g, '\n  '));

  fs.writeFileSync(path.join(__dirname, '..', '_tostring_probe.json'), JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });

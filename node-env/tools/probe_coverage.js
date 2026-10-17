/**
 * probe_coverage.js —— 环境覆盖度差集探针
 *
 * 为什么要有这个：
 *   之前一直在"猜哪个值不对"，猜了十几轮。真正该做的是把"哪些能力根本不存在"
 *   列出来做差集 —— 缺一个 API 比错一个值更致命，因为缺了之后 sensor 通常不报错，
 *   只是静默跳过整段采集。
 *
 * 探针清单来源：
 *   1) PZz0203/Incapsula 的 incapsula/reese84/schema.js —— 38 个 payload 字段名
 *   2) 52pojie《某航司 Reese84 补环境篇》(2025-09) 的 22 个采集函数清单
 *   3) 自己的踩坑记录
 *
 * 用法：
 *   node tools/probe_coverage.js            # 同时跑 Edge(CDP) 与补环境，输出差集
 *   node tools/probe_coverage.js --env-only # 只跑补环境（Edge 起不来时用）
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_DIR = path.join(ROOT, 'src', 'env');
const ENV_FILES = ['01-core.js', '02-media.js', '03-window.js', '04-net.js', '05-page.js'];

// ── 探针代码：在目标环境里 eval 一次，返回 { 名字: 值 } 的扁平对象 ──
const PROBE = String.raw`
(function () {
  var out = {};
  var put = function (k, v) { out[k] = v; };
  var T = function (k, f) {
    try { var v = f(); put(k, v === undefined ? 'undefined' : (v === null ? 'null' : String(v))); }
    catch (e) { put(k, 'THROW:' + (e && e.name)); }
  };

  // ── A. 38 个 schema 字段对应的能力 ──
  T('indexedDB', function () { return typeof indexedDB; });
  T('indexedDB.open', function () { return typeof indexedDB.open; });
  T('openDatabase', function () { return typeof openDatabase; });
  T('document.hasFocus', function () { return typeof document.hasFocus; });
  T('document.hasFocus()', function () { return String(document.hasFocus()); });
  T('navigator.cpuClass', function () { return String(navigator.cpuClass); });
  T('navigator.platform', function () { return navigator.platform; });
  T('navigator.doNotTrack', function () { return String(navigator.doNotTrack); });
  T('navigator.plugins', function () { return typeof navigator.plugins; });
  T('navigator.plugins.length', function () { return String(navigator.plugins.length); });
  T('navigator.plugins[0].name', function () { return navigator.plugins[0].name; });
  T('navigator.plugins.namedItem', function () { return typeof navigator.plugins.namedItem; });
  T('navigator.plugins.refresh', function () { return typeof navigator.plugins.refresh; });
  T('navigator.mimeTypes.length', function () { return String(navigator.mimeTypes.length); });
  T('navigator.mimeTypes[0].type', function () { return navigator.mimeTypes[0].type; });
  T('navigator.vendor', function () { return navigator.vendor; });
  T('navigator.product', function () { return navigator.product; });
  T('navigator.productSub', function () { return navigator.productSub; });
  T('navigator.buildID', function () { return String(navigator.buildID); });
  T('navigator.deviceMemory', function () { return String(navigator.deviceMemory); });
  T('navigator.hardwareConcurrency', function () { return String(navigator.hardwareConcurrency); });
  T('navigator.permissions', function () { return typeof navigator.permissions; });
  T('navigator.permissions.query', function () { return typeof (navigator.permissions || {}).query; });
  T('navigator.connection', function () { return typeof navigator.connection; });
  T('navigator.getBattery', function () { return typeof navigator.getBattery; });
  T('navigator.sendBeacon', function () { return typeof navigator.sendBeacon; });
  T('navigator.mediaDevices', function () { return typeof navigator.mediaDevices; });
  T('navigator.mediaCapabilities', function () { return typeof navigator.mediaCapabilities; });
  T('navigator.storage', function () { return typeof navigator.storage; });
  T('navigator.serviceWorker', function () { return typeof navigator.serviceWorker; });
  T('navigator.locks', function () { return typeof navigator.locks; });
  T('navigator.scheduling', function () { return typeof navigator.scheduling; });
  T('navigator.userActivation', function () { return typeof navigator.userActivation; });
  T('navigator.webdriver', function () { return String(navigator.webdriver); });
  T('navigator.pdfViewerEnabled', function () { return String(navigator.pdfViewerEnabled); });
  T('navigator.userAgentData', function () { return typeof navigator.userAgentData; });
  T('navigator.userAgentData.brands', function () {
    return JSON.stringify(navigator.userAgentData.brands);
  });
  T('navigator.userAgentData.getHighEntropyValues', function () {
    return typeof navigator.userAgentData.getHighEntropyValues;
  });
  T('screen.orientation', function () { return typeof screen.orientation; });
  T('screen.orientation.type', function () { return screen.orientation.type; });
  T('visualViewport', function () { return typeof visualViewport; });
  T('visualViewport.width', function () { return String(visualViewport && visualViewport.width); });

  // ── B. 事件系统（events.mouse / events.touch 两个字段） ──
  T('MouseEvent', function () { return typeof MouseEvent; });
  T('TouchEvent', function () { return typeof TouchEvent; });
  T('Touch', function () { return typeof Touch; });
  T('TouchList', function () { return typeof TouchList; });
  T('ontouchstart', function () { return 'ontouchstart' in window ? 'true' : 'false'; });
  T('navigator.maxTouchPoints', function () { return String(navigator.maxTouchPoints); });
  T('PointerEvent', function () { return typeof PointerEvent; });
  T('document.createEvent', function () { return typeof document.createEvent; });

  // ── C. 媒体/图形（canvas_hash / webgl / webgl_meta / video / audio） ──
  T('AudioContext', function () { return typeof AudioContext; });
  T('OfflineAudioContext', function () { return typeof OfflineAudioContext; });
  T('webkitOfflineAudioContext', function () { return typeof webkitOfflineAudioContext; });
  T('MediaRecorder', function () { return typeof MediaRecorder; });
  T('HTMLVideoElement.canPlayType', function () { return typeof HTMLVideoElement.prototype.canPlayType; });
  T('video/mp4; codecs avc1', function () {
    var v = document.createElement('video');
    return v.canPlayType('video/mp4; codecs="avc1.42E01E"');
  });
  T('video/webm; codecs vp8', function () {
    var v = document.createElement('video');
    return v.canPlayType('video/webm; codecs="vp8"');
  });
  T('video/ogg', function () {
    var v = document.createElement('video');
    return v.canPlayType('video/ogg; codecs="theora"');
  });
  T('window.Image', function () { return typeof Image; });
  T('HTMLCanvasElement.toBlob', function () { return typeof HTMLCanvasElement.prototype.toBlob; });
  T('Path2D', function () { return typeof Path2D; });
  T('WebGLRenderingContext', function () { return typeof WebGLRenderingContext; });
  T('WebGL2RenderingContext', function () { return typeof WebGL2RenderingContext; });
  T('WebGLRenderingContext.getParameter', function () {
    return typeof WebGLRenderingContext.prototype.getParameter;
  });
  T('WebGL2RenderingContext.getParameter', function () {
    return typeof WebGL2RenderingContext.prototype.getParameter;
  });
  T('WebGLRenderingContext.readPixels', function () {
    return typeof WebGLRenderingContext.prototype.readPixels;
  });
  T('WebGLRenderingContext.getSupportedExtensions', function () {
    return typeof WebGLRenderingContext.prototype.getSupportedExtensions;
  });
  T('gl.getSupportedExtensions()', function () {
    var c = document.createElement('canvas');
    var g = c.getContext('webgl');
    if (!g) return 'null';
    return JSON.stringify(g.getSupportedExtensions());
  });
  T('gl2.getExtension(OES_texture_float)', function () {
    var c = document.createElement('canvas');
    var g = c.getContext('webgl2');
    if (!g) return 'null';
    return String(!!g.getExtension('EXT_color_buffer_float'));
  });

  // ── D. 存储/杂项 ──
  T('localStorage', function () { return typeof localStorage; });
  T('sessionStorage', function () { return typeof sessionStorage; });
  T('localStorage.length', function () { return String(localStorage.length); });
  T('crypto.getRandomValues', function () { return typeof crypto.getRandomValues; });
  T('crypto.subtle', function () { return typeof crypto.subtle; });
  T('BroadcastChannel', function () { return typeof BroadcastChannel; });
  T('MessageChannel', function () { return typeof MessageChannel; });
  T('Worker', function () { return typeof Worker; });
  T('SharedWorker', function () { return typeof SharedWorker; });
  T('Notification', function () { return typeof Notification; });
  T('requestIdleCallback', function () { return typeof requestIdleCallback; });
  T('queueMicrotask', function () { return typeof queueMicrotask; });
  T('Promise', function () { return typeof Promise; });
  T('Symbol', function () { return typeof Symbol; });
  T('WeakMap', function () { return typeof WeakMap; });
  T('reportError', function () { return typeof reportError; });
  T('structuredClone', function () { return typeof structuredClone; });
  T('matchMedia', function () { return typeof matchMedia; });
  T('matchMedia(prefers-color-scheme:dark)', function () {
    return String(matchMedia('(prefers-color-scheme: dark)').matches);
  });
  T('matchMedia(prefers-reduced-motion)', function () {
    return String(matchMedia('(prefers-reduced-motion: reduce)').matches);
  });
  T('innerWidth', function () { return String(innerWidth); });
  T('devicePixelRatio', function () { return String(devicePixelRatio); });
  T('screen.width/height', function () { return screen.width + 'x' + screen.height; });
  T('screen.availWidth/availHeight', function () { return screen.availWidth + 'x' + screen.availHeight; });
  T('Intl.DateTimeFormat().resolvedOptions().timeZone', function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  });
  T('new Date().getTimezoneOffset()', function () { return String(new Date().getTimezoneOffset()); });
  T('Math.random 精度', function () {
    var s = {}; for (var i = 0; i < 500; i++) s[Math.random()] = 1;
    return String(Object.keys(s).length);
  });

  // ── E. 函数形状（toString / 自有属性） ──
  T('Window.toString', function () { return Function.prototype.toString.call(window.Window); });
  T('window.constructor.toString', function () { return Function.prototype.toString.call(window.constructor); });
  T('navigator.constructor.toString', function () { return Function.prototype.toString.call(navigator.constructor); });
  T('eval.toString', function () { return Function.prototype.toString.call(eval); });
  T('getComputedStyle.toString', function () { return Function.prototype.toString.call(getComputedStyle); });
  T('setTimeout.toString', function () { return Function.prototype.toString.call(setTimeout); });
  T('JSON.stringify.toString', function () { return Function.prototype.toString.call(JSON.stringify); });
  T('getOwnPropertyNames(函数)', function () {
    return JSON.stringify(Object.getOwnPropertyNames(function () {}));
  });
  T('getOwnPropertyNames(Window)', function () {
    return JSON.stringify(Object.getOwnPropertyNames(window.Window).sort());
  });
  T('Object.keys(window).length', function () { return String(Object.keys(window).length); });
  T('getOwnPropertyNames(window).length', function () {
    return String(Object.getOwnPropertyNames(window).length);
  });
  T('Object.prototype.toString.call(window)', function () {
    return Object.prototype.toString.call(window);
  });
  T('Object.prototype.toString.call(navigator)', function () {
    return Object.prototype.toString.call(navigator);
  });
  T('document.constructor', function () { return document.constructor.name; });
  T('HTMLCanvasElement.toString', function () {
    return Function.prototype.toString.call(HTMLCanvasElement);
  });
  T('document.createElement.toString', function () {
    return Function.prototype.toString.call(document.createElement);
  });

  return out;
})()
`;

// ══════════════════════════════════════════════════════════════════
// 1. 在我们的补环境里跑
// ══════════════════════════════════════════════════════════════════
function runInEnv() {
  const bridge = require(path.join(ROOT, 'src', 'bridge.js')).createBridge({
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    origin: 'https://book.airgreenland.com',
    entryUrl: 'https://book.airgreenland.com/api/',
    verbose: false,
  });
  const ctx = vm.createContext(Object.create(null), { name: 'probe-env' });
  ctx.__bridge__ = Object.assign({}, bridge, { URL, URLSearchParams });
  // 必须按 runner 的方式包一层：env 文件里用到 __HOST__ / __CFG 这些外层绑定，
  // 直接拼起来跑会 ReferenceError（踩过一次）。
  const parts = ENV_FILES.map((f) => fs.readFileSync(path.join(ENV_DIR, f), 'utf8')).join('\n');
  const src = `
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
})()

`;
  vm.runInContext(src, ctx, { filename: 'env-bootstrap.js' });
  return vm.runInContext(PROBE, ctx, { filename: 'probe.js', timeout: 60000 });
}

// ══════════════════════════════════════════════════════════════════
// 2. 在真实 Edge 里跑（CDP）
// ══════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runInEdge() {
  const WebSocket = require('ws');
  const bin = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!fs.existsSync(bin)) throw new Error('找不到 Edge');
  const port = 9481;
  const prof = path.join(os.tmpdir(), 'cov' + Date.now());
  const ch = spawn(bin, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--enable-gpu', '--use-angle=d3d11',
    '--window-size=1366,768',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + port, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); break; }
    catch (e) { await sleep(250); }
  }
  if (!ver) throw new Error('Edge 没起来');
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  });
  const send = (method, params) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    return new Promise((res, rej) => pending.set(i, { res, rej }));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  // ★ 必须导航到 https 源站再探测。
  //   about:blank 是 opaque origin，localStorage 会抛 SecurityError、
  //   navigator.userAgentData 也不存在 —— 这些是测量假象，不是我们的缺口。
  //   第一版没做这步，31 项差异里有 6 项是这么来的。
  await send('Page.navigate', { url: 'https://book.airgreenland.com/api/' });
  await sleep(3500);
  const r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(' + PROBE + ')', returnByValue: true, timeout: 60000,
  });
  try { ch.kill(); } catch (e) {}
  try { ws.close(); } catch (e) {}
  if (r.exceptionDetails) throw new Error('探针在 Edge 里抛错: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return JSON.parse(r.result.value);
}

// ══════════════════════════════════════════════════════════════════
(async () => {
  const envOnly = process.argv.includes('--env-only');
  console.log('采集补环境…');
  const mine = runInEnv();
  console.log('  项数 =', Object.keys(mine).length);

  let real = null;
  if (!envOnly) {
    console.log('采集真实 Edge…');
    try { real = await runInEdge(); console.log('  项数 =', Object.keys(real).length); }
    catch (e) { console.log('  !! Edge 采集失败:', e.message); }
  }

  if (!real) {
    for (const [k, v] of Object.entries(mine)) console.log('  ', k.padEnd(46), String(v).slice(0, 80));
    return;
  }

  const rows = [];
  const keys = Array.from(new Set([...Object.keys(real), ...Object.keys(mine)]));
  for (const k of keys) {
    const a = real[k] === undefined ? 'undefined' : String(real[k]);
    const b = mine[k] === undefined ? 'undefined' : String(mine[k]);
    rows.push({ 项: k, 浏览器: a, 补环境: b, 一致: a === b });
  }
  const bad = rows.filter((r) => !r.一致);
  const missing = bad.filter((r) => r.补环境 === 'undefined' || r.补环境.startsWith('THROW'));

  console.log('\n══════ 总计 %s 项，不一致 %s 项（其中缺失/抛错 %s 项）══════',
    rows.length, bad.length, missing.length);

  console.log('\n── 缺失或抛错（最致命：会让 sensor 静默跳过整段采集）──');
  for (const r of missing) console.log('  ✗ %s\n      浏览器: %s\n      我们  : %s',
    r.项.padEnd(44), String(r.浏览器).slice(0, 90), String(r.补环境).slice(0, 90));

  console.log('\n── 值不一致 ──');
  for (const r of bad.filter((x) => !missing.includes(x))) {
    console.log('  ~ %s\n      浏览器: %s\n      我们  : %s',
      r.项.padEnd(44), String(r.浏览器).slice(0, 90), String(r.补环境).slice(0, 90));
  }

  fs.writeFileSync(path.join(ROOT, '_coverage.json'),
    JSON.stringify({ rows, badCount: bad.length, missingCount: missing.length }, null, 2), 'utf8');
  console.log('\n明细已写入 _coverage.json');
})();

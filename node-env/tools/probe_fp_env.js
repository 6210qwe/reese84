/**
 * tools/probe_fp_env.js —— 在补环境里跑同一段指纹代码，与 baseline.json 逐项对比
 *
 * 用途：补环境的"值对不对"不能靠感觉。这里把真实浏览器采样值（baseline.json）
 *       和补环境算出来的值并排打出来，一眼看出哪一项是自相矛盾的。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createBridge, UA } = require('../src/bridge');

const ENV_DIR = path.join(__dirname, '..', 'src', 'env');
const ENV_FILES = ['01-core.js', '02-media.js', '03-window.js', '04-net.js', '05-page.js'];

const BASE = JSON.parse(fs.readFileSync(path.join(ENV_DIR, 'baseline.json'), 'utf8'));

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

const PROBE = `
(function(){
  const n = navigator;
  const out = {};
  out.navigator = {
    userAgent: n.userAgent, platform: n.platform, vendor: n.vendor,
    languages: n.languages.slice(), hardwareConcurrency: n.hardwareConcurrency,
    deviceMemory: n.deviceMemory, maxTouchPoints: n.maxTouchPoints,
    plugins: Array.from(n.plugins).map(p => p.name), webdriver: n.webdriver,
  };
  out.screen = { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth };
  out.window = { innerWidth: innerWidth, innerHeight: innerHeight, outerWidth: outerWidth, outerHeight: outerHeight, devicePixelRatio: devicePixelRatio };

  // 与 sampler 里完全相同的绘制
  function drawCanvas() {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 150;
    const ctx = c.getContext('2d');
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 100, 60);
    ctx.fillStyle = 'rgb(120, 40, 200)';
    ctx.fillRect(50, 30, 100, 60);
    ctx.font = '14px Arial';
    ctx.fillStyle = '#069';
    ctx.fillText('reese84 \\u6d4b\\u8bd5 Cwm fjordbank glyphs vext quiz', 20, 90);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#c00';
    ctx.fillText('\\u4e2d\\u6587\\u6d4b\\u8bd5', 20, 120);
    const g = ctx.createLinearGradient(0, 0, 300, 0);
    g.addColorStop(0, 'rgba(255,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,255,0.3)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(250, 40, 25, 0, Math.PI * 2, true);
    ctx.fill();
    return c;
  }
  const cv = drawCanvas();
  const dataURL = cv.toDataURL();
  const px = cv.getContext('2d').getImageData(0, 0, 300, 150).data;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < px.length; i += 4) { sum = (sum + px[i]*3 + px[i+1]*5 + px[i+2]*7) % 1000000007; sum2 = (sum2 + px[i]*11 + px[i+3]) % 1000000007; }
  let h = 0x811c9dc5;
  for (let i = 0; i < dataURL.length; i++) { h ^= dataURL.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  out.canvas = { dataURLLen: dataURL.length, dataURLHash: h.toString(16), pixelSum: sum, pixelSum2: sum2, head40: dataURL.slice(0, 60) };

  const mctx = document.createElement('canvas').getContext('2d');
  const samples = {};
  const strs = ['mmmmmmmmmmlli', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
  for (const f of ['10px sans-serif','14px Arial','16px "Times New Roman"','12px monospace','bold 14px serif']) {
    mctx.font = f;
    samples[f] = strs.map(s => mctx.measureText(s).width);
  }
  out.measureText = samples;

  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.webgl = { unexposed: true, unmaskedVendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), unmaskedRenderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL), version: gl.getParameter(7938), extCount: gl.getSupportedExtensions().length };
  } catch (e) { out.webgl = { error: String(e && e.message) }; }

  // 字体检测
  const testFonts = ['Arial','Arial Black','Calibri','Cambria','Consolas','Courier New','Georgia','Impact','Microsoft YaHei','SimSun','Tahoma','Times New Roman','Verdana','Segoe UI','Malgun Gothic','MS Gothic'];
  const fctx = document.createElement('canvas').getContext('2d');
  fctx.font = '72px monospace';
  const baseW = fctx.measureText('mmmmmmmmmmlli').width;
  out.fonts = testFonts.filter(f => { fctx.font = '72px "' + f + '", monospace'; return fctx.measureText('mmmmmmmmmmlli').width !== baseW; });

  out.perfNow = (function(){ const s = new Set(); for (let i=0;i<500;i++) s.add(performance.now()); return { unique: s.size }; })();
  return out;
})()
`;

(async () => {
  const cfg = { ua: UA, origin: 'https://book.airgreenland.com', entryUrl: 'https://book.airgreenland.com/api/', referrer: '', verbose: false, windowProto: false };
  const bridge = createBridge(cfg);
  const ctx = vm.createContext(Object.create(null), { name: 'probe' });
  Object.defineProperty(ctx, '__bridge__', { enumerable: true, configurable: true, writable: true, value: Object.assign({}, bridge, { cfg, URL, URLSearchParams }) });
  vm.runInContext(buildEnvSource(), ctx, { filename: 'env.js' });
  const mine = vm.runInContext(PROBE, ctx, { filename: 'probe.js' });

  const rows = [];
  const J = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));
  const cmp = (label, a, b) => rows.push({ 项: label, 真实浏览器: J(a), 补环境: J(b), 一致: J(a) === J(b) ? '✅' : '❌' });

  cmp('navigator.userAgent', BASE.navigator.userAgent, mine.navigator.userAgent);
  cmp('navigator.platform', BASE.navigator.platform, mine.navigator.platform);
  cmp('navigator.vendor', BASE.navigator.vendor, mine.navigator.vendor);
  cmp('navigator.languages', BASE.navigator.languages, mine.navigator.languages);
  cmp('hardwareConcurrency', BASE.navigator.hardwareConcurrency, mine.navigator.hardwareConcurrency);
  cmp('deviceMemory', BASE.navigator.deviceMemory, mine.navigator.deviceMemory);
  cmp('maxTouchPoints', BASE.navigator.maxTouchPoints, mine.navigator.maxTouchPoints);
  cmp('plugins', BASE.navigator.plugins, mine.navigator.plugins);
  cmp('screen', BASE.screen, mine.screen);
  cmp('window', BASE.window, mine.window);
  cmp('canvas.dataURLLen', BASE.canvas.dataURLLen, mine.canvas.dataURLLen);
  cmp('canvas.dataURLHash', BASE.canvas.dataURLHash, mine.canvas.dataURLHash);
  cmp('canvas.pixelSum', BASE.canvas.pixelSum, mine.canvas.pixelSum);
  cmp('measureText', BASE.measureText, mine.measureText);
  cmp('webgl.unmaskedRenderer', BASE.webgl && BASE.webgl.unmaskedRenderer, mine.webgl && mine.webgl.unmaskedRenderer);
  cmp('webgl.extCount', BASE.webgl && BASE.webgl.extensions && BASE.webgl.extensions.length, mine.webgl && mine.webgl.extCount);
  cmp('fonts', BASE.fonts, mine.fonts);
  cmp('perf.now 唯一值数(500次)', BASE.perf && BASE.perf.nowPrecision && BASE.perf.nowPrecision.unique, mine.perfNow.unique);

  const w = [22, 52, 52, 4];
  const pad = (s, n) => { s = String(s); let len = 0; for (const ch of s) len += ch.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - len)); };
  console.log(pad('项', w[0]) + pad('真实浏览器', w[1]) + pad('补环境', w[2]) + '一致');
  console.log('-'.repeat(130));
  let bad = 0;
  for (const r of rows) {
    if (r.一致 === '❌') bad++;
    console.log(pad(r.项, w[0]) + pad(r.真实浏览器.length > 50 ? r.真实浏览器.slice(0, 48) + '…' : r.真实浏览器, w[1]) + pad(r.补环境.length > 50 ? r.补环境.slice(0, 48) + '…' : r.补环境, w[2]) + r.一致);
  }
  console.log('-'.repeat(130));
  console.log('不一致项: ' + bad + ' / ' + rows.length);
  fs.writeFileSync(path.join(__dirname, '..', '_fp_compare.json'), JSON.stringify({ rows, mine, base: BASE }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });

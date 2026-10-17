/**
 * tools/sample_fp.js —— 用 CDP 从真实 Edge 采样环境指纹，存成 baseline.json
 *
 * 为什么需要：
 *   手写补环境最难的不是"把 API 补齐"，而是"值要真"。
 *   reese84 会上传约 20 类指纹，服务端有跨字段一致性校验：
 *     UA 说 Windows 但 WebGL 说 Apple / screen 与 innerWidth 矛盾 / 字体列表为空 …
 *   这些值不是猜得出来的，只能从真实浏览器采一次，然后回放。
 *
 *   web-js-env-patcher 硬规则 14：AI 猜值、随机值、mock、jsdom 不能作为最终回放值。
 *   这就是该规则的落地工具。
 *
 * 用法：
 *   node tools/sample_fp.js                # 采样并写入 src/env/baseline.json
 *   node tools/sample_fp.js --out x.json
 *   node tools/sample_fp.js --port 9333    # 连已有调试端口（不自己启动浏览器）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, '..', 'src', 'env', 'baseline.json');
})();
const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i > -1 ? Number(process.argv[i + 1]) : 9412;
})();

const BROWSERS = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

// 采样的 UA 必须和补环境里 navigator.userAgent / HTTP 头一致
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const p of BROWSERS) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  throw new Error('找不到 Chrome/Edge，可用 BROWSER_BIN 指定');
}

async function httpJson(url) {
  const res = await fetch(url);
  return res.json();
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    this.id = 0;
    this.pending = new Map();
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// 在页面里跑的采样脚本（返回一个可 JSON 化的对象）
const SAMPLE_SRC = `(async function () {
  const out = {};
  const n = navigator;

  out.navigator = {
    userAgent: n.userAgent,
    appVersion: n.appVersion,
    appName: n.appName,
    appCodeName: n.appCodeName,
    platform: n.platform,
    vendor: n.vendor,
    vendorSub: n.vendorSub,
    product: n.product,
    productSub: n.productSub,
    language: n.language,
    languages: n.languages.slice(),
    hardwareConcurrency: n.hardwareConcurrency,
    deviceMemory: n.deviceMemory,
    maxTouchPoints: n.maxTouchPoints,
    webdriver: n.webdriver,
    cookieEnabled: n.cookieEnabled,
    onLine: n.onLine,
    doNotTrack: n.doNotTrack,
    pdfViewerEnabled: n.pdfViewerEnabled,
    plugins: Array.from(n.plugins).map(p => p.name),
    mimeTypes: Array.from(n.mimeTypes).map(m => m.type),
  };
  try {
    const ua = n.userAgentData;
    out.userAgentData = {
      brands: ua.brands.map(b => ({ brand: b.brand, version: b.version })),
      mobile: ua.mobile,
      platform: ua.platform,
    };
    out.userAgentDataHigh = await ua.getHighEntropyValues([
      'architecture','bitness','formFactors','fullVersionList','model','platformVersion','uaFullVersion','wow64'
    ]);
  } catch (e) { out.userAgentData = null; }

  out.screen = {
    width: screen.width, height: screen.height,
    availWidth: screen.availWidth, availHeight: screen.availHeight,
    availLeft: screen.availLeft, availTop: screen.availTop,
    colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
    orientationType: screen.orientation && screen.orientation.type,
    orientationAngle: screen.orientation && screen.orientation.angle,
    isExtended: screen.isExtended,
  };
  out.window = {
    innerWidth: innerWidth, innerHeight: innerHeight,
    outerWidth: outerWidth, outerHeight: outerHeight,
    devicePixelRatio: devicePixelRatio,
    screenX: screenX, screenY: screenY,
    screenLeft: screenLeft, screenTop: screenTop,
  };
  out.locale = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezoneOffset: new Date().getTimezoneOffset(),
    languages: n.languages.slice(),
  };

  // ---- canvas 2d 指纹 ----
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
    ctx.fillText('reese84 \u6d4b\u8bd5 Cwm fjordbank glyphs vext quiz', 20, 90);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#c00';
    ctx.fillText('\u4e2d\u6587\u6d4b\u8bd5', 20, 120);
    // 圆弧 + 渐变，覆盖更多渲染分支
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
  const ctx2 = cv.getContext('2d');
  const px = ctx2.getImageData(0, 0, 300, 150).data;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < px.length; i += 4) { sum = (sum + px[i] * 3 + px[i+1] * 5 + px[i+2] * 7) % 1000000007; sum2 = (sum2 + px[i] * 11 + px[i+3]) % 1000000007; }
  out.canvas = {
    dataURLLen: dataURL.length,
    dataURLHash: (function(){ let h=0x811c9dc5; for(let i=0;i<dataURL.length;i++){ h^=dataURL.charCodeAt(i); h=(h*0x01000193)>>>0; } return h.toString(16); })(),
    pixelSum: sum, pixelSum2: sum2,
    lastByte: px[px.length-1],
    head40: dataURL.slice(0, 60),
  };

  // ---- measureText 宽度采样（字体度量一致性） ----
  const mctx = document.createElement('canvas').getContext('2d');
  const samples = {};
  const strs = ['mmmmmmmmmmlli', 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
  const fonts = ['10px sans-serif','14px Arial','16px "Times New Roman"','12px monospace','bold 14px serif'];
  for (const f of fonts) {
    mctx.font = f;
    samples[f] = strs.map(s => mctx.measureText(s).width);
  }
  out.measureText = samples;

  // ---- WebGL ----
  try {
    const gc = document.createElement('canvas');
    const gl = gc.getContext('webgl') || gc.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const params = {};
      const keys = [7936,7937,7938,35724,3379,34921,34930,35660,35661,36347,36348,36349,34076,34024,34047];
      for (const k of keys) { try { params[k] = gl.getParameter(k); } catch (e) { params[k] = null; } }
      out.webgl = {
        vendor: gl.getParameter(7936),
        renderer: gl.getParameter(7937),
        version: gl.getParameter(7938),
        shading: gl.getParameter(35724),
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        params,
        extensions: gl.getSupportedExtensions(),
        maxAniso: (function(){ const e = gl.getExtension('EXT_texture_filter_anisotropic'); return e ? gl.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null; })(),
        precision: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT),
      };
    }
  } catch (e) { out.webgl = null; }

  // ---- WebGL2 ----
  try {
    const g2 = document.createElement('canvas').getContext('webgl2');
    out.webgl2 = g2 ? { version: g2.getParameter(7938), renderer: g2.getParameter(7937) } : null;
  } catch (e) { out.webgl2 = null; }

  // ---- Audio 指纹（与 reese84 同款：离线振荡器 + 压缩器） ----
  out.audio = await new Promise((resolve) => {
    try {
      const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!AC) return resolve(null);
      const ctx = new AC(1, 5000, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
      comp.attack.value = 0; comp.release.value = 0.25;
      osc.connect(comp); comp.connect(ctx.destination);
      osc.start(0);
      ctx.oncomplete = (e) => {
        let sum = 0;
        const d = e.renderedBuffer.getChannelData(0);
        for (let i = 4500; i < 5000; i++) sum += Math.abs(d[i]);
        resolve({ sampleRate: ctx.sampleRate, sum: Math.round(sum * 1e6) / 1e6, tail: Array.from(d.slice(4990, 5000)) });
      };
      ctx.startRendering();
    } catch (e) { resolve(null); }
  });

  // ---- 字体可用性 ----
  const testFonts = ['Arial','Arial Black','Calibri','Cambria','Candara','Comic Sans MS','Consolas','Constantia','Corbel','Courier New','Ebrima','Franklin Gothic Medium','Gabriola','Gadugi','Georgia','Impact','Ink Free','Javanese Text','Leelawadee UI','Lucida Console','Malgun Gothic','Microsoft Himalaya','Microsoft JhengHei','Microsoft New Tai Lue','Microsoft PhagsPa','Microsoft Sans Serif','Microsoft Tai Le','Microsoft YaHei','Microsoft Yi Baiti','MingLiU-ExtB','Mongolian Baiti','MS Gothic','MV Boli','Myanmar Text','Nirmala UI','Palatino Linotype','Segoe MDL2 Assets','Segoe Print','Segoe Script','Segoe UI','Segoe UI Emoji','Segoe UI Historic','Segoe UI Symbol','SimSun','Sitka','Sylfaen','Symbol','Tahoma','Times New Roman','Trebuchet MS','Verdana','Webdings','Wingdings','Yu Gothic'];
  const fctx = document.createElement('canvas').getContext('2d');
  const base = '72px monospace';
  fctx.font = base;
  const baseW = fctx.measureText('mmmmmmmmmmlli').width;
  out.fonts = testFonts.filter(f => {
    fctx.font = '72px "' + f + '", monospace';
    return fctx.measureText('mmmmmmmmmmlli').width !== baseW;
  });

  out.features = {
    cookieEnabled: n.cookieEnabled,
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    hasChrome: typeof window.chrome,
    chromeKeys: window.chrome ? Object.keys(window.chrome) : null,
    notificationPerm: (function(){ try { return Notification.permission; } catch(e){ return null; } })(),
    hasRTCPeerConnection: typeof window.RTCPeerConnection,
    hasWebGL2: typeof window.WebGL2RenderingContext,
    hasOffscreenCanvas: typeof window.OffscreenCanvas,
    hasWorker: typeof window.Worker,
    hasSharedArrayBuffer: typeof window.SharedArrayBuffer,
    hasIndexedDB: typeof window.indexedDB,
    hasCookieStore: typeof window.cookieStore,
    hasScheduler: typeof window.scheduler,
    doNotTrack: n.doNotTrack,
    connectionType: n.connection && n.connection.effectiveType,
    connectionRtt: n.connection && n.connection.rtt,
  };

  // performance 基线
  out.perf = {
    nowPrecision: (function(){
      const vals = new Set();
      const t0 = performance.now();
      for (let i = 0; i < 2000; i++) vals.add(performance.now());
      return { unique: vals.size, span: performance.now() - t0 };
    })(),
    timeOrigin: performance.timeOrigin,
    timingKeys: Object.keys(performance.timing || {}).length,
    hasNavigation: !!(performance.getEntriesByType),
  };

  out.sampledAt = new Date().toISOString();
  return out;
})()`;

(async () => {
  let child = null;
  const givenPort = process.argv.includes('--port');
  if (!givenPort) {
    const bin = findBrowser();
    const prof = path.join(require('os').tmpdir(), 'fp-sample-' + Date.now());
    console.log('启动浏览器: ' + bin);
    child = spawn(bin, [
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      // 不要 --disable-gpu：那会让 WebGL 报 "Microsoft Basic Render Driver"，
      // 与本机真实显卡（AMD Radeon）矛盾，属于最典型的自相矛盾指纹。
      '--enable-gpu', '--use-angle=d3d11',
      '--disable-blink-features=AutomationControlled',
      '--user-data-dir=' + prof,
      '--remote-debugging-port=' + PORT,
      '--window-size=1366,768',
      'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 40; i++) {
      try { await httpJson('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(250); }
    }
  }

  const targets = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    console.log('没有 page target，新建一个');
    await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
    const t2 = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
    page = t2.find((t) => t.type === 'page');
  }
  console.log('target: ' + page.url);

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // 对齐 UA / 平台 / 视口，保证采样与补环境声明一致
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: UA,
    platform: 'Win32',
    acceptLanguage: 'en-US,en',
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: '141' },
        { brand: 'Not?A_Brand', version: '24' },
        { brand: 'Google Chrome', version: '141' },
      ],
      fullVersion: '141.0.7390.108',
      fullVersionList: [
        { brand: 'Chromium', version: '141.0.7390.108' },
        { brand: 'Not?A_Brand', version: '24.0.0.0' },
        { brand: 'Google Chrome', version: '141.0.7390.108' },
      ],
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1340, height: 757, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1366, screenHeight: 768,
  });

  const r = await cdp.send('Runtime.evaluate', {
    expression: SAMPLE_SRC,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  if (r.exceptionDetails) {
    console.error('采样脚本异常:', JSON.stringify(r.exceptionDetails, null, 2).slice(0, 1500));
    cdp.close(); if (child) child.kill(); process.exit(1);
  }

  const data = r.result.value;
  data._meta = { ua: UA, sampledFrom: page.url, browser: (await httpJson('http://127.0.0.1:' + PORT + '/json/version')).Browser };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');
  console.log('已写入 ' + OUT);
  console.log('  canvas.dataURLLen   = ' + data.canvas.dataURLLen);
  console.log('  canvas.dataURLHash  = ' + data.canvas.dataURLHash);
  console.log('  canvas.pixelSum     = ' + data.canvas.pixelSum);
  console.log('  webgl.unmasked      = ' + (data.webgl && data.webgl.unmaskedRenderer));
  console.log('  audio.sum           = ' + (data.audio && data.audio.sum));
  console.log('  fonts               = ' + (data.fonts || []).length);
  console.log('  screen              = ' + JSON.stringify(data.screen));
  console.log('  window              = ' + JSON.stringify(data.window));

  cdp.close();
  if (child) child.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });

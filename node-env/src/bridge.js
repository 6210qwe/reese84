/**
 * bridge.js —— 宿主侧桥接层
 *
 * 职责：把 Node 的能力（curl 网络、Skia canvas、真实时钟、cookie 罐、随机数）
 *       以受控方式暴露给 vm 内的补环境。补环境通过 __HOST__ 调用这些能力，
 *       但 __HOST__ 在环境装配完成后立刻从全局删除，sensor 看不到。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');

// 环境基线：真实浏览器采样值（tools/sample_fp.js 生成），补环境按它回放
let BASELINE = null;
try {
  BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'env', 'baseline.json'), 'utf8'));
} catch (e) { BASELINE = null; }

const UA = (BASELINE && BASELINE.navigator && BASELINE.navigator.userAgent)
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CURL = process.env.CURL_BIN || 'curl.exe';

// ──────────────────────────────────────────────────────────────────
// Cookie 罐
// ──────────────────────────────────────────────────────────────────
class CookieJar {
  constructor() { this.map = new Map(); }
  setCookieHeader(setCookieLines, host) {
    for (const line of [].concat(setCookieLines || [])) {
      const parts = String(line).split(';');
      const first = parts.shift() || '';
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      const attrs = {};
      for (const p of parts) {
        const i = p.indexOf('=');
        if (i < 0) attrs[p.trim().toLowerCase()] = true;
        else attrs[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
      }
      const domain = (attrs.domain || host || '').replace(/^\./, '').toLowerCase();
      const entry = {
        name, value, domain,
        httpOnly: !!attrs.httponly,
        secure: !!attrs.secure,
        path: attrs.path || '/',
        expires: attrs['max-age'] ? Date.now() + Number(attrs['max-age']) * 1000 : null,
      };
      if (value === '' || (entry.expires && entry.expires < Date.now())) {
        this.map.delete(name);
      } else {
        this.map.set(name, entry);
      }
    }
  }
  // document.cookie 只能看到非 HttpOnly
  jsCookie(host) {
    const out = [];
    for (const e of this.map.values()) {
      if (e.httpOnly) continue;
      out.push(e.name + '=' + e.value);
    }
    return out.join('; ');
  }
  setFromJs(str, host) {
    this.setCookieHeader([String(str) + '; Domain=' + (host || '') + '; Path=/'], host);
  }
  header() {
    return Array.from(this.map.values()).map((e) => e.name + '=' + e.value).join('; ');
  }
  toObject() {
    const o = {};
    for (const [k, v] of this.map) o[k] = v.value;
    return o;
  }
}

// ──────────────────────────────────────────────────────────────────
// curl 单次请求
// ──────────────────────────────────────────────────────────────────
let __tmpDir = null;
function tmpDir() {
  if (!__tmpDir) {
    __tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reese84-'));
  }
  return __tmpDir;
}
let __seq = 0;

function curlRequest(opts, jar, cb) {
  const id = ++__seq;
  const hdrFile = path.join(tmpDir(), 'h' + id + '.txt');
  const bodyFile = path.join(tmpDir(), 'b' + id + '.txt');
  const outFile = path.join(tmpDir(), 'o' + id + '.bin');

  const headers = opts.headers || {};
  // ★ 绝对不要无脑加 --compressed：它会带出 Accept-Encoding，而本站按"请求意图"分流，
  //   带上 Accept-Encoding / Accept-Language 就被当成正常导航直接 404 放行，拿不到挑战页。
  //   实测：UA + Accept 通配 → 200 挑战页；再加任一个就被 404 放行。
  const args = ['-sS', '-D', hdrFile, '-o', outFile,
    '--connect-timeout', '15', '--max-time', String(Math.ceil((opts.timeout || 40000) / 1000))];
  if (opts.compress) args.splice(1, 0, '--compressed');

  if (opts.method && opts.method !== 'GET') args.push('-X', opts.method);

  // 防压缩头冲突：--compressed 会自己加 Accept-Encoding
  for (const [k, v] of Object.entries(headers)) {
    if (/^(accept-encoding|host|content-length)$/i.test(k)) continue;
    args.push('-H', k + ': ' + v);
  }
  if (!Object.keys(headers).some((k) => /^user-agent$/i.test(k))) {
    args.push('-H', 'User-Agent: ' + UA);
  }

  const cookieHeader = jar.header();
  if (cookieHeader && !Object.keys(headers).some((k) => /^cookie$/i.test(k))) {
    args.push('-b', cookieHeader);
  }

  if (opts.body !== null && opts.body !== undefined) {
    const buf = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body), 'utf8');
    fs.writeFileSync(bodyFile, buf);
    args.push('--data-binary', '@' + bodyFile);
    if (!Object.keys(headers).some((k) => /^content-type$/i.test(k))) {
      // reese84 提交用 text/plain 规避 CORS 预检
      args.push('-H', 'Content-Type: text/plain; charset=utf-8');
    }
  }

  args.push(opts.url);

  execFile(CURL, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    const cleanup = () => {
      for (const f of [hdrFile, bodyFile, outFile]) { try { fs.unlinkSync(f); } catch (e) {} }
    };
    if (err) { cleanup(); cb(err); return; }

    let headText = '';
    try { headText = fs.readFileSync(hdrFile, 'latin1'); } catch (e) {}
    let bodyBuf = Buffer.alloc(0);
    try { bodyBuf = fs.readFileSync(outFile); } catch (e) {}

    // 解析响应头（可能有多段：100 Continue / 3xx 链）
    const blocks = headText.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
    const last = blocks.length ? blocks[blocks.length - 1] : '';
    const lines = last.split(/\r?\n/).filter(Boolean);
    const statusLine = lines.shift() || '';
    const sm = /^HTTP\/[\d.]+\s+(\d+)\s*(.*)$/.exec(statusLine);
    const status = sm ? parseInt(sm[1], 10) : 0;
    const statusText = sm ? sm[2] : '';
    const respHeaders = {};
    const setCookies = [];
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i < 0) continue;
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim();
      if (/^set-cookie$/i.test(k)) setCookies.push(v);
      respHeaders[k] = respHeaders[k] ? respHeaders[k] + ', ' + v : v;
    }
    let host = '';
    try { host = new URL(opts.url).hostname; } catch (e) {}
    if (setCookies.length) jar.setCookieHeader(setCookies, host);

    // 记录所有 Set-Cookie 供诊断
    cleanup();
    cb(null, {
      status, statusText, headers: respHeaders,
      text: bodyBuf.toString('utf8'),
      buffer: bodyBuf,
      url: opts.url,
      setCookies,
    });
  });
}

// ──────────────────────────────────────────────────────────────────
// 创建 bridge
// ──────────────────────────────────────────────────────────────────
function createBridge(cfg) {
  const jar = new CookieJar();
  const timeOrigin = Date.now();
  const t0 = process.hrtime.bigint();
  const t0ms = Number(t0) / 1e6;
  const state = {
    requests: [],       // 所有经过 bridge 的真实请求（诊断用）
    postBodies: [],     // 抓到的 POST body
    postResponses: [],  // POST 的响应（token 在这里）
    osc: [],
    errors: [],
    seed: (Date.now() % 1000000),
    counters: {},       // 能力调用计数：判断哪些采集路径被执行
  };
  const bump = (k) => { state.counters[k] = (state.counters[k] || 0) + 1; };
  const notes = new Set();
  const note = (k) => { if (notes.size < 5000) notes.add(k); };
  const timerLog = [];
  const timerRec = (kind, id, delay) => {
    if (timerLog.length < 2000) timerLog.push({ kind, id, delay, at: Date.now() - timeOrigin });
  };
  const perfLog = [];
  const perf = (kind, name, dur) => {
    if (perfLog.length < 4000) perfLog.push({ kind, name, dur: Math.round(dur * 1000) / 1000 });
  };
  const canvases = new Map();
  let cvSeq = 0;
  let nowCalls = 0;
  const nowSpinUs = Number(cfg.nowSpinUs) || 0;
  // 两个时间源独立缩放：实测 payload 的 phase1 与 total 用的是不同时间源，
  // 必须分开控制才能各自对上真机量级（iv8: phase1=46 / total=6570）。
  const perfScale = Number(cfg.perfScale || cfg.clockScale) || 1;
  const dateScale = Number(cfg.dateScale || cfg.clockScale) || 1;
  const nowTrace = [];
  let nowFirst = null;
  let nowLast = null;

  const bridge = {
    cfg,
    Buffer,

    // ---- 时钟 ----
    timeOrigin,
    baseline: BASELINE,
    // ★ 必须量化到 0.1ms。
    //   Chrome 的 performance.now() 受精度限制，500 次连续调用只有约 4 个不同值；
    //   我们如果直接返回 hrtime 的纳秒级浮点，500 次会得到 500 个不同值 ——
    //   这是任何脚本都能一眼测出来的"非浏览器"特征。
    //
    // ★★ 绝不依赖 this。
    //   sensor 的写法是 `new TimerFactory(performance.now)`，很可能是解构后无绑定调用。
    //   实现里一旦用 this.xxx，this 丢失就抛错 → sensor 吞掉异常退回 Date 计时分支
    //   → performance.now 调用次数为 0 → payload 里 performance.total 变成几百μs。
    //   实测基准（能通过的 iv8）：now() 被调用 8008 次、跨度 6534ms、total=6570。
    now() {
      // 可选自旋：真实浏览器的 performance.now() 要走 Blink 的 binding 层，
      // 单次成本远高于纯 JS 的 hrtime 调用。sensor 会把这个耗时当指纹上报。
      if (nowSpinUs > 0) {
        const end = process.hrtime.bigint() + BigInt(nowSpinUs * 1000);
        while (process.hrtime.bigint() < end) { /* spin */ }
      }
      const t = Number(process.hrtime.bigint()) / 1e6 - t0ms;
      nowCalls++;
      if (nowFirst === null) nowFirst = t;
      nowLast = t;
      if (nowTrace.length < 400) nowTrace.push(Math.round(t * 1000));
      // ★ 虚拟时钟：读数按 clockScale 放大。
      //   实测证明 payload 的 performance.total ≈ (now_last - now_first) 的毫秒数值：
      //     iv8（通过）：跨度 6534.136ms → total 6570
      //     我们（被拒）：跨度 470~621ms  → total 492~661
      //   差 12 倍来自"纯 JS 的 DOM 属性访问比 Blink 的 binding 层快一个数量级"，
      //   这是物理差异，靠补齐 API 抹不平。crawlex：服务端只认一个 band，且不公布。
      //   做法：让脚本读到"真实经过了那么久"（放大后的时间），实际墙钟不变
      //   —— 这就是 CSDN 那篇讲的"内建虚拟时钟，亚秒跑完数秒交互但不露时序破绽"。
      //   注意：不能靠 spin 拉长，因为首尾同步后移，跨度不变（已实测无效）。
      return Math.round(t * perfScale * 10) / 10;
    },
    // 供 vm 内部做时钟缩放用：拿真实毫秒（未缩放）
    nowRaw() {
      return Number(process.hrtime.bigint()) / 1e6 - t0ms;
    },

    // ---- 定时器 ----
    setTimeout(fn, ms) { return setTimeout(fn, ms); },
    clearTimeout(h) { clearTimeout(h); },
    setInterval(fn, ms) { return setInterval(fn, ms); },
    clearInterval(h) { clearInterval(h); },

    // ---- 日志 ----
    log(fmt, ...args) {
      if (!cfg.verbose) return;
      let i = 0;
      const s = String(fmt).replace(/%[sj]/g, (m) => {
        const v = args[i++];
        if (m === '%j') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
        return String(v);
      });
      console.log('  [env] ' + s);
    },

    // 精确自旋（微秒）。用于让补环境的操作成本贴近真实浏览器，
    // 因为 reese84 会把"采集耗时"当指纹上传（performance.total）。
    busy(us) {
      const end = process.hrtime.bigint() + BigInt(Math.max(0, Math.round(us * 1000)));
      while (process.hrtime.bigint() < end) { /* spin */ }
    },

    // ---- 随机 / 摘要 ----
    randomBytes(n) { return crypto.randomBytes(n); },
    uuid() { return crypto.randomUUID(); },
    digest(name, u8) {
      const alg = String(name || 'SHA-256').replace('-', '').toLowerCase();
      return crypto.createHash(alg).update(Buffer.from(u8)).digest();
    },

    // ---- canvas ----
    canvasCreate(w, h) {
      bump('canvas.create');
      const cv = createCanvas(Math.max(1, w || 300), Math.max(1, h || 150));
      const ctx = cv.getContext('2d');
      const b = { id: ++cvSeq, cv, ctx, w: w || 300, h: h || 150 };
      canvases.set(b.id, b);
      return b;
    },
    canvasResize(b, w, h) {
      b.w = w; b.h = h;
      b.cv.width = Math.max(1, w);
      b.cv.height = Math.max(1, h);
    },
    canvasToDataURL(b, type, quality) {
      bump('canvas.toDataURL');
      const t = String(type || 'image/png');
      if (t === 'image/jpeg' || t === 'image/webp') {
        const q = quality === undefined ? 0.92 : Number(quality);
        const buf = b.cv.toBuffer('image/jpeg', q);
        return 'data:image/jpeg;base64,' + buf.toString('base64');
      }
      const buf = b.cv.toBuffer('image/png');
      return 'data:image/png;base64,' + buf.toString('base64');
    },
    noteOscillator(type, freq, detune) {
      bump('audio.osc');
      state.osc.push({ type, freq, detune });
    },

    // ---- cookie ----
    cookieGet() {
      let host = '';
      try { host = new URL(cfg.entryUrl).hostname; } catch (e) {}
      return jar.jsCookie(host);
    },
    cookieSet(str) {
      let host = '';
      try { host = new URL(cfg.entryUrl).hostname; } catch (e) {}
      jar.setFromJs(str, host);
    },
    jarObject() { return jar.toObject(); },
    jarHeader() { return jar.header(); },

    // ---- 网络（真实 curl，保住 TLS 指纹）----
    httpRequest(opts, cb) {
      if (!cb) {
        // 同步形态不支持，退化为 Promise 由调用方处理
        return new Promise((res, rej) => curlRequest(opts, jar, (e, r) => (e ? rej(e) : res(r))));
      }
      state.requests.push({ method: opts.method, url: opts.url, at: Date.now() });
      if (opts.body && String(opts.body).length > 200) {
        state.postBodies.push({ url: opts.url, method: opts.method, body: String(opts.body), headers: opts.headers });
      }
      curlRequest(opts, jar, (err, res) => {
        if (err) { state.errors.push({ url: opts.url, error: String(err && err.message) }); cb(err); return; }
        state.requests[state.requests.length - 1].status = res.status;
        state.requests[state.requests.length - 1].len = (res.text || '').length;
        if (opts.body === null || opts.body === undefined) bump('req.get');
        else {
          bump('req.post');
          state.postResponses.push({ status: res.status, body: res.text, headers: res.headers });
        }
        cb(null, res);
      });
    },

    // 同步取脚本（sensor 必须是同步执行，浏览器里 script 也是阻塞解析的）
    fetchTextSync(url) {
      const id = ++__seq;
      const outFile = path.join(tmpDir(), 'sync' + id + '.bin');
      const hdrFile = path.join(tmpDir(), 'synch' + id + '.txt');
      const args = ['-sS', '-D', hdrFile, '-o', outFile,
        '--connect-timeout', '15', '--max-time', '180',
        '-H', 'User-Agent: ' + UA, '-H', 'Accept: */*'];
      const ch = jar.header();
      if (ch) args.push('-b', ch);
      args.push(url);
      try {
        require('child_process').execFileSync(CURL, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      } catch (e) {
        state.errors.push({ url, error: 'sync fetch failed: ' + (e && e.message) });
        return null;
      }
      let head = '';
      try { head = fs.readFileSync(hdrFile, 'latin1'); } catch (e) {}
      const blocks = head.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
      const last = blocks.length ? blocks[blocks.length - 1] : '';
      const setCookies = last.split(/\r?\n/).filter((l) => /^set-cookie:/i.test(l)).map((l) => l.slice(l.indexOf(':') + 1).trim());
      let host = '';
      try { host = new URL(url).hostname; } catch (e) {}
      if (setCookies.length) jar.setCookieHeader(setCookies, host);
      let buf = null;
      try { buf = fs.readFileSync(outFile); } catch (e) { return null; }
      try { fs.unlinkSync(outFile); fs.unlinkSync(hdrFile); } catch (e) {}
      return buf.toString('utf8');
    },

    sendBeacon(url, data) {
      curlRequest({ method: 'POST', url, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: String(data) }, jar, () => {});
      return true;
    },

    // ---- 诊断 ----
    _nowStats: () => ({ calls: nowCalls, span: nowFirst === null ? 0 : (nowLast - nowFirst) * 1000 }),
    _nowTrace: () => nowTrace.slice(),
    _state: state,
    _jar: jar,
    _bump: bump,
    _note: note,
    _notes: () => Array.from(notes),
    _perf: perf,
    _timerRec: timerRec,
    _timerLog: () => timerLog,
    _perfLog: () => perfLog,
  };

  return bridge;
}

module.exports = { createBridge, CookieJar, UA };

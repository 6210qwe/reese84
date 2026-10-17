/**
 * runner.js —— 一次完整求解流程
 *
 *   ① GET 挑战页（裸头：UA + Accept 通配）→ 拿到 4 段内联脚本 + sensor 路径
 *   ② GET sensor（校验完整性，残包会让 VM 静默不初始化）
 *   ③ 在 vm 里装配补环境 → 把挑战页交给 page load
 *   ④ sensor 执行 → 采集 → fetch POST → 服务端返回 token
 *   ⑤ 拿 token + 全量 cookie（含 HttpOnly，必须从 cookie 罐回收）
 *
 * 用法：
 *   node src/runner.js                 # 求解一次并打印
 *   node src/runner.js --json out.json # 结果落盘
 *   node src/runner.js -v              # 详细日志（含 env 内部日志）
 *   node src/runner.js --challenge-only# 只看挑战页/sensor，不跑 JS
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createBridge, UA } = require('./bridge');

const ENV_DIR = path.join(__dirname, 'env');
const ENV_FILES = ['01-core.js', '02-media.js', '03-window.js', '04-net.js', '05-page.js'];

const HOST = 'book.airgreenland.com';
const ENTRY = 'https://book.airgreenland.com/api/';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const VERBOSE = flag('-v') || flag('--verbose');

function log(...a) { console.log(...a); }
function vlog(...a) { if (VERBOSE) console.log(...a); }

function buildEnvSource() {
  const parts = ENV_FILES.map((f) => {
    const p = path.join(ENV_DIR, f);
    return '\n/* ============ ' + f + ' ============ */\n' + fs.readFileSync(p, 'utf8');
  }).join('\n');

  return `
(function () {
'use strict';
const __HOST__ = globalThis.__bridge__;
try { delete globalThis.__bridge__; } catch (e) {}
if (!__HOST__) throw new Error('bridge 丢失');
const Buffer = __HOST__.Buffer;
const URL = __HOST__.URL;
const URLSearchParams = __HOST__.URLSearchParams;
const __CFG = __HOST__.cfg;
${parts}
__installWindow();
return { page: __pageApi, load: __pageLoad, win: __window, getDoc: () => __document };
})()
`;
}

function promisify(fn) {
  return new Promise((res, rej) => fn((e, r) => (e ? rej(e) : res(r))));
}

// ──────────────────────────────────────────────────────────────────
// 完整性判据：残包 = VM 静默不初始化，是所有坑里最难查的一个
// ──────────────────────────────────────────────────────────────────
function sensorLooksComplete(code) {
  if (!code) return false;
  if (code.length < 700000) return false;
  const tail = code.replace(/\s+$/, '');
  return tail.endsWith('return a1_0xdc94();}') || tail.endsWith('})();') || /[;)}]\s*$/.test(tail);
}

const BLOCK_MARKS = [
  'Pardon Our Interruption', '_Incapsula_Resource', 'Request unsuccessful',
  'Incapsula incident ID', 'main-iframe',
];
function blockMarks(t) { return BLOCK_MARKS.filter((m) => String(t || '').includes(m)); }

(async () => {
  const t0 = Date.now();
  const cfg = {
    ua: UA,
    origin: 'https://' + HOST,
    entryUrl: ENTRY,
    referrer: '',
    verbose: VERBOSE,
    traceStack: flag('--trace-stack'),
    traceCtx: flag('--trace-ctx'),
    traceTiming: flag('--trace-timing'),
    navOffsetMs: Number(opt('--nav-offset', '0')) || 0,
    windowProto: flag('--window-proto'),
    measureCostUs: Number(opt('--measure-cost', '0')) || 0,
    nowSpinUs: Number(opt('--now-spin', '0')) || 0,
    clockScale: Number(opt('--clock-scale', '1')) || 1,
  };

  const bridge = createBridge(cfg);
  const jar = bridge._jar;

  // ① 挑战页（裸头！补全 Accept-Language / Accept-Encoding 反而 404 放行）
  const ch = await promisify((cb) => bridge.httpRequest({
    method: 'GET', url: ENTRY, headers: { Accept: '*/*', 'User-Agent': UA }, body: null,
  }, cb));

  log('[1] 挑战页 HTTP=%s len=%s marks=%s', ch.status, ch.text.length, blockMarks(ch.text).join(',') || 'none');
  if (ch.status !== 200) { log('!! 挑战页状态异常'); process.exit(2); }

  const m = /scriptElement\.src\s*=\s*"([^"]+)"/.exec(ch.text) || /src\s*=\s*"([^"]+\.js[^"]*)"/.exec(ch.text);
  if (!m) { log('!! 挑战页里找不到 sensor 路径（可能没被挑战，或页面结构变了）'); process.exit(2); }
  const sensorUrl = new URL(m[1], ENTRY).href;
  log('[2] sensor = %s', sensorUrl);

  let sensorCode = null;
  // sensor 内容对同一 build 恒定（不同 ?s= 的 sha256 一致），按路径缓存可省 30~70s
  const cacheFile = path.join(__dirname, '..', '_sensor_cache.json');
  const sensorPath = sensorUrl.split('?')[0];
  if (!flag('--challenge-only') && !flag('--fresh')) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c.path === sensorPath && c.code && sensorLooksComplete(c.code)) {
        sensorCode = c.code;
        log('[3] sensor 命中缓存 len=%s（--fresh 可强制重下）', sensorCode.length);
      }
    } catch (e) {}
  }
  if (!flag('--challenge-only') && !sensorCode) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const r = await promisify((cb) => bridge.httpRequest({
        method: 'GET', url: sensorUrl, headers: { Accept: '*/*', 'User-Agent': UA }, body: null, timeout: 120000,
      }, cb));
      if (r.status === 200 && sensorLooksComplete(r.text)) {
        sensorCode = r.text;
        log('[3] sensor 完整 len=%s (第 %s 次)', sensorCode.length, attempt);
        try { fs.writeFileSync(cacheFile, JSON.stringify({ path: sensorPath, at: new Date().toISOString(), code: sensorCode })); } catch (e) {}
        break;
      }
      log('[3] sensor 残包 len=%s status=%s，重试 %s/4', r.text ? r.text.length : 0, r.status, attempt);
    }
    if (!sensorCode) { log('!! sensor 始终拿不到完整包'); process.exit(3); }
  } else if (flag('--challenge-only')) {
    log('(--challenge-only) 结束');
    return;
  }

  // ② 建 vm 域，装配补环境
  const ctx = vm.createContext(Object.create(null), {
    name: 'reese84-env',
    codeGeneration: { strings: true, wasm: true },
  });
  ctx.__bridge__ = Object.assign({}, bridge, {
    // 同步脚本加载走 bridge 内部，这里只需函数引用
    fetchTextSync: bridge.fetchTextSync,
    cfg, URL, URLSearchParams,
  });
  // 让 delete globalThis.__bridge__ 生效
  Object.defineProperty(ctx, '__bridge__', { enumerable: true, configurable: true, writable: true, value: ctx.__bridge__ });

  const src = buildEnvSource();
  let env;
  try {
    env = vm.runInContext(src, ctx, { filename: 'env-bootstrap.js' });
  } catch (e) {
    log('!! 补环境装配失败: %s', e && e.stack);
    process.exit(4);
  }
  log('[4] 补环境装配完成 (%sms)', Date.now() - t0);

  // ③ 载入挑战页，执行脚本（sensor 在这里被 append 并同步 eval）
  const prePostCount = bridge._state.postBodies.length;
  try {
    env.load(ch.text, ENTRY);
  } catch (e) {
    log('!! 页面执行异常: %s', e && e.stack);
  }
  log('[5] 页面执行结束 (%sms) 请求数=%s', Date.now() - t0, bridge._state.requests.length);

  // ④ 等 sensor 的 POST 落地
  const deadline = Date.now() + 120000;
  let posted = null;
  while (Date.now() < deadline) {
    if (bridge._state.postBodies.length > prePostCount) {
      posted = bridge._state.postBodies[bridge._state.postBodies.length - 1];
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // ★ 拿到 body 不代表结束：还要等服务端返回 token（sensor 会用它写 document.cookie）。
  //   只等 body 就退出，会得到"payload 正常但 cookie=null"的假结果。
  if (posted) {
    const before = (bridge._state.postResponses || []).length;
    const rdl = Date.now() + 60000;
    while (Date.now() < rdl) {
      if ((bridge._state.postResponses || []).length > before) break;
      if (jar.toObject()['reese84']) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // 给 sensor 一点时间把 token 写进 cookie
    const cdl = Date.now() + 5000;
    while (Date.now() < cdl && !jar.toObject()['reese84']) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const out = {
    ok: false,
    elapsedMs: Date.now() - t0,
    cookie: null,
    renewInSec: null,
    cookieDomain: null,
    payloadLen: 0,
    bodyLen: 0,
    performance: null,
    requests: bridge._state.requests.map((r) => ({ method: r.method, url: r.url.slice(0, 120), status: r.status, len: r.len })),
    errors: bridge._state.errors,
  };

  if (!posted) {
    log('!! sensor 没有发出 POST（%sms）', Date.now() - t0);
    log('   请求记录: %j', out.requests);
    log('   错误: %j', bridge._state.errors);
    // 诊断 reese84 状态
    try { log('   reese84 状态: %j', env.page.inspectReese84()); } catch (e) {}
    fs.writeFileSync(path.join(__dirname, '..', '_diag_fail.json'), JSON.stringify(out, null, 2));
    process.exit(5);
  }

  out.bodyLen = posted.body.length;
  log('[5.5] 捕获 POST %s %s body=%s', posted.method, posted.url, posted.body.length);
  log('      headers=%j', posted.headers);
  log('      body 头部: %s', posted.body.slice(0, 260));
  try {
    const j = JSON.parse(posted.body);
    if (!j.solution || !j.solution.interrogation) {
      log('!! body 结构异常（不是 interrogation 载荷）: %j', Object.keys(j));
    }
    out.payloadLen = (j.solution && j.solution.interrogation && j.solution.interrogation.p || '').length;
    out.performance = j.performance;
    const it = (j.solution && j.solution.interrogation) || {};
    out.interrogation = {
      st: it.st, sr: it.sr, cr: it.cr, og: it.og,
      version: j.solution && j.solution.version,
    };
    fs.writeFileSync(path.join(__dirname, '..', '_post_body.json'), posted.body);
  } catch (e) { log('!! POST body 不是合法 JSON: %s', e.message); }

  // ⑤ token 优先取自服务端响应（sensor 可能还没来得及写 cookie）
  const jarObj = jar.toObject();
  out.cookie = jarObj['reese84'] || null;
  out.cookieNames = Object.keys(jarObj);
  out.jarHeader = jar.header();
  out.jarDetail = jar.map ? null : undefined;
  const pr = (bridge._state.postResponses || []);
  for (let i = pr.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(pr[i].body);
      if (j && j.token) {
        out.serverToken = j.token;
        out.renewInSec = j.renewInSec;
        out.cookieDomain = j.cookieDomain;
        if (!out.cookie) out.cookie = j.token;
        break;
      } else if (j && j.renewInSec) {
        out.renewInSec = j.renewInSec;
        out.cookieDomain = j.cookieDomain;
      }
    } catch (e) {}
  }

  // 服务端响应里也有 token（更可靠）
  const respReq = bridge._state.requests.filter((r) => r.method === 'POST' && r.status === 200);
  log('[6] POST 完成，payload=%s body=%s cookie=%s', out.payloadLen, out.bodyLen,
    out.cookie ? out.cookie.slice(0, 24) + '…(' + out.cookie.length + ')' : 'null');
  log('    performance=%j', out.performance);
  log('    cookies=%j', out.cookieNames);

  out.ok = !!out.cookie;
  const jsonOut = opt('--json', null);
  if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(out, null, 2), 'utf8');

  // ⑥ 业务验证：带着 token 访问保护域，确认真的解锁（"拿到 token" ≠ "通过"）
  if (out.cookie && !flag('--no-verify')) {
    // 模拟浏览器的 location.reload(true)：稍等再以导航意图请求
    await new Promise((r) => setTimeout(r, 2000));
    const v = await promisify((cb) => bridge.httpRequest({
      method: 'GET', url: 'https://' + HOST + '/',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': UA,
        'Upgrade-Insecure-Requests': '1',
      },
      body: null,
    }, cb)).catch(() => null);
    if (v) {
      const marks = blockMarks(v.text);
      const isChallenge = v.text.length > 500 && /scriptElement\.src|reeseSkipExpirationCheck/.test(v.text);
      out.verify = {
        status: v.status, len: v.text.length,
        blocked: marks.length > 0 || isChallenge,
        marks, isChallenge,
      };
      log('[7] 业务验证 GET / → HTTP=%s len=%s 被拦=%s marks=%s',
        v.status, v.text.length, out.verify.blocked, marks.join(',') || 'none');
    }
  }

  const nst = bridge._nowStats();
  log('    performance.now 调用 %s 次，跨度 %s μs（iv8 基准：8008 次 / 6534ms / total=6570）',
    nst.calls, Math.round(nst.span));
  const tr = bridge._nowTrace();
  if (tr.length) {
    const gaps = [];
    for (let i = 1; i < tr.length; i++) gaps.push({ i, gap: tr[i] - tr[i - 1] });
    gaps.sort((a, b) => b.gap - a.gap);
    log('    now 时间点(μs)：前12 %j', tr.slice(0, 12));
    log('    最大间隔 Top8：%j', gaps.slice(0, 8).map(g => g.gap + '@' + g.i));
    log('    总跨度 %s μs / %s 次', tr[tr.length - 1] - tr[0], tr.length);
  }
  try { log('    Date 统计: %j', env.page.dateStats()); } catch (e) {}
  const pl = bridge._perfLog();
  if (pl.length) {
    log('    --- User Timing 轨迹 (%s 条) ---', pl.length);
    for (const e of pl.slice(0, 120)) log('      %s %s = %s', e.kind, e.name, e.dur);
  }
  log('    能力调用: %j', bridge._state.counters);
  if (bridge._notes().length) log('    ctx 操作轨迹: %j', bridge._notes());
  log('    POST 响应: %j', (bridge._state.postResponses || []).map(function (x) {
    return { status: x.status, len: (x.body || '').length, head: String(x.body || '').slice(0, 200) };
  }));

  if (out.cookie) {
    log('\n=== TOKEN ===');
    log(out.cookie);
  }
  process.exit(out.ok ? 0 : 6);
})().catch((e) => {
  console.error('FATAL', e && e.stack);
  process.exit(1);
});

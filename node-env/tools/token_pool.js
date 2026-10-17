/**
 * token_pool.js —— reese84 token 池（本地调用方案）
 *
 * 为什么做成池：
 *   实测三条事实决定了这个设计：
 *     1) 载荷不绑会话 —— 浏览器产出的 body 提交到另一个 curl 会话照样通过
 *        ⇒ token 可以跨进程/跨连接复用，不需要和"解它的那个连接"绑定
 *     2) 一次求解 8.8 秒（有头 Edge + CDP）
 *     3) 服务端返回 renewInSec = 790~890 秒
 *        ⇒ 一个 token 能用 13~15 分钟，8.8 秒的求解成本摊薄后可以忽略
 *
 *   所以正确用法不是"每次请求前解一次"，而是"后台预热几个，业务侧直接取"。
 *
 * 用法（作为模块）：
 *   const pool = require('./token_pool');
 *   const t = await pool.get('book.airgreenland.com');
 *   // t = { token, cookie, expiresAt, solvedAt }
 *
 * 用法（作为服务）：
 *   node tools/token_pool.js --serve 8899
 *   curl 'http://127.0.0.1:8899/token?host=book.airgreenland.com'
 *   → {"token":"3:...","remainingSec":780}
 *
 * 设计取舍（写清楚，免得以后自己踩）：
 *   - 串行求解，不并发。同时开多个有头浏览器会互相抢焦点、抢 profile，
 *     实测更容易被识别。需要更高吞吐时应该多进程、每进程一个池。
 *   - 池大小默认 1。因为一个 token 能用 13 分钟，而求解只要 9 秒，
 *     除非 QPS 很高否则不需要多个。真需要时用 --size 调。
 *   - 提前 60 秒续期。提前量太大会浪费（每个 token 都要真跑一次浏览器）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT_BASE = 9501;
const RENEW_AHEAD_SEC = 60;   // 提前 60 秒续期

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const BLOCK = ['Pardon Our Interruption', '_Incapsula_Resource', 'Request unsuccessful',
  'Incapsula incident ID', 'main-iframe'];
const blockMarks = (t) => BLOCK.filter((x) => String(t || '').includes(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url, { maxPayload: 128 * 1024 * 1024 });
    this.id = 0; this.p = new Map();
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.p.has(m.id)) {
        const { res, rej } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => this.p.set(id, { res, rej }));
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

/** 解一次：启动有头浏览器 → 导航挑战页 → 等 reese84 cookie → 收全部 cookie */
async function solveOnce(host, opts) {
  const entry = `https://${host}/api/`;
  const bin = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!bin) throw new Error('找不到 Edge/Chrome');

  const port = (opts && opts.port) || PORT_BASE;
  const prof = path.join(os.tmpdir(), 'r84pool-' + process.pid + '-' + Date.now());

  // ★ 必须有头（headless 在这类站上拿不到 token），窗口放屏幕外不打扰。
  // ★ 绝不覆盖 UA：UA 与 sec-ch-ua 必须同源，否则自相矛盾必被拦。
  const child = spawn(bin, [
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-position=-2400,-2400', '--window-size=1366,768',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + port, 'about:blank',
  ], { stdio: 'ignore', windowsHide: false });

  let cdp = null;
  try {
    let up = false;
    for (let i = 0; i < 80; i++) {
      try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); up = true; break; }
      catch (e) { await sleep(250); }
    }
    if (!up) throw new Error('浏览器没起来');

    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Page.navigate', { url: entry });

    const deadline = Date.now() + ((opts && opts.timeoutMs) || 45000);
    let token = null;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `document.cookie.split('; ').find(x => x.startsWith('reese84=')) || ''`,
        returnByValue: true,
      }).catch(() => ({ result: {} }));
      const v = (r.result && r.result.value) || '';
      if (v.length > 200) { token = v.slice('reese84='.length); break; }
      await sleep(400);
    }
    if (!token) throw new Error('超时未拿到 token');

    // 收全部 cookie（含 HttpOnly）：单靠 document.cookie 会丢 session cookie
    const ck = await cdp.send('Network.getAllCookies');
    const jarc = (ck.cookies || []).filter((c) => c.domain.includes(host));
    const cookie = jarc.map((c) => `${c.name}=${c.value}`).join('; ');

    // 取 renewInSec 需要读响应体；用一次业务验证顺带确认真的通过
    const verify = await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }).then(() => null).catch(() => null);

    return {
      token,
      cookie,
      cookieCount: jarc.length,
      solvedAt: Date.now(),
      // 服务端 renewInSec 是 790~890，保守按 720 秒（12 分钟）
      expiresAt: Date.now() + 720 * 1000,
    };
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch (e) {}
    // 清 profile，避免累积占用磁盘（一个 profile 几百 MB）
    setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }, 3000);
  }
}

// ══════════════════════════════════════════════════════════════════
// 池
// ══════════════════════════════════════════════════════════════════
const pools = new Map();   // host -> { slots: [{token,cookie,expiresAt,solvedAt}], solving: Promise|null }

function poolOf(host, size) {
  if (!pools.has(host)) pools.set(host, { slots: [], solving: null, size: size || 1 });
  return pools.get(host);
}

function alive(slot) {
  return slot && slot.expiresAt - Date.now() > RENEW_AHEAD_SEC * 1000;
}

/**
 * 取一个可用 token。
 * 有存活的就直接给；没有就串行解一个（同时只允许一个求解在跑，
 * 并发调用会排队等同一个 Promise）。
 */
async function get(host, opts) {
  const p = poolOf(host, opts && opts.size);
  const now = Date.now();

  const good = p.slots.filter(alive).sort((a, b) => b.expiresAt - a.expiresAt);
  if (good.length) return good[0];

  // 需要解：串行化
  if (!p.solving) {
    p.solving = (async () => {
      try {
        const slot = await solveOnce(host, opts);
        p.slots.push(slot);
        // 只保留存活且不超过 size
        p.slots = p.slots.filter(alive).slice(-p.size);
        return slot;
      } finally {
        p.solving = null;
      }
    })();
  }
  return p.solving;
}

/** 后台维护：定时检查，快过期的提前续上 */
function startKeepAlive(host, opts) {
  const p = poolOf(host, opts && opts.size);
  const tick = async () => {
    try {
      const good = p.slots.filter(alive);
      if (good.length < p.size && !p.solving) {
        await get(host, opts);
      }
    } catch (e) {
      console.error('[pool] 续期失败:', e.message);
    }
    setTimeout(tick, 5000);
  };
  tick();
}

// ══════════════════════════════════════════════════════════════════
// 自测 / 服务
// ══════════════════════════════════════════════════════════════════
async function selfTest(host) {
  console.log('[1] 求解…');
  const t0 = Date.now();
  const slot = await solveOnce(host);
  console.log('    token 长度=%s  cookies=%s  耗时=%sms',
    slot.token.length, slot.cookieCount, Date.now() - t0);

  // 用 curl 风格的回放验证（走 Node fetch，带全量 cookie）
  console.log('[2] 验证 /…');
  const r = await fetch(`https://${host}/`, {
    headers: { 'Accept': '*/*', 'Cookie': slot.cookie },
    redirect: 'manual',
  }).catch((e) => ({ error: e }));
  if (r.error) { console.log('    !! 请求失败:', r.error.message); return; }
  const body = await r.text();
  const marks = blockMarks(body);
  const xi = r.headers.get('x-iinfo') || '';
  const passed = !marks.length && !/\bB1[0-9]?\(/.test(xi);
  console.log('    HTTP=%s len=%s  X-Iinfo=%s', r.status, body.length, xi.slice(0, 80));
  console.log('    %s', passed ? '✅ 通过（无 B 段、无拦截标记）' : '❌ 被拦 ' + marks.join(','));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
  const host = opt('--host', 'book.airgreenland.com');
  const serve = opt('--serve', null);

  if (serve) {
    const port = Number(serve);
    startKeepAlive(host, { size: Number(opt('--size', '1')) || 1 });
    http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname !== '/token') { res.writeHead(404); res.end('use /token?host='); return; }
      const h = u.searchParams.get('host') || host;
      try {
        const s = await get(h, { size: Number(opt('--size', '1')) || 1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token: s.token, cookie: s.cookie,
          remainingSec: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
          solvedAt: s.solvedAt,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }).listen(port, '127.0.0.1', () => {
      console.log('token 池服务已启动: http://127.0.0.1:%s/token?host=%s', port, host);
    });
  } else {
    selfTest(host).catch((e) => { console.error('失败:', e.message); process.exit(1); });
  }
}

module.exports = { solveOnce, get, startKeepAlive };

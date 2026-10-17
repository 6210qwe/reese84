/**
 * tools/browser_solve.js —— 用真实 Edge（CDP）解 reese84，然后用 curl 回放
 *
 * 这是一个对照实验，用来定位"token 被拒"的真正责任方：
 *   情况 A：浏览器 token + curl 回放 → 通过   ⇒ 问题在补环境产出的载荷
 *   情况 B：浏览器 token + curl 回放 → 被拒   ⇒ 问题在 HTTP/TLS 层（curl 与 Chrome 的
 *                                                TLS/HTTP2 指纹不同，Imperva 在边缘读）
 * 不做这个对照，就永远分不清该修载荷还是修网络栈。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9414;
const HOST = 'book.airgreenland.com';
const ENTRY = 'https://book.airgreenland.com/api/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url, { maxPayload: 128 * 1024 * 1024 });
    this.id = 0; this.pending = new Map();
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

function curlGet(url, cookieHeader, extraHeaders) {
  const { execFileSync } = require('child_process');
  const hdr = path.join(require('os').tmpdir(), 'bs_' + Date.now() + '.h');
  const out = hdr + '.body';
  const args = ['-sS', '-D', hdr, '-o', out, '--max-time', '40',
    '-A', UA, '-b', cookieHeader];
  for (const [k, v] of Object.entries(extraHeaders || {})) args.push('-H', k + ': ' + v);
  args.push(url);
  try { execFileSync('curl.exe', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }); } catch (e) {}
  let head = '', body = '';
  try { head = fs.readFileSync(hdr, 'latin1'); } catch (e) {}
  try { body = fs.readFileSync(out, 'utf8'); } catch (e) {}
  try { fs.unlinkSync(hdr); fs.unlinkSync(out); } catch (e) {}
  const blocks = head.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b));
  const last = blocks[blocks.length - 1] || '';
  const m = /^HTTP\/[\d.]+\s+(\d+)/.exec(last);
  return { status: m ? +m[1] : 0, head: last, body };
}

const BLOCK = ['Pardon Our Interruption', '_Incapsula_Resource', 'Request unsuccessful', 'Incapsula incident ID', 'main-iframe'];
const marks = (t) => BLOCK.filter((x) => String(t || '').includes(x));

(async () => {
  const bin = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!bin) throw new Error('找不到浏览器');
  const prof = path.join(require('os').tmpdir(), 'bsolve-' + Date.now());
  console.log('启动: ' + bin);
  // ★ 必须有头。headless=new 在这站上 90 秒都拿不到 token（被识别）。
  //   有头模式窗口放屏幕外，不打扰使用。
  const child = spawn(bin, ['--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-position=-2400,-2400', '--window-size=1366,768',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + PORT, 'about:blank'],
    { stdio: 'ignore', windowsHide: false });
  for (let i = 0; i < 40; i++) {
    try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); }
  }
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  // ★ 不要覆盖 UA！
  //   第一次跑我用 Emulation.setUserAgentOverride 把 UA 改成了 Chrome/141，
  //   但浏览器本体是 Edge/154 —— 于是 UA 说 Chrome、sec-ch-ua 说 Edge，自相矛盾，
  //   90 秒都拿不到 token。真实浏览器要用它自己的 UA，不能改。
  //   （要改就必须连 navigator.userAgentData / sec-ch-ua 一起改，否则更假。）
  await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});

  console.log('导航到挑战页…');
  await cdp.send('Page.navigate', { url: ENTRY });

  const t0 = Date.now();
  let token = null;
  while (Date.now() - t0 < 90000) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.cookie.split('; ').find(x => x.startsWith('reese84=')) || ''`,
      returnByValue: true,
    }).catch(() => ({ result: {} }));
    const v = (r.result && r.result.value) || '';
    if (v && v.length > 200) { token = v.slice('reese84='.length); break; }
    await sleep(500);
  }
  console.log(token ? '浏览器已拿到 token，长度=' + token.length + ' 耗时=' + (Date.now() - t0) + 'ms'
    : '!! 90s 内浏览器没拿到 token');

  const cookies = await cdp.send('Network.getAllCookies');
  const jar = (cookies.cookies || [])
    .filter((c) => c.domain.includes('airgreenland'))
    .map((c) => c.name + '=' + c.value).join('; ');
  console.log('cookie 数=' + (cookies.cookies || []).filter((c) => c.domain.includes('airgreenland')).length);
  try { child.kill(); } catch (e) {}

  if (!token) process.exit(1);

  // ★ 关键：用 curl 回放浏览器签发的 token
  const a = curlGet('https://' + HOST + '/', jar, { Accept: '*/*' });
  console.log('\n[curl 回放 浏览器token] GET /  → HTTP=' + a.status + ' len=' + a.body.length + ' 被拦标记=' + (marks(a.body).join(',') || 'none'));

  const b = curlGet('https://' + HOST + '/', jar, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9', 'Upgrade-Insecure-Requests': '1',
  });
  console.log('[curl 回放 浏览器token] GET / (导航头) → HTTP=' + b.status + ' len=' + b.body.length + ' 被拦标记=' + (marks(b.body).join(',') || 'none'));

  fs.writeFileSync(path.join(__dirname, '..', '_browser_control.json'), JSON.stringify({
    tokenLen: token.length, jar, curlA: { status: a.status, len: a.body.length, marks: marks(a.body) },
    curlB: { status: b.status, len: b.body.length, marks: marks(b.body) },
  }, null, 2));
  console.log('\n结论写入 _browser_control.json');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });

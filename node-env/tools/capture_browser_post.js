/**
 * capture_browser_post.js —— 抓真实浏览器那次 POST 的完整形态
 *
 * 为什么需要：
 *   已经证明「浏览器 token + curl 回放」能过（302、无拦截标记），
 *   而「我们补环境的 token + curl 回放」被 B12。
 *   那就必须知道浏览器那次 POST 到底带了什么：URL 参数、请求头、body 大小。
 *
 *   只要有一项是我们没有的（比如某个 header、某个 query 参数），
 *   就可能是服务端判定"这条载荷是不是自己发的"的依据。
 *
 * 用法：node tools/capture_browser_post.js
 * 产物：_browser_post.json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9491;
const ENTRY = 'https://book.airgreenland.com/api/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url, { maxPayload: 128 * 1024 * 1024 });
    this.id = 0; this.p = new Map(); this.events = [];
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.p.has(m.id)) {
        const { res, rej } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    });
  }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => this.p.set(id, { res, rej }));
  }
}

(async () => {
  const bins = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const bin = bins.find((p) => fs.existsSync(p));
  const prof = path.join(os.tmpdir(), 'cap' + Date.now());

  const child = spawn(bin, [
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-position=-2400,-2400', '--window-size=1366,768',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + PORT, 'about:blank',
  ], { stdio: 'ignore', windowsHide: false });

  for (let i = 0; i < 60; i++) {
    try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; }
    catch (e) { await sleep(250); }
  }
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();

  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  // 不要覆盖 UA（覆盖会造成 UA 与 sec-ch-ua 自相矛盾，必被拦）

  console.log('导航…');
  await cdp.send('Page.navigate', { url: ENTRY });

  let token = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.cookie.split('; ').find(x => x.startsWith('reese84=')) || ''`,
      returnByValue: true,
    }).catch(() => ({ result: {} }));
    const v = (r.result && r.result.value) || '';
    if (v.length > 200) { token = v.slice(9); break; }
    await sleep(400);
  }
  console.log(token ? '拿到 token，长度=' + token.length : '!! 没拿到 token');

  // 找所有 POST 请求
  const posts = cdp.events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params)
    .filter((p) => p.request && p.request.method === 'POST');

  console.log('\nPOST 请求共 ' + posts.length + ' 个');
  const out = posts.map((p) => ({
    url: p.request.url,
    headers: p.request.headers,
    postDataLen: (p.request.postData || '').length,
    postDataHead: (p.request.postData || '').slice(0, 300),
    // 完整 body 落盘（36KB），用于和我们的载荷做结构对齐
    _full: p.request.postData || '',
  }));
  for (const o of out) {
    console.log('  URL: ' + o.url);
    console.log('  body 长度: ' + o.postDataLen);
    console.log('  headers: ' + JSON.stringify(o.headers));
    console.log('  body 头: ' + o.postDataHead);
    console.log('');
  }

  const cookies = await cdp.send('Network.getAllCookies');
  const ck = (cookies.cookies || []).filter((c) => c.domain.includes('airgreenland'));
  // 完整 body 单独存，避免 json 里太乱
  const full = (out[0] && out[0]._full) || '';
  if (full) fs.writeFileSync(path.join(__dirname, '..', '_browser_body.json'), full, 'utf8');
  for (const o of out) delete o._full;
  fs.writeFileSync(path.join(__dirname, '..', '_browser_post.json'),
    JSON.stringify({ posts: out, cookies: ck.map((c) => ({ name: c.name, len: (c.value || '').length })) }, null, 2), 'utf8');

  try { child.kill(); } catch (e) {}
  process.exit(0);
})();

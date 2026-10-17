/**
 * tools/probe_generic_fonts.js —— 用 CDP 查浏览器把 generic font family 实际解析成哪个字体
 *
 * 为什么要这一步：
 *   canvas 的 measureText / 绘制结果完全取决于字体。实测显式族名两边完全一致
 *   （14px Arial：Chrome 125.95 / 我们 125.95），但 generic 族不一致：
 *     10px sans-serif   Chrome 101.03   Skia 63.65
 *     bold 14px serif   Chrome 155.95   Skia 95.59
 *   原因是 Skia 无法把 sans-serif/serif/monospace 映射到 Windows 的默认字体。
 *   于是 canvas 指纹整片区段与真机不同 —— 这是服务端最容易判定"非浏览器"的证据之一。
 *
 *   CSS.getPlatformFontsForNode 返回节点实际命中的字体名，是唯一权威答案。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9413;
const OUT = path.join(__dirname, '..', 'src', 'env', 'fontmap.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSERS = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
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

(async () => {
  const bin = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!bin) throw new Error('找不到浏览器');
  const prof = path.join(require('os').tmpdir(), 'fontprobe-' + Date.now());
  const child = spawn(bin, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + PORT, 'about:blank'],
    { stdio: 'ignore', windowsHide: true });

  for (let i = 0; i < 40; i++) {
    try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); }
  }
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await cdp.send('Runtime.enable');

  const GENERIC = ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy', '-apple-system', 'ui-sans-serif', 'ui-serif', 'ui-monospace'];
  // 每种 generic 放一个 span，标记 id
  const html = GENERIC.map((g, i) =>
    `<div id="g${i}" style="font-family:${g}">mmmmmmmmmmlli ABC xyz 1234</div>`).join('');

  await cdp.send('Runtime.evaluate', {
    expression: `document.body.innerHTML = ${JSON.stringify(html)}; document.body.style.margin='0';`,
  });
  await sleep(300);

  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const map = {};
  for (let i = 0; i < GENERIC.length; i++) {
    const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#g' + i });
    if (!q.nodeId) continue;
    try {
      const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: q.nodeId });
      const fonts = (r.fonts || []).filter((f) => f.glyphCount > 0);
      map[GENERIC[i]] = fonts.length ? fonts[0].familyName : null;
      console.log(GENERIC[i].padEnd(14), '→', map[GENERIC[i]], '(glyphs=' + (fonts[0] && fonts[0].glyphCount) + ')');
    } catch (e) {
      console.log(GENERIC[i].padEnd(14), '→ 查询失败', e.message);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(map, null, 2), 'utf8');
  console.log('\n已写入 ' + OUT);

  // 顺便验证：用映射后的具体字体名在浏览器里量宽度，看是否和 generic 一致
  const verify = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      const c = document.createElement('canvas').getContext('2d');
      const out = {};
      const specs = ['10px sans-serif','12px monospace','bold 14px serif','14px system-ui'];
      for (const s of specs) { c.font = s; out[s] = c.measureText('mmmmmmmmmmlli').width; }
      for (const k of Object.keys(${JSON.stringify(map)})) {
        const fam = ${JSON.stringify(map)}[k];
        if (!fam) continue;
        c.font = '10px "' + fam + '"'; out['10px "' + fam + '"'] = c.measureText('mmmmmmmmmmlli').width;
      }
      return out;
    })()`,
    returnByValue: true,
  });
  console.log('\n浏览器侧宽度校验:', JSON.stringify(verify.result.value, null, 2));

  try { child.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack); process.exit(1); });

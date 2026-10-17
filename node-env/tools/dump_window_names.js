/**
 * dump_window_names.js —— 从真实 Edge 导出 window 自有属性表
 *
 * 为什么需要：
 *   payload 的 schema 里有三个字段就是采这个：
 *     window_object_get_own_property_names_a
 *     window_object_get_own_property_names_b
 *     window_object_get_own_property_names_last_30
 *   实测真实 Chrome/Edge 的 Object.getOwnPropertyNames(window).length ≈ 1239，
 *   我们手写环境只有 ~292。差 900 多项，这三个字段怎么算都对不上。
 *
 * 导出的表带 typeof 和 enumerable，用来在补环境里"按类型合成"缺失的名字 ——
 * 只补名字不改类型的话，一次 typeof 抽查就露。
 *
 * 用法：node tools/dump_window_names.js
 * 产物：src/env/window_names.json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = `(function(){
  var out = [];
  var names = Object.getOwnPropertyNames(window);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    var t = 'undefined', tag = '', en = false;
    try {
      var v = window[n];
      t = typeof v;
      var d = Object.getOwnPropertyDescriptor(window, n);
      en = !!(d && d.enumerable);
      if (t === 'object' && v !== null) {
        tag = Object.prototype.toString.call(v).slice(8, -1);
      }
    } catch (e) {
      t = 'THROW';
    }
    out.push([n, t, tag, en ? 1 : 0]);
  }
  return JSON.stringify(out);
})()`;

(async () => {
  const bin = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const port = 9487;
  const prof = path.join(os.tmpdir(), 'wn' + Date.now());
  const ch = spawn(bin, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--enable-gpu', '--use-angle=d3d11', '--window-size=1366,768',
    '--user-data-dir=' + prof, '--remote-debugging-port=' + port, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let ok = false;
  for (let i = 0; i < 60; i++) {
    try { await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); ok = true; break; }
    catch (e) { await sleep(250); }
  }
  if (!ok) { console.error('Edge 没起来'); process.exit(1); }

  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  let id = 0; const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  const send = (method, params) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    return new Promise((res, rej) => pending.set(i, { res, rej }));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'https://book.airgreenland.com/api/' });
  await sleep(3500);

  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) { console.error(JSON.stringify(r.exceptionDetails).slice(0, 400)); process.exit(1); }
  const rows = JSON.parse(r.result.value);

  const outPath = path.join(__dirname, '..', 'src', 'env', 'window_names.json');
  fs.writeFileSync(outPath, JSON.stringify(rows), 'utf8');

  const byType = {};
  for (const [, t] of rows) byType[t] = (byType[t] || 0) + 1;
  console.log('导出 %s 个 window 自有属性 -> %s', rows.length, outPath);
  console.log('  类型分布:', JSON.stringify(byType));
  console.log('  可枚举:', rows.filter((x) => x[3] === 1).length);

  try { ch.kill(); } catch (e) {}
  try { ws.close(); } catch (e) {}
  process.exit(0);
})();

/**
 * 05-page.js —— 页面生命周期：把挑战页交给补环境 DOM，按浏览器顺序执行脚本
 *
 * reese84 的挑战页里有 4 段内联脚本，缺一段 VM 就不初始化（静默不动，无异常）：
 *   ① window.reeseSkipExpirationCheck = true; const isSpa = ...; const isInterstitial = ...;
 *   ② window.onProtectionInitialized = function (protection) { ... }
 *   ③ createElement('script') + src = "/<随机路径>?s=<随机>" + head.appendChild
 *   ④ function showBlockPage() + setTimeout(showBlockPage, 10000)
 *
 * 执行模型对齐浏览器：
 *   - 内联脚本按文档顺序、共享同一个全局词法作用域（真浏览器里 const 也会跨 script 共享）
 *   - 动态插入的 <script src> 触发真实下载后同步执行，并设置 document.currentScript
 */

'use strict';

const __pendingScripts = [];

function __stripScripts(html) {
  const scripts = [];
  // 取出所有 script（含 src 的），并从 HTML 里移除，剩下的再交给 DOM 解析
  const withoutScripts = String(html)
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, code) => {
      const srcM = /\bsrc\s*=\s*"([^"]*)"/i.exec(attrs) || /\bsrc\s*=\s*'([^']*)'/i.exec(attrs);
      scripts.push({ src: srcM ? srcM[1] : null, code: code, attrs: attrs });
      return '';
    });
  return { html: withoutScripts, scripts };
}

// 动态插入 <script src> 时真实加载并执行。
// 只挂 insertBefore：Node.prototype.appendChild 内部就是 return this.insertBefore(child, null)，
// 两个都挂会让同一个 sensor 被执行两次（第一次采集的副作用会污染第二次）。
const __origInsertBefore = Node.prototype.insertBefore;
defMethod(Node.prototype, 'insertBefore', function (child, ref) {
  const r = __origInsertBefore.call(this, child, ref);
  if (child && child.nodeType === ELEMENT_NODE) {
    const tag = st(child).tagName;
    if (tag === 'SCRIPT') {
      const src = child.getAttribute('src');
      if (src) __runExternalScript(child);
      else if (child.textContent) __runInline(child, child.textContent);
    } else if (tag === 'IFRAME') {
      // reese84 会 createElement('iframe') + 注册 load 监听 + 等它触发。
      // 补环境里没有浏览上下文，load 永远不会自己来 → VM 静默卡住。
      // 实测 20ms 足够等到监听器注册完成（iv8 的验证过的经验）。
      __HOST__.setTimeout(function () {
        try { child.dispatchEvent(new Event('load')); } catch (e) {}
      }, 20);
    }
  }
  return r;
});

/**
 * 重建文档树，并重新绑定 documentElement / head / body。
 * 这是补环境里最容易翻车的一步：引用不同步会让"元素明明 append 了却找不到"。
 */
function __rebuildDocument(cleanHtml) {
  const nodes = __parseHtml(cleanHtml, __document);

  let htmlEl = null;
  for (const n of nodes) {
    if (n.nodeType === ELEMENT_NODE && st(n).tagName === 'HTML') { htmlEl = n; break; }
  }
  if (!htmlEl) {
    htmlEl = __document.createElement('html');
    for (const n of nodes) htmlEl.appendChild(n);
  }

  st(__document).childNodes = [];
  st(htmlEl).parentNode = __document;
  st(__document).childNodes.push(htmlEl);

  let head = null, body = null;
  for (const c of st(htmlEl).childNodes) {
    if (c.nodeType !== ELEMENT_NODE) continue;
    if (st(c).tagName === 'HEAD') head = c;
    if (st(c).tagName === 'BODY') body = c;
  }
  if (!head) {
    head = __document.createElement('head');
    htmlEl.insertBefore(head, st(htmlEl).childNodes[0] || null);
  }
  if (!body) {
    body = __document.createElement('body');
    htmlEl.appendChild(body);
  }

  st(__document).documentElement = htmlEl;
  st(__document).head = head;
  st(__document).body = body;

  // 标题
  const t = head.querySelector('title');
  st(__document).titleVal = t ? t.textContent.trim() : '';
  return htmlEl;
}

function __runInline(el, code) {
  const prev = st(__document).currentScriptVal;
  st(__document).currentScriptVal = el;
  try {
    // 间接 eval：在全局作用域执行，能访问 globalThis 上的所有属性
    (0, eval)(String(code));
  } catch (e) {
    __HOST__.log('内联脚本异常: %s', (e && e.message) || e);
  } finally {
    st(__document).currentScriptVal = prev;
  }
}

function __runExternalScript(el) {
  const url = el.src;
  const prev = st(__document).currentScriptVal;
  st(__document).currentScriptVal = el;
  // 诊断：sensor 靠"找一个 src 匹配的 script 元素"来定位自己，这里把可见的脚本列出来
  try {
    const list = __document.scripts;
    const srcs = [];
    for (let i = 0; i < list.length; i++) srcs.push(list[i].getAttribute('src'));
    __HOST__.log('脚本可见性: document.scripts(%s) = %j | currentScript.src=%s', list.length, srcs, el.getAttribute('src'));
  } catch (e) {
    __HOST__.log('脚本可见性检查失败: %s', e && e.message);
  }
  const text = __HOST__.fetchTextSync(url);
  if (text === null) {
    __HOST__.log('脚本下载失败: %s', url);
    el.dispatchEvent(new Event('error'));
    st(__document).currentScriptVal = prev;
    return;
  }
  try {
    (0, eval)(text);
    el.dispatchEvent(new Event('load'));
  } catch (e) {
    __HOST__.log('外部脚本异常: %s | %s', url, (e && e.message) || e);
    if (e && e.stack) __HOST__.log('   stack: %s', String(e.stack).split('\n').slice(0, 6).join(' <- '));
    el.dispatchEvent(new Event('error'));
  } finally {
    st(__document).currentScriptVal = prev;
  }
}

/**
 * 载入挑战页。
 * @param {string} html  挑战页原文
 * @param {string} baseUrl 挑战页 URL（决定 location）
 */
function __pageLoad(html, baseUrl) {
  // 重置文档（等价于一次导航）
  const oldDoc = __document;
  __document = __makeDocument(baseUrl);
  __document.body.setAttribute('class', '');
  st(__document).readyState = 'loading';

  // 更新 location
  __window.location.href = baseUrl;

  const { html: cleanHtml, scripts } = __stripScripts(html);

  // ★ 不能用 documentElement.innerHTML 装配：innerHTML 会重建子树，
  //   而 document.head / document.body 仍指向被替换掉的旧节点，
  //   于是脚本里 document.head.appendChild(script) 挂到了游离节点上，
  //   sensor 随后在 document 里找不到自己的 <script src> →
  //   "Unable to find a challenge script with 'src' attribute"。
  //   这里显式解析后重新绑定 documentElement / head / body 的引用。
  try {
    __rebuildDocument(cleanHtml);
  } catch (e) {
    __HOST__.log('HTML 解析失败: %s', e && e.message);
  }

  // 内联脚本：合并执行（共享词法作用域，模拟浏览器的 global lexical environment）
  const inlineCodes = scripts.filter((s) => !s.src && s.code && s.code.trim());
  const externalSrcs = scripts.filter((s) => s.src);

  st(__document).readyState = 'interactive';
  if (inlineCodes.length) {
    const merged = inlineCodes.map((s) => '\n/* --- inline script --- */\n' + s.code).join('\n');
    const fakeEl = __document.createElement('script');
    st(__document).currentScriptVal = fakeEl;
    try {
      (0, eval)(merged);
    } catch (e) {
      __HOST__.log('内联脚本合并执行异常: %s', (e && e.message) || e);
      if (e && e.stack) __HOST__.log('   stack: %s', String(e.stack).split('\n').slice(0, 8).join(' <- '));
    } finally {
      st(__document).currentScriptVal = null;
    }
  }

  // 静态 <script src>（挑战页没有，但保留处理）
  for (const s of externalSrcs) {
    const el = __document.createElement('script');
    el.setAttribute('src', s.src);
    try { __runExternalScript(el); } catch (e) {}
  }

  // DOMContentLoaded / load
  st(__document).readyState = 'interactive';
  try { __document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true })); } catch (e) {}
  st(__document).readyState = 'complete';
  try { __window.dispatchEvent(new Event('DOMContentLoaded')); } catch (e) {}
  try { __window.dispatchEvent(new Event('load')); } catch (e) {}
  try { __document.dispatchEvent(new Event('readystatechange')); } catch (e) {}

  return true;
}

/**
 * 给 iframe 造一个"身份独立、能力委托"的子窗口。
 *
 * 两个都不能错：
 *   1. 身份必须独立 —— iframe.contentWindow === window 是一眼可判的假环境特征，
 *      浏览器里 self !== top、parent === top、frameElement 指回 <iframe>。
 *   2. 能力必须齐全 —— 早期版本给了个"只有几个字段的裸对象"，sensor 一进去就抛错，
 *      直接退化成错误上报（payload 从 32KB 掉到 11KB，且拿不到 token）。
 *
 * 所以这里用 Proxy：window 关系属性本地造，其余一切落到主 window。
 * 对象身份不同（=== 判定为 false），但 navigator/canvas/WebGL/定时器全都能用。
 */
function __makeSubWindow(frameEl) {
  const doc = new Document();
  st(doc).readyState = 'complete';

  const own = {
    window: null, self: null, frames: null,
    top: __window, parent: __window,
    frameElement: frameEl,
    document: doc,
    location: new Location('about:blank'),
    length: 0, closed: false, name: '',
    origin: __window.origin,
    isSecureContext: __window.isSecureContext,
  };

  const proxy = new Proxy(own, {
    get(target, k) {
      if (typeof k === 'symbol') return Reflect.get(target, k, target);
      if (k === 'window' || k === 'self' || k === 'frames') return proxy;
      if (k in target) return target[k];
      return Reflect.get(__window, k, __window);
    },
    set(target, k, v) {
      if (k in target) { target[k] = v; return true; }
      try { __window[k] = v; } catch (e) {}
      return true;
    },
    has(target, k) { return (k in target) || (k in __window); },
    deleteProperty(target, k) { delete target[k]; return true; },
    ownKeys(target) { return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, k) {
      if (k in target) return { value: target[k], writable: true, enumerable: true, configurable: true };
      return Object.getOwnPropertyDescriptor(__window, k);
    },
  });
  return proxy;
}

const __pageApi = {
  load: __pageLoad,
  getDocument: () => __document,
  getWindow: () => __window,
  // 供宿主在需要时核对 DOM
  html: () => (__document.documentElement ? __document.documentElement.outerHTML : ''),
  readyState: () => st(__document).readyState,
  // 诊断：把 reese84 的内部对象结构导出来
  inspectReese84() {
    const r = __window.reese84;
    if (!r) return { present: false };
    const out = { present: true, keys: Object.keys(r) };
    try { out.cookieName = r.COOKIE_NAME; } catch (e) {}
    try { out.captcha = Object.getOwnPropertyNames(r.CaptchaProvider || {}); } catch (e) {}
    try { out.prototype = Object.getOwnPropertyNames(r.Protection.prototype); } catch (e) {}
    return out;
  },
};

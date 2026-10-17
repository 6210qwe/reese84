/**
 * 01-core.js —— 补环境核心层：util / EventTarget / Event / Node / Element / HTMLElement / Document / 布局
 *
 * 设计原则（对应 web-js-env-patcher 硬规则 11/12/13）：
 *   1. 真实对象模型：Node → Element → HTMLElement → 具体元素，原型链完整。
 *      sensor 会把 Element.prototype.insertBefore 复制成带随机后缀的私有别名
 *      （body['insertBefore_e421bb29']），原型链断一处就复制出 undefined，
 *      异常会被 sensor 自己吞掉，只上报一条 796 字节的错误载荷 —— 永远拿不到 token。
 *   2. 私有状态隔离：内部状态放模块级 WeakMap，绝不在对象上挂 _ / __ 属性。
 *   3. native-like：所有补的函数 toString 都是 [native code]。
 *
 * 不依赖 jsdom：jsdom 的 UA 里带 jsdom/x.y.z、canvas 是假实现（measureText 零开销）、
 * 布局全 0，三处都会被 reese84 直接判死。
 */

'use strict';

// ══════════════════════════════════════════════════════════════════
// 0. 工具
// ══════════════════════════════════════════════════════════════════

// native-like：让 Function.prototype.toString 返回 [native code]
const __nativeFns = new WeakSet();
const __origFTS = Function.prototype.toString;
const __nativeFTS = function toString() {
  if (__nativeFns.has(this)) {
    const name = __fnNames.get(this) || '';
    return 'function ' + name + '() { [native code] }';
  }
  return __origFTS.call(this);
};
const __fnNames = new WeakMap();
__nativeFns.add(__nativeFTS);
__fnNames.set(__nativeFTS, 'toString');
Object.defineProperty(Function.prototype, 'toString', {
  value: __nativeFTS, writable: true, configurable: true, enumerable: false,
});

// ══════════════════════════════════════════════════════════════════
// ★★ 补 Node 22 缺失的 Uint8Array base64/hex API
//
// 这一组是 2024 年进标准、Chromium 早已支持、Node 25 才有的方法：
//   Uint8Array.prototype.toBase64() / toHex()
//   Uint8Array.fromBase64() / fromHex()
// 实测真实 Edge：四个全是 function；Node 22 全是 undefined。
//
// 为什么这条很关键：
//   sensor 编码 payload 很可能用 toBase64（比手写 base64 + btoa 更快）。
//   我们环境里没有 → 抛 TypeError → 被 try/catch 吞掉 → 静默走降级路径
//   或直接少一块数据。这类"新标准 API 缺失"是最难发现的，
//   因为它不在任何补环境 checklist 里（大多数 checklist 是 2020 年写的）。
//
// 顺带把依据同一规范的其它新方法也补上，避免下次再撞：
//   ArrayBuffer.prototype.transferToFixedLength、Uint8Array.prototype.setFromBase64
// ══════════════════════════════════════════════════════════════════
function __installModernTypedArrayApis() {
  const TAs = [Uint8Array, Uint8ClampedArray, Int8Array];
  const toB64 = function toBase64(options) {
    const bytes = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
    let b64 = Buffer.from(bytes).toString('base64');
    const alphabet = options && options.alphabet;
    if (alphabet === 'base64url') {
      b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } else if (options && options.omitPadding) {
      b64 = b64.replace(/=+$/, '');
    }
    return b64;
  };
  const toHex = function toHex() {
    const bytes = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
    return Buffer.from(bytes).toString('hex');
  };

  for (const TA of TAs) {
    if (typeof TA.prototype.toBase64 !== 'function') {
      defMethod(TA.prototype, 'toBase64', nativeLike(toB64, 'toBase64'));
    }
    if (typeof TA.prototype.toHex !== 'function') {
      defMethod(TA.prototype, 'toHex', nativeLike(toHex, 'toHex'));
    }
    if (typeof TA.fromBase64 !== 'function') {
      defValue(TA, 'fromBase64', nativeLike(function fromBase64(str, options) {
        let t = String(str);
        if (options && options.alphabet === 'base64url') {
          t = t.replace(/-/g, '+').replace(/_/g, '/');
        }
        t += '='.repeat((-t.length % 4 + 4) % 4);
        const buf = Buffer.from(t, 'base64');
        return new TA(buf.buffer, buf.byteOffset, buf.length);
      }, 'fromBase64'), true);
    }
    if (typeof TA.fromHex !== 'function') {
      defValue(TA, 'fromHex', nativeLike(function fromHex(str) {
        const buf = Buffer.from(String(str), 'hex');
        return new TA(buf.buffer, buf.byteOffset, buf.length);
      }, 'fromHex'), true);
    }
    if (typeof TA.prototype.setFromBase64 !== 'function') {
      defMethod(TA.prototype, 'setFromBase64', function (str, options) {
        let t = String(str);
        if (options && options.alphabet === 'base64url') t = t.replace(/-/g, '+').replace(/_/g, '/');
        t += '='.repeat((-t.length % 4 + 4) % 4);
        const src = Buffer.from(t, 'base64');
        const n = Math.min(src.length, this.length);
        this.set(src.subarray(0, n), 0);
        return { read: String(str).length, written: n };
      });
    }
    if (typeof TA.prototype.setFromHex !== 'function') {
      defMethod(TA.prototype, 'setFromHex', function (str) {
        const src = Buffer.from(String(str), 'hex');
        const n = Math.min(src.length, this.length);
        this.set(src.subarray(0, n), 0);
        return { read: String(str).length, written: n };
      });
    }
  }
  if (typeof ArrayBuffer.prototype.transferToFixedLength !== 'function') {
    defMethod(ArrayBuffer.prototype, 'transferToFixedLength', function (newLen) {
      const n = newLen === undefined ? this.byteLength : (newLen | 0);
      const out = new ArrayBuffer(n);
      new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(n, this.byteLength)));
      return out;
    });
  }
}

function nativeLike(fn, name) {
  if (typeof fn !== 'function') return fn;
  __nativeFns.add(fn);
  if (name) __fnNames.set(fn, name);
  return fn;
}

/**
 * ★★ 让 class 构造器对 Function.prototype.toString 伪装成原生函数。
 *
 * 为什么必须做（实测抓到的泄漏）：
 *   class Navigator extends EventTarget { ... }  →  toString() 直接返回整段源码
 *   浏览器里必须是  "function Navigator() { [native code] }"
 *
 * scrapebadger 的 2026 实测报告点名了这件事：
 *   "The 12 Function.prototype.toString calls matter most here.
 *    Two of them targeted Window and eval, which is what a native-code integrity check looks like."
 *
 * 也就是说这是 reese84 的**主动检测项**，不是"顺手看看"。
 * 我们之前所有 class 都漏了（Navigator / Document / Element / XMLHttpRequest / ... 二十多个）。
 */
/**
 * ★★ 原型链自检加固（52pojie 某航司实测清单，2025-09）
 *
 * 该文列出的 22 个采集函数里，函数二十专门查：
 *   Function.prototype.toString / call / apply / bind 的 toString
 * 函数二十一查：
 *   window.Object.getPrototypeOf() 的属性
 * 另外还有一条极易漏的：
 *   window.Object.getOwnPropertyNames(某个补的函数) 必须只返回 ['length', 'name']
 *
 * 我们自己补环境时，函数上会挂一堆东西（__nativeFns 是 WeakSet 不占自有属性，
 * 但 Function.prototype.toString 本身被替换后，它的 toString 又变成普通函数源码）。
 * 这几点必须逐项对齐。
 */
function __hardenPrototypeChain() {
  const FP = Function.prototype;

  // 1) 让 Function.prototype.toString / call / apply / bind 本身也是 native
  for (const m of ['toString', 'call', 'apply', 'bind']) {
    const d = Object.getOwnPropertyDescriptor(FP, m);
    if (d && typeof d.value === 'function') {
      if (!__nativeFns.has(d.value)) { __nativeFns.add(d.value); __fnNames.set(d.value, m); }
    }
  }

  // 2) ★ Object.getOwnPropertyNames(任意原生函数) 只能返回 ['length', 'name']
  //    浏览器里 function X(){} 的自有属性就是这两个（arguments/caller 是不可枚举的访问器，
  //    但 getOwnPropertyNames 也会包含它们 —— 实测 Chrome 返回 ['length','name'] 是因为
  //    严格模式下 arguments/caller 被移除）。这里统一对齐成 ['length','name']。
  const __origGOPN = Object.getOwnPropertyNames;
  const __nativeGOPN = function getOwnPropertyNames(obj) {
    const r = __origGOPN(obj);
    if (typeof obj === 'function') {
      // 只保留浏览器里真实存在的两个自有属性
      return r.filter((k) => k === 'length' || k === 'name' || k === 'prototype');
    }
    return r;
  };
  __nativeFns.add(__nativeGOPN); __fnNames.set(__nativeGOPN, 'getOwnPropertyNames');
  Object.defineProperty(Object, 'getOwnPropertyNames', {
    value: __nativeGOPN, writable: true, configurable: true, enumerable: false,
  });

  // 3) 原型链形状：Object.getPrototypeOf(function(){}) === Function.prototype
  //    （我们的函数都是普通函数，天然成立；这里只保证不被上面的替换破坏）

  // 4) Object.prototype.toString 也要 native（常用于 brand 检测）
  const obs = Object.prototype.toString;
  if (!__nativeFns.has(obs)) { __nativeFns.add(obs); __fnNames.set(obs, 'toString'); }
}

function nativeClass(cls, name) {
  if (typeof cls !== 'function') return cls;
  const nm = name || cls.name || '';
  __nativeFns.add(cls);
  __fnNames.set(cls, nm);
  // 顺带把原型上的方法也标 native（方法都是 defMethod(defMethod 已处理)，
  // 但 class 内直接写的 addEventListener 之类不会走 defMethod）
  try {
    for (const k of Object.getOwnPropertyNames(cls.prototype)) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(cls.prototype, k);
      if (!d) continue;
      if (typeof d.value === 'function' && !__nativeFns.has(d.value)) {
        __nativeFns.add(d.value);
        __fnNames.set(d.value, k);
      }
      if (typeof d.get === 'function' && !__nativeFns.has(d.get)) {
        __nativeFns.add(d.get);
        __fnNames.set(d.get, 'get ' + k);
      }
      if (typeof d.set === 'function' && !__nativeFns.has(d.set)) {
        __nativeFns.add(d.set);
        __fnNames.set(d.set, 'set ' + k);
      }
    }
  } catch (e) {}
  return cls;
}

// 定义 getter（浏览器语义：configurable + enumerable on prototype）
function defGetter(obj, prop, getter, enumerable) {
  Object.defineProperty(obj, prop, {
    get: nativeLike(getter, 'get ' + prop),
    set: undefined,
    configurable: true,
    enumerable: enumerable !== false,
  });
}
function defGetterSetter(obj, prop, getter, setter, enumerable) {
  Object.defineProperty(obj, prop, {
    get: nativeLike(getter, 'get ' + prop),
    set: nativeLike(setter, 'set ' + prop),
    configurable: true,
    enumerable: enumerable !== false,
  });
}
function defMethod(obj, name, fn) {
  Object.defineProperty(obj, name, {
    value: nativeLike(fn, name), writable: true, configurable: true, enumerable: false,
  });
}
function defValue(obj, name, val, enumerable) {
  Object.defineProperty(obj, name, {
    value: val, writable: true, configurable: true, enumerable: !!enumerable,
  });
}

// 内部状态一律放这里
const __state = new WeakMap();
function st(obj) {
  let s = __state.get(obj);
  if (!s) { s = {}; __state.set(obj, s); }
  return s;
}

const __toStr = Object.prototype.toString;

// ══════════════════════════════════════════════════════════════════
// 1. EventTarget / Event
// ══════════════════════════════════════════════════════════════════

class Event {
  constructor(type, init) {
    if (arguments.length === 0) throw new TypeError("Failed to construct 'Event': 1 argument required");
    init = init || {};
    st(this).type = String(type);
    st(this).bubbles = !!init.bubbles;
    st(this).cancelable = !!init.cancelable;
    st(this).composed = !!init.composed;
    st(this).target = null;
    st(this).currentTarget = null;
    st(this).defaultPrevented = false;
    st(this).propagationStopped = false;
    st(this).immediateStopped = false;
    st(this).timeStamp = __HOST__.now();
    st(this).isTrusted = false;
    st(this).phase = 0;
  }
  get type() { return st(this).type; }
  get target() { return st(this).target; }
  get srcElement() { return st(this).target; }
  get currentTarget() { return st(this).currentTarget; }
  get bubbles() { return st(this).bubbles; }
  get cancelable() { return st(this).cancelable; }
  get composed() { return st(this).composed; }
  get defaultPrevented() { return st(this).defaultPrevented; }
  get timeStamp() { return st(this).timeStamp; }
  get isTrusted() { return st(this).isTrusted; }
  get eventPhase() { return st(this).phase; }
  get returnValue() { return !st(this).defaultPrevented; }
  get cancelBubble() { return st(this).propagationStopped; }
  set cancelBubble(v) { if (v) st(this).propagationStopped = true; }
  preventDefault() { if (st(this).cancelable) st(this).defaultPrevented = true; }
  stopPropagation() { st(this).propagationStopped = true; }
  stopImmediatePropagation() { st(this).propagationStopped = true; st(this).immediateStopped = true; }
  composedPath() { return st(this).target ? [st(this).target] : []; }
  initEvent(type, bubbles, cancelable) {
    st(this).type = String(type);
    st(this).bubbles = !!bubbles;
    st(this).cancelable = !!cancelable;
  }
}
Object.defineProperty(Event.prototype, Symbol.toStringTag, { value: 'Event', configurable: true });
defValue(Event.prototype, 'NONE', 0, true);
defValue(Event.prototype, 'CAPTURING_PHASE', 1, true);
defValue(Event.prototype, 'AT_TARGET', 2, true);
defValue(Event.prototype, 'BUBBLING_PHASE', 3, true);

class CustomEvent extends Event {
  constructor(type, init) {
    super(type, init);
    st(this).detail = init && init.detail !== undefined ? init.detail : null;
  }
  get detail() { return st(this).detail; }
}
Object.defineProperty(CustomEvent.prototype, Symbol.toStringTag, { value: 'CustomEvent', configurable: true });

class UIEvent extends Event {
  constructor(type, init) {
    super(type, init);
    st(this).view = (init && init.view) || null;
    st(this).detail = (init && init.detail) || 0;
  }
  get view() { return st(this).view; }
  get detail() { return st(this).detail; }
}
class MouseEvent extends UIEvent {
  constructor(type, init) {
    super(type, init);
    init = init || {};
    const s = st(this);
    s.screenX = init.screenX || 0; s.screenY = init.screenY || 0;
    s.clientX = init.clientX || 0; s.clientY = init.clientY || 0;
    s.button = init.button || 0; s.buttons = init.buttons || 0;
    s.relatedTarget = init.relatedTarget || null;
  }
  get screenX() { return st(this).screenX; }
  get screenY() { return st(this).screenY; }
  get clientX() { return st(this).clientX; }
  get clientY() { return st(this).clientY; }
  get pageX() { return st(this).clientX; }
  get pageY() { return st(this).clientY; }
  get x() { return st(this).clientX; }
  get y() { return st(this).clientY; }
  get offsetX() { return st(this).clientX; }
  get offsetY() { return st(this).clientY; }
  get button() { return st(this).button; }
  get buttons() { return st(this).buttons; }
  get relatedTarget() { return st(this).relatedTarget; }
}
class KeyboardEvent extends UIEvent {
  constructor(type, init) {
    super(type, init);
    init = init || {};
    st(this).key = init.key || '';
    st(this).code = init.code || '';
    st(this).keyCode = init.keyCode || 0;
    st(this).which = init.which || 0;
  }
  get key() { return st(this).key; }
  get code() { return st(this).code; }
  get keyCode() { return st(this).keyCode; }
  get which() { return st(this).which; }
}
class MessageEvent extends Event {
  constructor(type, init) {
    super(type, init);
    init = init || {};
    st(this).data = init.data;
    st(this).origin = init.origin || '';
    st(this).source = init.source || null;
    st(this).ports = init.ports || [];
  }
  get data() { return st(this).data; }
  get origin() { return st(this).origin; }
  get source() { return st(this).source; }
  get ports() { return st(this).ports; }
}
class ErrorEvent extends Event {
  constructor(type, init) {
    super(type, init);
    init = init || {};
    st(this).message = init.message || '';
    st(this).filename = init.filename || '';
    st(this).lineno = init.lineno || 0;
    st(this).colno = init.colno || 0;
    st(this).error = init.error || null;
  }
  get message() { return st(this).message; }
  get filename() { return st(this).filename; }
  get lineno() { return st(this).lineno; }
  get colno() { return st(this).colno; }
  get error() { return st(this).error; }
}
class ProgressEvent extends Event {
  constructor(type, init) {
    super(type, init);
    init = init || {};
    st(this).lengthComputable = !!init.lengthComputable;
    st(this).loaded = init.loaded || 0;
    st(this).total = init.total || 0;
  }
  get lengthComputable() { return st(this).lengthComputable; }
  get loaded() { return st(this).loaded; }
  get total() { return st(this).total; }
}

// 事件存储：WeakMap<target, Map<type, [{fn, once, capture}]>>
const __listeners = new WeakMap();
function ls(target) {
  let m = __listeners.get(target);
  if (!m) { m = new Map(); __listeners.set(target, m); }
  return m;
}

class EventTarget {
  addEventListener(type, fn, opts) {
    if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const once = !!(opts && typeof opts === 'object' && opts.once);
    const m = ls(this);
    const key = String(type);
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    if (arr.some((x) => x.fn === fn && x.capture === capture)) return;
    arr.push({ fn, capture, once });
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const arr = ls(this).get(String(type));
    if (!arr) return;
    const i = arr.findIndex((x) => x.fn === fn && x.capture === capture);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!(ev instanceof Event)) throw new TypeError('parameter 1 is not of type Event');
    const s = st(ev);
    s.target = s.target || this;
    s.phase = 2;
    // 捕获阶段（从祖先到本节点）
    const path = [];
    if (s.bubbles) {
      let p = this.parentNode;
      while (p) { path.push(p); p = p.parentNode; }
      for (let i = path.length - 1; i >= 0; i--) {
        s.currentTarget = path[i];
        s.phase = 1;
        __fire(path[i], ev, true);
        if (s.propagationStopped) break;
      }
    }
    if (!s.propagationStopped) {
      s.currentTarget = this;
      s.phase = 2;
      __fire(this, ev, null);
    }
    if (s.bubbles && !s.propagationStopped) {
      for (let i = 0; i < path.length; i++) {
        s.currentTarget = path[i];
        s.phase = 3;
        __fire(path[i], ev, false);
        if (s.propagationStopped) break;
      }
    }
    s.currentTarget = null;
    s.phase = 0;
    return !s.defaultPrevented;
  }
}
function __fire(target, ev, captureFilter) {
  const arr = ls(target).get(String(st(ev).type));
  if (!arr || !arr.length) return;
  for (const item of arr.slice()) {
    if (captureFilter !== null && item.capture !== captureFilter) continue;
    try {
      if (typeof item.fn === 'function') item.fn.call(target, ev);
      else item.fn.handleEvent(ev);
    } catch (e) { /* 浏览器里监听器抛错不中断派发 */ }
    if (item.once) {
      const i = arr.indexOf(item);
      if (i >= 0) arr.splice(i, 1);
    }
    if (st(ev).immediateStopped) break;
  }
}

// on<event> 属性（window.onload 等）
function installOnHandlers(obj, names) {
  for (const n of names) {
    const prop = 'on' + n;
    let cur = null;
    Object.defineProperty(obj, prop, {
      configurable: true, enumerable: true,
      get() { return cur; },
      set(fn) {
        if (cur) this.removeEventListener(n, cur);
        cur = typeof fn === 'function' ? fn : null;
        if (cur) this.addEventListener(n, cur);
      },
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. Node / Element / HTMLElement
// ══════════════════════════════════════════════════════════════════

const ELEMENT_NODE = 1, TEXT_NODE = 3, COMMENT_NODE = 8, DOCUMENT_NODE = 9,
  DOCUMENT_TYPE_NODE = 10, DOCUMENT_FRAGMENT_NODE = 11;

class Node extends EventTarget {
  constructor() {
    super();
    st(this).childNodes = [];
    st(this).parentNode = null;
  }
  get nodeType() { return 0; }
  get nodeName() { return ''; }
  get ownerDocument() { return __document; }
  get parentNode() { return st(this).parentNode; }
  get parentElement() {
    const p = st(this).parentNode;
    return p && p.nodeType === ELEMENT_NODE ? p : null;
  }
  get childNodes() { return st(this).childNodes; }
  get firstChild() { return st(this).childNodes[0] || null; }
  get lastChild() { const c = st(this).childNodes; return c[c.length - 1] || null; }
  get nextSibling() {
    const p = st(this).parentNode;
    if (!p) return null;
    const c = st(p).childNodes;
    const i = c.indexOf(this);
    return i >= 0 && i + 1 < c.length ? c[i + 1] : null;
  }
  get previousSibling() {
    const p = st(this).parentNode;
    if (!p) return null;
    const c = st(p).childNodes;
    const i = c.indexOf(this);
    return i > 0 ? c[i - 1] : null;
  }
  get isConnected() {
    let n = this;
    while (n) { if (n === __document) return true; n = st(n).parentNode; }
    return false;
  }
  get textContent() {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) return st(this).data || '';
    const out = [];
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (c.nodeType === TEXT_NODE) out.push(st(c).data || '');
        else walk(c);
      }
    };
    walk(this);
    return out.join('');
  }
  set textContent(v) {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) { st(this).data = String(v); return; }
    for (const c of st(this).childNodes.slice()) this.removeChild(c);
    if (v !== '' && v !== null && v !== undefined) {
      this.appendChild(__document.createTextNode(String(v)));
    }
  }
  get nodeValue() {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) return st(this).data || '';
    return null;
  }
  set nodeValue(v) {
    if (this.nodeType === TEXT_NODE || this.nodeType === COMMENT_NODE) st(this).data = String(v);
  }
  hasChildNodes() { return st(this).childNodes.length > 0; }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    if (!child || typeof child.nodeType !== 'number') throw new TypeError("Failed to execute 'insertBefore': parameter 1 is not of type 'Node'");
    const cs = st(this).childNodes;
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      const kids = st(child).childNodes.slice();
      for (const k of kids) this.insertBefore(k, ref);
      return child;
    }
    if (st(child).parentNode) st(child).parentNode.removeChild(child);
    let idx = cs.length;
    if (ref) {
      const i = cs.indexOf(ref);
      if (i < 0) throw new Error("Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.");
      idx = i;
    }
    cs.splice(idx, 0, child);
    st(child).parentNode = this;
    return child;
  }
  removeChild(child) {
    const cs = st(this).childNodes;
    const i = cs.indexOf(child);
    if (i < 0) throw new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.");
    cs.splice(i, 1);
    st(child).parentNode = null;
    return child;
  }
  replaceChild(newChild, oldChild) {
    const i = st(this).childNodes.indexOf(oldChild);
    if (i < 0) throw new Error('replaceChild: not a child');
    this.insertBefore(newChild, oldChild);
    return this.removeChild(oldChild);
  }
  cloneNode(deep) {
    let copy;
    if (this.nodeType === TEXT_NODE) copy = __document.createTextNode(st(this).data);
    else if (this.nodeType === COMMENT_NODE) copy = __document.createComment(st(this).data);
    else {
      copy = __document.createElement(st(this).tagName || 'div');
      for (const [k, v] of Object.entries(st(this).attrs || {})) copy.setAttribute(k, v);
    }
    if (deep) for (const c of st(this).childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  contains(other) {
    let n = other;
    while (n) { if (n === this) return true; n = st(n).parentNode; }
    return false;
  }
  getRootNode() { let n = this; while (st(n).parentNode) n = st(n).parentNode; return n; }
  compareDocumentPosition(other) {
    if (this === other) return 0;
    if (this.contains(other)) return 20;
    if (other.contains(this)) return 10;
    return 1;
  }
  isSameNode(o) { return this === o; }
  isEqualNode(o) { return this === o; }
  normalize() {}
}
Object.defineProperty(Node.prototype, Symbol.toStringTag, { value: 'Node', configurable: true });
defValue(Node.prototype, 'ELEMENT_NODE', 1, true);
defValue(Node.prototype, 'TEXT_NODE', 3, true);
defValue(Node.prototype, 'COMMENT_NODE', 8, true);
defValue(Node.prototype, 'DOCUMENT_NODE', 9, true);
defValue(Node.prototype, 'DOCUMENT_FRAGMENT_NODE', 11, true);
defValue(Node.prototype, 'DOCUMENT_POSITION_PRECEDING', 2, true);
defValue(Node.prototype, 'DOCUMENT_POSITION_FOLLOWING', 4, true);
defValue(Node.prototype, 'DOCUMENT_POSITION_CONTAINED_BY', 16, true);
defValue(Node.prototype, 'DOCUMENT_POSITION_CONTAINS', 8, true);

class CharacterData extends Node {
  get data() { return st(this).data || ''; }
  set data(v) { st(this).data = String(v); }
  get length() { return (st(this).data || '').length; }
}
class Text extends CharacterData {
  constructor(data) { super(); st(this).data = data === undefined ? '' : String(data); }
  get nodeType() { return TEXT_NODE; }
  get nodeName() { return '#text'; }
  get wholeText() { return st(this).data || ''; }
}
Object.defineProperty(Text.prototype, Symbol.toStringTag, { value: 'Text', configurable: true });
class Comment extends CharacterData {
  constructor(data) { super(); st(this).data = data === undefined ? '' : String(data); }
  get nodeType() { return COMMENT_NODE; }
  get nodeName() { return '#comment'; }
}
Object.defineProperty(Comment.prototype, Symbol.toStringTag, { value: 'Comment', configurable: true });

// ---- CSSStyleDeclaration ----
const __cssProps = new Set([
  'display', 'visibility', 'opacity', 'position', 'width', 'height', 'top', 'left',
  'right', 'bottom', 'margin', 'padding', 'color', 'background', 'backgroundColor',
  'font', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'zIndex', 'overflow',
  'transform', 'pointerEvents', 'textAlign', 'border', 'boxSizing', 'maxWidth',
  'minWidth', 'maxHeight', 'minHeight', 'float', 'clear', 'cursor', 'whiteSpace',
  'textDecoration', 'letterSpacing', 'wordSpacing', 'flex', 'order', 'alignItems',
  'justifyContent', 'flexDirection', 'gap', 'transition', 'animation', 'filter',
  'clip', 'clipPath', 'contentVisibility', 'contain', 'willChange', 'userselect',
  'userSelect', 'appearance', 'outline', 'boxShadow', 'borderRadius', 'verticalAlign',
]);
function kebab(p) { return String(p).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }
function camel(p) { return String(p).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

class CSSStyleDeclaration {
  constructor(el) {
    // 用普通对象存，但通过 Proxy 拦截未知属性
    const self = this;
    st(self).decl = {};
    return new Proxy(this, {
      get(t, k, r) {
        if (typeof k === 'symbol') return Reflect.get(t, k, r);
        if (k === 'length') return Object.keys(st(t).decl || {}).length;
        if (k === 'cssText') {
          const d = st(t).decl || {};
          return Object.keys(d).map((x) => kebab(x) + ': ' + d[x] + ';').join(' ');
        }
        if (k === 'setProperty') return t.setProperty.bind(t);
        if (k === 'getPropertyValue') return t.getPropertyValue.bind(t);
        if (k === 'removeProperty') return t.removeProperty.bind(t);
        if (k === 'item') return t.item.bind(t);
        if (k === 'getPropertyPriority') return () => '';
        if (k === 'cssFloat') return (st(t).decl || {}).float || '';
        if (k in t && typeof t[k] === 'function') return t[k].bind(t);
        const v = (st(t).decl || {})[camel(k)];
        return v === undefined ? '' : v;
      },
      set(t, k, v) {
        if (typeof k === 'symbol') { t[k] = v; return true; }
        if (k === 'cssText') { st(t).decl = parseCssText(String(v)); return true; }
        const s2 = st(t);
        if (!s2.decl) s2.decl = {};
        s2.decl[camel(k)] = v === null ? '' : String(v);
        return true;
      },
      has(t, k) {
        if (typeof k === 'symbol') return k in t;
        return camel(k) in (st(t).decl || {}) || k in t;
      },
      ownKeys(t) {
        return Object.keys(st(t).decl || {});
      },
      getOwnPropertyDescriptor(t, k) {
        if (typeof k !== 'symbol' && (st(t).decl || {})[camel(k)] !== undefined) {
          return { value: st(t).decl[camel(k)], writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    });
  }
  getPropertyValue(p) {
    const v = (st(this).decl || {})[camel(p)];
    return v === undefined ? '' : v;
  }
  setProperty(p, v) {
    const s2 = st(this); if (!s2.decl) s2.decl = {};
    s2.decl[camel(p)] = v === null ? '' : String(v);
  }
  removeProperty(p) {
    const s2 = st(this); if (!s2.decl) s2.decl = {};
    const k = camel(p); const old = s2.decl[k]; delete s2.decl[k]; return old || '';
  }
  item(i) { return Object.keys(st(this).decl || {})[i] || ''; }
  get cssText() { return ''; }
}
Object.defineProperty(CSSStyleDeclaration.prototype, Symbol.toStringTag, { value: 'CSSStyleDeclaration', configurable: true });

function parseCssText(txt) {
  const out = {};
  for (const part of String(txt).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[camel(k)] = v;
  }
  return out;
}
function styleOf(el) {
  const s = st(el);
  if (!s.style) s.style = new CSSStyleDeclaration(el);
  return s.style;
}
function stylePx(el, prop) {
  const v = styleOf(el)[prop];
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function isHidden(el) {
  const su = styleOf(el);
  if (su.display === 'none' || su.visibility === 'hidden') return true;
  let p = st(el).parentNode;
  while (p && p.nodeType === ELEMENT_NODE) {
    const ps = styleOf(p);
    if (ps.display === 'none') return true;
    p = st(p).parentNode;
  }
  return false;
}

// ---- Element ----
const BLOCK_TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'body', 'html', 'head', 'section', 'article', 'header', 'footer', 'nav', 'main', 'form',
  'table', 'tbody', 'thead', 'tr', 'td', 'th', 'blockquote', 'pre', 'hr', 'noscript']);
const INLINE_TAGS = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'small', 'label', 'code', 'br']);

class Element extends Node {
  constructor(tagName) {
    super();
    st(this).tagName = String(tagName).toUpperCase();
    st(this).attrs = {};
    st(this).classListSet = new Set();
    st(this).style = null;
  }
  get nodeType() { return ELEMENT_NODE; }
  get nodeName() { return st(this).tagName; }
  get tagName() { return st(this).tagName; }
  get localName() { return st(this).tagName.toLowerCase(); }
  get namespaceURI() { return 'http://www.w3.org/1999/xhtml'; }
  get id() { return st(this).attrs.id || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return st(this).attrs.class || ''; }
  set className(v) { this.setAttribute('class', v); }
  get style() { return styleOf(this); }
  set style(v) {
    if (typeof v === 'string') { st(this).style = new CSSStyleDeclaration(this); st(this).style.cssText = v; }
  }
  get classList() {
    const el = this;
    if (!st(el).classListObj) {
      const api = {
        add(...cs) { cs.forEach((c) => st(el).classListSet.add(c)); syncClass(el); },
        remove(...cs) { cs.forEach((c) => st(el).classListSet.delete(c)); syncClass(el); },
        contains(c) { return st(el).classListSet.has(c); },
        toggle(c, f) {
          const has = st(el).classListSet.has(c);
          const want = f === undefined ? !has : !!f;
          if (want) st(el).classListSet.add(c); else st(el).classListSet.delete(c);
          syncClass(el);
          return want;
        },
        replace(a, b) { if (!st(el).classListSet.has(a)) return false; st(el).classListSet.delete(a); st(el).classListSet.add(b); syncClass(el); return true; },
        item(i) { return Array.from(st(el).classListSet)[i] || null; },
        forEach(fn, that) { Array.from(st(el).classListSet).forEach((c) => fn.call(that, c, c, api)); },
        get length() { return st(el).classListSet.size; },
        get value() { return Array.from(st(el).classListSet).join(' '); },
        toString() { return Array.from(st(el).classListSet).join(' '); },
        [Symbol.iterator]() { return Array.from(st(el).classListSet)[Symbol.iterator](); },
      };
      for (const m of ['add', 'remove', 'contains', 'toggle', 'replace', 'item', 'forEach']) nativeLike(api[m], m);
      st(el).classListObj = api;
    }
    return st(el).classListObj;
  }
  get dataset() {
    const el = this;
    const target = st(el).datasetObj || (st(el).datasetObj = {});
    return new Proxy(target, {
      get(t, k) {
        if (typeof k === 'symbol') return t[k];
        return el.getAttribute('data-' + kebab(k)) || undefined;
      },
      set(t, k, v) { el.setAttribute('data-' + kebab(k), v); return true; },
      has(t, k) { return el.hasAttribute('data-' + kebab(k)); },
      deleteProperty(t, k) { el.removeAttribute('data-' + kebab(k)); return true; },
      ownKeys() {
        return Object.keys(st(el).attrs).filter((a) => a.startsWith('data-'))
          .map((a) => a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
      },
      getOwnPropertyDescriptor(t, k) {
        const v = el.getAttribute('data-' + kebab(k));
        if (v === null) return undefined;
        return { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
  }
  getAttribute(name) {
    const v = st(this).attrs[String(name).toLowerCase()];
    return v === undefined ? null : v;
  }
  setAttribute(name, v) {
    const n = String(name).toLowerCase();
    st(this).attrs[n] = String(v);
    if (n === 'class') {
      st(this).classListSet = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    if (n === 'style') st(this).style = null;
    if (n === 'width' && this.tagName === 'CANVAS') this.width = parseInt(v, 10) || 0;
    if (n === 'height' && this.tagName === 'CANVAS') this.height = parseInt(v, 10) || 0;
  }
  removeAttribute(name) {
    const n = String(name).toLowerCase();
    delete st(this).attrs[n];
    if (n === 'class') st(this).classListSet = new Set();
  }
  hasAttribute(name) { return st(this).attrs[String(name).toLowerCase()] !== undefined; }
  hasAttributes() { return Object.keys(st(this).attrs).length > 0; }
  getAttributeNames() { return Object.keys(st(this).attrs); }
  toggleAttribute(n, f) {
    const has = this.hasAttribute(n);
    const want = f === undefined ? !has : !!f;
    if (want) this.setAttribute(n, ''); else this.removeAttribute(n);
    return want;
  }
  getAttributeNode(n) {
    const v = this.getAttribute(n);
    return v === null ? null : { name: n, value: v, specified: true, ownerElement: this };
  }
  get elements() { return st(this).childNodes.filter((c) => c.nodeType === ELEMENT_NODE); }
  get children() { return st(this).childNodes.filter((c) => c.nodeType === ELEMENT_NODE); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get nextElementSibling() {
    const p = st(this).parentNode;
    if (!p) return null;
    const kids = st(p).childNodes.filter((c) => c.nodeType === ELEMENT_NODE);
    const i = kids.indexOf(this);
    return i >= 0 ? kids[i + 1] || null : null;
  }
  get previousElementSibling() {
    const p = st(this).parentNode;
    if (!p) return null;
    const kids = st(p).childNodes.filter((c) => c.nodeType === ELEMENT_NODE);
    const i = kids.indexOf(this);
    return i > 0 ? kids[i - 1] : null;
  }
  get innerHTML() {
    return st(this).childNodes.map((c) => __serialize(c)).join('');
  }
  set innerHTML(html) {
    for (const c of st(this).childNodes.slice()) this.removeChild(c);
    const nodes = __parseHtml(String(html), __document);
    for (const n of nodes) this.appendChild(n);
  }
  get outerHTML() { return __serialize(this); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  insertAdjacentHTML(pos, html) {
    const nodes = __parseHtml(String(html), __document);
    const p = String(pos).toLowerCase();
    if (p === 'beforeend') { for (const n of nodes) this.appendChild(n); return; }
    if (p === 'afterbegin') { const ref = st(this).childNodes[0] || null; for (const n of nodes) this.insertBefore(n, ref); return; }
    if (p === 'beforebegin' && st(this).parentNode) { for (const n of nodes) st(this).parentNode.insertBefore(n, this); return; }
    if (p === 'afterend' && st(this).parentNode) {
      const nx = this.nextSibling;
      for (const n of nodes) st(this).parentNode.insertBefore(n, nx);
    }
  }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? __document.createTextNode(n) : n); }
  prepend(...nodes) { const ref = st(this).childNodes[0] || null; for (const n of nodes) this.insertBefore(typeof n === 'string' ? __document.createTextNode(n) : n, ref); }
  remove() { if (st(this).parentNode) st(this).parentNode.removeChild(this); }
  before(...nodes) { const p = st(this).parentNode; if (!p) return; for (const n of nodes) p.insertBefore(typeof n === 'string' ? __document.createTextNode(n) : n, this); }
  after(...nodes) { const p = st(this).parentNode; if (!p) return; const nx = this.nextSibling; for (const n of nodes) p.insertBefore(typeof n === 'string' ? __document.createTextNode(n) : n, nx); }
  replaceWith(...nodes) {
    const p = st(this).parentNode; if (!p) return;
    const nx = this.nextSibling;
    for (const n of nodes) p.insertBefore(typeof n === 'string' ? __document.createTextNode(n) : n, this);
    p.removeChild(this);
  }
  matches(sel) { return __match(this, sel); }
  webkitMatchesSelector(sel) { return __match(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === ELEMENT_NODE) { if (__match(n, sel)) return n; n = st(n).parentNode; } return null; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const groups = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (c.nodeType !== ELEMENT_NODE) continue;
        for (const g of groups) if (__match(c, g)) { out.push(c); break; }
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getElementsByTagName(tag) {
    const t = String(tag).toUpperCase();
    const out = [];
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (c.nodeType !== ELEMENT_NODE) continue;
        if (t === '*' || st(c).tagName === t) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getElementsByClassName(cls) {
    const want = String(cls).split(/\s+/).filter(Boolean);
    const out = [];
    const walk = (n) => {
      for (const c of st(n).childNodes) {
        if (c.nodeType !== ELEMENT_NODE) continue;
        if (want.every((w) => st(c).classListSet.has(w))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  getBoundingClientRect() { __slowCost('rect'); return __rect(this); }
  getClientRects() { return [__rect(this)]; }
  get clientWidth() { __slowCost('client'); return __box(this).cw; }
  get clientHeight() { __slowCost('client'); return __box(this).ch; }
  get clientTop() { return 0; }
  get clientLeft() { return 0; }
  get scrollWidth() { return __box(this).cw; }
  get scrollHeight() { return __box(this).ch; }
  get scrollTop() { return 0; }
  set scrollTop(v) {}
  get scrollLeft() { return 0; }
  set scrollLeft(v) {}
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  attachShadow() { return __document.createElement('div'); }
  get shadowRoot() { return null; }
  get slot() { return ''; }
  animate() { return { finished: Promise.resolve(), cancel() {}, play() {}, pause() {} }; }
  getAnimations() { return []; }
}
Object.defineProperty(Element.prototype, Symbol.toStringTag, { value: 'Element', configurable: true });

class HTMLElement extends Element {
  get offsetWidth() { __slowCost('offset'); const b = __box(this); return b.ow; }
  get offsetHeight() { __slowCost('offset'); const b = __box(this); return b.oh; }
  get offsetLeft() { return __offset(this).left; }
  get offsetTop() { return __offset(this).top; }
  get offsetParent() {
    if (isHidden(this)) return null;
    if (this === __document.body || this === __document.documentElement) return null;
    if (styleOf(this).position === 'fixed') return null;
    return __document.body || __document.documentElement;
  }
  click() { this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: __window })); }
  focus() { if (__document.activeElement !== this) { const prev = __document.activeElement; __document.__setActive(this); if (prev) prev.dispatchEvent(new Event('blur')); this.dispatchEvent(new Event('focus')); } }
  blur() { if (__document.activeElement === this) { __document.__setActive(null); this.dispatchEvent(new Event('blur')); } }
  get tabIndex() { return parseInt(this.getAttribute('tabindex') || '0', 10) || 0; }
  set tabIndex(v) { this.setAttribute('tabindex', v); }
  get draggable() { return this.getAttribute('draggable') === 'true'; }
  set draggable(v) { this.setAttribute('draggable', v); }
  get isContentEditable() { return false; }
  get contentEditable() { return 'inherit'; }
  set contentEditable(v) {}
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get lang() { return this.getAttribute('lang') || ''; }
  set lang(v) { this.setAttribute('lang', v); }
  get dir() { return this.getAttribute('dir') || ''; }
  set dir(v) { this.setAttribute('dir', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get accessKey() { return this.getAttribute('accesskey') || ''; }
  get offsetParentNode() { return this.offsetParent; }
}
Object.defineProperty(HTMLElement.prototype, Symbol.toStringTag, { value: 'HTMLElement', configurable: true });

// ---- 布局计算（真实盒模型近似）----
const __boxCache = new WeakMap();
function __box(el) {
  const cached = __boxCache.get(el);
  if (cached && cached.stamp === __layoutStamp) return cached;
  const r = __computeBox(el);
  __boxCache.set(el, Object.assign({ stamp: __layoutStamp }, r));
  return r;
}
let __layoutStamp = 1;

// ── 可选：模拟 Blink binding 层的访问成本 ──
// 纯 JS 对象属性访问约 0.05μs，而 Chrome 的 offsetWidth 要走 layout 查询、
// getComputedStyle 要走样式解析，单次 5~50μs。reese84 会把整段采集耗时当指纹上传，
// 快一个数量级本身就是破绽。
// 用 --slow-dom <μs> 给这些高频 getter 加真实自旋，让采集墙钟自然拉到真机量级。
function __slowCost(name) {
  const us = __CFG.slowDom;
  if (!us) return;
  const per = (typeof us === 'object' ? (us[name] || 0) : us);
  if (per > 0) __HOST__.busy(per);
}

function __computeBox(el) {
  const zero = { cw: 0, ch: 0, ow: 0, oh: 0 };
  if (isHidden(el)) return zero;
  const tag = st(el).tagName ? st(el).tagName.toLowerCase() : '';
  const su = styleOf(el);

  // 宽度
  let w = stylePx(el, 'width');
  if (w === null) {
    if (tag === 'body' || tag === 'html') w = __window.innerWidth;
    else if (BLOCK_TAGS.has(tag)) w = __parentContentWidth(el);
    else w = 0;
  }
  // 高度
  let h = stylePx(el, 'height');
  if (h === null) {
    if (tag === 'body' || tag === 'html') h = __window.innerHeight;
    else if (tag === 'canvas') h = el.height || 150;
    else if (tag === 'img') h = 0;
    else if (BLOCK_TAGS.has(tag)) {
      // 有文本内容 → 行盒高度（行高约 17px）；纯子块 → 累加
      //
      // ★ 这里绝不能用 trim() 判断有无内容：
      //   reese84 的广告拦截检测会造一个诱饵 div（innerHTML = '&nbsp;'），
      //   然后看 offsetHeight 是否为 0 来判定"装了 adblock"。
      //   而 String.prototype.trim() 会把 \u00a0 也当成空白裁掉 →
      //   我们把诱饵算成高度 0 → sensor 认为环境装了 adblock → 直接跳过后续采集，
      //   对外表现就是"payload 少了 30%、canvas 一次没调过、performance 主体段只有 25μs"。
      const raw = el.textContent || '';
      let acc = 0;
      const kids = st(el).childNodes.filter((c) => c.nodeType === ELEMENT_NODE);
      for (const k of kids) acc += __box(k).oh;
      if (raw.length > 0) acc = Math.max(acc, 17 * Math.max(1, Math.ceil(raw.length / 60)));
      h = acc;
      if (tag === 'li') h = Math.max(h, 17);
      if (/^h[1-6]$/.test(tag)) h = Math.max(h, 22);
      // 有子元素但没算出高度时给一个最小可见高度，避免"内容存在却高 0"
      if (h === 0 && kids.length > 0) h = 17;
    } else {
      h = 0;
    }
  }
  if (tag === 'canvas' && stylePx(el, 'width') === null) w = el.width || 300;
  const ow = w, oh = h;
  return { cw: w, ch: h, ow, oh };
}
function __parentContentWidth(el) {
  let p = st(el).parentNode;
  while (p && p.nodeType === ELEMENT_NODE) {
    const pw = stylePx(p, 'width');
    if (pw !== null) return pw;
    if (st(p).tagName === 'BODY' || st(p).tagName === 'HTML') return __window.innerWidth;
    p = st(p).parentNode;
  }
  return __window.innerWidth;
}
function __offset(el) {
  let left = stylePx(el, 'left') || 0;
  let top = stylePx(el, 'top') || 0;
  let p = st(el).parentNode;
  while (p && p.nodeType === ELEMENT_NODE) {
    left += stylePx(p, 'left') || 0;
    top += stylePx(p, 'top') || 0;
    p = st(p).parentNode;
  }
  return { left: Math.round(left), top: Math.round(top) };
}
function __rect(el) {
  const b = __box(el);
  const o = __offset(el);
  const w = b.ow, h = b.oh;
  return {
    x: o.left, y: o.top, width: w, height: h,
    top: o.top, right: o.left + w, bottom: o.top + h, left: o.left,
    toJSON() { return { x: o.left, y: o.top, width: w, height: h, top: o.top, right: o.left + w, bottom: o.top + h, left: o.left }; },
  };
}

// ---- 选择器匹配（够用即可）----
function __match(el, sel) {
  sel = String(sel).trim();
  if (!sel) return false;
  if (el.nodeType !== ELEMENT_NODE) return false;
  const tag = st(el).tagName.toLowerCase();
  // 组合选择器简单处理：tag#id.class或[attr]
  const re = /^([a-z0-9*-]*)((?:[#.\[][^#.\[]+)*)$/i;
  const m = re.exec(sel.replace(/\s*>\s*/g, ' '));
  if (!m) {
    // 后代/子代选择器
    const parts = sel.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (!__match(el, last)) return false;
      let p = st(el).parentNode;
      const rest = parts.slice(0, -1).reverse();
      for (const want of rest) {
        let found = false;
        while (p && p.nodeType === ELEMENT_NODE) {
          if (__match(p, want)) { found = true; p = st(p).parentNode; break; }
          p = st(p).parentNode;
        }
        if (!found) return false;
      }
      return true;
    }
    return false;
  }
  const t = m[1];
  if (t && t !== '*' && t !== tag) return false;
  const mods = m[2] || '';
  const tokenRe = /([#.\[][^#.\[]+)/g;
  let tok;
  while ((tok = tokenRe.exec(mods))) {
    const s = tok[1];
    if (s[0] === '#') { if (st(el).attrs.id !== s.slice(1)) return false; }
    else if (s[0] === '.') { if (!st(el).classListSet.has(s.slice(1))) return false; }
    else if (s[0] === '[') {
      const inner = s.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq > 0) {
        const k = inner.slice(0, eq).trim();
        const v = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (st(el).attrs[k] !== v) return false;
      } else if (!(inner.trim() in st(el).attrs)) return false;
    }
  }
  return true;
}

// ---- HTML 序列化 / 解析（极小实现）----
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
function __serialize(n) {
  if (n.nodeType === TEXT_NODE) return st(n).data || '';
  if (n.nodeType === COMMENT_NODE) return '<!--' + (st(n).data || '') + '-->';
  const tag = st(n).tagName.toLowerCase();
  let out = '<' + tag;
  for (const [k, v] of Object.entries(st(n).attrs || {})) out += ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"';
  out += '>';
  if (VOID_TAGS.has(tag)) return out;
  out += n.innerHTML;
  return out + '</' + tag + '>';
}
function __parseHtml(html, doc) {
  // 极简：只处理文本 + 单层/嵌套标签，够 sensor 的 innerHTML 用
  const out = [];
  const stack = [{ node: null, children: out }];
  const re = /<!---->|<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [raw, tag, attrs, text] = m;
    if (text !== undefined) {
      if (text) stack[stack.length - 1].children.push(doc.createTextNode(text));
      continue;
    }
    if (raw.startsWith('<!--')) continue;
    if (raw.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = doc.createElement(tag);
    if (attrs) {
      const are = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = are.exec(attrs))) {
        el.setAttribute(a[1], a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '');
      }
    }
    stack[stack.length - 1].children.push(el);
    if (!VOID_TAGS.has(String(tag).toLowerCase()) && !raw.endsWith('/>')) {
      stack.push({ node: el, children: st(el).childNodes });
    }
  }
  return out;
}

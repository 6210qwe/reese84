/**
 * 04-net.js —— XMLHttpRequest / fetch / Headers / Response
 *
 * 关键：所有真实请求都由宿主用 curl 发出，不用 Node 的 https。
 * 原因：Imperva 在边缘读 TLS 指纹（JA3/JA4）。实测同一出口 IP 下
 *   curl                  → 正常
 *   Python urllib         → 被拦（6183 字节 Pardon Our Interruption）
 *   urllib + 全套 Chrome 头 → 仍被拦（证明与 header 无关，是 TLS 栈）
 * 所以这里把请求委托给宿主 curl，Node 只负责跑 JS。这是 web-js-env-patcher
 * 硬规则 15「XHR/fetch 必须走同一 TLS Session」的落地方式。
 */

'use strict';

// ══════════════════════════════════════════════════════════════════
// Headers
// ══════════════════════════════════════════════════════════════════

class Headers {
  constructor(init) {
    st(this).map = new Map();
    if (init) {
      if (init instanceof Headers) { for (const [k, v] of init.entries()) this.append(k, v); }
      else if (Array.isArray(init)) { for (const [k, v] of init) this.append(k, v); }
      else for (const k of Object.keys(init)) this.append(k, init[k]);
    }
  }
  append(k, v) {
    const key = String(k).toLowerCase();
    const old = st(this).map.get(key);
    st(this).map.set(key, old === undefined ? String(v) : old + ', ' + String(v));
  }
  set(k, v) { st(this).map.set(String(k).toLowerCase(), String(v)); }
  get(k) { const v = st(this).map.get(String(k).toLowerCase()); return v === undefined ? null : v; }
  has(k) { return st(this).map.has(String(k).toLowerCase()); }
  delete(k) { st(this).map.delete(String(k).toLowerCase()); }
  forEach(fn, that) { for (const [k, v] of st(this).map) fn.call(that, v, k, this); }
  entries() { return st(this).map.entries(); }
  keys() { return st(this).map.keys(); }
  values() { return st(this).map.values(); }
  [Symbol.iterator]() { return st(this).map.entries(); }
  getSetCookie() { return []; }
}
Object.defineProperty(Headers.prototype, Symbol.toStringTag, { value: 'Headers', configurable: true });

// ══════════════════════════════════════════════════════════════════
// XMLHttpRequest
// ══════════════════════════════════════════════════════════════════

const XHR_UNSENT = 0, XHR_OPENED = 1, XHR_HEADERS_RECEIVED = 2, XHR_LOADING = 3, XHR_DONE = 4;

class XMLHttpRequest extends EventTarget {
  constructor() {
    super();
    const s = st(this);
    s.readyState = XHR_UNSENT;
    s.status = 0;
    s.statusText = '';
    s.responseText = '';
    s.response = null;
    s.responseType = '';
    s.responseURL = '';
    s.timeout = 0;
    s.withCredentials = false;
    s.upload = new EventTarget();
    s.upload.addEventListener = EventTarget.prototype.addEventListener.bind(s.upload);
    s.reqHeaders = {};
    s.method = 'GET';
    s.url = '';
    s.sent = false;
    s.aborted = false;
  }
  get readyState() { return st(this).readyState; }
  get status() { return st(this).status; }
  get statusText() { return st(this).statusText; }
  get responseText() { return st(this).responseText; }
  get response() {
    const s = st(this);
    if (s.responseType === '' || s.responseType === 'text') return s.responseText;
    return s.response;
  }
  get responseXML() { return null; }
  get responseURL() { return st(this).responseURL; }
  get responseType() { return st(this).responseType; }
  set responseType(v) { st(this).responseType = String(v); }
  get timeout() { return st(this).timeout; }
  set timeout(v) { st(this).timeout = Number(v) || 0; }
  get withCredentials() { return st(this).withCredentials; }
  set withCredentials(v) { st(this).withCredentials = !!v; }
  get upload() { return st(this).upload; }
  get UNITS() { return 0; }
  open(method, url, async, user, pass) {
    const s = st(this);
    s.method = String(method || 'GET').toUpperCase();
    try { s.url = new URL(String(url), __document.baseURI).href; } catch (e) { s.url = String(url); }
    s.async = async === undefined ? true : !!async;
    s.sent = false;
    s.aborted = false;
    this.__setReadyState(XHR_OPENED);
  }
  setRequestHeader(k, v) { st(this).reqHeaders[String(k)] = String(v); }
  getResponseHeader(k) {
    const h = st(this).respHeaders || {};
    const key = Object.keys(h).find((x) => x.toLowerCase() === String(k).toLowerCase());
    return key ? h[key] : null;
  }
  getAllResponseHeaders() {
    const h = st(this).respHeaders || {};
    return Object.keys(h).map((k) => k + ': ' + h[k]).join('\r\n');
  }
  overrideMimeType() {}
  abort() {
    st(this).aborted = true;
    this.__setReadyState(XHR_DONE);
    this.dispatchEvent(new ProgressEvent('abort'));
  }
  __setReadyState(n) {
    st(this).readyState = n;
    if (this.onreadystatechange) {
      try { this.onreadystatechange.call(this, new Event('readystatechange')); } catch (e) {}
    }
    this.dispatchEvent(new Event('readystatechange'));
  }
  send(body) {
    const s = st(this);
    if (s.sent) throw new DOMException('The object has already been used.', 'InvalidStateError');
    s.sent = true;
    const headers = Object.assign({}, s.reqHeaders);
    let payload = null;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') payload = body;
      else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        payload = Buffer.from(body.buffer || body, body.byteOffset || 0, body.byteLength || undefined);
      } else payload = String(body);
    }
    const self = this;
    __HOST__.httpRequest({
      method: s.method,
      url: s.url,
      headers,
      body: payload,
      timeout: s.timeout || 40000,
    }, function (err, res) {
      if (st(self).aborted) return;
      if (err) {
        st(self).status = 0;
        st(self).statusText = '';
        self.__setReadyState(XHR_DONE);
        self.dispatchEvent(new ProgressEvent('error'));
        self.dispatchEvent(new ProgressEvent('loadend'));
        return;
      }
      st(self).status = res.status;
      st(self).statusText = res.statusText || '';
      st(self).respHeaders = res.headers || {};
      st(self).responseURL = res.url || st(self).url;
      st(self).responseText = res.text || '';
      self.__setReadyState(XHR_HEADERS_RECEIVED);
      self.__setReadyState(XHR_LOADING);
      const rt = st(self).responseType;
      if (rt === 'json') {
        try { st(self).response = JSON.parse(st(self).responseText); } catch (e) { st(self).response = null; }
      } else if (rt === 'arraybuffer') {
        st(self).response = Buffer.from(st(self).responseText, 'utf8').buffer;
      } else {
        st(self).response = st(self).responseText;
      }
      self.__setReadyState(XHR_DONE);
      self.dispatchEvent(new ProgressEvent('load', { lengthComputable: true, loaded: st(self).responseText.length, total: st(self).responseText.length }));
      self.dispatchEvent(new ProgressEvent('loadend'));
    });
    if (st(this).upload) {
      try { st(this).upload.dispatchEvent(new ProgressEvent('loadstart')); } catch (e) {}
    }
  }
}
for (const [k, v] of Object.entries({ UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 })) {
  defValue(XMLHttpRequest.prototype, k, v, true);
  defValue(XMLHttpRequest, k, v, true);
}
Object.defineProperty(XMLHttpRequest.prototype, Symbol.toStringTag, { value: 'XMLHttpRequest', configurable: true });
installOnHandlers(XMLHttpRequest.prototype, ['readystatechange', 'load', 'error', 'abort', 'timeout', 'loadend', 'loadstart', 'progress']);

// ══════════════════════════════════════════════════════════════════
// Response / fetch
// ══════════════════════════════════════════════════════════════════

class Response {
  constructor(body, init) {
    init = init || {};
    st(this).bodyText = body === undefined || body === null ? '' : String(body);
    st(this).status = init.status === undefined ? 200 : init.status;
    st(this).statusText = init.statusText || '';
    st(this).headers = new Headers(init.headers);
    st(this).url = init.url || '';
    st(this).redirected = !!init.redirected;
    st(this).type = init.type || 'basic';
    st(this).used = false;
  }
  get status() { return st(this).status; }
  get statusText() { return st(this).statusText; }
  get ok() { const s = st(this).status; return s >= 200 && s <= 299; }
  get headers() { return st(this).headers; }
  get url() { return st(this).url; }
  get redirected() { return st(this).redirected; }
  get type() { return st(this).type; }
  get bodyUsed() { return st(this).used; }
  get body() { return null; }
  clone() { return new Response(st(this).bodyText, { status: this.status, statusText: this.statusText, headers: st(this).headers, url: this.url }); }
  text() { st(this).used = true; return Promise.resolve(st(this).bodyText); }
  json() {
    st(this).used = true;
    try { return Promise.resolve(JSON.parse(st(this).bodyText)); } catch (e) { return Promise.reject(e); }
  }
  arrayBuffer() {
    st(this).used = true;
    const b = Buffer.from(st(this).bodyText, 'utf8');
    return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  }
  blob() { st(this).used = true; return Promise.resolve(new Blob([st(this).bodyText])); }
  formData() { return Promise.reject(new Error('not supported')); }
}
Object.defineProperty(Response.prototype, Symbol.toStringTag, { value: 'Response', configurable: true });

class Request {
  constructor(input, init) {
    init = init || {};
    st(this).url = typeof input === 'string' ? new URL(input, __document.baseURI).href : String(input && input.url || input);
    st(this).method = String(init.method || 'GET').toUpperCase();
    st(this).headers = new Headers(init.headers);
    st(this).body = init.body;
    st(this).credentials = init.credentials || 'same-origin';
    st(this).mode = init.mode || 'cors';
    st(this).cache = init.cache || 'default';
    st(this).redirect = init.redirect || 'follow';
    st(this).referrer = init.referrer || 'about:client';
    st(this).keepalive = !!init.keepalive;
    st(this).signal = init.signal || null;
  }
  get url() { return st(this).url; }
  get method() { return st(this).method; }
  get headers() { return st(this).headers; }
  get body() { return st(this).body; }
  get credentials() { return st(this).credentials; }
  get mode() { return st(this).mode; }
  get cache() { return st(this).cache; }
  get redirect() { return st(this).redirect; }
  get referrer() { return st(this).referrer; }
  get keepalive() { return st(this).keepalive; }
  get signal() { return st(this).signal; }
  clone() { return new Request(st(this).url, { method: st(this).method, headers: st(this).headers, body: st(this).body }); }
  text() { return Promise.resolve(String(st(this).body === undefined ? '' : st(this).body)); }
  json() { try { return Promise.resolve(JSON.parse(String(st(this).body))); } catch (e) { return Promise.reject(e); } }
  arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }
}
Object.defineProperty(Request.prototype, Symbol.toStringTag, { value: 'Request', configurable: true });

function __fetch(input, init) {
  init = init || {};
  let url, method, headers, body;
  if (typeof input === 'string') { url = input; }
  else if (input && input.url) { url = input.url; }
  else url = String(input);

  try { url = new URL(url, __document.baseURI).href; } catch (e) {}

  method = String((init.method || (input && input.method) || 'GET')).toUpperCase();

  const h = {};
  const rawH = init.headers || (input && input.headers);
  if (rawH) {
    if (rawH instanceof Headers) { for (const [k, v] of rawH.entries()) h[k] = v; }
    else if (Array.isArray(rawH)) { for (const [k, v] of rawH) h[k] = v; }
    else for (const k of Object.keys(rawH)) h[k] = rawH[k];
  }

  body = init.body !== undefined ? init.body : (input && input.body);
  let payload = null;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') payload = body;
    else if (Buffer.isBuffer(body)) payload = body;
    else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) payload = Buffer.from(body.buffer || body);
    else if (body && typeof body === 'object' && body.__urlencoded) payload = body.value;
    else payload = String(body);
  }

  return new Promise((resolve, reject) => {
    __HOST__.httpRequest({ method, url, headers: h, body: payload, timeout: 40000, credentials: init.credentials }, (err, res) => {
      if (err) { reject(new TypeError('Failed to fetch')); return; }
      resolve(new Response(res.text || '', {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        url: res.url || url,
      }));
    });
  });
}

class URLSearchParamsShim extends URLSearchParams {}

// ══════════════════════════════════════════════════════════════════
// 其余网络相关构造器
// ══════════════════════════════════════════════════════════════════

class AbortSignalShim extends EventTarget {
  constructor() { super(); st(this).aborted = false; }
  get aborted() { return st(this).aborted; }
  get reason() { return undefined; }
  throwIfAborted() {}
  static abort() { const s = new AbortSignalShim(); st(s).aborted = true; return s; }
  static timeout(ms) { return new AbortSignalShim(); }
}
class AbortControllerShim {
  constructor() { this.signal = new AbortSignalShim(); }
  abort() { st(this.signal).aborted = true; this.signal.dispatchEvent(new Event('abort')); }
}
class FormDataShim {
  constructor() { st(this).map = new Map(); }
  append(k, v) { const key = String(k); const a = st(this).map.get(key) || []; a.push(v); st(this).map.set(key, a); }
  set(k, v) { st(this).map.set(String(k), [v]); }
  get(k) { const a = st(this).map.get(String(k)); return a ? a[0] : null; }
  getAll(k) { return st(this).map.get(String(k)) || []; }
  has(k) { return st(this).map.has(String(k)); }
  delete(k) { st(this).map.delete(String(k)); }
  entries() {
    const out = [];
    for (const [k, arr] of st(this).map) for (const v of arr) out.push([k, v]);
    return out[Symbol.iterator]();
  }
  [Symbol.iterator]() { return this.entries(); }
  forEach(fn) { for (const [k, v] of this.entries()) fn(v, k, this); }
}
class WebSocketShim extends EventTarget {
  constructor(url) {
    super();
    st(this).url = String(url);
    st(this).readyState = 0;
    __setTimeout(() => {
      st(this).readyState = 3;
      this.dispatchEvent(new Event('error'));
      this.dispatchEvent(new Event('close'));
    }, 0);
  }
  get url() { return st(this).url; }
  get readyState() { return st(this).readyState; }
  get bufferedAmount() { return 0; }
  get protocol() { return ''; }
  get extensions() { return ''; }
  send() {}
  close() { st(this).readyState = 3; }
}
for (const [k, v] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
  defValue(WebSocketShim, k, v, true);
  defValue(WebSocketShim.prototype, k, v, true);
}
class EventSourceShim extends EventTarget {
  constructor(url) { super(); st(this).url = String(url); st(this).readyState = 0; }
  close() { st(this).readyState = 2; }
}
class FileReaderShim extends EventTarget {
  constructor() { super(); st(this).result = null; st(this).readyState = 0; }
  get result() { return st(this).result; }
  get readyState() { return st(this).readyState; }
  get error() { return null; }
  readAsText(b) {
    const self = this;
    __setTimeout(() => { st(self).result = String(b); st(self).readyState = 2; self.dispatchEvent(new Event('load')); self.dispatchEvent(new Event('loadend')); }, 0);
  }
  readAsDataURL(b) {
    const self = this;
    __setTimeout(() => { st(self).result = 'data:;base64,'; st(self).readyState = 2; self.dispatchEvent(new Event('load')); }, 0);
  }
  readAsArrayBuffer(b) { this.readAsText(b); }
  abort() {}
}
class OffscreenCanvasShim {
  constructor(w, h) { st(this).w = w; st(this).h = h; st(this).cv = __document.createElement('canvas'); st(this).cv.width = w; st(this).cv.height = h; }
  get width() { return st(this).w; }
  set width(v) { st(this).w = v; st(this).cv.width = v; }
  get height() { return st(this).h; }
  set height(v) { st(this).h = v; st(this).cv.height = v; }
  getContext(t) { return st(this).cv.getContext(t); }
  transferToImageBitmap() { return {}; }
  convertToBlob() { return Promise.resolve(new Blob([])); }
}

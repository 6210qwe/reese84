# 2026-10-18 新发现：`toString` / 原型链泄漏（已修）

> 这是本轮**唯一抓到的、可直接归因的假环境特征**。
> 修完之后**页面执行时间从 54 秒降到 2.6 秒**（17 倍），说明之前有分支在慢路径上跑。
> 但仍然没通过回放 —— 所以它是「必要的修复」，不是「充分的条件」。

---

## 1. 怎么发现的

来源：scrapebadger 的 2026 实测报告里有一句很关键的话：

> **The 12 Function.prototype.toString calls matter most here.
> Two of them targeted Window and eval, which is what a native-code integrity check looks like.**

也就是说 sensor 有 12 处调用 `Function.prototype.toString`，**其中两处专门查 `Window` 和 `eval`**。

于是我写了一个探针 `tools/probe_tostring.js` 逐项打表，结果：

| 检测项 | 我们（修复前） | 浏览器 |
|---|---|---|
| `Window.toString()` | `function () { [native code] }` | `function Window() { [native code] }` |
| `window.constructor.toString()` | `function () { [native code] }` | `function Window() { [native code] }` |
| `Navigator.toString()` | **`class Navigator extends EventTarget { ... }` 整段源码** | `function Navigator() { [native code] }` |
| `Document` / `Element` / `HTMLElement` / `EventTarget` / `XMLHttpRequest` / `HTMLCanvasElement` / `CanvasRenderingContext2D` / `WebGLRenderingContext` / `AudioContext` / `Performance` / `Screen` / `Location` / `History` / `Storage` / `MutationObserver` / `Image` / `Blob` … | **全部泄漏 `class X extends Y {`** | 全部 `[native code]` |
| `eval.toString()` | ✅ `function eval() { [native code] }` | 同 |
| `eval.toString().length` | ✅ 33 | 33 |

**二十多个构造器全部泄漏源码。** 这是我这套补环境从第一版就带着的洞。

---

## 2. 为什么之前没发现

因为我只给"方法"做了 `nativeLike` 包装（`defMethod` 里调了），
但 **`class X extends Y { ... }` 这种类声明本身的 `toString` 从来没处理过**。

而 `nativeLike` 是个 `WeakSet` 标记 + 自定义 `toString`，
只有**显式传进去的函数**才会被标记 —— class 声明语句不会被自动标记。

---

## 3. 修法

### 3.1 `nativeClass()` —— 批量伪装

```js
function nativeClass(cls, name) {
  const nm = name || cls.name || '';
  __nativeFns.add(cls);
  __fnNames.set(cls, nm);          // 决定 toString 里打印的名字
  // 顺带把 prototype 上的每个方法/getter/setter 也标 native
  for (const k of Object.getOwnPropertyNames(cls.prototype)) {
    if (k === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(cls.prototype, k);
    if (typeof d.value === 'function') { __nativeFns.add(d.value); __fnNames.set(d.value, k); }
    if (typeof d.get === 'function') { __nativeFns.add(d.get); __fnNames.set(d.get, 'get ' + k); }
    if (typeof d.set === 'function') { __nativeFns.add(d.set); __fnNames.set(d.set, 'set ' + k); }
  }
  return cls;
}
```

然后在 `__installWindow()` 末尾批量登记 80+ 个标准构造器：

```js
const __STANDARD_CTORS = [
  'Window', 'Navigator', 'Document', 'Node', 'Element', 'HTMLElement', 'EventTarget',
  'HTMLCanvasElement', 'CanvasRenderingContext2D', 'WebGLRenderingContext',
  'AudioContext', 'Performance', 'Screen', 'Location', 'History', 'Storage',
  /* …… 80+ 项，见 03-window.js */
];
for (const n of __STANDARD_CTORS) if (typeof w[n] === 'function') nativeClass(w[n], n);
```

### 3.2 `window.constructor` 必须指向 `Window`

```js
Object.defineProperty(w, 'Window', { value: Window, configurable: true });
Object.defineProperty(w, 'constructor', { value: Window, configurable: true });
```

之前 `window.constructor` 走的是 `Object.prototype.constructor`，打印出 `function () { [native code] }`（无名）。

### 3.3 `__hardenPrototypeChain()` —— 原型链自检

依据 52pojie《某航司 Reese84 逆向分析-补环境篇》（2025-09-24）列的 22 个采集函数清单：

- **函数二十**：查 `Function.prototype.toString` / `call` / `apply` / `bind` 的 **toString**
- **函数二十一**：查 `window.performance.now()` / `window.Object.getPrototypeOf()` 的属性
- 另外作者特别提到"第一次见"的一条：
  **`window["Object"]["getOwnPropertyNames"]` 必须只返回 `['length', 'name']`**

实现：

```js
function __hardenPrototypeChain() {
  // ① Function.prototype 上的 toString/call/apply/bind 本身也要是 native
  for (const m of ['toString', 'call', 'apply', 'bind']) { /* 标 native */ }

  // ② getOwnPropertyNames(函数) 只返回 length / name / prototype
  const __origGOPN = Object.getOwnPropertyNames;
  const __nativeGOPN = function getOwnPropertyNames(obj) {
    const r = __origGOPN(obj);
    if (typeof obj === 'function') {
      return r.filter((k) => k === 'length' || k === 'name' || k === 'prototype');
    }
    return r;
  };
  Object.defineProperty(Object, 'getOwnPropertyNames', { value: __nativeGOPN, configurable: true });
}
```

> 为什么保留 `prototype`：普通函数确实有 `prototype` 自有属性，
> 全裁掉反而不像。而 `arguments` / `caller` 在 Chrome 的严格模式函数上是不可枚举的访问器，
> `getOwnPropertyNames` 不应返回它们。

---

## 4. 修完的效果

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `Window.toString()` | `function () { [native code] }` | ✅ `function Window() { [native code] }` |
| `window.constructor.toString()` | `function () { [native code] }` | ✅ `function Window() { [native code] }` |
| 20+ 构造器 | 全部泄漏 `class X extends Y` | ✅ 全部 `[native code]` |
| **页面执行时间** | **54.3 秒** | ✅ **2.6 秒** |
| payload 长度 | 23924~32816 | 32684~32688 |
| `performance.total` | 484~921 | 663~894 |
| 回放结果 | ❌ B12 | ❌ B12（**未变**） |

### 关于 54s → 2.6s

这个提速很可能是：之前 sensor 在某个检测失败后走了**慢路径 / 重试分支**，
现在检测通过，走直路。

但**回放仍然被拒**，说明：
- `toString` 泄漏是**真实存在的假环境特征**（必须修）
- 但它**不是** B12 的唯一原因

---

## 5. 顺带纠正一个误判

我一度以为 `Object.keys(window).length` 应该是 **9000+**（来源是 bottingrocks 的 `___utmvc`
指纹样例里写着 `"Object.keys(window).length" : 9163`）。

用 CDP 在真实 Edge 实测：

```json
{"keysLen": 224, "ownNamesLen": 984, "forInLen": 230}
```

⇒ **真实的 `Object.keys(window).length` 是 224**，我们 208，差 16 个，属于正常范围。

**那个 9163 是别的上下文/旧版本的值，不要照抄。**
这类数字必须实测，不能从别人文章里抄 —— 抄了反而制造矛盾。

---

## 6. 这条经验的可复用形态

> **补环境里所有 `class X extends Y` 都必须过一遍 `nativeClass()`。**
> 只包装"方法"是不够的，类声明本身会整段泄漏源码。
>
> 检查方法：写个探针，遍历 `window` 上所有 `typeof v === 'function'` 的项，
> 打印 `Function.prototype.toString.call(v)`，凡是出现 `class ` 或 `=>` 的都是洞。

这个探针已经做成 `node-env/tools/probe_tostring.js`，接新站先跑一遍。

# GitHub 知名 reese84 / Incapsula 项目实测评估

> 逐个 clone / 下载源码看过，标注**能用到什么程度**。
> 结论：**没有一个能直接拿来跑通 airgreenland**，但有 3 个的方法必须吸收。

---

## 汇总表

| # | 项目 | Stars | 最后更新 | 类型 | 对我们有用吗 |
|---|---|---|---|---|---|
| 1 | `PZz0203/Incapsula` | 0 | 2022-11 | **AST 提取编码函数** + 生成器 | ⭐⭐⭐ 方法论极有价值，代码过时 |
| 2 | `parmodrana/incapsula_reese84` | 7 | 2023-12 | 同上（fork + 加了 AST 样本） | ⭐⭐ 可看 AST 产物 |
| 3 | `Hyper-Solutions/hyper-sdk-js` | 53 | 2026-07 | 商业 API SDK | ⭐⭐ 只能看接口形状 |
| 4 | `Hyper-Solutions/hyper-sdk-go` | 67 | 2026-07 | 同上（Go） | ⭐⭐ 同上 |
| 5 | `EllAchE/hyper-sdk-js` | — | 2026 | 同上（镜像） | — |
| 6 | `ZairKSM/IncapsulaReverse` | — | — | 老版本机制分析文档 | ⭐ 历史参考 |
| 7 | `HanZzzzz000/iv8` | 668 | 活跃 | Python 原生 V8 + C++ 浏览器环境 | ⭐⭐⭐ **唯一实测能通过的** |

---

## 1. PZz0203/Incapsula —— 最值得读的一个

**仓库结构**（88 文件）：

```
incapsula/
├── ast.js                           Babel AST 加载/生成
├── payloads/
│   ├── reese84.js                   payload 编解码封装
│   ├── reese84_dummy_mouse_touch.js 鼠标/触摸伪造
│   └── utmvc.js                     ___utmvc 生成器
└── reese84/
    ├── finders.js      (83 KB) ★ 用 AST 找编码函数/时间戳属性/stringify/btoa
    ├── finders2.js
    ├── extract.js      (57 KB) ★ 把找到的节点抽成独立模块
    ├── deob.js         反混淆入口
    ├── deobfuscate?    string-array 还原
    └── decode-payload.js  ★ decodePayload(p, cr)
```

### 核心用法（读源码得到）

```js
const ast = fromFile(reese84File);      // 把 837KB sensor 解析成 AST
Reese84.deobfuscate(ast);                // 反混淆（string-array 轮转 + RC4）
const reese84 = new Reese84(ast);        // 挂上提取出来的编码函数
const plain = reese84.decodePayload(p, cr);   // ★ cr 就是解码密钥
```

**`finders.js` 的几个关键函数名**（可以直接借鉴思路）：

| 函数 | 作用 |
|---|---|
| `findFirstStringifyForward` / `findFirstStringifyBackwards` | 定位 `JSON.stringify` 调用点 |
| `findFirstBtoaBackwards` / `findFirstBtoaForward` | **定位 `btoa` = payload 出口**（与我们"钩 btoa 打栈"同一个思路） |
| `findTimestampProperty({path, index})` | **定位 `st` 时间戳属性**（直接告诉你怎么改 st） |
| `getKeyFromDeclaration` / `findInVar` / `findInAssignment` | 反查变量定义与赋值 |

### 该仓库给出的最重要事实

> **"each reload produces a different encoding function"**
> （每次重载都会产生不同的编码函数）

⇒ 纯算路线**不可能维护**，因为编码函数每次重载都换。
⇒ 这个仓库的价值不在"能用"，而在**它证明了纯算路线的经济性不成立**，
以及**给出了"用 AST 自动提取编码函数"的工程范式**。

### 为什么不能直接用

- 最后提交 2022-11，sensor 结构已经大改（当时还没 JSVMP 化到现在这个程度）
- 依赖 `@babel/*`，且 finders 是靠**特征字符串**定位的，sensor 一改就失效
- 没有处理 JSVMP 字节码层

**可以借鉴的三点**（已吸收进 skill）：

1. **AST 定位 `btoa` 调用点** = 找 payload 出口
2. **AST 定位 `st` 时间戳属性** = 找时间字段写入点
3. **`decodePayload(p, cr)`** = `cr` 是解码密钥，可用于**验证我们自己生成的 payload 是否正确**

---

## 2. parmodrana/incapsula_reese84

PZz0203 的 fork（2023-12 更新），95 文件。多出来的东西：

- `_obfuscated-reese84.js` —— 2023-12 的 sensor 快照（可用来对比版本演进）
- `_rawpayloads.txt` —— **原始 payload 样本**（可用于验证解码器）
- `ast1701403228285.js` / `ast1701403272331.js` / `ast1701403682209.js` —— **反混淆后的 AST 产物**

**价值**：如果你要做纯算，这三个 AST 样本 + 原始 payload 是**唯一的公开对照集**。
可以拿它验证"我的解码器实现对不对"。

**对我们的用法**：不作主路线，但可以在"想验证 payload 结构"时当测试向量。

---

## 3. Hyper-Solutions/hyper-sdk-js / hyper-sdk-go

商业 SDK（要 API key，按量计费）。**没有算法，是远端服务**。

但它的**接口形状**极有参考价值：

```ts
// Incapsula
generateReese84Sensor(session, new Reese84Input(...))
generateUtmvcCookie(session, new UtmvcInput(...))
parseDynamicReeseScript(htmlContent, baseUrl)   // → { sensorPath, scriptPath }
parseUtmvcScriptPath(scriptContent)
getSessionIds(cookies)                          // 从 cookie 里挑出 session 相关项
isSessionCookie(cookie)
```

Go 版签名更直白，暴露了**最小入参**：

```go
session.GenerateReese84Sensor(ctx, site, userAgent)   // ★ 只要 site + UA
```

⇒ **服务端只需要 `site` + `userAgent` 就能生成 payload**，
说明**UA 是唯一需要外部指定的强绑定维度**（其余全靠服务端托管的指纹库）。

⇒ 对我们的启示：**`baseline.json` 的 UA 一旦定下就不能改**，
否则 `navigator.userAgent` / `appVersion` / `userAgentData.brands` / WebGL 字符串 / HTTP 头
五处必须同步（我们在 `docs/03` 坑 12 已经踩过）。

**它是怎么实现的（从文档反推）**：

- 维护一个**真实设备指纹库**（不是每次现场采）
- 用**当前 build 的编码器**（服务端自己定期从各站点抓 sensor 并提取）
- 所以它能做到"给 site + UA 就出 payload"

⇒ **这正是"通杀框架"应该有的架构**：
`指纹库（采一次复用） + 编码器（按 build 滚动提取） + 协议层（不变）`。

---

## 4. ZairKSM/IncapsulaReverse

纯文档项目，分析的是**已过时的 Incapsula 版本**（作者自己声明 "obsolete versions"）。

有用的是它的**方法论清单**：

- 用 Babel AST 简化混淆 → `traverse(AST, extract_site_key)` / `traverse(AST, fingerprint_fns)`
- 在 Jest + 自定义 mock 里跑脚本，精确观察 payload 生成
- 明确列出检测面：canvas 指纹、audio/video 能力、Chrome 特有功能、插件检测

**结论**：只作历史参考，不影响当前方案。

---

## 5. HanZzzzz000/iv8 —— 唯一实测通过的

不是 reese84 专用项目，但是**通用"跑原始 JS"运行时**（Python 原生 V8 + C++ 浏览器环境）。

**为什么它能过而我们手写的不能**：

| 维度 | iv8 | 我们的 Node 手写 |
|---|---|---|
| 环境实现层 | **C++ 层**（Blink 同级） | JS 层（V8 里跑 JS 对象） |
| 属性访问开销 | 与浏览器同级 | **快一个数量级** |
| `toString` 原生性 | 天然 `[native code]` | 要逐个伪装（我们有 20+ 个漏了，2026-10 才发现） |
| 虚拟时钟 | 内建（`eventLoop.sleep`） | 无（同步 eval 一次跑完） |
| trace 泄漏 | 无（`<anonymous>:10:43`） | 有（磁盘路径） |

**结论**：iv8 能过不是"运气"，是**结构上少了这两个数量级的差异**。

---

## 6. 实测：这些项目能不能跑通 airgreenland？

| 项目 | 尝试结果 |
|---|---|
| PZz0203/Incapsula | ❌ 跑不起来（2022 依赖 + sensor 结构已变），但 `finders.js` 的定位思路可用 |
| parmodrana fork | ❌ 同上（AST 样本可作测试向量） |
| hyper-sdk-js/go | ❌ 需付费 API key，且是远端服务，不是本地实现 |
| ZairKSM | ❌ 纯文档 |
| **iv8** | ✅ **实测通过**（`/api/` → 404、`/` → 302 → 198987B 真实首页） |

---

## 7. 从这些项目里"我原来没想到"的四点

1. **`cr` 是解码密钥**（PZz0203）
   → 可以用来**验证我们自己生成的 payload 是否能被正确解码**，
   这是一个独立的正确性判据，比"服务端给不给 token"更早、更细。

2. **编码函数"每次重载都变"**（PZz0203）
   → 彻底否定了纯算路线的可行性，也解释了为什么 iv8 能一直用。

3. **`Object.getOwnPropertyNames(函数)` 必须只返回 `['length','name']`**（52pojie 2025-09）
   → 这是我们完全没实现的检测点，已补（见 `docs/08`）。

4. **`GenerateReese84Sensor(site, userAgent)` 只要两个入参**（Hyper Solutions）
   → 说明"指纹 + 编码器"是服务端托管的固定资产，UA 是唯一外部绑定维度。
   → 通杀框架应该按这个架构设计：**指纹库存一份、编码器按 build 滚动、UA 固定**。

---

## 8. 结论

- **不要指望任何一个开源项目能直接跑通具体站点**：它们要么过时、要么是付费服务、要么只能解密不能生成。
- **能立刻用的只有 iv8**。
- **要吸收的是四个方法论**：AST 定位出口 / `cr` 做解码验证 / getOwnPropertyNames 检测 / 指纹库+编码器分离架构。

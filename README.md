# reese84 —— Imperva / Incapsula 反爬令牌的两种解法（实测记录）

> 📦 **本仓库的最终形态是一套「风控参数通杀流水线」**，reese84 只是它跑通的第一个案例。
> 已固化为 skill：`~/.workbuddy/skills/js-antibot-pipeline/`（给一个 URL → 自动识别厂商 → 定位接口 → 选路线 → 门禁验证）
>
> 靶站：`https://book.airgreenland.com/`（Air Greenland 订票域，Imperva 边缘，reese84 sensor，dynamic 变体，未开 PoW）
> 实测环境：Windows 11 / Node 22 / Python 3.13 / Edge 154
> 结论先行：**iv8 路线 100% 通过；纯 Node 手写补环境能拿到服务端签发的 token，但回放不被信任**

---

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/01` | 全网资料检索结论（逐条标注"对本站成不成立"） |
| `docs/02` | `performance` 时序之谜：11 个被排除的假设 + **时间源已定位到 `Date.now`** |
| `docs/03` | 12 条静默失败坑逐条复现与修复（**8 条跨站通用**） |
| `docs/04` | 方法论总结（8 条） |
| `docs/05` | **reese84 版本演进时间线（2022→2026）** —— 哪些变了、哪些没变 |
| `docs/06` | **GitHub 知名项目实测评估**（7 个，逐个跑过） |
| `docs/07` | 本地资料库 `D://BaiduNetdiskDownload//JS补环境专属资料` 评估 |
| `docs/08` | **`toString`/原型链泄漏修复** —— 本项目抓到的最大假环境特征 |
| `docs/09` | **通杀框架**：三层结构 + 跨站验证 + 固定动作 |
| `docs/10` | 通杀 skill 原文 |
| `docs/11` | **`X-Iinfo` 判读手册** —— 三方对照实测，`B10`=挑战页 / `B12`=拦截 / 无B+有CT=放行 |
| `docs/12` | **文献综述（~100 条）+ 打假清单** —— 语料里约 40% 是错的 |

## 一、两条路线的真实结果

| 路线 | payload `p` | token | 回放 | 状态 |
|---|---|---|---|---|
| **iv8**（Python 原生 V8） | 27912 ~ 34282 | 1306~1358 | `/api/`→**404**、`/`→**302→198987B 真实首页** | ✅ **通过** |
| Node 手写补环境 | 23924 ~ 32816 | 1262~1322 | `X-Iinfo: B12`，200 + iframe 拦截页 | ❌ 被拒 |
| jsdom 补环境 | 19832 | 1178 | 被拒 | ❌ 被拒 |

同一个出口 IP、同一时段。**这排除了 IP 被封、站点改版、token 过期这类干扰**，
剩下的差异只可能来自载荷本身（或网络栈）。

### 关键对照：不是网络层的问题

iv8 全程用 `curl` 发请求（Python 侧），一样通过。所以：

- 不是 TLS 指纹问题（Imperva 边缘读 JA3/JA4 这个说法，对本站不成立或不是决定性因素）
- 不是 cookie 组装问题（同一套 cookie 罐逻辑）
- **是载荷本身不够"像真机"**

---

## 二、链路坐标（这一节回答"从哪儿下手"）

| 项 | 值 |
|---|---|
| 受保护主机 | `book.airgreenland.com`（**不是** `www`；www 是 Azure 静态站，不校验） |
| 挑战页 | 任意路径（如 `/api/`），返回 **6058 字节** HTML，**HTTP 200 不是 403** |
| sensor | `/<随机目录>/<40位hex>?s=<8位>`，约 **837 KB**，单文件无 sourcemap |
| 提交接口 | **同一路径** + `?d=book.airgreenland.com`，POST，`Content-Type: text/plain; charset=utf-8` |
| body 结构 | `{solution:{interrogation:{p,st,sr,cr,og},version},old_token,error,errors,performance}` |
| 响应 | `{"token":"3:...","renewInSec":790~890,"cookieDomain":"book.airgreenland.com"}` |

### 反直觉的一条：想拿挑战页必须"裸头"

本站按**请求意图**分流，同一个出口 IP：

| 请求头 | 结果 |
|---|---|
| `UA` + `Accept: */*` | **200 挑战页**（唯一入口） |
| 上面再加 `Accept-Language` | **404 放行**，不挑战 |
| 上面再加 `Accept-Encoding` | **404 放行**，不挑战 |
| `Accept: text/html` | **404 放行**，不挑战 |

⇒ **curl 里千万别无脑加 `--compressed`**，它会带出 `Accept-Encoding`，直接让挑战页变 404。
这一条踩过两次，第二次还是因为忘了。

---

## 三、Node 手写补环境：做了什么

`node-env/` 是从零写的浏览器环境（不用 jsdom），约 4500 行：

```
node-env/
├── src/
│   ├── env/01-core.js     Node/Element/HTMLElement/Document/布局/CSSOM/选择器/HTML 解析
│   ├── env/02-media.js    canvas（真实 Skia）+ WebGL + AudioContext（离线渲染）
│   ├── env/03-window.js   Window/Navigator/Screen/Location/Performance/Storage/定时器
│   ├── env/04-net.js      XHR/fetch/Headers/Response/WebSocket
│   ├── env/05-page.js     页面生命周期（挑战页装配 + 脚本执行顺序）
│   ├── bridge.js          宿主桥接：curl 网络 / Skia canvas / cookie 罐 / 时钟
│   └── runner.js          主流程：取挑战页→取 sensor→跑→拿 token→业务验证
└── tools/
    ├── sample_fp.js        CDP 从真实 Edge 采样指纹基线 → baseline.json
    ├── probe_fp_env.js     补环境 vs 真实浏览器 逐项对照打表
    ├── probe_generic_fonts.js  查 sans-serif/serif 实际命中的字体
    └── browser_solve.js    真实浏览器求解 + curl 回放对照
```

### 为什么不用 jsdom

| 检测点 | jsdom | 影响 |
|---|---|---|
| `navigator.userAgent` 含 `jsdom/30.1.3` | ❌ | 与 HTTP 头声明的 UA 矛盾，直接判死 |
| canvas 是假实现：300 次 `measureText` 只用 **0.26 μs** | ❌ | 真实 Chrome 是 **7317 μs**，差 28000 倍 |
| `offsetWidth` / `getBoundingClientRect` 全 **0** | ❌ | 触发 reese84 的广告拦截检测 |

`web-js-env-patcher` 硬规则 14 直接写明：**AI 猜值、随机值、mock、jsdom、node-canvas、headless-gl 不能作为最终回放值**。

### canvas 用真实 Skia

`@napi-rs/canvas`（Skia 后端，纯 npm 预编译，走镜像可装）。
`canvas`（node-canvas）在国内拉不到 GitHub 的 prebuild，`prebuild-install` 会卡死，别浪费时间。

---

## 四、十二条静默失败坑（真正的可复用部分）

每一条都表现为**没有异常、没有日志、拿不到 token**，排查成本极高。按踩到的顺序：

| # | 坑 | 现象 | 修法 |
|---|---|---|---|
| 1 | curl 加了 `--compressed` | 挑战页变 404 / 9 字节 | 裸头，不带 `Accept-Encoding` |
| 2 | sensor 残包 | VM 静默不初始化 | `len>700000` 且结尾 `return a1_0xdc94();}`，重下最多 4 次 |
| 3 | `window` 用独立对象冒充 | 裸访问 `navigator` 直接 ReferenceError | `const w = globalThis`，装上 EventTarget 三件套 |
| 4 | 内联脚本用直接 eval | `const isSpa` 跨脚本不可见 | `(0,eval)(code)`；且 URL/URLSearchParams/fetch/XHR 必须挂在 window 上 |
| 5 | `documentElement.innerHTML` 装配页面 | `Unable to find a challenge script with 'src' attribute` | 解析后显式重绑 documentElement/head/body |
| 6 | `appendChild` 和 `insertBefore` 都挂钩 | sensor 被执行两次 | 只挂 `insertBefore`（`appendChild` 内部就调它） |
| 7 | iframe 不派发 `load` | VM 卡在等 load | 插入后 `setTimeout(dispatch load, 20)` |
| 8 | **`__installCtx2D`/`__installGL` 定义了忘记调用** | payload 32K→20K、canvas 后端 0 次、服务端 **400 空 body** | 文件末尾真的调用它们 |
| 9 | `&nbsp;` 被 `trim()` 吃掉 | 诱饵 div 高 0 → 判定 adblock → 跳过采集 | 用 `textContent.length>0`，**不要 trim** |
| 10 | `setPrototypeOf(globalThis, Window.prototype)` | 页面执行 58s→99s，服务端 **408 Timeout** | 默认关闭 |
| 11 | `performance.now()` 全精度 | 500 次调用 500 个唯一值（Chrome 只有约 4 个） | 量化到 0.1ms |
| 12 | 硬件值靠猜 | 与真实机器矛盾 | 全部走 `baseline.json` 回放 |

### 第 5 条值得单独说

`innerHTML` 会重建子树，但 `document.head` 仍指向**被替换掉的旧节点**。
于是 `document.head.appendChild(script)` 挂到了一个游离节点上，
sensor 随后在自己的 document 里找不到那个 `<script src>` —— 报
`Unable to find a challenge script with 'src' attribute`，且**不抛异常**，只静默退出。

### 第 9 条是最阴的

reese84 的广告拦截检测会造一个 `innerHTML = '&nbsp;'` 的诱饵 div，读 `offsetHeight`：

```js
'\u00a0'.trim() === ''   // true！
```

所以我们把诱饵高度算成 0 → sensor 认为"这个环境装了 adblock" → **整段指纹采集被跳过**。
外部表现极具迷惑性：payload 少 30%、`performance.total` 只有几百微秒、服务端 400。

---

## 五、卡点：`performance` 计时（已定位到时间源，但比例修不了）

> **2026-10-18 补充**：已确认 `performance` 的三个数字 **100% 来自 `Date.now()` 差值**
> （`--date-scale 12` → 三数同步放大；`--perf-scale 12` → 三数纹丝不动）。
> 并可用 `--clock-jump 6500` 把 `total` 精确调到 **7118**（真机 7083 / iv8 6570），落进 band。
>
> 但 `phase1` 压不下来：我们的 `total = phase1 + 28μs`，iv8 是 `total - phase1 = 6524μs`。
> phase1 的计时窗口覆盖整个同步采集期，任何时刻做时钟跳变都会落进它里面。
> ⇒ **在"同步一次性采集"的执行模型下，这两个数字无法同时对上。**
> 详见 `docs/02-性能计时之谜.md` §6。

### 以下是第一轮的排查记录（保留作为过程）

这是目前唯一还没解释的硬差异，也是本仓库最有价值的负面结论。

### 5.1 现象

payload 里 `performance` 字段（同一时段对照）：

| 方案 | `performance["1030820235"]` | `["4203433130"]` | `total` |
|---|---|---|---|
| iv8（通过） | 46 | 1 | **7442** |
| 真实浏览器 | 46 | 1 | **7083** |
| 本方案（被拒） | 459~678 | 0~2 | **484~710** |

### 5.2 排查过程（都做了什么，排除了什么）

在 iv8 里插桩（`iv8/probe_iv8_perf.py`）拿到基准后，逐步排除了所有时间源：

| 假设 | 实验 | 结论 |
|---|---|---|
| `total` = `performance.now()` 跨度 | iv8: now 被调 **8008 次**、跨度 6534ms、total 6570（数值接近） | 像，但… |
| 缩放 `now()` 返回值（虚拟时钟 13x） | total **纹丝不动**（575→558） | ❌ 不来自 now |
| 给 `now()` 加真实自旋（200~1500μs/次） | total 不变，且调用次数从 78 掉到 12 | ❌ 不是耗时问题 |
| `performance.timing.navigationStart` | 只读了这一个字段；把它提前 60 秒，total **不变**（549→546） | ❌ 不来自 timing |
| `getEntriesByType('navigation')` | iv8 返回 **空数组**，我们也空 | ❌ 双方都不用 |
| `performance.mark/measure` | iv8 **一次都没调用** | ❌ 不是 User Timing |
| `Date.now()` / `new Date()` | 调用次数很少（21 次量级） | ❌ 覆盖不了 |

### 5.3 当前判断（诚实版：还没破）

- iv8 的 `total=7442` 与它的采集墙钟（6000~7000ms）同量级；
  我们的 `total≈500` 与我们的采集墙钟（470~620ms）也同量级。
- **所以 `total` 极可能确实是"整段采集的真实耗时"，只是算法用了我们还没探到的时间源。**
- 而 12 倍的差距来自一个**物理事实**：
  **纯 JS 的 DOM 属性访问比 Blink 的 binding 层快一个数量级。**
  iv8 走 C++ 绑定层（慢，接近真机），我们走 JS 对象属性（快，露馅）。
- crawlex 的分析与之一致：
  > "It measures how long the collection took... Real browsers on real hardware produce collection timings
  > within a band; an environment where probes are intercepted... produces timings outside it.
  > **The timing object is cheap to collect and expensive to forge convincingly, because forging it well
  > requires knowing the band the server expects, which the server does not advertise.**"

### 5.4 可能的下一步（给后来者）

1. **按"虚拟时钟"正确实现**：不是缩放 `now()` 返回值（已证无效），
   而是在 **VM 的全局时间源**上做统一偏移/缩放 —— 需要先确切知道它读哪个时间源。
   最快的定位法：把 `window` 上所有能返回时间的东西（`Date`、`performance.*`、`Event.timeStamp`、
   `requestAnimationFrame` 回调参数、`performance.now` 的 bind 副本）**同时**加上可识别偏移（比如各加不同的量），
   跑一次看 `total` 变了多少 —— 哪个偏移让它变了，它就用哪个。
2. **让环境访问真实变慢**：给高频 DOM getter（`offsetWidth`/`getBoundingClientRect`/`getComputedStyle`/
   `navigator.*`）加固定微秒成本，把采集墙钟拉到 6~7 秒。代价是总耗时上升（可能撞 10 秒兜底）。
3. **换执行层**：CSDN 那篇《reese84风控绕过》选择了 Rust 自研 JS 引擎 + 底层重建浏览器环境，
   把"原生性"和"时钟一致性"一起解决 —— 说明这个问题在纯 JS 层确实不好解。

---

## 六、经验教训（方法论层面）

1. **先扫本地 skill，再动手。**
   本次最大的浪费是重复踩了 `iv8-env/references/reese84-imperva.md` 里已经写下的坑
   （`--compressed`、残包、`page.load` 重置 window）。

2. **"不报错"不等于"成功"。**
   本仓库列出的 12 个坑全部是静默失败。判断成功必须用**服务端可观测的证据**：
   `/api/` 返回 404 且不含拦截特征 —— 而不是"我拿到了一个 1306 字符的字符串"。

3. **先分清"签发"和"信任"两步。**
   Imperva 会先照常签发 token（HTTP 200），再在回放时按信任分判死。
   只看"有没有 token"会得出完全错误的结论——我们的 payload 比浏览器还大，照样被拒。

4. **对照实验 > 翻混淆代码。**
   决定性的三个结论都来自对照：
   - 用 iv8 的旧 body POST → **200**；用我们的 body → **400** ⇒ 是载荷不是请求
   - iv8 同时段通过 ⇒ 不是 IP / 不是改版
   - iv8 的 `performance` 数值 ⇒ 知道 band 在哪

5. **插桩要插在"能通过的实现"里。**
   在自己的失败环境里猜服务端要什么，永远是猜。去 iv8 里插 `performance`，
   一次就拿到了 `total=6570` / `now 8008 次` 这个基准。

6. **别在猜黑盒上无限投入。**
   `total` 的公式我排除了 7 个假设仍未破。这时候正确做法是**停下、记录、换路线**，
   而不是继续加实验。iv8 已经能用，工程上先用它。

7. **指纹值必须采样，不能猜。**
   实测本机：`hardwareConcurrency=16`（我猜了 8）、`screen=1366x768`（我猜了 1536x864）、
   `deviceMemory=undefined`（Chrome 141 已不暴露，写 8 反而是破绽）、
   WebGL renderer 的精确字符串（少一个型号 id 就是自造指纹）。

8. **一致性比"补全"更重要。**
   `sans-serif` 在本机 Edge 实际解析成 `Noto Sans SC`（用 CDP 的 `CSS.getPlatformFontsForNode` 查到的权威答案），
   同一字体 Chrome 10px 量得 101.03、Skia 量得 96.43。
   显式族名（Arial / Times New Roman）两边**完全一致**，只有 generic 族不一致 —— 这类矛盾是可被交叉校验的。

---

## 七、快速开始

### iv8（推荐，实测可用）

```bash
pip install iv8
cd iv8
python -X utf8 solve_iv8.py            # 解 + 校验 + 抓真实首页
python -X utf8 solve_iv8.py --no-page  # 只要 token
python -X utf8 probe_iv8_perf.py       # 在能通过的环境里插桩 performance（拿基准用）
```

判成功：
```
[5] 校验  status=404 len=9 拦截特征=[]   ✅ 通过
[6] 302 book → 200 www  198987 字节
```

### Node 手写补环境

```bash
cd node-env
npm i ws @napi-rs/canvas --registry=https://registry.npmmirror.com
node tools/sample_fp.js          # ① 从真实 Edge 采样基线 → src/env/baseline.json
node tools/probe_fp_env.js       # ② 逐项对照，先把这个表刷绿
node src/runner.js --json ./_result.json   # ③ 求解 + 业务验证
```

调试开关：`-v` / `--trace-ctx` / `--trace-timing` / `--trace-stack` / `--fresh` / `--challenge-only`

⚠ 第 ② 步不能跳。第 ③ 步的失败几乎都不报错，只会表现成"token 拿到了但被拦"。

---

## 八、合规

仅用于授权范围内的安全测试与防护评估。本文记录的是对公开网页前端机制的工程分析。
法律依据：《刑法》285、286 条。**不要用于绕过登录、验证码、MFA 或访问控制。**

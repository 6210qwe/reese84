---
name: js-antibot-pipeline
description: 风控参数通杀流水线：给一个网站，自动识别防护厂商、定位参数接口、选路线、执行、门禁验证、沉淀经验。覆盖 reese84/Imperva、瑞数、Cloudflare 5s盾、Akamai、Kasada、DataDome 等。Use when 用户给一个受保护站点要求拿到 cookie/签名参数（如 reese84、sensor_data、cf_clearance、$_ts、x-kpsdk-ct），或要求判断某站用什么防护、为什么补环境过不去、怎么把已有方案复用到新站。触发词：通杀、补环境框架、自动定位参数、风控绕过、reese84、Imperva、Incapsula、瑞数、5s盾、Akamai、逆向我该怎么开始。
---

# 风控参数通杀流水线

> 目标：**从"给一个 URL"到"能稳定取数"，并把过程沉淀成可复用的判据。**
> 本 skill 只做**跑原始 JS / 补环境**路线；不碰 JSVMP 字节码还原（另见 `jsvmp-algo-restore`）。

---

## 0. 三条铁律（违反必然返工）

1. **先跑原始 JS，永远不要追编码层。**
   reese84 的编码函数**每次重载都变**（PZz0203 实测结论）。
   纯算 = 每次重建；补环境 = 一次建成长期用。

2. **"不报错" ≠ "成功"；"拿到 token" ≠ "通过"。**
   Imperva 会照常签发 token（HTTP 200），再在回放时按信任分判死。
   唯一判据：**带 token 打受保护路径，不含任何拦截特征**。

3. **指纹值必须实测采样，不能猜。**
   实测过的反例：`hardwareConcurrency` 猜 8（本机 16）、`screen` 猜 1536×864（本机 1366×768）、
   `deviceMemory` 写了 8（Chrome 141 已不暴露，写了反而是破绽）、
   `Object.keys(window).length` 抄了 9163（真实 224）。
   **抄别人的数字比不写更糟——它会制造矛盾。**

---

## 1. 入口：第一步永远是探测器

```bash
python -X utf8 <this-skill>/scripts/detect_protection.py https://target.com/
# 加 --deep 会额外下 sensor 看大小/完整性
# 加 --json out.json 落盘
```

它输出六段：基础响应 / 防护判定（带证据条数）/ 挑战页坐标 / **请求头模式探测** / sensor 详情 / 路线建议。

### 决策树

```text
detect_protection.py 的结果
├─ 未命中任何特征
│   └─ 该路径可能未受保护 → 换路径/换子域再试（很多站只有某个子域受保护）
├─ reese84 (Imperva)
│   ├─ 能裸头拿到 6058B 挑战页 → 走 §2
│   └─ 拿不到（一直 302/404）→ 已放行，直接采集
├─ 瑞数 → §5
├─ Cloudflare 5s盾 → §5
├─ Akamai / Kasada / DataDome → §5
└─ 自研/未识别 → §3「通用定位法」现场找
```

**⚠️ 靶点别选错**：先做子域枚举。实例：`www.airgreenland.com` 是 Azure 静态站**完全不校验**，
真正受保护的是 `book.airgreenland.com`。

---

## 2. reese84 专项流程（已验证的完整链路）

### 2.1 协议（这部分 2022→2026 没变，可以固化）

```
① GET  /<任意路径>                    裸头（UA + Accept:*/*）→ 6058B 挑战页
② GET  /<随机目录>/<40位hex>?s=<8位>    → ~837KB sensor
③ POST 同一路径 + ?d=<host>            Content-Type: text/plain; charset=utf-8
      body = {solution:{interrogation:{p,st,sr,cr,og},version},
              old_token, error, errors, performance}
④ 响应 {"token":"3:...","renewInSec":790~890,"cookieDomain":"..."}
⑤ Cookie: reese84=<token>  + 顺带下发的 incap_ses_* / visid_incap_* / nlbi_*
```

**字段语义（关键，来自 PZz0203 + CSDN m0_74325664）**：
- `p` = `base64("bin1" + 加密块)`；加密 = **xorshift128 字节重排**（不是压缩、不是 RC4）
- **`cr` 是解码密钥**（`decodePayload(p, cr)`）→ 可用它**验证自己生成的 payload 是否合法**
- `st` = 时间戳；`sr` = 与 JS 绑定的值
- 种子来源：`var SC = window["Math"]["random"]() * 1073741824 | 0;`
  ⇒ **`Math.random()` 会进指纹**，接管它就能控制编码结果

### 2.2 致命前置：请求头分流

本站按**请求意图**分流，**补全头反而拿不到挑战页**：

| 请求头 | 结果 |
|---|---|
| `UA` + `Accept: */*` | ✅ 200 挑战页 |
| 再加 `Accept-Language` | ❌ 302/404 放行 |
| 再加 `Accept-Encoding` | ❌ 302/404 放行 |
| 浏览器导航头（`Sec-Fetch-*` 等） | ❌ 302/404 放行 |

⇒ **curl 绝不能无脑加 `--compressed`**（它会带出 `Accept-Encoding`）。
这个坑我踩了两次，第二次是因为忘了第一次。

### 2.3 sensor 路径：按"目录"缓存，不要按完整路径

实测（本站 + 52pojie 同靶站案例）：

```
GET /<单词目录>/                → 200  842710B  text/javascript   ← 稳定，可用于缓存
GET /<单词目录>/<40位hex>?s=xx  → 200  838308B  text/javascript   ← hex 每次挑战都换
```

**单词目录不变，只有 40 位 hex 轮换。** 按完整路径缓存会每次失效，白白重下 837KB
（国际链路 60~90 秒）。正确做法：

```js
const dir = /^(\/[^/]+\/)/.exec(urlWithoutQuery)[1];   // 只取第一层目录做缓存 key
```

52pojie 还提到存在一条"固定链接"做**有效期查询/激活**（POST 上一轮 token，响应 token 不变，
`old_token` 可空）。本站验证：**GET 成立**（842710B），**POST 试了 4 种 body 全部 400**。
遇到别的站可以试这条路。

### 2.6 路线选择

| 路线 | 状态 | 用什么 |
|---|---|---|
| **iv8** | ✅ **实测通过** | `iv8/solve_iv8.py`，`/api/`→404、`/`→302→198987B 真实首页 |
| Node 手写补环境 | ⚠️ 能签发 token，回放被判 B12 | `node-env/src/runner.js` |
| 纯算 | ❌ 不建议 | 编码每次重载都变 |
| jsdom | ❌ 禁止 | UA 泄漏 + 假 canvas + 布局全 0 |

**先跑 iv8，跑通就收工。** 只有必须"纯 Node 单进程"时再碰补环境。

### 2.4 ★ 验证门禁：用 `X-Iinfo` 的 B 段，不要看 body（2026-10 实测校正）

**三方对照（同 IP 同时段，同一个 curl）**：

| 特征 | iv8 通过 | 我们被拦 | 挑战页 |
|---|---|---|---|
| HTTP | **404** len=9 / **302** | 200 len≈1038 | 200 len=6058 |
| **B 段** | **无** | **B12(14,0,0)** | B10(14,0,0) |
| `CT(...)` | **有** `CT(247 248 0)` | 无 | 无 |
| `q(...)` | **`q(0 0 5 -1)`** | `q(0 -1 -1 1)` | `q(0 -1 -1 -1)` |
| `r(...)` | **`r(7 7)`** | `r(1 -1)` | `r(0 -1)` |
| flag 组 | `NNNN` | **`PNNN`** | `NNNN` |
| `U` 段 | **`U11`** | `U18` | `U18` |

```python
passed  = (' CT(' in xinfo) and (' B1' not in xinfo) and not any(m in body for m in BLOCK_MARKS)
blocked = ('B12(' in xinfo) or ('B10(' in xinfo) or any(m in body for m in BLOCK_MARKS)
```

**这一条推翻了我以前所有的判据**：`token is not None` / `status==200` /
`"Pardon Our Interruption" not in body` / `B10 代表通过` —— **四个全错**。
B10 是挑战页（还没进去），B12 是明确拦截，**无 B + 有 CT 才是真放行**。

> `http.dev/x-iinfo` 说明这些字段 Imperva 不公开且会随版本变，所以只做粗判、保留原始串。

### 2.5 验证门禁（旧版，作为 body 层双保险保留）

```bash
# 带 token 打受保护路径，必须 404（源站真实 404）且不含任何拦截特征
curl -s -o /tmp/a.html -A "$UA" -H "Accept: */*" -b "$JAR" \
     "https://HOST/api/"
grep -c "Pardon Our Interruption\|_Incapsula_Resource\|Incapsula incident\|main-iframe" /tmp/a.html
# 必须输出 0
```

**拦截页有三种形态**，只判第一种会假成功：
1. `<title>Pardon Our Interruption</title>`（经典 403）
2. `<iframe id="main-iframe" src="/_Incapsula_Resource?...">` + `Incapsula incident ID`，**返回 200**
3. `scriptElement.src = "..."`（挑战页，6058B）

**`X-Iinfo` 的 B10 / B12 都不能当判据**（B12 也可能是拦）。

---

## 3. 通用定位法：任何自研签名都适用

### 3.1 一分钟定位出口（别翻混淆码）

按效率排序，**从 1 开始**：

| # | 方法 | 做法 | 见效 |
|---|---|---|---|
| 1 | **钩 base64 出口** | hook `btoa` / `CryptoJS.enc.Base64.stringify` / `btoa` 包装，`.length > 500` 就打栈 | ⭐⭐⭐ 秒级 |
| 2 | **钩网络出口** | hook `fetch` / `XHR.send` / `sendBeacon`，抓 body 长度与 URL | ⭐⭐⭐ 秒级 |
| 3 | **钩 cookie 写入** | `Object.defineProperty(document,'cookie',{set})` | ⭐⭐ |
| 4 | **钩 JSON.stringify** | 签名对象序列化几乎必走 | ⭐⭐ |
| 5 | **AST 定位** | 只在无法插桩时用（静态分析）；PZz0203 的 `finders.js` 就是这个思路 | ⭐ 慢 |

打栈示例（iv8 / 浏览器 / Node 都通用）：

```js
var _b = window.btoa;
window.btoa = function (s) {
  s = String(s);
  if (s.length > 500) console.log('[btoa] in=' + s.length + ' head=' + s.slice(0, 8) +
                                  '\n' + new Error().stack);
  return _b.apply(this, arguments);
};
```

### 3.2 必须输出四层坐标（否则等于没找到）

```
source  →  entry  →  builder  →  writer
数据源     加密入口    请求构造     请求写入
```

实例（reese84）：

| 层 | 对应 | 证据 |
|---|---|---|
| source | navigator / screen / canvas / WebGL / Audio / 字体 / DOM 几何 / 时间 | 22 个采集函数 |
| entry | `interrogate()` → SHA-1 → xorshift128 重排 → `btoa("bin1"+…)` | btoa 栈偏移 |
| builder | 组 `{solution:{interrogation:{p,st,sr,cr,og},version}, old_token, performance}` | body 结构 |
| writer | `fetch(PATH + "?d=" + host, {method:"POST", headers:{"Content-Type":"text/plain; charset=utf-8"}})` | fetch 钩子 |

**只有记录到 writer，才算真的找到"加密位置"。** 只报"疑似加密函数"不够。

---

## 4. 补环境：能过的唯一判据是"一致性"

> **浏览器能实现的，本地一定能实现。差别只在"环境访问的开销"与"对象形状"。**

### 4.1 五个维度，缺一不可

| 维度 | 含义 | 典型破绽 |
|---|---|---|
| **值** | 属性返回什么 | 猜的硬件值与其他值自相矛盾 |
| **形状** | `getOwnPropertyNames` / descriptor / 原型链 | `class X extends Y` 源码泄漏 |
| **原生性** | `toString` 是否 `[native code]` | 80+ 构造器全部泄漏源码 |
| **时序** | `Date.now` / `performance.now` / timer | 纯 JS 快一个数量级 |
| **顺序** | 属性被读取的次序 | 采集顺序与真机不同 |

### 4.2 必做清单（每条都实测踩过）

```text
□ 所有 class 过一遍 nativeClass()           → 否则 class X extends Y 整段泄漏
□ window.constructor === Window             → 否则打印无名函数
□ Function.prototype.toString/call/apply/bind 本身也要 native
□ getOwnPropertyNames(函数) 只返回 [length,name(,prototype)]
□ performance.now() 量化到 0.1ms            → 500 次调用只能有约 4 个不同值
□ 布局：offsetWidth/clientWidth/getBoundingClientRect 不能全 0
   否则触发 adblock 检测（诱饵 div 的 innerHTML 是 &nbsp;，
   '\u00a0'.trim() === '' → 千万别用 trim 判断"有无内容"）
□ iframe 插入后 setTimeout 派发 load（否则 VM 卡住）
□ 只挂 insertBefore，不要再挂 appendChild（它内部就调 insertBefore，会跑两次）
□ 页面装配不能用 documentElement.innerHTML（head/body 引用会失同步）
□ window 必须是 globalThis，不能是独立对象
```

### 4.3 时序（最容易忽略、也最难补）

**实测基准（同一靶站）**：

| 方案 | `performance.total` | 采集次数（measureText） |
|---|---|---|
| 真实浏览器 | 7083 | — |
| iv8 | 6570~7442 | 732 |
| Node 手写补环境 | 484~921 | 338 |

**已确认的核心结论**：`performance` 的三个数字 **100% 来自 `Date.now()` 差值**，
与 `performance.now()` 无关（缩放 `Date.now` → 三数同步变；缩放 `performance.now` → 纹丝不动）。

可用参数：
```bash
--clock-jump 6500    # total → 7118（精确落进 band）
--date-scale 12      # 三数一起放大
--timer-scale 20     # 定时器真实延迟/虚拟时间解耦
```

**仍修不了的**：`phase1` 与 `total` 的比例。
我们 `total = phase1 + 28μs`，iv8 是 `total - phase1 = 6524μs`。
phase1 窗口覆盖整个同步采集期，任何时刻跳变都会落进去。
⇒ **同步一次性采集模型下这两个数字无法同时对上。**
根因：真机/iv8 是**分阶段采集 + 每阶段真等待**，累积 6~8 秒。

### 4.4 如果补环境一直过不去

按这个顺序降级，**不要跳步**：

```
1. 先跑通"签发"（能拿到 token）           ← 结构正确性
2. 跑 probe_tostring.js 抓形状/原生性泄漏
3. 跑 probe_fp_env.js 抓值与真机的差异
4. 去能通过的实现（iv8/真浏览器）里插桩拿基准
5. 补环境仍不过 → 转⑧：换执行层（iv8 / 自研引擎 / 真实浏览器池）
```

---

## 5. 其他防护速查

| 厂商 | 特征 | 入口 | 路线 |
|---|---|---|---|
| **瑞数** | `$_ts`、`FSSBBIl1UgzbN7N*` cookie、外链路径随机 | 页面内联 VMP | iv8（瑞数5/6 都过）/ `ruishu-bypass` |
| **Cloudflare 5s盾** | `cf-browser-verification`、`cf_chl_opt`、`cf_clearance` | `jsd/main.js` | AST 解混淆 / 真实浏览器 / `cf_clearance` 池 |
| **Akamai** | `_abck`、`bm_sz`、`sensor_data` | `akam/*.js` | iv8 / 纯算（需 POST 两次） |
| **Kasada** | `x-kpsdk-ct`、`/ips.js` | WASM 参与 | 纯算 / iv8（较难） |
| **DataDome** | `datadome`、`captcha-delivery.com` | 常带滑块 | 真实浏览器 |

---

## 6. 故障矩阵（症状 → 判断 → 下一步）

| 症状 | 优先判断 | 下一步 |
|---|---|---|
| 拿不到挑战页，一直 302/404 | 请求头被识别成"正常导航" | 换裸头；去掉 `Accept-Encoding` / `Accept-Language` / `Sec-Fetch-*` |
| 挑战页拿到了，但 VM 完全不动、无异常 | sensor **残包** | 校验 `len>700000` 且结尾 `return a1_0xdc94();}`，重下最多 4 次 |
| VM 动了，但 POST body 是 `{"solution":null,"error":"..."}` | sensor 走了错误上报分支 | 看 `-v` 日志的第一条异常；多半是某个 API 缺失或抛错 |
| 服务端 **400 空 body** | payload 结构不合法 | 查 ctx 是不是空壳（`--trace-ctx`）+ adblock 诱饵高度是否为 0 |
| 服务端 **408 Timeout** | 页面执行太久，会话过期 | 查是否有 `setPrototypeOf(globalThis)` 之类的性能杀手 |
| 能签发 token，但回放被拒（B12） | 信任分不够 | 见 §4.3 时序；至少先修 `toString` / 原型链 |
| `performance.total` 只有几百 μs | 采集没真跑 | `--trace-ctx` 看 ctx 操作；`probe_tostring` 看形状 |
| `payload` 比浏览器小 30% | 少跑了采集分支 | 对比 iv8 的采集计数（measureText 732 是目标值） |
| 时间相关数字改不动 | 找错时间源 | **只缩放 `Date.now`**；加常数偏移无效（不影响差值） |
| `document.scripts` 里找不到自己的 script | `head`/`body` 引用失同步 | 别用 `documentElement.innerHTML` 装配页面 |
| 同一份代码换个站就不过 | 各站校验严格度不同 | 逐项对齐，别指望一套环境通吃所有站 |

### 排查纪律（借用本地资料的"回退原则"）

> 当复现中断或证据冲突时，**返回最早不确定的阶段**：
> `挑战页 → sensor 完整性 → DOM 装配 → 脚本执行 → ctx 形状 → 采集 → 编码 → 提交 → 回放`
>
> **一次只改一个变量，并保存修改前后的同轮证据。**

---

## 7. 交付物规范

```text
<项目>/
├── iv8/            已验证可用的求解器（首选交付）
├── node-env/       补环境实现（研究/备选）
│   ├── src/env/    01-core 02-media 03-window 04-net 05-page
│   ├── src/bridge.js
│   ├── src/runner.js
│   └── tools/      detect_protection / sample_fp / probe_fp_env / probe_tostring
└── docs/
    ├── 01 资料检索结论      02 时序之谜
    ├── 03 静默失败坑位清单   04 方法论
    ├── 05 版本演进时间线     06 GitHub 项目评估
    ├── 07 本地资料评估      08 形状泄漏修复
    └── 09 通杀框架（本 skill 的项目版）
```

**每次接新站的固定动作**：

```bash
python src/../tools/detect_protection.py <url> --deep --json case/<host>.json
node tools/sample_fp.js            # 采基线
node tools/probe_tostring.js       # 形状/原生性
node tools/probe_fp_env.js         # 值与真机差异
node src/runner.js -v              # 跑通
# 用门禁验证，再宣布成功
```

---

## 8. 合规

仅用于**授权范围内**的安全测试、防护评估与自有数据采集。
不得用于绕过登录、验证码、MFA 或访问控制；不得对未授权目标批量访问。
法律依据：《中华人民共和国刑法》第 285 条、第 286 条。

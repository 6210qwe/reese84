# node-env —— 纯 Node 手写补环境

不依赖 jsdom，从零实现浏览器环境，用 Skia 做真实 canvas 渲染。

## 现状（诚实标注）

- ✅ 能产出服务端**签发**的合法 token（HTTP 200，1270~1322 字符）
- ✅ payload 28048~32816（真实浏览器 28412，iv8 27912）
- ❌ **回放被拒**（`X-Iinfo: B12`，200 + iframe 拦截页）
- 卡点：`performance` 计时比真机快 12~14 倍，详见 `../docs/02-性能计时之谜.md`

## 快速开始

```bash
npm i ws @napi-rs/canvas --registry=https://registry.npmmirror.com
node tools/sample_fp.js       # ① 从真实 Edge 采样基线 → src/env/baseline.json（必须先做）
node tools/probe_fp_env.js    # ② 逐项对照，先把这个表刷绿
node src/runner.js --json ./_result.json   # ③ 求解 + 业务验证
```

⚠ **第 ② 步不能跳。** 第 ③ 步的失败几乎都不报错，只会表现成"token 拿到了但被拦"。

## 结构

```
src/env/01-core.js    Node/Element/HTMLElement/Document/布局/CSSOM/选择器/HTML 解析
src/env/02-media.js   canvas（真实 Skia）+ WebGL + AudioContext（离线渲染）
src/env/03-window.js  Window/Navigator/Screen/Location/Performance/Storage/定时器
src/env/04-net.js     XHR/fetch/Headers/Response/WebSocket
src/env/05-page.js    页面生命周期（挑战页装配 + 脚本执行顺序）
src/bridge.js         宿主桥接：curl 网络 / Skia canvas / cookie 罐 / 时钟
src/runner.js         主流程
```

## 调试开关

| 开关 | 用途 |
|---|---|
| `-v` | env 内部日志 |
| `--trace-ctx` | 追踪 ctx 上每个属性/方法访问（定位"空壳 API"） |
| `--trace-timing` | 追踪 `performance.timing` 字段读取 |
| `--trace-stack` | `getContext` 打栈，定位 sensor 调用点 |
| `--fresh` | 忽略 sensor 缓存重下 |
| `--challenge-only` | 只看挑战页/sensor 形态 |

## 为什么不用 jsdom

| 检测点 | jsdom 表现 |
|---|---|
| `navigator.userAgent` | 含 `jsdom/30.1.3`，与 HTTP 头矛盾 |
| canvas 300 次 `measureText` | **0.26 μs**（真实 Chrome **7317 μs**，差 28000 倍） |
| `offsetWidth` / `getBoundingClientRect` | 全 **0**，触发广告拦截检测 |

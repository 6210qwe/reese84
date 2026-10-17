# iv8 —— 已验证可用的方案

用 iv8（Python 原生 V8 + C++ 浏览器环境）跑原始 sensor，不启动浏览器。
**实测 100% 通过**：`/api/` → 404（9 字节）、`/` → 302 → 198987 字节真实首页。

## 用法

```bash
pip install iv8

python -X utf8 solve_iv8.py            # 解 + 校验 + 抓真实首页
python -X utf8 solve_iv8.py --no-page  # 只要 token
python -X utf8 solve_iv8.py --json ./chain_result.json
python -X utf8 probe_iv8_perf.py       # 在能通过的环境里插桩 performance（拿基准用）
```

## 关键点（少一个就失败）

1. **HTTP 层必须用 curl**，不能 requests/urllib
2. **挑战页必须"裸头"**：`UA + Accept: */*`，多一个头就 404 放行
3. **sensor 必须校验完整性**：`len > 700000` 且结尾 `return a1_0xdc94();}`
4. **补丁必须 prepend 到 VM 源码前**（`page.load` 会重置 window）：
   ```python
   resources = {vm_url: hooks + "\n;\n" + vm_code}
   ```
5. **布局补丁 + iframe 伪造** 两处不能少（社区版没有 CSS 布局引擎、没有 iframe 浏览上下文）

## probe_iv8_perf.py 的价值

在**能通过的实现**里插桩，拿到服务端期望的基准：

```
performance = {"1030820235": 47, "4203433130": 1, "total": 6570}
now 调用 8008 次，跨度 6534.136 ms
mark / measure 调用 0 次
getEntriesByType('navigation') → 空数组
```

这三条直接推翻了我最初的三个判断（详见 `../docs/02`）。

注：`probe_iv8_perf.py` 依赖同目录的 `solve_iv8.py`（复用其 `curl` / `fetch_vm` / `UA`）。

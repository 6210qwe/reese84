# X-Iinfo 判读手册（含三方对照实测）

> 本篇解决一个折磨了我很久的问题：**怎么判断"到底过了没有"**。
>
> 结论：**`X-Iinfo` 里的 `B` 段才是唯一可靠的判据。**
> `B10` = 挑战页（要你跑 JS）；`B12` = 明确拦截页；**没有 `B` 段 = 真实放行**。
>
> 在此之前我一直用"body 里有没有 `Pardon Our Interruption`"来判，
> 这会把 200 响应的拦截页误判成通过，也会把挑战页（它 noscript 里也带这句话）误判成拦截。

---

## 1. 三方对照（同 IP、同一时段、同一个 curl）

### ① iv8 的 token 回放（**通过**）

```
GET /api/  → HTTP 404  len=9
X-Iinfo: 54-299642661-299642822 NNNN CT(247 248 0) RT(1792264015992 490) q(0 0 5 -1) r(7 7) U11

GET /      → HTTP 302  len=213  → location: https://www.airgreenland.com/
X-Iinfo: 52-282885102-282885251 NNNN CT(250 246 0) RT(1792264018769 685) q(0 0 5 -1) r(8 8) U11
```

### ② 我们补环境的 token 回放（**被拦**）

```
GET /      → HTTP 200  len=1038（iframe 版拦截页）
X-Iinfo: 52-282886555-0 PNNN RT(1792264023612 1853) q(0 -1 -1 1) r(1 -1) B12(14,0,0) U18
```

### ③ 无 cookie / 挑战页

```
GET /api/  → HTTP 200  len=6058
X-Iinfo: 51-257366612-0 NNNN RT(1792263893276 443) q(0 -1 -1 -1) r(0 -1) B10(14,0,0) U18
```

---

## 2. 判据表

| 字段 | 通过 | 挑战页 | 被拦 |
|---|---|---|---|
| HTTP | **404** 或 **302** | 200 / 6058B | 200 / 1038B |
| **B 段** | **无** | `B10(14,0,0)` | **`B12(14,0,0)`** |
| CT 组 | **有** `CT(247 248 0)` | 无 | 无 |
| `q(...)` | **`q(0 0 5 -1)`** | `q(0 -1 -1 -1)` | `q(0 -1 -1 1)` |
| `r(...)` | **`r(7 7)`**（两个正数） | `r(0 -1)` | `r(1 -1)` |
| flag 组 | `NNNN` | `NNNN` | **`PNNN`** |
| `U` 段 | **`U11`** | `U18` | `U18` |
| 会话编号 | 三段 `54-299642661-299642822` | `51-257366612-0` | `52-282886555-0` |

### 最省事的单条判据

```python
blocked = 'B12(' in xinfo or 'B10(' in xinfo     # 任意 B 段 = 没通过
passed  = ' CT(' in xinfo and ' B1' not in xinfo  # 有 CT 且无 B = 真放行
```

**再加 body 双保险**（因为 B 段语义未公开，不能只靠它）：

```python
BLOCK_MARKS = ["Pardon Our Interruption", "_Incapsula_Resource",
               "Request unsuccessful", "Incapsula incident ID", "main-iframe"]
blocked = blocked or any(m in body for m in BLOCK_MARKS)
```

---

## 3. 这些字段的含义（社区推测 + 我们的实测校正）

| 字段 | 社区说法 | 我们的实测校正 |
|---|---|---|
| 前三段数字 | 边缘节点 / 会话 id | ✅ 一致；**通过时第三段非 0**（有真实 origin 会话） |
| `CT(a b c)` | connection time | ✅ **只有走通到源站才出现**（通过时必现，拦截时必无） |
| `RT(ts ms)` | Unix 时间戳 + 耗时 | ✅ 一致 |
| `q(a b c d)` | 排队/请求计数 | ⚠️ 通过是 `q(0 0 5 -1)`，拦截是 `q(0 -1 -1 1)`。**第三个数字为正 = 正常处理路径** |
| `r(a b)` | 路由指标 | ⚠️ 通过是 `r(7 7)`/`r(8 8)`（两正），拦截是 `r(1 -1)` |
| **`B10/B12`** | bot 标记 | ✅ **B10=挑战页，B12=拦截页，无 B=放行**（scrapfly 2026 的观察与本次实测一致） |
| `U11/U18` | 未公开 | ⚠️ 通过时 `U11`，挑战/拦截都是 `U18` |
| flag `NNNN` / `PNNN` | N/Y/P/C 组合 | ⚠️ **我们被拦时是 `PNNN`（首字符 P）**，通过时 `NNNN`。imperva.com 首页是 `0CNN` |

> `http.dev/x-iinfo` 明确说：这些字段 **Imperva 不公开**，格式会随基础设施版本变化。
> 所以**不要硬编码解析**，只用它做"通过与否"的粗判，并保留原始串做对比。

---

## 4. 为什么这个判据很重要

在此之前，我用的判据是：

```python
ok = token is not None                    # ✗ 服务端会照常签发再判死
ok = resp.status_code == 200              # ✗ 200 恰好是拦截页的常见形态
ok = "Pardon Our Interruption" not in body # ✗ 挑战页 noscript 里也有这句
ok = X_Iinfo 里有 B10                      # ✗ B12 才是拦，B10 是挑战
```

**四个判据全错。** 结果是：我以为"拿到了 token 但指纹不够好"，
实际上服务端给的是**明确的 B12 拦截**，而不是"低信任"。

这个区别决定了排查方向：
- 如果是"低信任"→ 应该去调指纹一致性
- 如果是"B12 拦截"→ 说明 payload 被判定为 bot，问题更根本

---

## 5. 附：抓 X-Iinfo 的最小脚本

```python
import re, subprocess

def probe(url, cookies="", ua=None):
    """返回 dict(status, xinfo, passed, blocked, marks)"""
    UA = ua or ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
    args = ["curl.exe", "-sS", "-D", "-", "-A", UA, "-H", "Accept: */*"]
    if cookies:
        args += ["-b", cookies]
    args.append(url)
    out = subprocess.run(args, capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    head, _, body = out.partition("\r\n\r\n")
    m = re.search(r"(?im)^x-iinfo:\s*(.+)$", head)
    xinfo = m.group(1).strip() if m else ""
    marks = [k for k in ("Pardon Our Interruption", "_Incapsula_Resource",
                         "Request unsuccessful", "Incapsula incident ID", "main-iframe")
             if k in body]
    blocked = ("B10(" in xinfo or "B12(" in xinfo) or bool(marks)
    passed = (" CT(" in xinfo) and (" B1" not in xinfo) and not marks
    return {"status": int(re.match(r"HTTP/[\d.]+\s+(\d+)", head.strip()).group(1)) if head else 0,
            "xinfo": xinfo, "passed": passed, "blocked": blocked, "marks": marks}
```

---

## 6. 一句话

> **看到 `B10` 说明你还在门口；看到 `B12` 说明你被拒了；
> 既没 B 段又有 `CT(...)` 才是真的进去了。**
>
> 别再用"有没有拿到 token"当成功了。

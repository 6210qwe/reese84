#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
iv8 求解 book.airgreenland.com 的 reese84

与 hertz 那套（静默模式）的关键区别：
  本站是**中断页模式**（Pardon Our Interruption），挑战页里有一堆内联脚本：
    window.reeseSkipExpirationCheck = true
    isSpa / isInterstitial 判断
    window.onProtectionInitialized / onProtectionLoaded
    scriptElement.src = "<路径>?s=xxx"
  所以必须把**整页 HTML 原样**交给 iv8 的 page.load，让它自己执行内联脚本，
  再等它去加载 VM。

流程：
  1. curl 取挑战页（Imperva 校 TLS，requests 会被拦）
  2. 从 HTML 抽 VM 路径（带 ?s=）
  3. curl 取 VM 源码（约 830KB）
  4. iv8: hooks + VM 一起注入 resources，page.load
  5. 钩 fetch 拿到 payload，读 document.cookie 看有没有 reese84
  6. curl POST payload 换 token
  7. 带 cookie 复请求校验
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS_JS = os.path.join(HERE, "reese84_iv8_hooks.js")

TARGET = "https://book.airgreenland.com/api/"
HOST = "book.airgreenland.com"
POST_HEADERS = ["Accept: */*", "Content-Type: text/plain; charset=utf-8"]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


# ─────────────────────────── HTTP（走 curl，保 TLS 指纹） ───────────────────────────
def curl(url, referer=None, method="GET", data=None, ctype=None, cookie=None,
         timeout=180, bare=False):
    """返回 (status, body_bytes, headers_text)

    bare=True 时只带 UA + Accept: */*。
    实测本站在补了 Accept-Language 后会被当"正常导航"直接放行（404），
    反而拿不到挑战页 —— 要出中断页就得用裸头撞。
    """
    jar = os.path.join(HERE, "_cookies.txt")
    a = ["curl", "-s", "-L", "--max-time", str(timeout),
         "-A", UA, "-b", jar, "-c", jar,
         "-H", "Accept: */*",
         "-D", "-"]
    if not bare:
        a += ["-H", "Accept-Language: en-US,en;q=0.9"]
    if referer:
        a += ["-e", referer]
    if cookie:
        a += ["-b", cookie]
    if method == "POST":
        a += ["-X", "POST"]
        if ctype:
            a += ["-H", "Content-Type: " + ctype]
        if data is not None:
            if isinstance(data, str):
                data = data.encode("utf-8")
            a += ["--data-binary", "@-"]
    a.append(url)

    use_proxy = os.environ.get("IV8_USE_PROXY", "0") == "1"
    env = dict(os.environ)
    if not use_proxy:
        for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
            env.pop(k, None)

    p = subprocess.run(a, input=data if method == "POST" else None,
                       capture_output=True, env=env, timeout=timeout + 15)
    raw = p.stdout
    # 分离 header / body
    idx = raw.find(b"\r\n\r\n")
    if idx < 0:
        return 0, raw, ""
    headers = raw[:idx].decode("latin-1", "replace")
    body = raw[idx + 4:]
    # 多个响应（-L 会重复 header）
    parts = headers.split("\r\n\r\n")
    if len(parts) > 1:
        headers = parts[-1]
    m = re.findall(r"HTTP/[\d.]+\s+(\d+)", headers)
    status = int(m[-1]) if m else 0
    return status, body, headers


# ─────────────────── 取真实首页（token 的用途验证） ───────────────────
JAR = None  # 实际路径在 main 里按 HERE 赋值


def read_jar(path=None):
    """解析 curl -c 写出的 Netscape cookie 文件 -> {name: value}

    注意 #HttpOnly_ 前缀的行是有效 cookie，不能当注释跳过
    （visid_incap_* / nlbi_* / incap_ses_* 全是 HttpOnly，漏了它们照样被拦）。
    """
    path = path or JAR or os.path.join(HERE, "_cookies.txt")
    out = {}
    if not os.path.isfile(path):
        return out
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if not line:
                continue
            if line.startswith("#HttpOnly_"):
                line = line[len("#HttpOnly_"):]
            elif line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) >= 7:
                out[parts[5]] = parts[6]
    return out


def build_cookie(token):
    """把 jar 里的全部会话 cookie 与 reese84 拼成一个 Cookie 头"""
    ck = read_jar()
    ck["reese84"] = token
    return "; ".join("%s=%s" % (k, v) for k, v in ck.items()), ck


def http_get(url, cookie=None, timeout=120, accept_html=True):
    """单跳 GET，不跟随跳转。返回 (status, body_bytes, headers_text)"""
    a = ["curl", "-s", "--max-time", str(timeout), "-A", UA, "-D", "-"]
    if accept_html:
        a += ["-H",
              "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,"
              "image/avif,image/webp,*/*;q=0.8",
              "-H", "Accept-Language: en-US,en;q=0.9"]
    else:
        a += ["-H", "Accept: */*"]
    if cookie:
        a += ["-H", "Cookie: " + cookie]
    a.append(url)

    env = dict(os.environ)
    if os.environ.get("IV8_USE_PROXY", "0") != "1":
        for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY",
                  "all_proxy", "ALL_PROXY"):
            env.pop(k, None)

    p = subprocess.run(a, capture_output=True, env=env, timeout=timeout + 15)
    raw = p.stdout
    idx = raw.find(b"\r\n\r\n")
    if idx < 0:
        return 0, raw, ""
    headers = raw[:idx].decode("latin-1", "replace")
    body = raw[idx + 4:]
    m = re.findall(r"HTTP/[\d.]+\s+(\d+)", headers)
    return (int(m[-1]) if m else 0), body, headers


def header_of(headers, name):
    for line in headers.splitlines():
        if line.lower().startswith(name.lower() + ":"):
            return line.split(":", 1)[1].strip()
    return None


def headers_of(headers, name):
    out = []
    for line in headers.splitlines():
        if line.lower().startswith(name.lower() + ":"):
            out.append(line.split(":", 1)[1].strip())
    return out


def visible_text(html, limit=300):
    """粗暴去标签，取一小段人眼可读的正文"""
    t = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html or "")
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;?", " ", t)
    t = re.sub(r"&amp;", "&", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def deliver_page(token, entry=None, timeout=120):
    """带 token 走完整跳转，抓取真实首页。

    返回 dict: chain / status / size / title / links / text / file
    关键点：book 子域根路径在带 cookie 时返回 302 跳 www，
    必须**跟进第二跳**才能拿到 199534 字节的真实首页。
    """
    entry = entry or ("https://%s/" % HOST)
    cookie, ck = build_cookie(token)

    print("\n[6] 带 token 抓真实首页")
    print("  Cookie 共 %d 个：%s" % (len(ck), ", ".join(sorted(ck))))
    print("  入口 GET %s" % entry)

    chain = []
    st, body, hdrs = http_get(entry, cookie=cookie, timeout=timeout)
    chain.append({"url": entry, "status": st,
                  "location": header_of(hdrs, "location"),
                  "len": len(body)})

    # 捕获这一跳新下发的 cookie（源站会话 + Imperva 会话）
    setck = headers_of(hdrs, "set-cookie")
    if setck:
        print("  ← %s  下发 %d 个 cookie：" % (st, len(setck)))
        for c in setck:
            name = c.split("=")[0].strip()
            flags = []
            if "HttpOnly" in c:
                flags.append("HttpOnly")
            if "Domain=" in c:
                flags.append("Domain=" + re.search(r"Domain=([^;]+)", c).group(1))
            print("      + %-34s %s" % (name, " ".join(flags)))

    # 手动跟跳（最多 3 跳），每一跳都打印
    cur_body = body
    hops = 0
    while chain[-1]["location"] and hops < 3:
        nxt = urllib.parse.urljoin(chain[-1]["url"], chain[-1]["location"])
        hops += 1
        st, body, hdrs = http_get(nxt, cookie=cookie, timeout=timeout)
        chain.append({"url": nxt, "status": st,
                      "location": header_of(hdrs, "location"),
                      "len": len(body)})
        cur_body = body
        print("  → 跳转 GET %s" % nxt)
        print("  ← %s  len=%d" % (st, len(body)))

    html = cur_body.decode("utf-8", "replace")
    marks = is_blocked(html)
    title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else ""
    links = re.findall(r'href="(/[a-z0-9][a-z0-9/-]*/)"', html, re.I)

    out_file = os.path.join(HERE, "_real_page.html")
    try:
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(html)
    except Exception as e:
        out_file = None
        print("  ⚠ 落盘失败：%s" % e)

    print("\n  ── 结果 ──")
    print("  跳转链   : %s" % " → ".join(
        "%s %s" % (c["status"], urllib.parse.urlsplit(c["url"]).netloc) for c in chain))
    print("  最终状态 : %s" % chain[-1]["status"])
    print("  最终 URL : %s" % chain[-1]["url"])
    print("  页面大小 : %d 字节" % len(html))
    print("  页面标题 : %s" % (title or "(无)"))
    print("  链接数量 : %d 个" % len(set(links)))
    print("  拦截特征 : %s" % (marks or "无"))
    if out_file:
        print("  已存文件 : %s" % out_file)
    snippet = visible_text(html, 300)
    if snippet:
        print("  正文开头 : %s…" % snippet)

    ok_page = (not marks) and len(html) > 20000
    if ok_page:
        print("\n  ✅ 拿到真实首页（%d 字节，绕过挑战）" % len(html))
        print("     说明：这个 www 首页自身不校验 reese84；token 的作用是让")
        print("     book 子域放行并返回 302。页面内容会随时段轮换，字节数会浮动")
        print("     （实测见过 198995 / 199534）。")
    else:
        print("\n  ⚠️  没拿到真实首页（%d 字节）" % len(html))
        if marks:
            print("     仍是挑战页 → token 没被接受，或会话 cookie 不完整")
        elif len(html) < 20000:
            print("     内容过小 → 可能跳到了错误路径，或用例已改")

    return {"chain": chain, "status": chain[-1]["status"], "size": len(html),
            "title": title, "links": len(set(links)), "marks": marks,
            "text": snippet, "file": out_file, "ok": ok_page,
            "cookies": sorted(ck)}


def fetch_vm(vm_url, referer, tries=4):
    """VM 约 830KB，国际链路常被截断（实测拿到过 523984 / 695908 的残包）。
    完整性判据：结尾必须是混淆数组函数的 return，长度 > 700000。
    不满足就重下 —— 残包会让 VM 静默不初始化，非常难排查。
    """
    best = ""
    for i in range(tries):
        st, vb, _ = curl(vm_url, referer=referer, timeout=180)
        code = vb.decode("utf-8", "replace")
        ok = (st == 200 and len(code) > 700000
              and code.rstrip().endswith("return a1_0xdc94();}"))
        print("    第 %d 次: status=%s len=%d %s" % (i + 1, st, len(code), "✓ 完整" if ok else "✗ 残包"))
        if len(code) > len(best):
            best = code
        if ok:
            return code
    print("    ⚠ %d 次都没拿到完整 VM，用最长的 %d 字节继续" % (tries, len(best)))
    return best


def is_blocked(text):
    marks = ["Pardon Our Interruption", "_Incapsula_Resource",
             "Request unsuccessful", "Incapsula incident ID", "main-iframe"]
    return [m for m in marks if m in (text or "")]


# ─────────────────────────── iv8 ───────────────────────────
CAPTURE_JS = r"""
(function () {
  var R = window.__r84 || {};
  var out = {
    hasPayload: !!window.__body_full,
    payloadLen: (window.__body_full || '').length,
    postback: window.__postback || null,
    bodyUrl: window.__body_url || null,
    bodyMethod: window.__body_method || null,
    bodyHeaders: window.__body_headers || null,
    payload: window.__body_full || null,
    docCookie: (function(){ try { return document.cookie || ''; } catch(e){ return 'ERR'; } })(),
    dumped: {},
  };
  var d = window.__dumpR84 && window.__dumpR84();
  if (d) out.dumped = d;
  ['layout','hooks','cookies','tags','net','ipCalls','err'].forEach(function(k){
    out[k] = (R[k] || []).slice(0, 40);
  });
  return JSON.stringify(out);
})()
"""


def run_iv8(target, html, vm_url, vm_code):
    import iv8

    hooks = ""
    if os.path.isfile(HOOKS_JS):
        hooks = open(HOOKS_JS, encoding="utf-8").read()
        print("  ✓ 已加载补丁 %d 字节" % len(hooks))
    else:
        print("  ⚠ 缺 %s，大概率拿不到 POST" % HOOKS_JS)

    sp = urllib.parse.urlsplit(target)
    env = {
        "location": {
            "href": target,
            "origin": "%s://%s" % (sp.scheme, sp.netloc),
            "protocol": sp.scheme + ":",
            "host": sp.netloc,
            "hostname": sp.hostname or "",
            "port": sp.port or 0,
            "pathname": sp.path or "/",
            "search": ("?" + sp.query) if sp.query else "",
            "hash": "",
        },
        "navigator": {
            "userAgent": UA, "language": "en-US", "languages": ["en-US", "en"],
            "platform": "Win32", "hardwareConcurrency": 8, "deviceMemory": 8,
            "vendor": "Google Inc.", "webdriver": False,
        },
        "screen": {"width": 1366, "height": 768, "colorDepth": 24},
    }

    # 关键：补丁必须 prepend 到 VM 源码（page.load 会重置 window）
    resources = {vm_url: (hooks + "\n;\n" + vm_code)}

    # 挑战页里的 _Incapsula_Resource iframe 也注入
    mif = re.search(r'src=["\']([^"\']*_Incapsula_Resource[^"\']*)["\']', html, re.I)
    if mif:
        iu = urllib.parse.urljoin(target, mif.group(1))
        st, ib, _ = curl(iu, referer=target)
        if st == 200:
            resources[iu] = {"body": ib.decode("utf-8", "replace"), "status": 200,
                             "headers": [["content-type", "text/html"]]}
            print("  ✓ 注入 _Incapsula_Resource iframe")

    with iv8.JSContext(environment=env, config={"timezone": "Asia/Shanghai"}) as ctx:
        ctx.expose({"baseURL": target, "html": html, "headers": [],
                    "resources": resources}, "snapshot")
        ctx.eval("__iv8__.page.load(__iv8__.data.snapshot);")
        # 多推进几轮：VM 里有多层 setTimeout
        for _ in range(14):
            ctx.eval("__iv8__.eventLoop.sleep(600);")
        info = json.loads(str(ctx.eval(CAPTURE_JS)))

    return info


# ─────────────────────────── 主流程 ───────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=TARGET)
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("--json", default=None)
    ap.add_argument("--no-page", action="store_true",
                    help="跳过第 6 步（不抓真实首页）")
    ap.add_argument("--page-url", default=None,
                    help="第 6 步的入口，默认 https://book.airgreenland.com/")
    args = ap.parse_args()

    global JAR
    JAR = os.path.join(HERE, "_cookies.txt")

    target = args.url
    print("=" * 62)
    print("iv8 求解 reese84 | 目标 %s" % target)

    # 1. 挑战页
    print("\n[1] 取挑战页（curl）")
    st, body, _ = curl(target, bare=True)
    html = body.decode("utf-8", "replace")
    print("  status=%s len=%d 拦截特征=%s" % (st, len(html), is_blocked(html)))

    m = re.search(r'scriptElement\.src\s*=\s*"([^"]+)"', html)
    if not m:
        m = re.search(r'src\s*=\s*["\']([^"\']+\.js[^"\']*)["\']', html)
    if not m:
        print("  ❌ 没找到 VM 路径")
        sys.exit(1)
    vm_path = m.group(1)
    vm_url = urllib.parse.urljoin(target, vm_path)
    print("  VM 路径: %s" % vm_path[:80])

    # 2. VM 源码
    print("\n[2] 取 VM 源码")
    vm_code = fetch_vm(vm_url, target)
    if len(vm_code) < 10000:
        print("  ❌ VM 下载失败")
        sys.exit(1)

    # 3. iv8 执行
    print("\n[3] iv8 执行 VM")
    info = run_iv8(target, html, vm_url, vm_code)
    print("  payload: %s (%d 字符)" % (info.get("hasPayload"), info.get("payloadLen") or 0))
    print("  postback: %s" % info.get("postback"))
    ck = info.get("docCookie") or ""
    print("  document.cookie: %s" % (ck[:120] or "(空)"))
    if info.get("dumped"):
        print("  内部状态: %s" % json.dumps(info["dumped"], ensure_ascii=False)[:300])
    for k in ("layout", "hooks", "net", "err"):
        v = info.get(k) or []
        if v:
            print("  [%s] %s" % (k, " | ".join(str(x)[:90] for x in v[:6])))

    token = None
    token_meta = {}
    mm = re.search(r"reese84=([^;]+)", ck)
    if mm and len(mm.group(1)) > 200:
        token = mm.group(1)
        print("\n  ✅ iv8 内部已拿到 reese84（长度 %d）" % len(token))

    # 4. 若 iv8 只给了 payload，用 curl POST 换 token
    if not token and info.get("hasPayload"):
        print("\n[4] 用 payload 换 token（curl POST）")
        payload = info.get("payload")
        if not payload:
            # CAPTURE_JS 没带全文，单独再取
            pass
        post_url = target.rstrip("/")
        pb = info.get("postback")
        if pb:
            post_url = urllib.parse.urljoin(target, pb)
        post_url = post_url + "?d=" + HOST
        stp, rb, rh = curl(post_url, referer=target, method="POST",
                           data=payload, ctype="text/plain; charset=utf-8")
        txt = rb.decode("utf-8", "replace")
        # 落盘：POST 的 URL / 请求头 / 请求体 / 响应，方便对照文档
        try:
            with open("_post_dump.json", "w", encoding="utf-8") as f:
                json.dump({
                    "url": post_url,
                    "method": "POST",
                    "headers": POST_HEADERS,
                    "body": payload,
                    "bodyLen": len(payload),
                    "status": stp,
                    "respHeaders": [l for l in rh.splitlines() if l.strip()],
                    "respBody": txt,
                }, f, ensure_ascii=False, indent=1)
            print("  已落盘 _post_dump.json（含请求头/请求体/响应）")
        except Exception as e:
            print("  落盘失败", e)
        print("  POST status=%s len=%d" % (stp, len(txt)))
        print("  响应前 200: %s" % txt[:200])
        try:
            j = json.loads(txt)
            for k, v in j.items():
                print("    %-14s = %s" % (k, (str(v)[:80] + "…") if len(str(v)) > 80 else v))
            for _k in ("renewInSec", "cookieDomain"):
                if j.get(_k) is not None:
                    token_meta[_k] = j[_k]
            if j.get("token"):
                token = j["token"]
                print("  ✅ token（长度 %d）有效期 %ss" % (len(token), j.get("renewInSec")))
        except Exception:
            pass

    if not token:
        print("\n❌ 没拿到 reese84")
        print("   若是「VM 没发 POST」→ 布局/iframe 补丁没生效（看上面 layout/hooks 日志）")
        print("   若是「POST 了但没 token」→ 看 POST 响应内容")
        sys.exit(2)

    print("\n✅ reese84 = %s" % token)
    print("   长度 %d" % len(token))

    # 5. 校验
    if not args.no_verify:
        print("\n[5] 校验")
        st2, b2, _ = curl(target, referer=target, cookie="reese84=" + token, bare=True)
        t2 = b2.decode("utf-8", "replace")
        marks = is_blocked(t2)
        print("  status=%s len=%d 拦截特征=%s" % (st2, len(t2), marks))
        ok = not marks
        print("  %s" % ("✅ 通过：不再返回挑战页" if ok else "⚠️  仍被拦"))
    else:
        ok = None

    # 6. 带 token 抓真实首页（证明这个参数到底换到了什么）
    page = None
    if not args.no_page:
        try:
            page = deliver_page(token, entry=args.page_url)
        except Exception as e:
            print("\n[6] 抓真实首页失败：%s" % e)
            page = {"ok": False, "error": str(e)}

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"engine": "iv8", "reese84": token, "len": len(token),
                       "verified": ok, "payloadLen": info.get("payloadLen"),
                       "renewInSec": token_meta.get("renewInSec"),
                       "cookieDomain": token_meta.get("cookieDomain"),
                       "page": page},
                      f, ensure_ascii=False, indent=2)
    return 0 if token else 2


if __name__ == "__main__":
    sys.exit(main())

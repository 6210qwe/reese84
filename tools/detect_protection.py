#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
detect_protection.py —— 给一个 URL，自动识别反爬防护类型并定位参数接口

设计目标：把"接一个新站"的头 10 分钟自动化掉。
  输入：目标 URL
  输出：
    1. 防护厂商判定（reese84/Imperva、瑞数、5s盾、Akamai、Kasada、DataDome、无）
    2. 挑战页形态（是否中断页、状态码、字节数）
    3. 参数接口坐标（sensor 路径 / 提交路径 / query 参数）
    4. 必需请求头形态（裸头 vs 全头）
    5. 该走哪条路线（iv8 / 补环境 / 纯算 / 浏览器）

用法：
  python -X utf8 detect_protection.py https://example.com/
  python -X utf8 detect_protection.py https://example.com/ --json out.json
  python -X utf8 detect_protection.py https://example.com/ --deep   # 额外下 sensor 看大小

零第三方依赖，只用 curl（TLS 指纹必须像浏览器）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")

CURL = os.environ.get("CURL_BIN", "curl.exe")

# ── 防护特征库 ─────────────────────────────────────────────────────
# 每条：厂商 / 页面特征 / 头特征 / cookie 特征 / 下一步
SIGNATURES = [
    {
        "name": "reese84 (Imperva / Incapsula)",
        "page": [r"reeseSkipExpirationCheck", r"scriptElement\.src\s*=",
                 r"_Incapsula_Resource", r"Incapsula incident ID"],
        "header": [r"^x-iinfo:", r"^x-cdn:\s*incapsula"],
        "cookie": [r"^visid_incap", r"^incap_ses", r"^nlbi_", r"^reese84", r"^incap_sh"],
        "route": "iv8（首选，实测通过）/ 手写补环境（能签发但回放不信任）",
        "note": "GET 挑战页 → GET sensor → POST 同路径?d=host → token",
    },
    {
        "name": "瑞数 (Ruishu)",
        "page": [r"\$_ts", r"dynamicurl", r"r2i"],
        "header": [],
        "cookie": [r"^FSSBBIl1UgzbN7N"],
        "route": "iv8（瑞数5/6 实测通过）/ ruishu-bypass skill",
        "note": "cookie 名形如 FSSBBIl1UgzbN7N*，页面含 $_ts 与随机外链",
    },
    {
        "name": "Cloudflare 5秒盾 / Turnstile",
        "page": [r"cf-browser-verification", r"__cf_chl", r"challenge-platform",
                 r"cf_chl_opt", r"turnstile"],
        "header": [r"^cf-ray:", r"^server:\s*cloudflare"],
        "cookie": [r"^cf_clearance", r"^__cf_bm"],
        "route": "5s盾 AST 解混淆 / 真实浏览器 / cf_clearance 池",
        "note": "jsd/main.js 混淆，AST 插件可解",
    },
    {
        "name": "Akamai (Bot Manager)",
        "page": [r"_abck", r"sensor_data", r"sec-cpt", r"akam/"],
        "header": [r"^server:\s*akamaighost", r"^x-akamai"],
        "cookie": [r"^_abck", r"^bm_sz", r"^ak_bmsc"],
        "route": "iv8 / 纯算（sensor_data 要 POST 两次）",
        "note": "_abck 需要 POST ~2 次才 valid",
    },
    {
        "name": "Kasada",
        "page": [r"x-kpsdk-ct", r"kpsdk", r"/ips\.js"],
        "header": [r"^x-kpsdk"],
        "cookie": [r"^kp_"],
        "route": "纯算 / iv8（WASM 参与，较难）",
        "note": "含 WASM，通常要逆向 wasm",
    },
    {
        "name": "DataDome",
        "page": [r"datadome", r"captcha-delivery\.com", r"geo\.captcha-delivery"],
        "header": [r"^x-dd-", r"^set-cookie:.*datadome"],
        "cookie": [r"^datadome"],
        "route": "真实浏览器 / 有滑块，补环境成本高",
        "note": "常见滑块，纯环境难",
    },
]

BLOCK_MARKS = [
    "Pardon Our Interruption", "_Incapsula_Resource", "Request unsuccessful",
    "Incapsula incident ID", "main-iframe", "cf-browser-verification",
    "challenge-platform", "Just a moment",
]


def curl(url: str, headers: dict, method="GET", body=None, timeout=40, follow=False):
    """返回 (status, headers_text, body_bytes)。"""
    fd, hpath = tempfile.mkstemp(suffix=".h")
    os.close(fd)
    fd2, bpath = tempfile.mkstemp(suffix=".b")
    os.close(fd2)
    args = [CURL, "-sS", "-D", hpath, "-o", bpath,
            "--connect-timeout", "15", "--max-time", str(timeout)]
    if follow:
        args.append("-L")
    if method != "GET":
        args += ["-X", method]
    for k, v in headers.items():
        args += ["-H", "%s: %s" % (k, v)]
    if body is not None:
        bd = body.encode("utf-8") if isinstance(body, str) else body
        fd3, tpath = tempfile.mkstemp(suffix=".d")
        os.write(fd3, bd)
        os.close(fd3)
        args += ["--data-binary", "@" + tpath]
    args.append(url)

    env = dict(os.environ)
    for k in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        env.pop(k, None)
    try:
        subprocess.run(args, capture_output=True, timeout=timeout + 20, env=env,
                       check=False, **({"creationflags": 0x08000000} if os.name == "nt" else {}))
        head = open(hpath, "r", encoding="latin1").read() if os.path.exists(hpath) else ""
        bodyb = open(bpath, "rb").read() if os.path.exists(bpath) else b""
    except Exception as e:
        head, bodyb = "", b"__ERR__" + str(e).encode()
    finally:
        for p in (hpath, bpath):
            try:
                os.unlink(p)
            except Exception:
                pass
        if body is not None:
            try:
                os.unlink(tpath)
            except Exception:
                pass

    blocks = [b for b in head.split("\r\n\r\n") if re.match(r"^HTTP/", b.strip())]
    last = blocks[-1] if blocks else head
    m = re.match(r"HTTP/[\d.]+\s+(\d+)", last.strip())
    return (int(m.group(1)) if m else 0), last, bodyb


def parse_set_cookie(head_text: str):
    out = []
    for line in head_text.splitlines():
        if re.match(r"^set-cookie:", line, re.I):
            out.append(line.split(":", 1)[1].strip())
    return out


def header_dict(head_text: str):
    d = {}
    for line in head_text.splitlines()[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            d[k.strip().lower()] = v.strip()
    return d


def match_signature(text, headers, cookies):
    """返回命中的厂商列表，按证据条数排序。"""
    hits = []
    for sig in SIGNATURES:
        ev = []
        for pat in sig["page"]:
            if re.search(pat, text, re.I):
                ev.append("page:" + pat[:40])
        htxt = "\n".join("%s:%s" % (k, v) for k, v in headers.items())
        for pat in sig["header"]:
            if re.search(pat, htxt, re.I | re.M):
                ev.append("header:" + pat[:30])
        ctxt = "\n".join(cookies)
        for pat in sig["cookie"]:
            if re.search(pat, ctxt, re.I | re.M):
                ev.append("cookie:" + pat[:24])
        if ev:
            hits.append({"sig": sig, "evidence": ev})
    hits.sort(key=lambda x: -len(x["evidence"]))
    return hits


def extract_reese84_coords(html: str, base: str):
    """从挑战页里抠 sensor 路径 / ?s= / iframe。"""
    out = {}
    m = re.search(r'scriptElement\.src\s*=\s*"([^"]+)"', html) or \
        re.search(r'src\s*=\s*"([^"]+\.js[^"]*)"', html)
    if m:
        out["sensor_path"] = m.group(1)
        q = re.search(r"[?&]s=([^&\"']+)", m.group(1))
        if q:
            out["s_param"] = q.group(1)
    ifr = re.search(r'src=["\']([^"\']*_Incapsula_Resource[^"\']*)["\']', html, re.I)
    if ifr:
        out["incapsula_resource"] = ifr.group(1)
    for k in ("reeseSkipExpirationCheck", "isImpervaSpaSupport", "onProtectionInitialized",
              "showBlockPage", "X-SPA"):
        if k in html:
            out.setdefault("inline_markers", []).append(k)
    return out


def probe_header_modes(url: str):
    """探测"哪种请求头才能拿到挑战页" —— 这一步是 reese84 类站点的关键。"""
    modes = {
        "裸头 (UA + Accept 通配)": {"Accept": "*/*", "User-Agent": UA},
        "仅 UA": {"User-Agent": UA},
        "UA + Accept 通配 + Accept-Language": {"Accept": "*/*", "User-Agent": UA,
                                               "Accept-Language": "en-US,en;q=0.9"},
        "UA + Accept 通配 + Accept-Encoding": {"Accept": "*/*", "User-Agent": UA,
                                              "Accept-Encoding": "gzip"},
        "浏览器导航头": {"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9", "User-Agent": UA,
                        "Upgrade-Insecure-Requests": "1",
                        "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-Site": "none"},
    }
    results = {}
    for name, h in modes.items():
        st, ht, body = curl(url, h)
        txt = body.decode("utf-8", "replace")
        results[name] = {
            "status": st,
            "len": len(body),
            "is_challenge": bool(re.search(r"scriptElement\.src|reeseSkipExpirationCheck|"
                                           r"cf-browser-verification|challenge-platform", txt)),
            "block_marks": [m for m in BLOCK_MARKS if m in txt][:3],
        }
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--json", default=None)
    ap.add_argument("--deep", action="store_true", help="额外下载 sensor 看大小/完整性")
    args = ap.parse_args()

    url = args.url
    print("=" * 72)
    print("目标: %s" % url)
    print("=" * 72)

    # ── 1. 裸头请求 ──
    st, head, body = curl(url, {"Accept": "*/*", "User-Agent": UA})
    text = body.decode("utf-8", "replace")
    hdrs = header_dict(head)
    cookies = parse_set_cookie(head)

    print("\n[1] 基础响应")
    print("    status = %s   bytes = %s" % (st, len(body)))
    for k in ("server", "x-cdn", "x-iinfo", "content-type", "cf-ray", "x-powered-by"):
        if k in hdrs:
            print("    %-14s = %s" % (k, hdrs[k][:100]))
    if cookies:
        print("    Set-Cookie   = %s" % ", ".join(c.split("=")[0] for c in cookies[:6]))

    # ── 2. 厂商判定 ──
    print("\n[2] 防护判定")
    hits = match_signature(text, hdrs, cookies)
    if not hits:
        print("    ⚠️ 未命中任何已知特征（可能是自研 / 或该路径未受保护）")
    for h in hits[:3]:
        s = h["sig"]
        print("    ★ %s  (证据 %d 条)" % (s["name"], len(h["evidence"])))
        print("       证据: %s" % ", ".join(h["evidence"][:5]))
        print("       路径: %s" % s["route"])
        print("       备注: %s" % s["note"])

    top = hits[0]["sig"]["name"] if hits else None

    # ── 3. 挑战页坐标 ──
    coords = {}
    if top and "reese84" in top:
        coords = extract_reese84_coords(text, url)
        print("\n[3] 挑战页坐标")
        if coords:
            for k, v in coords.items():
                print("    %-20s = %s" % (k, v if k != "inline_markers" else ", ".join(v)))
        else:
            print("    ⚠️ 没抠到 sensor 路径（可能没被挑战，或结构变了）")

    # ── 4. 请求头模式探测 ──
    print("\n[4] 请求头模式探测（reese84 类站点靠这个分流，很关键）")
    modes = probe_header_modes(url)
    best = None
    for name, r in modes.items():
        tag = "✅ 挑战页" if r["is_challenge"] else ("放行 %s" % r["status"])
        print("    %-38s %s  len=%s" % (name, tag, r["len"]))
        if r["is_challenge"] and best is None:
            best = name
    print("    ⇒ 拿挑战页用: %s" % (best or "（都没拿到，可能需要 Cookie 或已放行）"))

    # ── 5. sensor 详情 ──
    sensor_info = {}
    if args.deep and coords.get("sensor_path"):
        sp = coords["sensor_path"]
        if sp.startswith("/"):
            from urllib.parse import urljoin
            sp = urljoin(url, sp)
        st2, h2, b2 = curl(sp, {"Accept": "*/*", "User-Agent": UA}, timeout=180)
        code = b2.decode("utf-8", "replace")
        complete = len(code) > 700000 and code.rstrip().endswith("return a1_0xdc94();}")
        sensor_info = {"url": sp, "status": st2, "len": len(code), "complete": complete}
        print("\n[5] sensor")
        print("    status=%s len=%s 完整=%s" % (st2, len(code), complete))
        if not complete and len(code) > 100000:
            print("    ⚠️ 可能是残包，需要重试下载")

    # ── 6. 路线建议 ──
    print("\n[6] 路线建议")
    if top and "reese84" in top:
        print("    1️⃣ 首选 iv8：python -X utf8 solve_iv8.py   （实测 100% 通过）")
        print("    2️⃣ 研究用：node src/runner.js               （能签发 token，回放被判 B12）")
        print("    3️⃣ 不建议纯算：编码函数每次重载都变（见 docs/05）")
    elif top and "瑞数" in top:
        print("    1️⃣ iv8（瑞数5/6 都能过）")
        print("    2️⃣ skill: ruishu-bypass")
    elif top and "Cloudflare" in top:
        print("    1️⃣ 先试 cf_clearance 池 + curl_cffi impersonate")
        print("    2️⃣ AST 插件解 jsd（参考本地资料 7.1-3）")
    elif top:
        print("    → %s" % hits[0]["sig"]["route"])
    else:
        print("    → 该路径可能未受保护，直接采集即可")

    out = {
        "url": url, "status": st, "len": len(body),
        "headers": {k: v for k, v in hdrs.items() if k in
                    ("server", "x-cdn", "x-iinfo", "cf-ray", "x-powered-by")},
        "set_cookie_names": [c.split("=")[0] for c in cookies],
        "protection": [{"name": h["sig"]["name"], "evidence": h["evidence"],
                        "route": h["sig"]["route"]} for h in hits],
        "coords": coords, "header_modes": modes,
        "challenge_header_mode": best, "sensor": sensor_info,
        "block_marks": [m for m in BLOCK_MARKS if m in text],
    }
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("\n已写入 %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())

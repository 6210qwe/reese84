"""
probe_iv8_perf.py —— 在"能通过的 iv8 环境"里插桩 performance，拿到服务端期望的计时基准

为什么必须做这一步：
  我们的补环境拿到了服务端签发的 token，但回放被判低信任（X-Iinfo B12）。
  同一时段 iv8 100% 通过。两者唯一的硬差异在 payload 的 performance 字段：

      iv8 : {"1030820235": 46,   "4203433130": 1, "total": 7442}
      我们 : {"1030820235": 459,  "4203433130": 1, "total": 484}

  这两个哈希键是 User Timing 里 measure 名字的哈希，值是 duration。
  但 sensor 的 mark/measure 在我们环境里只被调用了一次（且是 getEntriesByType），
  说明还有别的计时路径 —— 只能在能通过的 iv8 里插桩，看它到底量了什么。

用法：
  python -X utf8 probe_iv8_perf.py            # 跑一次并打印计时轨迹
  python -X utf8 probe_iv8_perf.py --json out.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import solve_iv8 as S

PERF_HOOK = r"""
/* ===== performance 插桩（必须在 VM 之前执行） ===== */
(function () {
  'use strict';
  if (window.__perfHooked) return;
  window.__perfHooked = true;
  window.__perfLog = [];
  var L = window.__perfLog;
  function push(kind, name, dur, extra) {
    try {
      if (L.length < 3000) {
        L.push({ k: kind, n: String(name), d: (typeof dur === 'number' ? Math.round(dur * 1000) / 1000 : null), e: extra || null });
      }
    } catch (e) {}
  }

  var P = window.performance;
  if (!P) { push('WARN', 'no performance', 0, null); return; }

  // 记录性能对象上有哪些键，判断是不是原生实现
  try { push('INFO', 'perf keys', 0, Object.keys(P).slice(0, 30)); } catch (e) {}

  function wrapMethod(obj, name) {
    try {
      var orig = obj[name];
      if (typeof orig !== 'function') { push('INFO', 'missing ' + name, 0, typeof orig); return; }
      obj[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var t0 = null;
        try { t0 = orig.apply(obj, args); } catch (err) { push('ERR', name + ' threw: ' + err.message, 0, null); throw err; }
        if (name === 'measure') {
          push('measure', args[0], t0 && t0.duration, { start: args[1], end: args[2] });
        } else if (name === 'mark') {
          push('mark', args[0], 0, null);
        } else if (name.indexOf('getEntries') >= 0) {
          push('query:' + name, String(args[0]), 0, (t0 && t0.length !== undefined) ? ('len=' + t0.length) : null);
        } else {
          push(name, args[0], 0, null);
        }
        return t0;
      };
    } catch (e) { push('ERR', 'wrap ' + name + ': ' + e.message, 0, null); }
  }

  ['mark', 'measure', 'getEntriesByType', 'getEntriesByName', 'getEntries'].forEach(function (n) {
    wrapMethod(P, n);
  });

  // now() 只统计调用次数与跨度，不逐条记录（可能被调上千次）
  try {
    var onow = P.now;
    if (typeof onow === 'function') {
      window.__nowCalls = 0;
      window.__nowFirst = null;
      window.__nowLast = null;
      P.now = function () {
        var v = onow.apply(P, arguments);
        window.__nowCalls++;
        if (window.__nowFirst === null) window.__nowFirst = v;
        window.__nowLast = v;
        return v;
      };
    }
  } catch (e) { push('ERR', 'wrap now: ' + e.message, 0, null); }

  // Date.now 也统计（有些实现用它兜底计时）
  try {
    var dnow = Date.now;
    window.__dateCalls = 0;
    Date.now = function () { window.__dateCalls++; return dnow.call(Date); };
  } catch (e) {}

  // 直接读 navigation / paint 条目，看有没有真实数据
  try {
    var navs = P.getEntriesByType ? P.getEntriesByType('navigation') : null;
    push('INFO', 'navigation entries', 0, navs ? ('len=' + navs.length + ' dur=' + (navs[0] && navs[0].duration)) : 'no api');
  } catch (e) { push('ERR', 'read navigation: ' + e.message, 0, null); }
})();
"""

CAPTURE = r"""
(function () {
  var out = {
    perfLog: (window.__perfLog || []).slice(0, 800),
    nowCalls: window.__nowCalls || 0,
    nowSpan: (window.__nowFirst !== null && window.__nowLast !== null)
      ? (Math.round((window.__nowLast - window.__nowFirst) * 1000) / 1000) : null,
    dateCalls: window.__dateCalls || 0,
    payloadLen: (window.__body_full || '').length,
    docCookie: (function () { try { return (document.cookie || '').slice(0, 80); } catch (e) { return 'ERR'; } })(),
  };
  try {
    var b = window.__body_full;
    if (b) {
      var j = JSON.parse(b);
      out.performance = j.performance || null;
      if (j.solution && j.solution.interrogation) {
        out.interrogation = { st: j.solution.interrogation.st, sr: j.solution.interrogation.sr,
                              cr: j.solution.interrogation.cr, og: j.solution.interrogation.og };
        out.pLen = (j.solution.interrogation.p || '').length;
      }
    }
  } catch (e) { out.parseErr = String(e && e.message); }
  return JSON.stringify(out);
})()
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=S.TARGET)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    target = args.url
    print("[1] 取挑战页 %s" % target)
    st, body, hdrs = S.curl(target, referer=None, bare=True)  # ★ 裸头，否则 404 放行
    html = body.decode("utf-8", "replace")
    print("    status=%s len=%d" % (st, len(html)))
    marks = S.is_blocked(html)
    if marks:
        print("    （挑战页特征：%s）" % ", ".join(marks))

    m = S.re.search(r'scriptElement\.src\s*=\s*"([^"]+)"', html) or \
        S.re.search(r'src\s*=\s*"([^"]+\.js[^"]*)"', html)
    if not m:
        print("!! 找不到 sensor 路径，页面结构变了")
        return 2
    import urllib.parse
    vm_url = urllib.parse.urljoin(target, m.group(1))
    print("[2] sensor = %s" % vm_url)

    print("[3] 下载 sensor")
    vm_code = S.fetch_vm(vm_url, referer=target)
    print("    len=%d" % len(vm_code))

    print("[4] iv8 + performance 插桩运行")
    import iv8
    hooks = ""
    if os.path.isfile(S.HOOKS_JS):
        hooks = open(S.HOOKS_JS, encoding="utf-8").read()

    sp = urllib.parse.urlsplit(target)
    env = {
        "location": {
            "href": target, "origin": "%s://%s" % (sp.scheme, sp.netloc),
            "protocol": sp.scheme + ":", "host": sp.netloc, "hostname": sp.hostname or "",
            "port": sp.port or 0, "pathname": sp.path or "/",
            "search": ("?" + sp.query) if sp.query else "", "hash": "",
        },
        "navigator": {
            "userAgent": S.UA, "language": "en-US", "languages": ["en-US", "en"],
            "platform": "Win32", "hardwareConcurrency": 8, "deviceMemory": 8,
            "vendor": "Google Inc.", "webdriver": False,
        },
        "screen": {"width": 1366, "height": 768, "colorDepth": 24},
    }

    # 顺序很关键：补丁 → perf 插桩 → VM，全部 prepend 进同一个 resources 条目
    resources = {vm_url: (hooks + "\n;\n" + PERF_HOOK + "\n;\n" + vm_code)}

    ifr = S.re.search(r'src=["\']([^"\']*_Incapsula_Resource[^"\']*)["\']', html, S.re.I)
    if ifr:
        iu = urllib.parse.urljoin(target, ifr.group(1))
        st2, ib, _ = S.curl(iu, referer=target)
        if st2 == 200:
            resources[iu] = {"body": ib.decode("utf-8", "replace"), "status": 200,
                             "headers": [["content-type", "text/html"]]}

    with iv8.JSContext(environment=env, config={"timezone": "Asia/Shanghai"}) as ctx:
        ctx.expose({"baseURL": target, "html": html, "headers": [], "resources": resources}, "snapshot")
        ctx.eval("__iv8__.page.load(__iv8__.data.snapshot);")
        for _ in range(14):
            ctx.eval("__iv8__.eventLoop.sleep(600);")
        info = json.loads(str(ctx.eval(CAPTURE)))

    print("\n[5] 结果")
    print("    payloadLen = %s" % info.get("payloadLen"))
    print("    performance = %s" % json.dumps(info.get("performance"), ensure_ascii=False))
    print("    interrogation = %s" % json.dumps(info.get("interrogation"), ensure_ascii=False))
    print("    now 调用 %s 次，跨度 %s ms；Date.now 调用 %s 次"
          % (info.get("nowCalls"), info.get("nowSpan"), info.get("dateCalls")))

    log = info.get("perfLog") or []
    print("\n    --- performance 轨迹（%d 条）---" % len(log))
    for e in log[:120]:
        extra = ""
        if e.get("e"):
            extra = " " + json.dumps(e["e"], ensure_ascii=False)
        print("      %-28s %-34s %s%s" % (e.get("k"), e.get("n"), e.get("d"), extra))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        print("\n    写入 %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())

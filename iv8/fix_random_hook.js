// ============================================================
// 固定 Math.random 序列（与 Node 补环境用同一个 mulberry32 实现）
//
// 目的：让两个实现产生相同的 cr → 相同的编码密钥 → payload 可逐字节对比。
// cr 由 sensor 内部的随机数决定，不固定的话每次编码都变，diff 全是噪声。
//
// 用法：把本文件内容 prepend 到 VM 源码前，改 SEED 即可。
// ============================================================
(function () {
  var SEED = 12345;
  var s = SEED >>> 0;
  function rnd() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = rnd;
  try {
    var C = window.crypto || window.msCrypto;
    if (C && C.getRandomValues) {
      var og = C.getRandomValues.bind(C);
      C.getRandomValues = function (arr) {
        for (var i = 0; i < arr.length; i++) arr[i] = (rnd() * 256) | 0;
        return arr;
      };
    }
  } catch (e) {}
  window.__FIX_RANDOM_APPLIED__ = true;
})();

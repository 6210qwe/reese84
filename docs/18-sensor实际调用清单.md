# sensor 实际调用的 API 清单（补环境侧，636 条）

由 `tools/collect_trace.js` 采集，已做栈过滤（只保留 sensor 发起的调用）。

| 次数 | API |
|---|---|
| 169 | `ctx.measureText` |
| 52 | `Fn.toString` |
| 34 | `Object.getOwnPropertyDescriptor` |
| 27 | `WebGL2RenderingContext.getParameter` |
| 12 | `WebGL2RenderingContext.getShaderPrecisionFormat` |
| 11 | `nav.plugins` |
| 8 | `canvas.getContext` |
| 7 | `Object.getOwnPropertyNames` |
| 6 | `doc.cookie` |
| 6 | `canvas.toDataURL` |
| 6 | `ctx.fillRect` |
| 6 | `Object.keys` |
| 6 | `Object.getPrototypeOf` |
| 5 | `nav.userAgent` |
| 5 | `ctx.arc` |
| 4 | `Math.random` |
| 4 | `nav.languages` |
| 4 | `nav.appName` |
| 4 | `ctx.fill` |
| 4 | `nav.vendor` |
| 4 | `nav.hardwareConcurrency` |
| 3 | `ctx.beginPath` |
| 3 | `ctx.closePath` |
| 3 | `ctx.putImageData` |
| 3 | `nav.userAgentData` |
| 3 | `set ctx.font(s:72px AVENIRLTPr` |
| 3 | `set ctx.font(s:72px AgencyFB, ` |
| 3 | `set ctx.font(s:72px AparajitaM` |
| 3 | `set ctx.font(s:72px ArabicType` |
| 3 | `set ctx.font(s:72px ArialUnico` |
| 3 | `set ctx.font(s:72px AvantGarde` |
| 3 | `set ctx.font(s:72px BankGothic` |
| 3 | `set ctx.font(s:72px Bauhaus93,` |
| 3 | `set ctx.font(s:72px BitstreamV` |
| 3 | `set ctx.font(s:72px CenturyGot` |
| 3 | `set ctx.font(s:72px Clarendon,` |
| 3 | `set ctx.font(s:72px EUROSTILE,` |
| 3 | `set ctx.font(s:72px EdwardianS` |
| 3 | `set ctx.font(s:72px FranklinGo` |
| 3 | `set ctx.font(s:72px FuturaBkBT` |
| 3 | `set ctx.font(s:72px FuturaMdBT` |
| 3 | `set ctx.font(s:72px GillSans, ` |
| 3 | `set ctx.font(s:72px HelveticaN` |
| 3 | `set ctx.font(s:72px HighTower,` |
| 3 | `set ctx.font(s:72px Humanst521` |
| 3 | `set ctx.font(s:72px Impacted, ` |
| 3 | `set ctx.font(s:72px KokilaMT, ` |
| 3 | `set ctx.font(s:72px LetterGoth` |
| 3 | `set ctx.font(s:72px LevenimMT,` |
| 3 | `set ctx.font(s:72px LucidaBrig` |
| 3 | `set ctx.font(s:72px LucidaSans` |
| 3 | `set ctx.font(s:72px MSMincho, ` |
| 3 | `set ctx.font(s:72px MSOutlook,` |
| 3 | `set ctx.font(s:72px MSReferenc` |
| 3 | `set ctx.font(s:72px MSUIGothic` |
| 3 | `set ctx.font(s:72px MYRIADPRO,` |
| 3 | `set ctx.font(s:72px MeiryoUI, ` |
| 3 | `set ctx.font(s:72px MicrosoftU` |
| 3 | `set ctx.font(s:72px MinionPro,` |
| 3 | `set ctx.font(s:72px MonotypeCo` |
| 3 | `set ctx.font(s:72px PMingLiU, ` |
| 3 | `set ctx.font(s:72px SCRIPTINA,` |
| 3 | `set ctx.font(s:72px SegoeUILig` |
| 3 | `set ctx.font(s:72px SmallFonts` |
| 3 | `set ctx.font(s:72px Staccato22` |
| 3 | `set ctx.font(s:72px TRAJANPRO,` |
| 3 | `set ctx.font(s:72px UniversCE5` |
| 3 | `set ctx.font(s:72px ZWAdobeF, ` |
| 2 | `nav.mimeTypes` |
| 2 | `matchMedia` |
| 2 | `ctx.rect` |
| 2 | `set ctx.globalCompositeOperati` |
| 2 | `ctx.fillText` |
| 2 | `set ctx.fillStyle(s:rgb(255,0,` |
| 2 | `ctx.getImageData` |
| 2 | `set ctx.globalAlpha(n:0.9) => ` |
| 2 | `WebGL2RenderingContext.getExtension` |
| 2 | `nav.maxTouchPoints` |
| 2 | `set ctx.font(s:72px ARNOPRO, s` |
| 2 | `set ctx.font(s:72px BiomeMT, s` |
| 2 | `set ctx.font(s:72px GishaMT, s` |
| 2 | `set ctx.font(s:72px JuiceIT, s` |
| 2 | `set ctx.font(s:72px MTExtra, s` |
| 2 | `WebGLRenderingContext.getParameter` |
| 2 | `el.offsetHeight` |
| 1 | `doc.readyState` |
| 1 | `OfflineAudioContext.createOscillator` |
| 1 | `webkitOfflineAudioContext.createOscillator` |
| 1 | `nav.language` |
| 1 | `screen.width` |
| 1 | `screen.height` |
| 1 | `screen.availHeight` |
| 1 | `screen.availLeft` |
| 1 | `screen.availTop` |
| 1 | `screen.availWidth` |
| 1 | `screen.pixelDepth` |
| 1 | `win.innerWidth` |
| 1 | `win.innerHeight` |
| 1 | `win.outerWidth` |
| 1 | `win.outerHeight` |
| 1 | `win.devicePixelRatio` |
| 1 | `win.screenX` |
| 1 | `win.screenY` |
| 1 | `nav.platform` |
| 1 | `nav.doNotTrack` |
| 1 | `ctx.globalCompositeOperation` |
| 1 | `set ctx.textBaseline(s:alphabe` |
| 1 | `set ctx.fillStyle(s:#f60) => u` |
| 1 | `set ctx.fillStyle(s:#069) => u` |
| 1 | `set ctx.font(s:11pt Arial) => ` |
| 1 | `set ctx.fillStyle(s:rgba(102, ` |
| 1 | `set ctx.font(s:18pt Arial) => ` |
| 1 | `set ctx.fillStyle(s:rgb(0,255,` |
| 1 | `set ctx.fillStyle(s:rgb(255,25` |
| 1 | `canvas.width` |
| 1 | `canvas.height` |
| 1 | `set ctx.globalAlpha(n:0.3) => ` |
| 1 | `set ctx.fillStyle(s:#cbdba5) =` |
| 1 | `set ctx.globalAlpha(n:0.1) => ` |
| 1 | `set ctx.fillStyle(s:#18aac0) =` |
| 1 | `set ctx.globalAlpha(n:0.2) => ` |
| 1 | `set ctx.fillStyle(s:#a4320e) =` |
| 1 | `set ctx.fillStyle(s:#460ba2) =` |
| 1 | `set ctx.fillStyle(s:#a1ce10) =` |
| 1 | `WebGL2RenderingContext.readPixels` |
| 1 | `WebGL2RenderingContext.getSupportedExtensions` |
| 1 | `WebGL2RenderingContext.getContextAttributes` |
| 1 | `nav.product` |
| 1 | `nav.productSub` |
| 1 | `nav.webdriver` |
| 1 | `set ctx.font(s:72px monospace)` |
| 1 | `set ctx.font(s:72px sans-serif` |
| 1 | `set ctx.font(s:72px serif) => ` |
| 1 | `set ctx.font(s:72px ARNOPRO, m` |
| 1 | `set ctx.font(s:72px Batang, mo` |
| 1 | `set ctx.font(s:72px Batang, sa` |
| 1 | `set ctx.font(s:72px Batang, se` |
| 1 | `set ctx.font(s:72px BiomeMT, m` |
| 1 | `set ctx.font(s:72px Calibri, m` |
| 1 | `set ctx.font(s:72px Century, m` |
| 1 | `set ctx.font(s:72px GOTHAM, mo` |
| 1 | `set ctx.font(s:72px GOTHAM, sa` |
| 1 | `set ctx.font(s:72px GOTHAM, se` |
| 1 | `set ctx.font(s:72px GishaMT, m` |
| 1 | `set ctx.font(s:72px HELV, mono` |
| 1 | `set ctx.font(s:72px HELV, sans` |
| 1 | `set ctx.font(s:72px HELV, seri` |
| 1 | `set ctx.font(s:72px Haettensch` |
| 1 | `set ctx.font(s:72px JuiceIT, m` |
| 1 | `set ctx.font(s:72px Leelawadee` |
| 1 | `set ctx.font(s:72px MTExtra, m` |
| 1 | `set ctx.font(s:72px Marlett, m` |
| 1 | `set ctx.font(s:72px Pristina, ` |
| 1 | `set ctx.font(s:72px Serifa, mo` |
| 1 | `set ctx.font(s:72px Serifa, sa` |
| 1 | `set ctx.font(s:72px Serifa, se` |
| 1 | `set ctx.font(s:72px SimHei, mo` |
| 1 | `set ctx.font(s:72px Vrinda, mo` |
| 1 | `set ctx.font(s:72px Vrinda, sa` |
| 1 | `set ctx.font(s:72px Vrinda, se` |
| 1 | `getComputedStyle` |
| 1 | `nav.deviceMemory` |

## 说明

- `ctx.measureText` 169 次：字体探测，169 个候选族 × 3 个 generic fallback
- `Fn.toString` 52 次：函数形状检测（已用 nativeClass 修过）
- `Object.getOwnPropertyDescriptor` 34 次：属性描述符检测 ← **最可能是我们的破绽**
- `WebGL2.getParameter` 27 次：显卡信息采集
- `canvas.toDataURL` 6 次：canvas 指纹

## 对比 iv8

iv8 侧同一份探针只留下 **13 条**（全是 Math.random）。
原因是 window 被 `page.load` 重置后，探针的包装全部失效 ——
**sensor 实际跑在 iv8 的 C++ 原生 window 上，不是 JS 对象**。
这个"挂不上去"本身就是最重要的信息，详见 `docs/17`。
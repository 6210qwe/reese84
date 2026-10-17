/**
 * 02-media.js —— canvas（真实 Skia 渲染）/ WebGL / AudioContext / 媒体元素
 *
 * 为什么 canvas 必须是真的：
 *   reese84 的 performance 计时对象会随载荷一起上传。实测三组数据——
 *     真实浏览器 performance.total ≈ 7083μs
 *     jsdom（假 canvas）      ≈ 465μs      ← 采集几乎零成本，一眼假
 *     本次（真 Skia）         ≈ 与浏览器同量级
 *   假 canvas 的 measureText 只返回 length*7、零开销，服务端拿这个耗时差就能判定环境不真。
 *   这里用 @napi-rs/canvas（Skia）做真实字体测量与像素渲染，耗时天然真实。
 */

'use strict';

// ══════════════════════════════════════════════════════════════════
// Canvas 2D —— 真渲染后端
// ══════════════════════════════════════════════════════════════════

// 每张 canvas 的宿主后端：{ cv, ctx, w, h }
const __cvBackend = new WeakMap();

function __getBackend(el) {
  let b = __cvBackend.get(el);
  if (!b) {
    const w = el.width || 300, h = el.height || 150;
    b = __HOST__.canvasCreate(w, h);
    __cvBackend.set(el, b);
  }
  return b;
}
function __syncSize(el) {
  const b = __cvBackend.get(el);
  if (!b) return;
  if (b.w !== el.width || b.h !== el.height) {
    __HOST__.canvasResize(b, el.width, el.height);
    b.w = el.width; b.h = el.height;
  }
}

class CanvasRenderingContext2D {
  constructor(canvas) {
    st(this).canvas = canvas;
  }
  get canvas() { return st(this).canvas; }
}
Object.defineProperty(CanvasRenderingContext2D.prototype, Symbol.toStringTag, { value: 'CanvasRenderingContext2D', configurable: true });

// 属性直接映射到宿主 ctx
const CTX_PROPS = [
  'fillStyle', 'strokeStyle', 'globalAlpha', 'globalCompositeOperation', 'lineWidth',
  'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'font', 'textAlign',
  'textBaseline', 'direction', 'shadowBlur', 'shadowColor', 'shadowOffsetX',
  'shadowOffsetY', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'filter',
  'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps',
  'textRendering', 'webkitLineDashOffset',
];
const CTX_METHODS = [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform',
  'resetTransform', 'createLinearGradient', 'createRadialGradient', 'createConicGradient',
  'createPattern', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath',
  'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse',
  'rect', 'roundRect', 'fill', 'stroke', 'clip', 'isPointInPath', 'isPointInStroke',
  'fillText', 'strokeText', 'drawImage', 'createImageData', 'putImageData',
  'setLineDash', 'getLineDash', 'drawFocusIfNeeded', 'reset',
];

function __installCtx2D(proto) {
  const b = (self) => {
    const canvas = st(self).canvas;
    __syncSize(canvas);
    return __getBackend(canvas);
  };
  const bSafe = (self, where) => {
    try { return b(self); }
    catch (e) { __HOST__.log('!! canvas 后端获取失败 (%s): %s', where, (e && e.message) || e); return null; }
  };
  for (const p of CTX_PROPS) {
    Object.defineProperty(proto, p, {
      configurable: true, enumerable: true,
      get() {
        const be = bSafe(this, 'get ' + p);
        if (!be) return '';
        try { return be.ctx[p]; } catch (e) { return ''; }
      },
      set(v) {
        const be = bSafe(this, 'set ' + p);
        if (!be) return;
        try { be.ctx[p] = v; } catch (e) {}
      },
    });
  }
  for (const m of CTX_METHODS) {
    defMethod(proto, m, function (...args) {
      const be = bSafe(this, m);
      if (!be) return undefined;
      try { return be.ctx[m](...args); } catch (e) {
        __HOST__.log('!! ctx.%s 异常: %s', m, (e && e.message) || e);
        return undefined;
      }
    });
  }
  defMethod(proto, 'measureText', function (text) {
    try { __HOST__._bump('canvas.measureText'); } catch (e) {}
    // 记录被测量的 font 声明：字体探测的调用数差一倍时，靠这张表能一眼看出
    // 是"候选集少了"还是"循环轮数少了"
    try { __HOST__._fontUse(this.font); } catch (e) {}
    // 真实浏览器里 measureText 要走 HarfBuzz+DirectWrite 整形，单次约 5~20μs；
    // Skia 的 measureText 只要 0.5~2μs。reese84 会把整段采集耗时上传，
    // 快 10 倍本身就是"非浏览器"的证据，这里用 spin 补齐到浏览器量级。
    try {
      const us = __HOST__.cfg.measureCostUs;
      if (us) __HOST__.busy(us);
    } catch (e) {}
    try {
      const be = bSafe(this, 'measureText');
      if (!be) return { width: 0 };
      const tm = be.ctx.measureText(String(text));
      // 组装成 vm 域的 TextMetrics
      return {
        width: tm.width,
        actualBoundingBoxLeft: tm.actualBoundingBoxLeft !== undefined ? tm.actualBoundingBoxLeft : 0,
        actualBoundingBoxRight: tm.actualBoundingBoxRight !== undefined ? tm.actualBoundingBoxRight : tm.width,
        actualBoundingBoxAscent: tm.actualBoundingBoxAscent !== undefined ? tm.actualBoundingBoxAscent : 8,
        actualBoundingBoxDescent: tm.actualBoundingBoxDescent !== undefined ? tm.actualBoundingBoxDescent : 2,
        fontBoundingBoxAscent: tm.fontBoundingBoxAscent !== undefined ? tm.fontBoundingBoxAscent : 11,
        fontBoundingBoxDescent: tm.fontBoundingBoxDescent !== undefined ? tm.fontBoundingBoxDescent : 3,
        emHeightAscent: tm.emHeightAscent !== undefined ? tm.emHeightAscent : 11,
        emHeightDescent: tm.emHeightDescent !== undefined ? tm.emHeightDescent : 3,
        hangingBaseline: tm.hangingBaseline !== undefined ? tm.hangingBaseline : 9,
        alphabeticBaseline: 0,
        ideographicBaseline: tm.ideographicBaseline !== undefined ? tm.ideographicBaseline : -3,
      };
    } catch (e) {
      return { width: String(text).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
    }
  });
  defMethod(proto, 'getImageData', function (x, y, w, h, settings) {
    try { __HOST__._bump('canvas.getImageData'); } catch (e) {}
    try {
      const be = b(this);
      const gi = be.ctx.getImageData(x, y, w, h);
      const img = {
        width: gi.width, height: gi.height, colorSpace: 'srgb',
        data: new Uint8ClampedArray(gi.data),
      };
      return img;
    } catch (e) {
      return { width: w | 0, height: h | 0, colorSpace: 'srgb', data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)) };
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// WebGL —— 数值来自 baseline（Chrome/Windows + AMD 集显，与本机真实硬件一致）
// ══════════════════════════════════════════════════════════════════

const GL_CONST = {
  DEPTH_BUFFER_BIT: 256, STENCIL_BUFFER_BIT: 1024, COLOR_BUFFER_BIT: 16384,
  POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6,
  ZERO: 0, ONE: 1, SRC_COLOR: 768, ONE_MINUS_SRC_COLOR: 769, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771,
  DST_ALPHA: 772, ONE_MINUS_DST_ALPHA: 773, DST_COLOR: 774, ONE_MINUS_DST_COLOR: 775,
  FUNC_ADD: 32774, BLEND_EQUATION: 32777, BLEND_EQUATION_RGB: 32777, BLEND_EQUATION_ALPHA: 34877,
  ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048,
  FLOAT: 5126, UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, BYTE: 5120, SHORT: 5122, INT: 5124,
  TEXTURE_2D: 3553, TEXTURE0: 33984, RGBA: 6408, RGB: 6407, LUMINANCE: 6409, ALPHA: 6406,
  NEAREST: 9728, LINEAR: 9729, CLAMP_TO_EDGE: 33071, REPEAT: 10497,
  FRAGMENT_SHADER: 35632, VERTEX_SHADER: 35633, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
  VENDOR: 7936, RENDERER: 7937, VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724,
  MAX_TEXTURE_SIZE: 3379, MAX_VIEWPORT_DIMS: 3386, MAX_VERTEX_ATTRIBS: 34921,
  MAX_TEXTURE_IMAGE_UNITS: 34930, MAX_VARYING_VECTORS: 36348, MAX_VERTEX_UNIFORM_VECTORS: 36347,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_RENDERBUFFER_SIZE: 34024,
  UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446,
  NO_ERROR: 0, ACTIVE_TEXTURE: 34016, VIEWPORT: 2978, SCISSOR_BOX: 3088,
};

const GL_PARAMS = {
  7936: 'WebKit',                                       // VENDOR
  7937: 'WebKit WebGL',                                 // RENDERER
  7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',           // VERSION
  35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
  37445: 'Google Inc. (AMD)',
  37446: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  3379: 16384, 34921: 16, 34930: 16, 35660: 16, 35661: 32,
  36347: 4096, 36348: 30, 36349: 1024, 34076: 16384, 34024: 16384,
  2978: new Int32Array([0, 0, 1340, 757]),
  3088: new Int32Array([0, 0, 1340, 757]),
  34016: 33984, 34047: 16,
};
const GL_EXTS = [
  'ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_clip_control', 'EXT_color_buffer_half_float',
  'EXT_depth_clamp', 'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_frag_depth',
  'EXT_polygon_offset_clamp', 'EXT_shader_texture_lod', 'EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic', 'EXT_texture_mirror_clamp_to_edge',
  'EXT_sRGB', 'KHR_parallel_shader_compile', 'OES_element_index_uint', 'OES_fbo_render_mipmap',
  'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_blend_func_extended',
  'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers',
  'WEBGL_lose_context', 'WEBGL_multi_draw', 'WEBGL_polygon_mode',
  // WebGL2 专属（实测真实 Edge 存在，缺失会让 webgl_meta 一律对不上）
  'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_render_snorm',
  'EXT_texture_norm16', 'OES_draw_buffers_indexed', 'OES_sample_variables',
  'OVR_multiview2', 'WEBGL_provoking_vertex', 'WEBGL_clip_cull_distance',
  'KHR_parallel_shader_compile', 'EXT_conservative_depth',
];

// ★ WebGL1 与 WebGL2 的扩展集不同：EXT_color_buffer_float 只有 WebGL2 有。
//   混在一起会让 webgl_meta 哈希对上但 supported_extensions 名单不对，反过来也一样。
const GL2_ONLY = new Set([
  'EXT_color_buffer_float', 'EXT_render_snorm', 'EXT_texture_norm16',
  'OES_draw_buffers_indexed', 'OES_sample_variables', 'OVR_multiview2',
  'WEBGL_provoking_vertex', 'WEBGL_clip_cull_distance', 'EXT_conservative_depth',
  'WEBGL_multi_draw',
]);

class WebGLRenderingContext {
  constructor(canvas) {
    st(this).canvas = canvas;
    st(this).lost = false;
    st(this).drawingBufferWidth = canvas.width;
    st(this).drawingBufferHeight = canvas.height;
  }
  get canvas() { return st(this).canvas; }
  get drawingBufferWidth() { return st(this).drawingBufferWidth; }
  get drawingBufferHeight() { return st(this).drawingBufferHeight; }
}
Object.defineProperty(WebGLRenderingContext.prototype, Symbol.toStringTag, { value: 'WebGLRenderingContext', configurable: true });

function __installGL(proto, isGL2) {
  for (const [k, v] of Object.entries(GL_CONST)) {
    if (proto[k] === undefined) defValue(proto, k, v, true);
  }
  defMethod(proto, 'getParameter', function (p) {
    try { __HOST__._bump('gl.getParameter'); } catch (e) {}
    // ★ 这些字符串必须是本机真实显卡上报的原话。
    //   手写 "AMD Radeon(TM) Graphics Direct3D11" 少了型号 id 与空格，
    //   与 navigator/screen 一起看就是"自造指纹"。baseline 来自真实 Edge。
    const BW = (__CFG.baseline || {}).webgl || null;
    if (BW) {
      if (p === 7936) return BW.vendor;
      if (p === 7937) return BW.renderer;
      if (p === 7938) return BW.version;
      if (p === 35724) return BW.shading;
      if (p === 37445) return BW.unmaskedVendor;
      if (p === 37446) return BW.unmaskedRenderer;
      const bp = BW.params && BW.params[String(p)];
      if (bp !== undefined && bp !== null) return bp;
    }
    if (p === 7936) return 'WebKit';
    if (p === 7937) return 'WebKit WebGL';
    if (p === 7938) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
    if (p === 35724) return 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';
    if (p === 37445) return 'Google Inc. (AMD)';
    if (p === 37446) return 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const v = GL_PARAMS[p];
    if (v !== undefined) return v;
    return 8;
  });
  defMethod(proto, 'getExtension', function (name) {
    try { __HOST__._bump('gl.getExtension'); } catch (e) {}
    const n = String(name);
    if (n === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    if (n === 'WEBGL_lose_context') return { loseContext() {}, restoreContext() {} };
    if (/instanced_arrays/.test(n)) return { VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 35070, drawArraysInstancedANGLE() {}, drawElementsInstancedANGLE() {}, vertexAttribDivisorANGLE() {} };
    if (/vertex_array_object/.test(n)) return { createVertexArrayOES() { return {}; }, bindVertexArrayOES() {}, deleteVertexArrayOES() {} };
    if (/texture_filter_anisotropic/.test(n)) return { TEXTURE_MAX_ANISOTROPY_EXT: 34046, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 };
    if (GL_EXTS.indexOf(n) >= 0 && (isGL2 || !GL2_ONLY.has(n))) return {};
    return null;
  });
  defMethod(proto, 'getSupportedExtensions', function () {
    // isGL2 由 __installGL 的第二个参数决定，闭包捕获
    return GL_EXTS.filter((n) => (isGL2 ? true : !GL2_ONLY.has(n))).slice();
  });
  defMethod(proto, 'getShaderPrecisionFormat', function () {
    return { precision: 23, rangeMin: 127, rangeMax: 127 };
  });
  defMethod(proto, 'getContextAttributes', function () {
    return { alpha: true, antialias: true, depth: true, failIfMajorPerformanceCaveat: false, desynchronized: false, powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false };
  });
  defMethod(proto, 'getError', function () { return 0; });
  defMethod(proto, 'getShaderParameter', function () { return true; });
  defMethod(proto, 'getProgramParameter', function () { return true; });
  defMethod(proto, 'getShaderInfoLog', function () { return ''; });
  defMethod(proto, 'getProgramInfoLog', function () { return ''; });
  defMethod(proto, 'getAttribLocation', function () { return 0; });
  defMethod(proto, 'getUniformLocation', function () { return {}; });
  defMethod(proto, 'getActiveAttrib', function () { return null; });
  defMethod(proto, 'getActiveUniform', function () { return null; });
  defMethod(proto, 'getAttachedShaders', function () { return []; });
  defMethod(proto, 'getUniform', function () { return null; });
  defMethod(proto, 'getVertexAttrib', function () { return 0; });
  defMethod(proto, 'getFramebufferAttachmentParameter', function () { return 0; });
  defMethod(proto, 'getRenderbufferParameter', function () { return 0; });
  defMethod(proto, 'getTexParameter', function () { return 0; });
  defMethod(proto, 'getBufferParameter', function () { return 0; });
  defMethod(proto, 'isContextLost', function () { return false; });
  defMethod(proto, 'isEnabled', function () { return false; });
  defMethod(proto, 'readPixels', function () {});
  defMethod(proto, 'checkFramebufferStatus', function () { return 36053; });
  const noop = ['activeTexture', 'attachShader', 'bindAttribLocation', 'bindBuffer', 'bindFramebuffer',
    'bindRenderbuffer', 'bindTexture', 'blendColor', 'blendEquation', 'blendEquationSeparate',
    'blendFunc', 'blendFuncSeparate', 'bufferData', 'bufferSubData', 'clear', 'clearColor',
    'clearDepth', 'clearStencil', 'colorMask', 'compileShader', 'copyTexImage2D',
    'copyTexSubImage2D', 'cullFace', 'depthFunc', 'depthMask', 'depthRange', 'detachShader',
    'disable', 'disableVertexAttribArray', 'drawArrays', 'drawElements', 'enable',
    'enableVertexAttribArray', 'finish', 'flush', 'framebufferRenderbuffer',
    'framebufferTexture2D', 'frontFace', 'generateMipmap', 'hint', 'lineWidth', 'linkProgram',
    'pixelStorei', 'polygonOffset', 'renderbufferStorage', 'sampleCoverage', 'scissor',
    'shaderSource', 'stencilFunc', 'stencilFuncSeparate', 'stencilMask',
    'stencilMaskSeparate', 'stencilOp', 'stencilOpSeparate', 'texImage2D', 'texParameterf',
    'texParameteri', 'texSubImage2D', 'uniform1f', 'uniform1fv', 'uniform1i', 'uniform1iv',
    'uniform2f', 'uniform2fv', 'uniform2i', 'uniform2iv', 'uniform3f', 'uniform3fv',
    'uniform3i', 'uniform3iv', 'uniform4f', 'uniform4fv', 'uniform4i', 'uniform4iv',
    'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'useProgram', 'validateProgram',
    'vertexAttrib1f', 'vertexAttrib1fv', 'vertexAttrib2f', 'vertexAttrib2fv', 'vertexAttrib3f',
    'vertexAttrib3fv', 'vertexAttrib4f', 'vertexAttrib4fv', 'vertexAttribPointer', 'viewport',
    'blendEquationIO', 'drawBuffers', 'bindVertexArray'];
  for (const m of noop) {
    if (proto[m] === undefined) defMethod(proto, m, function () {});
  }
  for (const m of ['createBuffer', 'createFramebuffer', 'createProgram', 'createRenderbuffer',
    'createShader', 'createTexture', 'createVertexArray']) {
    defMethod(proto, m, function () { return {}; });
  }
  for (const m of ['deleteBuffer', 'deleteFramebuffer', 'deleteProgram', 'deleteRenderbuffer',
    'deleteShader', 'deleteTexture', 'deleteVertexArray']) {
    defMethod(proto, m, function () {});
  }
  if (isGL2) {
    defValue(proto, 'TEXTURE_BINDING_3D', 32874, true);
    defValue(proto, 'MAX_3D_TEXTURE_SIZE', 32883, true);
    defValue(proto, 'MAX_DRAW_BUFFERS', 34852, true);
    defValue(proto, 'MAX_ARRAY_TEXTURE_LAYERS', 35071, true);
    defMethod(proto, 'createQuery', function () { return {}; });
    defMethod(proto, 'createSampler', function () { return {}; });
    defMethod(proto, 'createTransformFeedback', function () { return {}; });
    defMethod(proto, 'getIndexedParameter', function () { return 0; });
  }
}

class WebGL2RenderingContext extends WebGLRenderingContext {}
Object.defineProperty(WebGL2RenderingContext.prototype, Symbol.toStringTag, { value: 'WebGL2RenderingContext', configurable: true });

// ══════════════════════════════════════════════════════════════════
// AudioContext —— 真实离线渲染（reese84 的 audio 指纹依赖它）
// ══════════════════════════════════════════════════════════════════

class AudioNode {
  constructor(ctx) { st(this).ctx = ctx; st(this).connections = []; }
  connect(dest) { st(this).connections.push(dest); return dest; }
  disconnect() { st(this).connections.length = 0; }
  addEventListener() {}
  removeEventListener() {}
}
class AudioParam {
  constructor(v) { st(this).value = v; st(this).defaultValue = v; st(this).now = v; }
  get value() { return st(this).value; }
  set value(v) { st(this).value = v; }
  get defaultValue() { return st(this).defaultValue; }
  get minValue() { return -3.4028234663852886e38; }
  get maxValue() { return 3.4028234663852886e38; }
  setValueAtTime(v) { st(this).value = v; return this; }
  linearRampToValueAtTime(v) { st(this).value = v; return this; }
  exponentialRampToValueAtTime(v) { st(this).value = v; return this; }
  setTargetAtTime(v) { st(this).value = v; return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

// 用一个真实的可复现抖动（xorshift）生成音频波形，模拟振荡器-压缩器链的输出
function __oscWave(len, sr, freq) {
  const out = new Float32Array(len);
  let s = 0x9e3779b9;
  for (let i = 0; i < len; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const noise = (s / 0xffffffff) - 0.5;
    const t = i / sr;
    out[i] = Math.sin(2 * Math.PI * freq * t) * 0.6 + Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.2 + noise * 0.02;
  }
  return out;
}

class AudioContext extends EventTarget {
  constructor(opts) {
    super();
    const s = st(this);
    s.sampleRate = 48000;
    s.currentTime = 0;
    s.state = 'running';
    s.baseLatency = 0.01;
    s.outputLatency = 0.01;
    s.destination = new AudioNode(this);
    s.destination.maxChannelCount = 2;
    s.destination.channelCount = 2;
    s.destination.numberOfInputs = 0;
    s.destination.numberOfOutputs = 1;
    s.listener = {
      positionX: new AudioParam(0), positionY: new AudioParam(0), positionZ: new AudioParam(0),
      forwardX: new AudioParam(0), forwardY: new AudioParam(0), forwardZ: new AudioParam(-1),
      upX: new AudioParam(0), upY: new AudioParam(1), upZ: new AudioParam(0),
      setPosition() {}, setOrientation() {},
    };
  }
  get sampleRate() { return st(this).sampleRate; }
  get currentTime() { return st(this).currentTime; }
  get state() { return st(this).state; }
  get baseLatency() { return st(this).baseLatency; }
  get outputLatency() { return st(this).outputLatency; }
  get destination() { return st(this).destination; }
  get listener() { return st(this).listener; }
  get audioWorklet() { return { addModule: () => Promise.resolve() }; }
  createOscillator() {
    const ctx = this;
    const o = new AudioNode(this);
    const s = st(o);
    s.type = 'sine';
    s.frequency = new AudioParam(440);
    s.detune = new AudioParam(0);
    s.started = false;
    o.start = nativeLike(function (t) {
      s.started = true;
      s.startTime = t || 0;
      // 真实振荡器一旦接上 destination，就产生可测输出
      try {
        if (st(o).connections.indexOf(st(ctx).destination) >= 0) {
          __HOST__.noteOscillator(s.type, s.frequency.value, s.detune.value);
        }
      } catch (e) {}
    }, 'start');
    o.stop = nativeLike(function () { s.stopped = true; }, 'stop');
    o.setPeriodicWave = nativeLike(function () {}, 'setPeriodicWave');
    return o;
  }
  createGain() {
    const g = new AudioNode(this);
    g.gain = new AudioParam(1);
    return g;
  }
  createDynamicsCompressor() {
    const c = new AudioNode(this);
    c.threshold = new AudioParam(-24);
    c.knee = new AudioParam(30);
    c.ratio = new AudioParam(12);
    c.attack = new AudioParam(0.003);
    c.release = new AudioParam(0.25);
    c.reduction = 0;
    return c;
  }
  createAnalyser() {
    const a = new AudioNode(this);
    a.fftSize = 2048;
    a.frequencyBinCount = 1024;
    a.minDecibels = -100;
    a.maxDecibels = -30;
    a.smoothingTimeConstant = 0.8;
    a.getByteFrequencyData = nativeLike(function (arr) { for (let i = 0; i < arr.length; i++) arr[i] = (i * 7) & 255; }, 'getByteFrequencyData');
    a.getFloatFrequencyData = nativeLike(function (arr) { for (let i = 0; i < arr.length; i++) arr[i] = -60 - (i % 40); }, 'getFloatFrequencyData');
    a.getByteTimeDomainData = nativeLike(function (arr) { for (let i = 0; i < arr.length; i++) arr[i] = 128; }, 'getByteTimeDomainData');
    a.getFloatTimeDomainData = nativeLike(function (arr) { arr.fill(0); }, 'getFloatTimeDomainData');
    return a;
  }
  createBufferSource() {
    const b = new AudioNode(this);
    b.buffer = null;
    b.playbackRate = new AudioParam(1);
    b.loop = false;
    b.start = nativeLike(function () {}, 'start');
    b.stop = nativeLike(function () {}, 'stop');
    return b;
  }
  createBuffer(channels, length, sampleRate) {
    const data = [];
    for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
    const buf = {
      numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: nativeLike(function (c) { return data[c] || data[0]; }, 'getChannelData'),
      copyFromChannel: nativeLike(function (dst, c, off) {
        const src = data[c] || data[0];
        for (let i = 0; i < dst.length; i++) dst[i] = src[(off || 0) + i] || 0;
      }, 'copyFromChannel'),
      copyToChannel: nativeLike(function (src, c, off) {
        const dst = data[c] || data[0];
        for (let i = 0; i < src.length; i++) dst[(off || 0) + i] = src[i];
      }, 'copyToChannel'),
    };
    return buf;
  }
  createChannelMerger() { return new AudioNode(this); }
  createChannelSplitter() { return new AudioNode(this); }
  createConvolver() { return new AudioNode(this); }
  createDelay() { const d = new AudioNode(this); d.delayTime = new AudioParam(0); return d; }
  createBiquadFilter() {
    const f = new AudioNode(this);
    f.type = 'lowpass';
    f.frequency = new AudioParam(350);
    f.Q = new AudioParam(1);
    f.gain = new AudioParam(0);
    f.detune = new AudioParam(0);
    return f;
  }
  createWaveShaper() { const w = new AudioNode(this); w.curve = null; w.oversample = 'none'; return w; }
  createPanner() { return new AudioNode(this); }
  createStereoPanner() { const p = new AudioNode(this); p.pan = new AudioParam(0); return p; }
  createIIRFilter() { return new AudioNode(this); }
  createConstantSource() { const c = new AudioNode(this); c.offset = new AudioParam(1); c.start = () => {}; c.stop = () => {}; return c; }
  createPeriodicWave() { return { __periodicWave: true }; }
  decodeAudioData() { return Promise.reject(new Error('Unable to decode audio data')); }
  resume() { st(this).state = 'running'; return Promise.resolve(); }
  suspend() { st(this).state = 'suspended'; return Promise.resolve(); }
  close() { st(this).state = 'closed'; return Promise.resolve(); }
}
Object.defineProperty(AudioContext.prototype, Symbol.toStringTag, { value: 'AudioContext', configurable: true });

class OfflineAudioContext extends EventTarget {
  constructor(a, b, c) {
    super();
    let channels = 1, length = 5000, sampleRate = 44100;
    if (typeof a === 'object' && a) { channels = a.numberOfChannels || 1; length = a.length || 5000; sampleRate = a.sampleRate || 44100; }
    else { channels = a || 1; length = b || 5000; sampleRate = c || 44100; }
    const s = st(this);
    s.channels = channels; s.length = length; s.sampleRate = sampleRate;
    s.currentTime = 0; s.state = 'suspended';
    s.destination = new AudioNode(this);
    s.destination.maxChannelCount = channels;
    s.osc = [];
    s.oncomplete = null;
  }
  get sampleRate() { return st(this).sampleRate; }
  get length() { return st(this).length; }
  get currentTime() { return st(this).currentTime; }
  get state() { return st(this).state; }
  get destination() { return st(this).destination; }
  get oncomplete() { return st(this).oncompleteFn || null; }
  set oncomplete(fn) { st(this).oncompleteFn = fn; }
  createOscillator() {
    const o = new AudioContext().createOscillator();
    st(this).osc.push(st(o) && { type: st(o).type, freq: st(o).frequency.value });
    return o;
  }
  createGain() { return new AudioContext().createGain(); }
  createDynamicsCompressor() { return new AudioContext().createDynamicsCompressor(); }
  createBuffer(ch, len, sr) { return new AudioContext().createBuffer(ch, len, sr); }
  createBufferSource() { return new AudioContext().createBufferSource(); }
  createAnalyser() { return new AudioContext().createAnalyser(); }
  createBiquadFilter() { return new AudioContext().createBiquadFilter(); }
  createChannelMerger() { return new AudioNode(this); }
  createChannelSplitter() { return new AudioNode(this); }
  createConstantSource() { return new AudioContext().createConstantSource(); }
  createStereoPanner() { return new AudioContext().createStereoPanner(); }
  createWaveShaper() { return new AudioContext().createWaveShaper(); }
  createDelay() { return new AudioContext().createDelay(); }
  createPanner() { return new AudioContext().createPanner(); }
  createConvolver() { return new AudioContext().createConvolver(); }
  createIIRFilter() { return new AudioNode(this); }
  createPeriodicWave() { return {}; }
  addEventListener(t, f, o) { super.addEventListener(t, f, o); }
  startRendering() {
    const s = st(this);
    s.state = 'running';
    const len = s.length, sr = s.sampleRate;
    const bufs = [];
    for (let c = 0; c < s.channels; c++) {
      const osc = s.osc[0];
      const data = __oscWave(len, sr, osc && osc.freq ? osc.freq : 10000);
      // 压缩器：浏览器实测输出量级在 ±0.2 左右
      for (let i = 0; i < len; i++) data[i] = Math.tanh(data[i] * 0.5) * 0.35;
      bufs.push(data);
    }
    const rendered = {
      numberOfChannels: s.channels, length: len, sampleRate: sr, duration: len / sr,
      getChannelData: nativeLike(function (c) { return bufs[c] || bufs[0]; }, 'getChannelData'),
      copyFromChannel: nativeLike(function (dst, c, off) {
        const src = bufs[c] || bufs[0];
        for (let i = 0; i < dst.length; i++) dst[i] = src[(off || 0) + i] || 0;
      }, 'copyFromChannel'),
      copyToChannel: nativeLike(() => {}, 'copyToChannel'),
    };
    s.state = 'closed';
    return Promise.resolve(rendered).then((r) => {
      const ev = new Event('complete');
      st(ev).target = this;
      try { if (s.oncompleteFn) s.oncompleteFn(ev); } catch (e) {}
      try { this.dispatchEvent(ev); } catch (e) {}
      return r;
    });
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  startRendering2() { return this.startRendering(); }
}
Object.defineProperty(OfflineAudioContext.prototype, Symbol.toStringTag, { value: 'OfflineAudioContext', configurable: true });

// ══════════════════════════════════════════════════════════════════
// 把方法/属性真正装到原型上
// ★ 这两个安装调用漏掉的话：ctx 上没有任何方法，全局对象里也只剩个空壳类，
//   sensor 的"能力探测"（读 ctx.rect / ctx.fillRect / ctx.measureText）全部拿到 undefined，
//   于是它静默跳过 canvas 采集 → payload 少 30%、performance 主体段只剩几十微秒、
//   最终载荷的 xorshift 重排因为没有指纹种子而退化成恒等置换（明文），服务端直接 400。
// ══════════════════════════════════════════════════════════════════

__installCtx2D(CanvasRenderingContext2D.prototype);
__installGL(WebGLRenderingContext.prototype, false);
__installGL(WebGL2RenderingContext.prototype, true);

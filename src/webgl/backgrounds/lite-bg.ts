/**
 * lite-bg — лёгкий шейдерный фон для шапок внутренних страниц (BRIEF §10): чистый WebGL2 без three
 * (~6 KB), тот же GLSL, что и на главной. Рендер только пока элемент виден, DPR ≤ 1, при reduced-motion —
 * один кадр. Без WebGL2 остаётся CSS-фон темы.
 */
import { BG_MODES, BG_VERT, BG_FRAG_BODY, type BgMode } from './bgShader';

const FRAG = BG_FRAG_BODY.replace('//__OUTPUT__', 'gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));');
const VERT = BG_VERT.replace('varying vec2 vUv;', 'attribute vec3 position;\nattribute vec2 uv;\nvarying vec2 vUv;');

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader');
  }
  return sh;
}

export function mountLiteBackground(canvas: HTMLCanvasElement, mode: BgMode, opts: { beam?: number } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' }) as WebGLRenderingContext | null;
  if (!gl) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // fullscreen quad: xyz + uv
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'position');
  const aUv = gl.getAttribLocation(prog, 'uv');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 20, 12);

  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uTime = u('uTime');
  const uRes = u('uRes');
  const uMouse = u('uMouse');
  gl.uniform1f(u('uScroll'), 0);
  gl.uniform1f(u('uModeA'), BG_MODES[mode]);
  gl.uniform1f(u('uModeB'), BG_MODES[mode]);
  gl.uniform1f(u('uMix'), 0);
  gl.uniform1f(u('uMaskType'), 0);
  gl.uniform1f(u('uBeam'), opts.beam ?? 0);
  gl.uniform2f(u('uBeamPos'), 0.4, -1.0);
  gl.uniform1f(u('uLightX'), 0);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mx = 0;
  let my = 0;
  let visible = true;
  let raf = 0;
  const start = performance.now();

  const resize = () => {
    // фон мягкий — половинного разрешения достаточно, экономим GPU/CPU
    const dpr = Math.min(window.devicePixelRatio || 1, 1) * 0.6;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  };

  const draw = () => {
    resize();
    gl.uniform1f(uTime, (performance.now() - start) / 1000);
    gl.uniform2f(uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  let last = 0;
  const loop = (t: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    // ~30 fps достаточно для медленного фона
    if (t - last >= 30) {
      last = t;
      draw();
    }
    if (!reduced) raf = requestAnimationFrame(loop);
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible && !raf) raf = requestAnimationFrame(loop);
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible && !raf) raf = requestAnimationFrame(loop);
  });
  window.addEventListener('resize', () => draw(), { passive: true });
  window.addEventListener(
    'pointermove',
    (e) => {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = -((e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true },
  );
  draw();
  if (!reduced) raf = requestAnimationFrame(loop);
  canvas.classList.add('is-ready');
  return { destroy: () => cancelAnimationFrame(raf) };
}

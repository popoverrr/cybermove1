/**
 * Polyline — ломаная/кривая постоянной экранной толщины по массиву точек.
 * Используется для траектории (S2), связей графа (S3), лент потоков (S5), лазерного контура (S6).
 * uDraw рисует линию прогрессивно (0..1 по длине), uDash — бегущий пунктир (ощущение потока).
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aT;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uTaper;     // 0 — постоянная толщина, 1 — сужение к концу
varying float vT;
varying float vDepth;
void main() {
  vec4 cur = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 nxt = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
  vec4 prv = projectionMatrix * modelViewMatrix * vec4(aPrev, 1.0);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 sc = cur.xy / cur.w * aspect;
  vec2 sn = nxt.xy / nxt.w * aspect;
  vec2 sp = prv.xy / prv.w * aspect;
  vec2 d1 = sn - sc;
  vec2 d2 = sc - sp;
  vec2 dir = normalize(length(d1) > 1e-6 && length(d2) > 1e-6 ? normalize(d1) + normalize(d2) : (length(d1) > 1e-6 ? d1 : d2));
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uWidth * mix(1.0, 1.0 - aT, uTaper);
  vec2 off = nrm * aSide * w / uResolution.y * 2.0;
  off /= aspect;
  cur.xy += off * cur.w;
  gl_Position = cur;
  vT = aT;
  vDepth = -(modelViewMatrix * vec4(position, 1.0)).z;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uDraw;
uniform float uDash;      // частота пунктира (0 — сплошная)
uniform float uDashSpeed;
uniform float uTime;
uniform float uAdditive;
uniform float uFadeEnds;
varying float vT;
varying float vDepth;
void main() {
  if (vT > uDraw) discard;
  float a = uOpacity;
  // кончик прорисовки чуть ярче
  a *= 1.0 + 0.8 * smoothstep(0.06, 0.0, uDraw - vT) * step(uDraw, 0.999);
  if (uDash > 0.0) {
    float d = fract(vT * uDash - uTime * uDashSpeed);
    a *= 0.35 + 0.65 * smoothstep(0.55, 0.15, d);
  }
  a *= mix(1.0, smoothstep(0.0, 0.08, vT) * smoothstep(1.0, 0.92, vT), uFadeEnds);
  if (a < 0.003) discard;
  vec3 col = mix(uColor, uColor2, vT) * a;
  gl_FragColor = vec4(col, a * (1.0 - uAdditive));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Polyline {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly uniforms: {
    uResolution: THREE.IUniform<THREE.Vector2>;
    uWidth: THREE.IUniform<number>;
    uTaper: THREE.IUniform<number>;
    uColor: THREE.IUniform<THREE.Color>;
    uColor2: THREE.IUniform<THREE.Color>;
    uOpacity: THREE.IUniform<number>;
    uDraw: THREE.IUniform<number>;
    uDash: THREE.IUniform<number>;
    uDashSpeed: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>;
    uAdditive: THREE.IUniform<number>;
    uFadeEnds: THREE.IUniform<number>;
  };
  private posAttr: THREE.BufferAttribute;
  private prevAttr: THREE.BufferAttribute;
  private nextAttr: THREE.BufferAttribute;
  readonly count: number;

  constructor(points: Float32Array | number, resolution: THREE.Vector2, opts: { width?: number; color?: THREE.ColorRepresentation; color2?: THREE.ColorRepresentation; opacity?: number } = {}) {
    const n = typeof points === 'number' ? points : points.length / 3;
    this.count = n;
    const pos = new Float32Array(n * 2 * 3);
    const prev = new Float32Array(n * 2 * 3);
    const next = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const t = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
      t[i * 2] = t[i * 2 + 1] = i / (n - 1);
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.prevAttr = new THREE.BufferAttribute(prev, 3).setUsage(THREE.DynamicDrawUsage);
    this.nextAttr = new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aPrev', this.prevAttr);
    g.setAttribute('aNext', this.nextAttr);
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    this.uniforms = {
      uResolution: { value: resolution },
      uWidth: { value: opts.width ?? 1 },
      uTaper: { value: 0 },
      uColor: { value: new THREE.Color(opts.color ?? 0xc9ced6) },
      uColor2: { value: new THREE.Color(opts.color2 ?? opts.color ?? 0xc9ced6) },
      uOpacity: { value: opts.opacity ?? 0.7 },
      uDraw: { value: 1 },
      uDash: { value: 0 },
      uDashSpeed: { value: 0.6 },
      uTime: { value: 0 },
      uAdditive: { value: 1 },
      uFadeEnds: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    if (typeof points !== 'number') this.setPoints(points);
  }

  /** Обновить точки (длина = count*3) */
  setPoints(points: Float32Array) {
    const n = this.count;
    const pos = this.posAttr.array as Float32Array;
    const prev = this.prevAttr.array as Float32Array;
    const next = this.nextAttr.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const ip = Math.max(0, i - 1);
      const inx = Math.min(n - 1, i + 1);
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        pos[o] = points[i * 3];
        pos[o + 1] = points[i * 3 + 1];
        pos[o + 2] = points[i * 3 + 2];
        prev[o] = points[ip * 3];
        prev[o + 1] = points[ip * 3 + 1];
        prev[o + 2] = points[ip * 3 + 2];
        next[o] = points[inx * 3];
        next[o + 1] = points[inx * 3 + 1];
        next[o + 2] = points[inx * 3 + 2];
      }
    }
    this.posAttr.needsUpdate = true;
    this.prevAttr.needsUpdate = true;
    this.nextAttr.needsUpdate = true;
  }

  update(time: number) {
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Вспомогательное: точки вдоль функции f(t) ∈ [0,1] */
export function samplePath(n: number, f: (t: number, out: THREE.Vector3) => void): Float32Array {
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    f(i / (n - 1), v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

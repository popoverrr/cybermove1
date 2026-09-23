/**
 * Орбиты и электроны (BRIEF §8.5). Орбита — эллипс, вычисляемый в вершинном шейдере по параметрам,
 * линия постоянной экранной толщины. Электрон — emissive-сфера (bloom) + ленточный шлейф с затуханием.
 */
import * as THREE from 'three';

const LINE_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform mat3 uOrient;
uniform vec2 uAB;
uniform float uWidth;
uniform vec2 uResolution;
uniform float uPhase;
uniform float uTrail;      // 0 — замкнутая орбита, >0 — длина шлейфа в долях оборота
uniform float uSpin;       // текущий угол электрона (обороты)
uniform float uSpread;     // множитель радиуса (кольца роста)
uniform float uWobble;     // амплитуда дрожания
uniform float uTime;
varying float vT;
varying float vDepth;

vec3 ell(float t) {
  float ang = (t + uPhase) * 6.2831853;
  vec3 p = vec3(uAB.x * cos(ang), uAB.y * sin(ang), 0.0) * uSpread;
  p.z += uWobble * sin(ang * 3.0 + uTime * 0.8);
  return uOrient * p;
}

void main() {
  float t = uTrail > 0.0 ? uSpin - aT * uTrail : aT;
  vT = aT;
  vec3 p = ell(t);
  vec3 pn = ell(t + 0.003);
  vec3 pp = ell(t - 0.003);
  vec4 cur = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vec4 nxt = projectionMatrix * modelViewMatrix * vec4(pn, 1.0);
  vec4 prv = projectionMatrix * modelViewMatrix * vec4(pp, 1.0);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 sc = cur.xy / cur.w * aspect;
  vec2 sn = nxt.xy / nxt.w * aspect;
  vec2 sp = prv.xy / prv.w * aspect;
  vec2 dir = normalize(sn - sp);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = uWidth;
  if (uTrail > 0.0) w *= (1.0 - aT) * (1.0 - aT) * 2.4 + 0.2;
  vec2 off = nrm * aSide * w / uResolution.y * 2.0;
  off /= aspect;
  cur.xy += off * cur.w;
  gl_Position = cur;
  vDepth = -(modelViewMatrix * vec4(p, 1.0)).z;
}
`;

const LINE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTrail;
uniform float uDepthNear;
uniform float uDepthFar;
uniform float uAdditive;
varying float vT;
varying float vDepth;
void main() {
  float a = uOpacity;
  if (uTrail > 0.0) {
    float f = 1.0 - vT;
    a *= f * f * f;
  }
  a *= mix(0.55, 1.0, smoothstep(uDepthFar, uDepthNear, vDepth));
  if (a < 0.003) discard;
  vec3 col = uColor * a;
  gl_FragColor = vec4(col, a * (1.0 - uAdditive));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeStrip(segments: number, closed: boolean) {
  const n = segments + (closed ? 1 : 0);
  const t = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    t[i * 2] = closed ? i / segments : i / (n - 1);
    t[i * 2 + 1] = t[i * 2];
    side[i * 2] = 1;
    side[i * 2 + 1] = -1;
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
  return g;
}

let orbitGeo: THREE.BufferGeometry | null = null;
let trailGeo: THREE.BufferGeometry | null = null;

export interface OrbitParams {
  a: number;
  b: number;
  /** углы наклона (Euler XYZ) */
  tilt: [number, number, number];
  phase: number;
  /** скорость электрона, оборотов/с */
  speed: number;
}

export class Orbit {
  readonly group = new THREE.Group();
  readonly line: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly electron: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly glow: THREE.Sprite;
  readonly orient = new THREE.Matrix3();
  readonly params: OrbitParams;
  spin = 0;
  /** подсветка 0..1 (hover) */
  highlight = 0;
  /** видимость 0..1 */
  visible = 1;
  /** множитель радиуса */
  spread = 1;
  private lineU: Record<string, THREE.IUniform>;
  private trailU: Record<string, THREE.IUniform>;
  private tmpV = new THREE.Vector3();

  constructor(params: OrbitParams, resolution: THREE.Vector2, trailSegments: number) {
    this.params = params;
    if (!orbitGeo) orbitGeo = makeStrip(180, true);
    if (!trailGeo) trailGeo = makeStrip(trailSegments, false);
    const e = new THREE.Euler(params.tilt[0], params.tilt[1], params.tilt[2]);
    this.orient.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));

    const baseU = () => ({
      uOrient: { value: this.orient },
      uAB: { value: new THREE.Vector2(params.a, params.b) },
      uWidth: { value: 1.0 },
      uResolution: { value: resolution },
      uPhase: { value: params.phase },
      uTrail: { value: 0 },
      uSpin: { value: 0 },
      uSpread: { value: 1 },
      uWobble: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xc9ced6) },
      uOpacity: { value: 0.55 },
      uDepthNear: { value: 4 },
      uDepthFar: { value: 14 },
      uAdditive: { value: 1 },
    });
    this.lineU = baseU();
    this.trailU = baseU();
    this.trailU.uTrail.value = 0.16;
    this.trailU.uWidth.value = 2.2;
    this.trailU.uColor.value = new THREE.Color(0x8fb0ff);
    this.trailU.uOpacity.value = 1.4;

    const mk = (geo: THREE.BufferGeometry, u: Record<string, THREE.IUniform>) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      return mesh;
    };
    this.line = mk(orbitGeo, this.lineU);
    this.trail = mk(trailGeo, this.trailU);

    const eg = new THREE.SphereGeometry(0.03, 16, 12);
    const em = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 4.0), toneMapped: false });
    this.electron = new THREE.Mesh(eg, em);

    const glowTex = Orbit.glowTexture();
    const sm = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.6, 0.75, 1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glow = new THREE.Sprite(sm);
    this.glow.scale.setScalar(0.3);

    this.group.add(this.line, this.trail, this.electron, this.glow);
  }

  private static _glow: THREE.Texture | null = null;
  static glowTexture() {
    if (Orbit._glow) return Orbit._glow;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    Orbit._glow = t;
    return t;
  }

  /** Точка орбиты в локальных координатах группы для параметра t (обороты) */
  pointAt(t: number, out: THREE.Vector3) {
    const ang = (t + this.params.phase) * Math.PI * 2;
    out.set(this.params.a * Math.cos(ang), this.params.b * Math.sin(ang), 0).multiplyScalar(this.spread);
    return out.applyMatrix3(this.orient);
  }

  update(dt: number, time: number, opts: { speedMul: number; additive: number; baseColor: THREE.Color; baseOpacity: number; width: number }) {
    this.spin += dt * this.params.speed * opts.speedMul;
    const h = this.highlight;
    const v = this.visible;
    this.lineU.uTime.value = time;
    this.trailU.uTime.value = time;
    this.lineU.uSpread.value = this.spread;
    this.trailU.uSpread.value = this.spread;
    this.lineU.uWidth.value = opts.width * (1 + h * 0.9);
    this.lineU.uOpacity.value = opts.baseOpacity * v * (1 + h * 1.1);
    this.lineU.uColor.value.copy(opts.baseColor).lerp(new THREE.Color(0x8fb0ff), h);
    this.lineU.uAdditive.value = opts.additive;
    this.trailU.uAdditive.value = opts.additive;
    this.trailU.uSpin.value = this.spin;
    this.trailU.uOpacity.value = 1.4 * v * (1 + h * 0.6);
    this.trailU.uWidth.value = 2.2 * (1 + h * 0.5);
    this.pointAt(this.spin, this.tmpV);
    this.electron.position.copy(this.tmpV);
    this.glow.position.copy(this.tmpV);
    const es = v * (1 + h * 0.5);
    this.electron.scale.setScalar(es);
    this.glow.scale.setScalar(0.3 * es + h * 0.15);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.9 * v;
    this.electron.visible = v > 0.02;
    this.glow.visible = v > 0.02;
    this.line.visible = v > 0.01;
    this.trail.visible = v > 0.02;
  }

  dispose() {
    this.line.material.dispose();
    this.trail.material.dispose();
    this.electron.geometry.dispose();
    this.electron.material.dispose();
    (this.glow.material as THREE.SpriteMaterial).dispose();
  }
}

/** Пять орбит первого экрана: разные наклоны, эксцентриситеты, скорости */
export const CORE_ORBITS: OrbitParams[] = [
  { a: 2.35, b: 1.55, tilt: [1.05, 0.25, 0.35], phase: 0.05, speed: 0.11 },
  { a: 2.75, b: 2.05, tilt: [0.55, -0.9, -0.2], phase: 0.42, speed: 0.085 },
  { a: 3.05, b: 1.75, tilt: [1.5, 0.75, 0.9], phase: 0.71, speed: 0.07 },
  { a: 2.55, b: 2.4, tilt: [-0.75, 0.35, 1.25], phase: 0.2, speed: 0.095 },
  { a: 3.3, b: 2.15, tilt: [0.25, 1.35, -0.55], phase: 0.88, speed: 0.06 },
];

/** Дополнительные орбиты для экрана «Рост» (кольца роста): всего с CORE_ORBITS — 13 */
export const GROWTH_ORBITS: OrbitParams[] = [
  { a: 3.6, b: 2.5, tilt: [0.9, 0.5, -0.8], phase: 0.12, speed: 0.05 },
  { a: 3.9, b: 3.1, tilt: [-0.4, 1.1, 0.3], phase: 0.6, speed: 0.045 },
  { a: 4.2, b: 2.7, tilt: [1.3, -0.6, 1.0], phase: 0.33, speed: 0.04 },
  { a: 4.5, b: 3.6, tilt: [0.2, 0.9, -1.2], phase: 0.8, speed: 0.038 },
  { a: 4.8, b: 3.0, tilt: [-1.1, 0.2, 0.6], phase: 0.47, speed: 0.035 },
  { a: 5.1, b: 4.1, tilt: [0.7, -1.3, 0.1], phase: 0.05, speed: 0.032 },
  { a: 5.4, b: 3.4, tilt: [1.6, 0.4, -0.4], phase: 0.66, speed: 0.03 },
  { a: 5.8, b: 4.6, tilt: [-0.6, -0.8, 1.4], phase: 0.27, speed: 0.028 },
];

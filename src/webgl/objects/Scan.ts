/**
 * S2 · АУДИТ: сканирующая плоскость (clipping со светящейся кромкой): с одной стороны хром,
 * с другой — «рентген» (каркас, fresnel-свечение); точки данных с микроподписями; гистограмма-кольцо;
 * линия-траектория с засечками (hover «Стратегия и roadmap»).
 */
import * as THREE from 'three';
import { CHROME_VERTEX_PARS } from './LiquidChrome';
import type { LiquidChrome } from './LiquidChrome';
import { Polyline, samplePath } from './Polyline';
import { patchEnvBlend } from '../Environment';

const XRAY_VERT = /* glsl */ `
uniform mat4 uAtomInv;
varying vec3 vAtomPos;
varying vec3 vNormalW;
varying vec3 vViewDir;
${CHROME_VERTEX_PARS}
void main() {
  vec3 P; vec3 N;
  cmSurface(P, N);
  vec4 world = modelMatrix * vec4(P, 1.0);
  vAtomPos = (uAtomInv * world).xyz;
  vNormalW = normalize(mat3(modelMatrix) * N);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const XRAY_FRAG = /* glsl */ `
precision highp float;
uniform float uScanY;
uniform float uScanOn;
uniform float uLayers;   // 0..1 — послойный скан (полосы)
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vAtomPos;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main() {
  float y = vAtomPos.y;
  // рентген только над плоскостью скана
  if (y < uScanY) discard;
  if (uLayers > 0.01) {
    float band = fract((y - uScanY) * 3.5);
    if (band > 1.0 - 0.55 * uLayers) discard;
  }
  float fres = pow(1.0 - max(dot(normalize(vNormalW), normalize(vViewDir)), 0.0), 2.2);
  float edge = exp(-abs(y - uScanY) * 14.0);
  float a = (0.035 + fres * 0.28 + edge * 0.9) * uOpacity;
  vec3 col = mix(uColor, vec3(0.75, 0.85, 1.0), edge) * a;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHot;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c);
  float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.30, 0.38, d);
  float dot_ = smoothstep(0.12, 0.0, d);
  float a = (ring * 0.9 + dot_ * (1.0 + uHot * 2.0)) * uOpacity;
  if (a < 0.003) discard;
  vec3 col = mix(uColor, vec3(0.55, 0.7, 1.0), uHot) * a;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  mv.xy += position.xy * scale;
  gl_Position = projectionMatrix * mv;
}
`;

export const DATA_POINTS: Array<[number, number, number]> = [
  [1.15, 1.05, 0.6],
  [-1.7, 0.55, 0.4],
  [1.35, -0.25, 1.3],
  [-1.35, -0.95, 0.9],
  [0.25, 1.5, -0.9],
  [0.95, -1.35, -0.3],
];

export class Scan {
  readonly group = new THREE.Group();
  /** обновлён ли объект в этом кадре активной сценой (Story сбрасывает и даёт дефолт) */
  touched = false;
  readonly xray: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly points: THREE.Mesh[] = [];
  readonly pointGroups: number[] = [0, 1, 0, 1, 0, 1];
  readonly bars: THREE.InstancedMesh;
  readonly trajectory: Polyline;
  readonly ticks: THREE.InstancedMesh;
  readonly plane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  readonly uniforms: {
    uScanY: THREE.IUniform<number>;
    uScanOn: THREE.IUniform<number>;
    uLayers: THREE.IUniform<number>;
    uOpacity: THREE.IUniform<number>;
    uAtomInv: THREE.IUniform<THREE.Matrix4>;
    uColor: THREE.IUniform<THREE.Color>;
  };
  private pointU: Array<{ uOpacity: THREE.IUniform<number>; uHot: THREE.IUniform<number> }> = [];
  private barDummy = new THREE.Object3D();
  private barMat: THREE.MeshPhysicalMaterial;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private barsCount = 28;
  private clipNormal = new THREE.Vector3();
  private clipPoint = new THREE.Vector3();
  private savedPlanes: THREE.Plane[] | null = null;

  constructor(core: LiquidChrome, resolution: THREE.Vector2, envDark: THREE.Texture, envLight: THREE.Texture, envMix: THREE.IUniform<number>) {
    const cu = core.uniforms;
    this.uniforms = {
      uScanY: { value: 3 },
      uScanOn: { value: 0 },
      uLayers: { value: 0 },
      uOpacity: { value: 0 },
      uAtomInv: { value: new THREE.Matrix4() },
      uColor: { value: new THREE.Color(0x8fa6d6) },
    };
    const xm = new THREE.ShaderMaterial({
      vertexShader: XRAY_VERT,
      fragmentShader: XRAY_FRAG,
      uniforms: {
        uTime: cu.uTime,
        uNoiseAmp: cu.uNoiseAmp,
        uNoiseFreq: cu.uNoiseFreq,
        uNoiseSpeed: cu.uNoiseSpeed,
        uWorleyAmp: cu.uWorleyAmp,
        uWorleyFreq: cu.uWorleyFreq,
        uMorph: cu.uMorph,
        uTurb: cu.uTurb,
        uPointerDir: cu.uPointerDir,
        uPointerAmt: cu.uPointerAmt,
        uStretch: cu.uStretch,
        ...this.uniforms,
      } as unknown as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      wireframe: true,
      side: THREE.DoubleSide,
      defines: core.material.defines?.CM_WORLEY !== undefined ? { CM_WORLEY: '' } : {},
    });
    this.xray = new THREE.Mesh(core.geometry, xm);
    this.xray.frustumCulled = false;
    this.xray.visible = false;
    this.xray.renderOrder = 2;

    // точки данных
    const pg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < DATA_POINTS.length; i++) {
      const u = { uOpacity: { value: 0 }, uHot: { value: 0 }, uColor: { value: new THREE.Color(0xdfe6f4) } };
      const m = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending, premultipliedAlpha: true });
      const mesh = new THREE.Mesh(pg, m);
      mesh.position.fromArray(DATA_POINTS[i]);
      mesh.scale.setScalar(0.16);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.points.push(mesh);
      this.pointU.push(u);
      this.group.add(mesh);
    }

    // гистограмма: тонкие столбики по окружности
    const bg = new THREE.BoxGeometry(0.045, 1, 0.045);
    bg.translate(0, 0.5, 0);
    this.barMat = new THREE.MeshPhysicalMaterial({ color: 0xf0f3f8, metalness: 1, roughness: 0.18, envMap: envDark, envMapIntensity: 1.0, transparent: true, opacity: 1 });
    patchEnvBlend(this.barMat, envLight, { uEnvMix: envMix });
    this.bars = new THREE.InstancedMesh(bg, this.barMat, this.barsCount);
    this.bars.visible = false;
    this.bars.frustumCulled = false;
    this.group.add(this.bars);

    // траектория с засечками
    const pts = samplePath(64, (t, v) => {
      const x = t * 2.1;
      v.set(x, Math.pow(t, 1.5) * 2.3 - 0.1 + Math.sin(t * 9.0) * 0.05 * t, 0.2 - t * 0.3);
    });
    this.trajectory = new Polyline(pts, resolution, { width: 1.3, color: 0xdfe6f4, color2: 0x8fb0ff, opacity: 0.95 });
    this.trajectory.uniforms.uDraw.value = 0;
    this.trajectory.mesh.visible = false;
    this.group.add(this.trajectory.mesh);
    const tg = new THREE.BoxGeometry(0.012, 0.16, 0.012);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.4), toneMapped: false, transparent: true });
    this.ticks = new THREE.InstancedMesh(tg, tm, 8);
    const d = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const t = (i + 1) / 9;
      d.position.set(pts[Math.floor(t * 63) * 3], pts[Math.floor(t * 63) * 3 + 1], pts[Math.floor(t * 63) * 3 + 2]);
      d.updateMatrix();
      this.ticks.setMatrixAt(i, d.matrix);
    }
    this.ticks.visible = false;
    this.ticks.frustumCulled = false;
    this.group.add(this.ticks);

    // рентген наследует трансформацию ядра (масштаб, вращение)
    core.mesh.add(this.xray);
  }

  /** Плоскость клиппинга хрома (мир): хром виден ниже scanY в системе атома */
  updateClipping(core: LiquidChrome, atom: THREE.Object3D, on: boolean) {
    if (!on) {
      if (core.material.clippingPlanes) {
        core.material.clippingPlanes = null;
        core.material.needsUpdate = true;
      }
      return;
    }
    atom.updateMatrixWorld();
    this.clipNormal.set(0, 1, 0).transformDirection(atom.matrixWorld).normalize();
    this.clipPoint.set(0, this.uniforms.uScanY.value, 0).applyMatrix4(atom.matrixWorld);
    // Plane: normal·p + constant = 0; хром там, где y_atom < scanY, т.е. normal = -up
    this.plane.normal.copy(this.clipNormal).negate();
    this.plane.constant = -this.plane.normal.dot(this.clipPoint);
    if (!core.material.clippingPlanes || core.material.clippingPlanes.length === 0) {
      core.material.clippingPlanes = [this.plane];
      core.material.clipShadows = false;
      core.material.needsUpdate = true;
    }
    this.uniforms.uAtomInv.value.copy(atom.matrixWorld).invert();
  }

  /**
   * t — прогресс скана 0..1 (сверху вниз), state — реакции hover.
   */
  update(opts: {
    time: number;
    scan: number; // 0..1
    on: number; // видимость 0..1
    layers: number;
    hist: number;
    split: number;
    traj: number;
    pointsSpread: number; // 1 — на местах, >1 — разлетаются (выход)
  }) {
    this.touched = true;
    const u = this.uniforms;
    u.uScanY.value = 1.95 - opts.scan * 3.45;
    u.uScanOn.value = opts.on;
    u.uLayers.value = opts.layers;
    u.uOpacity.value = opts.on;
    this.xray.visible = opts.on > 0.01 && opts.scan > 0.001;

    // точки данных проявляются, когда скан прошёл их высоту
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const base = DATA_POINTS[i];
      const passed = 1 - THREE.MathUtils.smoothstep(u.uScanY.value, base[1] - 0.15, base[1] + 0.35);
      const grp = this.pointGroups[i];
      // «Рекомендации по инвестициям»: группа 0 к ядру и разгорается, группа 1 гаснет и отлетает
      const toward = grp === 0 ? opts.split : 0;
      const away = grp === 1 ? opts.split : 0;
      const k = (1 - toward * 0.45 + away * 0.9) * opts.pointsSpread;
      p.position.set(base[0] * k, base[1] * k, base[2] * k);
      const pu = this.pointU[i];
      pu.uOpacity.value = opts.on * passed * (1 - away * 0.85);
      pu.uHot.value = toward;
      p.scale.setScalar(0.16 * (1 + toward * 0.6) * (1 - away * 0.4));
    }

    // гистограмма
    const hist = opts.hist;
    this.bars.visible = hist > 0.01;
    if (this.bars.visible) {
      for (let i = 0; i < this.barsCount; i++) {
        const a = (i / this.barsCount) * Math.PI * 2;
        const r = 1.55;
        const h = (0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + opts.time * 0.6) * 0.5 + Math.sin(i * 0.53 + opts.time * 0.3) * 0.5)) * hist * 1.1;
        this.barDummy.position.set(Math.cos(a) * r, -0.9, Math.sin(a) * r);
        this.barDummy.scale.set(1, Math.max(h, 0.001), 1);
        this.barDummy.rotation.set(0, -a, 0);
        this.barDummy.updateMatrix();
        this.bars.setMatrixAt(i, this.barDummy.matrix);
      }
      this.bars.instanceMatrix.needsUpdate = true;
    }

    // траектория
    this.trajectory.mesh.visible = opts.traj > 0.01;
    this.trajectory.uniforms.uDraw.value = opts.traj;
    this.trajectory.update(opts.time);
    this.ticks.visible = opts.traj > 0.01;
    (this.ticks.material as THREE.MeshBasicMaterial).opacity = opts.traj;
    this.ticks.count = Math.floor(opts.traj * 8.99);
  }

  dispose() {
    this.xray.material.dispose();
    this.points.forEach((p) => (p.material as THREE.Material).dispose());
    this.bars.geometry.dispose();
    this.barMat.dispose();
    this.trajectory.dispose();
    this.ticks.geometry.dispose();
    (this.ticks.material as THREE.Material).dispose();
  }
}

/**
 * LiquidChrome — один высокополигональный icosphere на весь сюжет (BRIEF §8.3).
 * MeshPhysicalMaterial (metalness 1, roughness 0.04–0.12, clearcoat), смещение вершин в вершинном шейдере
 * (simplex + worley), нормали пересчитываются конечными разностями. Морфинг между SDF-формами:
 * две активные цели в атрибутах (aPosA/aNorA, aPosB/aNorB), смешение mix() с шумовой турбулентностью.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE_ALL } from '../shaders/noise';
import { patchEnvBlend } from '../Environment';
import { SHAPE_COUNT, projectShape } from './shapes';

export interface ChromeUniforms {
  uTime: THREE.IUniform<number>;
  uNoiseAmp: THREE.IUniform<number>;
  uNoiseFreq: THREE.IUniform<number>;
  uNoiseSpeed: THREE.IUniform<number>;
  uWorleyAmp: THREE.IUniform<number>;
  uWorleyFreq: THREE.IUniform<number>;
  uMorph: THREE.IUniform<number>;
  uTurb: THREE.IUniform<number>;
  uPointerDir: THREE.IUniform<THREE.Vector3>;
  uPointerAmt: THREE.IUniform<number>;
  uStretch: THREE.IUniform<THREE.Vector3>;
  uEnvMix: THREE.IUniform<number>;
  uScanY: THREE.IUniform<number>;
  uScanOn: THREE.IUniform<number>;
}

export const CHROME_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform float uNoiseAmp;
uniform float uNoiseFreq;
uniform float uNoiseSpeed;
uniform float uWorleyAmp;
uniform float uWorleyFreq;
uniform float uMorph;
uniform float uTurb;
uniform vec3 uPointerDir;
uniform float uPointerAmt;
uniform vec3 uStretch;
attribute vec3 aPosA;
attribute vec3 aNorA;
attribute vec3 aPosB;
attribute vec3 aNorB;
${GLSL_NOISE_ALL}

float cmHeight(vec3 p, vec3 n) {
  float h = snoise(p * uNoiseFreq + vec3(0.0, uTime * uNoiseSpeed, uTime * 0.37 * uNoiseSpeed)) * uNoiseAmp;
  #ifdef CM_WORLEY
    vec2 w = worley3(p * uWorleyFreq + vec3(uTime * 0.04, 0.0, -uTime * 0.03));
    // сросшиеся нуклоны: выпуклости в центрах ячеек, сглаженные
    // мягкие купола: плавный спад от центра ячейки, без острых границ
    float bump = 1.0 - smoothstep(0.05, 0.95, w.x);
    h += bump * bump * (3.0 - 2.0 * bump) * uWorleyAmp;
  #endif
  float tt = uTurb * sin(clamp(uMorph, 0.0, 1.0) * 3.14159265);
  h += tt * snoise(p * 2.1 + vec3(uTime * 0.7));
  h += uPointerAmt * pow(max(dot(n, uPointerDir), 0.0), 4.0);
  return h;
}

// Смещённая поверхность и нормаль конечными разностями
void cmSurface(out vec3 P, out vec3 N) {
  float m = smoothstep(0.0, 1.0, uMorph);
  vec3 bp = mix(aPosA, aPosB, m);
  vec3 bn = normalize(mix(aNorA, aNorB, m));
  // касательная от фиксированной «иррациональной» оси: шов только в одной точке, а не на полюсе
  vec3 up = vec3(0.3182, 0.6118, 0.7243);
  if (abs(dot(bn, up)) > 0.995) up = vec3(1.0, 0.0, 0.0);
  vec3 tng = normalize(cross(bn, up));
  vec3 btg = cross(bn, tng);
  const float e = 0.018;
  vec3 p1 = bp + tng * e;
  vec3 p2 = bp + btg * e;
  vec3 P0 = bp + bn * cmHeight(bp, bn);
  vec3 P1 = p1 + bn * cmHeight(p1, bn);
  vec3 P2 = p2 + bn * cmHeight(p2, bn);
  // растяжение (uStretch) — общее для всех трёх точек, нормаль пересчитываем после
  P0 *= uStretch; P1 *= uStretch; P2 *= uStretch;
  P = P0;
  N = normalize(cross(P1 - P0, P2 - P0));
}
`;

export const CHROME_BEGINNORMAL = /* glsl */ `
vec3 cmP; vec3 cmN;
cmSurface(cmP, cmN);
vec3 objectNormal = cmN;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

export const CHROME_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = cmP;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif
`;

export interface LiquidChromeOptions {
  /** detail для IcosahedronGeometry three: граней = 20·(detail+1)²; 63 → ~41k вершин, 31 → ~10k */
  detail: number;
  worley: boolean;
  envDark: THREE.Texture;
  envLight: THREE.Texture;
}

export class LiquidChrome {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshPhysicalMaterial;
  readonly uniforms: ChromeUniforms;
  readonly vertexCount: number;
  /** проекции вершин на формы: [shape] → {pos, nor}; sphere доступна сразу, остальные считает worker */
  readonly shapes: Array<{ pos: Float32Array; nor: Float32Array } | null> = new Array(SHAPE_COUNT).fill(null);
  private shapeA = 0;
  private shapeB = 0;
  private posA: THREE.BufferAttribute;
  private norA: THREE.BufferAttribute;
  private posB: THREE.BufferAttribute;
  private norB: THREE.BufferAttribute;
  private worker: Worker | null = null;
  private readyResolvers: Array<() => void> = [];

  constructor(opts: LiquidChromeOptions) {
    let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, opts.detail);
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    this.geometry = geo;
    this.vertexCount = geo.attributes.position.count;

    const dirs = geo.attributes.position.array as Float32Array;
    const sphere = { pos: new Float32Array(dirs), nor: new Float32Array(dirs) };
    this.shapes[0] = sphere;

    this.posA = new THREE.BufferAttribute(new Float32Array(sphere.pos), 3);
    this.norA = new THREE.BufferAttribute(new Float32Array(sphere.nor), 3);
    this.posB = new THREE.BufferAttribute(new Float32Array(sphere.pos), 3);
    this.norB = new THREE.BufferAttribute(new Float32Array(sphere.nor), 3);
    this.posA.setUsage(THREE.DynamicDrawUsage);
    this.norA.setUsage(THREE.DynamicDrawUsage);
    this.posB.setUsage(THREE.DynamicDrawUsage);
    this.norB.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPosA', this.posA);
    geo.setAttribute('aNorA', this.norA);
    geo.setAttribute('aPosB', this.posB);
    geo.setAttribute('aNorB', this.norB);
    // граница для фрустум-куллинга: формы до ~1.9 + смещение
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.6);

    this.uniforms = {
      uTime: { value: 0 },
      uNoiseAmp: { value: 0.03 },
      uNoiseFreq: { value: 1.6 },
      uNoiseSpeed: { value: 0.18 },
      uWorleyAmp: { value: 0.065 },
      uWorleyFreq: { value: 1.6 },
      uMorph: { value: 0 },
      uTurb: { value: 0.16 },
      uPointerDir: { value: new THREE.Vector3(0, 0, 1) },
      uPointerAmt: { value: 0 },
      uStretch: { value: new THREE.Vector3(1, 1, 1) },
      uEnvMix: { value: 0 },
      uScanY: { value: 2 },
      uScanOn: { value: 0 },
    };

    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xf3f5f9),
      metalness: 1.0,
      roughness: 0.07,
      clearcoat: 0.55,
      clearcoatRoughness: 0.06,
      envMap: opts.envDark,
      envMapIntensity: 1.0,
      side: THREE.FrontSide,
    });
    mat.defines = { ...(mat.defines || {}) };
    if (opts.worley) mat.defines.CM_WORLEY = '';
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uTime: u.uTime,
        uNoiseAmp: u.uNoiseAmp,
        uNoiseFreq: u.uNoiseFreq,
        uNoiseSpeed: u.uNoiseSpeed,
        uWorleyAmp: u.uWorleyAmp,
        uWorleyFreq: u.uWorleyFreq,
        uMorph: u.uMorph,
        uTurb: u.uTurb,
        uPointerDir: u.uPointerDir,
        uPointerAmt: u.uPointerAmt,
        uStretch: u.uStretch,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${CHROME_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', CHROME_BEGINNORMAL)
        .replace('#include <begin_vertex>', CHROME_BEGIN_VERTEX);
    };
    mat.customProgramCacheKey = () => `liquidchrome${opts.worley ? '-w' : ''}`;
    patchEnvBlend(mat, opts.envLight, { uEnvMix: u.uEnvMix });
    this.material = mat;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'core';

    this.startWorker(dirs);
  }

  /** Считает проекции на формы 1..N в worker; без worker — синхронно по требованию. */
  private startWorker(dirs: Float32Array) {
    try {
      const worker = new Worker(new URL('./shapes.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const shapes = [];
      for (let s = 1; s < SHAPE_COUNT; s++) shapes.push(s);
      worker.onmessage = (e: MessageEvent<{ shape?: number; pos?: Float32Array; nor?: Float32Array; done?: boolean }>) => {
        if (e.data.done) {
          this.readyResolvers.forEach((r) => r());
          this.readyResolvers = [];
          worker.terminate();
          this.worker = null;
          return;
        }
        if (e.data.shape !== undefined && e.data.pos && e.data.nor) {
          this.shapes[e.data.shape] = { pos: e.data.pos, nor: e.data.nor };
        }
      };
      worker.onerror = () => {
        this.worker = null;
      };
      const copy = new Float32Array(dirs);
      worker.postMessage({ dirs: copy, shapes }, [copy.buffer]);
    } catch {
      this.worker = null;
    }
  }

  /** Гарантирует наличие формы (синхронный фолбэк, если worker ещё не досчитал). */
  ensureShape(shape: number) {
    if (!this.shapes[shape]) {
      const dirs = this.geometry.attributes.position.array as Float32Array;
      this.shapes[shape] = projectShape(shape, dirs);
    }
    return this.shapes[shape]!;
  }

  whenShapesReady(): Promise<void> {
    if (this.shapes.every(Boolean)) return Promise.resolve();
    return new Promise((r) => this.readyResolvers.push(r));
  }

  get currentShapes() {
    return { a: this.shapeA, b: this.shapeB };
  }

  /** Установить пару форм. morph=0 показывает A, 1 — B. Смена без скачка, если вызывать при morph=0 или 1. */
  setShapes(a: number, b: number) {
    if (a !== this.shapeA) {
      const s = this.ensureShape(a);
      (this.posA.array as Float32Array).set(s.pos);
      (this.norA.array as Float32Array).set(s.nor);
      this.posA.needsUpdate = true;
      this.norA.needsUpdate = true;
      this.shapeA = a;
    }
    if (b !== this.shapeB) {
      const s = this.ensureShape(b);
      (this.posB.array as Float32Array).set(s.pos);
      (this.norB.array as Float32Array).set(s.nor);
      this.posB.needsUpdate = true;
      this.norB.needsUpdate = true;
      this.shapeB = b;
    }
  }

  /**
   * Морф по «дорожке» форм: t в единицах форм (0 = shapes[0], 1 = shapes[1], 1.5 = между 1 и 2…).
   * Сам подменяет пару A/B.
   */
  morphAlong(track: number[], t: number) {
    const n = track.length;
    const tt = Math.min(Math.max(t, 0), n - 1);
    const i = Math.min(Math.floor(tt), n - 2);
    const f = tt - i;
    this.setShapes(track[i], track[i + 1]);
    this.uniforms.uMorph.value = n === 1 ? 0 : f;
  }

  update(time: number) {
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.worker?.terminate();
    this.geometry.dispose();
    this.material.dispose();
  }
}

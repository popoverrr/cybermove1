/**
 * S3 · СИСТЕМЫ: граф — ядро в центре, вокруг 5 хромовых модулей-узлов (сайт, CRM, телефония, AI,
 * автоматизация), у каждого свой силуэт. Связи — линии с бегущими импульсами к ядру.
 * Сборка механическая, стыковка с micro-overshoot.
 */
import * as THREE from 'three';
import { Polyline, samplePath } from './Polyline';
import { patchEnvBlend } from '../Environment';

export const NODE_IDS = ['websites', 'crm', 'telephony', 'ai', 'automation'] as const;

function nodeGeometry(kind: (typeof NODE_IDS)[number]): THREE.BufferGeometry {
  switch (kind) {
    case 'websites': {
      // плоская пластина-экран со скруглением: сплющенный box
      const g = new THREE.BoxGeometry(0.78, 0.52, 0.07, 1, 1, 1);
      return g;
    }
    case 'crm': {
      // два диска — база данных
      const a = new THREE.CylinderGeometry(0.34, 0.34, 0.11, 48);
      const b = new THREE.CylinderGeometry(0.34, 0.34, 0.11, 48);
      a.translate(0, 0.1, 0);
      b.translate(0, -0.1, 0);
      const merged = mergeGeometries([a, b]);
      merged.rotateX(0.35);
      return merged;
    }
    case 'telephony':
      return new THREE.TorusGeometry(0.3, 0.075, 24, 64);
    case 'ai':
      return new THREE.OctahedronGeometry(0.38, 0);
    case 'automation': {
      const g = new THREE.CylinderGeometry(0.36, 0.36, 0.16, 6);
      g.rotateX(Math.PI / 2);
      return g;
    }
  }
}

function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // простая склейка без индексов
  const geos = list.map((g) => g.toNonIndexed());
  const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

const easeOutBack = (t: number) => {
  const c1 = 1.25;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export class Nodes {
  readonly group = new THREE.Group();
  /** обновлён ли объект в этом кадре активной сценой (Story сбрасывает и даёт дефолт) */
  touched = false;
  readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>[] = [];
  readonly links: Polyline[] = [];
  readonly targets: THREE.Vector3[] = [];
  readonly far: THREE.Vector3[] = [];
  /** сглаженные значения hover по узлам */
  readonly hover: number[] = [0, 0, 0, 0, 0];
  readonly dim: number[] = [0, 0, 0, 0, 0];
  private mats: THREE.MeshPhysicalMaterial[] = [];

  constructor(resolution: THREE.Vector2, envDark: THREE.Texture, envLight: THREE.Texture, envMix: THREE.IUniform<number>) {
    for (let i = 0; i < NODE_IDS.length; i++) {
      const a = -Math.PI / 2 + (i / NODE_IDS.length) * Math.PI * 2 + 0.45;
      const r = 1.72 + (i % 2) * 0.22;
      const target = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.82, (i % 2 ? -0.35 : 0.25));
      this.targets.push(target);
      this.far.push(target.clone().multiplyScalar(3.2).add(new THREE.Vector3(0, (i - 2) * 0.6, 1.5)));

      const mat = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0.12, clearcoat: 0.35, clearcoatRoughness: 0.1, envMap: envDark, envMapIntensity: 1 });
      patchEnvBlend(mat, envLight, { uEnvMix: envMix });
      this.mats.push(mat);
      const geo = nodeGeometry(NODE_IDS[i]);
      geo.scale(0.78, 0.78, 0.78);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this.far[i]);
      mesh.visible = false;
      this.meshes.push(mesh);
      this.group.add(mesh);

      const pts = samplePath(24, (t, v) => {
        v.lerpVectors(target, new THREE.Vector3(0, 0, 0), t);
        v.z += Math.sin(t * Math.PI) * 0.25 * (i % 2 ? -1 : 1);
      });
      const link = new Polyline(pts, resolution, { width: 1.1, color: 0x33373d, color2: 0x0a24f5, opacity: 0.7 });
      link.uniforms.uDash.value = 6;
      link.uniforms.uDashSpeed.value = 0.9;
      link.uniforms.uDraw.value = 0;
      link.uniforms.uAdditive.value = 0;
      link.mesh.visible = false;
      this.links.push(link);
      this.group.add(link.mesh);
    }
  }

  /**
   * assemble — 0..1 сборка; collapse — 0..1 стекание в каплю; hovered — индекс узла или -1;
   * additive — режим смешивания линий (0 на светлой теме).
   */
  update(opts: { time: number; dt: number; assemble: number; collapse: number; hovered: number; additive: number; on: number }) {
    this.touched = true;
    const { time, dt } = opts;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      const link = this.links[i];
      const hTarget = opts.hovered === i ? 1 : 0;
      this.hover[i] = dt === 0 ? hTarget : this.hover[i] + (hTarget - this.hover[i]) * (1 - Math.exp(-7 * dt));
      const h = this.hover[i];
      const dimTarget = opts.hovered >= 0 && opts.hovered !== i ? 1 : 0;
      this.dim[i] = dt === 0 ? dimTarget : this.dim[i] + (dimTarget - this.dim[i]) * (1 - Math.exp(-7 * dt));
      const dim = this.dim[i];

      const a = easeOutBack(THREE.MathUtils.clamp((opts.assemble - i * 0.09) / 0.55, 0, 1));
      const c = THREE.MathUtils.smoothstep(opts.collapse, 0.05 + i * 0.08, 0.6 + i * 0.08);
      const pos = new THREE.Vector3().lerpVectors(this.far[i], this.targets[i], a);
      // hover: узел выезжает вперёд
      pos.z += h * 0.7;
      // коллапс: к центру
      pos.lerp(new THREE.Vector3(0, 0, 0), c);
      m.position.copy(pos);
      const s = (0.001 + a * (1 - c)) * (1 + h * 0.18) * (1 - dim * 0.12);
      m.scale.setScalar(Math.max(s, 0.001));
      m.rotation.set(time * 0.25 + i, time * 0.35 + i * 0.7 + (1 - a) * 4.0, 0);
      m.visible = opts.on > 0.01 && a > 0.001 && c < 0.999;
      this.mats[i].envMapIntensity = 1 - dim * 0.6;

      // связь: рисуется после стыковки, при hover импульсы только через него
      const drawn = THREE.MathUtils.smoothstep(a, 0.85, 1.0) * (1 - c);
      link.uniforms.uDraw.value = drawn;
      link.uniforms.uOpacity.value = (0.55 + h * 0.6) * (1 - dim * 0.7) * opts.on;
      link.uniforms.uDashSpeed.value = 0.9 + h * 2.2;
      link.uniforms.uWidth.value = 1.1 + h * 1.2;
      link.uniforms.uAdditive.value = opts.additive;
      link.mesh.visible = drawn > 0.01 && opts.on > 0.01;
      link.update(time);
    }
  }

  dispose() {
    this.meshes.forEach((m) => m.geometry.dispose());
    this.mats.forEach((m) => m.dispose());
    this.links.forEach((l) => l.dispose());
  }
}

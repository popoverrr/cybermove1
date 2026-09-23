/**
 * S6 · ТЕНДЕРЫ И ПРАВО: тонкие стальные пластины-документы слетаются и собираются в гранёную оболочку
 * вокруг ядра (грани икосаэдра). Синий лазерный контур обводит рёбра. Финал — замыкающее кольцо-печать.
 * Hover: тендерные строки — пластины веером, одна вперёд; правовые — оболочка смыкается.
 */
import * as THREE from 'three';
import { Polyline } from './Polyline';
import { patchEnvBlend } from '../Environment';

const easeInOutCubic = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

export class Plates {
  readonly group = new THREE.Group();
  /** обновлён ли объект в этом кадре активной сценой (Story сбрасывает и даёт дефолт) */
  touched = false;
  readonly plates: THREE.InstancedMesh;
  readonly edges: Polyline[] = [];
  readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshPhysicalMaterial>;
  readonly count = 20;
  private normals: THREE.Vector3[] = [];
  private quats: THREE.Quaternion[] = [];
  private tangents: THREE.Vector3[] = [];
  private spinAxes: THREE.Vector3[] = [];
  private dummy = new THREE.Object3D();
  private mat: THREE.MeshPhysicalMaterial;
  private ringMat: THREE.MeshPhysicalMaterial;
  private radius = 1.42;
  readonly hoverFan = { value: 0 };
  readonly hoverClose = { value: 0 };

  constructor(resolution: THREE.Vector2, envDark: THREE.Texture, envLight: THREE.Texture, envMix: THREE.IUniform<number>) {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const pos = ico.attributes.position;
    // грани: по 3 вершины (non-indexed)
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let f = 0; f < this.count; f++) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, f * 3 + k);
      const n = new THREE.Vector3().addVectors(v[0], v[1]).add(v[2]).normalize();
      this.normals.push(n);
      const tangent = new THREE.Vector3().subVectors(v[1], v[0]).normalize();
      this.tangents.push(tangent);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.quats.push(q);
      this.spinAxes.push(new THREE.Vector3(Math.sin(f * 1.3), Math.cos(f * 0.7), Math.sin(f * 2.1)).normalize());
    }
    // рёбра икосаэдра (уникальные)
    const edgeSet = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    for (let f = 0; f < this.count; f++) {
      for (let k = 0; k < 3; k++) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k);
        const b = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + ((k + 1) % 3));
        const key = [a, b].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`).sort().join('|');
        if (!edgeSet.has(key)) edgeSet.set(key, [a, b]);
      }
    }
    const R = this.radius * 1.06;
    for (const [a, b] of edgeSet.values()) {
      const pts = new Float32Array([a.x * R, a.y * R, a.z * R, b.x * R, b.y * R, b.z * R]);
      const line = new Polyline(pts, resolution, { width: 1.2, color: 0x0a24f5, color2: 0x4d7cff, opacity: 1 });
      line.uniforms.uDraw.value = 0;
      line.uniforms.uAdditive.value = 0;
      line.mesh.visible = false;
      this.edges.push(line);
      this.group.add(line.mesh);
    }
    ico.dispose();

    const g = new THREE.BoxGeometry(0.6, 0.76, 0.018);
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.3, clearcoat: 0.15, envMap: envDark, envMapIntensity: 1, transparent: true, opacity: 1, side: THREE.DoubleSide });
    patchEnvBlend(this.mat, envLight, { uEnvMix: envMix });
    this.plates = new THREE.InstancedMesh(g, this.mat, this.count);
    this.plates.frustumCulled = false;
    this.plates.visible = false;
    this.group.add(this.plates);

    this.ringMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0.1, envMap: envDark, envMapIntensity: 1.2, emissive: new THREE.Color(0x0a24f5), emissiveIntensity: 0, transparent: true, opacity: 1 });
    patchEnvBlend(this.ringMat, envLight, { uEnvMix: envMix });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.028, 16, 128), this.ringMat);
    this.ring.rotation.x = Math.PI / 2 - 0.35;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /**
   * assemble 0..1 — слетаются; contour 0..1 — лазерный обвод; seal 0..1 — кольцо-печать;
   * open 0..1 — раскрытие (выход); fan/close — hover; on — общая видимость.
   */
  update(opts: { time: number; dt: number; assemble: number; contour: number; seal: number; open: number; fan: number; close: number; on: number }) {
    this.touched = true;
    const { dt } = opts;
    this.hoverFan.value = dt === 0 ? opts.fan : this.hoverFan.value + (opts.fan - this.hoverFan.value) * (1 - Math.exp(-6 * dt));
    this.hoverClose.value = dt === 0 ? opts.close : this.hoverClose.value + (opts.close - this.hoverClose.value) * (1 - Math.exp(-6 * dt));
    const fan = this.hoverFan.value;
    const close = this.hoverClose.value;
    const tmpQ = new THREE.Quaternion();
    const spinQ = new THREE.Quaternion();
    for (let i = 0; i < this.count; i++) {
      const stag = i * 0.028;
      const a = easeInOutCubic((opts.assemble - stag) / 0.5);
      const o = easeInOutCubic((opts.open - stag * 0.6) / 0.6);
      const n = this.normals[i];
      // радиус: из далека → оболочка; веер — наружу; смыкание — внутрь; выход — наружу и дальше
      let r = 6.5 + (this.radius - 6.5) * a;
      r += fan * 0.3 * (1 + (i % 3) * 0.15);
      r -= close * 0.18;
      r += o * 7.0;
      this.dummy.position.copy(n).multiplyScalar(r);
      // «победившая заявка» — одна пластина вперёд к камере
      if (i === 7) this.dummy.position.z += fan * 1.0;
      // ориентация: по нормали грани; при подлёте — крутится; веер — поворот вокруг касательной
      spinQ.setFromAxisAngle(this.spinAxes[i], (1 - a) * 5.0 + o * 3.0);
      tmpQ.copy(this.quats[i]);
      if (fan > 0.001) {
        const fq = new THREE.Quaternion().setFromAxisAngle(this.tangents[i], fan * 0.55);
        tmpQ.premultiply(fq);
      }
      tmpQ.multiply(spinQ);
      this.dummy.quaternion.copy(tmpQ);
      const s = (1 + close * 0.12) * (1 - o * 0.5);
      this.dummy.scale.setScalar(Math.max(s, 0.001));
      this.dummy.updateMatrix();
      this.plates.setMatrixAt(i, this.dummy.matrix);
    }
    this.plates.instanceMatrix.needsUpdate = true;
    this.plates.visible = opts.on > 0.01 && opts.assemble > 0.001;
    this.mat.opacity = opts.on * (1 - easeInOutCubic(opts.open * 1.3));

    // лазерный обвод рёбер — последовательно
    const n = this.edges.length;
    for (let k = 0; k < n; k++) {
      const e = this.edges[k];
      const local = THREE.MathUtils.clamp((opts.contour * n - k) / 1.0, 0, 1);
      e.uniforms.uDraw.value = local;
      e.uniforms.uOpacity.value = (0.9 + close * 0.6) * opts.on * (1 - opts.open);
      e.uniforms.uWidth.value = 1.2 + close * 0.6;
      e.mesh.visible = local > 0.001 && opts.on > 0.01 && opts.open < 0.99;
      e.mesh.scale.setScalar(1 + fan * 0.25 - close * 0.1);
      e.update(opts.time);
    }

    // кольцо-печать
    const seal = easeInOutCubic(opts.seal);
    this.ring.visible = seal > 0.001 && opts.on > 0.01 && opts.open < 0.99;
    this.ring.scale.setScalar(3.2 + (1 - 3.2) * seal);
    this.ringMat.opacity = seal * opts.on * (1 - opts.open);
    this.ringMat.emissiveIntensity = Math.pow(Math.max(0, 1 - Math.abs(opts.seal - 0.9) * 8), 2) * 3 + close * 1.5;
    this.ring.rotation.z = opts.time * 0.1;
  }

  dispose() {
    this.plates.geometry.dispose();
    this.mat.dispose();
    this.edges.forEach((e) => e.dispose());
    this.ring.geometry.dispose();
    this.ringMat.dispose();
  }
}

/**
 * Story — единое состояние сюжета (BRIEF §8.7): прогресс экранов (из DOM через state) → параметры
 * камеры, ядра, частиц, орбит, фона и пост-эффектов. Сцены не знают о DOM: каждая — функция
 * от локального прогресса и времени, пишущая в Rig. Story применяет Rig к объектам.
 */
import * as THREE from 'three';
import type { Engine } from './Engine';
import { state, SCREEN_IDS } from '../lib/state';
import { POST_DARK, lerpPost, type PostParams } from './Post';
import type { BgMode, MASK } from './backgrounds/Background';
import { damp, clamp01 } from './math';
import { CoreScene } from './scenes/Core';
import { AuditScene } from './scenes/Audit';
import { SystemsScene } from './scenes/Systems';
import { BrandScene } from './scenes/Brand';
import { TrafficScene } from './scenes/Traffic';
import { LegalScene } from './scenes/Legal';
import { GrowthScene } from './scenes/Growth';
import { ContactScene } from './scenes/Contact';
import type { SceneModule } from './scenes/types';
import './objects/fields';

export interface Rig {
  cam: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** смещение атома относительно раскладки (десктоп — вправо, мобильный — вверх) */
  layoutOffset: number; // 0..1 — сила смещения
  atomPos: THREE.Vector3;
  /** общий масштаб атома (ядро + орбиты + облако) */
  atomScale: number;
  coreScale: number;
  coreStretch: THREE.Vector3;
  coreVisible: boolean;
  /** свечение ядра 0..1 (S5 «раскалено добела», импульс отправки формы) */
  coreEmissive: number;
  /** 1 — ядро стоит вертикально без покачивания (монолит) */
  coreUpright: number;
  envMix: number;
  envRot: number;
  bg: { a: BgMode; b: BgMode; mix: number; mask: keyof typeof MASK };
  beam: number;
  post: PostParams;
  orbits: { visible: number; spread: number; speedMul: number; width: number; opacity: number; color: THREE.Color; count: number };
  particles: { opacity: number; additive: number; size: number };
  parallax: number;
  pointerBulge: number;
}

export class Story {
  readonly engine: Engine;
  readonly rig: Rig;
  readonly scenes: SceneModule[] = [];
  private active = 0;
  private layoutX = 1.5;
  private layoutY = 0;
  private layoutScale = 1;
  private camMul = 1;
  private smoothPointer = new THREE.Vector2();
  private atomRot = new THREE.Vector2();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lastPointer = new THREE.Vector2(-1, -1);
  private hoverDist = Infinity;
  readonly postNow: PostParams = { ...POST_DARK };
  private particleDarkA = new THREE.Color(0xb8c2d4);
  private particleDarkB = new THREE.Color(0x5d86ff);
  private particleDarkSpark = new THREE.Color(0xffffff);
  private particleLightA = new THREE.Color(0x33373d);
  private particleLightB = new THREE.Color(0x0a24f5);
  private particleLightSpark = new THREE.Color(0x0e0f12);

  constructor(engine: Engine) {
    this.engine = engine;
    this.rig = {
      cam: new THREE.Vector3(0, 0, 7.6),
      look: new THREE.Vector3(0, 0, 0),
      fov: 30,
      layoutOffset: 1,
      atomPos: new THREE.Vector3(),
      atomScale: 0.86,
      coreScale: 1,
      coreStretch: new THREE.Vector3(1, 1, 1),
      coreVisible: true,
      coreEmissive: 0,
      coreUpright: 0,
      envMix: 0,
      envRot: 0,
      bg: { a: 'black', b: 'black', mix: 0, mask: 'uniform' },
      beam: 0,
      post: { ...POST_DARK },
      orbits: { visible: 1, spread: 1, speedMul: 1, width: 1, opacity: 0.55, color: new THREE.Color(0xc9ced6), count: 5 },
      particles: { opacity: 1, additive: 1, size: 2.2 },
      parallax: 1,
      pointerBulge: 1,
    };
    this.scenes = [new CoreScene(), new AuditScene(), new SystemsScene(), new BrandScene(), new TrafficScene(), new LegalScene(), new GrowthScene(), new ContactScene()];
    for (const s of this.scenes) s.init(engine, this.rig);
    this.onResize(window.innerWidth, window.innerHeight);
  }

  onResize(w: number, h: number) {
    const mobile = state.mobile;
    // сцена по центру-справа на десктопе, сверху на мобильном
    this.layoutX = mobile ? 0 : 1.45 * Math.min(1, (w / h) / 1.6);
    this.layoutY = mobile ? 1.0 : 0;
    // на мобильном атом меньше и дальше: сцена занимает верхнюю треть
    this.layoutScale = mobile ? 0.62 : Math.min(1, Math.max(0.8, (w / h) / 1.5));
    this.camMul = mobile ? 1.12 : 1;
    this.scenes.forEach((s) => s.onResize?.(w, h, mobile));
  }

  /** активный экран: последний, у которого прогресс > 0 */
  private pickActive(): number {
    let a = 0;
    for (let i = 0; i < SCREEN_IDS.length; i++) if (state.screens[i] > 0) a = i;
    return Math.min(a, this.scenes.length - 1);
  }

  update(dt: number, time: number) {
    const e = this.engine;
    const rig = this.rig;
    this.active = this.pickActive();
    const local = clamp01(state.screens[this.active]);
    state.screen = this.active;
    rig.coreEmissive = 0;
    rig.coreUpright = 0;
    this.scenes[this.active].update(rig, local, dt, time, e);
    this.applyObjectDefaults(dt, time);

    // --- камера + параллакс от курсора (инерционный)
    const px = state.pointer.active ? state.pointer.nx : 0;
    const py = state.pointer.active ? state.pointer.ny : 0;
    this.smoothPointer.x = damp(this.smoothPointer.x, px, 3.2, dt);
    this.smoothPointer.y = damp(this.smoothPointer.y, py, 3.2, dt);
    const par = rig.parallax * (state.reduced ? 0 : 1);
    e.camera.position.set(
      rig.cam.x + this.smoothPointer.x * 0.22 * par,
      rig.cam.y + this.smoothPointer.y * 0.14 * par,
      rig.cam.z * (1 + (this.camMul - 1) * rig.layoutOffset),
    );
    e.camera.lookAt(rig.look);
    if (Math.abs(e.camera.fov - rig.fov) > 0.01) {
      e.camera.fov = rig.fov;
      e.camera.updateProjectionMatrix();
    }

    // --- атом: раскладка + поворот к курсору
    const lx = this.layoutX * rig.layoutOffset;
    const ly = this.layoutY * rig.layoutOffset;
    e.atom.position.set(rig.atomPos.x + lx, rig.atomPos.y + ly, rig.atomPos.z);
    e.atom.scale.setScalar(rig.atomScale * (1 + (this.layoutScale - 1) * rig.layoutOffset));
    this.atomRot.x = damp(this.atomRot.x, -this.smoothPointer.y * 0.12 * par, 2.5, dt);
    this.atomRot.y = damp(this.atomRot.y, this.smoothPointer.x * 0.16 * par, 2.5, dt);
    e.atom.rotation.set(this.atomRot.x, this.atomRot.y + time * 0.02, 0);

    // --- ядро
    const core = e.core;
    core.mesh.visible = rig.coreVisible && rig.coreScale > 0.001;
    core.mesh.scale.setScalar(Math.max(rig.coreScale, 0.0001));
    core.uniforms.uStretch.value.copy(rig.coreStretch);
    core.uniforms.uEnvMix.value = rig.envMix;
    core.mesh.rotation.y = time * 0.05;
    core.mesh.rotation.x = Math.sin(time * 0.11) * 0.08 * (1 - rig.coreUpright);
    core.material.emissiveIntensity = rig.coreEmissive * 2.6;
    // прогиб к курсору: направление в объектных координатах
    if (rig.pointerBulge > 0 && state.pointer.active && !state.reduced) {
      this.tmp.set(this.smoothPointer.x * 3.5, this.smoothPointer.y * 2.2, 2.5).sub(this.tmp2.copy(e.atom.position));
      this.tmp.normalize();
      core.mesh.getWorldQuaternion(new THREE.Quaternion());
      const q = core.mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.tmp.applyQuaternion(q);
      core.uniforms.uPointerDir.value.lerp(this.tmp, 1 - Math.exp(-4 * dt));
      core.uniforms.uPointerAmt.value = damp(core.uniforms.uPointerAmt.value, 0.09 * rig.pointerBulge, 3, dt);
    } else {
      core.uniforms.uPointerAmt.value = damp(core.uniforms.uPointerAmt.value, 0, 3, dt);
    }

    // --- окружение: вращение бликов
    e.scene.environmentRotation.set(0, rig.envRot + time * 0.035 + this.smoothPointer.x * 0.08, 0);
    e.scene.environment = e.env.dark;

    // --- фон
    e.background.set(rig.bg.a, rig.bg.b, rig.bg.mix, rig.bg.mask);
    e.background.uniforms.uMouse.value.set(this.smoothPointer.x, this.smoothPointer.y);
    e.background.uniforms.uScroll.value = state.progress;
    e.background.uniforms.uBeam.value = rig.beam;
    // луч — под атомом: экранная x-координата атома в координатах фона
    this.tmp.copy(e.atom.position).project(e.camera);
    e.background.uniforms.uBeamPos.value.set(this.tmp.x * (e.camera.aspect), -1.0);

    // --- орбиты
    const ob = rig.orbits;
    for (let i = 0; i < e.orbits.length; i++) {
      const o = e.orbits[i];
      const inCount = i < ob.count ? 1 : 0;
      o.visible = damp(o.visible, ob.visible * inCount, 6, dt);
      if (dt === 0) o.visible = ob.visible * inCount;
      o.spread = ob.spread;
      o.highlight = damp(o.highlight, state.orbitHover === i ? 1 : 0, 8, dt);
      o.update(dt, time, { speedMul: ob.speedMul, additive: rig.particles.additive, baseColor: ob.color, baseOpacity: ob.opacity, width: ob.width });
    }

    // --- частицы
    const pu = e.particles.uniforms;
    pu.uOpacity.value = rig.particles.opacity;
    pu.uAdditive.value = rig.particles.additive;
    pu.uSize.value = rig.particles.size;
    // на светлых темах частицы тёмные (обычная альфа), на тёмных — светлые (additive)
    const light = 1 - rig.particles.additive;
    pu.uColorA.value.copy(this.particleDarkA).lerp(this.particleLightA, light);
    pu.uColorB.value.copy(this.particleDarkB).lerp(this.particleLightB, light);
    pu.uColorSpark.value.copy(this.particleDarkSpark).lerp(this.particleLightSpark, light);

    // --- пост-эффекты
    lerpPost(this.postNow, rig.post, dt === 0 ? 1 : 1 - Math.exp(-5 * dt), this.postNow);
    e.post?.apply(this.postNow);

    this.updateOrbitHover();
  }

  /** Объекты, не тронутые активной сценой в этом кадре, получают состояние «выключено» */
  private applyObjectDefaults(dt: number, time: number) {
    const e = this.engine;
    if (!e.scan.touched) {
      e.scan.updateClipping(e.core, e.atom, false);
      e.scan.update({ time, scan: 1, on: 0, layers: 0, hist: 0, split: 0, traj: 0, pointsSpread: 4 });
      for (let i = 0; i < 6; i++) {
        const a = state.anchors[`dp-${i}`];
        if (a) a.visible = 0;
      }
    }
    if (!e.nodes.touched) e.nodes.update({ time, dt, assemble: 1, collapse: 1, hovered: -1, additive: 1, on: 0 });
    if (!e.streams.touched) {
      e.streams.update({ time, dt, draw: 1, on: 0, hovered: -1, freeze: 1 });
      for (const k of Object.keys(state.anchors)) if (k.startsWith('metric-')) state.anchors[k].visible = 0;
    }
    if (!e.plates.touched) e.plates.update({ time, dt, assemble: 0, contour: 0, seal: 0, open: 0, fan: 0, close: 0, on: 0 });
    e.scan.touched = e.nodes.touched = e.streams.touched = e.plates.touched = false;
  }

  /** Hover/подписи орбит: проекция орбит в экран, расстояние до курсора (только на первом экране) */
  private updateOrbitHover() {
    const e = this.engine;
    const labels = state.orbitLabels;
    const p = state.pointer;
    const onCore = this.active === 0 && state.screens[0] < 0.55;
    let best = -1;
    let bestD = 28;
    e.atom.updateMatrixWorld();
    for (let i = 0; i < e.orbits.length; i++) {
      const o = e.orbits[i];
      const lab = labels[i];
      if (!lab) continue;
      // подпись у электрона
      this.tmp.copy(o.electron.position).applyMatrix4(e.atom.matrixWorld);
      const s = e.project(this.tmp, { x: 0, y: 0, z: 0 });
      lab.x = s.x;
      lab.y = s.y;
      lab.visible = onCore ? o.visible : 0;
      if (!onCore || !p.active || o.visible < 0.5) continue;
      for (let k = 0; k < 48; k++) {
        o.pointAt(k / 48, this.tmp).applyMatrix4(e.atom.matrixWorld);
        const q = e.project(this.tmp, { x: 0, y: 0, z: 0 });
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    state.orbitHover = best;
    this.hoverDist = bestD;
  }
}

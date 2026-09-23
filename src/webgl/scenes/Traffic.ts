/**
 * S5 · ТРАФИК — SYSTEM (BRIEF §7 S5). Тема solid blue с каустиками, текст белый.
 * Четыре потока-вихря (таргет, Google Ads, TikTok Ads, SEO) сходятся в ядро, раскалённое добела.
 * Hover: поток утолщается и ускоряется, рядом микрометка CPL/CAC/ROMI. Выход: потоки застывают
 * и нарезаются в пластины, фон становится серебряным.
 */
import * as THREE from 'three';
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_BLUE, POST_LIGHT, lerpPost } from '../Post';
import { range, smooth, easeInOutCubic, easeOutCubic, lerp } from '../math';
import { HoverMix } from './hover';
import { STREAM_IDS } from '../objects/Streams';
import { state } from '../../lib/state';

export class TrafficScene implements SceneModule {
  readonly id = 'traffic';
  private hover = new HoverMix(STREAM_IDS);
  private tmp = new THREE.Vector3();

  init() {}

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;
    this.hover.update(dt, state.screen === 4);
    const hovered = this.hover.active;

    const enter = easeOutCubic(range(local, 0, 0.2));
    const exitX = range(local, 0.8, 1.0);
    const ex = easeInOutCubic(exitX);

    // ---------- фон: blue; выход — серебро снизу
    rig.bg.a = 'blue';
    rig.bg.b = 'silver';
    rig.bg.mix = ex;
    rig.bg.mask = 'bottom';
    rig.beam = 0;
    rig.envMix = ex;
    lerpPost(POST_BLUE, POST_LIGHT, ex, rig.post);
    rig.post.bloomIntensity = lerp(POST_BLUE.bloomIntensity + 0.5, POST_LIGHT.bloomIntensity, ex);
    rig.particles.additive = 1 - ex;

    // ---------- камера, ядро: возникает из точки схождения струй, раскалено добела
    rig.cam.set(0, 0, 7.4);
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = 1;
    rig.parallax = 0.6;
    rig.pointerBulge = 0;
    rig.atomScale = 0.86;
    rig.coreVisible = true;
    rig.coreScale = lerp(0.001, 0.7, enter) * (1 + ex * 0.15);
    rig.coreStretch.set(1, 1, 1);
    e.core.setShapes(0, 0);
    cu.uMorph.value = 0;
    cu.uNoiseAmp.value = 0.04;
    cu.uNoiseSpeed.value = 0.35;
    cu.uWorleyAmp.value = 0.04;
    rig.coreEmissive = (0.35 + 0.65 * smooth(range(local, 0.1, 0.45))) * (1 - ex);
    rig.orbits.visible = 0;
    rig.orbits.count = 0;
    rig.envRot = 3.3 + local * 0.5;

    // ---------- потоки
    const draw = smooth(range(local, 0.04, 0.55));
    const freeze = smooth(range(exitX, 0.0, 0.6));
    e.streams.update({ time, dt, draw, on: 1 - smooth(range(exitX, 0.5, 1.0)), hovered, freeze });
    // микрометки CPL/CAC/ROMI у потоков
    for (let s = 0; s < STREAM_IDS.length; s++) {
      const id = `metric-${STREAM_IDS[s]}`;
      const a = state.anchors[id] || (state.anchors[id] = { x: 0, y: 0, visible: 0, hot: 0 });
      this.tmp.copy(e.streams.midPoints[s]).applyMatrix4(e.atom.matrixWorld);
      const p = e.project(this.tmp, { x: 0, y: 0, z: 0 });
      a.x = p.x;
      a.y = p.y;
      a.visible = e.streams.hover[s] * (1 - ex);
      a.hot = 1;
    }

    // ---------- частицы: струи → потоки; выход — оболочка
    if (exitX <= 0) {
      e.particles.setTarget('A', getTarget('jets'), 'jets');
      e.particles.setTarget('B', getTarget('flows'), 'flows');
      pu.uMix.value = smooth(range(local, 0.0, 0.35));
      pu.uCurlAmp.value = 0.05;
      pu.uCurlSpeed.value = 0.4;
      rig.particles.opacity = 1.0;
      rig.particles.size = 1.6;
    } else {
      e.particles.setTarget('A', getTarget('flows'), 'flows');
      e.particles.setTarget('B', getTarget('shell'), 'shell');
      pu.uMix.value = ex;
      pu.uCurlAmp.value = lerp(0.05, 0.02, ex);
      rig.particles.opacity = lerp(1.0, 0.35, ex);
      rig.particles.size = lerp(1.6, 1.2, ex);
    }
    // пластины начинают слетаться ещё на выходе (непрерывность с S6)
    e.plates.update({ time, dt, assemble: smooth(range(exitX, 0.35, 1.0)) * 0.35, contour: 0, seal: 0, open: 0, fan: 0, close: 0, on: smooth(range(exitX, 0.3, 0.8)) });
    rig.atomPos.set(0, 0, 0);
  }
}

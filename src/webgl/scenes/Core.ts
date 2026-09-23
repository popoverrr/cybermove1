/**
 * S1 · ЯДРО — CHAOS → CORE (BRIEF §7 S1).
 * Интро по времени (~2.8 с): осколки в curl-поле стягиваются в электронное облако (|ψ|² орбиталей),
 * из капли формируется ядро жидкого хрома, вокруг встают 5 орбит с электронами.
 * Удержание: облако медленно перетекает 1s → 2p → 3d. Выход: dolly-in камеры в ядро,
 * орбиты уходят за кадр, облако вытягивается в световые штрихи, ядро заполняет экран.
 */
import * as THREE from 'three';
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_DARK } from '../Post';
import { range, smooth, easeInOutCubic, easeOutCubic, lerp, clamp01 } from '../math';
import { state } from '../../lib/state';

export const INTRO_DURATION = 2.8;
const CYCLE = ['1s', '2p', '3d'];
const SLOT = 6.5; // секунд на орбиталь

export class CoreScene implements SceneModule {
  readonly id = 'core';
  private engine!: Engine;
  private introStart = 0;
  private orbitColor = new THREE.Color(0xc9ced6);

  init(engine: Engine) {
    this.engine = engine;
    // стартовые цели: хаос → 1s
    engine.particles.setTarget('A', getTarget('chaos'), 'chaos');
    engine.particles.setTarget('B', getTarget('1s'), '1s');
    engine.core.setShapes(0, 0);
  }

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const t = time - this.introStart; // время интро (время движка стартует с 0)
    const intro = clamp01(t / INTRO_DURATION);
    if (intro >= 1 && !state.introDone) {
      state.introDone = true;
    }

    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;

    // ---------- фон и пост
    rig.bg.a = 'black';
    rig.bg.b = 'black';
    rig.bg.mix = 0;
    rig.beam = 0;
    rig.envMix = 0;
    Object.assign(rig.post, POST_DARK);
    rig.post.bloomIntensity = lerp(1.5, POST_DARK.bloomIntensity, smooth(range(t, 0.4, 2.6)));
    rig.particles.additive = 1;

    // ---------- интро: частицы
    const mixIntro = easeInOutCubic(range(t, 0.05, 2.3));
    const curlIntro = lerp(1.7, 0.07, smooth(range(t, 0.25, 2.5)));
    pu.uCurlFreq.value = lerp(0.22, 0.32, mixIntro);
    pu.uCurlSpeed.value = lerp(0.35, 0.09, mixIntro);
    rig.particles.opacity = 0.8 * smooth(range(t, 0.0, 0.7));
    rig.particles.size = lerp(1.6, 1.2, mixIntro);

    // ---------- интро: ядро из капли
    const coreIn = easeOutCubic(range(t, 0.55, 2.15));
    rig.coreVisible = t > 0.5;
    const settle = smooth(range(t, 0.9, 2.7));
    rig.coreStretch.set(lerp(0.72, 1, settle), lerp(1.45, 1, settle), lerp(0.72, 1, settle));
    cu.uNoiseAmp.value = lerp(0.30, 0.03, settle);
    cu.uNoiseFreq.value = lerp(1.1, 1.6, settle);
    cu.uNoiseSpeed.value = lerp(0.6, 0.18, settle);
    cu.uWorleyAmp.value = lerp(0, 0.065, smooth(range(t, 1.5, 2.8)));

    // ---------- интро: орбиты
    const orbitCount = t > 1.35 ? Math.min(5, Math.floor((t - 1.35) / 0.21) + 1) : 0;
    rig.orbits.count = orbitCount;
    rig.orbits.visible = 1;
    rig.orbits.speedMul = lerp(2.2, 1, smooth(range(t, 1.4, 3.2)));
    rig.orbits.color = this.orbitColor;

    // ---------- удержание: перетекание орбиталей
    const holdT = Math.max(0, t - INTRO_DURATION);
    const slot = Math.floor(holdT / SLOT);
    const f = (holdT % SLOT) / SLOT;
    const cur = CYCLE[slot % CYCLE.length];
    const nxt = CYCLE[(slot + 1) % CYCLE.length];
    const exitX = range(local, 0.55, 1.0);
    const preExit = 1 - range(local, 0.3, 0.5); // перед выходом облако возвращается к текущей орбитали
    let cycleMix = smooth(range(f, 0.52, 0.96)) * preExit;

    if (intro < 1) {
      e.particles.setTarget('A', getTarget('chaos'), 'chaos');
      e.particles.setTarget('B', getTarget('1s'), '1s');
      pu.uMix.value = mixIntro;
      pu.uCurlAmp.value = curlIntro;
    } else if (exitX <= 0) {
      e.particles.setTarget('A', getTarget(cur), cur);
      e.particles.setTarget('B', getTarget(nxt), nxt);
      pu.uMix.value = cycleMix;
      pu.uCurlAmp.value = 0.07 + 0.3 * Math.sin(cycleMix * Math.PI);
    }

    // ---------- камера и раскладка
    const camIn = easeOutCubic(range(t, 0.0, 2.6));
    const ex = easeInOutCubic(exitX);
    rig.cam.set(0, 0, lerp(lerp(9.4, 7.6, camIn), 2.35, ex));
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = 1 - smooth(range(local, 0.55, 0.85));
    rig.parallax = 1 - ex;
    rig.pointerBulge = 1 - ex;

    // ---------- выход
    if (exitX > 0) {
      const streak = easeInOutCubic(range(local, 0.6, 0.95));
      e.particles.setTarget('A', getTarget(cur), cur);
      e.particles.setTarget('B', getTarget('streak'), 'streak');
      pu.uMix.value = streak;
      pu.uCurlAmp.value = lerp(0.07, 0.015, streak);
      rig.particles.size = lerp(1.2, 2.4, streak);
      rig.particles.opacity = lerp(0.8, 1.1, streak) * (1 - range(local, 0.9, 1.0) * 0.6);
      rig.orbits.spread = lerp(1, 2.8, ex);
      rig.orbits.opacity = 0.55 * (1 - smooth(range(exitX, 0.1, 0.65)));
      rig.orbits.visible = 1 - smooth(range(exitX, 0.35, 0.75));
      rig.coreScale = lerp(1, 1.15, ex);
      cu.uNoiseAmp.value = lerp(0.03, 0.015, ex);
      rig.post.bloomIntensity = lerp(POST_DARK.bloomIntensity, 1.25, ex);
      rig.post.bloomThreshold = lerp(POST_DARK.bloomThreshold, 0.6, ex);
      rig.post.vignette = lerp(POST_DARK.vignette, 0.7, ex);
    } else {
      rig.orbits.spread = 1;
      rig.orbits.opacity = 0.55;
      rig.coreScale = coreIn;
    }
    rig.coreScale = exitX > 0 ? rig.coreScale : coreIn;
    rig.atomPos.set(0, 0, 0);
    rig.envRot = 0;
  }
}

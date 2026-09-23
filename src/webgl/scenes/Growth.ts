/**
 * S7 · РОСТ — GROWTH (BRIEF §7 S7). Тема black с синим лучом снизу (ref-07).
 * Атом возвращается крупнее, орбит 10–15, они расходятся как кольца роста. Выход: орбиты схлопываются
 * в спокойный атом. (Заполняется в Фазе 3; сейчас — непрерывное продолжение выхода S6.)
 */
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_DARK } from '../Post';
import { range, smooth, easeInOutCubic, lerp } from '../math';

export class GrowthScene implements SceneModule {
  readonly id = 'growth';
  init() {}

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;
    const enter = smooth(range(local, 0, 0.25));
    const exitX = range(local, 0.82, 1.0);
    const ex = easeInOutCubic(exitX);

    rig.bg.a = 'black';
    rig.bg.b = 'black';
    rig.bg.mix = 0;
    rig.bg.mask = 'uniform';
    rig.beam = lerp(0.9, 0.5, enter) * (1 - ex * 0.6);
    rig.envMix = 0;
    Object.assign(rig.post, POST_DARK);
    rig.particles.additive = 1;

    rig.cam.set(0, 0, lerp(7.4, 8.6, enter));
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = 1;
    rig.parallax = 0.8;
    rig.pointerBulge = 0.5;
    rig.atomScale = lerp(0.86, 0.8, enter);
    rig.coreVisible = true;
    rig.coreScale = lerp(1.3, 1.0, enter);
    rig.coreStretch.set(1, 1, 1);
    rig.coreEmissive = 0;
    e.core.setShapes(0, 0);
    cu.uMorph.value = 0;
    cu.uNoiseAmp.value = 0.03;
    cu.uWorleyAmp.value = 0.065;

    // кольца роста: орбиты расходятся; на выходе схлопываются в спокойный атом
    const rings = smooth(range(local, 0.05, 0.6));
    rig.orbits.visible = enter;
    rig.orbits.count = Math.round(lerp(5, e.orbits.length, rings));
    rig.orbits.spread = lerp(1, 1.35, rings) * (1 - ex * 0.25);
    rig.orbits.opacity = 0.32;
    rig.orbits.speedMul = 1;
    rig.envRot = 4.2 + local * 0.4;

    e.particles.setTarget('A', getTarget('calm'), 'calm');
    e.particles.setTarget('B', getTarget('1s'), '1s');
    pu.uMix.value = smooth(range(local, 0.1, 0.5));
    pu.uCurlAmp.value = 0.06;
    rig.particles.opacity = 0.6;
    rig.particles.size = 1.2;
    rig.atomPos.set(0, 0, 0);
  }
}

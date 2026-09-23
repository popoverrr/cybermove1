/**
 * S8 · КОНТАКТ (BRIEF §7 S8). Тема black. Слева форма, справа спокойный атом. Низкая активность.
 * Фокус в поле ускоряет электроны; успешная отправка даёт импульсную волну от ядра. (Доводится в Фазе 3.)
 */
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_DARK } from '../Post';
import { range, smooth, lerp, damp } from '../math';
import { state } from '../../lib/state';

export class ContactScene implements SceneModule {
  readonly id = 'contact';
  private focus = 0;
  private pulse = 0;
  init() {
    state.events.on('formSuccess', () => {
      this.pulse = 1;
    });
  }

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;
    const enter = smooth(range(local, 0, 0.6));
    this.focus = dt === 0 ? (state.formFocus ? 1 : 0) : damp(this.focus, state.formFocus ? 1 : 0, 4, dt);
    this.pulse = dt === 0 ? this.pulse : Math.max(0, this.pulse - dt * 0.55);

    rig.bg.a = 'black';
    rig.bg.b = 'black';
    rig.bg.mix = 0;
    rig.bg.mask = 'uniform';
    rig.beam = lerp(0.3, 0.15, enter);
    rig.envMix = 0;
    Object.assign(rig.post, POST_DARK);
    rig.post.bloomIntensity = POST_DARK.bloomIntensity + this.pulse * 0.8;
    rig.particles.additive = 1;

    rig.cam.set(0, 0, 8.6);
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = lerp(0.5, 1, enter);
    rig.parallax = 0.6;
    rig.pointerBulge = 0.4;
    rig.atomScale = 0.8;
    rig.coreVisible = true;
    rig.coreScale = 1.0 + this.pulse * 0.08;
    rig.coreStretch.set(1, 1, 1);
    rig.coreEmissive = this.pulse * 0.6;
    e.core.setShapes(0, 0);
    cu.uMorph.value = 0;
    cu.uNoiseAmp.value = 0.03;
    cu.uWorleyAmp.value = 0.065;

    rig.orbits.visible = 1;
    rig.orbits.count = 5;
    rig.orbits.spread = 1 + this.pulse * 0.6;
    rig.orbits.opacity = 0.5;
    rig.orbits.speedMul = 0.7 + this.focus * 1.6 + this.pulse * 2;
    rig.envRot = 4.6;

    e.particles.setTarget('A', getTarget('1s'), '1s');
    e.particles.setTarget('B', getTarget('2p'), '2p');
    pu.uMix.value = 0.5 + 0.5 * Math.sin(time * 0.15);
    pu.uCurlAmp.value = 0.05 + this.pulse * 0.5;
    rig.particles.opacity = 0.55;
    rig.particles.size = 1.2 + this.pulse * 0.8;
    rig.atomPos.set(0, 0, 0);
  }
}

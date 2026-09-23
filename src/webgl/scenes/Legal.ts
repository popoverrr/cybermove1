/**
 * S6 · ТЕНДЕРЫ И ПРАВО — SYSTEM (BRIEF §7 S6). Тема matte silver, синий акцент.
 * Пластины-документы собираются в гранёную оболочку вокруг ядра, синий лазерный контур обводит грани,
 * финал — кольцо-печать. Hover: тендерные строки — веер, одна пластина вперёд; правовые — оболочка смыкается.
 * Выход: оболочка раскрывается, ядро выходит наружу и разрастается, фон чёрный с синим лучом.
 */
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_LIGHT, POST_DARK, lerpPost } from '../Post';
import { range, smooth, easeInOutCubic, lerp } from '../math';
import { HoverMix } from './hover';
import { state } from '../../lib/state';

const KEYS = ['tender-monitoring', 'tender-application', 'contracts', 'corporate'] as const;

export class LegalScene implements SceneModule {
  readonly id = 'legal';
  private hover = new HoverMix(KEYS, 6);

  init() {}

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;
    this.hover.update(dt, state.screen === 5);
    const fan = Math.max(this.hover.get('tender-monitoring'), this.hover.get('tender-application'));
    const close = Math.max(this.hover.get('contracts'), this.hover.get('corporate'));

    const exitX = range(local, 0.8, 1.0);
    const ex = easeInOutCubic(exitX);

    // ---------- фон: silver; выход — чёрный с лучом
    rig.bg.a = 'silver';
    rig.bg.b = 'black';
    rig.bg.mix = ex;
    rig.bg.mask = 'uniform';
    rig.beam = smooth(range(exitX, 0.4, 1.0)) * 0.9;
    rig.envMix = 1 - ex;
    lerpPost(POST_LIGHT, POST_DARK, ex, rig.post);
    rig.particles.additive = ex;

    // ---------- камера, ядро
    rig.cam.set(0, 0, 7.4);
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = 1 - smooth(range(exitX, 0.2, 1.0)) * 0.5;
    rig.parallax = 0.6;
    rig.pointerBulge = 0;
    rig.atomScale = 0.86;
    rig.coreVisible = true;
    rig.coreScale = lerp(0.8, 1.3, smooth(range(exitX, 0.3, 1.0)));
    rig.coreStretch.set(1, 1, 1);
    rig.coreEmissive = 0;
    e.core.setShapes(0, 0);
    cu.uMorph.value = 0;
    cu.uNoiseAmp.value = 0.03;
    cu.uNoiseSpeed.value = 0.18;
    cu.uWorleyAmp.value = 0.065;
    rig.orbits.visible = 0;
    rig.orbits.count = 0;
    rig.envRot = 3.8 + local * 0.4;

    // ---------- пластины: слетаются 0..0.45, контур 0.35..0.7, печать 0.68..0.8, раскрытие на выходе
    const assemble = 0.35 + 0.65 * smooth(range(local, 0.0, 0.42));
    e.plates.update({
      time,
      dt,
      assemble,
      contour: smooth(range(local, 0.34, 0.68)),
      seal: smooth(range(local, 0.66, 0.8)),
      open: smooth(range(exitX, 0.0, 0.85)),
      fan,
      close,
      on: 1,
    });

    // ---------- частицы: оболочка; выход — спокойный атом
    if (exitX <= 0) {
      e.particles.setTarget('A', getTarget('shell'), 'shell');
      e.particles.setTarget('B', getTarget('shell'), 'shell');
      pu.uMix.value = 0;
      pu.uCurlAmp.value = 0.02;
      rig.particles.opacity = 0.35;
      rig.particles.size = 1.2;
    } else {
      e.particles.setTarget('A', getTarget('shell'), 'shell');
      e.particles.setTarget('B', getTarget('calm'), 'calm');
      pu.uMix.value = ex;
      pu.uCurlAmp.value = 0.02 + 0.1 * Math.sin(ex * Math.PI);
      rig.particles.opacity = lerp(0.35, 0.55, ex);
      rig.particles.size = 1.2;
    }
    rig.atomPos.set(0, 0, 0);
  }
}

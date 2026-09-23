/**
 * S4 · БРЕНД И КОНТЕНТ — SYSTEM (BRIEF §7 S4). Тема black, студийный свет.
 * Одна крупная капля жидкого хрома, морфинг: капля → звезда (ядро бренда) → объектив (продакшн) →
 * рамка 9:16 (SMM) → волны (PR) → монолит в луче (личный бренд). Скролл сменяет формы, hover принуждает.
 * Выход: капля распадается на четыре струи частиц, фон заливается синим от центра.
 */
import type { Engine } from '../Engine';
import type { Rig } from '../Story';
import type { SceneModule } from './types';
import { getTarget } from '../objects/targets';
import { POST_DARK, POST_BLUE, lerpPost } from '../Post';
import { range, smooth, easeInOutCubic, lerp, damp } from '../math';
import { HoverMix } from './hover';
import { state } from '../../lib/state';

const KEYS = ['brand-core', 'production', 'smm', 'pr', 'personal-brand'] as const;
/** дорожка форм: индекс 0 — капля, далее формы услуг по порядку */
const TRACK = [6, 1, 2, 3, 4, 5];

export class BrandScene implements SceneModule {
  readonly id = 'brand';
  private hover = new HoverMix(KEYS, 5);
  private hoverBlend = 0;
  private hoverPos = 1;

  init() {}

  update(rig: Rig, local: number, dt: number, time: number, e: Engine) {
    const cu = e.core.uniforms;
    const pu = e.particles.uniforms;
    this.hover.update(dt, state.screen === 3);
    const active = this.hover.active;

    const exitX = range(local, 0.82, 1.0);
    const ex = easeInOutCubic(exitX);

    // ---------- фон: black; выход — синим от центра
    rig.bg.a = 'black';
    rig.bg.b = 'blue';
    rig.bg.mix = ex;
    rig.bg.mask = 'radial';
    rig.envMix = 0;
    lerpPost(POST_DARK, POST_BLUE, ex, rig.post);
    rig.particles.additive = 1;

    // ---------- камера, ядро крупно
    rig.cam.set(0, 0, 7.2);
    rig.look.set(0, 0, 0);
    rig.fov = 30;
    rig.layoutOffset = 1;
    rig.parallax = 0.8;
    rig.pointerBulge = 0.6;
    rig.atomScale = 0.95;
    rig.coreVisible = true;
    rig.coreStretch.set(1, 1, 1);
    cu.uNoiseAmp.value = 0.05;
    cu.uNoiseSpeed.value = 0.22;
    cu.uWorleyAmp.value = 0.02;
    cu.uTurb.value = 0.14;
    rig.orbits.visible = 0;
    rig.orbits.count = 0;
    // световые карты скользят по поверхности
    rig.envRot = 0.9 + local * 2.4;

    // ---------- морфинг: позиция на дорожке по скроллу, hover принуждает форму строки
    const scrollPos = 1 + smooth(range(local, 0.1, 0.8)) * 4; // 1 (звезда) … 5 (монолит)
    const target = active >= 0 ? active + 1 : scrollPos;
    this.hoverBlend = dt === 0 ? (active >= 0 ? 1 : 0) : damp(this.hoverBlend, active >= 0 ? 1 : 0, 5, dt);
    if (active >= 0) this.hoverPos = dt === 0 ? target : damp(this.hoverPos, target, 5, dt);
    else this.hoverPos = dt === 0 ? scrollPos : damp(this.hoverPos, scrollPos, 5, dt);
    let pos = lerp(scrollPos, this.hoverPos, this.hoverBlend);
    // вход: из капли в звезду; выход: обратно в каплю и растворение
    const enterT = smooth(range(local, 0.0, 0.12));
    pos = lerp(0, pos, enterT);
    if (exitX > 0) pos = lerp(pos, 0, smooth(range(exitX, 0, 0.6)));
    e.core.morphAlong(TRACK, pos);
    // монолит в луче света (ref-07)
    const monolith = Math.max(0, 1 - Math.abs(pos - 5));
    rig.beam = monolith * (1 - ex);
    rig.coreScale = lerp(1.05, 0.98, enterT) * (1 - smooth(range(exitX, 0.35, 0.95)));
    // монолит стоит вертикально: без покачивания
    rig.coreUpright = monolith;

    // ---------- частицы: спокойное облако; выход — четыре струи
    if (exitX <= 0) {
      e.particles.setTarget('A', getTarget('1s'), '1s');
      e.particles.setTarget('B', getTarget('calm'), 'calm');
      pu.uMix.value = smooth(range(local, 0, 0.3));
      pu.uCurlAmp.value = 0.06;
      rig.particles.opacity = 0.45;
      rig.particles.size = 1.2;
    } else {
      e.particles.setTarget('A', getTarget('calm'), 'calm');
      e.particles.setTarget('B', getTarget('jets'), 'jets');
      pu.uMix.value = smooth(range(exitX, 0.2, 1.0));
      pu.uCurlAmp.value = 0.06 + 0.35 * Math.sin(ex * Math.PI);
      rig.particles.opacity = lerp(0.45, 1.1, ex);
      rig.particles.size = lerp(1.2, 2.0, ex);
    }
    rig.atomPos.set(0, 0, 0);
  }
}

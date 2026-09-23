import type { Engine } from '../Engine';
import type { Rig } from '../Story';

export interface SceneModule {
  readonly id: string;
  init(engine: Engine, rig: Rig): void;
  /** local — прогресс экрана 0..1; функция должна быть детерминированной по local (для ?progress) */
  update(rig: Rig, local: number, dt: number, time: number, engine: Engine): void;
  onResize?(w: number, h: number, mobile: boolean): void;
}

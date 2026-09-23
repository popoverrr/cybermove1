/**
 * Точка входа three-чанка. Загружается лениво из lib/home.ts после первой отрисовки.
 */
import { Engine } from './Engine';

export type { Engine };

/** Движок без собственного цикла: кадры рисует единый gsap.ticker главной (BRIEF-V1 §2) */
export function create(canvas: HTMLCanvasElement, onFirstFrame?: () => void): Engine {
  const engine = new Engine({ canvas, onFirstFrame });
  (window as unknown as { __cmEngine: Engine }).__cmEngine = engine;
  return engine;
}

/** Движок со своим rAF (лаборатории /dev/*) */
export function boot(canvas: HTMLCanvasElement, onFirstFrame?: () => void): Engine {
  const engine = create(canvas, onFirstFrame);
  engine.start();
  return engine;
}

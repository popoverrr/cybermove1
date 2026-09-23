/**
 * Точка входа three-чанка. Загружается лениво из lib/home.ts после первой отрисовки.
 */
import { Engine } from './Engine';

export type { Engine };

export function boot(canvas: HTMLCanvasElement, onFirstFrame?: () => void): Engine {
  const engine = new Engine({ canvas, onFirstFrame });
  engine.start();
  (window as unknown as { __cmEngine: Engine }).__cmEngine = engine;
  return engine;
}

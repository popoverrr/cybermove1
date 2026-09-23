/** Web Worker: проекция вершин icosphere на SDF-формы (не блокирует главный поток). */
import { projectShape } from './shapes';

self.onmessage = (e: MessageEvent<{ dirs: Float32Array; shapes: number[] }>) => {
  const { dirs, shapes } = e.data;
  for (const shape of shapes) {
    const { pos, nor } = projectShape(shape, dirs);
    (self as unknown as Worker).postMessage({ shape, pos, nor }, [pos.buffer, nor.buffer]);
  }
  (self as unknown as Worker).postMessage({ done: true });
};

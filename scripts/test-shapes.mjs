// Проверка SDF-проекций форм ядра: радиусы вдоль осей (node --experimental-strip-types scripts/test-shapes.mjs)
import { projectShape, sdf } from '../src/webgl/objects/shapes.ts';
const dirs = new Float32Array([1,0,0, 0,1,0, 0,0,1, 0.7071,0.7071,0, 0.577,0.577,0.577, -1,0,0]);
for (const s of [0,1,2,3,4,5,6]) {
  const { pos } = projectShape(s, dirs);
  const r = [];
  for (let i=0;i<6;i++) r.push(Math.hypot(pos[i*3],pos[i*3+1],pos[i*3+2]).toFixed(2));
  console.log('shape', s, 'radii x,y,z,xy,xyz,-x:', r.join(' '), ' sdf(0)=', sdf(s,[0,0,0]).toFixed(2));
}

/**
 * SDF целевых форм для морфинга жидкого хрома (BRIEF §7 S4, §8.3).
 * Все формы «звёздные» относительно начала координат: луч из центра пересекает поверхность один раз,
 * поэтому вершины icosphere проецируются вдоль радиуса без разрывов топологии.
 *
 * 0 sphere   — ядро (S1)
 * 1 star     — четырёхлучевая звезда (позиционирование и ядро бренда, ref-03)
 * 2 lens     — объектив-кольцо (продакшн)
 * 3 frame    — скруглённая рамка 9:16 (SMM)
 * 4 ripple   — концентрические волны (PR)
 * 5 monolith — вертикальный монолит (личный бренд, ref-07)
 * 6 drop     — капля/сплющенный эллипсоид (переходы, S6 «ядро выходит наружу»)
 */

export const SHAPE_NAMES = ['sphere', 'star', 'lens', 'frame', 'ripple', 'monolith', 'drop'] as const;
export type ShapeName = (typeof SHAPE_NAMES)[number];
export const SHAPE_COUNT = SHAPE_NAMES.length;

type V3 = [number, number, number];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};
const len2 = (x: number, y: number) => Math.hypot(x, y);
const len3 = (x: number, y: number, z: number) => Math.hypot(x, y, z);

function sdSphere(p: V3, r: number) {
  return len3(p[0], p[1], p[2]) - r;
}

function sdRoundBox(p: V3, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(p[0]) - bx;
  const qy = Math.abs(p[1]) - by;
  const qz = Math.abs(p[2]) - bz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return len3(ox, oy, oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

/** Капсула-шип: от a к b, радиус сужается от r1 до r2 */
function sdSpike(p: V3, a: V3, b: V3, r1: number, r2: number) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const pax = p[0] - a[0];
  const pay = p[1] - a[1];
  const paz = p[2] - a[2];
  const bb = bax * bax + bay * bay + baz * baz;
  const h = clamp((pax * bax + pay * bay + paz * baz) / bb, 0, 1);
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  const r = r1 + (r2 - r1) * Math.pow(h, 0.8);
  return len3(dx, dy, dz) - r;
}

/** Сплющенный по z цилиндр со скруглением */
function sdRoundedCylinder(p: V3, radius: number, height: number, round: number) {
  const dx = len2(p[0], p[1]) - radius + round;
  const dy = Math.abs(p[2]) - height + round;
  return Math.min(Math.max(dx, dy), 0) + len2(Math.max(dx, 0), Math.max(dy, 0)) - round;
}

export function sdf(shape: number, p: V3): number {
  switch (shape) {
    case 0:
      return sdSphere(p, 1.0);
    case 1: {
      // Звезда: 4 сужающихся шипа в плоскости XY + ядро; лёгкая толщина по z у центра
      const L = 1.6;
      const arms = Math.min(
        Math.min(sdSpike(p, [0, 0, 0], [L, 0, 0], 0.34, 0.02), sdSpike(p, [0, 0, 0], [-L, 0, 0], 0.34, 0.02)),
        Math.min(sdSpike(p, [0, 0, 0], [0, L, 0], 0.34, 0.02), sdSpike(p, [0, 0, 0], [0, -L, 0], 0.34, 0.02)),
      );
      const core = sdSphere(p, 0.42);
      return smin(arms, core, 0.35);
    }
    case 2: {
      // Объектив: плоский цилиндр с выпуклой линзой в центре и кольцом-ободом
      const body = sdRoundedCylinder(p, 1.15, 0.3, 0.16);
      const lens = sdSphere([p[0], p[1], p[2] * 1.0 - 0.9], 1.25); // выпуклость спереди
      const rim = Math.max(sdRoundedCylinder(p, 1.15, 0.38, 0.1), -sdRoundedCylinder(p, 0.95, 0.5, 0.05));
      return smin(Math.min(body, rim), Math.max(lens, sdRoundedCylinder(p, 0.9, 0.6, 0.05)), 0.12);
    }
    case 3: {
      // Рамка 9:16: скруглённая пластина с углублением-экраном (звёздность сохраняем — без сквозного отверстия)
      const plate = sdRoundBox(p, 0.62, 1.1, 0.12, 0.14);
      const screen = sdRoundBox([p[0], p[1], p[2] - 0.2], 0.5, 0.96, 0.12, 0.06);
      return Math.max(plate, -screen + 0.0);
    }
    case 4: {
      // Концентрические волны: диск, толщина которого колеблется по радиусу
      const r = len2(p[0], p[1]);
      const wave = 0.15 + 0.1 * Math.cos(r * 6.5 - 0.6) * Math.exp(-r * 0.3);
      const disk = Math.max(r - 1.25, Math.abs(p[2]) - wave);
      const round = disk - 0.06;
      return smin(round, sdSphere(p, 0.28), 0.2);
    }
    case 5: {
      // Монолит: высокий скруглённый брус, чуть шире у основания
      const w = 0.36 + 0.05 * clamp(-p[1] * 0.4, -0.2, 0.3);
      return sdRoundBox(p, w, 1.35, 0.24, 0.08);
    }
    case 6: {
      // Капля: сплющенный эллипсоид с лёгкой асимметрией
      const k = 1 + 0.18 * p[1];
      return len3(p[0] / (1.05 * k), p[1] / 0.92, p[2] / (1.05 * k)) - 1.0;
    }
    default:
      return sdSphere(p, 1.0);
  }
}

/** Точка пересечения луча из центра вдоль d с поверхностью формы, и нормаль там (градиент SDF). */
export function projectRay(shape: number, d: V3, out: Float32Array, outN: Float32Array, i: number) {
  const tMax = 3.2;
  const step = 0.025;
  let tPrev = 0;
  let fPrev = sdf(shape, [0, 0, 0]);
  let t = step;
  let found = false;
  const p: V3 = [0, 0, 0];
  while (t <= tMax) {
    p[0] = d[0] * t;
    p[1] = d[1] * t;
    p[2] = d[2] * t;
    const f = sdf(shape, p);
    if (fPrev <= 0 && f > 0) {
      found = true;
      break;
    }
    tPrev = t;
    fPrev = f;
    t += step;
  }
  let hit = found ? t : tMax;
  if (found) {
    let lo = tPrev;
    let hi = t;
    for (let k = 0; k < 14; k++) {
      const mid = 0.5 * (lo + hi);
      p[0] = d[0] * mid;
      p[1] = d[1] * mid;
      p[2] = d[2] * mid;
      if (sdf(shape, p) > 0) hi = mid;
      else lo = mid;
    }
    hit = 0.5 * (lo + hi);
  }
  out[i * 3] = d[0] * hit;
  out[i * 3 + 1] = d[1] * hit;
  out[i * 3 + 2] = d[2] * hit;
  // нормаль — центральные разности SDF
  const e = 0.004;
  const px = d[0] * hit;
  const py = d[1] * hit;
  const pz = d[2] * hit;
  let nx = sdf(shape, [px + e, py, pz]) - sdf(shape, [px - e, py, pz]);
  let ny = sdf(shape, [px, py + e, pz]) - sdf(shape, [px, py - e, pz]);
  let nz = sdf(shape, [px, py, pz + e]) - sdf(shape, [px, py, pz - e]);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  outN[i * 3] = nx;
  outN[i * 3 + 1] = ny;
  outN[i * 3 + 2] = nz;
}

/** Проекция всех направлений (unit sphere positions) на форму. */
export function projectShape(shape: number, dirs: Float32Array): { pos: Float32Array; nor: Float32Array } {
  const n = dirs.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const d: V3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    d[0] = dirs[i * 3];
    d[1] = dirs[i * 3 + 1];
    d[2] = dirs[i * 3 + 2];
    projectRay(shape, d, pos, nor, i);
  }
  return { pos, nor };
}

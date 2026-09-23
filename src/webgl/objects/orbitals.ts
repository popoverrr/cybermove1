/**
 * Распределения частиц (BRIEF §7 S1): «реальный атом» — плотности вероятности |ψ|²
 * водородоподобных орбиталей 1s, 2p, 3d, а также хаос-поле для интро.
 *
 * Сэмплирование точное и факторизованное: радиальная часть P(r) ∝ r^{2l+2} e^{-2r/n} — гамма-распределение
 * (сумма экспонент), угловая часть — rejection sampling по |Y_lm|². Даёт ту же |ψ|², что и rejection в 3D,
 * но в ~100 раз быстрее (60k точек за ~20 мс).
 */

export type Rng = () => number;

/** Детерминированный ГСЧ (mulberry32), чтобы скриншоты были воспроизводимы */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gamma(k, θ) для целого k — сумма k экспонент */
function gamma(rng: Rng, k: number, theta: number) {
  let s = 0;
  for (let i = 0; i < k; i++) s -= Math.log(1 - rng());
  return s * theta;
}

function uniformDir(rng: Rng, out: Float32Array, i: number, r: number) {
  const u = rng() * 2 - 1;
  const phi = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out[i * 3] = r * s * Math.cos(phi);
  out[i * 3 + 1] = r * u;
  out[i * 3 + 2] = r * s * Math.sin(phi);
}

/** Масштабирует облако так, чтобы заданный процентиль радиуса стал target */
function normalizeRadius(pts: Float32Array, percentile: number, target: number) {
  const n = pts.length / 3;
  const rs = new Float32Array(n);
  for (let i = 0; i < n; i++) rs[i] = Math.hypot(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  const sorted = Float32Array.from(rs).sort();
  const r = sorted[Math.min(n - 1, Math.floor(n * percentile))] || 1;
  const k = target / r;
  for (let i = 0; i < pts.length; i++) pts[i] *= k;
  return pts;
}

/** 1s: |ψ|² ∝ e^{-2r}; P(r) ∝ r² e^{-2r} = Gamma(3, 1/2); направление равномерное */
export function orbital1s(n: number, rng: Rng, radius = 2.1) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) uniformDir(rng, out, i, gamma(rng, 3, 0.5));
  return normalizeRadius(out, 0.9, radius);
}

/** 2p (m=0, ось y): |ψ|² ∝ r² e^{-r} cos²θ; P(r) = Gamma(5, 1); cosθ = cbrt(2v−1) */
export function orbital2p(n: number, rng: Rng, radius = 2.5) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = gamma(rng, 5, 1);
    const u = Math.cbrt(rng() * 2 - 1);
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    out[i * 3] = r * s * Math.cos(phi);
    out[i * 3 + 1] = r * u;
    out[i * 3 + 2] = r * s * Math.sin(phi);
  }
  // лёгкий наклон оси, чтобы гантель не стояла строго вертикально
  rotateY(out, 0.35);
  rotateZ(out, 0.55);
  return normalizeRadius(out, 0.9, radius);
}

/** 3d_xy: |ψ|² ∝ r⁴ e^{-2r/3} sin⁴θ sin²2φ; P(r) = Gamma(7, 3/2); углы — rejection */
export function orbital3d(n: number, rng: Rng, radius = 2.8) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = gamma(rng, 7, 1.5);
    // θ ∈ [0, π] с плотностью ∝ sin⁴θ · sinθ (якобиан)
    let theta = 0;
    for (;;) {
      theta = rng() * Math.PI;
      const s = Math.sin(theta);
      if (rng() < s * s * s * s * s) break;
    }
    let phi = 0;
    for (;;) {
      phi = rng() * Math.PI * 2;
      const q = Math.sin(2 * phi);
      if (rng() < q * q) break;
    }
    const s = Math.sin(theta);
    out[i * 3] = r * s * Math.cos(phi);
    out[i * 3 + 1] = r * Math.cos(theta);
    out[i * 3 + 2] = r * s * Math.sin(phi);
  }
  rotateX(out, 0.5);
  rotateY(out, 0.3);
  return normalizeRadius(out, 0.9, radius);
}

/** Хаос: осколки далеко от центра, плотность растёт к краю (турбулентность добавляет шейдер) */
export function chaosField(n: number, rng: Rng, rMin = 2.5, rMax = 9) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rng(), 0.55);
    uniformDir(rng, out, i, rMin + (rMax - rMin) * t);
  }
  return out;
}

/** Световые штрихи: точки вытянуты вдоль оси z (к камере) — для выхода S1 */
export function streakField(n: number, rng: Rng, spread = 3.5, length = 14) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const r = spread * Math.sqrt(rng()) + 0.6;
    out[i * 3] = Math.cos(a) * r;
    out[i * 3 + 1] = Math.sin(a) * r;
    out[i * 3 + 2] = (rng() - 0.3) * length;
  }
  return out;
}

export function rotateX(pts: Float32Array, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < pts.length; i += 3) {
    const y = pts[i + 1];
    const z = pts[i + 2];
    pts[i + 1] = y * c - z * s;
    pts[i + 2] = y * s + z * c;
  }
}
export function rotateY(pts: Float32Array, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i];
    const z = pts[i + 2];
    pts[i] = x * c + z * s;
    pts[i + 2] = -x * s + z * c;
  }
}
export function rotateZ(pts: Float32Array, a: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i];
    const y = pts[i + 1];
    pts[i] = x * c - y * s;
    pts[i + 1] = x * s + y * c;
  }
}

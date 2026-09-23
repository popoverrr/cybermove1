/**
 * Целевые поля частиц для экранов S2–S8: сеть узлов, связи графа, четыре струи, потоки-вихри,
 * оболочка, спокойный атом. Регистрируются в реестре targets.
 */
import * as THREE from 'three';
import { registerTarget } from './targets';
import type { Rng } from './orbitals';

function gauss(rng: Rng) {
  // Бокса–Мюллера
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** S2 выход: точки данных становятся узлами и разлетаются в сеть */
registerTarget('network', (n, rng) => {
  const out = new Float32Array(n * 3);
  const nodes: number[][] = [];
  for (let i = 0; i < 42; i++) {
    const a = rng() * Math.PI * 2;
    const r = 1.4 + rng() * 3.4;
    nodes.push([Math.cos(a) * r, (rng() - 0.5) * 4.2, Math.sin(a) * r * 0.5 - 0.5]);
  }
  for (let i = 0; i < n; i++) {
    const t = rng();
    if (t < 0.3) {
      const nd = nodes[Math.floor(rng() * nodes.length)];
      out[i * 3] = nd[0] + gauss(rng) * 0.05;
      out[i * 3 + 1] = nd[1] + gauss(rng) * 0.05;
      out[i * 3 + 2] = nd[2] + gauss(rng) * 0.05;
    } else {
      const a = nodes[Math.floor(rng() * nodes.length)];
      const b = nodes[Math.floor(rng() * nodes.length)];
      const k = rng();
      out[i * 3] = a[0] + (b[0] - a[0]) * k + gauss(rng) * 0.01;
      out[i * 3 + 1] = a[1] + (b[1] - a[1]) * k + gauss(rng) * 0.01;
      out[i * 3 + 2] = a[2] + (b[2] - a[2]) * k + gauss(rng) * 0.01;
    }
  }
  return out;
});

/** S3: связи узлов графа с ядром + ореолы узлов (координаты узлов — как в Nodes) */
registerTarget('links', (n, rng) => {
  const out = new Float32Array(n * 3);
  const targets: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2 + 0.45;
    const r = 1.72 + (i % 2) * 0.22;
    targets.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.82, i % 2 ? -0.35 : 0.25));
  }
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rng() * 5);
    const t = targets[k];
    const u = rng();
    if (u < 0.15) {
      // ореол узла
      const g = 0.25 + rng() * 0.2;
      out[i * 3] = t.x + gauss(rng) * g * 0.35;
      out[i * 3 + 1] = t.y + gauss(rng) * g * 0.35;
      out[i * 3 + 2] = t.z + gauss(rng) * g * 0.35;
    } else {
      const s = rng();
      const w = 0.025 + Math.sin(s * Math.PI) * 0.035;
      out[i * 3] = t.x * (1 - s) + gauss(rng) * w;
      out[i * 3 + 1] = t.y * (1 - s) + gauss(rng) * w;
      out[i * 3 + 2] = t.z * (1 - s) + Math.sin(s * Math.PI) * 0.25 * (k % 2 ? -1 : 1) + gauss(rng) * w;
    }
  }
  return out;
});

/** S4 выход: капля распадается на четыре струи частиц */
registerTarget('jets', (n, rng) => {
  const out = new Float32Array(n * 3);
  const dirs = [
    [1, 0.75, 0.1],
    [-1, 0.72, -0.1],
    [0.95, -0.7, 0.15],
    [-0.9, -0.78, -0.15],
  ].map((d) => new THREE.Vector3(d[0], d[1], d[2]).normalize());
  for (let i = 0; i < n; i++) {
    const d = dirs[i % 4];
    const t = Math.pow(rng(), 0.7) * 6.5;
    const spread = 0.05 + t * 0.09;
    out[i * 3] = d.x * t + gauss(rng) * spread;
    out[i * 3 + 1] = d.y * t + gauss(rng) * spread;
    out[i * 3 + 2] = d.z * t + gauss(rng) * spread;
  }
  return out;
});

/** Точка потока s ∈ 0..3 в параметре t ∈ 0..1 (та же формула, что в Streams) */
export function streamPoint(s: number, t: number, u: number, out: THREE.Vector3) {
  // все четыре потока приходят слева (ядро справа), веером; спираль закручена попеременно
  const theta = Math.PI + (s - 1.5) * 0.62;
  const dir = s % 2 === 0 ? 1 : -1;
  const r = 4.2 * (1 - t) * (1 - t) + 0.62 * (1 - Math.pow(1 - t, 2)) + 0.05;
  const ang = theta + dir * t * t * 2.6 + (1 - t) * 0.25 * dir;
  const width = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.04;
  const twist = t * 4.2 + s;
  const ox = Math.cos(twist) * u * width;
  const oy = Math.sin(twist) * 0.6 * u * width;
  const oz = Math.sin(twist * 0.7) * u * width;
  out.set(Math.cos(ang) * r + ox, Math.sin(ang) * r * 0.78 + oy, Math.sin(ang * 1.7 + s) * 0.35 * (1 - t) + oz);
  return out;
}

/** S5: частицы вдоль четырёх потоков, плотнее к ядру */
registerTarget('flows', (n, rng) => {
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = i % 4;
    const t = 1 - Math.pow(rng(), 1.6);
    const u = (rng() - 0.5) * 2.2;
    streamPoint(s, t, u, v);
    out[i * 3] = v.x + gauss(rng) * 0.03;
    out[i * 3 + 1] = v.y + gauss(rng) * 0.03;
    out[i * 3 + 2] = v.z + gauss(rng) * 0.03;
  }
  return out;
});

/** S6: редкая оболочка вокруг ядра (грани и рёбра) */
registerTarget('shell', (n, rng) => {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 1.75 + Math.pow(rng(), 3) * 3.5;
    out[i * 3] = r * s * Math.cos(phi);
    out[i * 3 + 1] = r * u;
    out[i * 3 + 2] = r * s * Math.sin(phi);
  }
  return out;
});

/** S7/S8: спокойное разреженное облако вокруг атома */
registerTarget('calm', (n, rng) => {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 1.3 + Math.pow(rng(), 0.6) * 4.5;
    out[i * 3] = r * s * Math.cos(phi);
    out[i * 3 + 1] = r * u * 0.8;
    out[i * 3 + 2] = r * s * Math.sin(phi);
  }
  return out;
});

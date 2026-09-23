/**
 * Реестр целевых полей частиц: буферы считаются по требованию и кэшируются.
 * Все буферы одной длины (максимум частиц HIGH), тир рисует первые N.
 */
import { TIERS } from '../tiers';
import { mulberry32, orbital1s, orbital2p, orbital3d, chaosField, streakField, type Rng } from './orbitals';

export const MAX_PARTICLES = TIERS.high.particles;

type Gen = (n: number, rng: Rng) => Float32Array;

const generators: Record<string, Gen> = {
  chaos: (n, rng) => chaosField(n, rng, 2.6, 9.5),
  '1s': (n, rng) => orbital1s(n, rng, 1.95),
  '2p': (n, rng) => orbital2p(n, rng, 2.25),
  '3d': (n, rng) => orbital3d(n, rng, 2.55),
  streak: (n, rng) => streakField(n, rng, 3.2, 16),
};

const cache = new Map<string, Float32Array>();

export function registerTarget(name: string, gen: Gen) {
  generators[name] = gen;
}

export function getTarget(name: string): Float32Array {
  const hit = cache.get(name);
  if (hit) return hit;
  const gen = generators[name];
  if (!gen) throw new Error(`Нет генератора частиц «${name}»`);
  // отдельный детерминированный seed на каждое поле
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const buf = gen(MAX_PARTICLES, mulberry32(h >>> 0));
  cache.set(name, buf);
  return buf;
}

export function hasTarget(name: string) {
  return name in generators;
}

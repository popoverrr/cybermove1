/**
 * Параметры отладки из URL:
 *   ?progress=0.37   — поставить сюжет в точку (0..1 по всей главной)
 *   ?still           — заморозить время (для скриншотов)
 *   ?tier=high|mid|low — принудительный тир качества
 *   ?debug           — панель Tweakpane
 *   ?t=2.4           — зафиксировать время интро (секунды), вместе с still
 */
export type Tier = 'high' | 'mid' | 'low';

export interface DebugParams {
  progress: number | null;
  still: boolean;
  tier: Tier | null;
  debug: boolean;
  time: number | null;
}

export function readParams(): DebugParams {
  if (typeof location === 'undefined') {
    return { progress: null, still: false, tier: null, debug: false, time: null };
  }
  const q = new URLSearchParams(location.search);
  const tier = q.get('tier');
  const progress = q.get('progress');
  const time = q.get('t');
  return {
    progress: progress !== null && progress !== '' ? Math.min(1, Math.max(0, Number(progress))) : null,
    still: q.has('still'),
    tier: tier === 'high' || tier === 'mid' || tier === 'low' ? tier : null,
    debug: q.has('debug'),
    time: time !== null && time !== '' ? Number(time) : null,
  };
}

export const PARAMS: DebugParams = readParams();

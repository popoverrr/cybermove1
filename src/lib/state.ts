/**
 * Общее состояние главной: DOM пишет (скролл, курсор, hover), WebGL читает.
 * Живёт в основном чанке, чтобы three-чанк мог подключиться позже.
 */

export const SCREEN_IDS = ['core', 'audit', 'systems', 'brand', 'traffic', 'legal', 'growth', 'contact'] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

type Listener<T> = (payload: T) => void;

class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Listener<any>>>();
  on<K extends keyof Events>(name: K, fn: Listener<Events[K]>) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name)!.add(fn);
    return () => this.map.get(name)?.delete(fn);
  }
  emit<K extends keyof Events>(name: K, payload: Events[K]) {
    this.map.get(name)?.forEach((fn) => fn(payload));
  }
}

export interface SceneEvents extends Record<string, unknown> {
  hover: string | null;
  orbitClick: number;
  formFocus: boolean;
  formSuccess: undefined;
  screen: number;
  ready: undefined;
  pulse: number;
}

export interface SceneState {
  /** прогресс каждого экрана 0..1 (0 — ещё не вошли, 1 — ушли) */
  screens: Float32Array;
  /** глобальный прогресс 0..1 по всей странице */
  progress: number;
  /** индекс текущего экрана */
  screen: number;
  /** позиция курсора: px и нормализованная (-1..1, y вверх) */
  pointer: { x: number; y: number; nx: number; ny: number; active: boolean };
  /** id услуги под курсором (ServiceRow) или null */
  hover: string | null;
  /** id услуги, открытой в Drawer */
  open: string | null;
  /** орбита под курсором (S1) */
  orbitHover: number;
  /** фокус в поле формы */
  formFocus: boolean;
  /** громкость низких частот 0..1 (когда есть аудио) */
  bass: number;
  /** мобильная раскладка (сцена сверху) */
  mobile: boolean;
  /** уменьшенное движение */
  reduced: boolean;
  /** интро S1 завершено */
  introDone: boolean;
  /** экранные позиции подписей орбит (пишет WebGL, читает DOM) */
  orbitLabels: Array<{ x: number; y: number; visible: number }>;
  /** произвольные HTML-лейблы, привязанные к 3D-точкам: id → экранная позиция */
  anchors: Record<string, { x: number; y: number; visible: number; hot: number }>;
  events: Emitter<SceneEvents>;
}

export const state: SceneState = {
  screens: new Float32Array(SCREEN_IDS.length),
  progress: 0,
  screen: 0,
  pointer: { x: 0, y: 0, nx: 0, ny: 0, active: false },
  hover: null,
  open: null,
  orbitHover: -1,
  formFocus: false,
  bass: 0,
  mobile: false,
  reduced: false,
  introDone: false,
  orbitLabels: Array.from({ length: 5 }, () => ({ x: 0, y: 0, visible: 0 })),
  anchors: {},
  events: new Emitter<SceneEvents>(),
};

export function setHover(id: string | null) {
  if (state.hover === id) return;
  state.hover = id;
  state.events.emit('hover', id);
}

/** Доступ для отладки в консоли */
if (typeof window !== 'undefined') {
  (window as unknown as { __cm: SceneState }).__cm = state;
}

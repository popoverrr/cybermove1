/**
 * Фоновая музыка (BRIEF-4 §2): бесшовная петля 113 с, играет сразу при открытии сайта; если браузер
 * блокирует автозапуск — стартует с первого жеста пользователя (клик, тап, клавиша; скролл жестом не считается).
 * Кнопка SOUND выключает и запоминает выбор (`localStorage.cm_audio`), позиция переносится между страницами
 * (`sessionStorage.cm_audio_pos`). Ничего из /audio/ не грузится до первой попытки `play()` (preload="none").
 * AnalyserNode: низкие частоты → state.bass (дыхание сферы, вклад ≤ 2 %).
 */
import { AUDIO_TRACK } from '../../site.config';
import { state } from './state';
import { withBase } from './base';

const KEY = 'cm_audio';
const POS = 'cm_audio_pos';
const VOLUME = 0.55;
/** длина петли, с (audio/loop.json) */
const LOOP_LEN = 113.13;

type Sources = string | string[] | null;

let start: (() => void) | null = null;
/** Запустить музыку из внешнего кода (выбор языка — это тоже жест, BRIEF-4 §2) */
export function startAudio() {
  start?.();
}

function pickSource(list: string[]): string | null {
  const probe = document.createElement('audio');
  for (const src of list) {
    const ext = src.split('.').pop() || '';
    const type = ext === 'opus' ? 'audio/ogg; codecs=opus' : ext === 'm4a' ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/mpeg';
    if (probe.canPlayType(type)) return src;
  }
  return list[list.length - 1] ?? null;
}

export function initAudio() {
  const btn = document.querySelector<HTMLButtonElement>('[data-audio-toggle]');
  if (!btn) return;
  /** отладка и тесты: состояние плеера без обращения к DOM (элемент Audio вне документа) */
  const dbg: { playing: boolean; time: number; src: string; last: string } = { playing: false, time: 0, src: '', last: '' };
  (window as unknown as { __cmAudio: typeof dbg }).__cmAudio = dbg;
  const list = ((AUDIO_TRACK as Sources) ?? null) === null ? [] : Array.isArray(AUDIO_TRACK) ? (AUDIO_TRACK as string[]) : [AUDIO_TRACK as string];
  if (!list.length) {
    btn.hidden = true;
    return;
  }
  const picked = pickSource(list);
  if (!picked) {
    btn.hidden = true;
    return;
  }
  const src = withBase(`/${picked.replace(/^\//, '')}`);

  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let audio: HTMLAudioElement | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  let on = false;
  let raf = 0;
  let posTimer = 0;

  const setUi = (v: boolean) => {
    btn.setAttribute('aria-pressed', String(v));
    btn.classList.toggle('is-on', v);
    btn.setAttribute('aria-label', v ? btn.dataset.labelOff || '' : btn.dataset.labelOn || '');
  };

  const readPos = () => {
    try {
      const v = Number(sessionStorage.getItem(POS));
      return Number.isFinite(v) && v > 0 ? v % LOOP_LEN : 0;
    } catch {
      return 0;
    }
  };

  const ensure = () => {
    if (ctx) return;
    ctx = new AudioContext();
    audio = new Audio();
    audio.preload = 'none';
    audio.loop = true;
    audio.crossOrigin = 'anonymous';
    audio.src = src;
    const from = readPos();
    if (from > 0) {
      audio.addEventListener('loadedmetadata', () => {
        try {
          audio!.currentTime = from;
        } catch {}
      }, { once: true });
    }
    const source = ctx.createMediaElementSource(audio);
    gain = ctx.createGain();
    gain.gain.value = 0;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    data = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
  };

  const loop = () => {
    if (!analyser || !data) return;
    dbg.playing = Boolean(audio && !audio.paused);
    dbg.time = audio ? audio.currentTime : 0;
    dbg.src = src;
    analyser.getByteFrequencyData(data);
    // низкие частоты: первые ~8 бинов (до ~700 Гц при 44.1k/256)
    let s = 0;
    for (let i = 1; i < 8; i++) s += data[i];
    const bass = s / (7 * 255);
    state.bass = state.bass + (bass - state.bass) * 0.2;
    raf = on ? requestAnimationFrame(loop) : 0;
  };

  const fade = (to: number, sec = 1.5) => {
    if (!gain || !ctx) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + sec);
  };

  const savePos = () => {
    if (!audio) return;
    try {
      sessionStorage.setItem(POS, String(audio.currentTime));
    } catch {}
  };

  /**
   * Попытка запуска: тихо возвращает false, если браузер не дал (без ошибок в консоли).
   * `ctx.resume()` в заблокированном профиле не отклоняется, а висит до жеста — поэтому ждём его не дольше 300 мс.
   */
  const tryPlay = async (): Promise<boolean> => {
    ensure();
    if (!ctx || !audio) return false;
    if (ctx.state === 'suspended') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => window.setTimeout(r, 300))]);
    }
    try {
      await audio.play();
    } catch (err) {
      dbg.last = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return false;
    }
    dbg.last = 'ok';
    on = true;
    fade(VOLUME, 1.5);
    setUi(true);
    if (!raf) raf = requestAnimationFrame(loop);
    if (!posTimer) posTimer = window.setInterval(savePos, 2000);
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    return true;
  };

  const turnOff = () => {
    on = false;
    dbg.playing = false;
    savePos();
    fade(0, 0.9);
    setUi(false);
    state.bass = 0;
    window.setTimeout(() => {
      if (!on) audio?.pause();
    }, 1000);
    try {
      localStorage.setItem(KEY, '0');
    } catch {}
  };

  btn.addEventListener('click', () => {
    if (on) turnOff();
    else void tryPlay();
  });
  setUi(false);

  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === '0';
  } catch {}

  // жесты, которые браузеры считают активацией (скролл и колесо — нет)
  const gestures = ['pointerdown', 'keydown', 'touchend', 'click'] as const;
  const onGesture = () => {
    if (on || muted) return;
    void tryPlay().then((ok) => {
      if (ok) offGestures();
    });
  };
  const offGestures = () => gestures.forEach((g) => window.removeEventListener(g, onGesture));
  start = () => {
    if (!muted) void tryPlay().then((ok) => ok && offGestures());
  };

  // слушатели жестов ставим сразу: первая попытка может «зависнуть» в ожидании активации вкладки
  if (!muted) {
    gestures.forEach((g) => window.addEventListener(g, onGesture, { passive: true }));
    void tryPlay().then((ok) => ok && offGestures());
    // вкладка открыта в фоне — пробуем ещё раз, когда она становится видимой
    document.addEventListener('visibilitychange', () => {
      if (!on && !muted && !document.hidden) void tryPlay().then((ok) => ok && offGestures());
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!on) return;
    if (document.hidden) {
      savePos();
      fade(0, 0.4);
      window.setTimeout(() => {
        if (document.hidden && on) audio?.pause();
      }, 450);
    } else {
      void audio?.play().catch(() => {});
      fade(VOLUME, 0.6);
    }
  });
  window.addEventListener('pagehide', savePos);
}

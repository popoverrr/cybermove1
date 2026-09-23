/**
 * AudioToggle: WebAudio, выключен по умолчанию, плавные fade, выбор запоминается (localStorage).
 * Если трека нет (AUDIO_TRACK = null) — кнопка скрыта. AnalyserNode: низкие частоты → state.bass (пульс ядра).
 */
import { AUDIO_TRACK } from '../../site.config';
import { state } from './state';

const KEY = 'cm_audio';

export function initAudio() {
  const btn = document.querySelector<HTMLButtonElement>('[data-audio-toggle]');
  if (!btn) return;
  if (!AUDIO_TRACK) {
    btn.hidden = true;
    return;
  }
  const src = `/${AUDIO_TRACK.replace(/^\//, '')}`;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let audio: HTMLAudioElement | null = null;
  let data: Uint8Array<ArrayBuffer> | null = null;
  let on = false;
  let raf = 0;

  const setUi = (v: boolean) => {
    btn.setAttribute('aria-pressed', String(v));
    btn.classList.toggle('is-on', v);
    btn.setAttribute('aria-label', v ? btn.dataset.labelOff || '' : btn.dataset.labelOn || '');
  };

  const ensure = async () => {
    if (ctx) return;
    ctx = new AudioContext();
    audio = new Audio(src);
    audio.loop = true;
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
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
    analyser.getByteFrequencyData(data);
    // низкие частоты: первые ~8 бинов (до ~700 Гц при 44.1k/256)
    let s = 0;
    for (let i = 1; i < 8; i++) s += data[i];
    const bass = s / (7 * 255);
    state.bass = state.bass + (bass - state.bass) * 0.2;
    raf = on ? requestAnimationFrame(loop) : 0;
  };

  const fade = (to: number, sec = 1.2) => {
    if (!gain || !ctx) return;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + sec);
  };

  const turnOn = async () => {
    await ensure();
    if (!ctx || !audio) return;
    if (ctx.state === 'suspended') await ctx.resume();
    try {
      await audio.play();
    } catch {
      return;
    }
    on = true;
    fade(0.55);
    setUi(true);
    if (!raf) raf = requestAnimationFrame(loop);
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
  };

  const turnOff = () => {
    on = false;
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

  btn.addEventListener('click', () => (on ? turnOff() : turnOn()));
  setUi(false);

  // если пользователь включал раньше — включаем после первого жеста (автовоспроизведение без жеста запрещено)
  let remembered = false;
  try {
    remembered = localStorage.getItem(KEY) === '1';
  } catch {}
  if (remembered) {
    const once = () => {
      turnOn();
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
    window.addEventListener('pointerdown', once, { once: true });
    window.addEventListener('keydown', once, { once: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!on || !gain) return;
    fade(document.hidden ? 0 : 0.55, 0.6);
  });
}

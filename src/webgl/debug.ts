/** Панель отладки (?debug): Tweakpane с материалами, светом, счётчиком кадров. */
import { Pane } from 'tweakpane';
import type { Engine } from './Engine';
import { state } from '../lib/state';

export function mountDebug(engine: Engine) {
  const pane = new Pane({ title: 'CYBERMOVE · debug', expanded: true });
  const el = (pane as unknown as { element: HTMLElement }).element;
  el.style.position = 'fixed';
  el.style.top = '80px';
  el.style.right = '12px';
  el.style.zIndex = '2000';
  el.style.width = '300px';

  const fps = pane.addFolder({ title: 'Кадр' });
  fps.addBinding(engine.stats, 'fps', { readonly: true });
  fps.addBinding(engine.stats, 'frameMs', { readonly: true, format: (v: number) => v.toFixed(2) });
  fps.addBinding(engine.stats, 'tier', { readonly: true });
  fps.addBinding(engine.stats, 'particles', { readonly: true });
  fps.addBinding(engine.stats, 'verts', { readonly: true });
  fps.addBinding(state, 'progress', { readonly: true, format: (v: number) => v.toFixed(3) });
  fps.addBinding(state, 'screen', { readonly: true });

  const mat = pane.addFolder({ title: 'Хром' });
  const m = engine.core.material;
  mat.addBinding(m, 'roughness', { min: 0, max: 0.4, step: 0.005 });
  mat.addBinding(m, 'metalness', { min: 0, max: 1, step: 0.01 });
  mat.addBinding(m, 'clearcoat', { min: 0, max: 1, step: 0.01 });
  mat.addBinding(m, 'clearcoatRoughness', { min: 0, max: 0.5, step: 0.005 });
  mat.addBinding(m, 'envMapIntensity', { min: 0, max: 3, step: 0.05 });
  const u = engine.core.uniforms;
  mat.addBinding(u.uNoiseAmp, 'value', { label: 'noiseAmp', min: 0, max: 0.4, step: 0.005 });
  mat.addBinding(u.uNoiseFreq, 'value', { label: 'noiseFreq', min: 0.2, max: 5, step: 0.05 });
  mat.addBinding(u.uWorleyAmp, 'value', { label: 'worleyAmp', min: 0, max: 0.3, step: 0.005 });
  mat.addBinding(u.uWorleyFreq, 'value', { label: 'worleyFreq', min: 0.5, max: 6, step: 0.05 });
  mat.addBinding(u.uMorph, 'value', { label: 'morph', min: 0, max: 1, step: 0.01 });
  mat.addBinding(u.uEnvMix, 'value', { label: 'envMix', min: 0, max: 1, step: 0.01 });

  const pf = pane.addFolder({ title: 'Частицы' });
  const pu = engine.particles.uniforms;
  pf.addBinding(pu.uSize, 'value', { label: 'size', min: 0.5, max: 8, step: 0.1 });
  pf.addBinding(pu.uCurlAmp, 'value', { label: 'curlAmp', min: 0, max: 3, step: 0.01 });
  pf.addBinding(pu.uCurlFreq, 'value', { label: 'curlFreq', min: 0.05, max: 2, step: 0.01 });
  pf.addBinding(pu.uMix, 'value', { label: 'mix', min: 0, max: 1, step: 0.01 });
  pf.addBinding(pu.uOpacity, 'value', { label: 'opacity', min: 0, max: 2, step: 0.01 });

  const env = pane.addFolder({ title: 'Свет и пост' });
  env.addBinding(engine.scene, 'environmentIntensity', { min: 0, max: 3, step: 0.05 });
  env.addBinding(engine.renderer, 'toneMappingExposure', { min: 0.2, max: 2.5, step: 0.05 });
  if (engine.post) {
    env.addBinding(engine.post.bloom, 'intensity', { min: 0, max: 4, step: 0.05 });
    env.addBinding(engine.post.bloom.luminanceMaterial, 'threshold', { min: 0, max: 1.5, step: 0.01 });
  }

  pane.addButton({ title: 'Понизить тир' }).on('click', () => {
    const next = engine.tier.name === 'high' ? 'mid' : 'low';
    engine.setTier(next);
  });

  setInterval(() => pane.refresh(), 250);
}

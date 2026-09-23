/**
 * Пост-эффекты (BRIEF §8.6): bloom, лёгкая хроматическая аберрация по краям, зерно, виньетка,
 * тонмаппинг Khronos PBR Neutral (сохраняет фирменный синий и серые стали), SMAA на high.
 * Параметры интерполируются по скроллу через apply().
 */
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ChromaticAberrationEffect,
  NoiseEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  BlendFunction,
} from 'postprocessing';
import type { TierSpec } from './tiers';

export interface PostParams {
  bloomIntensity: number;
  bloomThreshold: number;
  bloomRadius: number;
  chromatic: number; // px-ish offset
  noise: number; // 0..1 opacity
  vignette: number; // darkness 0..1
  vignetteOffset: number;
}

export const POST_DARK: PostParams = { bloomIntensity: 0.75, bloomThreshold: 0.92, bloomRadius: 0.7, chromatic: 0.0018, noise: 0.07, vignette: 0.55, vignetteOffset: 0.28 };
export const POST_LIGHT: PostParams = { bloomIntensity: 0.12, bloomThreshold: 0.98, bloomRadius: 0.5, chromatic: 0.0008, noise: 0.045, vignette: 0.2, vignetteOffset: 0.35 };
export const POST_BLUE: PostParams = { bloomIntensity: 0.55, bloomThreshold: 0.85, bloomRadius: 0.75, chromatic: 0.0012, noise: 0.06, vignette: 0.32, vignetteOffset: 0.3 };

export function lerpPost(a: PostParams, b: PostParams, t: number, out: PostParams): PostParams {
  const k = Math.min(1, Math.max(0, t));
  out.bloomIntensity = a.bloomIntensity + (b.bloomIntensity - a.bloomIntensity) * k;
  out.bloomThreshold = a.bloomThreshold + (b.bloomThreshold - a.bloomThreshold) * k;
  out.bloomRadius = a.bloomRadius + (b.bloomRadius - a.bloomRadius) * k;
  out.chromatic = a.chromatic + (b.chromatic - a.chromatic) * k;
  out.noise = a.noise + (b.noise - a.noise) * k;
  out.vignette = a.vignette + (b.vignette - a.vignette) * k;
  out.vignetteOffset = a.vignetteOffset + (b.vignetteOffset - a.vignetteOffset) * k;
  return out;
}

export class Post {
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly chromatic: ChromaticAberrationEffect | null;
  readonly noise: NoiseEffect | null;
  readonly vignette: VignetteEffect;
  readonly tone: ToneMappingEffect;
  readonly smaa: SMAAEffect | null;
  private noiseBlend: { opacity: { value: number } } | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: TierSpec) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: false });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: POST_DARK.bloomThreshold,
      luminanceSmoothing: 0.25,
      intensity: POST_DARK.bloomIntensity,
      radius: POST_DARK.bloomRadius,
      levels: 7,
    });
    this.chromatic = tier.chromatic
      ? new ChromaticAberrationEffect({ offset: new THREE.Vector2(POST_DARK.chromatic, POST_DARK.chromatic), radialModulation: true, modulationOffset: 0.35 })
      : null;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.vignette = new VignetteEffect({ eskil: false, offset: POST_DARK.vignetteOffset, darkness: POST_DARK.vignette });
    this.noise = tier.noise ? new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN }) : null;
    if (this.noise) {
      this.noise.blendMode.opacity.value = POST_DARK.noise;
      this.noiseBlend = this.noise.blendMode as unknown as { opacity: { value: number } };
    }

    const effects = [this.bloom, ...(this.chromatic ? [this.chromatic] : []), this.tone, this.vignette, ...(this.noise ? [this.noise] : [])];
    this.composer.addPass(new EffectPass(camera, ...effects));

    this.smaa = tier.smaa ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : null;
    if (this.smaa) this.composer.addPass(new EffectPass(camera, this.smaa));
  }

  apply(p: PostParams) {
    this.bloom.intensity = p.bloomIntensity;
    this.bloom.luminanceMaterial.threshold = p.bloomThreshold;
    // radius — свойство mipmap-блюра
    (this.bloom as unknown as { mipmapBlurPass: { radius: number } }).mipmapBlurPass.radius = p.bloomRadius;
    if (this.chromatic) this.chromatic.offset.set(p.chromatic, p.chromatic);
    this.vignette.darkness = p.vignette;
    this.vignette.offset = p.vignetteOffset;
    if (this.noiseBlend) this.noiseBlend.opacity.value = p.noise;
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}

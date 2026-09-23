/**
 * Шейдерный фон (BRIEF §6 «темы экранов», §7): один полноэкранный quad, режимы
 * black / graphite / steel / blue / silver и переход между двумя режимами по маске (равномерно,
 * радиально от центра, сверху вниз, снизу вверх). Рисуется первым, под сценой.
 */
import * as THREE from 'three';
import { BG_MODES, MASK, BG_VERT, BG_FRAG_BODY, type BgMode } from './bgShader';
export { BG_MODES, MASK, type BgMode };

const FRAG = BG_FRAG_BODY.replace('//__OUTPUT__', '#include <colorspace_fragment>');
const VERT = BG_VERT;

export class Background {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly uniforms: {
    uTime: THREE.IUniform<number>;
    uRes: THREE.IUniform<THREE.Vector2>;
    uMouse: THREE.IUniform<THREE.Vector2>;
    uScroll: THREE.IUniform<number>;
    uModeA: THREE.IUniform<number>;
    uModeB: THREE.IUniform<number>;
    uMix: THREE.IUniform<number>;
    uMaskType: THREE.IUniform<number>;
    uBeam: THREE.IUniform<number>;
    uBeamPos: THREE.IUniform<THREE.Vector2>;
    uLightX: THREE.IUniform<number>;
  };

  constructor(resolution: THREE.Vector2) {
    this.uniforms = {
      uTime: { value: 0 },
      uRes: { value: resolution },
      uMouse: { value: new THREE.Vector2() },
      uScroll: { value: 0 },
      uModeA: { value: 0 },
      uModeB: { value: 0 },
      uMix: { value: 0 },
      uMaskType: { value: 0 },
      uBeam: { value: 0 },
      uBeamPos: { value: new THREE.Vector2(0.0, -1.0) },
      uLightX: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'background';
  }

  set(modeA: BgMode, modeB: BgMode, mix: number, mask: keyof typeof MASK = 'uniform') {
    this.uniforms.uModeA.value = BG_MODES[modeA];
    this.uniforms.uModeB.value = BG_MODES[modeB];
    this.uniforms.uMix.value = mix;
    this.uniforms.uMaskType.value = MASK[mask];
  }

  update(time: number) {
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

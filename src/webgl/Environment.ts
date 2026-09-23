/**
 * Процедурное студийное окружение (BRIEF §8.2): без HDRI-файлов.
 * Сцена из emissive-плоскостей — длинные софтбоксы (белые и два синих) — прогоняется через
 * PMREMGenerator.fromScene(). Два пресета: тёмная студия (чёрные экраны) и светлая (сталь, серебро).
 * Смешение пресетов — в шейдере материала (см. patchEnvBlend), движение бликов — scene.environmentRotation.
 */
import * as THREE from 'three';

export interface StudioPreset {
  key: 'dark' | 'light';
  build(scene: THREE.Scene): void;
}

function panel(scene: THREE.Scene, w: number, h: number, color: THREE.ColorRepresentation, intensity: number, pos: THREE.Vector3, lookAt = new THREE.Vector3(0, 0, 0)) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.copy(pos);
  mesh.lookAt(lookAt);
  scene.add(mesh);
  return mesh;
}

/** Мягкий градиентный «пол/стены»: большие тёмные плоскости, чтобы низ хрома не был пустым */
function shell(scene: THREE.Scene, floor: number, walls: number, ceil: number) {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(40, 30, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(walls, walls, walls), side: THREE.BackSide, toneMapped: false }),
  );
  scene.add(box);
  panel(scene, 40, 40, 0xffffff, floor, new THREE.Vector3(0, -6, 0), new THREE.Vector3(0, 0, 0));
  panel(scene, 40, 40, 0xffffff, ceil, new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, 0, 0));
}

export const DARK_STUDIO: StudioPreset = {
  key: 'dark',
  build(scene) {
    scene.background = new THREE.Color(0x000000);
    // серый купол: силуэт хрома читается на чёрном, полосы софтбоксов остаются главным бликом
    shell(scene, 0.07, 0.17, 0.34);
    // Верхний длинный софтбокс — главная светлая полоса (как в ref-05)
    panel(scene, 14, 1.15, 0xf6f8ff, 6.5, new THREE.Vector3(0, 4.2, 1.2));
    // Второй верхний, тоньше и дальше — вторая линия блика
    panel(scene, 12, 0.45, 0xffffff, 4.0, new THREE.Vector3(0, 3.6, -3.4));
    // Ключевой вертикальный слева-спереди
    panel(scene, 1.6, 7, 0xeef2ff, 3.2, new THREE.Vector3(-6.0, 0.6, 3.5));
    // Тонкая полоса снизу-спереди: отражение «стола»
    panel(scene, 10, 0.35, 0xdfe6ff, 2.2, new THREE.Vector3(0, -3.9, 3.0));
    // Синий софтбокс справа
    panel(scene, 0.9, 8, 0x2a56ff, 5.0, new THREE.Vector3(6.2, 0.4, -1.0));
    // Синий rim снизу-сзади слева
    panel(scene, 4, 0.5, 0x0a24f5, 3.5, new THREE.Vector3(-3.5, -3.2, -4.5));
  },
};

export const LIGHT_STUDIO: StudioPreset = {
  key: 'light',
  build(scene) {
    scene.background = new THREE.Color(0x9ea4ad);
    shell(scene, 0.55, 0.62, 0.9);
    // Большой светлый потолок — хром становится серебром
    panel(scene, 16, 10, 0xffffff, 1.35, new THREE.Vector3(0, 5.5, 0));
    // Яркая полоса остаётся: без неё пропадает «жидкость»
    panel(scene, 14, 0.9, 0xffffff, 6.5, new THREE.Vector3(0, 4.3, 1.5));
    panel(scene, 12, 0.4, 0xffffff, 4.0, new THREE.Vector3(0, 3.8, -3.2));
    panel(scene, 2.2, 8, 0xffffff, 2.2, new THREE.Vector3(-6.2, 0.5, 3.0));
    // Синий акцент тише
    panel(scene, 0.8, 8, 0x2a56ff, 2.4, new THREE.Vector3(6.2, 0.4, -1.0));
    panel(scene, 4, 0.5, 0x0a24f5, 1.4, new THREE.Vector3(-3.5, -3.2, -4.5));
  },
};

export interface EnvironmentMaps {
  dark: THREE.Texture;
  light: THREE.Texture;
  dispose(): void;
}

export function buildEnvironments(renderer: THREE.WebGLRenderer, size = 256): EnvironmentMaps {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const make = (preset: StudioPreset) => {
    const scene = new THREE.Scene();
    preset.build(scene);
    // sigma даёт лёгкую мягкость краям софтбоксов
    const rt = pmrem.fromScene(scene, 0.035, 0.1, 100, { size });
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
    return rt;
  };
  const darkRt = make(DARK_STUDIO);
  const lightRt = make(LIGHT_STUDIO);
  pmrem.dispose();
  return {
    dark: darkRt.texture,
    light: lightRt.texture,
    dispose() {
      darkRt.dispose();
      lightRt.dispose();
    },
  };
}

/**
 * Патч MeshPhysicalMaterial: второй envMap и uEnvMix для непрерывного смешения тёмной и светлой студии.
 * Заменяет textureCubeUV(envMap, …) на смесь двух PMREM-текстур одинакового размера.
 */
export function patchEnvBlend(material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial, env2: THREE.Texture, uniforms: { uEnvMix: THREE.IUniform<number> }) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.envMap2 = { value: env2 };
    shader.uniforms.uEnvMix = uniforms.uEnvMix;
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment
      .replace(/textureCubeUV\(\s*envMap,/g, 'sampleEnvBlend(');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <envmap_physical_pars_fragment>',
      /* glsl */ `
      uniform sampler2D envMap2;
      uniform float uEnvMix;
      #ifdef ENVMAP_TYPE_CUBE_UV
      vec4 sampleEnvBlend(vec3 dir, float roughness) {
        vec4 a = textureCubeUV(envMap, dir, roughness);
        if (uEnvMix <= 0.001) return a;
        vec4 b = textureCubeUV(envMap2, dir, roughness);
        return mix(a, b, uEnvMix);
      }
      #endif
      ${chunk}`,
    );
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|envblend`;
  material.needsUpdate = true;
}

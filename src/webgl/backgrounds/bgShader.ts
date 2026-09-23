/**
 * GLSL фонов (без зависимостей от three): режимы black / graphite / steel / blue / silver и маски переходов.
 * Используется в Background.ts (главная, three) и lite-bg.ts (внутренние страницы, чистый WebGL2).
 */
import { GLSL_HASH, GLSL_SIMPLEX } from '../shaders/noise';

export const BG_MODES = { black: 0, graphite: 1, steel: 2, blue: 3, silver: 4 } as const;
export type BgMode = keyof typeof BG_MODES;
export const MASK = { uniform: 0, radial: 1, top: 2, bottom: 3 } as const;

export const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`;

/** Тело фрагментного шейдера без вывода цвета: используется и в three (главная), и в lite-bg (внутренние страницы) */
export const BG_FRAG_BODY = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uScroll;
uniform float uModeA;
uniform float uModeB;
uniform float uMix;
uniform float uMaskType;
uniform float uBeam;
uniform vec2 uBeamPos;
uniform float uLightX;
${GLSL_HASH}
${GLSL_SIMPLEX}

vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 bgBlack(vec2 uv, vec2 p) {
  vec3 base = srgb2lin(vec3(0.02, 0.02, 0.021));
  // едва заметная дымка сверху справа
  float haze = smoothstep(1.6, 0.0, length(p - vec2(0.9, 0.6))) * 0.012;
  vec3 col = base + haze;
  // синий луч снизу (ref-07): вертикальная полоса от точки
  if (uBeam > 0.001) {
    vec2 d = p - uBeamPos;
    float w = 0.05 + d.y * 0.32;
    float beam = exp(-abs(d.x) * abs(d.x) / (w * w)) * smoothstep(-0.05, 0.25, d.y) * exp(-d.y * 0.9);
    float halo = exp(-length(d) * 2.2) * 0.35;
    col += srgb2lin(vec3(0.16, 0.33, 1.0)) * (beam * 0.95 + halo) * uBeam;
  }
  return col;
}

vec3 bgGraphite(vec2 uv, vec2 p) {
  vec3 base = srgb2lin(vec3(0.055, 0.059, 0.07));
  // холодный белый свет сверху слева
  float l = smoothstep(2.2, 0.0, length(p - vec2(-1.1 + uLightX * 0.2, 0.95)));
  vec3 col = base + srgb2lin(vec3(0.65, 0.72, 0.85)) * l * l * 0.085;
  col += srgb2lin(vec3(0.3, 0.45, 1.0)) * smoothstep(1.8, 0.0, length(p - vec2(1.3, -0.9))) * 0.02;
  return col;
}

vec3 bgSteel(vec2 uv, vec2 p) {
  // шлифованный металл: анизотропные горизонтальные штрихи + конические блики (ref-01, ref-08)
  float streak = snoise(vec3(uv.x * 2.5, uv.y * 520.0, 1.7)) * 0.5 + snoise(vec3(uv.x * 9.0, uv.y * 1400.0, 4.2)) * 0.25;
  vec2 c = vec2(0.62 + uMouse.x * 0.08, 0.45 + uMouse.y * 0.06);
  vec2 d = p - c * 2.0 + 1.0;
  d.x /= max(uRes.x / uRes.y, 0.001) * 0.7;
  float ang = atan(d.y, d.x) + uScroll * 2.4 + uTime * 0.03;
  float conic = pow(abs(cos(ang * 1.0)), 6.0) * 0.55 + pow(abs(cos(ang * 2.0 + 1.1)), 24.0) * 0.4;
  float radial = smoothstep(2.6, 0.0, length(d));
  float broad = 0.5 + 0.5 * sin(p.x * 1.3 - p.y * 0.8 + uScroll * 3.0);
  vec3 base = srgb2lin(vec3(0.74, 0.76, 0.79));
  vec3 col = base * (0.86 + conic * radial * 0.55 + broad * 0.06 + streak * 0.035);
  col = mix(col, vec3(1.0), conic * radial * 0.12);
  // лёгкий холодный оттенок в тенях
  col *= vec3(0.985, 0.99, 1.0);
  return col;
}

vec3 bgBlue(vec2 uv, vec2 p) {
  // электрик-синий с размытыми бело-голубыми каустиками (domain-warped noise, ref-02, ref-09)
  vec2 q = p * 1.35;
  float t = uTime * 0.05;
  vec2 warp = vec2(snoise(vec3(q * 0.9, t)), snoise(vec3(q * 0.9 + 5.3, t + 2.0)));
  vec2 w2 = vec2(snoise(vec3(q * 1.6 + warp * 1.3, t * 1.3 + 9.0)), snoise(vec3(q * 1.6 - warp * 1.1, t * 1.1 + 4.0)));
  float n = snoise(vec3(q * 1.1 + w2 * 0.9 + warp * 0.6, t * 0.7)) * 0.5 + 0.5;
  float caustic = smoothstep(0.55, 0.88, n);
  float glow = smoothstep(0.3, 0.9, n) * 0.35;
  // слева, под текстом, каустики тише
  float textZone = smoothstep(0.5, -0.9, p.x);
  caustic *= 1.0 - textZone * 0.75;
  vec3 blue = srgb2lin(vec3(0.04, 0.14, 0.96));
  vec3 ice = srgb2lin(vec3(0.78, 0.86, 1.0));
  vec3 col = mix(blue, ice, caustic * 0.5);
  col += srgb2lin(vec3(0.3, 0.5, 1.0)) * glow * 0.45 * (1.0 - textZone * 0.5);
  // светящийся короб: чуть светлее к центру
  col += vec3(0.02, 0.05, 0.12) * smoothstep(1.8, 0.2, length(p));
  return col;
}

vec3 bgSilver(vec2 uv, vec2 p) {
  // матовая серебряная фольга (ref-11): широкий мягкий градиент и еле заметное зерно
  float sheen = 0.5 + 0.5 * sin(p.x * 0.9 + p.y * 1.4 + uScroll * 2.0 + uTime * 0.05);
  float n = snoise(vec3(p * 2.2, uTime * 0.02)) * 0.5 + 0.5;
  vec3 base = srgb2lin(vec3(0.83, 0.845, 0.87));
  vec3 col = base * (0.9 + sheen * 0.12 + n * 0.04);
  col += vec3(0.04) * smoothstep(1.5, 0.0, length(p - vec2(0.7, 0.5)));
  return col;
}

vec3 modeColor(float mode, vec2 uv, vec2 p) {
  if (mode < 0.5) return bgBlack(uv, p);
  if (mode < 1.5) return bgGraphite(uv, p);
  if (mode < 2.5) return bgSteel(uv, p);
  if (mode < 3.5) return bgBlue(uv, p);
  return bgSilver(uv, p);
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= uRes.x / uRes.y;
  vec3 a = modeColor(uModeA, uv, p);
  float m = uMix;
  if (uMaskType > 0.5 && uMaskType < 1.5) {
    // радиально от центра, мягкий фронт
    float r = length(p) / 2.4;
    m = smoothstep(uMix * 1.35 - 0.35, uMix * 1.35, r) ;
    m = 1.0 - m;
    m = uMix <= 0.0 ? 0.0 : (uMix >= 1.0 ? 1.0 : m);
  } else if (uMaskType < 2.5 && uMaskType > 1.5) {
    m = smoothstep(uv.y + 0.25, uv.y - 0.25, 1.0 - uMix * 1.5);
  } else if (uMaskType > 2.5) {
    m = smoothstep(1.0 - uv.y + 0.25, 1.0 - uv.y - 0.25, 1.0 - uMix * 1.5);
  }
  vec3 col = a;
  if (m > 0.001) {
    vec3 b = modeColor(uModeB, uv, p);
    col = mix(a, b, clamp(m, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
  //__OUTPUT__
}
`;


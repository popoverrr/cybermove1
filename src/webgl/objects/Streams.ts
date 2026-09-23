/**
 * S5 · ТРАФИК: четыре потока (таргет, Google Ads, TikTok Ads, SEO) — ленты из тонких линий,
 * закрученные в вихрь и сходящиеся в ядро (ref-01, Nike Fluid Force). Бегущий пунктир — движение частиц.
 */
import * as THREE from 'three';
import { Polyline, samplePath } from './Polyline';
import { streamPoint } from './fields';

export const STREAM_IDS = ['targeting', 'google-ads', 'tiktok-ads', 'seo'] as const;
const LINES_PER_STREAM = 13;
const POINTS = 90;

export class Streams {
  readonly group = new THREE.Group();
  /** обновлён ли объект в этом кадре активной сценой (Story сбрасывает и даёт дефолт) */
  touched = false;
  readonly lines: Polyline[][] = [];
  readonly midPoints: THREE.Vector3[] = [];
  readonly hover: number[] = [0, 0, 0, 0];

  constructor(resolution: THREE.Vector2) {
    for (let s = 0; s < STREAM_IDS.length; s++) {
      const theta = Math.PI + (s - 1.5) * 0.62;
      const dir = s % 2 === 0 ? 1 : -1;
      const bundle: Polyline[] = [];
      const mid = new THREE.Vector3();
      for (let k = 0; k < LINES_PER_STREAM; k++) {
        const u = (k / (LINES_PER_STREAM - 1) - 0.5) * 2; // -1..1 поперёк ленты
        const pts = samplePath(POINTS, (t, v) => {
          const r = 4.2 * (1 - t) * (1 - t) + 0.62 * (1 - Math.pow(1 - t, 2)) + 0.05;
          const ang = theta + dir * t * t * 2.6 + (1 - t) * 0.25 * dir;
          const width = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.04;
          // лента крутится вдоль пути: поперечное смещение поворачивается
          const twist = t * 4.2 + s;
          const off = new THREE.Vector3(Math.cos(twist), Math.sin(twist) * 0.6, Math.sin(twist * 0.7)).multiplyScalar(u * width);
          v.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.78, Math.sin(ang * 1.7 + s) * 0.35 * (1 - t)).add(off);
        });
        const line = new Polyline(pts, resolution, { width: 0.9, color: 0xffffff, color2: 0xbfd4ff, opacity: 0.55 });
        line.uniforms.uDash.value = 16 + k * 0.7;
        line.uniforms.uDashSpeed.value = 1.1 + (k % 3) * 0.25;
        line.uniforms.uDraw.value = 0;
        line.uniforms.uFadeEnds.value = 1;
        line.mesh.visible = false;
        bundle.push(line);
        this.group.add(line.mesh);
      }
      this.lines.push(bundle);
      streamPoint(s, 0.4, 0, mid);
      this.midPoints.push(mid);
    }
  }

  update(opts: { time: number; dt: number; draw: number; on: number; hovered: number; freeze: number }) {
    this.touched = true;
    for (let s = 0; s < this.lines.length; s++) {
      const target = opts.hovered === s ? 1 : 0;
      this.hover[s] = opts.dt === 0 ? target : this.hover[s] + (target - this.hover[s]) * (1 - Math.exp(-7 * opts.dt));
      const h = this.hover[s];
      const dim = opts.hovered >= 0 && opts.hovered !== s ? 0.45 : 0;
      const draw = THREE.MathUtils.clamp((opts.draw - s * 0.08) / 0.7, 0, 1);
      for (let k = 0; k < this.lines[s].length; k++) {
        const l = this.lines[s][k];
        l.uniforms.uDraw.value = draw;
        l.uniforms.uOpacity.value = (0.85 + h * 0.5) * (1 - dim) * opts.on;
        l.uniforms.uWidth.value = (0.9 + h * 0.8) * (1 + opts.freeze * 0.6);
        l.uniforms.uDashSpeed.value = (1.1 + (k % 3) * 0.25) * (1 + h * 1.6) * (1 - opts.freeze);
        l.uniforms.uDash.value = opts.freeze > 0.5 ? 0 : 16 + k * 0.7;
        l.mesh.visible = draw > 0.005 && opts.on > 0.01;
        l.update(opts.time);
      }
    }
  }

  dispose() {
    this.lines.flat().forEach((l) => l.dispose());
  }
}

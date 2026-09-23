/** Сглаженные значения hover по ключам (id услуг): плавный вход/выход реакции сцены. */
import { state } from '../../lib/state';

export class HoverMix {
  readonly amt: Record<string, number> = {};
  constructor(readonly keys: readonly string[], private lambda = 7) {
    for (const k of keys) this.amt[k] = 0;
  }
  /** обновить по текущему state.hover; enabled — реакции активны только на своём экране */
  update(dt: number, enabled: boolean) {
    const cur = enabled ? state.hover : null;
    for (const k of this.keys) {
      const target = cur === k ? 1 : 0;
      this.amt[k] = dt === 0 ? target : this.amt[k] + (target - this.amt[k]) * (1 - Math.exp(-this.lambda * dt));
    }
  }
  get(k: string) {
    return this.amt[k] ?? 0;
  }
  /** индекс активного ключа (по максимальному значению > 0.5) или -1 */
  get active(): number {
    let best = -1;
    let bv = 0.5;
    this.keys.forEach((k, i) => {
      if (this.amt[k] > bv) {
        bv = this.amt[k];
        best = i;
      }
    });
    return best;
  }
}

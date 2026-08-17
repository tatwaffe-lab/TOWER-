/**
 * Deterministische Zufallsquelle (mulberry32).
 *
 * Der Wave-Director, Perk-Angebote und Splitter-Streuung dürfen nicht
 * `Math.random()` nutzen: Tests würden sonst flaken, und ein Match ließe sich
 * nicht aus einem Seed reproduzieren. Jeder Raum bekommt einen Seed, der im
 * Ergebnisbildschirm sichtbar ist.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Ganzzahl in [min, max]. */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  /** Zieht bis zu n verschiedene Elemente (ohne Zurücklegen). */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

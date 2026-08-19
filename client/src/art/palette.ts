/**
 * Art Direction: "Arcane Industry" — verwitterte Industrieruinen mit
 * arkaner Energie.
 *
 * Regeln, die überall gelten:
 *  - Basisraster 32x32 px, Kachel 64 px, also exakt Faktor 2 (keine
 *    unscharfen Zwischenwerte)
 *  - jede Einheit hat eine eindeutige Silhouette und einen Farbcode
 *  - alles Bewegliche bekommt eine dunkle Kontur, damit es sich vom Boden
 *    abhebt, plus automatische Licht-/Schattenkante von oben links
 *  - warme Farben = Angriff/Gefahr, kühle = Kontrolle/Verteidigung
 */

export const PALETTE = {
  // Untergrund
  voidDark: 0x0a0c11,
  ground: 0x1a2029,
  groundAlt: 0x222a36,
  groundEdge: 0x2c3644,

  // Lane
  laneDark: 0x4a3a26,
  lane: 0x6f5a3a,
  laneLight: 0x91764c,
  laneGlow: 0xc79a58,

  // Bauflächen
  buildable: 0x1d3a2c,
  buildableEdge: 0x336b4f,
  buildableHover: 0x54a37d,

  // Marker
  spawn: 0x2f8a3a,
  spawnGlow: 0x74e87c,
  core: 0xc04a44,
  coreGlow: 0xff9a76,

  // UI
  uiBg: 0x10141d,
  uiPanel: 0x1a212e,
  uiBorder: 0x38445c,
  uiBorderBright: 0x5f7095,
  text: 0xeaeef7,
  textDim: 0x93a0bb,
  gold: 0xf5c451,
  threat: 0xe0537f,
  hp: 0x66d97a,
  danger: 0xe4574f,
  accent: 0x74acff,

  outline: 0x090b10,
  shadow: 0x000000,
} as const;

/** Kachelgröße auf dem Bildschirm. */
export const TILE_SIZE = 64;
/** Interne Sprite-Auflösung; wird mit Faktor 2 auf TILE_SIZE skaliert. */
export const SPRITE_BASE = 32;
export const SPRITE_SCALE = TILE_SIZE / SPRITE_BASE;

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Hellere (amount > 0) oder dunklere (amount < 0) Variante einer Farbe. */
export function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** Mischt zwei Farben (t = 0 → a, t = 1 → b). */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

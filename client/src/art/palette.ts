/**
 * Art Direction: "Arcane Industry" — verwitterte Industrieruinen mit
 * arkaner Energie. Eine Welt, konsequent durchgezogen (Master Prompt §23).
 *
 * Regeln, die überall gelten:
 *  - Basisraster 32x32 px, Türme/Bosse bis 48x48, ganzzahlige Skalierung
 *  - jede Einheit hat eine eindeutige Silhouette und einen Farbcode
 *  - dunkle Outline auf allem Beweglichen, damit es sich vom Boden abhebt
 *  - warme Farben = Angriff/Gefahr, kühle = Kontrolle/Verteidigung
 */

export const PALETTE = {
  // Untergrund
  voidDark: 0x0b0d12,
  ground: 0x1b2029,
  groundAlt: 0x212734,
  groundEdge: 0x2b3342,

  // Lane
  laneDark: 0x4a3a24,
  lane: 0x6b5636,
  laneLight: 0x8a7048,
  laneGlow: 0xb08d4f,

  // Bauflächen
  buildable: 0x1e3a2c,
  buildableEdge: 0x2f5c45,
  buildableHover: 0x47876a,

  // Marker
  spawn: 0x2e7d32,
  spawnGlow: 0x66d36b,
  core: 0xb0413e,
  coreGlow: 0xff8a6a,

  // UI
  uiBg: 0x121620,
  uiPanel: 0x1b2130,
  uiBorder: 0x39445c,
  uiBorderBright: 0x5b6b8f,
  text: 0xe8ecf5,
  textDim: 0x93a0bb,
  gold: 0xf2c14e,
  threat: 0xd94f7a,
  hp: 0x63d471,
  danger: 0xe25555,
  accent: 0x6fa8ff,

  outline: 0x0a0c11,
  shadow: 0x000000,
} as const;

export const TILE_SIZE = 48;
/** Interne Sprite-Auflösung; wird ganzzahlig auf TILE_SIZE skaliert. */
export const SPRITE_BASE = 16;

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Hellere/dunklere Variante einer Farbe — für Schattierung ohne Extra-Paletten. */
export function shade(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * Kern-Kampfregeln. Bewusst rein und deterministisch: keine Zufallsquelle,
 * keine Zeitquelle, keine Netzwerkabhängigkeit. Damit sind diese Funktionen
 * sowohl vom autoritativen Server als auch von Client-Tooltips und der
 * Balance-Simulation nutzbar, ohne dass zwei widersprüchliche Regelsätze
 * entstehen (Leitplanke: geteilte Regeln über @td/shared).
 */

export type DamageType = "kinetic" | "explosive" | "energy" | "chemical";

/** Zielpriorität eines Turms. Serverseitig ausgewertet. */
export type TargetingMode = "first" | "last" | "strongest" | "weakest" | "closest";

export const TARGETING_MODES: TargetingMode[] = [
  "first",
  "last",
  "strongest",
  "weakest",
  "closest",
];

export const TARGETING_LABEL: Record<TargetingMode, string> = {
  first: "Vorderster",
  last: "Hinterster",
  strongest: "Stärkster",
  weakest: "Schwächster",
  closest: "Nächster",
};

export type StatusKind =
  | "slow"
  | "burn"
  | "poison"
  | "shred"
  | "conductive"
  | "stun"
  | "shielded"
  | "regen";

/**
 * Ein laufender Status-Effekt auf einem Gegner.
 *
 * Stapelregel (einheitlich für alle Effekte, damit das Verhalten lesbar
 * bleibt): gleiche Art wird nicht additiv gestapelt, sondern es gewinnt die
 * stärkere Magnitude; bei gleicher oder stärkerer Magnitude wird die Dauer
 * aufgefrischt. So kann ein schwacher Turm einen starken Effekt nie
 * verschlechtern, aber Dauerfeuer hält den Effekt am Leben.
 */
export interface StatusEffect {
  kind: StatusKind;
  magnitude: number;
  remainingMs: number;
  /** Nur für Ticker (burn/poison/regen): Restzeit bis zum nächsten Tick. */
  tickAccMs?: number;
  sourceId?: string;
}

export const STATUS_TICK_MS = 500;

/** Wendet die Stapel-/Refresh-Regel an und liefert die neue Effektliste. */
export function applyStatus(effects: StatusEffect[], incoming: StatusEffect): StatusEffect[] {
  const existing = effects.find((e) => e.kind === incoming.kind);
  if (!existing) {
    return [...effects, { ...incoming, tickAccMs: incoming.tickAccMs ?? 0 }];
  }
  if (incoming.magnitude > existing.magnitude) {
    existing.magnitude = incoming.magnitude;
    existing.remainingMs = incoming.remainingMs;
    existing.sourceId = incoming.sourceId;
  } else if (incoming.magnitude === existing.magnitude) {
    existing.remainingMs = Math.max(existing.remainingMs, incoming.remainingMs);
  }
  return effects;
}

export interface StatusTickResult {
  effects: StatusEffect[];
  /** Summierter Schaden aus DoT-Effekten in diesem Tick. */
  damage: number;
  /** Summierte Heilung aus regen in diesem Tick. */
  heal: number;
}

/** Lässt alle Effekte um dtMs altern und rechnet DoT-/Regen-Ticks ab. */
export function tickStatuses(effects: StatusEffect[], dtMs: number): StatusTickResult {
  let damage = 0;
  let heal = 0;
  const alive: StatusEffect[] = [];

  for (const effect of effects) {
    effect.remainingMs -= dtMs;

    if (effect.kind === "burn" || effect.kind === "poison" || effect.kind === "regen") {
      effect.tickAccMs = (effect.tickAccMs ?? 0) + dtMs;
      while (effect.tickAccMs >= STATUS_TICK_MS) {
        effect.tickAccMs -= STATUS_TICK_MS;
        if (effect.kind === "regen") heal += effect.magnitude;
        else damage += effect.magnitude;
      }
    }

    if (effect.remainingMs > 0) alive.push(effect);
  }

  return { effects: alive, damage, heal };
}

export function findStatus(effects: StatusEffect[], kind: StatusKind): StatusEffect | undefined {
  return effects.find((e) => e.kind === kind);
}

/** Bewegungsmultiplikator aus slow/stun. 0 = steht still. */
export function speedMultiplier(effects: StatusEffect[]): number {
  if (findStatus(effects, "stun")) return 0;
  const slow = findStatus(effects, "slow");
  if (!slow) return 1;
  return clamp(1 - slow.magnitude, 0.1, 1);
}

/**
 * Effektive Rüstung nach Shred. Shred ist ein flacher Abzug, damit der
 * Zusammenhang für Spieler nachvollziehbar bleibt ("-4 Rüstung"), statt
 * versteckter Prozentketten.
 */
export function effectiveArmor(baseArmor: number, effects: StatusEffect[]): number {
  // Defensiv gegen NaN/Infinity aus fehlerhaften Definitionen oder Buffs:
  // ein einziger NaN-Wert würde sonst durch die gesamte Schadenskette
  // wandern und HP-Werte unbrauchbar machen.
  const base = Number.isFinite(baseArmor) ? baseArmor : 0;
  const shred = findStatus(effects, "shred");
  const shielded = findStatus(effects, "shielded");
  const bonus = shielded && Number.isFinite(shielded.magnitude) ? shielded.magnitude : 0;
  const reduction = shred && Number.isFinite(shred.magnitude) ? shred.magnitude : 0;
  return Math.max(0, base + bonus - reduction);
}

/**
 * Zentrale Schadensformel. Rüstung reduziert flach, aber niemals unter einen
 * Mindestanteil — sonst werden Panzer gegen Schnellfeuertürme unspielbar
 * immun und der Konter wird zur Mauer.
 */
export const MIN_DAMAGE_FRACTION = 0.15;

export function computeDamage(
  rawDamage: number,
  damageType: DamageType,
  baseArmor: number,
  effects: StatusEffect[]
): number {
  if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;

  const armor = effectiveArmor(baseArmor, effects);
  // Energie ignoriert die Hälfte der Rüstung, Explosiv wird von ihr stärker
  // gebremst, Chemie ignoriert sie ganz (wirkt über Status statt Aufprall).
  const armorFactor =
    damageType === "energy" ? 0.5 : damageType === "explosive" ? 1.25 : damageType === "chemical" ? 0 : 1;

  const conductive = findStatus(effects, "conductive");
  const amplified = conductive && damageType === "energy" ? rawDamage * (1 + conductive.magnitude) : rawDamage;

  const afterArmor = amplified - armor * armorFactor;
  const floor = amplified * MIN_DAMAGE_FRACTION;
  return round2(Math.max(floor, afterArmor));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Schützt den replizierten Zustand vor NaN/Infinity aus fehlerhafter Mathematik. */
export function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

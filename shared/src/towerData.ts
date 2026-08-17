import { DamageType, StatusKind, TargetingMode } from "./combat";

/**
 * Wie ein Turm Schaden austeilt. Das ist absichtlich Verhalten und keine
 * bloße Zahl: der Server verzweigt hierauf, damit sich Türme mechanisch
 * unterscheiden statt nur in ihren Werten.
 */
export type AttackKind =
  | "projectile" // Einzelziel, fliegendes Geschoss
  | "splash" // Geschoss mit Flächenschaden am Einschlag
  | "chain" // springt zwischen Zielen
  | "beam" // sofortiger Treffer, kein Flugweg
  | "cone" // trifft alles in kurzer Reichweite gleichzeitig
  | "lob" // indirektes Feuer, große Fläche, langsam
  | "drone" // eigenständige Einheiten greifen an
  | "aura"; // kein Schaden, wirkt auf eigene Türme

export interface StatusApplication {
  kind: StatusKind;
  magnitude: number;
  durationMs: number;
}

/** Ein Effekt, den ein Turm auf getroffene Gegner legt. */
export interface TowerStats {
  range: number;
  damage: number;
  fireRateMs: number;
  projectileSpeed: number;
  attack: AttackKind;
  damageType: DamageType;
  /** Radius für splash/lob/cone, Sprünge für chain, Anzahl für drone. */
  areaRadius?: number;
  chainJumps?: number;
  chainFalloff?: number;
  droneCount?: number;
  pierce?: number;
  applies?: StatusApplication[];
  /** Aura-Werte (Support Beacon): Multiplikatoren auf Türme in Reichweite. */
  auraDamageBonus?: number;
  auraFireRateBonus?: number;
  auraRangeBonus?: number;
  /** Gold pro Welle (Economy-Spezialisierung). */
  incomePerWave?: number;
  /** Explodiert das Ziel beim Tod? (Flammenwerfer B) */
  deathExplosionDamage?: number;
  deathExplosionRadius?: number;
  /** Bevorzugt Elite/Boss-Ziele unabhängig vom Targeting-Modus. */
  prefersBig?: boolean;
}

export interface TowerUpgradeLevel {
  cost: number;
  /** Additive bzw. multiplikative Deltas auf die Basiswerte. */
  damageMul?: number;
  rangeAdd?: number;
  fireRateMul?: number;
  statusMagnitudeMul?: number;
  note: string;
}

export interface TowerSpecialization {
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Überschreibt/ergänzt Stats — hier liegen die echten mechanischen Brüche. */
  stats: Partial<TowerStats>;
}

export interface TowerDefinition {
  id: string;
  name: string;
  role: string;
  cost: number;
  /** Farbcode für Silhouette/Sprite-Generierung und UI. */
  color: number;
  accent: number;
  defaultTargeting: TargetingMode;
  base: TowerStats;
  upgrades: TowerUpgradeLevel[];
  specializations: [TowerSpecialization, TowerSpecialization];
}

export const SELL_REFUND_RATIO = 0.6;

export const TOWERS: Record<string, TowerDefinition> = {
  gunner: {
    id: "gunner",
    name: "Gunner",
    role: "Günstiger Dauerschaden, Rüstungsabbau",
    cost: 50,
    color: 0x5aa9e6,
    accent: 0x2c3e50,
    defaultTargeting: "first",
    base: {
      // Nach Messung angehoben (war 4 Schaden / 350 ms): der Gunner lag mit
      // ~12 DPS pro 100 Gold weit unter den Flächentürmen und war ab Welle 5
      // nicht mehr sinnvoll baubar. Siehe `npm run balance`.
      range: 3,
      damage: 6,
      fireRateMs: 300,
      projectileSpeed: 9,
      attack: "projectile",
      damageType: "kinetic",
    },
    upgrades: [
      { cost: 40, damageMul: 1.5, note: "Verstärkter Lauf: +50 % Schaden" },
      { cost: 70, fireRateMul: 0.75, rangeAdd: 0.5, note: "Schnellader: +33 % Feuerrate, +0,5 Reichweite" },
      { cost: 110, damageMul: 1.6, note: "Präzisionslauf: +60 % Schaden" },
    ],
    specializations: [
      {
        id: "minigun",
        name: "Minigun",
        description: "Extreme Feuerrate, legt Rüstungsabbau auf das Ziel. Wenig Einzelschaden.",
        cost: 160,
        stats: {
          fireRateMs: 90,
          damage: 3,
          applies: [{ kind: "shred", magnitude: 4, durationMs: 2500 }],
        },
      },
      {
        id: "railgun",
        name: "Railgun",
        description: "Langsamer Energieschuss, durchschlägt bis zu 3 Gegner und ignoriert halbe Rüstung.",
        cost: 180,
        stats: {
          fireRateMs: 1500,
          damage: 46,
          damageType: "energy",
          projectileSpeed: 18,
          pierce: 3,
          range: 4.5,
        },
      },
    ],
  },

  cannon: {
    id: "cannon",
    name: "Kanone",
    role: "Flächenschaden gegen Gruppen",
    cost: 90,
    color: 0xd98d3a,
    accent: 0x6b3f18,
    defaultTargeting: "first",
    base: {
      range: 3,
      damage: 12,
      fireRateMs: 1200,
      projectileSpeed: 5,
      attack: "splash",
      damageType: "explosive",
      areaRadius: 1.1,
    },
    upgrades: [
      { cost: 70, damageMul: 1.5, note: "Schwere Granaten: +50 % Schaden" },
      { cost: 110, rangeAdd: 1, fireRateMul: 0.8, note: "Langrohr: +1 Reichweite, +25 % Feuerrate" },
      { cost: 160, damageMul: 1.5, note: "Hochbrisanz: +50 % Schaden" },
    ],
    specializations: [
      {
        id: "siege",
        name: "Belagerung",
        description: "Sehr große Explosionen und hoher Einzelschlag, dafür träge.",
        cost: 200,
        stats: { areaRadius: 2.2, damage: 40, fireRateMs: 1900 },
      },
      {
        id: "cluster",
        name: "Splitterbombe",
        description: "Kleinere Explosion, dafür doppelte Feuerrate und Streuschaden über die ganze Gruppe.",
        cost: 190,
        stats: { areaRadius: 1.6, damage: 14, fireRateMs: 600 },
      },
    ],
  },

  frost: {
    id: "frost",
    name: "Frostturm",
    role: "Verlangsamung und Kontrolle",
    cost: 70,
    color: 0x77d4ec,
    accent: 0x1f5f77,
    defaultTargeting: "first",
    base: {
      range: 2.6,
      damage: 2,
      fireRateMs: 600,
      projectileSpeed: 7,
      attack: "projectile",
      damageType: "energy",
      applies: [{ kind: "slow", magnitude: 0.3, durationMs: 1500 }],
    },
    upgrades: [
      { cost: 55, statusMagnitudeMul: 1.35, note: "Kältekern: stärkere Verlangsamung" },
      { cost: 90, rangeAdd: 0.8, note: "Frostfeld: +0,8 Reichweite" },
      { cost: 140, statusMagnitudeMul: 1.3, damageMul: 1.5, note: "Tiefkühlung: stärkerer Slow und Schaden" },
    ],
    specializations: [
      {
        id: "deepfreeze",
        name: "Tiefenfrost",
        description: "Friert Einzelziele kurz komplett ein (Stun) statt sie nur zu bremsen.",
        cost: 175,
        stats: {
          fireRateMs: 2200,
          damage: 6,
          applies: [
            { kind: "stun", magnitude: 1, durationMs: 900 },
            { kind: "slow", magnitude: 0.45, durationMs: 2000 },
          ],
        },
      },
      {
        id: "frostfield",
        name: "Frostzone",
        description: "Trifft alle Gegner in Reichweite gleichzeitig mit dauerhaftem Slow.",
        cost: 165,
        stats: {
          attack: "cone",
          areaRadius: 2.8,
          range: 2.8,
          fireRateMs: 900,
          damage: 3,
          applies: [{ kind: "slow", magnitude: 0.4, durationMs: 1400 }],
        },
      },
    ],
  },

  tesla: {
    id: "tesla",
    name: "Teslaspule",
    role: "Kettenblitz gegen Schwärme",
    cost: 100,
    color: 0xc9a6ff,
    accent: 0x4b2f80,
    defaultTargeting: "closest",
    base: {
      range: 2.6,
      damage: 6,
      fireRateMs: 700,
      projectileSpeed: 0,
      attack: "chain",
      damageType: "energy",
      chainJumps: 3,
      chainFalloff: 0.75,
    },
    upgrades: [
      { cost: 75, damageMul: 1.5, note: "Höhere Spannung: +50 % Schaden" },
      { cost: 120, fireRateMul: 0.75, note: "Schnellentladung: +33 % Feuerrate" },
      { cost: 170, damageMul: 1.5, rangeAdd: 0.5, note: "Überladung: +50 % Schaden, +0,5 Reichweite" },
    ],
    specializations: [
      {
        id: "arcchain",
        name: "Lichtbogen",
        description: "Springt auf bis zu 8 Ziele mit geringem Abfall — mäht Schwärme nieder.",
        cost: 185,
        stats: { chainJumps: 8, chainFalloff: 0.88, damage: 9 },
      },
      {
        id: "overcharge",
        name: "Überladung",
        description: "Nur 2 Sprünge, aber schwerer Treffer und Leitfähig-Debuff (+35 % Energieschaden).",
        cost: 195,
        stats: {
          chainJumps: 2,
          damage: 26,
          applies: [{ kind: "conductive", magnitude: 0.35, durationMs: 3000 }],
        },
      },
    ],
  },

  sniper: {
    id: "sniper",
    name: "Scharfschütze",
    role: "Große Reichweite, Elite- und Bosskiller",
    cost: 120,
    color: 0x8fd694,
    accent: 0x2f5f36,
    defaultTargeting: "strongest",
    base: {
      range: 7,
      damage: 26,
      fireRateMs: 1600,
      projectileSpeed: 20,
      attack: "beam",
      damageType: "kinetic",
      prefersBig: true,
    },
    upgrades: [
      { cost: 90, damageMul: 1.6, note: "Schweres Kaliber: +60 % Schaden" },
      { cost: 130, rangeAdd: 2, note: "Zielfernrohr: +2 Reichweite" },
      { cost: 190, damageMul: 1.6, fireRateMul: 0.85, note: "Match-Munition: +60 % Schaden, schneller" },
    ],
    specializations: [
      {
        id: "executioner",
        name: "Vollstrecker",
        description: "Massiver Einzelschaden gegen große Ziele, extrem langsam.",
        cost: 210,
        stats: { damage: 190, fireRateMs: 3200, range: 9 },
      },
      {
        id: "piercer",
        name: "Durchschlag",
        description: "Energiestrahl durchschlägt die gesamte Reihe und ignoriert halbe Rüstung.",
        cost: 200,
        stats: { damage: 60, damageType: "energy", pierce: 6, fireRateMs: 1500 },
      },
    ],
  },

  flamethrower: {
    id: "flamethrower",
    name: "Flammenwerfer",
    role: "Kurze Reichweite, Brandschaden gegen Massen",
    cost: 80,
    color: 0xf07a3c,
    accent: 0x8c2f10,
    defaultTargeting: "closest",
    base: {
      range: 1.9,
      damage: 3,
      fireRateMs: 220,
      projectileSpeed: 0,
      attack: "cone",
      damageType: "explosive",
      areaRadius: 1.9,
      applies: [{ kind: "burn", magnitude: 2, durationMs: 2000 }],
    },
    upgrades: [
      { cost: 60, statusMagnitudeMul: 1.5, note: "Heißere Flamme: stärkerer Brand" },
      { cost: 95, rangeAdd: 0.6, damageMul: 1.4, note: "Druckdüse: mehr Reichweite und Schaden" },
      { cost: 145, statusMagnitudeMul: 1.5, note: "Napalm: nochmals stärkerer Brand" },
    ],
    specializations: [
      {
        id: "inferno",
        name: "Inferno",
        description: "Sehr starker, langer Brand — schmilzt zähe Gruppen über Zeit.",
        cost: 170,
        stats: {
          applies: [{ kind: "burn", magnitude: 11, durationMs: 5000 }],
          damage: 4,
        },
      },
      {
        id: "detonator",
        name: "Detonator",
        description: "Brennende Gegner explodieren beim Tod und zünden ihre Nachbarn an.",
        cost: 180,
        stats: {
          deathExplosionDamage: 34,
          deathExplosionRadius: 1.5,
          applies: [{ kind: "burn", magnitude: 5, durationMs: 2500 }],
        },
      },
    ],
  },

  mortar: {
    id: "mortar",
    name: "Mörser",
    role: "Indirektes Feuer über die ganze Karte",
    cost: 110,
    color: 0xb0a58a,
    accent: 0x4d4636,
    defaultTargeting: "strongest",
    base: {
      range: 8,
      damage: 16,
      fireRateMs: 1900,
      projectileSpeed: 3.2,
      attack: "lob",
      damageType: "explosive",
      areaRadius: 1.6,
    },
    upgrades: [
      { cost: 80, damageMul: 1.5, note: "Schwere Granate: +50 % Schaden" },
      { cost: 120, fireRateMul: 0.8, note: "Schnelllader: +25 % Feuerrate" },
      { cost: 175, damageMul: 1.5, note: "Sprengverstärkung: +50 % Schaden" },
    ],
    specializations: [
      {
        id: "bombardment",
        name: "Bombardement",
        description: "Riesiger Einschlagsradius, trifft ganze Wellenabschnitte.",
        cost: 205,
        stats: { areaRadius: 2.8, damage: 46, fireRateMs: 2400 },
      },
      {
        id: "napalmshell",
        name: "Napalmgranate",
        description: "Weniger Aufprallschaden, hinterlässt aber schweren Brand im Zielgebiet.",
        cost: 190,
        stats: {
          damage: 18,
          areaRadius: 2.0,
          applies: [{ kind: "burn", magnitude: 8, durationMs: 4000 }],
        },
      },
    ],
  },

  "support-beacon": {
    id: "support-beacon",
    name: "Unterstützungsbake",
    role: "Verstärkt benachbarte Türme, kein eigener Schaden",
    cost: 90,
    color: 0xf2d06b,
    accent: 0x7a5c14,
    defaultTargeting: "first",
    base: {
      range: 2.6,
      damage: 0,
      fireRateMs: 0,
      projectileSpeed: 0,
      attack: "aura",
      damageType: "energy",
      auraDamageBonus: 0.15,
      auraFireRateBonus: 0.1,
    },
    upgrades: [
      { cost: 70, note: "Verstärker: +10 % Schadensbonus" },
      { cost: 110, rangeAdd: 1, note: "Größerer Sender: +1 Reichweite" },
      { cost: 160, note: "Resonanz: +10 % Schadensbonus" },
    ],
    specializations: [
      {
        id: "warhorn",
        name: "Kriegshorn",
        description: "Starker Offensivbuff: +45 % Schaden und +30 % Feuerrate für alle Türme in Reichweite.",
        cost: 185,
        stats: { auraDamageBonus: 0.45, auraFireRateBonus: 0.3, auraRangeBonus: 0.5 },
      },
      {
        id: "refinery",
        name: "Raffinerie",
        description: "Schwacher Kampfbuff, dafür 25 Gold Einkommen pro Welle.",
        cost: 175,
        stats: { auraDamageBonus: 0.1, auraFireRateBonus: 0.05, incomePerWave: 25 },
      },
    ],
  },

  alchemist: {
    id: "alchemist",
    name: "Alchemist",
    role: "Gift und Rüstungszersetzung",
    cost: 85,
    color: 0x8fe36a,
    accent: 0x2f6b1c,
    defaultTargeting: "strongest",
    base: {
      range: 2.8,
      damage: 3,
      fireRateMs: 900,
      projectileSpeed: 6,
      attack: "splash",
      damageType: "chemical",
      areaRadius: 1.2,
      applies: [
        { kind: "poison", magnitude: 3, durationMs: 3000 },
        { kind: "shred", magnitude: 2, durationMs: 3000 },
      ],
    },
    upgrades: [
      { cost: 65, statusMagnitudeMul: 1.5, note: "Konzentrat: stärkeres Gift und Zersetzung" },
      { cost: 100, rangeAdd: 0.8, note: "Weitwurf: +0,8 Reichweite" },
      { cost: 150, statusMagnitudeMul: 1.5, note: "Katalysator: nochmals stärkere Effekte" },
    ],
    specializations: [
      {
        id: "corrosion",
        name: "Korrosion",
        description: "Extremer Rüstungsabbau — macht Panzer für alle anderen Türme weich.",
        cost: 180,
        stats: {
          applies: [
            { kind: "shred", magnitude: 14, durationMs: 4000 },
            { kind: "poison", magnitude: 4, durationMs: 3000 },
          ],
        },
      },
      {
        id: "plague",
        name: "Seuche",
        description: "Sehr starkes Gift mit großem Wirkradius, ignoriert Rüstung vollständig.",
        cost: 185,
        stats: {
          areaRadius: 2.2,
          applies: [{ kind: "poison", magnitude: 15, durationMs: 5000 }],
        },
      },
    ],
  },

  "drone-hub": {
    id: "drone-hub",
    name: "Drohnenbasis",
    role: "Mobile Drohnen, flexible Abdeckung",
    cost: 130,
    color: 0x9fb6c8,
    accent: 0x3d4d5c,
    defaultTargeting: "first",
    base: {
      range: 4.2,
      damage: 4,
      fireRateMs: 500,
      projectileSpeed: 0,
      attack: "drone",
      damageType: "kinetic",
      droneCount: 2,
    },
    upgrades: [
      { cost: 95, damageMul: 1.5, note: "Bessere Waffen: +50 % Schaden" },
      { cost: 140, note: "Zusätzliche Drohne" },
      { cost: 190, damageMul: 1.5, rangeAdd: 1, note: "Aufklärung: +50 % Schaden, +1 Reichweite" },
    ],
    specializations: [
      {
        id: "swarm",
        name: "Schwarm",
        description: "6 kleine Drohnen decken ein großes Gebiet gleichzeitig ab.",
        cost: 200,
        stats: { droneCount: 6, damage: 5, range: 5, fireRateMs: 420 },
      },
      {
        id: "gunship",
        name: "Kampfdrohne",
        description: "Eine schwere Drohne, die gezielt Elite- und Bossziele angreift.",
        cost: 210,
        stats: { droneCount: 1, damage: 42, fireRateMs: 900, prefersBig: true, damageType: "explosive" },
      },
    ],
  },
};

export const TOWER_IDS = Object.keys(TOWERS);

/** Effektive Werte eines Turms nach Upgrades und Spezialisierung. */
export function resolveTowerStats(
  def: TowerDefinition,
  level: number,
  specializationId: string | null
): TowerStats {
  const stats: TowerStats = {
    ...def.base,
    applies: def.base.applies ? def.base.applies.map((a) => ({ ...a })) : undefined,
  };

  for (let i = 0; i < level && i < def.upgrades.length; i++) {
    const up = def.upgrades[i];
    if (up.damageMul) stats.damage *= up.damageMul;
    if (up.rangeAdd) stats.range += up.rangeAdd;
    if (up.fireRateMul) stats.fireRateMs *= up.fireRateMul;
    if (up.statusMagnitudeMul && stats.applies) {
      for (const a of stats.applies) a.magnitude *= up.statusMagnitudeMul;
    }
    if (def.id === "support-beacon") {
      if (up.note.includes("Schadensbonus")) stats.auraDamageBonus = (stats.auraDamageBonus ?? 0) + 0.1;
    }
    if (def.id === "drone-hub" && up.note.includes("Drohne")) {
      stats.droneCount = (stats.droneCount ?? 1) + 1;
    }
  }

  if (specializationId) {
    const spec = def.specializations.find((s) => s.id === specializationId);
    if (spec) {
      Object.assign(stats, spec.stats);
      if (spec.stats.applies) stats.applies = spec.stats.applies.map((a) => ({ ...a }));
    }
  }

  stats.damage = Math.round(stats.damage * 100) / 100;
  stats.range = Math.round(stats.range * 100) / 100;
  stats.fireRateMs = Math.max(60, Math.round(stats.fireRateMs));
  return stats;
}

/** Gesamtes bisher investiertes Gold — Basis für den Verkaufswert. */
export function investedGold(def: TowerDefinition, level: number, specializationId: string | null): number {
  let total = def.cost;
  for (let i = 0; i < level && i < def.upgrades.length; i++) total += def.upgrades[i].cost;
  if (specializationId) {
    const spec = def.specializations.find((s) => s.id === specializationId);
    if (spec) total += spec.cost;
  }
  return total;
}

export function sellValue(def: TowerDefinition, level: number, specializationId: string | null): number {
  return Math.floor(investedGold(def, level, specializationId) * SELL_REFUND_RATIO);
}

/** Kosten des nächsten Upgrades, oder null wenn die Stufe ausgereizt ist. */
export function nextUpgradeCost(def: TowerDefinition, level: number): number | null {
  if (level >= def.upgrades.length) return null;
  return def.upgrades[level].cost;
}

/** Spezialisierung ist erst nach voller Aufwertung wählbar und dann endgültig. */
export function canSpecialize(def: TowerDefinition, level: number, specializationId: string | null): boolean {
  return specializationId === null && level >= def.upgrades.length;
}

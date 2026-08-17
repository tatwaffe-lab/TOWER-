/**
 * Commander und Perks.
 *
 * Beides wirkt über einen gemeinsamen Modifikator-Satz (`RuleModifiers`), den
 * der Server bei jeder Berechnung konsultiert. Perks sind damit echte
 * Regeländerungen und keine Datenliste: wenn hier ein Feld steht, liest die
 * Simulation es auch.
 */

export type CommanderId = "engineer" | "warlord" | "architect" | "chronomancer";

export type AbilityKind =
  | "overclock" // Türme im Umkreis feuern massiv schneller
  | "emergency-grid" // globaler Buff + sofortiger Cooldown-Reset
  | "war-march" // nächste Sends verstärkt
  | "full-assault" // sofortige kostenlose Send-Salve
  | "rapid-construction" // Bau/Upgrade kurzzeitig stark vergünstigt
  | "fortress-protocol" // temporäre Barrikade + Core-Schild
  | "time-field" // starker Flächen-Slow
  | "temporal-rewind"; // wirft Gegner auf der Lane zurück

export interface CommanderAbility {
  kind: AbilityKind;
  name: string;
  description: string;
  cooldownMs: number;
  durationMs: number;
  /** Threat-Kosten; 0 = nur Cooldown. */
  threatCost: number;
  /** Wirkradius in Feldern, 0 = global. */
  radius: number;
}

export interface CommanderDefinition {
  id: CommanderId;
  name: string;
  tagline: string;
  passiveText: string;
  color: number;
  accent: number;
  ability: CommanderAbility;
  ultimate: CommanderAbility;
  /** Passive Startwerte. */
  passive: RuleModifiers;
  /** Perk-Pool dieses Commanders (IDs aus PERKS). */
  perkPool: string[];
}

/**
 * Alle Regelmodifikatoren an einer Stelle. Additive Felder werden summiert,
 * multiplikative multipliziert — beides passiert in `combineModifiers`.
 */
export interface RuleModifiers {
  towerDamageMul?: number;
  towerFireRateMul?: number;
  towerRangeAdd?: number;
  buildCostMul?: number;
  upgradeCostMul?: number;
  goldPerKillMul?: number;
  incomePerWaveAdd?: number;
  startGoldAdd?: number;
  coreHpAdd?: number;
  threatRegenMul?: number;
  sendCostMul?: number;
  sendHpMul?: number;
  sendSpeedMul?: number;
  slowStrengthMul?: number;
  burnStrengthMul?: number;
  splashRadiusMul?: number;
  chainJumpsAdd?: number;
  bossDamageMul?: number;
  laneCostMul?: number;
  abilityCooldownMul?: number;
  sellRefundAdd?: number;
}

export const NEUTRAL_MODIFIERS: Required<RuleModifiers> = {
  towerDamageMul: 1,
  towerFireRateMul: 1,
  towerRangeAdd: 0,
  buildCostMul: 1,
  upgradeCostMul: 1,
  goldPerKillMul: 1,
  incomePerWaveAdd: 0,
  startGoldAdd: 0,
  coreHpAdd: 0,
  threatRegenMul: 1,
  sendCostMul: 1,
  sendHpMul: 1,
  sendSpeedMul: 1,
  slowStrengthMul: 1,
  burnStrengthMul: 1,
  splashRadiusMul: 1,
  chainJumpsAdd: 0,
  bossDamageMul: 1,
  laneCostMul: 1,
  abilityCooldownMul: 1,
  sellRefundAdd: 0,
};

const MULTIPLICATIVE_KEYS = new Set<keyof RuleModifiers>([
  "towerDamageMul",
  "towerFireRateMul",
  "buildCostMul",
  "upgradeCostMul",
  "goldPerKillMul",
  "threatRegenMul",
  "sendCostMul",
  "sendHpMul",
  "sendSpeedMul",
  "slowStrengthMul",
  "burnStrengthMul",
  "splashRadiusMul",
  "bossDamageMul",
  "laneCostMul",
  "abilityCooldownMul",
]);

export function combineModifiers(sources: RuleModifiers[]): Required<RuleModifiers> {
  const out: Required<RuleModifiers> = { ...NEUTRAL_MODIFIERS };
  for (const source of sources) {
    for (const key of Object.keys(source) as (keyof RuleModifiers)[]) {
      const value = source[key];
      if (value === undefined || !Number.isFinite(value)) continue;
      if (MULTIPLICATIVE_KEYS.has(key)) out[key] = out[key] * value;
      else out[key] = out[key] + value;
    }
  }
  return out;
}

export const COMMANDERS: Record<CommanderId, CommanderDefinition> = {
  engineer: {
    id: "engineer",
    name: "Ingenieurin",
    tagline: "Türme, Upgrades, Wirtschaft",
    passiveText: "Upgrades kosten 15 % weniger, Startgold +50.",
    color: 0xf2b134,
    accent: 0x7a5310,
    passive: { upgradeCostMul: 0.85, startGoldAdd: 50 },
    ability: {
      kind: "overclock",
      name: "Übertaktung",
      description: "Alle Türme im Umkreis feuern 8 s lang doppelt so schnell.",
      cooldownMs: 26000,
      durationMs: 8000,
      threatCost: 0,
      radius: 3.5,
    },
    ultimate: {
      kind: "emergency-grid",
      name: "Notstromnetz",
      description: "10 s lang +60 % Schaden und +50 % Feuerrate für alle eigenen Türme.",
      cooldownMs: 70000,
      durationMs: 10000,
      threatCost: 25,
      radius: 0,
    },
    perkPool: ["cheap-upgrades", "rich-kills", "long-barrels", "splash-master", "income-boost", "sell-value"],
  },

  warlord: {
    id: "warlord",
    name: "Kriegsherr",
    tagline: "Aggressives PvP über Send-Einheiten",
    passiveText: "Gesendete Einheiten haben +25 % HP, Threat regeneriert 30 % schneller.",
    color: 0xd94f4f,
    accent: 0x6e1a1a,
    passive: { sendHpMul: 1.25, threatRegenMul: 1.3 },
    ability: {
      kind: "war-march",
      name: "Kriegsmarsch",
      description: "12 s lang kosten Sends 40 % weniger und sind 30 % schneller.",
      cooldownMs: 30000,
      durationMs: 12000,
      threatCost: 0,
      radius: 0,
    },
    ultimate: {
      kind: "full-assault",
      name: "Generalangriff",
      description: "Schickt sofort eine kostenlose Angriffswelle an das aktuelle Ziel.",
      cooldownMs: 80000,
      durationMs: 0,
      threatCost: 30,
      radius: 0,
    },
    perkPool: ["cheap-sends", "tough-sends", "fast-sends", "rich-kills", "boss-hunter", "threat-surge"],
  },

  architect: {
    id: "architect",
    name: "Architektin",
    tagline: "Lane-Umbau und Verteidigungsplanung",
    passiveText: "Lane-Umbauten kosten 40 % weniger, Core +25 HP.",
    color: 0x4fb3d9,
    accent: 0x14556e,
    passive: { laneCostMul: 0.6, coreHpAdd: 25 },
    ability: {
      kind: "rapid-construction",
      name: "Schnellbau",
      description: "10 s lang kosten Bau und Upgrades 50 % weniger.",
      cooldownMs: 32000,
      durationMs: 10000,
      threatCost: 0,
      radius: 0,
    },
    ultimate: {
      kind: "fortress-protocol",
      name: "Festungsprotokoll",
      description: "Stellt 30 Core-HP wieder her und verlangsamt 8 s lang alle Gegner stark.",
      cooldownMs: 75000,
      durationMs: 8000,
      threatCost: 25,
      radius: 0,
    },
    perkPool: ["cheap-lanes", "fortified-core", "long-barrels", "cheap-upgrades", "slow-master", "sell-value"],
  },

  chronomancer: {
    id: "chronomancer",
    name: "Chronomantin",
    tagline: "Zeit, Kontrolle, Verlangsamung",
    passiveText: "Alle Slow-Effekte sind 25 % stärker, Fähigkeiten laden 15 % schneller.",
    color: 0x9b6ef3,
    accent: 0x3c2170,
    passive: { slowStrengthMul: 1.25, abilityCooldownMul: 0.85 },
    ability: {
      kind: "time-field",
      name: "Zeitfeld",
      description: "Verlangsamt 8 s lang alle Gegner im Umkreis um 60 %.",
      cooldownMs: 24000,
      durationMs: 8000,
      threatCost: 0,
      radius: 3.5,
    },
    ultimate: {
      kind: "temporal-rewind",
      name: "Zeitumkehr",
      description: "Wirft alle Gegner auf der eigenen Lane deutlich zurück Richtung Spawn.",
      cooldownMs: 78000,
      durationMs: 0,
      threatCost: 30,
      radius: 0,
    },
    perkPool: ["slow-master", "chain-master", "burn-master", "boss-hunter", "long-barrels", "fortified-core"],
  },
};

export const COMMANDER_IDS = Object.keys(COMMANDERS) as CommanderId[];

export interface PerkDefinition {
  id: string;
  name: string;
  description: string;
  modifiers: RuleModifiers;
}

export const PERKS: Record<string, PerkDefinition> = {
  "cheap-upgrades": {
    id: "cheap-upgrades",
    name: "Serienfertigung",
    description: "Upgrades kosten 25 % weniger.",
    modifiers: { upgradeCostMul: 0.75 },
  },
  "rich-kills": {
    id: "rich-kills",
    name: "Bergungsrecht",
    description: "Kills geben 35 % mehr Gold.",
    modifiers: { goldPerKillMul: 1.35 },
  },
  "long-barrels": {
    id: "long-barrels",
    name: "Lange Läufe",
    description: "Alle Türme erhalten +0,75 Reichweite.",
    modifiers: { towerRangeAdd: 0.75 },
  },
  "splash-master": {
    id: "splash-master",
    name: "Sprengmeister",
    description: "Explosionsradien +35 %, Schaden +10 %.",
    modifiers: { splashRadiusMul: 1.35, towerDamageMul: 1.1 },
  },
  "income-boost": {
    id: "income-boost",
    name: "Handelsroute",
    description: "+30 Gold pro abgeschlossener Welle.",
    modifiers: { incomePerWaveAdd: 30 },
  },
  "sell-value": {
    id: "sell-value",
    name: "Wiederverwertung",
    description: "Verkauf erstattet 25 Prozentpunkte mehr.",
    modifiers: { sellRefundAdd: 0.25 },
  },
  "cheap-sends": {
    id: "cheap-sends",
    name: "Kriegswirtschaft",
    description: "Send-Einheiten kosten 30 % weniger Threat.",
    modifiers: { sendCostMul: 0.7 },
  },
  "tough-sends": {
    id: "tough-sends",
    name: "Sturmpanzerung",
    description: "Gesendete Einheiten haben +50 % HP.",
    modifiers: { sendHpMul: 1.5 },
  },
  "fast-sends": {
    id: "fast-sends",
    name: "Blitzangriff",
    description: "Gesendete Einheiten sind 40 % schneller.",
    modifiers: { sendSpeedMul: 1.4 },
  },
  "threat-surge": {
    id: "threat-surge",
    name: "Aggressionsschub",
    description: "Threat regeneriert 50 % schneller.",
    modifiers: { threatRegenMul: 1.5 },
  },
  "cheap-lanes": {
    id: "cheap-lanes",
    name: "Vorgefertigte Teile",
    description: "Lane-Umbauten kosten 50 % weniger.",
    modifiers: { laneCostMul: 0.5 },
  },
  "fortified-core": {
    id: "fortified-core",
    name: "Bunkerkern",
    description: "+40 Core-HP.",
    modifiers: { coreHpAdd: 40 },
  },
  "slow-master": {
    id: "slow-master",
    name: "Kältemeisterin",
    description: "Slow-Effekte sind 40 % stärker.",
    modifiers: { slowStrengthMul: 1.4 },
  },
  "burn-master": {
    id: "burn-master",
    name: "Brandstifterin",
    description: "Brandschaden ist 60 % stärker.",
    modifiers: { burnStrengthMul: 1.6 },
  },
  "chain-master": {
    id: "chain-master",
    name: "Leitfähigkeit",
    description: "Kettenblitze springen 2-mal weiter.",
    modifiers: { chainJumpsAdd: 2 },
  },
  "boss-hunter": {
    id: "boss-hunter",
    name: "Bossjägerin",
    description: "+45 % Schaden gegen Bosse.",
    modifiers: { bossDamageMul: 1.45 },
  },
};

/** Auf welchen Commander-Leveln ein Perk gewählt wird. */
export const PERK_LEVELS = [2, 4, 6, 8];

/** XP-Schwelle für ein Commander-Level. */
export function xpForLevel(level: number): number {
  return Math.round(100 * Math.pow(level, 1.45));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 20 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

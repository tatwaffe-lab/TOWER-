/**
 * PvP-Send-Einheiten (Master Prompt §10/§11).
 *
 * Wichtig für die Balance: eine gesendete Einheit, die der Verteidiger tötet,
 * zahlt ihm einen Teil der Threat-Kosten als Gold zurück. Ein gescheiterter
 * Angriff finanziert also den Gegner. `defenderRewardRatio` ist bewusst pro
 * Einheit einstellbar — billiger Spam gibt anteilig mehr zurück als ein
 * teurer Einzelangriff, damit Dauerspam sich nie lohnt.
 */

export interface SendUnitDefinition {
  id: string;
  name: string;
  description: string;
  /** Threat-Kosten. */
  cost: number;
  /** Welcher Gegnertyp erscheint. */
  spawns: string;
  count: number;
  /** Zusätzliche HP/Speed gegenüber dem Basisgegner. */
  hpMul: number;
  speedMul: number;
  /** Anteil der Kosten, den der Verteidiger als Gold bekommt, wenn er tötet. */
  defenderRewardRatio: number;
  cooldownMs: number;
  minWave: number;
}

export const SEND_UNITS: Record<string, SendUnitDefinition> = {
  rusher: {
    id: "rusher",
    name: "Stürmer",
    description: "Billig und schnell. Testet lückenhafte Verteidigung.",
    cost: 8,
    spawns: "runner",
    count: 4,
    hpMul: 1.2,
    speedMul: 1.1,
    defenderRewardRatio: 0.55,
    cooldownMs: 1200,
    minWave: 1,
  },
  "swarm-pack": {
    id: "swarm-pack",
    name: "Schwarmpaket",
    description: "Viele winzige Einheiten — bestraft fehlenden Flächenschaden.",
    cost: 12,
    spawns: "swarm",
    count: 10,
    hpMul: 1.3,
    speedMul: 1,
    defenderRewardRatio: 0.5,
    cooldownMs: 1600,
    minWave: 1,
  },
  brute: {
    id: "brute",
    name: "Panzerbrecher",
    description: "Hohe Rüstung. Schnellfeuertürme allein reichen nicht.",
    cost: 20,
    spawns: "tank",
    count: 1,
    hpMul: 0.85,
    speedMul: 1.15,
    defenderRewardRatio: 0.4,
    cooldownMs: 2200,
    minWave: 2,
  },
  "shield-escort": {
    id: "shield-escort",
    name: "Schildeskorte",
    description: "Verstärkt die laufende PvE-Welle des Gegners mit Rüstung.",
    cost: 17,
    spawns: "shield-carrier",
    count: 2,
    hpMul: 1,
    speedMul: 1.1,
    defenderRewardRatio: 0.45,
    cooldownMs: 2200,
    minWave: 2,
  },
  disruptor: {
    id: "disruptor",
    name: "Störsender",
    description: "Legt Türme lahm — trifft Verteidigungen mit wenigen starken Türmen hart.",
    cost: 18,
    spawns: "saboteur",
    count: 2,
    hpMul: 1.1,
    speedMul: 1.1,
    defenderRewardRatio: 0.45,
    cooldownMs: 2500,
    minWave: 3,
  },
  splitters: {
    id: "splitters",
    name: "Teilerzelle",
    description: "Zerfällt beim Tod und überlastet die Zielerfassung.",
    cost: 16,
    spawns: "splitter",
    count: 3,
    hpMul: 1.15,
    speedMul: 1,
    defenderRewardRatio: 0.5,
    cooldownMs: 1800,
    minWave: 2,
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    description: "Zeitweise nicht anvisierbar und fliegt die Luftlinie.",
    cost: 22,
    spawns: "phase-flyer",
    count: 2,
    hpMul: 1.1,
    speedMul: 1.05,
    defenderRewardRatio: 0.4,
    cooldownMs: 2800,
    minWave: 4,
  },
  "siege-beast": {
    id: "siege-beast",
    name: "Belagerungsbestie",
    description: "Teuer und brutal. Ein gescheiterter Angriff finanziert den Gegner spürbar.",
    cost: 34,
    spawns: "tank",
    count: 3,
    hpMul: 1.25,
    speedMul: 1,
    defenderRewardRatio: 0.35,
    cooldownMs: 4000,
    minWave: 4,
  },
};

export const SEND_IDS = Object.keys(SEND_UNITS);

export const THREAT_MAX = 200;
/** Threat pro Sekunde im Match. */
export const THREAT_REGEN_PER_SEC = 6.5;
/** Zusätzlicher Threat für jede abgeschlossene Welle. */
export const THREAT_PER_WAVE = 30;

/** Gold, das der Verteidiger pro getöteter Send-Einheit erhält. */
export function defenderReward(def: SendUnitDefinition): number {
  return Math.max(1, Math.round((def.cost * def.defenderRewardRatio) / def.count));
}

export function sendAvailable(def: SendUnitDefinition, wave: number): boolean {
  return wave >= def.minWave;
}

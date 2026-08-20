/**
 * PvP-Send-Einheiten.
 *
 * Ökonomie in einem Satz: **Gold bezahlt, Threat schaltet frei.**
 *
 * Gold ist dieselbe Währung, aus der du auch Türme baust. Jeder Angriff ist
 * damit ein Turm, den du nicht gebaut hast — das ist die eigentliche
 * Entscheidung, und sie braucht keinen Cooldown, um interessant zu bleiben.
 * Wer sein ganzes Gold in Angriffe steckt, steht selbst nackt da.
 *
 * Threat wird dagegen nie ausgegeben. Es wächst über abgeschlossene Wellen
 * und Kills und bestimmt nur, welche Stufen du überhaupt anklicken darfst.
 * Dadurch kann niemand in Welle 2 eine Belagerungsbestie schicken, aber wer
 * weit ist, darf so viel spammen, wie sein Gold hergibt.
 *
 * Gesendete Einheiten skalieren mit der Wellenstufe des Absenders, sonst
 * wären sie ab Welle 15 nur noch Gratisgold für den Verteidiger.
 */

export interface SendUnitDefinition {
  id: string;
  name: string;
  description: string;
  /** Goldkosten auf Wellenstufe 1. Steigt mit `sendCost`. */
  goldCost: number;
  /** Ab diesem Threat-Stand freigeschaltet. 0 = von Anfang an. */
  threatUnlock: number;
  /** Welcher Gegnertyp erscheint. */
  spawns: string;
  count: number;
  /** Zusätzliche HP/Speed gegenüber dem Basisgegner derselben Stufe. */
  hpMul: number;
  speedMul: number;
  /** Zusätzliche Rüstung obendrauf. */
  armorAdd: number;
  /** Anteil der Goldkosten, den der Verteidiger zurückbekommt, wenn er tötet. */
  defenderRewardRatio: number;
}

export const SEND_UNITS: Record<string, SendUnitDefinition> = {
  rusher: {
    id: "rusher",
    name: "Stürmer",
    description: "Billig und schnell. Testet lückenhafte Verteidigung — und lässt sich endlos nachschieben.",
    goldCost: 30,
    threatUnlock: 0,
    spawns: "runner",
    count: 6,
    hpMul: 1.5,
    speedMul: 1.15,
    armorAdd: 0,
    defenderRewardRatio: 0.5,
  },
  "swarm-pack": {
    id: "swarm-pack",
    name: "Schwarmpaket",
    description: "Sechzehn winzige Einheiten auf einmal. Ohne Flächenschaden geht die Zielerfassung in die Knie.",
    goldCost: 45,
    threatUnlock: 0,
    spawns: "swarm",
    count: 16,
    hpMul: 1.6,
    speedMul: 1.05,
    armorAdd: 0,
    defenderRewardRatio: 0.45,
  },
  splitters: {
    id: "splitters",
    name: "Teilerzelle",
    description: "Zerfällt beim Tod in Nachwuchs. Aus fünf werden schnell fünfzehn.",
    goldCost: 70,
    threatUnlock: 60,
    spawns: "splitter",
    count: 5,
    hpMul: 1.5,
    speedMul: 1,
    armorAdd: 1,
    defenderRewardRatio: 0.45,
  },
  brute: {
    id: "brute",
    name: "Panzerbrecher",
    description: "Schwer gepanzert und schnell. Schnellfeuertürme prallen daran ab.",
    goldCost: 85,
    threatUnlock: 60,
    spawns: "tank",
    count: 2,
    hpMul: 1.3,
    speedMul: 1.2,
    armorAdd: 3,
    defenderRewardRatio: 0.4,
  },
  "shield-escort": {
    id: "shield-escort",
    name: "Schildeskorte",
    description: "Panzert die gesamte laufende Welle des Gegners mit auf. Am stärksten kurz nach seinem Wellenruf.",
    goldCost: 95,
    threatUnlock: 150,
    spawns: "shield-carrier",
    count: 3,
    hpMul: 1.4,
    speedMul: 1.15,
    armorAdd: 2,
    defenderRewardRatio: 0.4,
  },
  disruptor: {
    id: "disruptor",
    name: "Störsender",
    description: "Legt Türme reihenweise lahm. Trifft konzentrierte Verteidigungen härter als breite.",
    goldCost: 110,
    threatUnlock: 150,
    spawns: "saboteur",
    count: 4,
    hpMul: 1.4,
    speedMul: 1.15,
    armorAdd: 1,
    defenderRewardRatio: 0.4,
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    description: "Fliegt die Luftlinie und ist zyklisch nicht anvisierbar. Umgeht jedes Labyrinth.",
    goldCost: 140,
    threatUnlock: 300,
    spawns: "phase-flyer",
    count: 4,
    hpMul: 1.4,
    speedMul: 1.1,
    armorAdd: 2,
    defenderRewardRatio: 0.35,
  },
  "siege-beast": {
    id: "siege-beast",
    name: "Belagerungsbestie",
    description: "Der Hammer. Teuer genug, dass ein gescheiterter Angriff den Gegner spürbar finanziert.",
    goldCost: 210,
    threatUnlock: 300,
    spawns: "tank",
    count: 5,
    hpMul: 1.8,
    speedMul: 1.05,
    armorAdd: 4,
    defenderRewardRatio: 0.3,
  },
};

export const SEND_IDS = Object.keys(SEND_UNITS);

/**
 * Threat-Obergrenze. Bei diesem Stand ist alles freigeschaltet; der Balken
 * bleibt danach voll stehen.
 */
export const THREAT_MAX = 300;
/** Threat für jede abgeschlossene Welle. */
export const THREAT_PER_WAVE = 30;
/** Threat pro getötetem Gegner — belohnt gutes Verteidigen zusätzlich. */
export const THREAT_PER_KILL = 0.15;

/**
 * Wie stark gesendete Einheiten mit der Wellenstufe des Absenders wachsen.
 *
 * Bewusst knapp unter der PvE-Kurve (1.135), damit ein Angriff nie härter
 * ist als die Welle, die der Verteidiger ohnehin gerade übersteht — er soll
 * den Ausschlag geben, nicht allein entscheiden.
 */
export function sendPowerMultiplier(wave: number): number {
  const w = Math.max(1, Number.isFinite(wave) ? wave : 1);
  return Math.pow(1.12, w - 1);
}

/**
 * Goldkosten auf einer Wellenstufe.
 *
 * Steigt langsamer als das Einkommen (waveGoldMultiplier, +11 % pro Welle),
 * damit Angriffe im späten Spiel bezahlbarer werden statt unerschwinglich.
 */
export function sendCost(def: SendUnitDefinition, wave: number): number {
  const w = Math.max(1, Number.isFinite(wave) ? wave : 1);
  return Math.round(def.goldCost * (1 + (w - 1) * 0.08));
}

/** Rüstungsbonus einer gesendeten Einheit auf dieser Wellenstufe. */
export function sendArmorBonus(def: SendUnitDefinition, wave: number): number {
  const w = Math.max(1, Number.isFinite(wave) ? wave : 1);
  return def.armorAdd + Math.max(0, Math.round((w - 5) * 0.4));
}

/** Gold, das der Verteidiger pro getöteter Send-Einheit erhält. */
export function defenderReward(def: SendUnitDefinition, wave: number): number {
  return Math.max(1, Math.round((sendCost(def, wave) * def.defenderRewardRatio) / def.count));
}

/** Ist diese Stufe beim gegebenen Threat-Stand freigeschaltet? */
export function sendUnlocked(def: SendUnitDefinition, threat: number): boolean {
  const t = Number.isFinite(threat) ? threat : 0;
  return t >= def.threatUnlock;
}

/** Alle Freischaltschwellen, aufsteigend — für die Anzeige im HUD. */
export const THREAT_TIERS = [...new Set(SEND_IDS.map((id) => SEND_UNITS[id].threatUnlock))].sort(
  (a, b) => a - b
);

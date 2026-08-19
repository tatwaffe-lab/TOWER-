/**
 * Gegner-Definitionen. Jede Sonderfähigkeit ist ein Flag, auf das der Server
 * im Tick tatsächlich verzweigt — es gibt hier bewusst keine Werte, die
 * nirgends gelesen werden.
 */

export type EnemyAbility =
  | "none"
  | "split" // zerfällt beim Tod in kleinere Einheiten
  | "shield-aura" // gibt Verbündeten in Reichweite Rüstung
  | "sabotage" // deaktiviert kurzzeitig einen Turm in der Nähe
  | "regenerate" // heilt sich selbst
  | "phase" // periodisch nicht anvisierbar
  | "flying"; // nimmt die Luftlinie statt der Lane

export type EnemyClass = "normal" | "elite" | "boss";

export interface BossPhase {
  /** Ab welchem HP-Anteil diese Phase aktiv wird. */
  atHpFraction: number;
  name: string;
  speedMul: number;
  armorAdd: number;
  /** Ruft beim Phasenwechsel diese Begleiter. */
  summon?: { defId: string; count: number };
  /** Zerstört beim Phasenwechsel Türme im Umkreis für n ms. */
  disableTowersMs?: number;
}

export interface EnemyDefinition {
  id: string;
  name: string;
  role: string;
  cls: EnemyClass;
  hp: number;
  speed: number;
  armor: number;
  coreDamage: number;
  goldReward: number;
  /** Kosten im Wellenbudget des Wave-Directors. */
  budgetCost: number;
  /** Frühestens ab dieser Welle im Pool. */
  minWave: number;
  ability: EnemyAbility;
  color: number;
  accent: number;
  radius: number;
  /** Parameter der Sonderfähigkeit. */
  splitInto?: { defId: string; count: number };
  auraRadius?: number;
  auraArmor?: number;
  regenPerSec?: number;
  phaseCycleMs?: number;
  sabotageRadius?: number;
  sabotageMs?: number;
  sabotageCooldownMs?: number;
  phases?: BossPhase[];
}

export const ENEMIES: Record<string, EnemyDefinition> = {
  grunt: {
    id: "grunt",
    name: "Grunt",
    role: "Standardgegner",
    cls: "normal",
    hp: 22,
    speed: 1.0,
    armor: 0,
    coreDamage: 1,
    goldReward: 3,
    budgetCost: 10,
    minWave: 1,
    ability: "none",
    color: 0xe66a5a,
    accent: 0x7d2b22,
    radius: 10,
  },

  runner: {
    id: "runner",
    name: "Läufer",
    role: "Sehr schnell, wenig HP",
    cls: "normal",
    hp: 12,
    speed: 2.3,
    armor: 0,
    coreDamage: 1,
    goldReward: 3,
    budgetCost: 12,
    minWave: 2,
    ability: "none",
    color: 0xffd166,
    accent: 0x8a6a10,
    radius: 8,
  },

  swarm: {
    id: "swarm",
    name: "Schwarm",
    role: "Viele kleine Einheiten, testet Flächenschaden",
    cls: "normal",
    hp: 7,
    speed: 1.35,
    armor: 0,
    coreDamage: 1,
    goldReward: 1,
    budgetCost: 4,
    minWave: 3,
    ability: "none",
    color: 0xef8fb5,
    accent: 0x7d2f4c,
    radius: 6,
  },

  tank: {
    id: "tank",
    name: "Panzer",
    role: "Langsam, hohe Rüstung, viel HP",
    cls: "elite",
    hp: 190,
    speed: 0.55,
    armor: 9,
    coreDamage: 3,
    goldReward: 14,
    budgetCost: 55,
    minWave: 5,
    ability: "none",
    color: 0x7f8b99,
    accent: 0x2f3740,
    radius: 15,
  },

  "shield-carrier": {
    id: "shield-carrier",
    name: "Schildträger",
    role: "Gibt umstehenden Gegnern Rüstung",
    cls: "elite",
    hp: 70,
    speed: 0.9,
    armor: 3,
    coreDamage: 2,
    goldReward: 12,
    budgetCost: 40,
    minWave: 6,
    ability: "shield-aura",
    color: 0x6fd3c7,
    accent: 0x1f5f57,
    radius: 12,
    auraRadius: 2.0,
    auraArmor: 6,
  },

  splitter: {
    id: "splitter",
    name: "Teiler",
    role: "Zerfällt beim Tod in Schwarmeinheiten",
    cls: "normal",
    hp: 40,
    speed: 0.95,
    armor: 1,
    coreDamage: 2,
    goldReward: 6,
    budgetCost: 22,
    minWave: 4,
    ability: "split",
    color: 0xb98cff,
    accent: 0x4a2a80,
    radius: 12,
    splitInto: { defId: "swarm", count: 3 },
  },

  saboteur: {
    id: "saboteur",
    name: "Saboteur",
    role: "Legt Türme kurzzeitig lahm",
    cls: "elite",
    hp: 45,
    speed: 1.15,
    armor: 1,
    coreDamage: 1,
    goldReward: 11,
    budgetCost: 35,
    minWave: 7,
    ability: "sabotage",
    color: 0xff9f45,
    accent: 0x8a4a08,
    radius: 10,
    sabotageRadius: 2.2,
    sabotageMs: 2200,
    sabotageCooldownMs: 5000,
  },

  "phase-flyer": {
    id: "phase-flyer",
    name: "Phasenflieger",
    role: "Fliegt die Luftlinie und ist zeitweise nicht anvisierbar",
    cls: "elite",
    hp: 55,
    speed: 1.1,
    armor: 2,
    coreDamage: 2,
    goldReward: 12,
    budgetCost: 38,
    minWave: 8,
    ability: "flying",
    color: 0xa5b4ff,
    accent: 0x2f3a80,
    radius: 11,
    phaseCycleMs: 3000,
  },

  // ---- Bosse ----

  "siege-golem": {
    id: "siege-golem",
    name: "Belagerungsgolem",
    role: "Boss: Rüstungsphasen, ruft Adds, legt Türme lahm",
    cls: "boss",
    hp: 1500,
    speed: 0.45,
    armor: 12,
    coreDamage: 18,
    goldReward: 130,
    budgetCost: 400,
    minWave: 10,
    ability: "none",
    color: 0xc4703a,
    accent: 0x5c2c0f,
    radius: 22,
    phases: [
      { atHpFraction: 0.66, name: "Panzerung bricht", speedMul: 1.25, armorAdd: -5, summon: { defId: "grunt", count: 4 } },
      { atHpFraction: 0.33, name: "Amoklauf", speedMul: 1.6, armorAdd: -4, disableTowersMs: 2500, summon: { defId: "swarm", count: 6 } },
    ],
  },

  "hive-queen": {
    id: "hive-queen",
    name: "Schwarmkönigin",
    role: "Boss: gebiert dauerhaft Schwärme und regeneriert",
    cls: "boss",
    hp: 1100,
    speed: 0.7,
    armor: 5,
    coreDamage: 15,
    goldReward: 120,
    budgetCost: 380,
    minWave: 15,
    ability: "regenerate",
    color: 0xe86ea8,
    accent: 0x6e1f45,
    radius: 20,
    regenPerSec: 14,
    phases: [
      { atHpFraction: 0.7, name: "Erste Brut", speedMul: 1.1, armorAdd: 0, summon: { defId: "swarm", count: 8 } },
      { atHpFraction: 0.35, name: "Massenbrut", speedMul: 1.3, armorAdd: 2, summon: { defId: "splitter", count: 3 } },
    ],
  },

  "void-serpent": {
    id: "void-serpent",
    name: "Leerenschlange",
    role: "Boss: phasenweise unangreifbar, sehr schnell",
    cls: "boss",
    hp: 900,
    speed: 1.3,
    armor: 4,
    coreDamage: 20,
    goldReward: 140,
    budgetCost: 420,
    minWave: 20,
    ability: "phase",
    color: 0x8a6ee8,
    accent: 0x33206b,
    radius: 18,
    phaseCycleMs: 3500,
    phases: [
      { atHpFraction: 0.5, name: "Leerensprung", speedMul: 1.5, armorAdd: 3, summon: { defId: "phase-flyer", count: 3 } },
    ],
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES);

/** Normale Gegner, die der Wave-Director frei kombinieren darf. */
export const WAVE_POOL = ENEMY_IDS.filter((id) => ENEMIES[id].cls !== "boss");

export const BOSS_IDS = ENEMY_IDS.filter((id) => ENEMIES[id].cls === "boss");

/** Bosswellen alle N Wellen. */
export const BOSS_WAVE_INTERVAL = 5;

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % BOSS_WAVE_INTERVAL === 0;
}

/** Wählt den Boss anhand der Wellennummer, damit die Abfolge lesbar bleibt. */
export function bossForWave(wave: number): EnemyDefinition {
  const eligible = BOSS_IDS.filter((id) => ENEMIES[id].minWave <= wave);
  const pool = eligible.length > 0 ? eligible : [BOSS_IDS[0]];
  const index = Math.floor(wave / BOSS_WAVE_INTERVAL) - 1;
  return ENEMIES[pool[index % pool.length]];
}

/**
 * Wellenbudget: wie viele Gegner eine Welle enthält.
 *
 * Wächst spürbar, aber begrenzt — die eigentliche Eskalation kommt über HP
 * und Rüstung (siehe unten), nicht über immer mehr Einheiten. Sonst würde die
 * Simulation irgendwann an der Gegnerzahl ersticken statt an der Härte.
 */
export function waveBudget(wave: number, playerCount: number): number {
  const base = 90 + wave * 55 + Math.pow(wave, 1.75) * 4.5;
  // Mehr Spieler heißt nicht mehr Gegner pro Lane — jede Lane bleibt fair.
  const scale = 1 + Math.max(0, playerCount - 1) * 0.04;
  return Math.round(base * scale);
}

/**
 * HP-Skalierung über die Wellen.
 *
 * Bewusst exponentiell: die Spielerstärke wächst multiplikativ (mehr Türme ×
 * Upgrades × Spezialisierungen × Perks × Support-Auren) und erreicht im
 * Lategame leicht das Fünfzigfache des Anfangswerts. Eine lineare
 * Gegnerskalierung — wie sie hier vorher stand — bleibt dahinter
 * zwangsläufig zurück, und ab etwa Welle 4 zerfallen die Wellen wirkungslos.
 *
 * Frühe Wellen bleiben mild, ab Welle 10 zieht die Kurve zusätzlich an.
 */
export function waveHpMultiplier(wave: number): number {
  const w = Math.max(1, wave);
  const exponential = Math.pow(1.135, w - 1);
  const lateGamePush = 1 + Math.max(0, w - 10) * 0.07;
  return exponential * lateGamePush;
}

/**
 * Zusätzliche Rüstung in späteren Wellen.
 *
 * Sorgt dafür, dass reine Schnellfeuer-Stapel nicht endlos skalieren und
 * Rüstungsabbau (Minigun, Alchemist) sowie Energie-/Chemieschaden echte
 * Bedeutung bekommen. Der Mindestschaden von 15 % verhindert dabei, dass
 * Gegner unangreifbar werden.
 */
export function waveArmorBonus(wave: number): number {
  return Math.max(0, Math.round((wave - 4) * 0.7));
}

/** Kill-Gold wächst mit, damit der Spieler mit der Eskalation Schritt halten kann. */
export function waveGoldMultiplier(wave: number): number {
  return 1 + Math.max(0, wave - 1) * 0.11;
}

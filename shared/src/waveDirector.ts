import { ENEMIES, WAVE_POOL, bossForWave, isBossWave, waveBudget, waveHpMultiplier } from "./enemyData";
import { Rng } from "./rng";

export interface WaveEntry {
  defId: string;
  count: number;
}

export interface WavePlan {
  wave: number;
  entries: WaveEntry[];
  hpMultiplier: number;
  isBoss: boolean;
  /** Abstand zwischen einzelnen Spawns in ms. */
  spawnIntervalMs: number;
  totalEnemies: number;
}

/**
 * Budgetbasierter Wellenaufbau statt fester Tabellen (Master Prompt §12).
 *
 * Kontrolliert zufällig: der Pool ist nach Mindestwelle gefiltert, jeder Typ
 * hat einen Maximalanteil am Budget, und es wird immer mindestens ein
 * Grundgegner beigemischt. Damit entstehen abwechslungsreiche, aber nie
 * unfaire Kombinationen (z. B. keine Welle aus ausschließlich Panzern).
 */
export function planWave(wave: number, playerCount: number, rng: Rng): WavePlan {
  const hpMultiplier = waveHpMultiplier(wave);

  if (isBossWave(wave)) {
    const boss = bossForWave(wave);
    const escortBudget = Math.round(waveBudget(wave, playerCount) * 0.35);
    const escorts = fillBudget(wave, escortBudget, rng);
    return {
      wave,
      entries: [{ defId: boss.id, count: 1 }, ...escorts],
      hpMultiplier,
      isBoss: true,
      spawnIntervalMs: 900,
      totalEnemies: 1 + escorts.reduce((s, e) => s + e.count, 0),
    };
  }

  const entries = fillBudget(wave, waveBudget(wave, playerCount), rng);
  const total = entries.reduce((s, e) => s + e.count, 0);

  return {
    wave,
    entries,
    hpMultiplier,
    isBoss: false,
    // Größere Wellen spawnen dichter, damit die Wellendauer nicht explodiert.
    spawnIntervalMs: Math.max(260, 900 - wave * 22),
    totalEnemies: total,
  };
}

function fillBudget(wave: number, budget: number, rng: Rng): WaveEntry[] {
  const pool = WAVE_POOL.filter((id) => ENEMIES[id].minWave <= wave);
  if (pool.length === 0) return [{ defId: "grunt", count: Math.max(1, Math.floor(budget / 10)) }];

  const counts = new Map<string, number>();
  let remaining = budget;

  // Grundstock: garantiert immer eine handhabbare Basis.
  const baseId = rng.chance(0.5) && pool.includes("runner") ? "runner" : "grunt";
  const baseCount = Math.max(2, Math.floor((budget * 0.25) / ENEMIES[baseId].budgetCost));
  counts.set(baseId, baseCount);
  remaining -= baseCount * ENEMIES[baseId].budgetCost;

  // Maximal 45 % des Budgets pro weiterem Typ verhindert Monowellen.
  const perTypeCap = budget * 0.45;
  const spent = new Map<string, number>();
  let guard = 0;

  while (remaining > 0 && guard++ < 200) {
    const candidates = pool.filter((id) => {
      const cost = ENEMIES[id].budgetCost;
      return cost <= remaining && (spent.get(id) ?? 0) + cost <= perTypeCap;
    });
    if (candidates.length === 0) break;

    const id = rng.pick(candidates);
    const cost = ENEMIES[id].budgetCost;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    spent.set(id, (spent.get(id) ?? 0) + cost);
    remaining -= cost;
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([defId, count]) => ({ defId, count }));
}

/**
 * Baut aus dem Plan die konkrete Spawn-Reihenfolge. Gegner werden gemischt
 * ausgegeben statt blockweise, damit Wellen sich lebendig anfühlen und
 * Flächenschaden nicht trivial alles auf einmal erwischt. Bosse kommen immer
 * zuerst, damit ihre Phasen nicht erst am Wellenende zünden.
 */
export function buildSpawnQueue(plan: WavePlan, rng: Rng): string[] {
  const queue: string[] = [];
  const bossEntries = plan.entries.filter((e) => ENEMIES[e.defId]?.cls === "boss");
  const rest = plan.entries.filter((e) => ENEMIES[e.defId]?.cls !== "boss");

  for (const entry of bossEntries) {
    for (let i = 0; i < entry.count; i++) queue.push(entry.defId);
  }

  const bag: string[] = [];
  for (const entry of rest) {
    for (let i = 0; i < entry.count; i++) bag.push(entry.defId);
  }
  // Fisher-Yates mit deterministischer RNG.
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  return queue.concat(bag);
}

/** Kurztext für die Wellenvorschau im HUD. */
export function describeWave(plan: WavePlan): string {
  return plan.entries
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((e) => `${e.count}x ${ENEMIES[e.defId]?.name ?? e.defId}`)
    .join(", ");
}

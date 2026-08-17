/**
 * Balance- und Performance-Messung ohne Netzwerk.
 *
 * Misst pro Turm den tatsächlichen DPS gegen Referenzgegner (nicht die
 * Papierwerte), das Preis-Leistungs-Verhältnis, die Zeit bis zum Kill (TTK)
 * ganzer Wellen und den Leak-Druck. Läuft die echte Simulation, damit die
 * Zahlen zu dem passen, was Spieler erleben.
 *
 * Aufruf: npm run balance
 */
const { Rng, TOWERS, ENEMIES, planWave, buildSpawnQueue, resolveTowerStats } = require("../../shared/dist/index.js");
const { PlayerSim } = require("../dist/sim/PlayerSim.js");

const TICK = 100;

function measureDps(towerId, level, specId, targetId, seconds = 20) {
  const sim = new PlayerSim(new Rng(1));
  const tower = sim.addTower(towerId, 1, 2, "first");
  tower.level = level;
  tower.specializationId = specId;

  // Konstanter Nachschub, damit der Turm nie ohne Ziel dasteht.
  const keepAlive = () => {
    while (sim.enemies.size < 6) {
      const e = sim.spawnEnemy(targetId);
      if (!e) break;
      e.hp = 1e9;
      e.maxHp = 1e9;
      // Gegner in Reichweite platzieren.
      e.x = 1 + Math.random() * 0.5;
      e.y = 1 + Math.random() * 0.5;
      e.pathIndex = 1;
    }
  };

  for (let t = 0; t < seconds * 1000; t += TICK) {
    keepAlive();
    sim.tickEnemies(TICK);
    sim.tickTowers(TICK);
    sim.tickEffects(TICK);
  }
  return tower.totalDamage / seconds;
}

function measureWave(wave, towerPlan) {
  const sim = new PlayerSim(new Rng(wave * 13));
  let cost = 0;
  for (const [towerId, x, y, level, spec] of towerPlan) {
    const t = sim.addTower(towerId, x, y, "first");
    t.level = level;
    t.specializationId = spec ?? null;
    const def = TOWERS[towerId];
    cost += def.cost + def.upgrades.slice(0, level).reduce((s, u) => s + u.cost, 0);
  }

  const plan = planWave(wave, 1, new Rng(wave));
  const queue = buildSpawnQueue(plan, new Rng(wave));
  let spawnTimer = 0;
  let leaks = 0;
  let kills = 0;
  let gold = 0;
  let ticks = 0;
  const start = process.hrtime.bigint();

  while ((queue.length > 0 || sim.enemies.size > 0) && ticks < 6000) {
    spawnTimer -= TICK;
    while (spawnTimer <= 0 && queue.length > 0) {
      sim.spawnEnemy(queue.shift(), { hpMul: plan.hpMultiplier });
      spawnTimer += plan.spawnIntervalMs;
    }
    leaks += sim.moveEnemies(TICK).reduce((s, l) => s + l.coreDamage, 0);
    for (const k of sim.tickEnemies(TICK)) {
      kills++;
      gold += k.gold;
    }
    for (const k of sim.tickTowers(TICK)) {
      kills++;
      gold += k.gold;
    }
    sim.tickEffects(TICK);
    ticks++;
  }

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return {
    wave,
    total: plan.totalEnemies,
    kills,
    leaks,
    gold,
    seconds: (ticks * TICK) / 1000,
    cpuMs: elapsedMs,
    finished: ticks < 6000,
  };
}

console.log("=".repeat(74));
console.log("TURM-DPS gegen Grunt (0 Rüstung) und Panzer (9 Rüstung), voll ausgebaut");
console.log("=".repeat(74));
console.log("Turm".padEnd(20), "Kosten".padStart(7), "DPS/Grunt".padStart(11), "DPS/Panzer".padStart(11), "DPS pro 100G".padStart(13));

const rows = [];
for (const [id, def] of Object.entries(TOWERS)) {
  if (def.base.attack === "aura") continue;
  const maxLevel = def.upgrades.length;
  const totalCost = def.cost + def.upgrades.reduce((s, u) => s + u.cost, 0);
  const dpsGrunt = measureDps(id, maxLevel, null, "grunt");
  const dpsTank = measureDps(id, maxLevel, null, "tank");
  rows.push({ id, name: def.name, totalCost, dpsGrunt, dpsTank, eff: (dpsGrunt / totalCost) * 100 });
}
rows.sort((a, b) => b.eff - a.eff);
for (const r of rows) {
  console.log(
    r.name.padEnd(20),
    String(r.totalCost).padStart(7),
    r.dpsGrunt.toFixed(1).padStart(11),
    r.dpsTank.toFixed(1).padStart(11),
    r.eff.toFixed(1).padStart(13)
  );
}

console.log("\n" + "=".repeat(74));
console.log("SPEZIALISIERUNGEN: unterscheiden sie sich mechanisch?");
console.log("=".repeat(74));
for (const [id, def] of Object.entries(TOWERS)) {
  if (def.base.attack === "aura") continue;
  const maxLevel = def.upgrades.length;
  const a = measureDps(id, maxLevel, def.specializations[0].id, "grunt");
  const b = measureDps(id, maxLevel, def.specializations[1].id, "grunt");
  const aTank = measureDps(id, maxLevel, def.specializations[0].id, "tank");
  const bTank = measureDps(id, maxLevel, def.specializations[1].id, "tank");
  console.log(
    `${def.name.padEnd(18)} ${def.specializations[0].name.padEnd(14)} ${a.toFixed(0).padStart(5)}/${aTank.toFixed(0).padStart(5)}   ` +
      `${def.specializations[1].name.padEnd(14)} ${b.toFixed(0).padStart(5)}/${bTank.toFixed(0).padStart(5)}  (Grunt/Panzer)`
  );
}

console.log("\n" + "=".repeat(74));
console.log("WELLENVERLAUF mit einer soliden Standardverteidigung");
console.log("=".repeat(74));
console.log("Welle".padStart(6), "Gegner".padStart(7), "Kills".padStart(6), "Leak-Schaden".padStart(13), "Gold".padStart(6), "Dauer s".padStart(8), "CPU ms".padStart(8));

const defense = [
  ["gunner", 1, 2, 3, null],
  ["cannon", 5, 3, 3, null],
  ["frost", 4, 5, 3, null],
  ["sniper", 8, 6, 3, null],
  ["tesla", 6, 5, 3, null],
];

let totalCpu = 0;
for (const wave of [1, 3, 5, 8, 10, 13, 15, 18, 20, 25]) {
  const r = measureWave(wave, defense);
  totalCpu += r.cpuMs;
  console.log(
    String(r.wave).padStart(6),
    String(r.total).padStart(7),
    String(r.kills).padStart(6),
    String(r.leaks).padStart(13),
    String(r.gold).padStart(6),
    r.seconds.toFixed(1).padStart(8),
    r.cpuMs.toFixed(0).padStart(8),
    r.finished ? "" : "  ABBRUCH (Softlock-Verdacht!)"
  );
}

console.log("\n" + "=".repeat(74));
console.log("PERFORMANCE: viele Gegner gleichzeitig");
console.log("=".repeat(74));
for (const count of [50, 100, 200, 400]) {
  const sim = new PlayerSim(new Rng(7));
  for (const [towerId, x, y, level] of defense) {
    const t = sim.addTower(towerId, x, y, "first");
    t.level = level;
  }
  for (let i = 0; i < count; i++) sim.spawnEnemy("grunt", { hpMul: 20 });

  const start = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) {
    sim.moveEnemies(TICK);
    sim.tickEnemies(TICK);
    sim.tickTowers(TICK);
    sim.tickEffects(TICK);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const perTick = ms / 100;
  console.log(
    `${String(count).padStart(4)} Gegner: ${perTick.toFixed(2)} ms/Tick ` +
      `(Budget 100 ms → ${((perTick / 100) * 100).toFixed(1)} % ausgelastet)` +
      (perTick > 25 ? "  ⚠ knapp" : "")
  );
}

console.log(`\nGesamte CPU-Zeit der Wellenmessung: ${totalCpu.toFixed(0)} ms`);

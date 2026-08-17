const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStatus,
  tickStatuses,
  computeDamage,
  speedMultiplier,
  effectiveArmor,
  resolveTowerStats,
  investedGold,
  sellValue,
  canSpecialize,
  nextUpgradeCost,
  TOWERS,
  ENEMIES,
  Rng,
  planWave,
  buildSpawnQueue,
  isBossWave,
  combineModifiers,
  PERKS,
  COMMANDERS,
  levelForXp,
  defenderReward,
  SEND_UNITS,
} = require("../../shared/dist/index.js");

test("Status: stärkere Magnitude gewinnt, gleiche frischt Dauer auf", () => {
  let effects = [];
  effects = applyStatus(effects, { kind: "slow", magnitude: 0.3, remainingMs: 1000 });
  effects = applyStatus(effects, { kind: "slow", magnitude: 0.2, remainingMs: 9000 });
  assert.equal(effects.length, 1, "kein Stapeln gleicher Art");
  assert.equal(effects[0].magnitude, 0.3, "schwächerer Effekt überschreibt nicht");
  assert.equal(effects[0].remainingMs, 1000, "schwächerer Effekt verlängert nicht");

  effects = applyStatus(effects, { kind: "slow", magnitude: 0.3, remainingMs: 5000 });
  assert.equal(effects[0].remainingMs, 5000, "gleiche Magnitude frischt auf");

  effects = applyStatus(effects, { kind: "slow", magnitude: 0.6, remainingMs: 2000 });
  assert.equal(effects[0].magnitude, 0.6, "stärkerer Effekt übernimmt");
});

test("Status: DoT tickt und läuft ab", () => {
  let effects = applyStatus([], { kind: "burn", magnitude: 5, remainingMs: 1000 });
  const r1 = tickStatuses(effects, 500);
  assert.equal(r1.damage, 5, "ein Tick nach 500ms");
  const r2 = tickStatuses(r1.effects, 600);
  assert.equal(r2.effects.length, 0, "Effekt ist abgelaufen");
});

test("Status: regen heilt statt zu schaden", () => {
  const effects = applyStatus([], { kind: "regen", magnitude: 7, remainingMs: 1000 });
  const r = tickStatuses(effects, 500);
  assert.equal(r.heal, 7);
  assert.equal(r.damage, 0);
});

test("Bewegung: Stun stoppt komplett, Slow bremst anteilig", () => {
  assert.equal(speedMultiplier([]), 1);
  assert.equal(speedMultiplier([{ kind: "slow", magnitude: 0.5, remainingMs: 1 }]), 0.5);
  assert.equal(speedMultiplier([{ kind: "stun", magnitude: 1, remainingMs: 1 }]), 0);
});

test("Rüstung: Shred senkt, Shield erhöht, nie unter 0", () => {
  assert.equal(effectiveArmor(10, []), 10);
  assert.equal(effectiveArmor(10, [{ kind: "shred", magnitude: 4, remainingMs: 1 }]), 6);
  assert.equal(effectiveArmor(10, [{ kind: "shielded", magnitude: 5, remainingMs: 1 }]), 15);
  assert.equal(effectiveArmor(2, [{ kind: "shred", magnitude: 99, remainingMs: 1 }]), 0);
});

test("Schaden: Mindestschaden greift, Chemie ignoriert Rüstung", () => {
  const kinetic = computeDamage(10, "kinetic", 100, []);
  assert.ok(kinetic > 0, "nie 0 Schaden trotz massiver Rüstung");
  assert.equal(kinetic, 1.5, "15 % Mindestanteil");

  assert.equal(computeDamage(10, "chemical", 100, []), 10, "Chemie ignoriert Rüstung");
  assert.ok(
    computeDamage(20, "energy", 10, []) > computeDamage(20, "kinetic", 10, []),
    "Energie ignoriert halbe Rüstung"
  );
});

test("Schaden: conductive verstärkt nur Energieschaden", () => {
  const status = [{ kind: "conductive", magnitude: 0.5, remainingMs: 1 }];
  assert.equal(computeDamage(10, "energy", 0, status), 15);
  assert.equal(computeDamage(10, "kinetic", 0, status), 10);
});

test("Schaden: ungültige Eingaben erzeugen kein NaN", () => {
  assert.equal(computeDamage(NaN, "kinetic", 0, []), 0);
  assert.equal(computeDamage(-5, "kinetic", 0, []), 0);
  assert.ok(Number.isFinite(computeDamage(10, "kinetic", NaN, [])));
});

test("Türme: alle 10 sind vollständig definiert", () => {
  const ids = Object.keys(TOWERS);
  assert.equal(ids.length, 10, "genau 10 Türme");
  for (const id of ids) {
    const def = TOWERS[id];
    assert.ok(def.name && def.role, `${id}: Name und Rolle`);
    assert.equal(def.specializations.length, 2, `${id}: zwei Spezialisierungen`);
    assert.ok(def.upgrades.length >= 3, `${id}: mindestens 3 Upgrade-Stufen`);
    assert.ok(def.cost > 0, `${id}: Kosten`);
    assert.ok(def.base.attack, `${id}: Angriffsart`);
  }
});

test("Türme: Upgrades und Spezialisierungen verändern Werte wirklich", () => {
  const gunner = TOWERS.gunner;
  const base = resolveTowerStats(gunner, 0, null);
  const upgraded = resolveTowerStats(gunner, 3, null);
  assert.ok(upgraded.damage > base.damage, "Upgrades erhöhen Schaden");

  const minigun = resolveTowerStats(gunner, 3, "minigun");
  const railgun = resolveTowerStats(gunner, 3, "railgun");
  assert.ok(minigun.fireRateMs < railgun.fireRateMs / 5, "Minigun feuert massiv schneller");
  assert.ok(railgun.damage > minigun.damage * 5, "Railgun schlägt massiv härter");
  assert.equal(railgun.damageType, "energy", "Railgun wechselt den Schadenstyp");
  assert.ok(minigun.applies.some((a) => a.kind === "shred"), "Minigun legt Shred an");
});

test("Türme: Spezialisierungen sind mechanisch verschieden, nicht nur Zahlen", () => {
  const frostA = resolveTowerStats(TOWERS.frost, 3, "deepfreeze");
  const frostB = resolveTowerStats(TOWERS.frost, 3, "frostfield");
  assert.ok(frostA.applies.some((a) => a.kind === "stun"), "Tiefenfrost stunt");
  assert.equal(frostB.attack, "cone", "Frostzone trifft flächig");

  const flameB = resolveTowerStats(TOWERS.flamethrower, 3, "detonator");
  assert.ok(flameB.deathExplosionDamage > 0, "Detonator lässt Gegner explodieren");

  const beaconB = resolveTowerStats(TOWERS["support-beacon"], 3, "refinery");
  assert.ok(beaconB.incomePerWave > 0, "Raffinerie erzeugt Einkommen");
});

test("Türme: Verkaufswert und Spezialisierungssperre", () => {
  const def = TOWERS.cannon;
  assert.equal(nextUpgradeCost(def, def.upgrades.length), null, "kein Upgrade mehr auf Maximalstufe");
  assert.equal(canSpecialize(def, 0, null), false, "erst voll ausbauen");
  assert.equal(canSpecialize(def, def.upgrades.length, null), true);
  assert.equal(canSpecialize(def, def.upgrades.length, "cluster"), false, "nur einmal spezialisieren");

  const invested = investedGold(def, 3, "cluster");
  assert.ok(invested > def.cost, "Investition enthält Upgrades");
  assert.ok(sellValue(def, 3, "cluster") < invested, "Verkauf erstattet weniger als investiert");
});

test("Gegner: alle 8 Normalgegner plus Bosse sind definiert", () => {
  const normals = Object.values(ENEMIES).filter((e) => e.cls !== "boss");
  const bosses = Object.values(ENEMIES).filter((e) => e.cls === "boss");
  assert.equal(normals.length, 8, "8 normale/Elite-Gegner");
  assert.ok(bosses.length >= 3, "mindestens 3 Bosse");
  for (const boss of bosses) {
    assert.ok(boss.phases && boss.phases.length > 0, `${boss.id}: hat Phasen`);
  }
});

test("Wave-Director: Budget wächst, keine Monowellen, deterministisch", () => {
  const planA = planWave(7, 1, new Rng(1234));
  const planB = planWave(7, 1, new Rng(1234));
  assert.deepEqual(planA.entries, planB.entries, "gleicher Seed = gleiche Welle");

  const early = planWave(2, 1, new Rng(9));
  const late = planWave(14, 1, new Rng(9));
  const earlyCount = early.entries.reduce((s, e) => s + e.count, 0);
  const lateCount = late.entries.reduce((s, e) => s + e.count, 0);
  assert.ok(lateCount > earlyCount, "spätere Wellen sind größer");
  assert.ok(late.hpMultiplier > early.hpMultiplier, "HP skaliert mit der Welle");

  for (let w = 1; w <= 25; w++) {
    const plan = planWave(w, 2, new Rng(w * 17));
    assert.ok(plan.totalEnemies > 0, `Welle ${w} ist nicht leer`);
    for (const entry of plan.entries) {
      assert.ok(ENEMIES[entry.defId], `Welle ${w}: gültiger Gegnertyp`);
      assert.ok(entry.count > 0 && Number.isFinite(entry.count), `Welle ${w}: sinnvolle Anzahl`);
    }
  }
});

test("Wave-Director: Bosswellen enthalten genau einen Boss", () => {
  assert.equal(isBossWave(5), true);
  assert.equal(isBossWave(4), false);
  const plan = planWave(5, 1, new Rng(5));
  assert.equal(plan.isBoss, true);
  const bossEntries = plan.entries.filter((e) => ENEMIES[e.defId].cls === "boss");
  assert.equal(bossEntries.length, 1);
  assert.equal(bossEntries[0].count, 1);
});

test("Wave-Director: Spawn-Queue enthält alle geplanten Gegner, Boss zuerst", () => {
  const plan = planWave(10, 1, new Rng(77));
  const queue = buildSpawnQueue(plan, new Rng(77));
  assert.equal(queue.length, plan.totalEnemies, "Queue enthält alle Gegner");
  assert.equal(ENEMIES[queue[0]].cls, "boss", "Boss spawnt zuerst");
});

test("Modifikatoren: multiplikativ und additiv korrekt kombiniert", () => {
  const combined = combineModifiers([
    { towerDamageMul: 1.5, towerRangeAdd: 1 },
    { towerDamageMul: 2, towerRangeAdd: 0.5 },
  ]);
  assert.equal(combined.towerDamageMul, 3, "multiplikativ");
  assert.equal(combined.towerRangeAdd, 1.5, "additiv");
  assert.equal(combined.goldPerKillMul, 1, "unberührte Felder bleiben neutral");
});

test("Perks und Commander: Pools sind gültig und wirken", () => {
  for (const commander of Object.values(COMMANDERS)) {
    assert.ok(commander.perkPool.length >= 5, `${commander.id}: ausreichender Perk-Pool`);
    for (const perkId of commander.perkPool) {
      assert.ok(PERKS[perkId], `${commander.id}: Perk ${perkId} existiert`);
    }
    assert.ok(commander.ability.cooldownMs > 0, `${commander.id}: Fähigkeit hat Cooldown`);
    assert.ok(commander.ultimate.cooldownMs > commander.ability.cooldownMs, `${commander.id}: Ultimate lädt länger`);
    assert.ok(Object.keys(commander.passive).length > 0, `${commander.id}: Passive wirkt`);
  }
  for (const perk of Object.values(PERKS)) {
    assert.ok(Object.keys(perk.modifiers).length > 0, `${perk.id}: verändert echte Regeln`);
  }
});

test("Commander-Level: XP-Schwellen steigen monoton", () => {
  let last = -1;
  for (let lvl = 1; lvl <= 10; lvl++) {
    const need = levelForXp(lvl === 1 ? 0 : 100000);
    assert.ok(Number.isFinite(need));
  }
  for (let lvl = 2; lvl <= 10; lvl++) {
    const xp = require("../../shared/dist/index.js").xpForLevel(lvl);
    assert.ok(xp > last, "Schwellen steigen");
    last = xp;
  }
});

test("Sends: Verteidiger bekommt anteilige Belohnung, Spam lohnt nicht", () => {
  for (const def of Object.values(SEND_UNITS)) {
    const reward = defenderReward(def);
    assert.ok(reward >= 1, `${def.id}: Verteidiger bekommt etwas`);
    const totalBack = reward * def.count;
    assert.ok(totalBack < def.cost * 1.1, `${def.id}: Rückfluss übersteigt Kosten nicht`);
  }
  // Billiger Spam gibt anteilig mehr zurück als ein teurer Einzelangriff.
  const rusher = SEND_UNITS.rusher;
  const beast = SEND_UNITS["siege-beast"];
  assert.ok(rusher.defenderRewardRatio > beast.defenderRewardRatio);
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Rng,
  TOWERS,
  ENEMIES,
  createReferenceMap,
  validateEdit,
  validateGrid,
  serializeLaneMap,
  deserializeLaneMap,
  defaultLaneMap,
  findPath,
} = require("../../shared/dist/index.js");
const { PlayerSim } = require("../dist/sim/PlayerSim.js");

function newSim() {
  return new PlayerSim(new Rng(42));
}

/** Lässt die Simulation n ms in 100ms-Schritten laufen. */
function run(sim, ms) {
  const kills = [];
  const leaks = [];
  for (let t = 0; t < ms; t += 100) {
    leaks.push(...sim.moveEnemies(100));
    kills.push(...sim.tickEnemies(100));
    kills.push(...sim.tickTowers(100));
    sim.tickEffects(100);
    sim.tickBuffs(100);
  }
  return { kills, leaks };
}

test("Sim: Gegner laufen die Lane und erreichen den Core", () => {
  const sim = newSim();
  sim.spawnEnemy("grunt");
  const { leaks } = run(sim, 40000);
  assert.ok(leaks.length >= 1, "Gegner erreicht den Core");
  assert.equal(sim.enemies.size, 0, "Gegner wird danach entfernt");
});

test("Sim: Turm tötet Gegner und zahlt Gold", () => {
  const sim = newSim();
  sim.addTower("gunner", 1, 2, "first");
  sim.spawnEnemy("grunt");
  const { kills } = run(sim, 12000);
  assert.ok(kills.length >= 1, "mindestens ein Kill");
  assert.ok(kills[0].gold > 0, "Kill zahlt Gold");
  assert.ok(kills[0].xp > 0, "Kill gibt XP");
});

test("Sim: jeder der 10 Türme richtet tatsächlich Schaden an", () => {
  for (const defId of Object.keys(TOWERS)) {
    const def = TOWERS[defId];
    if (def.base.attack === "aura") continue; // Support hat per Design keinen Schaden

    const sim = newSim();
    // Turm direkt neben den Lane-Anfang setzen und voll ausbauen.
    const tower = sim.addTower(defId, 1, 2, "first");
    tower.level = def.upgrades.length;
    const enemy = sim.spawnEnemy("grunt");
    enemy.hp = 100000;
    enemy.maxHp = 100000;

    run(sim, 6000);
    assert.ok(tower.totalDamage > 0, `${defId}: hat Schaden verursacht (${tower.totalDamage})`);
  }
});

test("Sim: beide Spezialisierungen jedes Turms funktionieren", () => {
  for (const defId of Object.keys(TOWERS)) {
    const def = TOWERS[defId];
    for (const spec of def.specializations) {
      const sim = newSim();
      const tower = sim.addTower(defId, 1, 2, "first");
      tower.level = def.upgrades.length;
      tower.specializationId = spec.id;
      const enemy = sim.spawnEnemy("grunt");
      enemy.hp = 100000;
      enemy.maxHp = 100000;

      run(sim, 6000);
      if (def.base.attack === "aura") {
        // Bake: prüfen, dass die Aura einen Nachbarturm verstärkt.
        const buffed = sim.addTower("gunner", 2, 2, "first");
        const withAura = sim.effectiveStats(buffed);
        const solo = newSim();
        const soloTower = solo.addTower("gunner", 2, 2, "first");
        const without = solo.effectiveStats(soloTower);
        assert.ok(
          withAura.damage > without.damage || withAura.fireRateMs < without.fireRateMs,
          `${defId}/${spec.id}: Aura wirkt`
        );
      } else {
        assert.ok(tower.totalDamage > 0, `${defId}/${spec.id}: verursacht Schaden`);
      }
    }
  }
});

test("Sim: Support-Bake verstärkt Nachbartürme messbar", () => {
  const withBeacon = newSim();
  const gunnerA = withBeacon.addTower("gunner", 1, 2, "first");
  withBeacon.addTower("support-beacon", 2, 2, "first");
  const buffed = withBeacon.effectiveStats(gunnerA);

  const without = newSim();
  const gunnerB = without.addTower("gunner", 1, 2, "first");
  const plain = without.effectiveStats(gunnerB);

  assert.ok(buffed.damage > plain.damage, "Aura erhöht Schaden");
  assert.ok(buffed.fireRateMs < plain.fireRateMs, "Aura erhöht Feuerrate");
});

test("Sim: Teiler zerfällt beim Tod in kleinere Einheiten", () => {
  const sim = newSim();
  const splitter = sim.spawnEnemy("splitter");
  splitter.hp = 1;
  run(sim, 200);
  sim.damageEnemy(splitter, 9999, "kinetic", null, undefined, undefined, []);
  assert.ok(sim.enemies.size >= 3, `Teiler erzeugt Nachkommen (${sim.enemies.size})`);
});

test("Sim: Schildträger gibt Nachbarn Rüstung", () => {
  const sim = newSim();
  const carrier = sim.spawnEnemy("shield-carrier");
  const grunt = sim.spawnEnemy("grunt");
  grunt.x = carrier.x;
  grunt.y = carrier.y;
  sim.tickEnemies(100);
  assert.ok(grunt.statuses.some((s) => s.kind === "shielded"), "Nachbar ist geschützt");
});

test("Sim: Saboteur legt einen Turm lahm", () => {
  const sim = newSim();
  const tower = sim.addTower("gunner", 1, 2, "first");
  const sab = sim.spawnEnemy("saboteur");
  sab.x = 1;
  sab.y = 1;
  sim.tickEnemies(100);
  assert.ok(tower.disabledMs > 0, "Turm ist deaktiviert");

  // Deaktivierte Türme feuern nicht.
  const before = tower.totalDamage;
  sim.tickTowers(100);
  assert.equal(tower.totalDamage, before, "kein Schaden während der Deaktivierung");
});

test("Sim: Phasenflieger ist zyklisch nicht anvisierbar und fliegt Luftlinie", () => {
  const sim = newSim();
  const flyer = sim.spawnEnemy("phase-flyer");
  assert.equal(flyer.flying, true, "fliegt");

  let sawUntargetable = false;
  let sawTargetable = false;
  for (let i = 0; i < 60; i++) {
    sim.tickEnemies(100);
    if (flyer.untargetable) sawUntargetable = true;
    else sawTargetable = true;
  }
  assert.ok(sawUntargetable && sawTargetable, "wechselt zwischen an- und unangreifbar");
});

test("Sim: Boss durchläuft Phasen und ruft Verstärkung", () => {
  const sim = newSim();
  const boss = sim.spawnEnemy("siege-golem");
  const before = sim.enemies.size;

  boss.hp = boss.maxHp * 0.6; // erste Phasenschwelle unterschreiten
  sim.tickEnemies(100);
  assert.ok(boss.bossPhaseIndex >= 0, "Phase wurde ausgelöst");
  assert.ok(boss.bossPhaseName.length > 0, "Phase hat einen Namen");
  assert.ok(sim.enemies.size > before, "Boss hat Adds gerufen");

  boss.hp = boss.maxHp * 0.3;
  sim.tickEnemies(100);
  assert.ok(boss.bossPhaseIndex >= 1, "zweite Phase wurde ausgelöst");
});

test("Sim: Schwarmkönigin regeneriert", () => {
  const sim = newSim();
  const queen = sim.spawnEnemy("hive-queen");
  queen.hp = queen.maxHp * 0.5;
  const before = queen.hp;
  for (let i = 0; i < 20; i++) sim.tickEnemies(100);
  assert.ok(queen.hp > before, "heilt sich");
});

test("Sim: Zielmodi wählen unterschiedliche Gegner", () => {
  const sim = newSim();
  // Bewusst der Gunner: der Sniper hat prefersBig und würde jeden Modus
  // zugunsten von Elite-Zielen übersteuern (siehe eigener Test unten).
  const tower = sim.addTower("gunner", 1, 2, "first");
  tower.level = 3;
  const stats = sim.effectiveStats(tower);
  stats.range = 20; // alle Testgegner in Reichweite

  const weak = sim.spawnEnemy("grunt");
  const strong = sim.spawnEnemy("tank");
  weak.x = 1; weak.y = 1; weak.pathIndex = 5;
  strong.x = 2; strong.y = 1; strong.pathIndex = 1;

  tower.targeting = "strongest";
  assert.equal(sim.pickTarget(tower, stats).id, strong.id, "stärkster");
  tower.targeting = "weakest";
  assert.equal(sim.pickTarget(tower, stats).id, weak.id, "schwächster");
  tower.targeting = "first";
  assert.equal(sim.pickTarget(tower, stats).id, weak.id, "vorderster (höchster pathIndex)");
  tower.targeting = "last";
  assert.equal(sim.pickTarget(tower, stats).id, strong.id, "hinterster");
});

test("Sim: prefersBig-Türme übersteuern den Zielmodus für Elite/Boss", () => {
  const sim = newSim();
  const sniper = sim.addTower("sniper", 1, 2, "first");
  const stats = sim.effectiveStats(sniper);

  const grunt = sim.spawnEnemy("grunt");
  const tank = sim.spawnEnemy("tank");
  grunt.x = 1; grunt.y = 1; grunt.pathIndex = 9;
  tank.x = 2; tank.y = 1; tank.pathIndex = 1;

  // Selbst im Modus "weakest" bevorzugt der Sniper das große Ziel.
  sniper.targeting = "weakest";
  assert.equal(sim.pickTarget(sniper, stats).id, tank.id, "Elite wird bevorzugt");
});

test("Sim: unangreifbare Gegner werden nicht anvisiert", () => {
  const sim = newSim();
  const tower = sim.addTower("gunner", 1, 2, "first");
  const stats = sim.effectiveStats(tower);
  const enemy = sim.spawnEnemy("grunt");
  enemy.x = 1;
  enemy.y = 1;
  assert.ok(sim.pickTarget(tower, stats), "normal anvisierbar");
  enemy.untargetable = true;
  assert.equal(sim.pickTarget(tower, stats), null, "phasend nicht anvisierbar");
});

test("Sim: Effektliste ist gedeckelt (kein unbegrenztes Wachstum)", () => {
  const sim = newSim();
  for (let i = 0; i < 500; i++) sim.addEffect("shot", 0, 0, 1, 1, 0, 5000);
  assert.ok(sim.effects.length <= 100, `Effekte gedeckelt (${sim.effects.length})`);
});

test("Sim: HP bleibt endlich, auch bei absurden Werten", () => {
  const sim = newSim();
  const enemy = sim.spawnEnemy("grunt");
  sim.damageEnemy(enemy, Infinity, "kinetic", null, undefined, undefined, []);
  assert.ok(!Number.isNaN(enemy.hp), "kein NaN");
});

test("Lane-Editor: gültiger Umbau wird akzeptiert", () => {
  const grid = createReferenceMap();
  // Ein Feld neben der Lane zu Lane machen (angrenzend erlaubt).
  const result = validateEdit(grid, { action: "add-lane", x: 0, y: 2 });
  assert.equal(result.valid, true, result.reason);
  assert.ok(result.grid, "liefert neues Grid");
  assert.equal(validateGrid(result.grid).valid, true);
});

test("Lane-Editor: Umbau ohne Anschluss wird abgelehnt", () => {
  const grid = createReferenceMap();
  const result = validateEdit(grid, { action: "add-lane", x: 12, y: 0 });
  assert.equal(result.valid, false, "Insel-Lane ist ungültig");
  assert.match(result.reason, /angrenzen/);
});

test("Lane-Editor: Entfernen, das den Pfad trennt, wird abgelehnt", () => {
  const grid = createReferenceMap();
  // (2,1) liegt mitten auf dem einzigen Weg — Entfernen muss scheitern.
  const result = validateEdit(grid, { action: "remove-lane", x: 2, y: 1 });
  assert.equal(result.valid, false, "Pfadtrennung wird verhindert");
  assert.match(result.reason, /Weg/);
});

test("Lane-Editor: Spawn und Core sind unantastbar", () => {
  const grid = createReferenceMap();
  const spawn = validateEdit(grid, { action: "remove-lane", x: grid.spawn.x, y: grid.spawn.y });
  assert.equal(spawn.valid, false);
  const core = validateEdit(grid, { action: "remove-lane", x: grid.core.x, y: grid.core.y });
  assert.equal(core.valid, false);
});

test("Lane-Editor: Koordinaten außerhalb der Karte werden abgelehnt", () => {
  const grid = createReferenceMap();
  for (const bad of [
    { x: -1, y: 0 },
    { x: 999, y: 0 },
    { x: 0, y: 999 },
    { x: 1.5, y: 2 },
  ]) {
    const result = validateEdit(grid, { action: "add-lane", ...bad });
    assert.equal(result.valid, false, `${JSON.stringify(bad)} abgelehnt`);
  }
});

test("Lane-Map: Serialisierung ist verlustfrei und versioniert", () => {
  const grid = createReferenceMap();
  const data = serializeLaneMap(grid);
  assert.equal(data.version, 1);
  const restored = deserializeLaneMap(data);
  assert.deepEqual(restored.tiles, grid.tiles);
  assert.deepEqual(restored.spawn, grid.spawn);
  assert.deepEqual(restored.core, grid.core);
});

test("Lane-Map: falsche Version und kaputte Daten werden abgelehnt", () => {
  const data = serializeLaneMap(createReferenceMap());
  assert.throws(() => deserializeLaneMap({ ...data, version: 99 }), /Kartenversion/);
  assert.throws(() => deserializeLaneMap({ ...data, rows: ["zu kurz"] }), /Zeilen|Breite/);
  assert.throws(() => deserializeLaneMap(null), /Kartendaten/);
});

test("Lane-Umbau: Simulation baut den Pfad neu und behält Gegner gültig", () => {
  const sim = newSim();
  sim.spawnEnemy("grunt");
  run(sim, 3000);

  const result = validateEdit(sim.grid, { action: "add-lane", x: 0, y: 2 });
  assert.equal(result.valid, true, result.reason);
  sim.grid = result.grid;
  sim.rebuildPath();

  for (const enemy of sim.enemies.values()) {
    assert.ok(enemy.pathIndex >= 0 && enemy.pathIndex < sim.waypoints.length, "Index bleibt gültig");
  }
  // Nach dem Umbau muss die Simulation weiterlaufen können.
  run(sim, 30000);
  assert.ok(true, "kein Absturz nach Umbau");
});

test("Standardkarte hat immer einen gültigen Pfad", () => {
  const grid = defaultLaneMap();
  assert.ok(findPath(grid, grid.spawn, grid.core), "Pfad existiert");
});

test("Sim: volle Welle läuft ohne Softlock zu Ende", () => {
  const sim = newSim();
  // Verteidigung aufbauen, damit nicht alles durchläuft.
  sim.addTower("cannon", 1, 2, "first").level = 3;
  sim.addTower("gunner", 5, 3, "first").level = 3;

  for (const id of Object.keys(ENEMIES)) {
    if (ENEMIES[id].cls === "boss") continue;
    sim.spawnEnemy(id);
  }

  let ticks = 0;
  while (sim.enemies.size > 0 && ticks < 2000) {
    sim.moveEnemies(100);
    sim.tickEnemies(100);
    sim.tickTowers(100);
    sim.tickEffects(100);
    ticks++;
  }
  assert.equal(sim.enemies.size, 0, `Welle endet (nach ${ticks} Ticks)`);
  assert.ok(ticks < 2000, "kein Softlock");
});

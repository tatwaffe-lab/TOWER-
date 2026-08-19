const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GAME_MODES,
  GAME_MODE_IDS,
  gameMode,
  aiProfileFor,
  endlessExtraMultiplier,
  Rng,
  TOWERS,
  SEND_UNITS,
} = require("../../shared/dist/index.js");
const { PlayerSim } = require("../dist/sim/PlayerSim.js");
const { AiPlayer } = require("../dist/sim/AiPlayer.js");

test("Modi: genau drei, jeder mit eigener Charakteristik", () => {
  assert.equal(GAME_MODE_IDS.length, 3, "drei Modi");
  for (const id of GAME_MODE_IDS) {
    const m = GAME_MODES[id];
    assert.ok(m.name && m.description, `${id}: beschriftet`);
    assert.ok(m.maxHumans >= 1, `${id}: mindestens ein Spieler`);
  }
  assert.equal(GAME_MODES.campaign.maxWaves, 30, "Kampagne endet nach 30 Wellen");
  assert.equal(GAME_MODES.endless.maxWaves, 0, "Endlos hat kein Limit");
  assert.equal(GAME_MODES.battle.sendsEnabled, true, "nur im Gefecht gibt es Sends");
  assert.equal(GAME_MODES.campaign.sendsEnabled, false);
  assert.equal(GAME_MODES.endless.sendsEnabled, false);
  assert.ok(GAME_MODES.battle.fillWithAiTo >= 2, "Gefecht füllt mit KI auf");
});

test("Modi: unbekannte Kennung fällt sicher auf die Kampagne zurück", () => {
  assert.equal(gameMode("gibt-es-nicht").id, "campaign");
  assert.equal(gameMode("endless").id, "endless");
});

test("Endlos: Zusatzhärte greift erst ab Welle 30 und wächst dann", () => {
  assert.equal(endlessExtraMultiplier(10), 1, "früh keine Zusatzhärte");
  assert.equal(endlessExtraMultiplier(30), 1, "bei 30 noch neutral");
  const w40 = endlessExtraMultiplier(40);
  const w50 = endlessExtraMultiplier(50);
  assert.ok(w40 > 1.5, `Welle 40 deutlich härter (${w40.toFixed(2)}x)`);
  assert.ok(w50 > w40, "wächst weiter");
});

test("KI-Profile: drei Stufen, monoton stärker", () => {
  const a = aiProfileFor(0);
  const b = aiProfileFor(1);
  const c = aiProfileFor(2);
  assert.ok(a.skill < b.skill && b.skill < c.skill, "Können steigt");
  assert.ok(a.thinkIntervalMs > c.thinkIntervalMs, "stärkere KI reagiert schneller");
  assert.equal(aiProfileFor(3).name, a.name, "Profile wiederholen sich zyklisch");
});

/** Baut einen Kontext für die KI. */
function ctx(sim, over = {}) {
  return {
    sim,
    gold: 1000,
    threat: 100,
    wave: 5,
    sendsEnabled: true,
    hasTarget: true,
    ...over,
  };
}

test("KI: baut Türme auf gültige Bauplätze in Wegnähe", () => {
  const sim = new PlayerSim(new Rng(7));
  const ai = new AiPlayer(aiProfileFor(2), new Rng(11));

  let builds = 0;
  for (let i = 0; i < 40; i++) {
    const d = ai.think(2000, ctx(sim, { sendsEnabled: false }));
    if (d?.kind === "build") {
      // Genau die Prüfung, die auch der Server macht.
      assert.equal(sim.grid.tiles[d.y][d.x], "buildable", "KI baut nur auf Bauflächen");
      assert.ok(!sim.towerAt(d.x, d.y), "KI baut nicht auf besetzte Felder");
      assert.ok(TOWERS[d.defId], "KI wählt einen echten Turm");
      sim.addTower(d.defId, d.x, d.y, "first");
      builds++;
    }
  }
  assert.ok(builds >= 5, `KI hat gebaut (${builds})`);

  // Türme sollen in Wegnähe stehen, nicht in der Kartenecke.
  for (const t of sim.towers.values()) {
    const nearest = Math.min(...sim.waypoints.map((w) => Math.hypot(w.x - t.x, w.y - t.y)));
    assert.ok(nearest <= 3.5, `Turm bei ${t.x},${t.y} deckt den Weg ab (${nearest.toFixed(1)})`);
  }
});

test("KI: wertet auf und spezialisiert, statt nur zu bauen", () => {
  const sim = new PlayerSim(new Rng(3));
  const ai = new AiPlayer(aiProfileFor(2), new Rng(3));
  // Verteidigung vorbauen, damit die KI zum Aufwerten kommt.
  for (let i = 0; i < 16; i++) {
    const d = ai.think(2000, ctx(sim, { sendsEnabled: false, wave: 12 }));
    if (d?.kind === "build") sim.addTower(d.defId, d.x, d.y, "first");
  }

  const kinds = new Set();
  for (let i = 0; i < 80; i++) {
    const d = ai.think(2000, ctx(sim, { sendsEnabled: false, wave: 12 }));
    if (!d) continue;
    kinds.add(d.kind);
    if (d.kind === "upgrade") {
      const t = sim.towers.get(d.towerId);
      if (t) t.level = Math.min(3, t.level + 1);
    }
    if (d.kind === "specialize") {
      const t = sim.towers.get(d.towerId);
      if (t) t.specializationId = d.specializationId;
    }
  }
  assert.ok(kinds.has("upgrade"), "KI wertet auf");
  assert.ok(kinds.has("specialize"), `KI spezialisiert (${[...kinds].join(",")})`);
});

test("KI: sendet nur bezahlbare und freigeschaltete Einheiten", () => {
  const sim = new PlayerSim(new Rng(5));
  const ai = new AiPlayer(aiProfileFor(2), new Rng(5));

  let sends = 0;
  for (let i = 0; i < 60; i++) {
    const d = ai.think(2000, ctx(sim, { threat: 25, wave: 3 }));
    if (d?.kind === "send") {
      const def = SEND_UNITS[d.sendId];
      assert.ok(def, "echte Send-Einheit");
      assert.ok(def.cost <= 25, `bezahlbar (${def.cost} <= 25)`);
      assert.ok(def.minWave <= 3, `freigeschaltet (ab Welle ${def.minWave})`);
      sends++;
    }
  }
  assert.ok(sends > 0, "KI greift an");
});

test("KI: ohne Ziel oder ohne Sends im Modus wird nicht angegriffen", () => {
  const sim = new PlayerSim(new Rng(9));
  const ai = new AiPlayer(aiProfileFor(2), new Rng(9));
  for (let i = 0; i < 40; i++) {
    const d = ai.think(2000, ctx(sim, { hasTarget: false }));
    assert.notEqual(d?.kind, "send", "kein Angriff ohne Ziel");
  }
  const ai2 = new AiPlayer(aiProfileFor(2), new Rng(10));
  for (let i = 0; i < 40; i++) {
    const d = ai2.think(2000, ctx(sim, { sendsEnabled: false }));
    assert.notEqual(d?.kind, "send", "kein Angriff wenn der Modus es verbietet");
  }
});

test("KI: hält ihr Denkintervall ein (keine Aktion pro Tick)", () => {
  const sim = new PlayerSim(new Rng(2));
  const profile = aiProfileFor(0);
  const ai = new AiPlayer(profile, new Rng(2));

  let decisions = 0;
  // 100 Ticks à 100 ms = 10 s. Bei 1800 ms Intervall sind höchstens ~6
  // Entscheidungen möglich.
  for (let i = 0; i < 100; i++) {
    if (ai.think(100, ctx(sim, { sendsEnabled: false }))) decisions++;
  }
  assert.ok(decisions <= 7, `Denkintervall eingehalten (${decisions} Entscheidungen in 10 s)`);
  assert.ok(decisions >= 3, "die KI handelt aber auch wirklich");
});

test("KI: schwächeres Profil handelt seltener als stärkeres", () => {
  const sim = new PlayerSim(new Rng(4));
  const count = (profile) => {
    const ai = new AiPlayer(profile, new Rng(4));
    let n = 0;
    for (let i = 0; i < 200; i++) if (ai.think(100, ctx(sim, { sendsEnabled: false }))) n++;
    return n;
  };
  assert.ok(count(aiProfileFor(2)) > count(aiProfileFor(0)), "stärkere KI ist aktiver");
});

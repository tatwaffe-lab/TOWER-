/**
 * Vollständigkeit der Übersetzungen.
 *
 * Der Sinn: die deutschen Texte stehen in den Datendateien, die englischen in
 * einer eigenen Tabelle. Das ist bequem zu pflegen, verrottet aber lautlos —
 * ein neuer Turm hätte auf Englisch einfach einen deutschen Namen, und
 * niemandem fiele es auf. Dieser Test macht daraus einen harten Fehler.
 *
 * Geprüft wird in beide Richtungen: fehlende Übersetzungen UND verwaiste
 * Einträge, die auf nichts mehr zeigen (etwa nach dem Umbenennen einer ID).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TOWERS,
  ENEMIES,
  COMMANDERS,
  COMMANDER_IDS,
  PERKS,
  SEND_UNITS,
  MAPS,
  GAME_MODES,
  TARGETING_MODES,
  CONTENT_EN,
  UI,
  LANGS,
  germanFor,
  trPath,
  t,
  tr,
  isLang,
  resolveParams,
  isContentPath,
  resolveTowerStats,
  MAP_DIFFICULTY_ORDER,
} = require("../../shared/dist/index.js");

/** Alle Pfade, die es geben MUSS. */
function erwartetePfade() {
  const pfade = [];

  for (const def of Object.values(TOWERS)) {
    pfade.push(`tower.${def.id}.name`, `tower.${def.id}.role`);
    for (const spec of def.specializations) {
      pfade.push(`tower.${def.id}.spec.${spec.id}.name`, `tower.${def.id}.spec.${spec.id}.desc`);
    }
  }
  for (const def of Object.values(ENEMIES)) pfade.push(`enemy.${def.id}.name`);
  for (const id of COMMANDER_IDS) {
    pfade.push(
      `cmd.${id}.name`,
      `cmd.${id}.tagline`,
      `cmd.${id}.passive`,
      `cmd.${id}.ab.name`,
      `cmd.${id}.ab.desc`,
      `cmd.${id}.ult.name`,
      `cmd.${id}.ult.desc`
    );
  }
  for (const def of Object.values(PERKS)) pfade.push(`perk.${def.id}.name`, `perk.${def.id}.desc`);
  for (const def of Object.values(SEND_UNITS)) pfade.push(`send.${def.id}.name`, `send.${def.id}.desc`);
  for (const m of MAPS) pfade.push(`map.${m.id}.name`, `map.${m.id}.desc`);
  for (const m of Object.values(GAME_MODES)) {
    pfade.push(`mode.${m.id}.name`, `mode.${m.id}.tagline`, `mode.${m.id}.desc`);
  }
  for (const mode of TARGETING_MODES) pfade.push(`targeting.${mode}`);
  for (const stufe of MAP_DIFFICULTY_ORDER) pfade.push(`difficulty.${stufe}`);

  return pfade;
}

test("i18n: jeder Inhalt hat eine englische Entsprechung", () => {
  const fehlend = erwartetePfade().filter((pfad) => !(pfad in CONTENT_EN));
  assert.deepEqual(fehlend, [], `ohne englische Übersetzung: ${fehlend.join(", ")}`);
});

test("i18n: keine verwaisten englischen Einträge", () => {
  const erwartet = new Set(erwartetePfade());
  // KI-Profilnamen tragen ihren Text im Pfad und sind hier zulässig.
  const verwaist = Object.keys(CONTENT_EN).filter(
    (pfad) => !erwartet.has(pfad) && !pfad.startsWith("ai.")
  );
  assert.deepEqual(verwaist, [], `zeigen auf nichts: ${verwaist.join(", ")}`);
});

test("i18n: jeder Pfad lässt sich in beide Sprachen auflösen", () => {
  for (const pfad of erwartetePfade()) {
    const de = trPath(pfad, "de");
    const en = trPath(pfad, "en");
    assert.ok(de && de !== pfad, `${pfad}: kein deutscher Text`);
    assert.ok(en && en !== pfad, `${pfad}: kein englischer Text`);
    assert.notEqual(germanFor(pfad), null, `${pfad}: Resolver kennt den Pfad nicht`);
  }
});

test("i18n: jeder UI-Schlüssel hat beide Sprachen und dieselben Platzhalter", () => {
  for (const [key, eintrag] of Object.entries(UI)) {
    for (const lang of LANGS) {
      assert.ok(
        typeof eintrag[lang] === "string" && eintrag[lang].length > 0,
        `${key}: fehlt in "${lang}"`
      );
    }
    // Abweichende Platzhalter sind der klassische Übersetzungsfehler: der
    // Satz sieht richtig aus, aber eine Zahl fehlt oder bleibt als {n} stehen.
    const platzhalter = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    assert.equal(
      platzhalter(eintrag.de),
      platzhalter(eintrag.en),
      `${key}: unterschiedliche Platzhalter (de "${platzhalter(eintrag.de)}" vs en "${platzhalter(eintrag.en)}")`
    );
  }
});

test("i18n: Schadenstypen und Statuseffekte sind übersetzt", () => {
  const typen = new Set();
  const status = new Set();
  for (const def of Object.values(TOWERS)) {
    for (let lvl = 0; lvl <= def.upgrades.length; lvl++) {
      for (const spec of [null, ...def.specializations.map((s) => s.id)]) {
        const stats = resolveTowerStats(def, lvl, spec);
        typen.add(stats.damageType);
        for (const a of stats.applies ?? []) status.add(a.kind);
      }
    }
  }
  for (const typ of typen) assert.ok(UI[`dmg.${typ}`], `Schadenstyp "${typ}" nicht übersetzt`);
  for (const kind of status) assert.ok(UI[`status.${kind}`], `Status "${kind}" nicht übersetzt`);
});

test("i18n: Platzhalter werden eingesetzt, Unbekanntes bleibt sichtbar", () => {
  assert.equal(t("notice.notEnoughGold", "de", { cost: 42 }), "Nicht genug Gold (42 nötig).");
  assert.equal(t("notice.notEnoughGold", "en", { cost: 42 }), "Not enough gold (42 needed).");
  // Fehlender Schlüssel gibt den Schlüssel zurück — sichtbar falsch statt leer.
  assert.equal(t("gibt.es.nicht", "de"), "gibt.es.nicht");
  // Fehlender Parameter lässt den Platzhalter stehen, statt "undefined".
  assert.ok(t("notice.notEnoughGold", "de").includes("{cost}"));
});

test("i18n: Inhaltspfade in Meldungsparametern werden mitübersetzt", () => {
  const params = { unit: "send.rusher.name", target: "Bob" };
  assert.equal(t("notice.sendLaunched", "de", resolveParams(params, "de")), "Stürmer an Bob geschickt.");
  assert.equal(t("notice.sendLaunched", "en", resolveParams(params, "en")), "Rusher sent to Bob.");

  // Spielernamen dürfen nicht versehentlich als Pfad gelten.
  assert.ok(!isContentPath("Bob"));
  assert.ok(!isContentPath("tower.gibtesnicht.name"));
  assert.ok(isContentPath("tower.gunner.name"));
});

test("i18n: Sprachkennungen werden geprüft, nicht geraten", () => {
  assert.ok(isLang("de") && isLang("en"));
  for (const müll of ["fr", "", null, undefined, 42, "DE", {}]) {
    assert.ok(!isLang(müll), `"${müll}" darf keine Sprache sein`);
  }
  // Unbekannte Sprache fällt auf den deutschen Originaltext zurück.
  assert.equal(tr("tower.gunner.name", "de", "Gunner"), "Gunner");
});

test("i18n: jeder Schlüssel, den der Server sendet, existiert auch", () => {
  // Am Quelltext geprüft, nicht an einer gepflegten Liste: eine Liste würde
  // dieselbe Drift erlauben, gegen die dieser Test schützen soll.
  const fs = require("node:fs");
  const path = require("node:path");
  const quelle = fs.readFileSync(
    path.join(__dirname, "..", "src", "rooms", "MatchRoom.ts"),
    "utf8"
  );

  const gesendet = new Set();
  for (const m of quelle.matchAll(/"((?:notice|lane|result\.reason)\.[A-Za-z]+)"/g)) {
    gesendet.add(m[1]);
  }

  assert.ok(gesendet.size >= 25, `zu wenige Schlüssel gefunden (${gesendet.size}) — Regex kaputt?`);

  const unbekannt = [...gesendet].filter((k) => !UI[k]);
  assert.deepEqual(unbekannt, [], `Server sendet unbekannte Schlüssel: ${unbekannt.join(", ")}`);
});

test("i18n: der Server verschickt keine fertigen deutschen Sätze mehr", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const quelle = fs.readFileSync(
    path.join(__dirname, "..", "src", "rooms", "MatchRoom.ts"),
    "utf8"
  );

  // Ein notify-Aufruf mit einem Literal, das kein Schlüssel ist, wäre ein
  // Rückfall: der Text käme dann in einer festen Sprache beim Spieler an.
  const verdaechtig = [];
  for (const m of quelle.matchAll(/notify\??\.?\(([^)]*)/g)) {
    const args = m[1];
    for (const lit of args.matchAll(/"([^"]{4,})"/g)) {
      const wert = lit[1];
      if (wert === "info" || wert === "warn" || wert === "error") continue;
      if (/^(notice|lane|result)\./.test(wert)) continue;
      verdaechtig.push(wert);
    }
  }
  assert.deepEqual(verdaechtig, [], `fest verdrahtete Texte: ${verdaechtig.join(" | ")}`);
});

/**
 * Prüft jede Karte gegen die Regeln, die sie einhalten muss.
 *
 * Der wichtigste Punkt ist Nummer 4: Gegner laufen per BFS. Berühren sich
 * zwei nicht aufeinanderfolgende Wegfelder orthogonal, nimmt die BFS die
 * Abkürzung — die gezeichnete Schleife wird dann nie betreten und die Karte
 * spielt sich völlig anders als gedacht. Das lässt sich nicht per Augenmaß
 * ausschließen, also wird es gerechnet.
 *
 * Aufruf: npm run maps
 */
const {
  MAPS,
  createMap,
  expandPath,
  findPath,
  mapPathLength,
  mapBuildableCount,
} = require("../../shared/dist/index.js");

let fehler = 0;
function pruefe(bedingung, text) {
  if (!bedingung) {
    console.log(`    FEHLER: ${text}`);
    fehler++;
  }
  return bedingung;
}

console.log("=".repeat(78));
console.log("KARTENPRÜFUNG");
console.log("=".repeat(78));

const zeilen = [];

for (const def of MAPS) {
  console.log(`\n${def.name}  (${def.id}, ${def.difficulty})`);

  const path = expandPath(def);
  const grid = createMap(def.id);

  // 1. Jedes Feld liegt im Gitter.
  const drin = path.every(
    (c) => c.x >= 0 && c.y >= 0 && c.x < grid.config.width && c.y < grid.config.height
  );
  pruefe(drin, "Weg verlässt das Gitter");

  // 2. Aufeinanderfolgende Felder sind orthogonal benachbart.
  let zusammenhaengend = true;
  for (let i = 1; i < path.length; i++) {
    const d = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    if (d !== 1) zusammenhaengend = false;
  }
  pruefe(zusammenhaengend, "Weg ist unterbrochen");

  // 3. Kein Feld doppelt.
  const schluessel = path.map((c) => `${c.x},${c.y}`);
  pruefe(new Set(schluessel).size === path.length, "Weg kreuzt sich selbst");

  // 4. Keine Abkürzung: die BFS muss exakt so lang laufen wie gezeichnet.
  const bfs = findPath(grid, grid.spawn, grid.core);
  pruefe(bfs !== null, "Core ist nicht erreichbar");
  if (bfs) {
    const abgekuerzt = bfs.length !== path.length;
    pruefe(
      !abgekuerzt,
      `BFS kürzt ab: gezeichnet ${path.length} Felder, gelaufen ${bfs.length}. ` +
        `Zwei Wegabschnitte liegen direkt nebeneinander.`
    );
  }

  // 5. Genug Bauplatz, um überhaupt spielen zu können.
  const bau = mapBuildableCount(def.id);
  pruefe(bau >= 25, `nur ${bau} Bauplätze — zu wenig zum Spielen`);

  // 6. Spawn und Core sind gesetzt.
  pruefe(grid.tiles[grid.spawn.y][grid.spawn.x] === "spawn", "Spawn fehlt");
  pruefe(grid.tiles[grid.core.y][grid.core.x] === "core", "Core fehlt");

  const laenge = mapPathLength(def.id);
  console.log(`    Weg ${String(laenge).padStart(3)} Felder   Bauplätze ${String(bau).padStart(3)}   ` +
    `Core (${grid.core.x},${grid.core.y})`);
  zeilen.push({ id: def.id, name: def.name, difficulty: def.difficulty, laenge, bau });
}

// -------------------------------------------------- Übersicht und Plausibilität
console.log("\n" + "=".repeat(78));
console.log("ÜBERSICHT — Bauplatz ist der Schwierigkeitsregler, Weglänge der Charakter");
console.log("=".repeat(78));
console.log("Karte".padEnd(18), "Stufe".padEnd(8), "Weg".padStart(5), "Bauplätze".padStart(11));
for (const z of [...zeilen].sort((a, b) => b.laenge - a.laenge)) {
  console.log(z.name.padEnd(18), z.difficulty.padEnd(8), String(z.laenge).padStart(5), String(z.bau).padStart(11));
}

// Die Schwierigkeitsstufen müssen sich in den Zahlen wiederfinden, sonst ist
// die Einordnung im Menü eine Behauptung.
//
// Geprüft wird der Bauplatz, nicht die Weglänge. Die Messung in
// `npm run balance` hat gezeigt, dass Türme gleichmäßig am Weg verteilt
// jedem Gegner etwa dieselbe Feuerberührung geben — unabhängig davon, wie
// lang der Weg ist. Entscheidend ist, wie viele Türme überhaupt Platz haben.
const mittelBau = (stufe) => {
  const g = zeilen.filter((z) => z.difficulty === stufe);
  return g.reduce((s, z) => s + z.bau, 0) / g.length;
};
const leichtBau = mittelBau("leicht");
const mittelStufeBau = mittelBau("mittel");
const schwerBau = mittelBau("schwer");
console.log(
  `\nDurchschnittlicher Bauplatz:  leicht ${leichtBau.toFixed(0)}  ` +
    `mittel ${mittelStufeBau.toFixed(0)}  schwer ${schwerBau.toFixed(0)}`
);
pruefe(schwerBau < mittelStufeBau, "schwere Karten haben nicht weniger Bauplatz als mittlere");
pruefe(schwerBau < leichtBau, "schwere Karten haben nicht weniger Bauplatz als leichte");

// Und zwar deutlich: die engste leichte Karte muss mehr Platz bieten als die
// großzügigste schwere, sonst überlappen die Stufen und die Angabe im Menü
// hilft niemandem bei der Auswahl.
const engsteLeichte = Math.min(...zeilen.filter((z) => z.difficulty === "leicht").map((z) => z.bau));
const weitesteSchwere = Math.max(...zeilen.filter((z) => z.difficulty === "schwer").map((z) => z.bau));
pruefe(
  engsteLeichte > weitesteSchwere,
  `Stufen überlappen: engste leichte Karte ${engsteLeichte}, weiteste schwere ${weitesteSchwere}`
);

// Es muss sowohl sehr kurze als auch sehr lange Wege geben, sonst spielen
// sich alle acht Karten gleich an.
const laengen = zeilen.map((z) => z.laenge);
pruefe(Math.min(...laengen) < 30, "keine wirklich kurze Karte vorhanden");
pruefe(Math.max(...laengen) > 48, "keine wirklich lange Karte vorhanden");

console.log("\n" + "=".repeat(78));
if (fehler === 0) {
  console.log(`ALLE ${MAPS.length} KARTEN BESTANDEN`);
} else {
  console.log(`${fehler} FEHLER`);
  process.exit(1);
}

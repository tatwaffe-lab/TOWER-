import { GridConfig, GridCoord, LaneGrid, TileKind } from "./gridTypes";
import { GRID_HEIGHT, GRID_TILE_SIZE, GRID_WIDTH, recomputeBuildableTiles } from "./laneGrid";

/**
 * Die 8 Karten.
 *
 * Zwei Regeln, die jede Karte einhalten muss, sonst spielt sie sich falsch:
 *
 * 1. **Keine Abkürzungen.** Gegner laufen per BFS den kürzesten Weg. Berühren
 *    sich zwei nicht benachbarte Wegabschnitte orthogonal, schneidet die BFS
 *    die Schleife ab und der halbe Weg wird nie betreten. Parallele Gänge
 *    brauchen deshalb mindestens ein freies Feld Abstand.
 * 2. **Schwierigkeit kommt aus dem Bauplatz, nicht aus der Weglänge.**
 *    Das war eine Korrektur nach der Messung: Türme gleichmäßig am Weg
 *    verteilt geben jedem Gegner ungefähr dieselbe Feuerberührung, egal wie
 *    lang der Weg ist. Was wirklich zählt, ist wie viele Türme überhaupt
 *    Platz finden — `Blitzschneise` hat 45 Bauplätze, `Weite Ebene` 105.
 *    Die Weglänge wirkt erst als zweiter Faktor, weil ein langer Weg mehrere
 *    getrennte Killzonen erlaubt.
 *
 * Beides wird nicht behauptet, sondern gemessen: `npm run maps` läuft die
 * BFS über jede Karte und vergleicht sie mit dem gezeichneten Weg, und
 * `npm run balance` spielt auf jeder Karte mit gleichem Goldbudget echte
 * Wellen durch.
 */

export type MapDifficulty = "leicht" | "mittel" | "schwer";

export interface MapDefinition {
  id: string;
  name: string;
  difficulty: MapDifficulty;
  description: string;
  /** Startfeld. */
  start: GridCoord;
  /** Eckpunkte. Zwischen zwei Punkten wird gerade gezogen (nur waagerecht/senkrecht). */
  waypoints: GridCoord[];
}

export const MAP_DIFFICULTY_ORDER: MapDifficulty[] = ["leicht", "mittel", "schwer"];

export const MAPS: MapDefinition[] = [
  // ------------------------------------------------------------- leicht
  {
    id: "weite-ebene",
    name: "Weite Ebene",
    difficulty: "leicht",
    description:
      "Drei lange Geraden mit viel Platz drumherum. Der längste Weg im Spiel und die meisten Bauplätze — hier darf man Fehler machen.",
    start: { x: 0, y: 1 },
    waypoints: [
      { x: 16, y: 1 },
      { x: 16, y: 5 },
      { x: 3, y: 5 },
      { x: 3, y: 9 },
      { x: 16, y: 9 },
    ],
  },
  {
    id: "doppelschleife",
    name: "Doppelschleife",
    difficulty: "leicht",
    description:
      "Zwei übereinanderliegende Schleifen. Ein einziger gut gesetzter Turmblock in der Mitte deckt drei Gänge gleichzeitig ab.",
    start: { x: 0, y: 1 },
    waypoints: [
      { x: 15, y: 1 },
      { x: 15, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 7 },
      { x: 8, y: 7 },
    ],
  },

  // ------------------------------------------------------------- mittel
  {
    id: "maeander",
    name: "Mäander",
    difficulty: "mittel",
    description:
      "Die Standardkarte. Eine frühe Kammer, ein langer Mittelgang, ein Endabschnitt vor dem Core — drei getrennte Verteidigungszonen.",
    start: { x: 0, y: 1 },
    waypoints: [
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 9, y: 4 },
      { x: 9, y: 8 },
      { x: 3, y: 8 },
      { x: 3, y: 10 },
      { x: 16, y: 10 },
      { x: 16, y: 6 },
      { x: 17, y: 6 },
    ],
  },
  {
    id: "zickzack",
    name: "Zickzack",
    difficulty: "mittel",
    description:
      "Vier senkrechte Gänge im Wechsel. Türme zwischen zwei Gängen feuern auf beide — wer richtig setzt, verdoppelt seine Wirkung.",
    start: { x: 0, y: 1 },
    waypoints: [
      { x: 2, y: 1 },
      { x: 2, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 10 },
      { x: 14, y: 10 },
      { x: 14, y: 5 },
    ],
  },
  {
    id: "kesselgang",
    name: "Kesselgang",
    difficulty: "mittel",
    description:
      "Enge Kessel mit scharfen Kehren. Flächenschaden an den Wendepunkten trifft die ganze Kolonne auf einmal.",
    start: { x: 0, y: 10 },
    waypoints: [
      { x: 4, y: 10 },
      { x: 4, y: 2 },
      { x: 9, y: 2 },
      { x: 9, y: 8 },
      { x: 13, y: 8 },
      { x: 13, y: 2 },
      { x: 17, y: 2 },
      { x: 17, y: 6 },
    ],
  },

  // ------------------------------------------------------------- schwer
  {
    id: "randlauf",
    name: "Randlauf",
    difficulty: "schwer",
    description:
      "Der Weg klebt an der Außenwand. Lang, aber jeder Turm feuert nur nach einer Seite — die halbe Reichweite verpufft ins Nichts.",
    start: { x: 0, y: 0 },
    waypoints: [
      { x: 19, y: 0 },
      { x: 19, y: 11 },
      { x: 1, y: 11 },
      { x: 1, y: 7 },
    ],
  },
  {
    id: "enge-gasse",
    name: "Enge Gasse",
    difficulty: "schwer",
    description:
      "Ein kurzer Sprint am unteren Rand entlang und dann hoch zum Core. Kaum Zeit, kaum Platz, kein zweiter Versuch.",
    start: { x: 0, y: 10 },
    waypoints: [
      { x: 14, y: 10 },
      { x: 14, y: 4 },
      { x: 17, y: 4 },
    ],
  },
  {
    id: "blitzschneise",
    name: "Blitzschneise",
    difficulty: "schwer",
    description:
      "Der kürzeste Weg im Spiel: 21 Felder vom Tor bis zum Core. Platz ist reichlich da — Zeit überhaupt nicht.",
    start: { x: 0, y: 6 },
    waypoints: [
      { x: 10, y: 6 },
      { x: 10, y: 3 },
      { x: 17, y: 3 },
    ],
  },
];

export const MAP_IDS = MAPS.map((m) => m.id);
export const DEFAULT_MAP_ID = "maeander";

export function mapDefinition(id: string): MapDefinition {
  return MAPS.find((m) => m.id === id) ?? MAPS.find((m) => m.id === DEFAULT_MAP_ID)!;
}

export function isMapId(id: string): boolean {
  return MAPS.some((m) => m.id === id);
}

/**
 * Zieht den Weg aus den Eckpunkten aus. Wirft bei diagonalen Segmenten —
 * das wäre ein Autorenfehler, kein Laufzeitfall.
 */
export function expandPath(def: MapDefinition): GridCoord[] {
  const path: GridCoord[] = [{ ...def.start }];
  let cur = def.start;
  for (const wp of def.waypoints) {
    const dx = Math.sign(wp.x - cur.x);
    const dy = Math.sign(wp.y - cur.y);
    if (dx !== 0 && dy !== 0) {
      throw new Error(`Karte ${def.id}: diagonales Segment nach (${wp.x},${wp.y})`);
    }
    while (cur.x !== wp.x || cur.y !== wp.y) {
      cur = { x: cur.x + dx, y: cur.y + dy };
      path.push(cur);
    }
  }
  return path;
}

/** Baut das fertige Gitter einer Karte. */
export function createMap(id: string): LaneGrid {
  const def = mapDefinition(id);
  const config: GridConfig = { width: GRID_WIDTH, height: GRID_HEIGHT, tileSize: GRID_TILE_SIZE };
  const tiles: TileKind[][] = Array.from({ length: config.height }, () =>
    Array.from({ length: config.width }, () => "empty" as TileKind)
  );

  const path = expandPath(def);
  for (const { x, y } of path) tiles[y][x] = "lane";

  const spawn = path[0];
  const core = path[path.length - 1];
  tiles[spawn.y][spawn.x] = "spawn";
  tiles[core.y][core.x] = "core";

  recomputeBuildableTiles(tiles, config);

  return { config, tiles, spawn, core };
}

/** Weglänge in Feldern — grob die Sekunden, die ein Standardgegner braucht. */
export function mapPathLength(id: string): number {
  return expandPath(mapDefinition(id)).length;
}

/** Wie viele Felder bebaubar sind. */
export function mapBuildableCount(id: string): number {
  const grid = createMap(id);
  let n = 0;
  for (const row of grid.tiles) for (const t of row) if (t === "buildable") n++;
  return n;
}

export function mapsByDifficulty(difficulty: MapDifficulty): MapDefinition[] {
  return MAPS.filter((m) => m.difficulty === difficulty);
}

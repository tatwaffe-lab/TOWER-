import { GridConfig, GridCoord, LaneGrid, TileKind } from "./gridTypes";

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 12;
export const GRID_TILE_SIZE = 64;

/**
 * Referenzkarte: 20x12 Felder, mäanderförmiger Weg vom Spawn links zum Core.
 *
 * Bewusst breit statt quadratisch, damit die Karte auf einem Breitbildschirm
 * den Platz nutzt. Der Core sitzt NICHT am rechten Rand, sondern eine Spalte
 * davor und mittig — sonst verdeckt die Seitenleiste die eigene Basis.
 *
 * Der Weg ist lang genug, dass mehrere Verteidigungszonen entstehen: eine
 * frühe Kammer, ein langer Mittelgang und ein Endabschnitt vor dem Core.
 */
export function createReferenceMap(): LaneGrid {
  const config: GridConfig = { width: GRID_WIDTH, height: GRID_HEIGHT, tileSize: GRID_TILE_SIZE };
  const tiles: TileKind[][] = Array.from({ length: config.height }, () =>
    Array.from({ length: config.width }, () => "empty" as TileKind)
  );

  const path: GridCoord[] = [];
  const add = (x: number, y: number) => path.push({ x, y });

  // Eintritt links oben
  for (let x = 0; x <= 4; x++) add(x, 1);
  // Runter in die erste Kammer
  for (let y = 2; y <= 4; y++) add(4, y);
  // Nach rechts durch die Kammer
  for (let x = 5; x <= 9; x++) add(9 - (9 - x), 4);
  // Runter
  for (let y = 5; y <= 8; y++) add(9, y);
  // Nach links (Schleife zurück, erzeugt eine zweite Kammer)
  for (let x = 8; x >= 3; x--) add(x, 8);
  // Runter zum unteren Gang
  for (let y = 9; y <= 10; y++) add(3, y);
  // Langer Weg nach rechts
  for (let x = 4; x <= 16; x++) add(x, 10);
  // Hoch zum Core
  for (let y = 9; y >= 6; y--) add(16, y);
  // Kurzes Stück nach rechts auf den Core
  add(17, 6);

  for (const { x, y } of path) tiles[y][x] = "lane";

  const spawn = path[0];
  const core = path[path.length - 1];
  tiles[spawn.y][spawn.x] = "spawn";
  tiles[core.y][core.x] = "core";

  recomputeBuildableTiles(tiles, config);

  return { config, tiles, spawn, core };
}

/**
 * Baubare Felder sind alle freien Felder, die an den Weg grenzen — inklusive
 * Diagonalen. Dadurch entstehen breitere Bauzonen und echte Entscheidungen,
 * wo eine Killzone entsteht.
 */
export function recomputeBuildableTiles(tiles: TileKind[][], config: GridConfig): void {
  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const tile = tiles[y][x];
      if (tile !== "lane" && tile !== "spawn" && tile !== "core") continue;
      for (const [dx, dy] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;
        if (tiles[ny][nx] === "empty") tiles[ny][nx] = "buildable";
      }
    }
  }
}

export function tileAt(grid: LaneGrid, coord: GridCoord): TileKind | undefined {
  return grid.tiles[coord.y]?.[coord.x];
}

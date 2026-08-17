import { GridConfig, GridCoord, LaneGrid, TileKind } from "./gridTypes";

/**
 * Builds the Phase 1 reference map: a single fixed S-shaped lane from a
 * spawn portal to the core, on a small grid. This is intentionally simple —
 * Lane Editing (Master Prompt §14) is a Phase 4 system. What matters here is
 * that the grid/pathfinding data model is already the one later phases will
 * extend (buildable tiles beside the lane, spawn/core anchors, etc.).
 *
 * Lives in @td/shared (not server-only) so the client can render the same
 * map without a network round trip, and so a future lane editor can run the
 * identical pathfinding for its live preview (see pathfinder.ts).
 */
export function createReferenceMap(): LaneGrid {
  const config: GridConfig = { width: 14, height: 10, tileSize: 48 };
  const tiles: TileKind[][] = Array.from({ length: config.height }, () =>
    Array.from({ length: config.width }, () => "empty" as TileKind)
  );

  const path: GridCoord[] = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 2 },
    { x: 4, y: 3 },
    { x: 4, y: 4 },
    { x: 5, y: 4 },
    { x: 6, y: 4 },
    { x: 7, y: 4 },
    { x: 7, y: 5 },
    { x: 7, y: 6 },
    { x: 7, y: 7 },
    { x: 8, y: 7 },
    { x: 9, y: 7 },
    { x: 10, y: 7 },
    { x: 11, y: 7 },
    { x: 12, y: 7 },
    { x: 13, y: 7 },
  ];

  for (const { x, y } of path) {
    tiles[y][x] = "lane";
  }

  const spawn = path[0];
  const core = path[path.length - 1];
  tiles[spawn.y][spawn.x] = "spawn";
  tiles[core.y][core.x] = "core";

  // Mark tiles adjacent to the lane as buildable (tower placement).
  for (const { x, y } of path) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;
      if (tiles[ny][nx] === "empty") tiles[ny][nx] = "buildable";
    }
  }

  return { config, tiles, spawn, core };
}

export function tileAt(grid: LaneGrid, coord: GridCoord): TileKind | undefined {
  return grid.tiles[coord.y]?.[coord.x];
}

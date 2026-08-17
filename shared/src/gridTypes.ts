export type TileKind = "empty" | "lane" | "spawn" | "core" | "buildable";

export interface GridCoord {
  x: number;
  y: number;
}

export interface GridConfig {
  width: number;
  height: number;
  tileSize: number;
}

/** Serializable 2D lane grid. `tiles[y][x]` gives the tile kind. */
export interface LaneGrid {
  config: GridConfig;
  tiles: TileKind[][];
  spawn: GridCoord;
  core: GridCoord;
}

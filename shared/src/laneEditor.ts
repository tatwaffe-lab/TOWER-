import { GridCoord, LaneGrid, TileKind } from "./gridTypes";
import { createReferenceMap, recomputeBuildableTiles } from "./laneGrid";
import { findPath } from "./pathfinder";

/**
 * Lane-Editing (Master Prompt §14).
 *
 * Zentrale Regel: eine Bearbeitung wird nur übernommen, wenn danach immer noch
 * ein vollständiger Pfad Spawn -> Core existiert. Diese Prüfung nutzt exakt
 * dieselbe BFS aus `pathfinder.ts` wie die Gegnerbewegung — es gibt keine
 * zweite, widersprüchliche Pfadregel.
 *
 * Der Client darf `validateEdit` für seine Live-Vorschau aufrufen, aber der
 * Server ruft sie vor jeder Übernahme erneut auf und ist die einzige
 * Wahrheit. Eine Client-Vorschau ohne Servernachprüfung wäre manipulierbar.
 */

export const LANE_MAP_VERSION = 1;

export interface SerializedLaneMap {
  version: number;
  width: number;
  height: number;
  tileSize: number;
  spawn: GridCoord;
  core: GridCoord;
  /** Zeilenweise, ein Zeichen pro Feld. */
  rows: string[];
}

const TILE_CHAR: Record<TileKind, string> = {
  empty: ".",
  lane: "#",
  spawn: "S",
  core: "C",
  buildable: "+",
};

const CHAR_TILE: Record<string, TileKind> = {
  ".": "empty",
  "#": "lane",
  S: "spawn",
  C: "core",
  "+": "buildable",
};

export function serializeLaneMap(grid: LaneGrid): SerializedLaneMap {
  return {
    version: LANE_MAP_VERSION,
    width: grid.config.width,
    height: grid.config.height,
    tileSize: grid.config.tileSize,
    spawn: { ...grid.spawn },
    core: { ...grid.core },
    rows: grid.tiles.map((row) => row.map((t) => TILE_CHAR[t]).join("")),
  };
}

export class LaneMapError extends Error {}

export function deserializeLaneMap(data: SerializedLaneMap): LaneGrid {
  if (!data || typeof data !== "object") throw new LaneMapError("Kartendaten fehlen");
  if (data.version !== LANE_MAP_VERSION) {
    throw new LaneMapError(`Kartenversion ${data.version} wird nicht unterstützt (erwartet ${LANE_MAP_VERSION})`);
  }
  if (!Array.isArray(data.rows) || data.rows.length !== data.height) {
    throw new LaneMapError("Zeilenzahl passt nicht zur Höhe");
  }

  const tiles: TileKind[][] = data.rows.map((row, y) => {
    if (typeof row !== "string" || row.length !== data.width) {
      throw new LaneMapError(`Zeile ${y} hat die falsche Breite`);
    }
    return [...row].map((ch, x) => {
      const tile = CHAR_TILE[ch];
      if (!tile) throw new LaneMapError(`Unbekanntes Feldzeichen "${ch}" bei ${x},${y}`);
      return tile;
    });
  });

  const grid: LaneGrid = {
    config: { width: data.width, height: data.height, tileSize: data.tileSize },
    tiles,
    spawn: data.spawn,
    core: data.core,
  };

  const check = validateGrid(grid);
  if (!check.valid) throw new LaneMapError(check.reason ?? "Karte ungültig");
  return grid;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  /** Länge des Pfades in Feldern, wenn gültig. */
  pathLength?: number;
}

/** Prüft eine komplette Karte auf Bespielbarkeit. */
export function validateGrid(grid: LaneGrid): ValidationResult {
  const spawnTile = grid.tiles[grid.spawn.y]?.[grid.spawn.x];
  const coreTile = grid.tiles[grid.core.y]?.[grid.core.x];
  if (spawnTile !== "spawn") return { valid: false, reason: "Spawn-Feld fehlt oder wurde überschrieben" };
  if (coreTile !== "core") return { valid: false, reason: "Core-Feld fehlt oder wurde überschrieben" };

  const path = findPath(grid, grid.spawn, grid.core);
  if (!path) return { valid: false, reason: "Kein durchgehender Weg vom Spawn zum Core" };
  return { valid: true, pathLength: path.length };
}

export type EditAction = "add-lane" | "remove-lane";

export interface EditRequest {
  action: EditAction;
  x: number;
  y: number;
}

/** Kosten eines Lane-Umbaus in Gold, bevor Modifikatoren angewandt werden. */
export const LANE_EDIT_BASE_COST = 25;

/**
 * Prüft eine einzelne Bearbeitung, ohne das Original zu verändern.
 * Liefert bei Erfolg das neue Grid zurück, damit der Aufrufer es übernehmen
 * kann — der Server verwirft es bei ungültigem Ergebnis einfach.
 */
export function validateEdit(grid: LaneGrid, edit: EditRequest): ValidationResult & { grid?: LaneGrid } {
  const { x, y, action } = edit;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { valid: false, reason: "Ungültige Koordinate" };
  if (x < 0 || y < 0 || x >= grid.config.width || y >= grid.config.height) {
    return { valid: false, reason: "Feld liegt außerhalb der Karte" };
  }

  const current = grid.tiles[y][x];
  if (current === "spawn" || current === "core") {
    return { valid: false, reason: "Spawn und Core können nicht verändert werden" };
  }

  if (action === "add-lane") {
    if (current === "lane") return { valid: false, reason: "Feld ist bereits Lane" };
    // Neue Lane muss an bestehende Lane angrenzen, sonst entstehen Inseln.
    if (!hasLaneNeighbour(grid, x, y)) {
      return { valid: false, reason: "Neue Lane muss an eine bestehende Lane angrenzen" };
    }
  } else {
    if (current !== "lane") return { valid: false, reason: "Nur Lane-Felder können entfernt werden" };
  }

  const next = cloneGrid(grid);
  next.tiles[y][x] = action === "add-lane" ? "lane" : "empty";
  recomputeBuildable(next);

  const check = validateGrid(next);
  if (!check.valid) return check;
  return { ...check, grid: next };
}

function hasLaneNeighbour(grid: LaneGrid, x: number, y: number): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const tile = grid.tiles[y + dy]?.[x + dx];
    if (tile === "lane" || tile === "spawn" || tile === "core") return true;
  }
  return false;
}

export function cloneGrid(grid: LaneGrid): LaneGrid {
  return {
    config: { ...grid.config },
    tiles: grid.tiles.map((row) => [...row]),
    spawn: { ...grid.spawn },
    core: { ...grid.core },
  };
}

/**
 * Setzt baubare Felder neu: alles was an die Lane grenzt und nicht selbst
 * Lane ist. Wird nach jeder Bearbeitung aufgerufen, damit Bauflächen der
 * neuen Wegführung folgen.
 *
 * Türme auf Feldern, die dadurch zur Lane werden, muss der Aufrufer separat
 * behandeln (der Server erstattet sie) — hier passiert nur Geometrie.
 */
export function recomputeBuildable(grid: LaneGrid): void {
  for (let y = 0; y < grid.config.height; y++) {
    for (let x = 0; x < grid.config.width; x++) {
      if (grid.tiles[y][x] === "buildable") grid.tiles[y][x] = "empty";
    }
  }
  // Dieselbe Regel wie beim Erzeugen der Referenzkarte (inkl. Diagonalen) —
  // sonst hätten frisch gebaute und umgebaute Lanes unterschiedliche Bauzonen.
  recomputeBuildableTiles(grid.tiles, grid.config);
}

/** Sichere Standardkarte — Rückfallebene für „Zurücksetzen“ im Editor. */
export function defaultLaneMap(): LaneGrid {
  return createReferenceMap();
}

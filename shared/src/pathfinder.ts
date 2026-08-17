import { GridCoord, LaneGrid } from "./gridTypes";

/**
 * Pathfinding over the lane grid. Lives in @td/shared so both sides can use
 * the identical algorithm:
 *   - the client calls this to render a live "valid path" preview while the
 *     player edits the lane (Phase 4, Master Prompt §14);
 *   - the server calls this as the authoritative check before committing any
 *     lane edit, and to generate the waypoint list enemies walk.
 *
 * The client's preview is only ever a UX nicety — the server re-runs this
 * itself and is the sole source of truth for what actually gets committed
 * (Master Prompt §21, and the design review's "lane validation under
 * adversarial input" note).
 */
export function findPath(grid: LaneGrid, from: GridCoord, to: GridCoord): GridCoord[] | null {
  const { width, height } = grid.config;
  const isWalkable = (c: GridCoord) => {
    const tile = grid.tiles[c.y]?.[c.x];
    return tile === "lane" || tile === "spawn" || tile === "core";
  };

  const key = (c: GridCoord) => `${c.x},${c.y}`;
  const queue: GridCoord[] = [from];
  const cameFrom = new Map<string, GridCoord>();
  const visited = new Set<string>([key(from)]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === to.x && current.y === to.y) {
      return reconstruct(cameFrom, current);
    }

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next: GridCoord = { x: current.x + dx, y: current.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      if (!isWalkable(next)) continue;
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);
      cameFrom.set(k, current);
      queue.push(next);
    }
  }

  return null;
}

function reconstruct(cameFrom: Map<string, GridCoord>, end: GridCoord): GridCoord[] {
  const path: GridCoord[] = [end];
  let currentKey = `${end.x},${end.y}`;
  while (cameFrom.has(currentKey)) {
    const prev = cameFrom.get(currentKey)!;
    path.unshift(prev);
    currentKey = `${prev.x},${prev.y}`;
  }
  return path;
}

/** True if spawn -> core is currently reachable. Used to validate any lane edit before committing it. */
export function isMapValid(grid: LaneGrid): boolean {
  return findPath(grid, grid.spawn, grid.core) !== null;
}

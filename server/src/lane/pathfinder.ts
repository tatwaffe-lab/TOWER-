/**
 * Moved to @td/shared/src/pathfinder.ts so the client can run the same
 * pathfinding for lane-edit previews (Phase 4). Re-exported here only so
 * nothing that still points at this path breaks; prefer importing from
 * "@td/shared" directly (see MatchRoom.ts).
 */
export { findPath, isMapValid } from "@td/shared";

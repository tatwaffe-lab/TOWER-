/**
 * Moved to @td/shared/src/laneGrid.ts so the client can render the same
 * reference map without a network round trip. Re-exported here only so
 * nothing that still points at this path breaks; prefer importing from
 * "@td/shared" directly (see MatchRoom.ts).
 */
export { createReferenceMap, tileAt } from "@td/shared";

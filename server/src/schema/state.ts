/**
 * Moved to @td/shared/src/schema.ts so the client and server import the
 * exact same Colyseus Schema classes (state can never silently drift out of
 * sync between them). Re-exported here only so nothing that still points at
 * this path breaks; prefer importing from "@td/shared" directly (see
 * MatchRoom.ts).
 */
export { PlayerState, TowerState, EnemyState, MatchState } from "@td/shared";

export type { TileKind, GridCoord, GridConfig, LaneGrid } from "./gridTypes";

export type { DamageType, TargetingMode, StatusKind, StatusEffect, StatusTickResult } from "./combat";
export {
  TARGETING_MODES,
  TARGETING_LABEL,
  STATUS_TICK_MS,
  MIN_DAMAGE_FRACTION,
  applyStatus,
  tickStatuses,
  findStatus,
  speedMultiplier,
  effectiveArmor,
  computeDamage,
  clamp,
  safeNumber,
  round2,
  distance,
} from "./combat";

export { Rng, randomSeed } from "./rng";

export type { GameMode, GameModeDefinition, AiProfile } from "./gameModes";
export {
  GAME_MODES,
  GAME_MODE_IDS,
  AI_PROFILES,
  gameMode,
  aiProfileFor,
  endlessExtraMultiplier,
} from "./gameModes";

export type {
  AttackKind,
  StatusApplication,
  TowerStats,
  TowerUpgradeLevel,
  TowerSpecialization,
  TowerDefinition,
} from "./towerData";
export {
  TOWERS,
  TOWER_IDS,
  SELL_REFUND_RATIO,
  resolveTowerStats,
  investedGold,
  sellValue,
  nextUpgradeCost,
  canSpecialize,
} from "./towerData";

export type { EnemyAbility, EnemyClass, BossPhase, EnemyDefinition } from "./enemyData";
export {
  ENEMIES,
  ENEMY_IDS,
  WAVE_POOL,
  BOSS_IDS,
  BOSS_WAVE_INTERVAL,
  isBossWave,
  bossForWave,
  waveBudget,
  waveHpMultiplier,
  waveArmorBonus,
  waveGoldMultiplier,
} from "./enemyData";

export type { WaveEntry, WavePlan } from "./waveDirector";
export { planWave, buildSpawnQueue, describeWave } from "./waveDirector";

export type {
  CommanderId,
  AbilityKind,
  CommanderAbility,
  CommanderDefinition,
  RuleModifiers,
  PerkDefinition,
} from "./commanderData";
export {
  COMMANDERS,
  COMMANDER_IDS,
  PERKS,
  PERK_LEVELS,
  NEUTRAL_MODIFIERS,
  combineModifiers,
  xpForLevel,
  levelForXp,
} from "./commanderData";

export type { SendUnitDefinition } from "./sendData";
export {
  SEND_UNITS,
  SEND_IDS,
  THREAT_MAX,
  THREAT_PER_WAVE,
  THREAT_PER_KILL,
  THREAT_TIERS,
  sendCost,
  sendPowerMultiplier,
  sendArmorBonus,
  sendUnlocked,
  defenderReward,
} from "./sendData";

export type { MapDifficulty, MapDefinition } from "./maps";
export {
  MAPS,
  MAP_IDS,
  MAP_DIFFICULTY_ORDER,
  DEFAULT_MAP_ID,
  mapDefinition,
  isMapId,
  expandPath,
  createMap,
  mapPathLength,
  mapBuildableCount,
  mapsByDifficulty,
} from "./maps";

export { createReferenceMap, tileAt, recomputeBuildableTiles, GRID_WIDTH, GRID_HEIGHT, GRID_TILE_SIZE } from "./laneGrid";
export { findPath, isMapValid } from "./pathfinder";

export type { SerializedLaneMap, ValidationResult, EditAction, EditRequest } from "./laneEditor";
export {
  LANE_MAP_VERSION,
  LANE_EDIT_BASE_COST,
  LaneMapError,
  serializeLaneMap,
  deserializeLaneMap,
  validateGrid,
  validateEdit,
  cloneGrid,
  recomputeBuildable,
  defaultLaneMap,
} from "./laneEditor";

export type { MatchPhase } from "./schema";
export { StatusView, PlayerState, TowerState, EnemyState, EffectState, MatchState } from "./schema";

export type {
  PlaceTowerMsg,
  TowerRefMsg,
  SpecializeMsg,
  TargetingMsg,
  EditLaneMsg,
  AbilityMsg,
  PerkMsg,
  SendUnitsMsg,
  NameMsg,
  CommanderMsg,
  NoticeMsg,
} from "./messages";
export { PROTOCOL_VERSION, MSG, NOTICE, validate } from "./messages";

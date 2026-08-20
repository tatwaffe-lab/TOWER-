import {
  COMMANDERS,
  CommanderId,
  ENEMIES,
  EnemyDefinition,
  GridCoord,
  LaneGrid,
  PERKS,
  RuleModifiers,
  Rng,
  StatusEffect,
  TOWERS,
  TowerStats,
  applyStatus,
  combineModifiers,
  computeDamage,
  createReferenceMap,
  distance,
  findPath,
  resolveTowerStats,
  safeNumber,
  speedMultiplier,
  tickStatuses,
  waveArmorBonus,
} from "@td/shared";

/**
 * Laufzeitzustand eines Gegners. Bewusst getrennt vom Colyseus-Schema:
 * das Schema ist die Sicht nach außen, hier liegt die volle Simulation
 * (Statuslisten, Cooldowns, Bossphasen). So bleibt der replizierte Zustand
 * schlank und die Simulation frei von Netzwerk-Details.
 */
export interface SimEnemy {
  id: string;
  defId: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  pathIndex: number;
  statuses: StatusEffect[];
  sent: boolean;
  /** Wer bekommt das Gold für den Kill (bei Sends der Verteidiger). */
  bountyGold: number;
  xpValue: number;
  untargetable: boolean;
  phaseTimerMs: number;
  abilityCooldownMs: number;
  regenAccMs: number;
  bossPhaseIndex: number;
  bossPhaseName: string;
  speedMul: number;
  armorAdd: number;
  facing: number;
  /** Fliegende Einheiten laufen Luftlinie statt der Lane. */
  flying: boolean;
  dead: boolean;
}

export interface SimTower {
  id: string;
  defId: string;
  x: number;
  y: number;
  level: number;
  specializationId: string | null;
  targeting: string;
  cooldownMs: number;
  disabledMs: number;
  facing: number;
  shotTick: number;
  totalDamage: number;
  /** Drohnenpositionen (nur attack === "drone"). */
  drones: { x: number; y: number; cooldownMs: number }[];
}

export interface SimEffect {
  id: string;
  kind: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  ttlMs: number;
}

export interface AbilityBuff {
  kind: string;
  remainingMs: number;
  x: number;
  y: number;
  radius: number;
  damageMul: number;
  fireRateMul: number;
  slowMagnitude: number;
  buildCostMul: number;
  sendCostMul: number;
  sendHpMul: number;
  sendSpeedMul: number;
}

export interface LeakEvent {
  coreDamage: number;
}
export interface KillEvent {
  gold: number;
  xp: number;
  wasSent: boolean;
}

/**
 * Die komplette Simulation einer Spieler-Lane. Jeder Spieler hat eine eigene
 * Instanz; PvP-Sends erzeugen Gegner in der Instanz des Ziels.
 */
export class PlayerSim {
  grid: LaneGrid;
  waypoints: GridCoord[];
  enemies = new Map<string, SimEnemy>();
  towers = new Map<string, SimTower>();
  effects: SimEffect[] = [];
  buffs: AbilityBuff[] = [];

  commanderId: CommanderId = "engineer";
  perks: string[] = [];

  private idCounter = 0;
  /** Lane-eigener Namensraum für IDs. Wird vom Raum auf die sessionId gesetzt. */
  idPrefix = "";
  private rng: Rng;

  constructor(rng: Rng, grid?: LaneGrid) {
    this.rng = rng;
    this.grid = grid ?? createReferenceMap();
    this.waypoints = this.computePath();
  }

  private computePath(): GridCoord[] {
    const path = findPath(this.grid, this.grid.spawn, this.grid.core);
    if (!path) throw new Error("Lane hat keinen gültigen Pfad");
    return path;
  }

  /** Nach einem Lane-Umbau: Pfad neu berechnen und laufende Gegner einpassen. */
  rebuildPath(): void {
    const oldLength = this.waypoints.length;
    this.waypoints = this.computePath();
    const ratio = this.waypoints.length / Math.max(1, oldLength);
    for (const enemy of this.enemies.values()) {
      // Fortschritt anteilig übertragen, damit ein Umbau Gegner weder
      // zurücksetzt noch ins Ziel teleportiert.
      enemy.pathIndex = Math.min(this.waypoints.length - 2, Math.max(0, Math.floor(enemy.pathIndex * ratio)));
      const wp = this.waypoints[enemy.pathIndex];
      if (wp && !enemy.flying) {
        enemy.x = wp.x;
        enemy.y = wp.y;
      }
    }
  }

  /**
   * Erzeugt eine ID, die auch über Lane-Grenzen hinweg eindeutig ist.
   *
   * Der Zähler läuft pro Simulation, aber Gegner, Türme und Effekte aller
   * Spieler landen serverseitig in *einer* gemeinsamen Map. Ohne den
   * lane-eigenen Namensraum vergeben zwei Spieler beide "e1" — und der
   * zweite Gegner überschreibt den ersten, statt zu erscheinen. Der Fehler
   * fällt im Solospiel nie auf und macht im Mehrspieler einzelne Gegner
   * unsichtbar.
   */
  nextId(prefix: string): string {
    return `${prefix}${this.idPrefix}-${++this.idCounter}`;
  }

  /** Alle wirksamen Modifikatoren: Commander-Passive + gewählte Perks. */
  modifiers(): Required<RuleModifiers> {
    const sources: RuleModifiers[] = [COMMANDERS[this.commanderId].passive];
    for (const perkId of this.perks) {
      const perk = PERKS[perkId];
      if (perk) sources.push(perk.modifiers);
    }
    return combineModifiers(sources);
  }

  // ---------------------------------------------------------------- Gegner

  /** Aktuelle Welle — bestimmt die zusätzliche Rüstung neuer Gegner. */
  currentWave = 1;

  spawnEnemy(
    defId: string,
    opts: { hpMul?: number; speedMul?: number; sent?: boolean; bountyGold?: number; armorAdd?: number } = {}
  ): SimEnemy | null {
    const def = ENEMIES[defId];
    if (!def) return null;

    const hp = Math.max(1, Math.round(def.hp * (opts.hpMul ?? 1)));
    const start = this.waypoints[0];
    const enemy: SimEnemy = {
      id: this.nextId("e"),
      defId,
      hp,
      maxHp: hp,
      x: start.x,
      y: start.y,
      pathIndex: 0,
      statuses: [],
      sent: opts.sent ?? false,
      bountyGold: opts.bountyGold ?? def.goldReward,
      xpValue: def.cls === "boss" ? 220 : def.cls === "elite" ? 30 : 8,
      untargetable: false,
      phaseTimerMs: 0,
      abilityCooldownMs: 0,
      regenAccMs: 0,
      bossPhaseIndex: -1,
      bossPhaseName: "",
      // Gesendete PvP-Einheiten bekommen KEINE Wellenrüstung — sonst würden
      // sie im Lategame unverhältnismäßig hart.
      // (armorAdd wird unten gesetzt)
      speedMul: opts.speedMul ?? 1,
      armorAdd: opts.armorAdd ?? (opts.sent ? 0 : waveArmorBonus(this.currentWave)),
      facing: 0,
      flying: def.ability === "flying",
      dead: false,
    };
    this.enemies.set(enemy.id, enemy);
    return enemy;
  }

  /** Bewegt alle Gegner. Liefert Leaks (Gegner, die den Core erreicht haben). */
  moveEnemies(dtMs: number): LeakEvent[] {
    const leaks: LeakEvent[] = [];
    const core = this.waypoints[this.waypoints.length - 1];

    for (const enemy of this.enemies.values()) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.defId];
      if (!def) continue;

      const slowFactor = speedMultiplier(enemy.statuses);
      const speed = def.speed * enemy.speedMul * slowFactor;
      const step = (speed * dtMs) / 1000;
      if (step <= 0) continue;

      if (enemy.flying) {
        // Luftlinie direkt zum Core — ignoriert die Lane vollständig.
        const dx = core.x - enemy.x;
        const dy = core.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        enemy.facing = Math.atan2(dy, dx);
        if (dist <= step) {
          leaks.push({ coreDamage: def.coreDamage });
          enemy.dead = true;
          this.enemies.delete(enemy.id);
          continue;
        }
        enemy.x += (dx / dist) * step;
        enemy.y += (dy / dist) * step;
        // Fortschritt für Targeting-Sortierung annähern.
        enemy.pathIndex = Math.floor(
          (1 - dist / Math.max(1, Math.hypot(core.x - this.waypoints[0].x, core.y - this.waypoints[0].y))) *
            this.waypoints.length
        );
        continue;
      }

      let remaining = step;
      let guard = 0;
      while (remaining > 0 && guard++ < 8) {
        const target = this.waypoints[enemy.pathIndex + 1];
        if (!target) {
          leaks.push({ coreDamage: def.coreDamage });
          enemy.dead = true;
          this.enemies.delete(enemy.id);
          break;
        }
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        enemy.facing = Math.atan2(dy, dx);

        if (dist <= remaining) {
          enemy.x = target.x;
          enemy.y = target.y;
          enemy.pathIndex += 1;
          remaining -= dist;
        } else {
          enemy.x += (dx / dist) * remaining;
          enemy.y += (dy / dist) * remaining;
          remaining = 0;
        }
      }
    }
    return leaks;
  }

  /** Status-Effekte altern lassen, DoT abrechnen, Sonderfähigkeiten ticken. */
  tickEnemies(dtMs: number): KillEvent[] {
    const kills: KillEvent[] = [];
    const mods = this.modifiers();

    for (const enemy of [...this.enemies.values()]) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.defId];
      if (!def) continue;

      // DoT-Quellen merken, damit der Schaden dem verursachenden Turm
      // gutgeschrieben wird — sonst sehen Gift-/Brandtürme im Inspektor und
      // in der Balance-Messung fälschlich fast keinen Schaden.
      const dotSources = enemy.statuses
        .filter((s) => (s.kind === "burn" || s.kind === "poison") && s.sourceId)
        .map((s) => s.sourceId as string);

      const result = tickStatuses(enemy.statuses, dtMs);
      enemy.statuses = result.effects;
      if (result.damage > 0) {
        enemy.hp -= result.damage;
        const share = result.damage / Math.max(1, dotSources.length);
        for (const sourceId of dotSources) {
          const source = this.towers.get(sourceId);
          if (source) source.totalDamage += share;
        }
      }
      if (result.heal > 0) enemy.hp = Math.min(enemy.maxHp, enemy.hp + result.heal);

      // Regeneration (Schwarmkönigin)
      if (def.ability === "regenerate" && def.regenPerSec) {
        enemy.regenAccMs += dtMs;
        while (enemy.regenAccMs >= 1000) {
          enemy.regenAccMs -= 1000;
          enemy.hp = Math.min(enemy.maxHp, enemy.hp + def.regenPerSec);
        }
      }

      // Phasenverschiebung: periodisch nicht anvisierbar.
      // Ausschlaggebend ist `phaseCycleMs`, nicht das ability-Flag — der
      // Phasenflieger etwa hat ability "flying" und phast trotzdem.
      if (def.phaseCycleMs && def.phaseCycleMs > 0) {
        enemy.phaseTimerMs += dtMs;
        const cycle = def.phaseCycleMs;
        enemy.untargetable = enemy.phaseTimerMs % cycle > cycle * 0.6;
      }

      // Schild-Aura: gibt Nachbarn Rüstung
      if (def.ability === "shield-aura" && def.auraRadius && def.auraArmor) {
        for (const other of this.enemies.values()) {
          if (other.id === enemy.id || other.dead) continue;
          if (distance(enemy.x, enemy.y, other.x, other.y) <= def.auraRadius) {
            other.statuses = applyStatus(other.statuses, {
              kind: "shielded",
              magnitude: def.auraArmor,
              remainingMs: 600,
              sourceId: enemy.id,
            });
          }
        }
      }

      // Sabotage: deaktiviert einen Turm in Reichweite
      if (def.ability === "sabotage" && def.sabotageRadius && def.sabotageMs) {
        enemy.abilityCooldownMs -= dtMs;
        if (enemy.abilityCooldownMs <= 0) {
          const victim = this.findTowerNear(enemy.x, enemy.y, def.sabotageRadius);
          if (victim) {
            victim.disabledMs = Math.max(victim.disabledMs, def.sabotageMs);
            this.addEffect("sabotage", victim.x, victim.y, victim.x, victim.y, 0.6, 500);
            enemy.abilityCooldownMs = def.sabotageCooldownMs ?? 5000;
          } else {
            enemy.abilityCooldownMs = 500;
          }
        }
      }

      // Bossphasen
      if (def.phases && def.phases.length > 0) {
        const frac = enemy.hp / enemy.maxHp;
        for (let i = enemy.bossPhaseIndex + 1; i < def.phases.length; i++) {
          const phase = def.phases[i];
          if (frac <= phase.atHpFraction) {
            enemy.bossPhaseIndex = i;
            enemy.bossPhaseName = phase.name;
            enemy.speedMul *= phase.speedMul;
            enemy.armorAdd += phase.armorAdd;
            this.addEffect("boss-phase", enemy.x, enemy.y, enemy.x, enemy.y, 2.5, 900);
            if (phase.summon) {
              for (let s = 0; s < phase.summon.count; s++) {
                const add = this.spawnEnemy(phase.summon.defId, { sent: enemy.sent });
                if (add) {
                  add.pathIndex = Math.max(0, enemy.pathIndex - 1);
                  const wp = this.waypoints[add.pathIndex];
                  if (wp) {
                    add.x = wp.x + (this.rng.next() - 0.5) * 0.4;
                    add.y = wp.y + (this.rng.next() - 0.5) * 0.4;
                  }
                }
              }
            }
            if (phase.disableTowersMs) {
              for (const tower of this.towers.values()) {
                if (distance(tower.x, tower.y, enemy.x, enemy.y) <= 3.5) {
                  tower.disabledMs = Math.max(tower.disabledMs, phase.disableTowersMs);
                }
              }
            }
          }
        }
      }

      enemy.hp = safeNumber(enemy.hp, 0);
      if (enemy.hp <= 0) {
        kills.push(this.killEnemy(enemy, mods.goldPerKillMul));
      }
    }

    return kills;
  }

  private killEnemy(enemy: SimEnemy, goldMul: number): KillEvent {
    const def = ENEMIES[enemy.defId];
    enemy.dead = true;
    this.enemies.delete(enemy.id);
    this.addEffect("death", enemy.x, enemy.y, enemy.x, enemy.y, 0.5, 350);

    // Teiler zerfallen in kleinere Einheiten.
    if (def?.ability === "split" && def.splitInto) {
      for (let i = 0; i < def.splitInto.count; i++) {
        const child = this.spawnEnemy(def.splitInto.defId, { sent: enemy.sent, bountyGold: 1 });
        if (child) {
          child.pathIndex = enemy.pathIndex;
          child.x = enemy.x + (this.rng.next() - 0.5) * 0.5;
          child.y = enemy.y + (this.rng.next() - 0.5) * 0.5;
        }
      }
    }

    // Detonator-Spezialisierung: brennende Gegner explodieren.
    const burn = enemy.statuses.find((s) => s.kind === "burn");
    if (burn && this.deathExplosion) {
      const { damage, radius } = this.deathExplosion;
      this.dealAreaDamage(enemy.x, enemy.y, radius, damage, "explosive", null);
      this.addEffect("explosion", enemy.x, enemy.y, enemy.x, enemy.y, radius, 300);
    }

    return {
      gold: Math.max(0, Math.round(enemy.bountyGold * goldMul)),
      xp: enemy.xpValue,
      wasSent: enemy.sent,
    };
  }

  /** Wird vom Turmschritt gesetzt, wenn ein Detonator-Flammenwerfer existiert. */
  private deathExplosion: { damage: number; radius: number } | null = null;

  // ----------------------------------------------------------------- Türme

  addTower(defId: string, x: number, y: number, targeting: string): SimTower {
    const tower: SimTower = {
      id: this.nextId("t"),
      defId,
      x,
      y,
      level: 0,
      specializationId: null,
      targeting,
      cooldownMs: 0,
      disabledMs: 0,
      facing: 0,
      shotTick: 0,
      totalDamage: 0,
      drones: [],
    };
    this.towers.set(tower.id, tower);
    return tower;
  }

  towerAt(x: number, y: number): SimTower | undefined {
    for (const tower of this.towers.values()) {
      if (tower.x === x && tower.y === y) return tower;
    }
    return undefined;
  }

  /** Nächster anvisierbarer Gegner zu einem Punkt (für Drohnen). */
  private nearestEnemyTo(x: number, y: number, radius: number): SimEnemy | null {
    let best: SimEnemy | null = null;
    let bestDist = Infinity;
    for (const enemy of this.enemies.values()) {
      if (enemy.dead || enemy.untargetable) continue;
      const d = distance(x, y, enemy.x, enemy.y);
      if (d <= radius && d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  private findTowerNear(x: number, y: number, radius: number): SimTower | undefined {
    let best: SimTower | undefined;
    let bestDist = Infinity;
    for (const tower of this.towers.values()) {
      if (tower.disabledMs > 0) continue;
      const d = distance(tower.x, tower.y, x, y);
      if (d <= radius && d < bestDist) {
        bestDist = d;
        best = tower;
      }
    }
    return best;
  }

  /** Effektive Turmwerte inkl. Perks, Auren und aktiver Fähigkeiten. */
  effectiveStats(tower: SimTower): TowerStats {
    const def = TOWERS[tower.defId];
    const stats = resolveTowerStats(def, tower.level, tower.specializationId);
    const mods = this.modifiers();

    let damageMul = mods.towerDamageMul;
    let fireRateMul = mods.towerFireRateMul;
    let rangeAdd = mods.towerRangeAdd;

    // Support-Auren benachbarter Baken
    for (const other of this.towers.values()) {
      if (other.id === tower.id || other.disabledMs > 0) continue;
      const otherDef = TOWERS[other.defId];
      if (otherDef?.base.attack !== "aura") continue;
      const otherStats = resolveTowerStats(otherDef, other.level, other.specializationId);
      if (distance(other.x, other.y, tower.x, tower.y) <= otherStats.range) {
        damageMul *= 1 + (otherStats.auraDamageBonus ?? 0);
        fireRateMul *= 1 - (otherStats.auraFireRateBonus ?? 0);
        rangeAdd += otherStats.auraRangeBonus ?? 0;
      }
    }

    // Aktive Commander-Fähigkeiten
    for (const buff of this.buffs) {
      if (buff.radius > 0 && distance(buff.x, buff.y, tower.x, tower.y) > buff.radius) continue;
      damageMul *= buff.damageMul;
      fireRateMul *= buff.fireRateMul;
    }

    stats.damage *= damageMul;
    stats.fireRateMs = Math.max(50, stats.fireRateMs * fireRateMul);
    stats.range += rangeAdd;

    if (stats.applies) {
      for (const a of stats.applies) {
        if (a.kind === "slow" || a.kind === "stun") a.magnitude *= mods.slowStrengthMul;
        if (a.kind === "burn") a.magnitude *= mods.burnStrengthMul;
      }
      // Slow darf nie 100 % erreichen, sonst stehen Gegner dauerhaft still.
      for (const a of stats.applies) {
        if (a.kind === "slow") a.magnitude = Math.min(0.85, a.magnitude);
      }
    }
    if (stats.areaRadius) stats.areaRadius *= mods.splashRadiusMul;
    if (stats.chainJumps) stats.chainJumps += mods.chainJumpsAdd;

    return stats;
  }

  /** Führt alle Turmangriffe aus. Liefert Kills. */
  tickTowers(dtMs: number): KillEvent[] {
    const kills: KillEvent[] = [];
    const mods = this.modifiers();

    // Detonator-Effekt einsammeln, bevor Gegner sterben können.
    this.deathExplosion = null;
    for (const tower of this.towers.values()) {
      const stats = resolveTowerStats(TOWERS[tower.defId], tower.level, tower.specializationId);
      if (stats.deathExplosionDamage) {
        this.deathExplosion = {
          damage: stats.deathExplosionDamage,
          radius: stats.deathExplosionRadius ?? 1.5,
        };
      }
    }

    for (const tower of this.towers.values()) {
      if (tower.disabledMs > 0) {
        tower.disabledMs = Math.max(0, tower.disabledMs - dtMs);
        continue;
      }
      const def = TOWERS[tower.defId];
      if (!def) continue;
      const stats = this.effectiveStats(tower);
      if (stats.attack === "aura") continue;

      this.updateDrones(tower, stats, dtMs);

      if (stats.fireRateMs <= 0) continue;
      tower.cooldownMs -= dtMs;
      if (tower.cooldownMs > 0) continue;

      const fired = this.fireTower(tower, stats, mods, kills);
      if (fired) tower.cooldownMs = stats.fireRateMs;
      else tower.cooldownMs = 100; // kein Ziel: bald erneut prüfen
    }

    return kills;
  }

  private updateDrones(tower: SimTower, stats: TowerStats, dtMs: number): void {
    if (stats.attack !== "drone") return;
    const want = stats.droneCount ?? 1;
    while (tower.drones.length < want) {
      tower.drones.push({ x: tower.x, y: tower.y, cooldownMs: 0 });
    }
    while (tower.drones.length > want) tower.drones.pop();

    for (const drone of tower.drones) {
      const target = this.pickTarget(tower, stats);
      const goalX = target ? target.x : tower.x;
      const goalY = target ? target.y : tower.y;
      const dx = goalX - drone.x;
      const dy = goalY - drone.y;
      const dist = Math.hypot(dx, dy);
      const step = (4.5 * dtMs) / 1000;
      if (dist > 0.15) {
        drone.x += (dx / dist) * Math.min(step, dist);
        drone.y += (dy / dist) * Math.min(step, dist);
      }
    }
  }

  private fireTower(
    tower: SimTower,
    stats: TowerStats,
    mods: Required<RuleModifiers>,
    kills: KillEvent[]
  ): boolean {
    const target = this.pickTarget(tower, stats);
    if (!target) return false;

    tower.facing = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.shotTick++;

    switch (stats.attack) {
      case "chain":
        this.fireChain(tower, stats, target, mods, kills);
        break;
      case "splash":
      case "lob":
        this.addEffect("shot", tower.x, tower.y, target.x, target.y, 0, 160);
        this.dealAreaDamage(target.x, target.y, stats.areaRadius ?? 1, stats.damage, stats.damageType, stats, tower, mods, kills);
        this.addEffect("explosion", target.x, target.y, target.x, target.y, stats.areaRadius ?? 1, 260);
        break;
      case "cone":
        this.dealAreaDamage(tower.x, tower.y, stats.areaRadius ?? stats.range, stats.damage, stats.damageType, stats, tower, mods, kills);
        this.addEffect("cone", tower.x, tower.y, target.x, target.y, stats.areaRadius ?? stats.range, 180);
        break;
      case "beam":
        this.addEffect("beam", tower.x, tower.y, target.x, target.y, 0, 180);
        this.firePierce(tower, stats, target, mods, kills);
        break;
      case "drone": {
        // Jede Drohne greift eigenständig an — sonst wäre "mehr Drohnen"
        // ein reiner Optikeffekt ohne Wirkung.
        const drones = tower.drones.length > 0 ? tower.drones : [{ x: tower.x, y: tower.y, cooldownMs: 0 }];
        for (const drone of drones) {
          const own = this.nearestEnemyTo(drone.x, drone.y, stats.range) ?? target;
          if (!own) continue;
          this.addEffect("shot", drone.x, drone.y, own.x, own.y, 0, 140);
          this.damageEnemy(own, stats.damage, stats.damageType, stats, tower, mods, kills);
        }
        break;
      }
      case "projectile":
      default:
        this.addEffect("shot", tower.x, tower.y, target.x, target.y, 0, 150);
        if ((stats.pierce ?? 0) > 0) this.firePierce(tower, stats, target, mods, kills);
        else this.damageEnemy(target, stats.damage, stats.damageType, stats, tower, mods, kills);
        break;
    }
    return true;
  }

  private firePierce(
    tower: SimTower,
    stats: TowerStats,
    first: SimEnemy,
    mods: Required<RuleModifiers>,
    kills: KillEvent[]
  ): void {
    const maxHits = Math.max(1, (stats.pierce ?? 0) + 1);
    // Durchschlag trifft Gegner entlang der Schussrichtung.
    const dirX = first.x - tower.x;
    const dirY = first.y - tower.y;
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;

    const hits = [...this.enemies.values()]
      .filter((e) => !e.dead && !e.untargetable)
      .map((e) => {
        const relX = e.x - tower.x;
        const relY = e.y - tower.y;
        const along = relX * nx + relY * ny;
        const perp = Math.abs(relX * ny - relY * nx);
        return { enemy: e, along, perp };
      })
      .filter((h) => h.along >= 0 && h.along <= stats.range + 1 && h.perp <= 0.6)
      .sort((a, b) => a.along - b.along)
      .slice(0, maxHits);

    for (const hit of hits) {
      this.damageEnemy(hit.enemy, stats.damage, stats.damageType, stats, tower, mods, kills);
    }
  }

  private fireChain(
    tower: SimTower,
    stats: TowerStats,
    first: SimEnemy,
    mods: Required<RuleModifiers>,
    kills: KillEvent[]
  ): void {
    const jumps = Math.max(1, stats.chainJumps ?? 1);
    const falloff = stats.chainFalloff ?? 0.75;
    const hit = new Set<string>();
    let current = first;
    let damage = stats.damage;
    let fromX = tower.x;
    let fromY = tower.y;

    for (let i = 0; i < jumps; i++) {
      hit.add(current.id);
      this.addEffect("lightning", fromX, fromY, current.x, current.y, 0, 150);
      this.damageEnemy(current, damage, stats.damageType, stats, tower, mods, kills);
      fromX = current.x;
      fromY = current.y;
      damage *= falloff;

      let next: SimEnemy | null = null;
      let bestDist = Infinity;
      for (const candidate of this.enemies.values()) {
        if (candidate.dead || hit.has(candidate.id) || candidate.untargetable) continue;
        const d = distance(current.x, current.y, candidate.x, candidate.y);
        if (d <= 2.2 && d < bestDist) {
          bestDist = d;
          next = candidate;
        }
      }
      if (!next) break;
      current = next;
    }
  }

  dealAreaDamage(
    cx: number,
    cy: number,
    radius: number,
    damage: number,
    damageType: TowerStats["damageType"],
    stats: TowerStats | null,
    tower?: SimTower,
    mods?: Required<RuleModifiers>,
    kills?: KillEvent[]
  ): void {
    for (const enemy of [...this.enemies.values()]) {
      if (enemy.dead) continue;
      if (distance(cx, cy, enemy.x, enemy.y) > radius) continue;
      this.damageEnemy(enemy, damage, damageType, stats, tower, mods, kills);
    }
  }

  damageEnemy(
    enemy: SimEnemy,
    rawDamage: number,
    damageType: TowerStats["damageType"],
    stats: TowerStats | null,
    tower?: SimTower,
    mods?: Required<RuleModifiers>,
    kills?: KillEvent[]
  ): void {
    if (enemy.dead) return;
    const def = ENEMIES[enemy.defId];
    if (!def) return;

    let dmg = rawDamage;
    if (mods && def.cls === "boss") dmg *= mods.bossDamageMul;

    const armor = def.armor + enemy.armorAdd;
    const applied = computeDamage(dmg, damageType, armor, enemy.statuses);
    enemy.hp -= applied;
    if (tower) tower.totalDamage += applied;

    if (stats?.applies) {
      for (const a of stats.applies) {
        enemy.statuses = applyStatus(enemy.statuses, {
          kind: a.kind,
          magnitude: a.magnitude,
          remainingMs: a.durationMs,
          sourceId: tower?.id,
        });
      }
    }

    enemy.hp = safeNumber(enemy.hp, 0);
    if (enemy.hp <= 0 && kills) {
      kills.push(this.killEnemy(enemy, mods?.goldPerKillMul ?? 1));
    }
  }

  /** Zielwahl nach dem eingestellten Modus. */
  pickTarget(tower: SimTower, stats: TowerStats): SimEnemy | null {
    let best: SimEnemy | null = null;
    let bestScore = -Infinity;

    for (const enemy of this.enemies.values()) {
      if (enemy.dead || enemy.untargetable) continue;
      const originX = stats.attack === "drone" && tower.drones[0] ? tower.drones[0].x : tower.x;
      const originY = stats.attack === "drone" && tower.drones[0] ? tower.drones[0].y : tower.y;
      const d = distance(originX, originY, enemy.x, enemy.y);
      if (d > stats.range) continue;

      const def = ENEMIES[enemy.defId];
      let score: number;
      switch (tower.targeting) {
        case "last":
          score = -enemy.pathIndex;
          break;
        case "strongest":
          score = enemy.maxHp;
          break;
        case "weakest":
          score = -enemy.hp;
          break;
        case "closest":
          score = -d;
          break;
        case "first":
        default:
          score = enemy.pathIndex;
          break;
      }
      // Türme mit prefersBig bevorzugen Elite/Boss deutlich.
      if (stats.prefersBig && def && def.cls !== "normal") score += 100000;

      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    return best;
  }

  // --------------------------------------------------------------- Effekte

  addEffect(kind: string, x: number, y: number, x2: number, y2: number, radius: number, ttlMs: number): void {
    // Harte Obergrenze: verhindert, dass ein Effektsturm Speicher und
    // Netzwerkbandbreite auffrisst (Performance-Leitplanke).
    if (this.effects.length > 90) return;
    this.effects.push({ id: this.nextId("fx"), kind, x, y, x2, y2, radius, ttlMs });
  }

  tickEffects(dtMs: number): void {
    for (const fx of this.effects) fx.ttlMs -= dtMs;
    this.effects = this.effects.filter((fx) => fx.ttlMs > 0);
  }

  tickBuffs(dtMs: number): void {
    for (const buff of this.buffs) buff.remainingMs -= dtMs;
    this.buffs = this.buffs.filter((b) => b.remainingMs > 0);
  }

  /** Aktive Kostenmodifikatoren aus laufenden Fähigkeiten. */
  activeBuildCostMul(): number {
    return this.buffs.reduce((acc, b) => acc * b.buildCostMul, 1);
  }
  activeSendCostMul(): number {
    return this.buffs.reduce((acc, b) => acc * b.sendCostMul, 1);
  }
  activeSendHpMul(): number {
    return this.buffs.reduce((acc, b) => acc * b.sendHpMul, 1);
  }
  activeSendSpeedMul(): number {
    return this.buffs.reduce((acc, b) => acc * b.sendSpeedMul, 1);
  }

  /** Wendet flächige Slow-Fähigkeiten auf Gegner an (Zeitfeld, Festung). */
  applyFieldSlows(dtMs: number): void {
    for (const buff of this.buffs) {
      if (buff.slowMagnitude <= 0) continue;
      for (const enemy of this.enemies.values()) {
        if (enemy.dead) continue;
        if (buff.radius > 0 && distance(buff.x, buff.y, enemy.x, enemy.y) > buff.radius) continue;
        enemy.statuses = applyStatus(enemy.statuses, {
          kind: "slow",
          magnitude: buff.slowMagnitude,
          remainingMs: 400,
        });
      }
    }
  }

  /** Wirft alle Gegner um n Wegpunkte zurück (Zeitumkehr). */
  rewindEnemies(steps: number): void {
    for (const enemy of this.enemies.values()) {
      if (enemy.dead) continue;
      enemy.pathIndex = Math.max(0, enemy.pathIndex - steps);
      const wp = this.waypoints[enemy.pathIndex];
      if (wp) {
        enemy.x = wp.x;
        enemy.y = wp.y;
      }
    }
  }

  clear(): void {
    this.enemies.clear();
    this.towers.clear();
    this.effects = [];
    this.buffs = [];
  }
}

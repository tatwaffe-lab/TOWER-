import Phaser from "phaser";
import {
  ENEMIES,
  LaneGrid,
  MatchState,
  TOWERS,
  TileKind,
  defaultLaneMap,
  deserializeLaneMap,
  resolveTowerStats,
} from "@td/shared";
import { PALETTE, SPRITE_SCALE, TILE_SIZE } from "../art/palette";
import { buildAllSprites, groundTexture, laneTexture, towerBaseTexture, turretTexture } from "../art/spriteFactory";
import { audio } from "../audio/AudioManager";

export interface SceneCallbacks {
  onTileClick(x: number, y: number, tile: TileKind): void;
  onTowerClick(towerId: string): void;
  onHover(x: number, y: number, tile: TileKind): void;
}

/**
 * Reine Darstellungsschicht: liest den replizierten Zustand und zeichnet ihn.
 * Enthält bewusst keine Spielregeln — Kosten, Reichweiten und Treffer
 * entscheidet ausschließlich der Server.
 */
export class MatchScene extends Phaser.Scene {
  private state: MatchState | null = null;
  private mySessionId = "";
  private callbacks: SceneCallbacks | null = null;

  private grid: LaneGrid = defaultLaneMap();
  private tileLayer!: Phaser.GameObjects.Container;
  private decorLayer!: Phaser.GameObjects.Container;
  private entityLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private overlayLayer!: Phaser.GameObjects.Container;

  private towerSprites = new Map<string, Phaser.GameObjects.Container>();
  private enemySprites = new Map<string, Phaser.GameObjects.Container>();
  private lastShotTick = new Map<string, number>();
  private seenEffects = new Set<string>();
  private seenBossPhases = new Set<string>();
  private lastCoreHp = -1;

  private hoverRect!: Phaser.GameObjects.Rectangle;
  private rangeCircle!: Phaser.GameObjects.Arc;
  private selectedTowerId: string | null = null;
  private laneEditMode = false;

  private bulletPool: Phaser.GameObjects.Image[] = [];

  constructor() {
    super("match");
  }

  create() {
    buildAllSprites(this);

    this.tileLayer = this.add.container(0, 0);
    this.decorLayer = this.add.container(0, 0);
    this.entityLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.overlayLayer = this.add.container(0, 0);

    this.hoverRect = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, PALETTE.buildableHover, 0.3)
      .setStrokeStyle(3, PALETTE.buildableHover, 0.95)
      .setOrigin(0)
      .setVisible(false);
    this.overlayLayer.add(this.hoverRect);

    this.rangeCircle = this.add
      .circle(0, 0, 10, PALETTE.accent, 0.07)
      .setStrokeStyle(2, PALETTE.accent, 0.5)
      .setVisible(false);
    this.overlayLayer.add(this.rangeCircle);

    this.drawGrid();

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.handleHover(p));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.handleClick(p));
  }

  bind(state: MatchState, sessionId: string, callbacks: SceneCallbacks) {
    this.state = state;
    this.mySessionId = sessionId;
    this.callbacks = callbacks;
  }

  setLaneEditMode(enabled: boolean) {
    this.laneEditMode = enabled;
  }

  setSelectedTower(towerId: string | null) {
    this.selectedTowerId = towerId;
    if (!towerId) {
      this.rangeCircle.setVisible(false);
      return;
    }
    const tower = this.state?.towers.get(towerId);
    if (!tower) return;
    const def = TOWERS[tower.defId];
    if (!def) return;
    const stats = resolveTowerStats(def, tower.level, tower.specializationId || null);
    this.rangeCircle
      .setPosition((tower.x + 0.5) * TILE_SIZE, (tower.y + 0.5) * TILE_SIZE)
      .setRadius(stats.range * TILE_SIZE)
      .setVisible(true);
  }

  setLaneMap(json: string) {
    if (!json) return;
    try {
      const parsed = deserializeLaneMap(JSON.parse(json));
      const changed =
        parsed.config.width !== this.grid.config.width ||
        parsed.config.height !== this.grid.config.height ||
        JSON.stringify(parsed.tiles) !== JSON.stringify(this.grid.tiles);
      this.grid = parsed;
      if (changed) this.drawGrid();
    } catch {
      // Ungültige Karte vom Server ignorieren statt abstürzen.
    }
  }

  private drawGrid() {
    this.tileLayer.removeAll(true);
    this.decorLayer.removeAll(true);
    const { width, height } = this.grid.config;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const kind = this.grid.tiles[y][x];
        const isPath = kind === "lane" || kind === "spawn" || kind === "core";
        const key = isPath ? laneTexture(x, y) : kind === "buildable" ? "tile_buildable" : groundTexture(x, y);
        const tile = this.add.image(x * TILE_SIZE, y * TILE_SIZE, key).setOrigin(0).setScale(SPRITE_SCALE);
        this.tileLayer.add(tile);
      }
    }

    // Spawn-Portal und Core als eigene Bauwerke obendrauf
    const spawn = this.add
      .image((this.grid.spawn.x + 0.5) * TILE_SIZE, (this.grid.spawn.y + 0.5) * TILE_SIZE, "marker_spawn")
      .setScale(SPRITE_SCALE);
    this.decorLayer.add(spawn);
    this.tweens.add({ targets: spawn, scale: SPRITE_SCALE * 1.06, duration: 1300, yoyo: true, repeat: -1 });

    const core = this.add
      .image((this.grid.core.x + 0.5) * TILE_SIZE, (this.grid.core.y + 0.5) * TILE_SIZE, "marker_core")
      .setScale(SPRITE_SCALE);
    this.decorLayer.add(core);
    this.tweens.add({ targets: core, scale: SPRITE_SCALE * 1.08, duration: 900, yoyo: true, repeat: -1 });

    this.addAmbientLife();
  }

  /**
   * Lebendige Karte: langsam treibende Staubpartikel und ein Flackern an den
   * Rändern. Rein kosmetisch, aber nimmt der Karte die Starrheit.
   */
  private addAmbientLife() {
    const w = this.grid.config.width * TILE_SIZE;
    const h = this.grid.config.height * TILE_SIZE;
    for (let i = 0; i < 26; i++) {
      const p = this.add
        .image(Math.random() * w, Math.random() * h, "px_dust")
        .setScale(SPRITE_SCALE * (0.5 + Math.random()))
        .setAlpha(0.12 + Math.random() * 0.2);
      this.decorLayer.add(p);
      this.tweens.add({
        targets: p,
        x: p.x + (Math.random() - 0.5) * 140,
        y: p.y - 40 - Math.random() * 90,
        alpha: 0,
        duration: 6000 + Math.random() * 6000,
        repeat: -1,
        onRepeat: () => {
          p.setPosition(Math.random() * w, h * (0.5 + Math.random() * 0.5));
          p.setAlpha(0.12 + Math.random() * 0.2);
        },
      });
    }
  }

  private tileAtPointer(p: Phaser.Input.Pointer): { x: number; y: number; tile: TileKind } | null {
    const x = Math.floor(p.worldX / TILE_SIZE);
    const y = Math.floor(p.worldY / TILE_SIZE);
    const tile = this.grid.tiles[y]?.[x];
    if (!tile) return null;
    return { x, y, tile };
  }

  private handleHover(p: Phaser.Input.Pointer) {
    const hit = this.tileAtPointer(p);
    if (!hit) {
      this.hoverRect.setVisible(false);
      return;
    }
    const canInteract = this.laneEditMode || hit.tile === "buildable";
    this.hoverRect
      .setPosition(hit.x * TILE_SIZE, hit.y * TILE_SIZE)
      .setVisible(canInteract)
      .setFillStyle(this.laneEditMode ? PALETTE.gold : PALETTE.buildableHover, 0.28);
    this.callbacks?.onHover(hit.x, hit.y, hit.tile);
  }

  private handleClick(p: Phaser.Input.Pointer) {
    const hit = this.tileAtPointer(p);
    if (!hit || !this.state) return;

    if (!this.laneEditMode) {
      for (const [id, tower] of this.state.towers) {
        if (tower.ownerId === this.mySessionId && tower.x === hit.x && tower.y === hit.y) {
          this.callbacks?.onTowerClick(id);
          return;
        }
      }
    }
    this.callbacks?.onTileClick(hit.x, hit.y, hit.tile);
  }

  update() {
    if (!this.state) return;
    this.syncTowers();
    this.syncEnemies();
    this.syncEffects();
    this.watchCoreDamage();
  }

  private watchCoreDamage() {
    const me = this.state?.players.get(this.mySessionId);
    if (!me) return;
    if (this.lastCoreHp >= 0 && me.coreHp < this.lastCoreHp) {
      audio.play("core-damage");
      this.cameras.main.shake(200, 0.007);
      this.cameras.main.flash(140, 190, 50, 50);
    }
    this.lastCoreHp = me.coreHp;
  }

  private syncTowers() {
    if (!this.state) return;
    const seen = new Set<string>();

    for (const [id, tower] of this.state.towers) {
      if (tower.ownerId !== this.mySessionId) continue;
      seen.add(id);

      let container = this.towerSprites.get(id);
      if (!container) {
        const base = this.add.image(0, 0, towerBaseTexture(tower.defId, tower.level, tower.specializationId));
        base.setScale(SPRITE_SCALE);
        const turret = this.add.image(0, -4, turretTexture(tower.defId, tower.level, tower.specializationId));
        turret.setScale(SPRITE_SCALE);
        container = this.add.container((tower.x + 0.5) * TILE_SIZE, (tower.y + 0.5) * TILE_SIZE, [base, turret]);
        container.setData("base", base);
        container.setData("turret", turret);
        container.setData("look", "");
        this.entityLayer.add(container);
        this.towerSprites.set(id, container);

        audio.play("build");
        container.setScale(0.5);
        this.tweens.add({ targets: container, scale: 1, duration: 220, ease: "Back.easeOut" });
        this.spawnBurst(container.x, container.y, "px_dust", 10, 0x6d6350);
      }

      const base = container.getData("base") as Phaser.GameObjects.Image;
      const turret = container.getData("turret") as Phaser.GameObjects.Image;
      const look = `${tower.level}:${tower.specializationId}`;
      if (container.getData("look") !== look) {
        const hadLook = container.getData("look") !== "";
        base.setTexture(towerBaseTexture(tower.defId, tower.level, tower.specializationId));
        turret.setTexture(turretTexture(tower.defId, tower.level, tower.specializationId));
        container.setData("look", look);
        if (hadLook) {
          audio.play("upgrade");
          this.spawnBurst(container.x, container.y, "px_spark", 14, 0xffd98a);
        }
      }

      // Geschützturm dreht sich zum Ziel — sanft, nicht schlagartig.
      turret.rotation = Phaser.Math.Angle.RotateTo(turret.rotation, tower.facing, 0.25);

      const disabled = tower.disabledMs > 0;
      base.setTint(disabled ? 0x5a6472 : 0xffffff);
      turret.setTint(disabled ? 0x5a6472 : 0xffffff);
      if (disabled && Math.random() < 0.08) {
        this.spawnBurst(container.x, container.y - 10, "px_smoke", 2, 0x8a93a8);
      }

      const last = this.lastShotTick.get(id) ?? tower.shotTick;
      if (tower.shotTick > last) {
        this.onTowerFired(tower.defId, tower.x, tower.y, tower.facing);
        // Rückstoß entlang der Rohrachse
        const kick = 5;
        turret.setPosition(-Math.cos(tower.facing) * kick, -4 - Math.sin(tower.facing) * kick);
        this.tweens.add({ targets: turret, x: 0, y: -4, duration: 110, ease: "Quad.easeOut" });
      }
      this.lastShotTick.set(id, tower.shotTick);
    }

    for (const [id, container] of this.towerSprites) {
      if (!seen.has(id)) {
        container.destroy();
        this.towerSprites.delete(id);
        this.lastShotTick.delete(id);
      }
    }
  }

  private onTowerFired(defId: string, gx: number, gy: number, facing: number) {
    const def = TOWERS[defId];
    if (!def) return;
    const x = (gx + 0.5) * TILE_SIZE;
    const y = (gy + 0.5) * TILE_SIZE;

    switch (def.base.attack) {
      case "cone":
        audio.play(defId === "flamethrower" ? "flame" : "shot-energy");
        this.spawnCone(x, y, facing, defId === "flamethrower" ? "px_fire" : "px_ice");
        break;
      case "splash":
      case "lob":
        audio.play("shot-heavy");
        this.spawnMuzzle(x, y, facing, 0xffb35c, 10);
        this.cameras.main.shake(60, 0.0015);
        break;
      case "chain":
        audio.play("shot-energy");
        break;
      case "beam":
        audio.play("shot-heavy");
        this.spawnMuzzle(x, y, facing, 0xd8f0ff, 9);
        break;
      default:
        audio.play("shot-light");
        this.spawnMuzzle(x, y, facing, 0xffe9a8, 7);
        break;
    }
  }

  private spawnMuzzle(x: number, y: number, facing: number, color: number, size: number) {
    const dist = 26;
    const flash = this.add.circle(x + Math.cos(facing) * dist, y + Math.sin(facing) * dist, size, color, 0.95);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 0.2,
      duration: 130,
      onComplete: () => flash.destroy(),
    });
    // Mündungsrauch
    for (let i = 0; i < 2; i++) {
      const smoke = this.add
        .image(x + Math.cos(facing) * dist, y + Math.sin(facing) * dist, "px_smoke")
        .setScale(SPRITE_SCALE)
        .setAlpha(0.5);
      this.fxLayer.add(smoke);
      this.tweens.add({
        targets: smoke,
        x: smoke.x + Math.cos(facing) * 14 + (Math.random() - 0.5) * 10,
        y: smoke.y + Math.sin(facing) * 14 - 8,
        alpha: 0,
        scale: SPRITE_SCALE * 2,
        duration: 320,
        onComplete: () => smoke.destroy(),
      });
    }
  }

  private spawnCone(x: number, y: number, facing: number, texture: string) {
    for (let i = 0; i < 6; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const dist = 26 + Math.random() * 70;
      const p = this.add.image(x, y, texture).setScale(SPRITE_SCALE);
      this.fxLayer.add(p);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(facing + spread) * dist,
        y: y + Math.sin(facing + spread) * dist,
        alpha: 0,
        scale: SPRITE_SCALE * 0.4,
        duration: 300,
        onComplete: () => p.destroy(),
      });
    }
  }

  private syncEnemies() {
    if (!this.state) return;
    const seen = new Set<string>();

    for (const [id, enemy] of this.state.enemies) {
      if (enemy.ownerId !== this.mySessionId) continue;
      seen.add(id);
      const def = ENEMIES[enemy.defId];
      if (!def) continue;

      const px = (enemy.x + 0.5) * TILE_SIZE;
      const py = (enemy.y + 0.5) * TILE_SIZE;

      let container = this.enemySprites.get(id);
      if (!container) {
        const sprite = this.add.sprite(0, 0, `enemy_${enemy.defId}_0`).setScale(SPRITE_SCALE);
        sprite.play(`walk_${enemy.defId}`);
        const barBg = this.add.rectangle(0, -TILE_SIZE * 0.44, TILE_SIZE * 0.56 + 2, 7, 0x000000, 0.7).setOrigin(0.5);
        const bar = this.add.rectangle(0, -TILE_SIZE * 0.44, TILE_SIZE * 0.56, 5, PALETTE.hp).setOrigin(0.5);
        container = this.add.container(px, py, [sprite, barBg, bar]);
        container.setData("sprite", sprite);
        container.setData("bar", bar);
        container.setData("hp", enemy.hp);
        this.entityLayer.add(container);
        this.enemySprites.set(id, container);

        if (def.cls === "boss") {
          audio.play("boss-spawn");
          this.cameras.main.shake(400, 0.006);
          container.setScale(0.3);
          this.tweens.add({ targets: container, scale: 1, duration: 450, ease: "Back.easeOut" });
        }
        if (enemy.sent) sprite.setTint(0xff9fb0);
      }

      container.setPosition(px, py);
      const sprite = container.getData("sprite") as Phaser.GameObjects.Sprite;
      const bar = container.getData("bar") as Phaser.GameObjects.Rectangle;

      // Blickrichtung: nach links laufende Gegner werden gespiegelt.
      const facingLeft = Math.cos(enemy.facing) < -0.15;
      sprite.setFlipX(facingLeft);

      const prevHp = container.getData("hp") as number;
      if (enemy.hp < prevHp) {
        sprite.setTintFill(0xffffff);
        this.time.delayedCall(50, () => {
          if (sprite.active) sprite.setTint(enemy.sent ? 0xff9fb0 : 0xffffff);
        });
        audio.play("hit");
      }
      container.setData("hp", enemy.hp);

      const ratio = Phaser.Math.Clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
      bar.width = TILE_SIZE * 0.56 * ratio;
      bar.fillColor = ratio > 0.5 ? PALETTE.hp : ratio > 0.25 ? PALETTE.gold : PALETTE.danger;

      let statusTint: number | null = null;
      for (const status of enemy.statuses) {
        if (status.kind === "stun") statusTint = 0x9fe8ff;
        else if (status.kind === "burn" && statusTint === null) statusTint = 0xffb27a;
        else if (status.kind === "poison" && statusTint === null) statusTint = 0xb6f08a;
        else if (status.kind === "slow" && statusTint === null) statusTint = 0x9fd8ff;
      }
      if (enemy.hp >= prevHp) sprite.setTint(statusTint ?? (enemy.sent ? 0xff9fb0 : 0xffffff));

      // Statuspartikel — brennende und vergiftete Gegner qualmen sichtbar.
      if (statusTint !== null && Math.random() < 0.12) {
        const tex = statusTint === 0xffb27a ? "px_fire" : statusTint === 0xb6f08a ? "px_poison" : "px_ice";
        this.spawnBurst(px, py - 6, tex, 1, 0xffffff);
      }

      // Animationstempo an die tatsächliche Geschwindigkeit koppeln:
      // verlangsamte Gegner laufen sichtbar träger.
      const slowed = enemy.statuses.some((s) => s.kind === "slow" || s.kind === "stun");
      sprite.anims.timeScale = slowed ? 0.4 : 1;

      container.setAlpha(enemy.untargetable ? 0.35 : 1);

      if (enemy.bossPhase) {
        const key = `${id}:${enemy.bossPhase}`;
        if (!this.seenBossPhases.has(key)) {
          this.seenBossPhases.add(key);
          audio.play("boss-phase");
          this.cameras.main.shake(280, 0.006);
          this.showFloatingText(px, py - 38, enemy.bossPhase, "#ff9f6a");
        }
      }
    }

    for (const [id, container] of this.enemySprites) {
      if (!seen.has(id)) {
        const x = container.x;
        const y = container.y;
        container.destroy();
        this.enemySprites.delete(id);
        this.spawnBurst(x, y, "px_blood", 9, 0xd4564f);
        audio.play("enemy-death");
      }
    }
  }

  private syncEffects() {
    if (!this.state) return;
    for (const [id, fx] of this.state.effects) {
      if (fx.ownerId !== this.mySessionId) continue;
      if (this.seenEffects.has(id)) continue;
      this.seenEffects.add(id);
      this.playEffect(fx.kind, fx.x, fx.y, fx.x2, fx.y2, fx.radius);
    }
    if (this.seenEffects.size > 400) {
      const live = new Set(this.state.effects.keys());
      for (const id of this.seenEffects) if (!live.has(id)) this.seenEffects.delete(id);
    }
  }

  private playEffect(kind: string, gx: number, gy: number, gx2: number, gy2: number, radius: number) {
    const x = (gx + 0.5) * TILE_SIZE;
    const y = (gy + 0.5) * TILE_SIZE;
    const x2 = (gx2 + 0.5) * TILE_SIZE;
    const y2 = (gy2 + 0.5) * TILE_SIZE;

    switch (kind) {
      case "shot": {
        const bullet = this.getBullet(x, y);
        bullet.setRotation(Math.atan2(y2 - y, x2 - x));
        this.tweens.add({
          targets: bullet,
          x: x2,
          y: y2,
          duration: 110,
          onComplete: () => this.releaseBullet(bullet),
        });
        break;
      }
      case "beam": {
        const line = this.add.line(0, 0, x, y, x2, y2, 0xd8f0ff, 0.95).setOrigin(0).setLineWidth(3);
        this.fxLayer.add(line);
        this.tweens.add({ targets: line, alpha: 0, duration: 190, onComplete: () => line.destroy() });
        break;
      }
      case "lightning": {
        // Gezackter Blitz statt gerader Linie
        const segments = 4;
        for (let i = 0; i < segments; i++) {
          const t0 = i / segments;
          const t1 = (i + 1) / segments;
          const jitter = () => (Math.random() - 0.5) * 16;
          const ax = x + (x2 - x) * t0 + (i === 0 ? 0 : jitter());
          const ay = y + (y2 - y) * t0 + (i === 0 ? 0 : jitter());
          const bx = x + (x2 - x) * t1 + (i === segments - 1 ? 0 : jitter());
          const by = y + (y2 - y) * t1 + (i === segments - 1 ? 0 : jitter());
          const seg = this.add.line(0, 0, ax, ay, bx, by, 0xc9a6ff, 1).setOrigin(0).setLineWidth(3);
          this.fxLayer.add(seg);
          this.tweens.add({ targets: seg, alpha: 0, duration: 170, onComplete: () => seg.destroy() });
        }
        this.spawnBurst(x2, y2, "px_energy", 5, 0xc9a6ff);
        break;
      }
      case "explosion": {
        audio.play("explosion");
        const ring = this.add.circle(x, y, 5, 0xffb35c, 0.5).setStrokeStyle(4, 0xffd98a, 0.95);
        this.fxLayer.add(ring);
        this.tweens.add({
          targets: ring,
          radius: radius * TILE_SIZE,
          alpha: 0,
          duration: 300,
          onComplete: () => ring.destroy(),
        });
        this.spawnBurst(x, y, "px_fire", 14, 0xff8a3c);
        this.spawnBurst(x, y, "px_smoke", 6, 0x8a93a8);
        this.cameras.main.shake(100, 0.003);
        break;
      }
      case "sabotage":
        this.spawnBurst(x, y, "px_smoke", 10, 0x8a93a8);
        this.showFloatingText(x, y - 26, "GESTÖRT", "#ff9f45");
        break;
      case "ability-overclock":
      case "ability-grid":
      case "ability-fortress":
      case "ability-timefield":
      case "ability-rewind": {
        audio.play(kind === "ability-grid" || kind === "ability-rewind" ? "ultimate" : "ability");
        const ring = this.add.circle(x, y, 8, PALETTE.accent, 0.18).setStrokeStyle(4, PALETTE.accent, 0.9);
        this.fxLayer.add(ring);
        this.tweens.add({
          targets: ring,
          radius: Math.max(1, radius) * TILE_SIZE,
          alpha: 0,
          duration: 700,
          onComplete: () => ring.destroy(),
        });
        this.spawnBurst(x, y, "px_energy", 16, PALETTE.accent);
        break;
      }
    }
  }

  private getBullet(x: number, y: number): Phaser.GameObjects.Image {
    const bullet = this.bulletPool.pop();
    if (bullet) {
      bullet.setPosition(x, y).setActive(true).setVisible(true).setAlpha(1);
      return bullet;
    }
    const created = this.add.image(x, y, "px_bullet").setScale(SPRITE_SCALE);
    this.fxLayer.add(created);
    return created;
  }

  private releaseBullet(bullet: Phaser.GameObjects.Image) {
    bullet.setActive(false).setVisible(false);
    if (this.bulletPool.length < 60) this.bulletPool.push(bullet);
    else bullet.destroy();
  }

  private spawnBurst(x: number, y: number, texture: string, count: number, tint: number) {
    const limited = this.fxLayer.length > 240 ? Math.ceil(count / 3) : count;
    for (let i = 0; i < limited; i++) {
      const p = this.add.image(x, y, texture).setScale(SPRITE_SCALE).setTint(tint);
      this.fxLayer.add(p);
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 30;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: SPRITE_SCALE * 0.3,
        rotation: (Math.random() - 0.5) * 3,
        duration: 280 + Math.random() * 220,
        onComplete: () => p.destroy(),
      });
    }
  }

  private showFloatingText(x: number, y: number, text: string, color: string) {
    const label = this.add
      .text(x, y, text, { fontFamily: "monospace", fontSize: "15px", color, stroke: "#000000", strokeThickness: 4 })
      .setOrigin(0.5);
    this.fxLayer.add(label);
    this.tweens.add({
      targets: label,
      y: y - 32,
      alpha: 0,
      duration: 950,
      onComplete: () => label.destroy(),
    });
  }

  resetVisuals() {
    for (const c of this.towerSprites.values()) c.destroy();
    for (const c of this.enemySprites.values()) c.destroy();
    this.towerSprites.clear();
    this.enemySprites.clear();
    this.lastShotTick.clear();
    this.seenEffects.clear();
    this.seenBossPhases.clear();
    this.lastCoreHp = -1;
    this.fxLayer.removeAll(true);
    this.bulletPool = [];
    this.setSelectedTower(null);
  }
}

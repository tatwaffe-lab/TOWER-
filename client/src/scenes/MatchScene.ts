import Phaser from "phaser";
import {
  ENEMIES,
  LaneGrid,
  MatchState,
  TOWERS,
  TileKind,
  deserializeLaneMap,
  defaultLaneMap,
  resolveTowerStats,
} from "@td/shared";
import { PALETTE, SPRITE_BASE, TILE_SIZE } from "../art/palette";
import { buildAllSprites, towerTexture } from "../art/spriteFactory";
import { audio } from "../audio/AudioManager";

const SCALE = TILE_SIZE / SPRITE_BASE; // ganzzahlig: 48/16 = 3

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

  /** Wiederverwendete Partikel-/Projektilobjekte statt ständiger Neuerzeugung. */
  private bulletPool: Phaser.GameObjects.Image[] = [];

  constructor() {
    super("match");
  }

  create() {
    buildAllSprites(this);

    this.tileLayer = this.add.container(0, 0);
    this.entityLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.overlayLayer = this.add.container(0, 0);

    this.hoverRect = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, PALETTE.buildableHover, 0.32)
      .setStrokeStyle(2, PALETTE.buildableHover, 0.9)
      .setOrigin(0)
      .setVisible(false);
    this.overlayLayer.add(this.hoverRect);

    this.rangeCircle = this.add
      .circle(0, 0, 10, PALETTE.accent, 0.07)
      .setStrokeStyle(2, PALETTE.accent, 0.55)
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

  /** Karte aus dem Serverzustand übernehmen (nach Lane-Umbau). */
  setLaneMap(json: string) {
    if (!json) return;
    try {
      const parsed = deserializeLaneMap(JSON.parse(json));
      this.grid = parsed;
      this.drawGrid();
    } catch {
      // Ungültige Karte vom Server ignorieren statt abstürzen.
    }
  }

  private drawGrid() {
    this.tileLayer.removeAll(true);
    const { width, height } = this.grid.config;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const kind = this.grid.tiles[y][x];
        const key =
          kind === "lane" || kind === "spawn" || kind === "core"
            ? "tile_lane"
            : kind === "buildable"
              ? "tile_buildable"
              : "tile_ground";
        const tile = this.add.image(x * TILE_SIZE, y * TILE_SIZE, key).setOrigin(0).setScale(SCALE);
        this.tileLayer.add(tile);

        if (kind === "spawn" || kind === "core") {
          const marker = this.add
            .rectangle(
              (x + 0.5) * TILE_SIZE,
              (y + 0.5) * TILE_SIZE,
              TILE_SIZE - 8,
              TILE_SIZE - 8,
              kind === "spawn" ? PALETTE.spawn : PALETTE.core,
              0.85
            )
            .setStrokeStyle(2, kind === "spawn" ? PALETTE.spawnGlow : PALETTE.coreGlow);
          this.tileLayer.add(marker);
          const label = this.add
            .text((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE, kind === "spawn" ? "S" : "C", {
              fontFamily: "monospace",
              fontSize: "18px",
              color: "#ffffff",
            })
            .setOrigin(0.5);
          this.tileLayer.add(label);
          // Sanftes Pulsieren, damit die Karte lebt.
          this.tweens.add({
            targets: marker,
            alpha: { from: 0.85, to: 0.45 },
            duration: 1400,
            yoyo: true,
            repeat: -1,
          });
        }
      }
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

    // Klick auf einen eigenen Turm öffnet den Inspektor.
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
      this.cameras.main.shake(180, 0.006);
      this.cameras.main.flash(120, 180, 40, 40);
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
        const sprite = this.add.image(0, 0, towerTexture(tower.defId, tower.level, tower.specializationId));
        sprite.setScale(SCALE);
        container = this.add.container((tower.x + 0.5) * TILE_SIZE, (tower.y + 0.5) * TILE_SIZE, [sprite]);
        container.setData("sprite", sprite);
        container.setData("tex", "");
        this.entityLayer.add(container);
        this.towerSprites.set(id, container);
        audio.play("build");
        // Bau-Animation: kurz aufploppen.
        container.setScale(0.6);
        this.tweens.add({ targets: container, scale: 1, duration: 180, ease: "Back.easeOut" });
      }

      const sprite = container.getData("sprite") as Phaser.GameObjects.Image;
      const wantTex = towerTexture(tower.defId, tower.level, tower.specializationId);
      if (container.getData("tex") !== wantTex) {
        sprite.setTexture(wantTex);
        container.setData("tex", wantTex);
        if (container.getData("tex")) {
          audio.play("upgrade");
          this.spawnBurst((tower.x + 0.5) * TILE_SIZE, (tower.y + 0.5) * TILE_SIZE, "px_spark", 10, 0xffd98a);
        }
      }

      // Deaktivierte Türme werden grau und flackern.
      sprite.setTint(tower.disabledMs > 0 ? 0x555f70 : 0xffffff);

      // Mündungsfeuer bei jedem neuen Schuss.
      const last = this.lastShotTick.get(id) ?? tower.shotTick;
      if (tower.shotTick > last) {
        this.onTowerFired(tower.defId, tower.x, tower.y, tower.facing);
        // Rückstoß
        const def = TOWERS[tower.defId];
        if (def) {
          const kick = 4;
          sprite.setPosition(-Math.cos(tower.facing) * kick, -Math.sin(tower.facing) * kick);
          this.tweens.add({ targets: sprite, x: 0, y: 0, duration: 90 });
        }
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
        this.spawnMuzzle(x, y, facing, 0xffb35c);
        break;
      case "chain":
        audio.play("shot-energy");
        break;
      case "beam":
        audio.play("shot-heavy");
        this.spawnMuzzle(x, y, facing, 0xd8f0ff);
        break;
      default:
        audio.play("shot-light");
        this.spawnMuzzle(x, y, facing, 0xffe9a8);
        break;
    }
  }

  private spawnMuzzle(x: number, y: number, facing: number, color: number) {
    const flash = this.add.circle(x + Math.cos(facing) * 16, y + Math.sin(facing) * 16, 6, color, 0.9);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 0.3,
      duration: 110,
      onComplete: () => flash.destroy(),
    });
  }

  private spawnCone(x: number, y: number, facing: number, texture: string) {
    for (let i = 0; i < 5; i++) {
      const spread = (Math.random() - 0.5) * 0.7;
      const dist = 20 + Math.random() * 55;
      const p = this.add.image(x, y, texture).setScale(2);
      this.fxLayer.add(p);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(facing + spread) * dist,
        y: y + Math.sin(facing + spread) * dist,
        alpha: 0,
        scale: 0.5,
        duration: 260,
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
        const sprite = this.add.image(0, 0, `enemy_${enemy.defId}`).setScale(SCALE);
        const bar = this.add.rectangle(0, -TILE_SIZE * 0.42, TILE_SIZE * 0.6, 4, PALETTE.hp).setOrigin(0.5);
        const barBg = this.add
          .rectangle(0, -TILE_SIZE * 0.42, TILE_SIZE * 0.6 + 2, 6, 0x000000, 0.65)
          .setOrigin(0.5);
        container = this.add.container(px, py, [sprite, barBg, bar]);
        container.setData("sprite", sprite);
        container.setData("bar", bar);
        container.setData("hp", enemy.hp);
        this.entityLayer.add(container);
        this.enemySprites.set(id, container);

        if (def.cls === "boss") {
          audio.play("boss-spawn");
          this.cameras.main.shake(300, 0.004);
          container.setScale(0.3);
          this.tweens.add({ targets: container, scale: 1, duration: 400, ease: "Back.easeOut" });
        }
        // Gesendete Gegner bekommen eine deutliche Warnfarbe.
        if (enemy.sent) sprite.setTint(0xff9fb0);
      }

      container.setPosition(px, py);
      const sprite = container.getData("sprite") as Phaser.GameObjects.Image;
      const bar = container.getData("bar") as Phaser.GameObjects.Rectangle;

      // Trefferblitz bei HP-Verlust
      const prevHp = container.getData("hp") as number;
      if (enemy.hp < prevHp) {
        sprite.setTintFill(0xffffff);
        this.time.delayedCall(45, () => {
          if (sprite.active) sprite.setTint(enemy.sent ? 0xff9fb0 : 0xffffff);
        });
        audio.play("hit");
      }
      container.setData("hp", enemy.hp);

      const ratio = Phaser.Math.Clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
      bar.width = TILE_SIZE * 0.6 * ratio;
      bar.fillColor = ratio > 0.5 ? PALETTE.hp : ratio > 0.25 ? PALETTE.gold : PALETTE.danger;

      // Statusfärbung: der stärkste sichtbare Effekt gewinnt.
      let statusTint: number | null = null;
      for (const status of enemy.statuses) {
        if (status.kind === "stun") statusTint = 0x9fe8ff;
        else if (status.kind === "burn" && statusTint === null) statusTint = 0xffb27a;
        else if (status.kind === "poison" && statusTint === null) statusTint = 0xb6f08a;
        else if (status.kind === "slow" && statusTint === null) statusTint = 0x9fd8ff;
      }
      if (statusTint !== null && enemy.hp >= prevHp) sprite.setTint(statusTint);
      else if (statusTint === null && enemy.hp >= prevHp) sprite.setTint(enemy.sent ? 0xff9fb0 : 0xffffff);

      // Phasende Gegner werden halbtransparent.
      container.setAlpha(enemy.untargetable ? 0.4 : 1);

      // Bossphasenwechsel hörbar und sichtbar machen.
      if (enemy.bossPhase) {
        const key = `${id}:${enemy.bossPhase}`;
        if (!this.seenBossPhases.has(key)) {
          this.seenBossPhases.add(key);
          audio.play("boss-phase");
          this.cameras.main.shake(240, 0.005);
          this.showFloatingText(px, py - 30, enemy.bossPhase, "#ff9f6a");
        }
      }
    }

    for (const [id, container] of this.enemySprites) {
      if (!seen.has(id)) {
        const x = container.x;
        const y = container.y;
        container.destroy();
        this.enemySprites.delete(id);
        this.spawnBurst(x, y, "px_blood", 7, 0xd4564f);
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
    // Set gelegentlich aufräumen, damit es nicht unbegrenzt wächst.
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
          duration: 120,
          onComplete: () => this.releaseBullet(bullet),
        });
        break;
      }
      case "beam": {
        const line = this.add.line(0, 0, x, y, x2, y2, 0xd8f0ff, 0.9).setOrigin(0).setLineWidth(2);
        this.fxLayer.add(line);
        this.tweens.add({ targets: line, alpha: 0, duration: 170, onComplete: () => line.destroy() });
        break;
      }
      case "lightning": {
        const line = this.add.line(0, 0, x, y, x2, y2, 0xc9a6ff, 1).setOrigin(0).setLineWidth(3);
        this.fxLayer.add(line);
        this.tweens.add({ targets: line, alpha: 0, duration: 150, onComplete: () => line.destroy() });
        this.spawnBurst(x2, y2, "px_energy", 4, 0xc9a6ff);
        break;
      }
      case "explosion": {
        audio.play("explosion");
        const ring = this.add.circle(x, y, 4, 0xffb35c, 0.55).setStrokeStyle(3, 0xffd98a, 0.9);
        this.fxLayer.add(ring);
        this.tweens.add({
          targets: ring,
          radius: radius * TILE_SIZE,
          alpha: 0,
          duration: 280,
          onComplete: () => ring.destroy(),
        });
        this.spawnBurst(x, y, "px_fire", 12, 0xff8a3c);
        this.cameras.main.shake(90, 0.0025);
        break;
      }
      case "cone":
        break; // wird bereits beim Schuss gezeichnet
      case "death":
        break; // wird beim Entfernen des Gegners gezeichnet
      case "sabotage":
        this.spawnBurst(x, y, "px_smoke", 8, 0x8a93a8);
        this.showFloatingText(x, y - 20, "GESTÖRT", "#ff9f45");
        break;
      case "boss-phase":
        break; // wird über enemy.bossPhase behandelt
      case "ability-overclock":
      case "ability-grid":
      case "ability-fortress":
      case "ability-timefield":
      case "ability-rewind": {
        audio.play(kind === "ability-grid" || kind === "ability-rewind" ? "ultimate" : "ability");
        const ring = this.add.circle(x, y, 6, PALETTE.accent, 0.18).setStrokeStyle(3, PALETTE.accent, 0.85);
        this.fxLayer.add(ring);
        this.tweens.add({
          targets: ring,
          radius: Math.max(1, radius) * TILE_SIZE,
          alpha: 0,
          duration: 600,
          onComplete: () => ring.destroy(),
        });
        break;
      }
    }
  }

  /** Einfaches Pooling für Projektile — vermeidet ständige Allokation. */
  private getBullet(x: number, y: number): Phaser.GameObjects.Image {
    const bullet = this.bulletPool.pop();
    if (bullet) {
      bullet.setPosition(x, y).setActive(true).setVisible(true).setAlpha(1);
      return bullet;
    }
    const created = this.add.image(x, y, "px_bullet").setScale(2);
    this.fxLayer.add(created);
    return created;
  }

  private releaseBullet(bullet: Phaser.GameObjects.Image) {
    bullet.setActive(false).setVisible(false);
    if (this.bulletPool.length < 60) this.bulletPool.push(bullet);
    else bullet.destroy();
  }

  private spawnBurst(x: number, y: number, texture: string, count: number, tint: number) {
    // Deckelung: bei sehr vielen gleichzeitigen Effekten wird reduziert.
    const limited = this.fxLayer.length > 220 ? Math.ceil(count / 3) : count;
    for (let i = 0; i < limited; i++) {
      const p = this.add.image(x, y, texture).setScale(2).setTint(tint);
      this.fxLayer.add(p);
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 22;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.5,
        duration: 260 + Math.random() * 180,
        onComplete: () => p.destroy(),
      });
    }
  }

  private showFloatingText(x: number, y: number, text: string, color: string) {
    const label = this.add
      .text(x, y, text, { fontFamily: "monospace", fontSize: "13px", color, stroke: "#000000", strokeThickness: 3 })
      .setOrigin(0.5);
    this.fxLayer.add(label);
    this.tweens.add({
      targets: label,
      y: y - 26,
      alpha: 0,
      duration: 900,
      onComplete: () => label.destroy(),
    });
  }

  /** Alles zurücksetzen (Rematch). */
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

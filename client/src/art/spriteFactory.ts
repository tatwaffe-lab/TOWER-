import Phaser from "phaser";
import { ENEMIES, TOWERS } from "@td/shared";
import { PALETTE, SPRITE_BASE, mix, shade } from "./palette";
import { PixelCanvas } from "./pixelCanvas";

/**
 * Erzeugt alle Sprites prozedural als Pixel-Art.
 *
 * Türme bestehen aus zwei Teilen: einem festen Sockel und einem separaten
 * Geschützturm, der im Spiel zum Ziel gedreht wird. Deshalb wirken die Türme
 * lebendig, ohne dass für jede Blickrichtung ein eigenes Bild nötig wäre.
 *
 * Gegner bekommen mehrere Laufframes (Beinversatz + Körperwippen), die im
 * Spiel als Animation abgespielt werden.
 */

const S = SPRITE_BASE; // 32

// ---------------------------------------------------------------- Türme

type TurretKind =
  | "barrel" // einfaches Rohr (Gunner)
  | "double" // Doppellauf (Minigun)
  | "heavy" // dickes kurzes Rohr (Kanone)
  | "long" // sehr langes Rohr (Sniper/Railgun)
  | "mortar" // kurzes dickes Rohr nach oben
  | "coil" // Teslaspule
  | "nozzle" // Flammendüse
  | "flask" // Alchemistenkolben
  | "dish" // Radarschüssel (Drohnenbasis)
  | "crystal"; // Frost-/Support-Kristall

interface TowerLook {
  turret: TurretKind;
  /** Sockelform. */
  base: "round" | "square" | "bunker";
}

const TOWER_LOOKS: Record<string, TowerLook> = {
  gunner: { turret: "barrel", base: "round" },
  cannon: { turret: "heavy", base: "bunker" },
  frost: { turret: "crystal", base: "round" },
  tesla: { turret: "coil", base: "square" },
  sniper: { turret: "long", base: "square" },
  flamethrower: { turret: "nozzle", base: "bunker" },
  mortar: { turret: "mortar", base: "bunker" },
  "support-beacon": { turret: "crystal", base: "round" },
  alchemist: { turret: "flask", base: "square" },
  "drone-hub": { turret: "dish", base: "round" },
};

/** Sockel: bleibt liegen, dreht sich nicht. */
function drawTowerBase(look: TowerLook, color: number, accent: number, level: number, seed: number): PixelCanvas {
  const c = new PixelCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2 + 2;
  const dark = shade(color, -0.45);
  const mid = shade(color, -0.2);

  // Bodenschatten
  c.ellipse(cx, cy + 6, 12, 4, shade(PALETTE.ground, -0.35));

  if (look.base === "round") {
    c.ellipse(cx, cy + 3, 12, 6, dark);
    c.ellipse(cx, cy, 11, 6, mid);
    c.ellipse(cx, cy - 1, 8, 4, color);
  } else if (look.base === "square") {
    c.rect(cx - 12, cy - 2, 24, 9, dark);
    c.rect(cx - 11, cy - 4, 22, 7, mid);
    c.rect(cx - 8, cy - 5, 16, 5, color);
    // Eckpfosten
    for (const dx of [-11, 8]) c.rect(cx + dx, cy - 6, 3, 4, accent);
  } else {
    // Bunker: breite abgeschrägte Plattform
    c.taper(cx, cy - 5, 16, 26, 12, dark);
    c.taper(cx, cy - 5, 14, 22, 9, mid);
    c.rect(cx - 7, cy - 6, 14, 4, color);
  }

  // Ausbaustufe sichtbar: Nieten, dann Panzerplatten, dann Energieadern
  if (level >= 1) {
    for (const dx of [-9, -3, 3, 9]) c.set(cx + dx, cy + 2, shade(accent, 0.3));
  }
  if (level >= 2) {
    c.rect(cx - 13, cy + 1, 3, 5, accent);
    c.rect(cx + 10, cy + 1, 3, 5, accent);
  }
  if (level >= 3) {
    const glow = PALETTE.laneGlow;
    c.rect(cx - 6, cy + 3, 12, 1, glow);
    c.set(cx - 13, cy + 3, glow);
    c.set(cx + 13, cy + 3, glow);
  }

  c.outline();
  c.shadeEdges(0.26, -0.3);
  c.speckle(seed, 0.08, 0.14);
  if (level >= 3) c.bloom(PALETTE.laneGlow, 0.4);
  return c;
}

/**
 * Geschützturm. Zeigt nach rechts (0 rad) und wird im Spiel rotiert.
 * Der Drehpunkt liegt in der Mitte des Bildes.
 */
function drawTurret(kind: TurretKind, color: number, accent: number, level: number, glow: number): PixelCanvas {
  const c = new PixelCanvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const dark = shade(color, -0.35);
  const light = shade(color, 0.25);

  // Gemeinsame Drehbasis
  c.ellipse(cx, cy, 7, 6, dark);
  c.ellipse(cx - 1, cy - 1, 6, 5, color);

  switch (kind) {
    case "barrel":
      c.rect(cx + 4, cy - 2, 11 + level, 4, dark);
      c.rect(cx + 4, cy - 1, 10 + level, 2, light);
      c.rect(cx + 13 + level, cy - 3, 2, 6, accent);
      break;

    case "double":
      c.rect(cx + 4, cy - 4, 12 + level, 3, dark);
      c.rect(cx + 4, cy + 1, 12 + level, 3, dark);
      c.rect(cx + 4, cy - 4, 11, 1, light);
      c.rect(cx + 15 + level, cy - 5, 2, 11, accent);
      break;

    case "heavy":
      c.rect(cx + 3, cy - 4, 10, 8, dark);
      c.rect(cx + 3, cy - 3, 9, 3, light);
      c.rect(cx + 12, cy - 5, 4, 10, accent);
      c.rect(cx + 15, cy - 4, 2, 8, shade(accent, -0.3));
      break;

    case "long":
      c.rect(cx + 3, cy - 2, 18, 3, dark);
      c.rect(cx + 3, cy - 2, 17, 1, light);
      c.rect(cx + 8, cy - 4, 4, 2, accent);
      c.rect(cx + 20, cy - 3, 2, 5, accent);
      break;

    case "mortar":
      c.taper(cx + 8, cy - 8, 9, 6, 14, dark);
      c.rect(cx + 5, cy - 8, 7, 3, light);
      c.rect(cx + 3, cy + 2, 12, 3, accent);
      break;

    case "coil": {
      c.rect(cx - 2, cy - 12, 4, 14, dark);
      for (let i = 0; i < 4; i++) {
        const y = cy - 11 + i * 3;
        const w = 9 - i;
        c.rect(cx - (w >> 1), y, w, 2, i % 2 === 0 ? accent : light);
      }
      c.ellipse(cx, cy - 13, 4, 3, glow);
      break;
    }

    case "nozzle":
      c.rect(cx + 3, cy - 3, 9, 6, dark);
      c.rect(cx + 3, cy - 2, 8, 2, light);
      c.taper(cx + 15, cy - 4, 3, 8, 8, accent);
      c.ellipse(cx + 15, cy, 2, 3, glow);
      break;

    case "flask": {
      c.ellipse(cx + 7, cy, 6, 6, dark);
      c.ellipse(cx + 6, cy - 1, 5, 5, accent);
      c.ellipse(cx + 6, cy + 1, 4, 3, glow);
      c.rect(cx + 12, cy - 2, 4, 4, dark);
      break;
    }

    case "dish": {
      // Parabolschüssel
      for (let i = 0; i < 9; i++) {
        const h = 12 - Math.abs(i - 4) * 2;
        c.rect(cx + 4 + i, cy - (h >> 1), 1, h, i < 3 ? dark : accent);
      }
      c.rect(cx + 1, cy - 1, 5, 2, dark);
      c.ellipse(cx + 13, cy, 2, 2, glow);
      break;
    }

    case "crystal": {
      // Schwebender Kristall über der Basis
      for (let i = 0; i < 7; i++) {
        const w = 7 - Math.abs(i - 3);
        c.rect(cx - (w >> 1), cy - 13 + i * 2, w, 2, i % 2 ? accent : light);
      }
      c.ellipse(cx, cy - 8, 3, 4, glow);
      break;
    }
  }

  if (level >= 3) {
    // Energieadern auf dem Lauf
    c.rect(cx + 5, cy - 1, 6, 1, glow);
  }

  c.outline();
  c.shadeEdges(0.3, -0.28);
  c.bloom(glow, 0.45);
  return c;
}

// --------------------------------------------------------------- Gegner

type BodyKind = "blob" | "runner" | "tiny" | "tank" | "carrier" | "splitter" | "sneak" | "flyer" | "boss";

const ENEMY_LOOKS: Record<string, BodyKind> = {
  grunt: "blob",
  runner: "runner",
  swarm: "tiny",
  tank: "tank",
  "shield-carrier": "carrier",
  splitter: "splitter",
  saboteur: "sneak",
  "phase-flyer": "flyer",
  "siege-golem": "boss",
  "hive-queen": "boss",
  "void-serpent": "flyer",
};

/**
 * Zeichnet einen Gegner. `frame` (0..3) versetzt Beine und Körper leicht —
 * daraus entsteht im Spiel die Laufanimation.
 */
function drawEnemy(kind: BodyKind, color: number, accent: number, frame: number, seed: number): PixelCanvas {
  const c = new PixelCanvas(S, S);
  const cx = S / 2;
  const bob = [0, -1, 0, 1][frame % 4];
  const step = [0, 1, 0, -1][frame % 4];
  const dark = shade(color, -0.4);
  const light = shade(color, 0.28);
  const eye = 0xfff2c8;

  // Bodenschatten (bewegt sich nicht mit dem Wippen)
  c.ellipse(cx, 25, 8, 3, shade(PALETTE.ground, -0.4));

  const cy = 15 + bob;

  switch (kind) {
    case "blob": {
      // Beine
      c.rect(cx - 5, cy + 6, 3, 5 + step, dark);
      c.rect(cx + 2, cy + 6, 3, 5 - step, dark);
      c.ellipse(cx, cy, 8, 8, color);
      c.ellipse(cx - 2, cy - 2, 5, 5, light);
      c.rect(cx - 6, cy - 1, 12, 3, accent);
      c.rect(cx - 3, cy - 4, 2, 2, eye);
      c.rect(cx + 2, cy - 4, 2, 2, eye);
      break;
    }

    case "runner": {
      // Schlank, nach vorne gebeugt, lange Beine
      c.line(cx - 3, cy + 5, cx - 5 - step, cy + 11, dark, 2);
      c.line(cx + 3, cy + 5, cx + 5 + step, cy + 11, dark, 2);
      c.ellipse(cx, cy + 1, 5, 7, color);
      c.ellipse(cx + 1, cy - 4, 4, 4, light);
      c.rect(cx + 1, cy - 5, 3, 2, eye);
      // Schweif/Antenne
      c.line(cx - 3, cy - 5, cx - 8, cy - 9 + step, accent);
      break;
    }

    case "tiny": {
      c.ellipse(cx, cy + 2, 4, 4, color);
      c.ellipse(cx - 1, cy + 1, 2, 2, light);
      c.set(cx - 1, cy + 1, eye);
      c.line(cx - 3, cy + 6, cx - 4, cy + 8 + step, dark);
      c.line(cx + 3, cy + 6, cx + 4, cy + 8 - step, dark);
      break;
    }

    case "tank": {
      // Breit, gepanzert, Kettenlaufwerk
      c.rect(cx - 11, cy + 5, 22, 6, shade(dark, -0.2));
      for (let i = 0; i < 6; i++) {
        c.rect(cx - 10 + i * 4 + step, cy + 6, 2, 4, shade(color, -0.55));
      }
      c.rect(cx - 10, cy - 6, 20, 12, color);
      c.rect(cx - 9, cy - 5, 18, 4, light);
      // Panzerplatten
      c.rect(cx - 10, cy - 2, 20, 2, accent);
      c.rect(cx - 6, cy - 9, 12, 4, shade(color, -0.15));
      c.rect(cx - 4, cy - 8, 3, 2, eye);
      c.rect(cx + 2, cy - 8, 3, 2, eye);
      break;
    }

    case "carrier": {
      c.rect(cx - 4, cy + 6, 3, 5 + step, dark);
      c.rect(cx + 1, cy + 6, 3, 5 - step, dark);
      c.ellipse(cx, cy, 7, 8, color);
      c.ellipse(cx - 1, cy - 2, 4, 4, light);
      c.rect(cx - 2, cy - 4, 2, 2, eye);
      c.rect(cx + 1, cy - 4, 2, 2, eye);
      // Großes Schild vorne
      c.rect(cx + 7, cy - 9, 4, 18, shade(accent, -0.25));
      c.rect(cx + 8, cy - 8, 2, 16, accent);
      c.rect(cx + 8, cy - 2, 2, 4, shade(accent, 0.4));
      break;
    }

    case "splitter": {
      c.rect(cx - 5, cy + 6, 3, 4 + step, dark);
      c.rect(cx + 2, cy + 6, 3, 4 - step, dark);
      c.ellipse(cx, cy, 8, 7, color);
      // Sichtbare Bruchlinien — deutet an, dass es zerfällt
      c.line(cx - 6, cy - 3, cx + 6, cy + 3, shade(color, -0.5));
      c.line(cx - 2, cy - 7, cx + 1, cy + 7, shade(color, -0.5));
      c.ellipse(cx - 3, cy - 2, 2, 2, accent);
      c.ellipse(cx + 3, cy + 1, 2, 2, accent);
      c.rect(cx - 1, cy - 5, 2, 2, eye);
      break;
    }

    case "sneak": {
      // Geduckt, Kapuze, Werkzeugarm
      c.line(cx - 2, cy + 5, cx - 4 - step, cy + 10, dark, 2);
      c.line(cx + 3, cy + 5, cx + 5 + step, cy + 10, dark, 2);
      c.ellipse(cx, cy + 1, 6, 6, color);
      c.taper(cx, cy - 8, 3, 11, 6, shade(color, -0.25));
      c.rect(cx - 2, cy - 4, 5, 2, eye);
      // Sabotage-Werkzeug
      c.line(cx + 6, cy, cx + 11, cy - 4 + step, accent, 2);
      c.ellipse(cx + 11, cy - 5 + step, 2, 2, PALETTE.danger);
      break;
    }

    case "flyer": {
      const wing = [0, 2, 0, -2][frame % 4];
      // Flügel
      c.taper(cx - 10, cy - 4 + wing, 3, 12, 6, shade(accent, -0.2));
      c.taper(cx + 10, cy - 4 + wing, 3, 12, 6, shade(accent, -0.2));
      c.ellipse(cx, cy, 6, 5, color);
      c.ellipse(cx, cy - 1, 4, 3, light);
      c.rect(cx - 2, cy - 2, 2, 2, eye);
      c.rect(cx + 1, cy - 2, 2, 2, eye);
      // Energieschweif
      c.ellipse(cx - 7, cy + 2, 2, 2, PALETTE.accent);
      break;
    }

    case "boss": {
      // Deutlich größer, mehrschichtig gepanzert
      c.rect(cx - 12, cy + 7, 24, 5, shade(dark, -0.25));
      for (let i = 0; i < 5; i++) c.rect(cx - 10 + i * 5 + step, cy + 8, 3, 3, shade(color, -0.6));
      c.ellipse(cx, cy, 13, 12, color);
      c.ellipse(cx - 3, cy - 3, 8, 7, light);
      // Panzerplatten
      c.rect(cx - 13, cy - 2, 26, 3, accent);
      c.rect(cx - 9, cy - 12, 18, 5, shade(color, -0.2));
      // Leuchtende Augen
      c.rect(cx - 6, cy - 10, 4, 3, PALETTE.coreGlow);
      c.rect(cx + 3, cy - 10, 4, 3, PALETTE.coreGlow);
      // Hörner
      c.line(cx - 10, cy - 10, cx - 14, cy - 16, accent, 2);
      c.line(cx + 10, cy - 10, cx + 14, cy - 16, accent, 2);
      break;
    }
  }

  c.outline();
  c.shadeEdges(0.3, -0.3);
  c.speckle(seed + frame, 0.1, 0.12);
  return c;
}

// ------------------------------------------------------------ Kacheln

function drawGroundTile(variant: number): PixelCanvas {
  const c = new PixelCanvas(S, S);
  c.rect(0, 0, S, S, PALETTE.ground);
  let s = (variant * 7919 + 13) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Risse und Schuttbrocken
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const w = 2 + Math.floor(rand() * 5);
    c.rect(x, y, w, 1, shade(PALETTE.groundAlt, rand() > 0.5 ? 0.1 : -0.15));
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rand() * (S - 4));
    const y = Math.floor(rand() * (S - 4));
    c.ellipse(x, y, 1 + rand() * 1.5, 1 + rand(), PALETTE.groundEdge);
  }
  c.speckle(variant + 5, 0.09, 0.25);
  return c;
}

function drawLaneTile(variant: number): PixelCanvas {
  const c = new PixelCanvas(S, S);
  c.rect(0, 0, S, S, PALETTE.lane);
  let s = (variant * 104729 + 7) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Ausgetretene Pflastersteine
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(rand() * (S - 6));
    const y = Math.floor(rand() * (S - 5));
    const w = 4 + Math.floor(rand() * 6);
    const h = 3 + Math.floor(rand() * 3);
    c.rect(x, y, w, h, shade(PALETTE.lane, (rand() - 0.5) * 0.3));
    c.rect(x, y, w, 1, PALETTE.laneLight);
  }
  c.speckle(variant, 0.12, 0.3);
  return c;
}

function drawBuildableTile(): PixelCanvas {
  const c = new PixelCanvas(S, S);
  c.rect(0, 0, S, S, PALETTE.buildable);
  // Fundamentraster, damit Bauplätze sofort lesbar sind
  c.rect(1, 1, S - 2, 1, PALETTE.buildableEdge);
  c.rect(1, S - 2, S - 2, 1, PALETTE.buildableEdge);
  c.rect(1, 1, 1, S - 2, PALETTE.buildableEdge);
  c.rect(S - 2, 1, 1, S - 2, PALETTE.buildableEdge);
  for (const [x, y] of [
    [3, 3],
    [S - 5, 3],
    [3, S - 5],
    [S - 5, S - 5],
  ]) {
    c.rect(x, y, 2, 2, PALETTE.buildableEdge);
  }
  c.speckle(3, 0.08, 0.2);
  return c;
}

// ------------------------------------------------------------ Aufbau

export const ENEMY_FRAMES = 4;

export function buildAllSprites(scene: Phaser.Scene): void {
  // Türme: Sockel je Stufe + drehbarer Geschützturm je Stufe/Spezialisierung
  for (const [id, def] of Object.entries(TOWERS)) {
    const look = TOWER_LOOKS[id] ?? { turret: "barrel", base: "round" };
    const seed = id.length * 31;

    for (let level = 0; level <= 3; level++) {
      drawTowerBase(look, def.color, def.accent, level, seed).toTexture(scene, `towerbase_${id}_${level}`);
      drawTurret(look.turret, def.color, def.accent, level, PALETTE.laneGlow).toTexture(
        scene,
        `turret_${id}_${level}`
      );
    }

    def.specializations.forEach((spec, i) => {
      const tint = i === 0 ? shade(def.color, 0.22) : mix(def.color, PALETTE.accent, 0.3);
      const glow = i === 0 ? 0xffd98a : 0x9ad6ff;
      // Spezialisierungen bekommen eine eigene Turmform, nicht nur eine Farbe.
      const turret: TurretKind =
        id === "gunner" ? (i === 0 ? "double" : "long") : id === "cannon" && i === 1 ? "double" : look.turret;
      drawTowerBase(look, tint, def.accent, 3, seed + i).toTexture(scene, `towerbase_${id}_spec_${spec.id}`);
      drawTurret(turret, tint, def.accent, 3, glow).toTexture(scene, `turret_${id}_spec_${spec.id}`);
    });
  }

  // Gegner: Laufframes
  for (const [id, def] of Object.entries(ENEMIES)) {
    const kind = ENEMY_LOOKS[id] ?? "blob";
    for (let frame = 0; frame < ENEMY_FRAMES; frame++) {
      drawEnemy(kind, def.color, def.accent, frame, id.length * 17).toTexture(scene, `enemy_${id}_${frame}`);
    }
    // Animation registrieren
    const animKey = `walk_${id}`;
    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: Array.from({ length: ENEMY_FRAMES }, (_, f) => ({ key: `enemy_${id}_${f}` })),
        frameRate: def.cls === "boss" ? 5 : def.speed > 1.6 ? 12 : 8,
        repeat: -1,
      });
    }
  }

  // Kacheln in mehreren Varianten, damit der Boden nicht gekachelt wirkt
  for (let v = 0; v < 4; v++) {
    drawGroundTile(v).toTexture(scene, `tile_ground_${v}`);
    drawLaneTile(v).toTexture(scene, `tile_lane_${v}`);
  }
  drawBuildableTile().toTexture(scene, "tile_buildable");

  buildMarkers(scene);
  buildParticles(scene);
}

/** Spawn-Portal und Core als eigene, erkennbare Bauwerke. */
function buildMarkers(scene: Phaser.Scene): void {
  const portal = new PixelCanvas(S, S);
  portal.ellipse(S / 2, S / 2 + 4, 13, 6, shade(PALETTE.spawn, -0.5));
  portal.ellipse(S / 2, S / 2, 10, 12, shade(PALETTE.spawn, -0.3));
  portal.ellipse(S / 2, S / 2, 7, 9, PALETTE.spawn);
  portal.ellipse(S / 2, S / 2, 4, 6, PALETTE.spawnGlow);
  for (const dx of [-11, 11]) portal.rect(S / 2 + dx, S / 2 - 8, 3, 18, shade(PALETTE.spawn, -0.55));
  portal.outline();
  portal.shadeEdges(0.3, -0.3);
  portal.bloom(PALETTE.spawnGlow, 0.5);
  portal.toTexture(scene, "marker_spawn");

  const core = new PixelCanvas(S, S);
  core.ellipse(S / 2, S / 2 + 7, 13, 5, shade(PALETTE.core, -0.55));
  // Sockel
  core.taper(S / 2, S / 2 + 2, 14, 22, 8, shade(PALETTE.core, -0.4));
  // Kristallkern
  for (let i = 0; i < 9; i++) {
    const w = 11 - Math.abs(i - 4) * 2;
    core.rect(S / 2 - (w >> 1), S / 2 - 12 + i * 2, w, 2, i % 2 ? PALETTE.core : shade(PALETTE.core, 0.25));
  }
  core.ellipse(S / 2, S / 2 - 4, 4, 5, PALETTE.coreGlow);
  core.outline();
  core.shadeEdges(0.32, -0.3);
  core.bloom(PALETTE.coreGlow, 0.55);
  core.toTexture(scene, "marker_core");
}

function buildParticles(scene: Phaser.Scene): void {
  const dots: { key: string; color: number; size: number }[] = [
    { key: "px_spark", color: 0xffe08a, size: 3 },
    { key: "px_fire", color: 0xff8a3c, size: 4 },
    { key: "px_ice", color: 0xa8e8ff, size: 4 },
    { key: "px_poison", color: 0x9bf06a, size: 4 },
    { key: "px_smoke", color: 0x8a93a8, size: 4 },
    { key: "px_energy", color: 0xc9a6ff, size: 3 },
    { key: "px_blood", color: 0xd4564f, size: 3 },
    { key: "px_dust", color: 0x6d6350, size: 3 },
  ];
  for (const dot of dots) {
    if (scene.textures.exists(dot.key)) continue;
    const c = new PixelCanvas(dot.size, dot.size);
    c.rect(0, 0, dot.size, dot.size, dot.color);
    c.toTexture(scene, dot.key);
  }

  if (!scene.textures.exists("px_bullet")) {
    const c = new PixelCanvas(10, 4);
    c.rect(0, 1, 10, 2, 0xffe9a8);
    c.rect(7, 0, 3, 4, 0xfff6d8);
    c.outline();
    c.toTexture(scene, "px_bullet");
  }

  if (!scene.textures.exists("px_shell")) {
    const c = new PixelCanvas(8, 8);
    c.ellipse(4, 4, 3, 3, 0xd98d3a);
    c.ellipse(3, 3, 1.5, 1.5, 0xffcf8a);
    c.outline();
    c.toTexture(scene, "px_shell");
  }
}

/** Texturschlüssel für Turmsockel bzw. Geschützturm. */
export function towerBaseTexture(defId: string, level: number, specializationId: string): string {
  if (specializationId) return `towerbase_${defId}_spec_${specializationId}`;
  return `towerbase_${defId}_${Math.min(3, Math.max(0, level))}`;
}

export function turretTexture(defId: string, level: number, specializationId: string): string {
  if (specializationId) return `turret_${defId}_spec_${specializationId}`;
  return `turret_${defId}_${Math.min(3, Math.max(0, level))}`;
}

export function groundTexture(x: number, y: number): string {
  return `tile_ground_${(x * 3 + y * 7) % 4}`;
}

export function laneTexture(x: number, y: number): string {
  return `tile_lane_${(x * 5 + y * 11) % 4}`;
}

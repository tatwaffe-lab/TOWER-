import Phaser from "phaser";
import { ENEMIES, TOWERS } from "@td/shared";
import { PALETTE, SPRITE_BASE, shade } from "./palette";

/**
 * Erzeugt alle Sprites programmatisch als Pixel-Art und legt sie im
 * Phaser-Texturcache ab.
 *
 * Hintergrund: es dürfen keine externen Asset-Dateien vorausgesetzt werden.
 * Statt bei Kreisen stehenzubleiben, wird hier pro Einheit ein echtes
 * Pixelraster gezeichnet — jede Silhouette ist von Hand entworfen, mit
 * Outline, Schattierung und Upgrade-Varianten. Alles wird einmal beim Start
 * gerendert und danach nur noch als Textur benutzt (kein Zeichnen pro Frame).
 */

type Grid = string[];

/**
 * Farbschlüssel in den Pixelrastern:
 *   .  = transparent      o = Outline (dunkel)
 *   1  = Hauptfarbe       2 = hell     3 = dunkel
 *   4  = Akzentfarbe      5 = Akzent hell
 *   g  = Glüh-/Energiefarbe
 */
function paintGrid(
  gfx: Phaser.GameObjects.Graphics,
  grid: Grid,
  main: number,
  accent: number,
  glow: number,
  px = 1
): void {
  const colors: Record<string, number | null> = {
    ".": null,
    o: PALETTE.outline,
    "1": main,
    "2": shade(main, 0.28),
    "3": shade(main, -0.32),
    "4": accent,
    "5": shade(accent, 0.3),
    g: glow,
  };
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const color = colors[row[x]];
      if (color === null || color === undefined) continue;
      gfx.fillStyle(color, 1);
      gfx.fillRect(x * px, y * px, px, px);
    }
  }
}

function makeTexture(scene: Phaser.Scene, key: string, grid: Grid, main: number, accent: number, glow: number): void {
  if (scene.textures.exists(key)) return;
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  paintGrid(gfx, grid, main, accent, glow);
  const w = Math.max(...grid.map((r) => r.length));
  gfx.generateTexture(key, w, grid.length);
  gfx.destroy();
}

// ---------------------------------------------------------------- Türme
// Jeder Turm hat eine eigene Silhouette. Stufe 0 = Grundbau,
// Stufe 1 = mehr Aufbauten, Stufe 2 = Energieelemente, Spezialisierung =
// deutlich andere Form. Ein Level-1-Turm und ein Endgame-Turm sind damit
// sofort unterscheidbar (Master Prompt §22).

const TOWER_BASE: Grid = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....oooooooo....",
  "...o333333333o..",
  "...o311111113o..",
  "...o311111113o..",
  "...o333333333o..",
  "....oooooooo....",
  "................",
  "................",
  "................",
  "................",
];

const TOWER_SHAPES: Record<string, Grid[]> = {
  gunner: [
    [
      "................",
      "................",
      "......oooo......",
      ".....o1111o.....",
      "....o111111o....",
      "....o144441o....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      ".......oo.......",
      "......o11o......",
      ".....o1111o.....",
      "....o111111o....",
      "....o144441o....",
      "...oo111111oo...",
      "...o41111114o...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "...oooooooooo...",
      "................",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      ".......gg.......",
      "......og1go.....",
      ".....o1111o.....",
      "....og1111go....",
      "....o144441o....",
      "...oo111111oo...",
      "...o41gggg14o...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33g22g33o...",
      "...oooooooooo...",
      "................",
      "................",
      "................",
      "................",
    ],
  ],

  cannon: [
    [
      "................",
      "................",
      "................",
      ".....oooooo.....",
      "....o111111o....",
      "...o11111111o...",
      "...o14444441o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o3333333333o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "....oo....oo....",
      "....o1oooo1o....",
      "....o111111o....",
      "...o11111111o...",
      "...o14444441o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o3322222233o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "....og....go....",
      "....o1oooo1o....",
      "...og111111go...",
      "...o11111111o...",
      "...o14gggg41o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3g222222g3o..",
      "..o3322222233o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
  ],

  frost: [
    [
      "................",
      "................",
      ".......oo.......",
      "......o11o......",
      "......o11o......",
      ".....o1111o.....",
      "....o114411o....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      ".......oo.......",
      "......o44o......",
      "......o44o......",
      ".....o4114o.....",
      ".....o1111o.....",
      "....o114411o....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "..o433333334o...",
      "..ooooooooooo...",
      "................",
      "................",
      "................",
    ],
    [
      ".......gg.......",
      "......og go.....",
      "......oggo......",
      ".....og44go.....",
      ".....o4114o.....",
      "....og1111go....",
      "....o11gg11o....",
      "...oo111111oo...",
      "...og111111go...",
      "...o33333333o...",
      "...o3g2222g3o...",
      "..o433333334o...",
      "..ooooooooooo...",
      "................",
      "................",
      "................",
    ],
  ],

  tesla: [
    [
      "................",
      "................",
      ".......gg.......",
      "......o44o......",
      "......o44o......",
      "......o11o......",
      ".....o1111o.....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "......g..g......",
      ".....gogogo.....",
      "......o44o......",
      "......o44o......",
      ".....o4114o.....",
      ".....o1111o.....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "....g.......g...",
      ".....g.gg.g.....",
      "....gogggogo....",
      "......oggo......",
      "......o44o......",
      ".....o4114o.....",
      ".....og11go.....",
      "....o1gggg1o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o3g2222g3o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
  ],

  sniper: [
    [
      "................",
      "................",
      "................",
      "..oooo..........",
      ".o1111o.........",
      ".o144441oooo....",
      ".o1111o.........",
      "..oooo..........",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "..oooo..........",
      ".o1111o.........",
      ".o14444oooooo...",
      ".o144441111114o.",
      ".o14444oooooo...",
      ".o1111o.........",
      "..oo111111oo....",
      "...o33333333o...",
      "...o32222223o...",
      "...o43333334o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "..gggg..........",
      ".ogggggo........",
      ".o1111o.........",
      ".o14g44oooooo...",
      ".o1444411111g4o.",
      ".o14g44oooooo...",
      ".o1111o.........",
      "..oo111111oo....",
      "...o33333333o...",
      "...o3g2222g3o...",
      "...o43333334o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
  ],

  flamethrower: [
    [
      "................",
      "................",
      "................",
      "................",
      "....oooooo......",
      "...o111111ooo...",
      "...o14444411o...",
      "...o111111ooo...",
      "..oo111111oo....",
      "..o33333333o....",
      "..o32222223o....",
      "..o33333333o....",
      "..oooooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "................",
      "....oo..........",
      "....o1oooooo....",
      "...o111111ooo...",
      "...o1444441144o.",
      "...o111111ooo...",
      "..oo111111oo....",
      "..o33333333o....",
      "..o32222223o....",
      "..o43333334o....",
      "..oooooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "....gg..........",
      "....og..........",
      "....o1oooooo....",
      "...og11111ooo...",
      "...o144g441g4go.",
      "...og11111ooo...",
      "..oo111111oo....",
      "..o33333333o....",
      "..o3g22222g3o...",
      "..o43333334o....",
      "..oooooooooo....",
      "................",
      "................",
      "................",
    ],
  ],

  mortar: [
    [
      "................",
      "................",
      "................",
      "......oooo......",
      ".....o1111o.....",
      "....o111111o....",
      "....o144441o....",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o3333333333o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      ".....oooooo.....",
      "....o111111o....",
      "....o111111o....",
      "...o11111111o...",
      "...o14444441o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o4333333334o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "......gggg......",
      ".....og11go.....",
      "....og1111go....",
      "....o111111o....",
      "...og111111go...",
      "...o14gggg41o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3g222222g3o..",
      "..o4333333334o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
  ],

  "support-beacon": [
    [
      "................",
      "................",
      ".......gg.......",
      "......o44o......",
      "......o44o......",
      ".....o1111o.....",
      ".....o1111o.....",
      "....o111111o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      ".......gg.......",
      "......gggg......",
      "......o44o......",
      ".....o4444o.....",
      ".....o1111o.....",
      "....o111111o....",
      "....o144441o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "..o433333334o...",
      "..ooooooooooo...",
      "................",
      "................",
      "................",
    ],
    [
      "......gggg......",
      ".....gggggg.....",
      "....gg.gg.gg....",
      "......o44o......",
      ".....o4gg4o.....",
      ".....o1111o.....",
      "....og1111go....",
      "....o144441o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o3g2222g3o...",
      "..o433333334o...",
      "..ooooooooooo...",
      "................",
      "................",
      "................",
    ],
  ],

  alchemist: [
    [
      "................",
      "................",
      "................",
      "......oooo......",
      ".....o1111o.....",
      ".....o1441o.....",
      "....o111111o....",
      "....o144441o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o33333333o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      ".....oo..oo.....",
      "....o44oo44o....",
      "....o4411 44o...",
      ".....o1441o.....",
      "....o111111o....",
      "....o144441o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o32222223o...",
      "...o43333334o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      ".....gg..gg.....",
      ".....og..go.....",
      "....o44oo44o....",
      "....o44gg44o....",
      ".....og44go.....",
      "....og1111go....",
      "....o14gg41o....",
      "...oo111111oo...",
      "...o33333333o...",
      "...o3g2222g3o...",
      "...o43333334o...",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
  ],

  "drone-hub": [
    [
      "................",
      "................",
      "................",
      "................",
      "....oooooooo....",
      "...o11111111o...",
      "...o14444441o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o3333333333o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "................",
      "..oo........oo..",
      "..o4o......o4o..",
      "....oooooooo....",
      "...o11111111o...",
      "...o14444441o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3222222223o..",
      "..o4333333334o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
    [
      "................",
      "..gg........gg..",
      "..og........go..",
      "..o4o......o4o..",
      "...og oooo go...",
      "...o11111111o...",
      "...o14gggg41o...",
      "...o11111111o...",
      "..oo11111111oo..",
      "..o3333333333o..",
      "..o3g222222g3o..",
      "..o4333333334o..",
      "..oooooooooooo..",
      "................",
      "................",
      "................",
    ],
  ],
};

// ---------------------------------------------------------------- Gegner

const ENEMY_SHAPES: Record<string, Grid> = {
  grunt: [
    "................",
    "................",
    "................",
    ".....oooo.......",
    "....o1111o......",
    "....o1441o......",
    "....o1111o......",
    "...oo1111oo.....",
    "...o311111o.....",
    "...o311113o.....",
    "....o3333o......",
    ".....o..o.......",
    "................",
    "................",
    "................",
    "................",
  ],
  runner: [
    "................",
    "................",
    "................",
    "................",
    "......ooo.......",
    ".....o111o......",
    ".....o141o......",
    ".....o111o......",
    "....oo111oo.....",
    "....o31113o.....",
    ".....o333o......",
    "......o.o.......",
    "................",
    "................",
    "................",
    "................",
  ],
  swarm: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......oo........",
    ".....o11o.......",
    ".....o41o.......",
    ".....o11o.......",
    "......oo........",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  tank: [
    "................",
    "................",
    "...oooooooo.....",
    "..o33333333o....",
    "..o31111113o....",
    "..o31444413o....",
    "..o31111113o....",
    ".oo31111113oo...",
    ".o3333333333o...",
    ".o3222222223o...",
    ".o3333333333o...",
    ".oo3o3oo3o3oo...",
    "..o.o.oo.o.o....",
    "................",
    "................",
    "................",
  ],
  "shield-carrier": [
    "................",
    "................",
    "......oooo......",
    ".....o1111o.....",
    ".....o1441o.....",
    "....oo1111oo....",
    "...o4o1111o4o...",
    "...o4o1111o4o...",
    "...o4oo11oo4o...",
    "...o44o33o44o...",
    "....o4o33o4o....",
    ".....oo33oo.....",
    "......o..o......",
    "................",
    "................",
    "................",
  ],
  splitter: [
    "................",
    "................",
    "................",
    "....oooooo......",
    "...o111111o.....",
    "...o1o44o1o.....",
    "...o111111o.....",
    "..oo111111oo....",
    "..o31o11o13o....",
    "..o3311113 o....",
    "...o333333o.....",
    "....o.oo.o......",
    "................",
    "................",
    "................",
    "................",
  ],
  saboteur: [
    "................",
    "................",
    "................",
    "......oo........",
    ".....o11oo......",
    ".....o1441o.....",
    ".....o1111o.....",
    "....oo1111o.....",
    "....o31111o.....",
    "....o3111o......",
    ".....o33o.......",
    "......oo........",
    "................",
    "................",
    "................",
    "................",
  ],
  "phase-flyer": [
    "................",
    "................",
    "................",
    "..o..........o..",
    ".o4o........o4o.",
    ".o44oooooooo44o.",
    "..o44411144 4o..",
    "...o1111111o....",
    "....o11111o.....",
    ".....o111o......",
    "......ooo.......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  "siege-golem": [
    "..oooooooooooo..",
    ".o333333333333o.",
    ".o311111111113o.",
    ".o31o444444o13o.",
    ".o31o4gggg4o13o.",
    ".o311444444113o.",
    ".o311111111113o.",
    "oo3111111111133o",
    "o333333333333330",
    "o322222222222230",
    "o333333333333330",
    "o33oo333333oo330",
    ".o.o.oooooo.o.o.",
    "...o.o....o.o...",
    "................",
    "................",
  ],
  "hive-queen": [
    "......oooo......",
    ".....o1111o.....",
    "....o114411o....",
    "....o1gggg1o....",
    "...o11111111o...",
    "...o1o1111o1o...",
    "..oo11111111oo..",
    "..o3311111133o..",
    "..o33g1111g33o..",
    "..o3333333333o..",
    "...o33333333o...",
    "....oo3333oo....",
    "..o..o.oo.o..o..",
    ".o....o..o....o.",
    "................",
    "................",
  ],
  "void-serpent": [
    "................",
    ".......gg.......",
    "......og4o......",
    ".....o4114o.....",
    "....o111111o....",
    "...o11gggg11o...",
    "...o1g1111g1o...",
    "..oo111111 1oo..",
    "..o3311111133o..",
    "...o33333333o...",
    "....o333333o....",
    ".....o3333o.....",
    "......o33o......",
    ".......oo.......",
    "................",
    "................",
  ],
};

/** Baut alle Texturen. Muss einmal in preload/create aufgerufen werden. */
export function buildAllSprites(scene: Phaser.Scene): void {
  for (const [id, def] of Object.entries(TOWERS)) {
    const shapes = TOWER_SHAPES[id] ?? [TOWER_BASE, TOWER_BASE, TOWER_BASE];
    shapes.forEach((grid, index) => {
      makeTexture(scene, `tower_${id}_${index}`, grid, def.color, def.accent, PALETTE.laneGlow);
    });
    // Spezialisierungen: eigene Farbgebung auf der höchsten Silhouette,
    // damit sie sich klar von der Grundform abheben.
    def.specializations.forEach((spec, i) => {
      const tint = i === 0 ? shade(def.color, 0.25) : shade(def.color, -0.2);
      const glow = i === 0 ? 0xffd98a : 0x9ad6ff;
      makeTexture(scene, `tower_${id}_spec_${spec.id}`, shapes[shapes.length - 1], tint, def.accent, glow);
    });
  }

  for (const [id, def] of Object.entries(ENEMIES)) {
    const grid = ENEMY_SHAPES[id] ?? ENEMY_SHAPES.grunt;
    makeTexture(scene, `enemy_${id}`, grid, def.color, def.accent, PALETTE.coreGlow);
  }

  buildTileTextures(scene);
  buildParticleTextures(scene);
}

/** Bodenkacheln mit leichter Struktur statt Volltonflächen. */
function buildTileTextures(scene: Phaser.Scene): void {
  const variants: { key: string; base: number; speck: number }[] = [
    { key: "tile_ground", base: PALETTE.ground, speck: PALETTE.groundAlt },
    { key: "tile_lane", base: PALETTE.lane, speck: PALETTE.laneLight },
    { key: "tile_buildable", base: PALETTE.buildable, speck: PALETTE.buildableEdge },
  ];

  for (const variant of variants) {
    if (scene.textures.exists(variant.key)) continue;
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(variant.base, 1);
    gfx.fillRect(0, 0, SPRITE_BASE, SPRITE_BASE);
    // Deterministische Sprenkel: gleiche Kachel sieht immer gleich aus.
    let seed = variant.key.length * 977;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(rand() * SPRITE_BASE);
      const y = Math.floor(rand() * SPRITE_BASE);
      gfx.fillStyle(rand() > 0.5 ? variant.speck : shade(variant.base, -0.12), 1);
      gfx.fillRect(x, y, 1, 1);
    }
    gfx.generateTexture(variant.key, SPRITE_BASE, SPRITE_BASE);
    gfx.destroy();
  }
}

/** Kleine Partikel- und Projektiltexturen. */
function buildParticleTextures(scene: Phaser.Scene): void {
  const dots: { key: string; color: number; size: number }[] = [
    { key: "px_spark", color: 0xffd98a, size: 2 },
    { key: "px_fire", color: 0xff8a3c, size: 3 },
    { key: "px_ice", color: 0xa8e8ff, size: 3 },
    { key: "px_poison", color: 0x9bf06a, size: 3 },
    { key: "px_smoke", color: 0x8a93a8, size: 3 },
    { key: "px_energy", color: 0xc9a6ff, size: 2 },
    { key: "px_blood", color: 0xd4564f, size: 2 },
  ];
  for (const dot of dots) {
    if (scene.textures.exists(dot.key)) continue;
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(dot.color, 1);
    gfx.fillRect(0, 0, dot.size, dot.size);
    gfx.generateTexture(dot.key, dot.size, dot.size);
    gfx.destroy();
  }

  if (!scene.textures.exists("px_bullet")) {
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(PALETTE.outline, 1);
    gfx.fillRect(0, 0, 6, 3);
    gfx.fillStyle(0xffe9a8, 1);
    gfx.fillRect(1, 1, 4, 1);
    gfx.generateTexture("px_bullet", 6, 3);
    gfx.destroy();
  }

  if (!scene.textures.exists("px_shell")) {
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(PALETTE.outline, 1);
    gfx.fillRect(0, 0, 5, 5);
    gfx.fillStyle(0xd98d3a, 1);
    gfx.fillRect(1, 1, 3, 3);
    gfx.generateTexture("px_shell", 5, 5);
    gfx.destroy();
  }
}

/** Passende Textur für einen Turm nach Stufe und Spezialisierung. */
export function towerTexture(defId: string, level: number, specializationId: string): string {
  if (specializationId) return `tower_${defId}_spec_${specializationId}`;
  const index = Math.min(2, Math.max(0, level === 0 ? 0 : level === 1 ? 0 : level === 2 ? 1 : 2));
  return `tower_${defId}_${index}`;
}

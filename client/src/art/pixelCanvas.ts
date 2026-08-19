import Phaser from "phaser";
import { PALETTE, mix, shade } from "./palette";

/**
 * Kleine Pixel-Zeichenmaschine.
 *
 * Statt jedes Sprite von Hand als Zeichenraster zu tippen, werden hier
 * Formen in einen Pixelpuffer gezeichnet und anschließend automatisch
 * veredelt:
 *
 *   1. `outline()` legt eine dunkle Kontur um alles Gezeichnete
 *   2. `shade()` setzt eine Lichtkante oben links und Schatten unten rechts
 *
 * Diese beiden Schritte sind der Unterschied zwischen "bunte Klötzchen" und
 * Pixel-Art, die handgemacht aussieht — und sie funktionieren für jede Form,
 * ohne dass man Licht und Schatten pro Sprite von Hand setzen muss.
 */
export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  private buffer: (number | null)[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = new Array(width * height).fill(null);
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): number | null {
    return this.inside(x, y) ? this.buffer[this.idx(x, y)] : null;
  }

  set(x: number, y: number, color: number | null): void {
    if (!this.inside(x, y)) return;
    this.buffer[this.idx(x, y)] = color;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
    }
  }

  /** Gefüllte Ellipse — Grundform für Körper, Köpfe, Kuppeln. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / Math.max(0.5, rx);
        const dy = (y - cy) / Math.max(0.5, ry);
        if (dx * dx + dy * dy <= 1.02) this.set(x, y, color);
      }
    }
  }

  /** Linie (Bresenham) — für Beine, Antennen, Streben. */
  line(x0: number, y0: number, x1: number, y1: number, color: number, thickness = 1): void {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let guard = 0;
    while (guard++ < 500) {
      if (thickness <= 1) this.set(x0, y0, color);
      else this.rect(x0 - ((thickness / 2) | 0), y0 - ((thickness / 2) | 0), thickness, thickness, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Trapez/Keil — Turmsockel, Läufe, Panzerplatten. */
  taper(x: number, y: number, wTop: number, wBottom: number, h: number, color: number): void {
    for (let i = 0; i < h; i++) {
      const t = h <= 1 ? 0 : i / (h - 1);
      const w = Math.round(wTop + (wBottom - wTop) * t);
      this.rect(x - ((w / 2) | 0), y + i, w, 1, color);
    }
  }

  /** Spiegelt die linke Hälfte auf die rechte — erzwingt Symmetrie. */
  mirrorX(): void {
    const half = Math.floor(this.width / 2);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < half; x++) {
        this.set(this.width - 1 - x, y, this.get(x, y));
      }
    }
  }

  /**
   * Legt eine Kontur um alle gefüllten Pixel. Wird nach den Formen und vor
   * der Schattierung aufgerufen.
   */
  outline(color: number = PALETTE.outline): void {
    const original = [...this.buffer];
    const at = (x: number, y: number) => (this.inside(x, y) ? original[this.idx(x, y)] : null);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (at(x, y) !== null) continue;
        const hasNeighbour =
          at(x + 1, y) !== null || at(x - 1, y) !== null || at(x, y + 1) !== null || at(x, y - 1) !== null;
        if (hasNeighbour) this.set(x, y, color);
      }
    }
  }

  /**
   * Licht von oben links, Schatten unten rechts.
   *
   * Ein Pixel wird aufgehellt, wenn darüber/links nichts liegt (also eine
   * Kante zum Licht), und abgedunkelt, wenn darunter/rechts nichts liegt.
   * Konturpixel bleiben unberührt.
   */
  shadeEdges(light = 0.3, dark = -0.3, outlineColor: number = PALETTE.outline): void {
    const original = [...this.buffer];
    const filled = (x: number, y: number) => {
      if (!this.inside(x, y)) return false;
      const c = original[this.idx(x, y)];
      return c !== null && c !== outlineColor;
    };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const c = original[this.idx(x, y)];
        if (c === null || c === outlineColor) continue;
        const openTop = !filled(x, y - 1);
        const openLeft = !filled(x - 1, y);
        const openBottom = !filled(x, y + 1);
        const openRight = !filled(x + 1, y);
        if (openTop || openLeft) this.set(x, y, shade(c, light));
        else if (openBottom || openRight) this.set(x, y, shade(c, dark));
      }
    }
  }

  /** Leichtes Farbrauschen — nimmt Flächen den sterilen Volltoncharakter. */
  speckle(seed: number, strength = 0.1, density = 0.18): void {
    let s = (seed * 2654435761) >>> 0;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c === null || c === PALETTE.outline) continue;
      if (rand() > density) continue;
      this.buffer[i] = shade(c, (rand() - 0.5) * 2 * strength);
    }
  }

  /** Glüheffekt: helle Farbe leicht in die Nachbarpixel ausbluten lassen. */
  bloom(glowColor: number, amount = 0.35): void {
    const original = [...this.buffer];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (original[this.idx(x, y)] !== glowColor) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inside(nx, ny)) continue;
          const c = original[this.idx(nx, ny)];
          if (c === null || c === glowColor) continue;
          this.set(nx, ny, mix(c, glowColor, amount));
        }
      }
    }
  }

  /** Schreibt den Puffer als Phaser-Textur. */
  toTexture(scene: Phaser.Scene, key: string): void {
    if (scene.textures.exists(key)) return;
    const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
    for (let y = 0; y < this.height; y++) {
      let x = 0;
      while (x < this.width) {
        const color = this.buffer[this.idx(x, y)];
        if (color === null) {
          x++;
          continue;
        }
        // Gleiche Farben in einer Zeile zusammenfassen — deutlich weniger
        // Zeichenbefehle bei großen Flächen.
        let run = 1;
        while (x + run < this.width && this.buffer[this.idx(x + run, y)] === color) run++;
        gfx.fillStyle(color, 1);
        gfx.fillRect(x, y, run, 1);
        x += run;
      }
    }
    gfx.generateTexture(key, this.width, this.height);
    gfx.destroy();
  }
}

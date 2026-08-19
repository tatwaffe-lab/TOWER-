import Phaser from "phaser";
import { GRID_HEIGHT, GRID_WIDTH } from "@td/shared";
import { MatchScene } from "./scenes/MatchScene";
import { Ui } from "./ui/Ui";
import { injectStyles } from "./ui/styles";
import { PALETTE, TILE_SIZE } from "./art/palette";
import { audio } from "./audio/AudioManager";

injectStyles();

/**
 * Layout: das Spielfeld bekommt einen eigenen Bereich, die Seitenleiste
 * einen zweiten. Vorher lag die Leiste als Overlay über dem Canvas und hat
 * die eigene Basis verdeckt — jetzt teilen sich beide den Platz.
 */
const app = document.getElementById("app")!;
app.innerHTML = `
  <div id="layout">
    <div id="game"></div>
    <div id="side"></div>
  </div>
  <div id="ui"></div>`;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GRID_WIDTH * TILE_SIZE,
  height: GRID_HEIGHT * TILE_SIZE,
  backgroundColor: PALETTE.voidDark,
  pixelArt: true,
  roundPixels: true,
  scale: {
    // FIT skaliert auf den verfügbaren Bereich — der ist jetzt exakt der
    // Platz links neben der Seitenleiste, nicht mehr das ganze Fenster.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    parent: "game",
  },
  scene: [MatchScene],
});

const ui = new Ui(document.getElementById("ui")!, document.getElementById("side")!);

game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("match") as MatchScene;
  ui.attachScene(scene);
  ui.showMenu();
});

// Bei Fenstergrößenänderung neu einpassen.
window.addEventListener("resize", () => game.scale.refresh());

// Audio darf erst nach einer Nutzergeste starten (Browser-Autoplay-Regeln).
const unlock = () => {
  audio.unlock();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

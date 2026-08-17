import Phaser from "phaser";
import { MatchScene } from "./scenes/MatchScene";
import { Ui } from "./ui/Ui";
import { injectStyles } from "./ui/styles";
import { TILE_SIZE, PALETTE } from "./art/palette";
import { audio } from "./audio/AudioManager";

injectStyles();

const app = document.getElementById("app")!;
app.innerHTML = `<div id="game"></div><div id="ui"></div>`;

const GRID_W = 14;
const GRID_H = 10;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GRID_W * TILE_SIZE,
  height: GRID_H * TILE_SIZE,
  backgroundColor: PALETTE.voidDark,
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MatchScene],
});

const ui = new Ui(document.getElementById("ui")!);

game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene("match") as MatchScene;
  ui.attachScene(scene);
  ui.showMenu();
});

// Audio darf erst nach einer Nutzergeste starten (Browser-Autoplay-Regeln).
const unlock = () => {
  audio.unlock();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

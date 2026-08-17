import { PALETTE, toCss } from "../art/palette";

/**
 * UI-Styling als ein injiziertes Stylesheet.
 *
 * Menüs, Lobby, HUD und Ergebnisbildschirm laufen als HTML-Overlay über dem
 * Phaser-Canvas. Das gibt sauberes, skalierbares UI mit echten Hover-/
 * Disabled-Zuständen, ohne jeden Button im Canvas nachzubauen.
 */
export function injectStyles(): void {
  if (document.getElementById("td-styles")) return;
  const style = document.createElement("style");
  style.id = "td-styles";
  style.textContent = `
:root {
  --bg: ${toCss(PALETTE.uiBg)};
  --panel: ${toCss(PALETTE.uiPanel)};
  --border: ${toCss(PALETTE.uiBorder)};
  --border-bright: ${toCss(PALETTE.uiBorderBright)};
  --text: ${toCss(PALETTE.text)};
  --dim: ${toCss(PALETTE.textDim)};
  --gold: ${toCss(PALETTE.gold)};
  --threat: ${toCss(PALETTE.threat)};
  --hp: ${toCss(PALETTE.hp)};
  --danger: ${toCss(PALETTE.danger)};
  --accent: ${toCss(PALETTE.accent)};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); overflow: hidden;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--text); }
#app { position: relative; width: 100%; height: 100%; }
#game { position: absolute; inset: 0; display: grid; place-items: center; }
#game canvas { image-rendering: pixelated; }

#ui { position: absolute; inset: 0; pointer-events: none; }
#ui > * { pointer-events: auto; }

.screen { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px; background: rgba(9,11,16,.94); }
.screen h1 { font-size: 40px; letter-spacing: 4px; margin: 0; color: var(--gold);
  text-shadow: 0 3px 0 #000; }
.screen h2 { font-size: 20px; margin: 0; font-weight: 500; }
.screen .sub { color: var(--dim); font-size: 13px; margin-top: -10px; }

.panel { background: var(--panel); border: 2px solid var(--border); border-radius: 6px;
  padding: 16px 18px; min-width: 320px; }
.panel h3 { margin: 0 0 10px; font-size: 14px; letter-spacing: 1px; color: var(--dim);
  text-transform: uppercase; font-weight: 500; }

.row { display: flex; gap: 8px; align-items: center; }
.col { display: flex; flex-direction: column; gap: 8px; }

button, .btn { font: inherit; font-size: 13px; padding: 9px 16px; cursor: pointer;
  background: #222a3a; color: var(--text); border: 2px solid var(--border);
  border-radius: 4px; transition: background .12s, border-color .12s, transform .06s; }
button:hover:not(:disabled) { background: #2e3a52; border-color: var(--border-bright); }
button:active:not(:disabled) { transform: translateY(1px); }
button:disabled { opacity: .4; cursor: not-allowed; }
button.primary { background: #2f5c45; border-color: #47876a; }
button.primary:hover:not(:disabled) { background: #3d7a5b; }
button.danger { background: #5c2f2f; border-color: #8a4747; }
button.selected { background: #3d4f78; border-color: var(--accent); }

input, select { font: inherit; font-size: 13px; padding: 8px 10px; background: #10141d;
  color: var(--text); border: 2px solid var(--border); border-radius: 4px; }
input:focus, select:focus { outline: none; border-color: var(--accent); }

/* ---------------- HUD ---------------- */
#hud { position: absolute; inset: 0; pointer-events: none; display: none; }
#hud.active { display: block; }
#hud > * { pointer-events: auto; }

.topbar { position: absolute; top: 0; left: 0; right: 0; height: 46px;
  background: linear-gradient(180deg, rgba(12,15,22,.97), rgba(12,15,22,.82));
  border-bottom: 2px solid var(--border); display: flex; align-items: center;
  gap: 18px; padding: 0 14px; font-size: 13px; }
.stat { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.stat .label { color: var(--dim); font-size: 11px; text-transform: uppercase; }
.stat .value { font-size: 15px; font-weight: 500; }
.stat.gold .value { color: var(--gold); }
.stat.threat .value { color: var(--threat); }
.stat.hp .value { color: var(--hp); }
.spacer { flex: 1; }

.bar { width: 90px; height: 8px; background: #10141d; border: 1px solid var(--border);
  border-radius: 2px; overflow: hidden; }
.bar > i { display: block; height: 100%; background: var(--hp); transition: width .18s; }
.bar.threat > i { background: var(--threat); }
.bar.xp > i { background: var(--accent); }

.wavebox { position: absolute; top: 54px; left: 50%; transform: translateX(-50%);
  background: rgba(12,15,22,.92); border: 2px solid var(--border); border-radius: 5px;
  padding: 6px 14px; font-size: 12px; text-align: center; max-width: 460px; }
.wavebox .next { color: var(--dim); font-size: 11px; margin-top: 2px; }
.wavebox.warn { border-color: var(--danger); }

.sidebar { position: absolute; right: 0; top: 46px; bottom: 0; width: 250px;
  background: rgba(12,15,22,.95); border-left: 2px solid var(--border);
  padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.section { border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
.section > h4 { margin: 0 0 7px; font-size: 11px; color: var(--dim);
  text-transform: uppercase; letter-spacing: 1px; font-weight: 500; }

.towergrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; }
.towerbtn { display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  padding: 6px 7px; font-size: 11px; text-align: left; line-height: 1.25; }
.towerbtn .cost { color: var(--gold); font-size: 10px; }
.towerbtn.unaffordable { opacity: .45; }

.sendlist, .abilitylist { display: flex; flex-direction: column; gap: 4px; }
.sendbtn { display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; padding: 6px 8px; }
.sendbtn .cost { color: var(--threat); }

.playerlist { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.playerrow { display: flex; align-items: center; gap: 6px; padding: 4px 6px;
  border: 1px solid var(--border); border-radius: 3px; cursor: pointer; }
.playerrow.target { border-color: var(--threat); background: rgba(217,79,122,.12); }
.playerrow.dead { opacity: .4; text-decoration: line-through; cursor: default; }
.playerrow.me { border-color: var(--accent); cursor: default; }
.playerrow .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--hp); flex: none; }
.dot.off { background: var(--danger); }

/* Turm-Inspektor */
.inspector { position: absolute; left: 10px; bottom: 10px; width: 275px;
  background: rgba(12,15,22,.96); border: 2px solid var(--border-bright);
  border-radius: 5px; padding: 11px; font-size: 12px; display: none; }
.inspector.active { display: block; }
.inspector h4 { margin: 0 0 3px; font-size: 14px; }
.inspector .role { color: var(--dim); font-size: 11px; margin-bottom: 7px; }
.statline { display: flex; justify-content: space-between; padding: 1px 0; font-size: 11px; }
.statline span:last-child { color: var(--gold); }
.inspector .actions { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }
.inspector .actions button { flex: 1; font-size: 11px; padding: 6px 8px; min-width: 68px; }
.specrow { margin-top: 7px; }
.specbtn { width: 100%; margin-top: 4px; font-size: 11px; text-align: left;
  padding: 7px 9px; line-height: 1.3; }

/* Perk-Auswahl */
.perkpick { position: absolute; inset: 0; background: rgba(9,11,16,.9);
  display: none; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.perkpick.active { display: flex; }
.perkcards { display: flex; gap: 12px; }
.perkcard { width: 195px; padding: 15px; background: var(--panel);
  border: 2px solid var(--border); border-radius: 6px; cursor: pointer; text-align: left; }
.perkcard:hover { border-color: var(--gold); background: #232b3c; }
.perkcard h4 { margin: 0 0 7px; font-size: 14px; color: var(--gold); }
.perkcard p { margin: 0; font-size: 11px; color: var(--dim); line-height: 1.45; }

/* Toasts */
.toasts { position: absolute; top: 56px; right: 262px; display: flex;
  flex-direction: column; gap: 5px; align-items: flex-end; pointer-events: none; }
.toast { background: rgba(12,15,22,.96); border: 2px solid var(--border);
  border-left-width: 4px; border-radius: 3px; padding: 7px 11px; font-size: 12px;
  max-width: 290px; animation: slidein .16s ease-out; }
.toast.info { border-left-color: var(--accent); }
.toast.warn { border-left-color: var(--gold); }
.toast.error { border-left-color: var(--danger); }
@keyframes slidein { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }

/* Lobby */
.lobbygrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 720px; }
.commanderlist { display: flex; flex-direction: column; gap: 6px; }
.cmdbtn { text-align: left; padding: 9px 11px; font-size: 12px; line-height: 1.4; }
.cmdbtn .tag { color: var(--dim); font-size: 10px; display: block; margin-top: 2px; }
.cmdbtn.selected .tag { color: var(--text); }
.roomcode { font-size: 26px; letter-spacing: 7px; color: var(--gold); text-align: center;
  padding: 8px; background: #10141d; border: 2px dashed var(--border); border-radius: 4px; }

/* Ergebnis */
.resulttable { width: 100%; border-collapse: collapse; font-size: 12px; }
.resulttable th { text-align: left; color: var(--dim); font-weight: 500; font-size: 11px;
  text-transform: uppercase; padding: 5px 8px; border-bottom: 1px solid var(--border); }
.resulttable td { padding: 6px 8px; border-bottom: 1px solid #1e2432; }
.resulttable tr.winner td { color: var(--gold); }

.hint { color: var(--dim); font-size: 11px; text-align: center; line-height: 1.6; }
.err { color: var(--danger); font-size: 12px; min-height: 16px; text-align: center; }
.editmode { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  background: rgba(12,15,22,.95); border: 2px solid var(--gold); border-radius: 5px;
  padding: 8px 14px; font-size: 12px; display: none; gap: 10px; align-items: center; }
.editmode.active { display: flex; }
`;
  document.head.appendChild(style);
}
